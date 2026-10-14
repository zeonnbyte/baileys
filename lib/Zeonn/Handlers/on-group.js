// Patch@Zeonn: OnGroup — group events: join / leave / kick / promote / demote, info changes, new groups, join requests.
import { isLidUser } from '../../WABinary/index.js';
import { botJids, GroupCache, toPn, userNum } from '../common.js';
const DEFAULT_TEMPLATES = {
    join: 'Welcome {tag} di {subject}',
    leave: 'Bye {tag}',
    kick: '{tag} dikeluarkan oleh {author}',
    promote: '{tag} jadi admin',
    demote: '{tag} bukan admin lagi'
};
// groups.update field -> event name
const CHANGES = {
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
};
const BOT_EVENT = {
    join: 'botJoin',
    leave: 'botLeave',
    kick: 'botLeave',
    promote: 'botPromote',
    demote: 'botDemote'
};
export class OnGroup {
    constructor(sock, options = {}) {
        this.handlers = new Map();
        // ===== member join / leave / kick / promote / demote =====
        this.onParticipants = async ({ id, author, authorPn, participants, action }) => {
            try {
                this.groups.drop(id);
                const meta = await this.groups.get(id, true);
                const bot = botJids(this.sock).map(userNum);
                this.emit('participants', { sock: this.sock, id, action, participants, author, authorPn, meta });
                for (const p of participants) {
                    const jid = typeof p === 'string' ? p : p.id;
                    const pn = (typeof p === 'object' && p.phoneNumber) || (await toPn(this.sock, jid));
                    const self = !!author && (userNum(author) === userNum(jid) || (!!authorPn && userNum(authorPn) === userNum(pn)));
                    const event = action === 'add' ? 'join' : action === 'remove' ? (self ? 'leave' : 'kick') : action;
                    const mentions = [jid, ...(author && !self ? [author] : [])];
                    const ctx = {
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
                    };
                    this.emit(event, ctx);
                    const botEvent = BOT_EVENT[event];
                    if (ctx.isBot && botEvent)
                        this.emit(botEvent, ctx);
                    if (!ctx.isBot)
                        await this.greet(ctx);
                }
            }
            catch (error) {
                this.onError(error);
            }
        };
        // ===== group info changed =====
        this.onUpdate = (updates) => {
            try {
                for (const u of updates) {
                    if (!u.id)
                        continue;
                    this.groups.drop(u.id);
                    const base = {
                        sock: this.sock,
                        id: u.id,
                        update: u,
                        author: u.author,
                        authorPn: u.authorPn,
                        send: this.sender(u.id)
                    };
                    for (const [field, event] of Object.entries(CHANGES)) {
                        if (u[field] !== undefined)
                            this.emit(event, { ...base, value: u[field] });
                    }
                    this.emit('update', base);
                }
            }
            catch (error) {
                this.onError(error);
            }
        };
        // ===== new group (bot added / group created) =====
        this.onUpsert = (list) => {
            for (const meta of list) {
                const id = String(meta.id);
                this.groups.set(id, meta);
                this.emit('create', { sock: this.sock, id, meta, send: this.sender(id) });
            }
        };
        // ===== join request =====
        this.onRequest = (r) => {
            const act = (action) => () => this.sock.groupRequestParticipantsUpdate(r.id, [r.participant], action);
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
            });
        };
        this.sock = sock;
        this.groups = (options.groups ?? new GroupCache()).bind(sock);
        this.templates = options.templates === true ? { ...DEFAULT_TEMPLATES } : options.templates || null;
        this.enabled = options.enabled ?? (() => true);
        this.onError = options.onError ?? (error => console.error('[OnGroup]', error));
    }
    on(name, fn) {
        const list = this.handlers.get(name) ?? [];
        list.push(fn);
        this.handlers.set(name, list);
        return this;
    }
    attach() {
        const ev = this.sock.ev;
        ev.on('group-participants.update', this.onParticipants);
        ev.on('groups.update', this.onUpdate);
        ev.on('groups.upsert', this.onUpsert);
        ev.on('group.join-request', this.onRequest);
        return this;
    }
    detach() {
        const ev = this.sock.ev;
        ev.off('group-participants.update', this.onParticipants);
        ev.off('groups.update', this.onUpdate);
        ev.off('groups.upsert', this.onUpsert);
        ev.off('group.join-request', this.onRequest);
        return this;
    }
    /** cached group metadata */
    meta(id, force = false) {
        return this.groups.get(id, force);
    }
    emit(name, ctx) {
        for (const fn of this.handlers.get(name) ?? []) {
            try {
                Promise.resolve(fn(ctx)).catch(error => this.onError(error, ctx));
            }
            catch (error) {
                this.onError(error, ctx);
            }
        }
    }
    sender(id, mentions = []) {
        return (content, options) => this.sock.sendMessage(id, typeof content === 'string' ? { text: content, mentions } : content, options);
    }
    async greet(ctx) {
        const template = this.templates?.[ctx.event];
        if (!template || !(await this.enabled(ctx.id, ctx.event)))
            return;
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
            .join(ctx.authorTag || 'admin');
        await ctx.send(text);
    }
}
//# sourceMappingURL=on-group.js.map