// Patch@Zeonn: AntiSpam — per-sender flood / repeat detection with temporary mute, warning and optional block.
const IGNORED_TYPES = new Set([
    'protocolMessage',
    'reactionMessage',
    'senderKeyDistributionMessage',
    'messageContextInfo',
    'pollUpdateMessage',
    'encReactionMessage'
]);
const userPart = (jid) => {
    if (!jid)
        return '';
    const raw = jid.includes('@') ? jid.split('@')[0].split(':')[0] : jid;
    return raw.replace(/[^0-9a-zA-Z]/g, '');
};
const toSeconds = (v) => typeof v === 'number' ? v : v && typeof v.toNumber === 'function' ? v.toNumber() : 0;
/** text of any message type: conversation, extended text, captions */
export const getSpamText = (message, depth = 0) => {
    if (!message || depth > 5)
        return '';
    if (typeof message.conversation === 'string')
        return message.conversation;
    for (const value of Object.values(message)) {
        if (!value || typeof value !== 'object')
            continue;
        const v = value;
        const text = v.text ?? v.caption;
        if (typeof text === 'string' && text)
            return text;
        if (v.message && typeof v.message === 'object') {
            const inner = getSpamText(v.message, depth + 1);
            if (inner)
                return inner;
        }
    }
    return '';
};
export class AntiSpam {
    /** `sock` is optional: without it AntiSpam only gives verdicts via check() and never sends or blocks anything */
    constructor(sock, options = {}) {
        this.running = false;
        this.states = new Map();
        this.checks = 0;
        this.listener = (arg) => {
            if (arg.type !== 'notify')
                return;
            for (const msg of arg.messages) {
                void this.handle(msg).catch(error => this.options.logger?.warn({ error }, 'antispam failed'));
            }
        };
        this.sock = sock;
        this.options = options;
        this.allowed = new Set((options.allow || []).map(userPart).filter(Boolean));
    }
    get isRunning() {
        return this.running;
    }
    /** listen to incoming messages and take action automatically (warn / block) */
    start() {
        if (!this.sock)
            throw new Error('AntiSpam.start() needs a socket');
        if (!this.running) {
            this.sock.ev.on('messages.upsert', this.listener);
            this.running = true;
        }
        return this;
    }
    stop() {
        if (this.running && this.sock) {
            this.sock.ev.off('messages.upsert', this.listener);
            this.running = false;
        }
        return this;
    }
    allow(jid) {
        const u = userPart(jid);
        if (u)
            this.allowed.add(u);
        return this;
    }
    disallow(jid) {
        this.allowed.delete(userPart(jid));
        return this;
    }
    /** is this sender currently muted? use it in your own message handler: `if (antispam.isMuted(sender)) return` */
    isMuted(jid) {
        const state = this.states.get(this.senderKey(jid));
        return !!state && state.mutedUntil > this.now();
    }
    /** lift a mute / forget a sender */
    reset(jid) {
        this.states.delete(this.senderKey(jid));
        return this;
    }
    now() {
        return this.options.now ? this.options.now() : Date.now();
    }
    senderKey(jid) {
        return userPart(jid);
    }
    /** decides whether this message is spam and records it. Pure decision: sends / blocks nothing */
    check(msg) {
        const { maxMessages = 5, windowMs = 10000, maxRepeats = 3, muteMs = 60000, maxAgeSeconds = 30 } = this.options;
        const chat = msg.key.remoteJid || '';
        const sender = msg.key.participant || chat;
        const now = this.now();
        if (msg.key.fromMe || !sender || chat === 'status@broadcast' || chat.endsWith('@newsletter'))
            return { spam: false };
        if (this.options.ignoreGroups && chat.endsWith('@g.us'))
            return { spam: false };
        if (!msg.message)
            return { spam: false };
        const types = Object.keys(msg.message);
        if (!types.length || types.every(t => IGNORED_TYPES.has(t)))
            return { spam: false };
        const ts = toSeconds(msg.messageTimestamp);
        if (ts && maxAgeSeconds > 0 && now / 1000 - ts > maxAgeSeconds)
            return { spam: false };
        const key = this.senderKey(sender);
        if (!key || this.allowed.has(key))
            return { spam: false };
        if (++this.checks % 500 === 0)
            this.cleanup(now, windowMs);
        let state = this.states.get(key);
        if (!state)
            this.states.set(key, (state = { hits: [], texts: [], mutedUntil: 0, strikes: 0 }));
        if (state.mutedUntil > now)
            return { spam: true, reason: 'muted', sender };
        state.hits = state.hits.filter(t => now - t <= windowMs);
        state.texts = state.texts.filter(x => now - x.at <= windowMs);
        state.hits.push(now);
        const text = getSpamText(msg.message).trim().toLowerCase();
        if (text)
            state.texts.push({ t: text, at: now });
        let reason;
        if (state.hits.length > maxMessages)
            reason = 'rate';
        else if (maxRepeats > 0 && text && state.texts.filter(x => x.t === text).length >= maxRepeats)
            reason = 'repeat';
        if (!reason)
            return { spam: false };
        state.mutedUntil = now + muteMs;
        state.strikes++;
        state.hits = [];
        state.texts = [];
        return { spam: true, reason, sender, justMuted: true };
    }
    /** check() + side effects (warning message, block, onSpam callback). Used by start() */
    async handle(msg) {
        const verdict = this.check(msg);
        if (!verdict.justMuted || !verdict.sender || !verdict.reason)
            return verdict;
        const chat = msg.key.remoteJid || verdict.sender;
        const strikes = this.states.get(this.senderKey(verdict.sender))?.strikes || 1;
        const { warning, blockAfter = 0 } = this.options;
        this.options.logger?.info({ sender: verdict.sender, reason: verdict.reason, strikes }, 'antispam: sender muted');
        try {
            this.options.onSpam?.({ sender: verdict.sender, chat, reason: verdict.reason, strikes });
        }
        catch (error) {
            this.options.logger?.warn({ error }, 'antispam: onSpam threw');
        }
        if (!this.sock)
            return verdict;
        const text = typeof warning === 'function' ? warning(verdict.sender, verdict.reason) : warning;
        if (text) {
            try {
                await this.sock.sendMessage(chat, { text }, { quoted: msg });
            }
            catch (error) {
                this.options.logger?.warn({ error, chat }, 'antispam: failed to send warning');
            }
        }
        if (blockAfter > 0 && strikes >= blockAfter) {
            try {
                await this.sock.updateBlockStatus(verdict.sender, 'block');
                this.options.logger?.info({ sender: verdict.sender, strikes }, 'antispam: sender blocked');
            }
            catch (error) {
                this.options.logger?.warn({ error, sender: verdict.sender }, 'antispam: failed to block sender');
            }
        }
        return verdict;
    }
    cleanup(now, windowMs) {
        for (const [key, state] of this.states) {
            const idle = state.mutedUntil <= now && state.hits.every(t => now - t > windowMs);
            if (idle && state.strikes === 0)
                this.states.delete(key);
        }
    }
}
//# sourceMappingURL=anti-spam.js.map