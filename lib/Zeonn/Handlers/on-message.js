// Patch@Zeonn: OnMessage — full message handler: parser, commands, guards, middleware, events.
import { isLidUser } from '../../WABinary/index.js';
import { downloadMediaMessage, getContentType, normalizeMessageContent } from '../../Utils/messages.js';
import { botJids, findMember, GroupCache, isAdminMember, normJid, toPn, userNum } from '../common.js';
const MEDIA = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'ptvMessage']);
const SKIP = new Set(['protocolMessage', 'senderKeyDistributionMessage']);
const nativeId = (json) => {
    try {
        return String(JSON.parse(String(json))?.id ?? '');
    }
    catch {
        return '';
    }
};
/** text of a message: text, caption, button / list / native-flow replies */
export const getCommandText = (content, type) => {
    if (!content)
        return '';
    const x = type ? content[type] : undefined;
    const text = content.conversation ||
        x?.text ||
        x?.caption ||
        x?.selectedButtonId ||
        x?.selectedId ||
        x?.singleSelectReply?.selectedRowId ||
        nativeId(x?.nativeFlowResponseMessage?.paramsJson);
    return typeof text === 'string' ? text : '';
};
export class OnMessage {
    constructor(sock, options = {}) {
        this.handlers = new Map();
        this.middleware = [];
        this.seen = new Set();
        this.cooldowns = new Map();
        this.commands = new Map();
        this.onUpsert = ({ messages, type }) => {
            if (type !== 'notify')
                return;
            for (const m of messages)
                void this.handle(m).catch(error => this.onError(error));
        };
        this.onReaction = (list) => {
            for (const { key, reaction } of list) {
                this.emit('reaction', {
                    sock: this.sock,
                    key,
                    from: key.remoteJid || '',
                    text: reaction.text || '',
                    remove: !reaction.text,
                    sender: normJid(reaction.key?.participant || reaction.key?.remoteJid)
                });
            }
        };
        this.onDelete = (data) => this.emit('delete', { sock: this.sock, ...data });
        this.sock = sock;
        this.prefixes = options.prefixes ?? ['.', '/', '!', '#'];
        this.noPrefix = options.noPrefix ?? false;
        this.owners = (options.owners ?? []).map(userNum);
        this.autoRead = options.autoRead ?? true;
        this.ignoreSelf = options.ignoreSelf ?? true;
        this.maxAge = options.maxAge ?? 120;
        this.presence = options.presence ?? null;
        this.groups = (options.groups ?? new GroupCache()).bind(sock);
        this.texts = {
            group: 'Khusus grup.',
            private: 'Khusus chat pribadi.',
            owner: 'Khusus owner.',
            admin: 'Khusus admin grup.',
            botAdmin: 'Bot harus jadi admin.',
            cooldown: seconds => `Tunggu ${seconds} detik.`,
            ...options.messages
        };
        this.onError = options.onError ?? (error => console.error('[OnMessage]', error));
    }
    // ===== API =====
    /** register a command. `names` can be one name or several (aliases) */
    command(names, run, options = {}) {
        const list = [].concat(names).map(n => n.toLowerCase());
        const entry = { ...options, names: list, run };
        for (const name of list)
            this.commands.set(name, entry);
        return this;
    }
    /** middleware runs before every command / text. Call next() to continue */
    use(fn) {
        this.middleware.push(fn);
        return this;
    }
    on(name, fn) {
        const list = this.handlers.get(name) ?? [];
        list.push(fn);
        this.handlers.set(name, list);
        return this;
    }
    attach() {
        this.sock.ev.on('messages.upsert', this.onUpsert);
        this.sock.ev.on('messages.reaction', this.onReaction);
        this.sock.ev.on('messages.delete', this.onDelete);
        return this;
    }
    detach() {
        this.sock.ev.off('messages.upsert', this.onUpsert);
        this.sock.ev.off('messages.reaction', this.onReaction);
        this.sock.ev.off('messages.delete', this.onDelete);
        return this;
    }
    // ===== internal =====
    emit(name, arg) {
        for (const fn of this.handlers.get(name) ?? []) {
            try {
                Promise.resolve(fn(arg)).catch(error => this.onError(error, arg));
            }
            catch (error) {
                this.onError(error, arg);
            }
        }
    }
    async handle(m) {
        const sock = this.sock;
        const key = m.key;
        if (!m.message || !key?.id)
            return;
        const from = key.remoteJid;
        if (!from || from === 'status@broadcast' || from.endsWith('@newsletter'))
            return;
        if (key.fromMe && this.ignoreSelf)
            return;
        const ts = typeof m.messageTimestamp === 'number' ? m.messageTimestamp : m.messageTimestamp?.toNumber?.() || 0;
        if (this.maxAge && ts && Date.now() / 1000 - ts > this.maxAge)
            return;
        const sid = from + key.id;
        if (this.seen.has(sid))
            return;
        this.seen.add(sid);
        if (this.seen.size > 1000)
            this.seen.delete(this.seen.values().next().value);
        const content = normalizeMessageContent(m.message);
        const type = getContentType(content);
        if (!content || !type || SKIP.has(type))
            return;
        if (this.autoRead)
            sock.readMessages([key]).catch(() => { });
        // --- sender ---
        const isGroup = from.endsWith('@g.us');
        const sender = normJid(key.fromMe ? sock.user?.id : isGroup ? key.participant || m.participant : from);
        const alt = isGroup ? key.participantAlt : key.remoteJidAlt;
        const senderPn = isLidUser(sender) ? (alt ? normJid(alt) : await toPn(sock, sender)) : sender;
        const isOwner = !!key.fromMe || this.owners.includes(userNum(senderPn)) || this.owners.includes(userNum(sender));
        // --- text & command ---
        const x = content[type];
        const ci = x?.contextInfo;
        const text = getCommandText(content, type);
        const prefix = this.prefixes.find(p => text.startsWith(p)) ?? '';
        let cmd = '';
        let q = '';
        let args = [];
        if (text && (prefix || this.noPrefix)) {
            const body = text.slice(prefix.length).trim();
            cmd = (body.split(/\s+/)[0] || '').toLowerCase();
            q = body.slice(cmd.length).trim();
            args = q ? q.split(/\s+/) : [];
        }
        // --- quoted ---
        let quoted = null;
        if (ci?.quotedMessage) {
            const qm = normalizeMessageContent(ci.quotedMessage);
            const qt = getContentType(qm);
            const qs = ci.participant ? normJid(ci.participant) : undefined;
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
            };
        }
        const download = (msg) => downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage, logger: sock.logger });
        const toContent = (content) => (typeof content === 'string' ? { text: content } : content);
        const ctx = {
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
        };
        this.emit('message', ctx);
        let i = -1;
        const next = async () => {
            const fn = this.middleware[++i];
            return fn ? fn(ctx, next) : this.dispatch(ctx);
        };
        try {
            await next();
        }
        catch (error) {
            this.onError(error, ctx);
        }
    }
    async dispatch(ctx) {
        const entry = ctx.cmd ? this.commands.get(ctx.cmd) : undefined;
        if (!entry) {
            if (ctx.cmd && ctx.prefix)
                this.emit('unknown', ctx);
            if (ctx.text)
                this.emit('text', ctx);
            return;
        }
        const t = this.texts;
        if (entry.group && !ctx.isGroup)
            return ctx.reply(t.group);
        if (entry.private && ctx.isGroup)
            return ctx.reply(t.private);
        if (entry.owner && !ctx.isOwner)
            return ctx.reply(t.owner);
        if ((entry.admin || entry.botAdmin) && !ctx.isGroup)
            return ctx.reply(t.group);
        if (entry.admin && !ctx.isOwner && !(await ctx.isAdmin()))
            return ctx.reply(t.admin);
        if (entry.botAdmin && !(await ctx.isBotAdmin()))
            return ctx.reply(t.botAdmin);
        if (entry.cooldown && !ctx.isOwner) {
            const k = `${entry.names[0]}:${ctx.number}`;
            const now = Date.now();
            const left = (this.cooldowns.get(k) ?? 0) - now;
            if (left > 0)
                return ctx.reply(t.cooldown(Math.ceil(left / 1000)));
            this.cooldowns.set(k, now + entry.cooldown);
            if (this.cooldowns.size > 5000) {
                for (const [kk, until] of this.cooldowns)
                    if (until < now)
                        this.cooldowns.delete(kk);
            }
        }
        this.emit('command', ctx);
        await entry.run(ctx);
    }
}
//# sourceMappingURL=on-message.js.map