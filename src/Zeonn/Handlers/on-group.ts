// Patch@Zeonn: OnGroup — group events: join / leave / kick / promote / demote, info changes, new groups, join requests.

import { isLidUser } from '../../WABinary'
import { type AnyEvents, botJids, GroupCache, type GroupMetaLike, toPn, userNum } from '../common'

export type GreetTemplates = Partial<Record<'join' | 'leave' | 'kick' | 'promote' | 'demote', string>>

export type OnGroupOptions = {
/**
 * auto messages. `true` = default texts, or your own per event.
 * Placeholders: {tag} {number} {subject} {count} {author}
 */
templates?: boolean | GreetTemplates
/** per group / event switch for the auto messages (default: always on) */
enabled?: (groupId: string, event: string) => boolean | Promise<boolean>
/** share one GroupCache with OnMessage */
groups?: GroupCache
onError?: (error: unknown, ctx?: unknown) => void
}

/** the part of the socket OnGroup needs */
export type OnGroupSocket = {
ev: AnyEvents
user?: { id?: string; lid?: string }
signalRepository?: any
groupMetadata(jid: string): Promise<any>
sendMessage(jid: string, content: any, options?: any): Promise<any>
groupRequestParticipantsUpdate(jid: string, participants: string[], action: 'approve' | 'reject'): Promise<any>
}

type Sender = (content: string | Record<string, any>, options?: Record<string, any>) => Promise<unknown>

export type ParticipantContext = {
sock: OnGroupSocket
/** group JID */
id: string
action: string
event: string
participant: unknown
/** participant JID as the group uses it (can be @lid) */
jid: string
/** participant phone number JID when it can be resolved */
pn: string
number: string
lid?: string
/** "@number", matches `mentions` */
tag: string
mentions: string[]
author?: string
authorPn?: string
authorTag: string
/** join: 'self' = via link; leave: 'self' = left on their own */
by: 'self' | 'admin'
meta?: GroupMetaLike
subject: string
count: number
isBot: boolean
send: Sender
}

export type ParticipantsBatch = {
sock: OnGroupSocket
id: string
action: string
participants: unknown[]
author?: string
authorPn?: string
meta?: GroupMetaLike
}

export type ChangeContext = {
sock: OnGroupSocket
id: string
/** the new value of the changed field */
value?: unknown
update: Record<string, any>
author?: string
authorPn?: string
send: Sender
}

export type CreateContext = { sock: OnGroupSocket; id: string; meta: GroupMetaLike; send: Sender }

export type RequestContext = {
sock: OnGroupSocket
id: string
/** created | revoked | rejected */
action: string
participant: string
pn?: string
number: string
author?: string
authorPn?: string
method?: string
approve(): Promise<unknown>
reject(): Promise<unknown>
send: Sender
}

type ParticipantEvent =
| 'join'
| 'leave'
| 'kick'
| 'promote'
| 'demote'
| 'modify'
| 'botJoin'
| 'botLeave'
| 'botPromote'
| 'botDemote'
type ChangeEvent = 'subject' | 'desc' | 'announce' | 'restrict' | 'memberAddMode' | 'joinApproval' | 'ephemeral' | 'invite'

export type OnGroupEvents = { [K in ParticipantEvent]: ParticipantContext } & { [K in ChangeEvent]: ChangeContext } & {
/** every participants.update, one call per batch */
participants: ParticipantsBatch
/** any groups.update */
update: ChangeContext
create: CreateContext
request: RequestContext
}

const DEFAULT_TEMPLATES: GreetTemplates = {
join: 'Welcome {tag} di {subject}',
leave: 'Bye {tag}',
kick: '{tag} dikeluarkan oleh {author}',
promote: '{tag} jadi admin',
demote: '{tag} bukan admin lagi'
}

// groups.update field -> event name
const CHANGES: Record<string, ChangeEvent> = {
subject: 'subject',
desc: 'desc',
/** true = only admins can send messages */
announce: 'announce',
/** true = only admins can edit group info */
restrict: 'restrict',
memberAddMode: 'memberAddMode',
joinApprovalMode: 'joinApproval',
ephemeralDuration: 'ephemeral',
inviteCode: 'invite'
}

const BOT_EVENT: Record<string, ParticipantEvent> = {
join: 'botJoin',
leave: 'botLeave',
kick: 'botLeave',
promote: 'botPromote',
demote: 'botDemote'
}

