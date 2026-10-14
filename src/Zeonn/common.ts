// Patch@Zeonn: shared helpers for Reconnect / Presence / OnMessage / OnGroup.

import { isLidUser, jidNormalizedUser } from '../WABinary'

export type AnyEvents = {
on: (event: any, listener: any) => any
off: (event: any, listener: any) => any
}

export type Member =
| string
| { id: string; lid?: string; phoneNumber?: string; admin?: string | null; isAdmin?: boolean; isSuperAdmin?: boolean }

export type GroupMetaLike = { subject?: string; participants?: Exclude<Member, string>[]; [key: string]: any }

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** "628123:5@s.whatsapp.net" -> "628123" */
export const userNum = (jid: string | undefined | null) => (jid || '').split('@')[0]!.split(':')[0]!

export const normJid = (jid: string | undefined | null) => (jid ? jidNormalizedUser(jid) : '')

/** every number a participant is known by (id / lid / phoneNumber) */
export const memberNums = (p: Member) => {
const list: (string | undefined)[] = typeof p === 'string' ? [p] : [p.id, p.lid, p.phoneNumber]
return list.filter((x): x is string => !!x).map(userNum)
}

/** LID -> phone number JID. Returns the original JID when it cannot be resolved */
export const toPn = async (sock: { signalRepository?: any }, jid: string | undefined | null) => {
if (!jid) return ''
const j = normJid(jid)
if (!isLidUser(j)) return j
try {
const pn: string | null | undefined = await sock.signalRepository?.lidMapping?.getPNForLID(j)
return pn ? normJid(pn) : j
} catch {
return j
}
}

export const findMember = (meta: GroupMetaLike | null | undefined, jids: (string | undefined)[]) => {
const want = new Set(jids.filter((x): x is string => !!x).map(userNum))
return meta?.participants?.find(p => memberNums(p).some(n => want.has(n)))
}

export const isAdminMember = (p: Member | undefined) =>
!!p && typeof p !== 'string' && (p.admin === 'admin' || p.admin === 'superadmin' || !!p.isAdmin || !!p.isSuperAdmin)

export const botJids = (sock: { user?: { id?: string; lid?: string } }) => [sock.user?.id, sock.user?.lid]

/**
 * Group metadata cache shared by OnMessage and OnGroup.
 * Also usable as `cachedGroupMetadata: async jid => cache.peek(jid)` in the socket config.
 */
export class GroupCache {
private readonly map = new Map<string, { meta: GroupMetaLike; at: number }>()
private readonly ttl: number
private sock?: { groupMetadata(jid: string): Promise<any> }

constructor(ttl = 60_000) {
this.ttl = ttl
}

bind(sock: { groupMetadata(jid: string): Promise<any> }) {
this.sock = sock
return this
}

/** cached value only, never fetches */
peek(jid: string): GroupMetaLike | undefined {
return this.map.get(jid)?.meta
}

async get(jid: string, force = false): Promise<GroupMetaLike | undefined> {
const cached = this.map.get(jid)
if (!force && cached && Date.now() - cached.at < this.ttl) return cached.meta
try {
const meta: GroupMetaLike | undefined = await this.sock?.groupMetadata(jid)
if (meta) this.map.set(jid, { meta, at: Date.now() })
return meta ?? cached?.meta
} catch {
return cached?.meta
}
}

set(jid: string, meta: GroupMetaLike) {
this.map.set(jid, { meta, at: Date.now() })
return this
}

drop(jid: string) {
this.map.delete(jid)
return this
}
}
