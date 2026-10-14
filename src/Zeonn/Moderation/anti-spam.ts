// Patch@Zeonn: AntiSpam — per-sender flood / repeat detection with temporary mute, warning and optional block.

export type AntiSpamOptions = {
/** max messages a sender may send within `windowMs` (default: 5) */
maxMessages?: number
/** sliding window, ms (default: 10_000) */
windowMs?: number
/** the same text this many times within the window counts as spam. 0 = off (default: 3) */
maxRepeats?: number
/** how long a spammer stays muted, ms (default: 60_000) */
muteMs?: number
/** block the sender after this many mutes. 0 / undefined = never block */
blockAfter?: number
/** warning sent when someone gets muted. `false` / undefined = send nothing */
warning?: string | false | ((sender: string, reason: AntiSpamReason) => string | false | undefined)
/** numbers / JIDs that are never treated as spam (e.g. the bot owner) */
allow?: string[]
/** do not check messages sent in groups (default: false) */
ignoreGroups?: boolean
/** ignore messages older than this many seconds, e.g. backlog replayed after reconnecting (default: 30) */
maxAgeSeconds?: number
/** called whenever a sender gets muted */
onSpam?: (info: { sender: string; chat: string; reason: AntiSpamReason; strikes: number }) => void
logger?: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }
/** clock override, mainly for tests */
now?: () => number
}

export type AntiSpamReason = 'rate' | 'repeat' | 'muted'

export type AntiSpamVerdict = { spam: boolean; reason?: AntiSpamReason; sender?: string; justMuted?: boolean }

/** the minimal message shape AntiSpam needs; a ZeonnByte WAMessage fits it */
export type SpamMessage = {
key: { remoteJid?: string | null; participant?: string | null; fromMe?: boolean | null }
message?: Record<string, any> | null
messageTimestamp?: number | { toNumber(): number } | null
}

/** the part of the socket AntiSpam needs, so it can be unit-tested with a stub */
export type AntiSpamSocket = {
ev: {
on(event: 'messages.upsert', listener: (arg: { messages: SpamMessage[]; type: string }) => void): void
off(event: 'messages.upsert', listener: (arg: { messages: SpamMessage[]; type: string }) => void): void
}
sendMessage(jid: string, content: { text: string }, options?: { quoted?: any }): Promise<unknown>
updateBlockStatus(jid: string, action: 'block' | 'unblock'): Promise<void>
}

type State = { hits: number[]; texts: { t: string; at: number }[]; mutedUntil: number; strikes: number }

const IGNORED_TYPES = new Set([
'protocolMessage',
'reactionMessage',
'senderKeyDistributionMessage',
'messageContextInfo',
'pollUpdateMessage',
'encReactionMessage'
])

const userPart = (jid: string | undefined | null) => {
if (!jid) return ''
const raw = jid.includes('@') ? jid.split('@')[0]!.split(':')[0]! : jid
return raw.replace(/[^0-9a-zA-Z]/g, '')
}

const toSeconds = (v: SpamMessage['messageTimestamp']) =>
typeof v === 'number' ? v : v && typeof v.toNumber === 'function' ? v.toNumber() : 0

/** text of any message type: conversation, extended text, captions */
export const getSpamText = (message: Record<string, any> | null | undefined, depth = 0): string => {
if (!message || depth > 5) return ''
if (typeof message.conversation === 'string') return message.conversation
for (const value of Object.values(message)) {
if (!value || typeof value !== 'object') continue
const v = value as any
const text = v.text ?? v.caption
if (typeof text === 'string' && text) return text
if (v.message && typeof v.message === 'object') {
const inner = getSpamText(v.message, depth + 1)
if (inner) return inner
}
}

return ''
}