export class OnGroup {
private readonly handlers = new Map<string, ((arg: any) => unknown)[]>()
private readonly sock: OnGroupSocket
private readonly groups: GroupCache
private readonly templates: GreetTemplates | null
private readonly enabled: (groupId: string, event: string) => boolean | Promise<boolean>
private readonly onError: (error: unknown, ctx?: unknown) => void

constructor(sock: OnGroupSocket, options: OnGroupOptions = {}) {
this.sock = sock
this.groups = (options.groups ?? new GroupCache()).bind(sock)
this.templates = options.templates === true ? { ...DEFAULT_TEMPLATES } : options.templates || null
this.enabled = options.enabled ?? (() => true)
this.onError = options.onError ?? (error => console.error('[OnGroup]', error))
}

on<K extends keyof OnGroupEvents>(name: K, fn: (ctx: OnGroupEvents[K]) => unknown) {
const list = this.handlers.get(name) ?? []
list.push(fn)
this.handlers.set(name, list)
return this
}

attach() {
const ev = this.sock.ev
ev.on('group-participants.update', this.onParticipants)
ev.on('groups.update', this.onUpdate)
ev.on('groups.upsert', this.onUpsert)
ev.on('group.join-request', this.onRequest)
return this
}

detach() {
const ev = this.sock.ev
ev.off('group-participants.update', this.onParticipants)
ev.off('groups.update', this.onUpdate)
ev.off('groups.upsert', this.onUpsert)
ev.off('group.join-request', this.onRequest)
return this
}

/** cached group metadata */
meta(id: string, force = false) {
return this.groups.get(id, force)
}

private emit(name: string, ctx: unknown) {
for (const fn of this.handlers.get(name) ?? []) {
try {
Promise.resolve(fn(ctx)).catch(error => this.onError(error, ctx))
} catch (error) {
this.onError(error, ctx)
}
}
}

private sender(id: string, mentions: string[] = []): Sender {
return (content, options) =>
this.sock.sendMessage(id, typeof content === 'string' ? { text: content, mentions } : content, options)
}

// ===== member join / leave / kick / promote / demote =====

private readonly onParticipants = async ({
id,
author,
authorPn,
participants,
action
}: {
id: string
author?: string
authorPn?: string
participants: any[]
action: string
}) => {
try {
this.groups.drop(id)
const meta = await this.groups.get(id, true)
const bot = botJids(this.sock).map(userNum)

this.emit('participants', { sock: this.sock, id, action, participants, author, authorPn, meta } satisfies ParticipantsBatch)

for (const p of participants) {
const jid: string = typeof p === 'string' ? p : p.id
const pn: string = (typeof p === 'object' && p.phoneNumber) || (await toPn(this.sock, jid))
const self = !!author && (userNum(author) === userNum(jid) || (!!authorPn && userNum(authorPn) === userNum(pn)))
const event = action === 'add' ? 'join' : action === 'remove' ? (self ? 'leave' : 'kick') : action
const mentions = [jid, ...(author && !self ? [author] : [])]

const ctx: ParticipantContext = {
sock: this.sock,
id,
action,
event,
participant: p,
jid,
pn,
number: userNum(pn),
lid: (typeof p === 'object' && p.lid) || (isLidUser(jid) ? jid : undefined),
tag: '@' + userNum(jid),
mentions,
author,
authorPn,
authorTag: author ? '@' + userNum(author) : '',
by: self ? 'self' : 'admin',
meta,
subject: meta?.subject ?? '',
count: meta?.participants?.length ?? 0,
isBot: bot.includes(userNum(jid)),
send: this.sender(id, mentions)
}

this.emit(event, ctx)
const botEvent = BOT_EVENT[event]
if (ctx.isBot && botEvent) this.emit(botEvent, ctx)
if (!ctx.isBot) await this.greet(ctx)
}
} catch (error) {
this.onError(error)
}
}

private async greet(ctx: ParticipantContext) {
const template = (this.templates as Record<string, string | undefined> | null)?.[ctx.event]
if (!template || !(await this.enabled(ctx.id, ctx.event))) return
const text = template
.split('{tag}')
.join(ctx.tag)
.split('{number}')
.join(ctx.number)
.split('{subject}')
.join(ctx.subject)
.split('{count}')
.join(String(ctx.count))
.split('{author}')
.join(ctx.authorTag || 'admin')
await ctx.send(text)
}

// ===== group info changed =====

private readonly onUpdate = (updates: Record<string, any>[]) => {
try {
for (const u of updates) {
if (!u.id) continue
this.groups.drop(u.id)
const base: ChangeContext = {
sock: this.sock,
id: u.id,
update: u,
author: u.author,
authorPn: u.authorPn,
send: this.sender(u.id)
}
for (const [field, event] of Object.entries(CHANGES)) {
if (u[field] !== undefined) this.emit(event, { ...base, value: u[field] })
}

this.emit('update', base)
}
} catch (error) {
this.onError(error)
}
}

// ===== new group (bot added / group created) =====

private readonly onUpsert = (list: GroupMetaLike[]) => {
for (const meta of list) {
const id = String(meta.id)
this.groups.set(id, meta)
this.emit('create', { sock: this.sock, id, meta, send: this.sender(id) } satisfies CreateContext)
}
}

// ===== join request =====

private readonly onRequest = (r: Record<string, any>) => {
const act = (action: 'approve' | 'reject') => () => this.sock.groupRequestParticipantsUpdate(r.id, [r.participant], action)
this.emit('request', {
sock: this.sock,
id: r.id,
action: r.action,
participant: r.participant,
pn: r.participantPn,
number: userNum(r.participantPn || r.participant),
author: r.author,
authorPn: r.authorPn,
method: r.method,
approve: act('approve'),
reject: act('reject'),
send: this.sender(r.id)
} satisfies RequestContext)
}
}
