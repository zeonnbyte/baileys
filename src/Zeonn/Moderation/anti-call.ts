// Patch@Zeonn: AntiCall — rejects incoming calls (private chats AND group calls), with optional warning, strike counter and block.

export type AntiCallOptions = {
/** reject incoming calls (default: true). false = only report them through onCall */
reject?: boolean
/** which calls to handle: 'all' (default), 'voice' or 'video' */
only?: 'all' | 'voice' | 'video'
/** where calls are handled: 'all' (default), 'chat' (private calls only) or 'group' (group calls only) */
scope?: 'all' | 'chat' | 'group'
/** private message to the caller after the call is rejected. `false` / undefined = send nothing */
warning?: string | false | ((caller: string, strikes: number) => string | false | undefined)
/** message posted in the group when a group call is rejected. `false` / undefined = send nothing */
groupWarning?: string | false | ((caller: string, group: string, strikes: number) => string | false | undefined)
/** block the caller after this many calls. 0 / undefined = never block */
blockAfter?: number
/** a caller's strikes are forgotten after this many ms without calling. 0 / undefined = never forget */
strikeResetMs?: number
/** numbers / JIDs whose calls are never rejected (e.g. the bot owner) */
allow?: string[]
/** group JIDs whose calls are never rejected */
allowGroups?: string[]
/** called for every handled call */
onCall?: (info: AntiCallInfo) => void
logger?: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }
/** clock override, mainly for tests */
now?: () => number
}

export type AntiCallInfo = {
caller: string
/** the group JID for group calls, otherwise the caller's chat */
chat: string
callId: string
isVideo: boolean
isGroup: boolean
strikes: number
}

/** the minimal call event AntiCall needs; a ZeonnByte WACallEvent fits it */
export type AntiCallEvent = {
id: string
from: string
chatId?: string
groupJid?: string
isVideo?: boolean
isGroup?: boolean
status: string
}

export type AntiCallVerdict = {
handled: boolean
/** why the call was left alone, when handled is false */
skipped?: 'status' | 'scope' | 'type' | 'allowed' | 'duplicate' | 'disabled'
rejected?: boolean
blocked?: boolean
strikes?: number
}

/** the part of the socket AntiCall needs, so it can be unit-tested with a stub */
export type AntiCallSocket = {
ev: {
on(event: 'call', listener: (calls: AntiCallEvent[]) => void): void
off(event: 'call', listener: (calls: AntiCallEvent[]) => void): void
}
rejectCall(callId: string, callFrom: string): Promise<void>
sendMessage(jid: string, content: { text: string }): Promise<unknown>
updateBlockStatus(jid: string, action: 'block' | 'unblock'): Promise<void>
}

type Strike = { count: number; last: number }

const userPart = (jid: string | undefined | null) => {
if (!jid) return ''
const raw = jid.includes('@') ? jid.split('@')[0]!.split(':')[0]! : jid
return raw.replace(/[^0-9a-zA-Z]/g, '')
}

