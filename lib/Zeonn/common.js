// Patch@Zeonn: shared helpers for Reconnect / Presence / OnMessage / OnGroup.
import { isLidUser, jidNormalizedUser } from '../WABinary/index.js';
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** "628123:5@s.whatsapp.net" -> "628123" */
export const userNum = (jid) => (jid || '').split('@')[0].split(':')[0];
export const normJid = (jid) => (jid ? jidNormalizedUser(jid) : '');
/** every number a participant is known by (id / lid / phoneNumber) */
export const memberNums = (p) => {
    const list = typeof p === 'string' ? [p] : [p.id, p.lid, p.phoneNumber];
    return list.filter((x) => !!x).map(userNum);
};
/** LID -> phone number JID. Returns the original JID when it cannot be resolved */
export const toPn = async (sock, jid) => {
    if (!jid)
        return '';
    const j = normJid(jid);
    if (!isLidUser(j))
        return j;
    try {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID(j);
        return pn ? normJid(pn) : j;
    }
    catch {
        return j;
    }
};
export const findMember = (meta, jids) => {
    const want = new Set(jids.filter((x) => !!x).map(userNum));
    return meta?.participants?.find(p => memberNums(p).some(n => want.has(n)));
};
export const isAdminMember = (p) => !!p && typeof p !== 'string' && (p.admin === 'admin' || p.admin === 'superadmin' || !!p.isAdmin || !!p.isSuperAdmin);
export const botJids = (sock) => [sock.user?.id, sock.user?.lid];
/**
 * Group metadata cache shared by OnMessage and OnGroup.
 * Also usable as `cachedGroupMetadata: async jid => cache.peek(jid)` in the socket config.
 */
export class GroupCache {
    constructor(ttl = 60000) {
        this.map = new Map();
        this.ttl = ttl;
    }
    bind(sock) {
        this.sock = sock;
        return this;
    }
    /** cached value only, never fetches */
    peek(jid) {
        return this.map.get(jid)?.meta;
    }
    async get(jid, force = false) {
        const cached = this.map.get(jid);
        if (!force && cached && Date.now() - cached.at < this.ttl)
            return cached.meta;
        try {
            const meta = await this.sock?.groupMetadata(jid);
            if (meta)
                this.map.set(jid, { meta, at: Date.now() });
            return meta ?? cached?.meta;
        }
        catch {
            return cached?.meta;
        }
    }
    set(jid, meta) {
        this.map.set(jid, { meta, at: Date.now() });
        return this;
    }
    drop(jid) {
        this.map.delete(jid);
        return this;
    }
}
//# sourceMappingURL=common.js.map