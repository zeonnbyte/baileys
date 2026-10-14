// Patch@Zeonn: OnMessage — full message handler: parser, commands, guards, middleware, events.

import { isLidUser } from '../../WABinary'
import { downloadMediaMessage, getContentType, normalizeMessageContent } from '../../Utils/messages'
import {
type AnyEvents,
botJids,
findMember,
GroupCache,
type GroupMetaLike,
isAdminMember,
normJid,
toPn,
userNum
} from '../common'

export type MessageKey = {
id?: string | null
remoteJid?: string | null
fromMe?: boolean | null
participant?: string | null
participantAlt?: string | null
remoteJidAlt?: string | null
}

export type IncomingMessage = {
key: MessageKey
message?: Record<string, any> | null
messageTimestamp?: number | { toNumber(): number } | null
pushName?: string | null
participant?: string | null
}

export type QuotedMessage = {
id?: string
sender?: string
key: MessageKey
message?: Record<string, any>
type?: string
text: string
isMedia: boolean
}

export type MessageContext = {
sock: OnMessageSocket
m: IncomingMessage
key: MessageKey
/** chat JID */
from: string
isGroup: boolean
/** sender as WhatsApp gave it (can be @lid) */
sender: string
/** sender as phone number JID when it can be resolved */
senderPn: string
/** sender's phone number */
number: string
pushName: string
/** content type: conversation, imageMessage, ... */
type: string
text: string
prefix: string
/** command name, lower-case, without prefix */
cmd: string
args: string[]
/** everything after the command */
q: string
quoted: QuotedMessage | null
mentions: string[]
isMedia: boolean
isOwner: boolean
send(content: string | Record<string, any>, options?: Record<string, any>): Promise<unknown>
reply(content: string | Record<string, any>, options?: Record<string, any>): Promise<unknown>
react(emoji: string): Promise<unknown>
delete(): Promise<unknown>
download(): Promise<unknown>
downloadQuoted(): Promise<unknown>
typing(): Promise<unknown>
recording(): Promise<unknown>
paused(): Promise<unknown>
meta(): Promise<GroupMetaLike | undefined>
isAdmin(): Promise<boolean>
isBotAdmin(): Promise<boolean>
}

export type CommandOptions = {
/** only in groups */
group?: boolean
/** only in private chats */
private?: boolean
/** only owners */
owner?: boolean
/** only group admins (owners bypass) */
admin?: boolean
/** the bot must be a group admin */
botAdmin?: boolean
/** per-user cooldown, ms */
cooldown?: number
}

export type CommandRun = (ctx: MessageContext) => unknown

export type ReactionEvent = {
sock: OnMessageSocket
key: MessageKey
from: string
/** the emoji, '' when removed */
text: string
remove: boolean
sender: string
}

export type OnMessageEvents = {
/** every parsed message */
message: MessageContext
/** a registered command was matched and passed its guards */
command: MessageContext
/** a message with text that is not a registered command */
text: MessageContext
/** looked like a command (has prefix) but is not registered */
unknown: MessageContext
reaction: ReactionEvent
delete: Record<string, any>
}

export type OnMessageOptions = {
/** command prefixes (default: . / ! #) */
prefixes?: string[]
/** treat the first word of every message as a command (default: false) */
noPrefix?: boolean
/** owner numbers */
owners?: string[]
/** mark messages as read (default: true) */
autoRead?: boolean
/** ignore messages sent by the bot itself (default: true) */
ignoreSelf?: boolean
/** skip messages older than this many seconds, e.g. backlog after reconnect. 0 = off (default: 120) */
maxAge?: number
/** enables ctx.typing() / ctx.recording() / ctx.paused() */
presence?: {
typing(jid: string): Promise<unknown>
recording(jid: string): Promise<unknown>
paused(jid: string): Promise<unknown>
} | null
/** share one GroupCache with OnGroup */
groups?: GroupCache
/** guard replies */
messages?: Partial<{
group: string
private: string
owner: string
admin: string
botAdmin: string
cooldown: (seconds: number) => string
}>
onError?: (error: unknown, ctx?: MessageContext) => void
}

/** the part of the socket OnMessage needs */
export type OnMessageSocket = {
ev: AnyEvents
user?: { id?: string; lid?: string }
logger?: unknown
signalRepository?: any
updateMediaMessage?: any
readMessages(keys: any[]): Promise<any>
sendMessage(jid: string, content: any, options?: any): Promise<any>
groupMetadata(jid: string): Promise<any>
}

type Entry = CommandOptions & { names: string[]; run: CommandRun }
type Middleware = (ctx: MessageContext, next: () => Promise<unknown>) => unknown

const MEDIA = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'ptvMessage'])
const SKIP = new Set(['protocolMessage', 'senderKeyDistributionMessage'])

const nativeId = (json: unknown) => {
try {
return String(JSON.parse(String(json))?.id ?? '')
} catch {
return ''
}
}