export class AntiSpam {
private running = false
private readonly states = new Map<string, State>()
private readonly allowed: Set<string>
private readonly options: AntiSpamOptions
private readonly sock?: AntiSpamSocket
private checks = 0
private readonly listener = (arg: { messages: SpamMessage[]; type: string }) => {
if (arg.type !== 'notify') return
for (const msg of arg.messages) {
void this.handle(msg).catch(error => this.options.logger?.warn({ error }, 'antispam failed'))
}
}

/** `sock` is optional: without it AntiSpam only gives verdicts via check() and never sends or blocks anything */
constructor(sock?: AntiSpamSocket, options: AntiSpamOptions = {}) {
this.sock = sock
this.options = options
this.allowed = new Set((options.allow || []).map(userPart).filter(Boolean))
}

get isRunning() {
return this.running
}

/** listen to incoming messages and take action automatically (warn / block) */
start() {
if (!this.sock) throw new Error('AntiSpam.start() needs a socket')
if (!this.running) {
this.sock.ev.on('messages.upsert', this.listener)
this.running = true
}

return this
}

stop() {
if (this.running && this.sock) {
this.sock.ev.off('messages.upsert', this.listener)
this.running = false
}

return this
}

allow(jid: string) {
const u = userPart(jid)
if (u) this.allowed.add(u)
return this
}

disallow(jid: string) {
this.allowed.delete(userPart(jid))
return this
}

/** is this sender currently muted? use it in your own message handler: `if (antispam.isMuted(sender)) return` */
isMuted(jid: string): boolean {
const state = this.states.get(this.senderKey(jid))
return !!state && state.mutedUntil > this.now()
}

/** lift a mute / forget a sender */
reset(jid: string) {
this.states.delete(this.senderKey(jid))
return this
}

private now() {
return this.options.now ? this.options.now() : Date.now()
}

private senderKey(jid: string) {
return userPart(jid)
}

/** decides whether this message is spam and records it. Pure decision: sends / blocks nothing */
check(msg: SpamMessage): AntiSpamVerdict {
const { maxMessages = 5, windowMs = 10_000, maxRepeats = 3, muteMs = 60_000, maxAgeSeconds = 30 } = this.options
const chat = msg.key.remoteJid || ''
const sender = msg.key.participant || chat
const now = this.now()

if (msg.key.fromMe || !sender || chat === 'status@broadcast' || chat.endsWith('@newsletter')) return { spam: false }
if (this.options.ignoreGroups && chat.endsWith('@g.us')) return { spam: false }
if (!msg.message) return { spam: false }
const types = Object.keys(msg.message)
if (!types.length || types.every(t => IGNORED_TYPES.has(t))) return { spam: false }
const ts = toSeconds(msg.messageTimestamp)
if (ts && maxAgeSeconds > 0 && now / 1000 - ts > maxAgeSeconds) return { spam: false }

const key = this.senderKey(sender)
if (!key || this.allowed.has(key)) return { spam: false }

if (++this.checks % 500 === 0) this.cleanup(now, windowMs)
let state = this.states.get(key)
if (!state) this.states.set(key, (state = { hits: [], texts: [], mutedUntil: 0, strikes: 0 }))

if (state.mutedUntil > now) return { spam: true, reason: 'muted', sender }

state.hits = state.hits.filter(t => now - t <= windowMs)
state.texts = state.texts.filter(x => now - x.at <= windowMs)
state.hits.push(now)
const text = getSpamText(msg.message).trim().toLowerCase()
if (text) state.texts.push({ t: text, at: now })

let reason: AntiSpamReason | undefined
if (state.hits.length > maxMessages) reason = 'rate'
else if (maxRepeats > 0 && text && state.texts.filter(x => x.t === text).length >= maxRepeats) reason = 'repeat'
if (!reason) return { spam: false }

state.mutedUntil = now + muteMs
state.strikes++
state.hits = []
state.texts = []
return { spam: true, reason, sender, justMuted: true }
}

/** check() + side effects (warning message, block, onSpam callback). Used by start() */
async handle(msg: SpamMessage): Promise<AntiSpamVerdict> {
const verdict = this.check(msg)
if (!verdict.justMuted || !verdict.sender || !verdict.reason) return verdict
const chat = msg.key.remoteJid || verdict.sender
const strikes = this.states.get(this.senderKey(verdict.sender))?.strikes || 1
const { warning, blockAfter = 0 } = this.options
this.options.logger?.info({ sender: verdict.sender, reason: verdict.reason, strikes }, 'antispam: sender muted')
try {
this.options.onSpam?.({ sender: verdict.sender, chat, reason: verdict.reason, strikes })
} catch (error) {
this.options.logger?.warn({ error }, 'antispam: onSpam threw')
}

if (!this.sock) return verdict
const text = typeof warning === 'function' ? warning(verdict.sender, verdict.reason) : warning
if (text) {
try {
await this.sock.sendMessage(chat, { text }, { quoted: msg })
} catch (error) {
this.options.logger?.warn({ error, chat }, 'antispam: failed to send warning')
}
}

if (blockAfter > 0 && strikes >= blockAfter) {
try {
await this.sock.updateBlockStatus(verdict.sender, 'block')
this.options.logger?.info({ sender: verdict.sender, strikes }, 'antispam: sender blocked')
} catch (error) {
this.options.logger?.warn({ error, sender: verdict.sender }, 'antispam: failed to block sender')
}
}

return verdict
}

private cleanup(now: number, windowMs: number) {
for (const [key, state] of this.states) {
const idle = state.mutedUntil <= now && state.hits.every(t => now - t > windowMs)
if (idle && state.strikes === 0) this.states.delete(key)
}
}
}
