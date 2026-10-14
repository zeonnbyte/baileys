// Patch@Zeonn: AutoStatus — views (and optionally reacts to) status updates, one at a time with random human-like delays.
import { normJid, sleep as realSleep } from '../common.js';
const userPart = (jid) => {
    if (!jid)
        return '';
    const raw = jid.includes('@') ? jid.split('@')[0].split(':')[0] : jid;
    return raw.replace(/[^0-9a-zA-Z]/g, '');
};
const toSeconds = (v) => typeof v === 'number' ? v : v && typeof v.toNumber === 'function' ? v.toNumber() : 0;
export const getStatusKind = (message) => {
    if (!message)
        return 'other';
    if (message.imageMessage)
        return 'image';
    if (message.videoMessage)
        return 'video';
    if (message.audioMessage)
        return 'audio';
    if (message.conversation || message.extendedTextMessage)
        return 'text';
    return 'other';
};
export class AutoStatus {
    constructor(sock, options = {}) {
        this.running = false;
        this.chain = Promise.resolve();
        this.seen = new Set();
        this.listener = (arg) => {
            if (arg.type !== 'notify')
                return;
            for (const msg of arg.messages) {
                if (msg.key.remoteJid !== 'status@broadcast')
                    continue;
                void this.handle(msg).catch(error => this.options.logger?.warn({ error }, 'autostatus failed'));
            }
        };
        this.sock = sock;
        this.options = options;
        this.only = new Set((options.only ?? []).map(userPart).filter(Boolean));
        this.ignore = new Set((options.ignore ?? []).map(userPart).filter(Boolean));
    }
    get isRunning() {
        return this.running;
    }
    /** listen to incoming statuses and act automatically */
    start() {
        if (!this.running) {
            this.sock.ev.on('messages.upsert', this.listener);
            this.running = true;
        }
        return this;
    }
    stop() {
        if (this.running) {
            this.sock.ev.off('messages.upsert', this.listener);
            this.running = false;
        }
        return this;
    }
    /** handle one status. Calls are queued, so statuses are processed one at a time */
    handle(msg) {
        const run = this.chain.then(() => this.process(msg));
        this.chain = run.catch(() => undefined);
        return run;
    }
    random() {
        return this.options.random ? this.options.random() : Math.random();
    }
    sleep(ms) {
        return this.options.sleep ? this.options.sleep(ms) : realSleep(ms);
    }
    now() {
        return this.options.now ? this.options.now() : Date.now();
    }
    async process(msg) {
        const o = this.options;
        const { key } = msg;
        const skip = (reason) => ({ handled: false, viewed: false, reason });
        if (key.remoteJid !== 'status@broadcast')
            return skip('not a status');
        if (key.fromMe)
            return skip('own status');
        const sender = key.participant || key.participantAlt || '';
        if (!sender || !key.id)
            return skip('no sender');
        const content = msg.message;
        if (!content || content.protocolMessage || content.senderKeyDistributionMessage)
            return skip('no content');
        const nums = [key.participant, key.participantAlt].filter((x) => !!x).map(userPart);
        if (this.only.size && !nums.some(n => this.only.has(n)))
            return skip('not in only');
        if (nums.some(n => this.ignore.has(n)))
            return skip('ignored');
        const kind = getStatusKind(content);
        if (o.kinds?.length && !o.kinds.includes(kind))
            return skip('kind');
        const ts = toSeconds(msg.messageTimestamp);
        const maxAge = o.maxAgeSeconds ?? 0;
        if (ts && maxAge > 0 && this.now() / 1000 - ts > maxAge)
            return skip('too old');
        if (this.seen.has(key.id))
            return skip('duplicate');
        this.seen.add(key.id);
        if (this.seen.size > 2000)
            this.seen.delete(this.seen.values().next().value);
        const [min, max] = o.delay ?? [2000, 8000];
        await this.sleep(Math.max(0, min + this.random() * Math.max(0, max - min)));
        let viewed = false;
        if (o.view !== false) {
            try {
                await this.sock.readMessages([key]);
                viewed = true;
            }
            catch (error) {
                o.logger?.warn({ error, sender }, 'autostatus: view failed');
            }
        }
        let reaction;
        const emojis = o.react ? [].concat(o.react).filter(Boolean) : [];
        if (emojis.length && this.random() < (o.reactChance ?? 1)) {
            const emoji = emojis[Math.min(emojis.length - 1, Math.floor(this.random() * emojis.length))];
            try {
                const me = normJid(this.sock.user?.id);
                await this.sock.sendMessage('status@broadcast', { react: { text: emoji, key } }, { statusJidList: [sender, me].filter(Boolean) });
                reaction = emoji;
            }
            catch (error) {
                o.logger?.warn({ error, sender }, 'autostatus: react failed');
            }
        }
        try {
            o.onStatus?.({ sender, kind, viewed, reaction });
        }
        catch (error) {
            o.logger?.warn({ error }, 'autostatus: onStatus threw');
        }
        return { handled: true, viewed, reaction };
    }
}
//# sourceMappingURL=auto-status.js.map