/** text of a message: text, caption, button / list / native-flow replies */
export const getCommandText = (content: Record<string, any> | undefined, type: string | undefined): string => {
if (!content) return ''
const x = type ? content[type] : undefined
const text =
content.conversation ||
x?.text ||
x?.caption ||
x?.selectedButtonId ||
x?.selectedId ||
x?.singleSelectReply?.selectedRowId ||
nativeId(x?.nativeFlowResponseMessage?.paramsJson)
return typeof text === 'string' ? text : ''
}

export class OnMessage {
private readonly handlers = new Map<string, ((arg: any) => unknown)[]>()
private readonly middleware: Middleware[] = []
private readonly seen = new Set<string>()
private readonly cooldowns = new Map<string, number>()
private readonly sock: OnMessageSocket
private readonly prefixes: string[]
private readonly noPrefix: boolean
private readonly owners: string[]
private readonly autoRead: boolean
private readonly ignoreSelf: boolean
private readonly maxAge: number
private readonly presence: OnMessageOptions['presence']
private readonly groups: GroupCache
private readonly texts: Required<NonNullable<OnMessageOptions['messages']>>
private readonly onError: (error: unknown, ctx?: MessageContext) => void
readonly commands = new Map<string, Entry>()

constructor(sock: OnMessageSocket, options: OnMessageOptions = {}) {
this.sock = sock
this.prefixes = options.prefixes ?? ['.', '/', '!', '#']
this.noPrefix = options.noPrefix ?? false
this.owners = (options.owners ?? []).map(userNum)
this.autoRead = options.autoRead ?? true
this.ignoreSelf = options.ignoreSelf ?? true
this.maxAge = options.maxAge ?? 120
this.presence = options.presence ?? null
this.groups = (options.groups ?? new GroupCache()).bind(sock)
this.texts = {
group: 'Khusus grup.',
private: 'Khusus chat pribadi.',
owner: 'Khusus owner.',
admin: 'Khusus admin grup.',
botAdmin: 'Bot harus jadi admin.',
cooldown: seconds => `Tunggu ${seconds} detik.`,
...options.messages
}
this.onError = options.onError ?? (error => console.error('[OnMessage]', error))
}

// ===== API =====

/** register a command. `names` can be one name or several (aliases) */
command(names: string | string[], run: CommandRun, options: CommandOptions = {}) {
const list = ([] as string[]).concat(names).map(n => n.toLowerCase())
const entry: Entry = { ...options, names: list, run }
for (const name of list) this.commands.set(name, entry)
return this
}

/** middleware runs before every command / text. Call next() to continue */
use(fn: Middleware) {
this.middleware.push(fn)
return this
}

on<K extends keyof OnMessageEvents>(name: K, fn: (arg: OnMessageEvents[K]) => unknown) {
const list = this.handlers.get(name) ?? []
list.push(fn)
this.handlers.set(name, list)
return this
}

attach() {
this.sock.ev.on('messages.upsert', this.onUpsert)
this.sock.ev.on('messages.reaction', this.onReaction)
this.sock.ev.on('messages.delete', this.onDelete)
return this
}

detach() {
this.sock.ev.off('messages.upsert', this.onUpsert)
this.sock.ev.off('messages.reaction', this.onReaction)
this.sock.ev.off('messages.delete', this.onDelete)
return this
}

// ===== internal =====

private emit(name: string, arg: unknown) {
for (const fn of this.handlers.get(name) ?? []) {
try {
Promise.resolve(fn(arg)).catch(error => this.onError(error, arg as MessageContext))
} catch (error) {
this.onError(error, arg as MessageContext)
}
}
}

private readonly onUpsert = ({ messages, type }: { messages: IncomingMessage[]; type: string }) => {
if (type !== 'notify') return
for (const m of messages) void this.handle(m).catch(error => this.onError(error))
}

private readonly onReaction = (list: { key: MessageKey; reaction: { text?: string | null; key?: MessageKey | null } }[]) => {
for (const { key, reaction } of list) {
this.emit('reaction', {
sock: this.sock,
key,
from: key.remoteJid || '',
text: reaction.text || '',
remove: !reaction.text,
sender: normJid(reaction.key?.participant || reaction.key?.remoteJid)
} satisfies ReactionEvent)
}
}

private readonly onDelete = (data: Record<string, any>) => this.emit('delete', { sock: this.sock, ...data })

private async handle(m: IncomingMessage) {
const sock = this.sock
const key = m.key
if (!m.message || !key?.id) return
const from = key.remoteJid
if (!from || from === 'status@broadcast' || from.endsWith('@newsletter')) return
if (key.fromMe && this.ignoreSelf) return
const ts = typeof m.messageTimestamp === 'number' ? m.messageTimestamp : m.messageTimestamp?.toNumber?.() || 0
if (this.maxAge && ts && Date.now() / 1000 - ts > this.maxAge) return

const sid = from + key.id
if (this.seen.has(sid)) return
this.seen.add(sid)
if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string)

const content = normalizeMessageContent(m.message as any) as Record<string, any> | undefined
const type = getContentType(content as any) as string | undefined
if (!content || !type || SKIP.has(type)) return

if (this.autoRead) sock.readMessages([key]).catch(() => {})

// --- sender ---
const isGroup = from.endsWith('@g.us')
const sender = normJid(key.fromMe ? sock.user?.id : isGroup ? key.participant || m.participant : from)
const alt = isGroup ? key.participantAlt : key.remoteJidAlt
const senderPn = isLidUser(sender) ? (alt ? normJid(alt) : await toPn(sock, sender)) : sender
const isOwner = !!key.fromMe || this.owners.includes(userNum(senderPn)) || this.owners.includes(userNum(sender))

// --- text & command ---
const x = content[type]
const ci = x?.contextInfo
const text = getCommandText(content, type)
const prefix = this.prefixes.find(p => text.startsWith(p)) ?? ''
let cmd = ''
let q = ''
let args: string[] = []
if (text && (prefix || this.noPrefix)) {
const body = text.slice(prefix.length).trim()
cmd = (body.split(/\s+/)[0] || '').toLowerCase()
q = body.slice(cmd.length).trim()
args = q ? q.split(/\s+/) : []
}

// --- quoted ---
let quoted: QuotedMessage | null = null
if (ci?.quotedMessage) {
const qm = normalizeMessageContent(ci.quotedMessage) as Record<string, any> | undefined
const qt = getContentType(qm as any) as string | undefined
const qs: string | undefined = ci.participant ? normJid(ci.participant) : undefined
quoted = {
id: ci.stanzaId,
sender: qs,
key: {
remoteJid: from,
id: ci.stanzaId,
fromMe: !!qs && botJids(sock).some(b => !!b && userNum(b) === userNum(qs)),
participant: isGroup ? ci.participant : undefined
},
message: qm,
type: qt,
text: getCommandText(qm, qt),
isMedia: !!qt && MEDIA.has(qt)
}
}

const download = (msg: unknown): Promise<unknown> =>
downloadMediaMessage(msg as any, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage, logger: sock.logger } as any)
const toContent = (content: string | Record<string, any>) => (typeof content === 'string' ? { text: content } : content)