export class AntiCall {
private running = false
private enabled = true
private readonly strikes = new Map<string, Strike>()
private readonly seen = new Set<string>()
private readonly allowed: Set<string>
private readonly allowedGroups: Set<string>
private readonly options: AntiCallOptions
private readonly sock: AntiCallSocket
private rejectedCount = 0
private blockedCount = 0
private readonly listener = (calls: AntiCallEvent[]) => {
for (const call of calls) {
void this.handle(call).catch(error => this.options.logger?.warn({ error }, 'anticall failed'))
}
}

constructor(sock: AntiCallSocket, options: AntiCallOptions = {}) {
this.sock = sock
this.options = options
this.allowed = new Set((options.allow || []).map(userPart).filter(Boolean))
this.allowedGroups = new Set(options.allowGroups || [])
}

get isRunning() {
return this.running
}

get isEnabled() {
return this.enabled
}

/** total rejected calls and blocked callers since this instance was created */
get stats() {
return { rejected: this.rejectedCount, blocked: this.blockedCount, tracked: this.strikes.size }
}

/** listen to incoming calls and handle them automatically */
start() {
if (!this.running) {
this.sock.ev.on('call', this.listener)
this.running = true
}

return this
}

stop() {
if (this.running) {
this.sock.ev.off('call', this.listener)
this.running = false
}

return this
}

/** pause / resume without removing the listener */
enable() {
this.enabled = true
return this
}

disable() {
this.enabled = false
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

allowGroup(groupJid: string) {
this.allowedGroups.add(groupJid)
return this
}

disallowGroup(groupJid: string) {
this.allowedGroups.delete(groupJid)
return this
}

/** is this caller exempt from call rejection? */
isAllowed(jid: string) {
return this.allowed.has(userPart(jid))
}

/** how many calls this caller has made so far (0 when unknown or expired) */
getStrikes(jid: string) {
const s = this.strikes.get(userPart(jid))
if (!s) return 0
const { strikeResetMs = 0 } = this.options
return strikeResetMs > 0 && this.now() - s.last > strikeResetMs ? 0 : s.count
}

/** forget one caller's counter */
reset(jid: string) {
this.strikes.delete(userPart(jid))
return this
}

/** forget every counter */
resetAll() {
this.strikes.clear()
return this
}

private now() {
return this.options.now ? this.options.now() : Date.now()
}

/** decides whether this call is handled, without rejecting / sending / blocking anything and without counting it */
check(call: AntiCallEvent): AntiCallVerdict {
if (!this.enabled) return { handled: false, skipped: 'disabled' }
if (call.status !== 'offer' || !call.id || !call.from) return { handled: false, skipped: 'status' }
const { only = 'all', scope = 'all' } = this.options
const isVideo = !!call.isVideo
const isGroup = !!call.isGroup || !!call.groupJid
if (scope === 'chat' && isGroup) return { handled: false, skipped: 'scope' }
if (scope === 'group' && !isGroup) return { handled: false, skipped: 'scope' }
if (only === 'voice' && isVideo) return { handled: false, skipped: 'type' }
if (only === 'video' && !isVideo) return { handled: false, skipped: 'type' }
const key = userPart(call.from)
if (!key || this.allowed.has(key)) return { handled: false, skipped: 'allowed' }
if (call.groupJid && this.allowedGroups.has(call.groupJid)) return { handled: false, skipped: 'allowed' }
if (this.seen.has(call.id)) return { handled: false, skipped: 'duplicate' }
return { handled: true }
}

/** handle one call event: count it, reject it, send the warnings, block if needed. Used by start() */
async handle(call: AntiCallEvent): Promise<AntiCallVerdict> {
const decision = this.check(call)
if (!decision.handled) return decision
const { reject = true, warning, groupWarning, blockAfter = 0, strikeResetMs = 0 } = this.options
const isVideo = !!call.isVideo
const isGroup = !!call.isGroup || !!call.groupJid
const group = call.groupJid || (isGroup ? call.chatId || '' : '')
const chat = isGroup && group ? group : call.chatId || call.from
const key = userPart(call.from)
const now = this.now()

this.seen.add(call.id)
if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value as string)
if (this.strikes.size > 1000) {
for (const [k, s] of this.strikes) if (strikeResetMs > 0 && now - s.last > strikeResetMs) this.strikes.delete(k)
}

const previous = this.strikes.get(key)
const expired = !!previous && strikeResetMs > 0 && now - previous.last > strikeResetMs
const count = (previous && !expired ? previous.count : 0) + 1
this.strikes.set(key, { count, last: now })

const info: AntiCallInfo = { caller: call.from, chat, callId: call.id, isVideo, isGroup, strikes: count }
this.options.logger?.info(info, 'anticall: incoming call')
try {
this.options.onCall?.(info)
} catch (error) {
this.options.logger?.warn({ error }, 'anticall: onCall threw')
}

const verdict: AntiCallVerdict = { handled: true, strikes: count }
if (!reject) return verdict

try {
await this.sock.rejectCall(call.id, call.from)
verdict.rejected = true
this.rejectedCount++
} catch (error) {
this.options.logger?.warn({ error, callId: call.id }, 'anticall: failed to reject call')
}

const privateText = typeof warning === 'function' ? warning(call.from, count) : warning
if (privateText) {
try {
await this.sock.sendMessage(call.from, { text: privateText })
} catch (error) {
this.options.logger?.warn({ error, caller: call.from }, 'anticall: failed to send warning')
}
}

if (isGroup && group) {
const groupText = typeof groupWarning === 'function' ? groupWarning(call.from, group, count) : groupWarning
if (groupText) {
try {
await this.sock.sendMessage(group, { text: groupText })
} catch (error) {
this.options.logger?.warn({ error, group }, 'anticall: failed to send group warning')
}
}
}

if (blockAfter > 0 && count >= blockAfter) {
try {
await this.sock.updateBlockStatus(call.from, 'block')
verdict.blocked = true
this.blockedCount++
this.options.logger?.info({ caller: call.from, strikes: count }, 'anticall: caller blocked')
} catch (error) {
this.options.logger?.warn({ error, caller: call.from }, 'anticall: failed to block caller')
}
}

return verdict
}
}
