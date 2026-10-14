// Patch@Zeonn: Presence — send typing / recording / online / offline and track other people's presence.

import { type AnyEvents, sleep, userNum } from '../common'

export type PresenceType = 'unavailable' | 'available' | 'composing' | 'recording' | 'paused'

export type PresenceOptions = {
/** how long a received presence counts as fresh, ms (default: 30_000) */
ttl?: number
/** send 'available' every this many ms. 0 / undefined = off */
heartbeat?: number
onError?: (error: unknown) => void
}

export type PresenceEvent = {
chat: string
jid: string
number: string
isGroup: boolean
presence: PresenceType
lastSeen?: number
at: number
}

/** 'update' fires for every presence, the others fire for that presence only */
export type PresenceEventName = 'update' | PresenceType

export type PresenceSocket = {
ev: AnyEvents
presenceSubscribe(jid: string): Promise<any>
sendPresenceUpdate(type: PresenceType, toJid?: string): Promise<any>
}

type PresenceData = { presence: PresenceType; lastSeen?: number; at: number }

export class Presence {
private readonly sock: PresenceSocket
private readonly store = new Map<string, Map<string, PresenceData>>()
private readonly handlers = new Map<string, ((e: PresenceEvent) => unknown)[]>()
private readonly ttl: number
private readonly heartbeatMs: number
private readonly onError: (error: unknown) => void
private beat?: ReturnType<typeof setInterval>

constructor(sock: PresenceSocket, options: PresenceOptions = {}) {
this.sock = sock
this.ttl = options.ttl ?? 30_000
this.heartbeatMs = options.heartbeat ?? 0
this.onError = options.onError ?? (error => console.error('[Presence]', error))
}

// ===== receive =====

/** start listening to other people's presence */
attach() {
this.sock.ev.on('presence.update', this.onUpdate)
if (this.heartbeatMs > 0) this.heartbeat(this.heartbeatMs)
return this
}

detach() {
this.sock.ev.off('presence.update', this.onUpdate)
this.heartbeat(0)
return this
}

on(name: PresenceEventName, fn: (e: PresenceEvent) => unknown) {
const list = this.handlers.get(name) ?? []
list.push(fn)
this.handlers.set(name, list)
return this
}

private emit(name: string, e: PresenceEvent) {
for (const fn of this.handlers.get(name) ?? []) {
try {
Promise.resolve(fn(e)).catch(this.onError)
} catch (error) {
this.onError(error)
}
}
}

private readonly onUpdate = ({
id,
presences
}: {
id: string
presences: Record<string, { lastKnownPresence?: PresenceType; lastSeen?: number }>
}) => {
let chat = this.store.get(id)
if (!chat) this.store.set(id, (chat = new Map()))
for (const [jid, p] of Object.entries(presences || {})) {
if (!p.lastKnownPresence) continue
const data: PresenceData = { presence: p.lastKnownPresence, lastSeen: p.lastSeen, at: Date.now() }
chat.set(jid, data)
const e: PresenceEvent = { chat: id, jid, number: userNum(jid), isGroup: id.endsWith('@g.us'), ...data }
this.emit('update', e)
this.emit(data.presence, e)
}
}

/** last known presence of `jid` in `chat` (for private chats both are the same) */
get(chat: string, jid = chat) {
return this.store.get(chat)?.get(jid)
}

private fresh(d: PresenceData | undefined): d is PresenceData {
return !!d && Date.now() - d.at < this.ttl
}

isOnline(chat: string, jid = chat) {
const d = this.get(chat, jid)
return this.fresh(d) && d.presence !== 'unavailable'
}

isTyping(chat: string, jid = chat) {
const d = this.get(chat, jid)
return this.fresh(d) && d.presence === 'composing'
}

isRecording(chat: string, jid = chat) {
const d = this.get(chat, jid)
return this.fresh(d) && d.presence === 'recording'
}

lastSeen(chat: string, jid = chat) {
return this.get(chat, jid)?.lastSeen
}

// ===== send =====

subscribe(jid: string) {
return this.sock.presenceSubscribe(jid)
}

set(type: PresenceType, jid?: string) {
return this.sock.sendPresenceUpdate(type, jid)
}

online() {
return this.set('available')
}

offline() {
return this.set('unavailable')
}

async typing(jid: string) {
await this.subscribe(jid)
return this.set('composing', jid)
}

async recording(jid: string) {
await this.subscribe(jid)
return this.set('recording', jid)
}

paused(jid: string) {
return this.set('paused', jid)
}

/** pretend to type / record for `ms`, then pause */
async simulate(jid: string, ms = 1000, type: 'composing' | 'recording' = 'composing') {
await this.subscribe(jid)
await this.set(type, jid)
await sleep(ms)
await this.paused(jid)
}

/** show typing / recording while `fn` runs (refreshed every 8s), then pause */
async wrap<T>(jid: string, fn: () => Promise<T> | T, type: 'composing' | 'recording' = 'composing') {
await this.subscribe(jid)
await this.set(type, jid)
const timer = setInterval(() => void this.set(type, jid).catch(() => {}), 8000)
try {
return await fn()
} finally {
clearInterval(timer)
await this.paused(jid).catch(() => {})
}
}

/** send 'available' every `ms`. 0 = stop */
heartbeat(ms: number) {
clearInterval(this.beat)
this.beat = undefined
if (ms > 0) this.beat = setInterval(() => void this.online().catch(() => {}), ms)
return this
}
}