const ctx: MessageContext = {
sock,
m,
key,
from,
isGroup,
sender,
senderPn,
number: userNum(senderPn),
pushName: m.pushName || '',
type,
text,
prefix,
cmd,
args,
q,
quoted,
mentions: ci?.mentionedJid ?? [],
isMedia: MEDIA.has(type),
isOwner,
send: (c, o) => sock.sendMessage(from, toContent(c), o),
reply: (c, o) => sock.sendMessage(from, toContent(c), { quoted: m, ...o }),
react: emoji => sock.sendMessage(from, { react: { text: emoji, key } }),
delete: () => sock.sendMessage(from, { delete: key }),
download: () => download(m),
downloadQuoted: async () => (quoted?.isMedia ? download({ key: quoted.key, message: quoted.message }) : null),
typing: async () => this.presence?.typing(from),
recording: async () => this.presence?.recording(from),
paused: async () => this.presence?.paused(from),
meta: async () => (isGroup ? this.groups.get(from) : undefined),
isAdmin: async () => isGroup && isAdminMember(findMember(await this.groups.get(from), [sender, senderPn])),
isBotAdmin: async () => isGroup && isAdminMember(findMember(await this.groups.get(from), botJids(sock)))
}

this.emit('message', ctx)

let i = -1
const next = async (): Promise<unknown> => {
const fn = this.middleware[++i]
return fn ? fn(ctx, next) : this.dispatch(ctx)
}

try {
await next()
} catch (error) {
this.onError(error, ctx)
}
}

private async dispatch(ctx: MessageContext) {
const entry = ctx.cmd ? this.commands.get(ctx.cmd) : undefined
if (!entry) {
if (ctx.cmd && ctx.prefix) this.emit('unknown', ctx)
if (ctx.text) this.emit('text', ctx)
return
}

const t = this.texts
if (entry.group && !ctx.isGroup) return ctx.reply(t.group)
if (entry.private && ctx.isGroup) return ctx.reply(t.private)
if (entry.owner && !ctx.isOwner) return ctx.reply(t.owner)
if ((entry.admin || entry.botAdmin) && !ctx.isGroup) return ctx.reply(t.group)
if (entry.admin && !ctx.isOwner && !(await ctx.isAdmin())) return ctx.reply(t.admin)
if (entry.botAdmin && !(await ctx.isBotAdmin())) return ctx.reply(t.botAdmin)

if (entry.cooldown && !ctx.isOwner) {
const k = `${entry.names[0]}:${ctx.number}`
const now = Date.now()
const left = (this.cooldowns.get(k) ?? 0) - now
if (left > 0) return ctx.reply(t.cooldown(Math.ceil(left / 1000)))
this.cooldowns.set(k, now + entry.cooldown)
if (this.cooldowns.size > 5000) {
for (const [kk, until] of this.cooldowns) if (until < now) this.cooldowns.delete(kk)
}
}

this.emit('command', ctx)
await entry.run(ctx)
}
}
