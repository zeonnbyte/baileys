// Patch@Zeonn: Presence — send typing / recording / online / offline and track other people's presence.
import { sleep, userNum } from '../common.js';
export class Presence {
    constructor(sock, options = {}) {
        this.store = new Map();
        this.handlers = new Map();
        this.onUpdate = ({ id, presences }) => {
            let chat = this.store.get(id);
            if (!chat)
                this.store.set(id, (chat = new Map()));
            for (const [jid, p] of Object.entries(presences || {})) {
                if (!p.lastKnownPresence)
                    continue;
                const data = { presence: p.lastKnownPresence, lastSeen: p.lastSeen, at: Date.now() };
                chat.set(jid, data);
                const e = { chat: id, jid, number: userNum(jid), isGroup: id.endsWith('@g.us'), ...data };
                this.emit('update', e);
                this.emit(data.presence, e);
            }
        };
        this.sock = sock;
        this.ttl = options.ttl ?? 30000;
        this.heartbeatMs = options.heartbeat ?? 0;
        this.onError = options.onError ?? (error => console.error('[Presence]', error));
    }
    // ===== receive =====
    /** start listening to other people's presence */
    attach() {
        this.sock.ev.on('presence.update', this.onUpdate);
        if (this.heartbeatMs > 0)
            this.heartbeat(this.heartbeatMs);
        return this;
    }
    detach() {
        this.sock.ev.off('presence.update', this.onUpdate);
        this.heartbeat(0);
        return this;
    }
    on(name, fn) {
        const list = this.handlers.get(name) ?? [];
        list.push(fn);
        this.handlers.set(name, list);
        return this;
    }
    emit(name, e) {
        for (const fn of this.handlers.get(name) ?? []) {
            try {
                Promise.resolve(fn(e)).catch(this.onError);
            }
            catch (error) {
                this.onError(error);
            }
        }
    }
    /** last known presence of `jid` in `chat` (for private chats both are the same) */
    get(chat, jid = chat) {
        return this.store.get(chat)?.get(jid);
    }
    fresh(d) {
        return !!d && Date.now() - d.at < this.ttl;
    }
    isOnline(chat, jid = chat) {
        const d = this.get(chat, jid);
        return this.fresh(d) && d.presence !== 'unavailable';
    }
    isTyping(chat, jid = chat) {
        const d = this.get(chat, jid);
        return this.fresh(d) && d.presence === 'composing';
    }
    isRecording(chat, jid = chat) {
        const d = this.get(chat, jid);
        return this.fresh(d) && d.presence === 'recording';
    }
    lastSeen(chat, jid = chat) {
        return this.get(chat, jid)?.lastSeen;
    }
    // ===== send =====
    subscribe(jid) {
        return this.sock.presenceSubscribe(jid);
    }
    set(type, jid) {
        return this.sock.sendPresenceUpdate(type, jid);
    }
    online() {
        return this.set('available');
    }
    offline() {
        return this.set('unavailable');
    }
    async typing(jid) {
        await this.subscribe(jid);
        return this.set('composing', jid);
    }
    async recording(jid) {
        await this.subscribe(jid);
        return this.set('recording', jid);
    }
    paused(jid) {
        return this.set('paused', jid);
    }
    /** pretend to type / record for `ms`, then pause */
    async simulate(jid, ms = 1000, type = 'composing') {
        await this.subscribe(jid);
        await this.set(type, jid);
        await sleep(ms);
        await this.paused(jid);
    }
    /** show typing / recording while `fn` runs (refreshed every 8s), then pause */
    async wrap(jid, fn, type = 'composing') {
        await this.subscribe(jid);
        await this.set(type, jid);
        const timer = setInterval(() => void this.set(type, jid).catch(() => { }), 8000);
        try {
            return await fn();
        }
        finally {
            clearInterval(timer);
            await this.paused(jid).catch(() => { });
        }
    }
    /** send 'available' every `ms`. 0 = stop */
    heartbeat(ms) {
        clearInterval(this.beat);
        this.beat = undefined;
        if (ms > 0)
            this.beat = setInterval(() => void this.online().catch(() => { }), ms);
        return this;
    }
}
//# sourceMappingURL=presence.js.map