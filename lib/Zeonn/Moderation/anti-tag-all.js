// Patch@Zeonn: AntiTagAll — detects mass mentions ("tag all") in groups. Deletes the message, warns and / or kicks repeat offenders.
import { findMember, GroupCache, isAdminMember } from '../common.js';
const userPart = (jid) => {
    if (!jid)
        return '';
    const raw = jid.includes('@') ? jid.split('@')[0].split(':')[0] : jid;
    return raw.replace(/[^0-9a-zA-Z]/g, '');
};
const toSeconds = (v) => typeof v === 'number' ? v : v && typeof v.toNumber === 'function' ? v.toNumber() : 0;
const collect = (node, out, depth) => {
    if (!node || typeof node !== 'object' || depth > 6)
        return;
    const list = node.contextInfo?.mentionedJid;
    if (Array.isArray(list))
        for (const j of list)
            if (typeof j === 'string' && j)
                out.add(userPart(j));
    for (const [key, value] of Object.entries(node)) {
        // a reply carries the quoted message, whose mentions are not the sender's
        if (key === 'contextInfo' || key === 'quotedMessage')
            continue;
        if (value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value))
            collect(value, out, depth + 1);
    }
};
/** unique numbers mentioned in a message (mentions inside a quoted message are not counted) */
export const getMentionedNumbers = (message) => {
    const out = new Set();
    collect(message, out, 0);
    return [...out];
};
export class AntiTagAll {
    constructor(sock, options = {}) {
        this.running = false;
        this.strikes = new Map();
        this.listener = (arg) => {
            if (arg.type !== 'notify')
                return;
            for (const msg of arg.messages) {
                void this.handle(msg).catch(error => this.options.logger?.warn({ error }, 'antitagall failed'));
            }
        };
        this.sock = sock;
        this.options = options;
        this.groups = (options.groups ?? new GroupCache()).bind(sock);
        this.allowed = new Set((options.allow ?? []).map(userPart).filter(Boolean));
    }
    get isRunning() {
        return this.running;
    }
    /** listen to incoming messages and act automatically */
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
    now() {
        return this.options.now ? this.options.now() : Date.now();
    }
    /** pure decision, sends nothing. `groupSize` enables the ratio rule */
    check(msg, groupSize) {
        const { maxMentions = 15, maxRatio = 0.5, minMentions = 5, maxAgeSeconds = 30 } = this.options;
        const chat = msg.key.remoteJid || '';
        const sender = msg.key.participant || msg.key.participantAlt || '';
        const none = { flagged: false, mentions: 0, sender };
        if (!chat.endsWith('@g.us') || msg.key.fromMe || !msg.message)
            return none;
        const ts = toSeconds(msg.messageTimestamp);
        if (ts && maxAgeSeconds > 0 && this.now() / 1000 - ts > maxAgeSeconds)
            return none;
        if ([msg.key.participant, msg.key.participantAlt].some(j => this.allowed.has(userPart(j)) && userPart(j)))
            return none;
        const mentions = getMentionedNumbers(msg.message).length;
        let reason;
        if (maxMentions > 0 && mentions >= maxMentions)
            reason = 'mentions';
        else if (maxRatio > 0 && groupSize && mentions >= minMentions && mentions / groupSize >= maxRatio)
            reason = 'ratio';
        return { flagged: !!reason, reason, mentions, sender };
    }
    /** check() + side effects (delete / warn / kick). Used by start() */
    async handle(msg) {
        const { maxMentions = 15, maxRatio = 0.5, minMentions = 5 } = this.options;
        const count = getMentionedNumbers(msg.message).length;
        const threshold = Math.min(maxMentions > 0 ? maxMentions : Infinity, maxRatio > 0 ? minMentions : Infinity);
        if (count < threshold)
            return { flagged: false, mentions: count, sender: msg.key.participant || '' };
        const chat = msg.key.remoteJid || '';
        const meta = chat.endsWith('@g.us') ? await this.groups.get(chat) : undefined;
        const verdict = this.check(msg, meta?.participants?.length);
        if (!verdict.flagged || !verdict.sender)
            return verdict;
        if (this.options.allowAdmins !== false) {
            const member = findMember(meta, [msg.key.participant ?? undefined, msg.key.participantAlt ?? undefined]);
            if (isAdminMember(member))
                return { ...verdict, flagged: false };
        }
        const sender = verdict.sender;
        const strikes = this.addStrike(chat, sender);
        verdict.strikes = strikes;
        this.options.logger?.info({ chat, sender, mentions: verdict.mentions, strikes }, 'antitagall: tag-all detected');
        try {
            this.options.onViolation?.({ sender, chat, mentions: verdict.mentions, strikes });
        }
        catch (error) {
            this.options.logger?.warn({ error }, 'antitagall: onViolation threw');
        }
        const actions = this.options.actions ?? ['delete', 'warn'];
        if (actions.includes('delete'))
            await this.safe('delete', () => this.sock.sendMessage(chat, { delete: msg.key }));
        if (actions.includes('warn')) {
            const { warning } = this.options;
            const text = warning === undefined
                ? `@${userPart(sender)} dilarang mention massal (${verdict.mentions} mention).`
                : typeof warning === 'function'
                    ? warning(sender, verdict.mentions)
                    : warning;
            if (text)
                await this.safe('warn', () => this.sock.sendMessage(chat, { text, mentions: [sender] }));
        }
        if (actions.includes('kick') && strikes >= (this.options.kickAfter ?? 3)) {
            await this.safe('kick', () => this.sock.groupParticipantsUpdate(chat, [sender], 'remove'));
            this.strikes.delete(`${chat}:${userPart(sender)}`);
        }
        return verdict;
    }
    addStrike(chat, sender) {
        const now = this.now();
        const ttl = this.options.strikeTtlMs ?? 3600000;
        const key = `${chat}:${userPart(sender)}`;
        const old = this.strikes.get(key);
        const count = old && now - old.at < ttl ? old.count + 1 : 1;
        this.strikes.set(key, { count, at: now });
        if (this.strikes.size > 2000) {
            for (const [k, v] of this.strikes)
                if (now - v.at >= ttl)
                    this.strikes.delete(k);
        }
        return count;
    }
    async safe(what, fn) {
        try {
            await fn();
        }
        catch (error) {
            this.options.logger?.warn({ error }, `antitagall: ${what} failed`);
        }
    }
}
//# sourceMappingURL=anti-tag-all.js.map