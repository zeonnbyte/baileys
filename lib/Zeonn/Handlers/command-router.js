// Patch@Zeonn: CommandRouter — command registry on top of OnMessage: metadata, categories, auto help menu,
// per-chat enable / disable, banned users and "did you mean" for unknown commands.
const GLOBAL = '*';
const DEFAULT_CATEGORY = 'Lainnya';
/** edit distance between two strings (swapping two neighbouring letters counts as one edit) */
export const levenshtein = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++)
        d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                v = Math.min(v, d[i - 2][j - 2] + 1);
            d[i][j] = v;
        }
    }
    return d[a.length][b.length];
};
const digits = (v) => ((v.split('@')[0] || '').split(':')[0] || '').replace(/\D/g, '');
export class CommandRouter {
    constructor(host, options = {}) {
        this.byName = new Map();
        this.disabled = new Map();
        this.banned = new Set();
        this.installed = false;
        this.active = false;
        this.guard = async (ctx, next) => {
            const info = this.active && ctx.cmd ? this.byName.get(ctx.cmd) : undefined;
            if (!info || ctx.isOwner)
                return next();
            if (this.banned.has(digits(ctx.number))) {
                const text = this.options.bannedMessage;
                if (text)
                    await ctx.reply(text);
                return;
            }
            if (this.isDisabled(info.name, ctx.from)) {
                const text = this.options.disabledMessage ?? 'Perintah ini sedang dimatikan.';
                if (text)
                    await ctx.reply(text);
                return;
            }
            return next();
        };
        this.onUnknown = async (ctx) => {
            if (!this.active || this.options.suggest === false || !ctx.cmd)
                return;
            const suggestion = this.closest(ctx.cmd);
            if (!suggestion)
                return;
            const text = this.options.suggestMessage
                ? this.options.suggestMessage(ctx.cmd, suggestion, ctx.prefix)
                : `Perintah tidak dikenal. Maksud kamu ${ctx.prefix}${suggestion}?`;
            await ctx.reply(text);
        };
        this.host = host;
        this.options = options;
    }
    // ===== registry =====
    /** register a command (goes to OnMessage) together with its help metadata */
    add(def) {
        const { name, run, description, usage, category, hidden, ...options } = def;
        const names = []
            .concat(name)
            .map(n => n.trim().toLowerCase())
            .filter(Boolean);
        if (!names.length)
            throw new Error('CommandRouter.add() needs a command name');
        const info = {
            ...options,
            name: names[0],
            aliases: names.slice(1),
            description,
            usage,
            category: category || DEFAULT_CATEGORY,
            hidden: !!hidden
        };
        for (const n of names)
            this.byName.set(n, info);
        this.host.command(names, run, options);
        return this;
    }
    /** a command registered through the router, by any of its names */
    get(name) {
        return this.byName.get(name.toLowerCase());
    }
    /** unique commands in registration order */
    list(includeHidden = false) {
        return [...new Set(this.byName.values())].filter(i => includeHidden || !i.hidden);
    }
    // ===== enable / disable / ban =====
    /** switch a command off everywhere, or only in `chat` */
    disable(name, chat = GLOBAL) {
        const info = this.get(name);
        if (!info)
            return false;
        const set = this.disabled.get(chat) ?? new Set();
        set.add(info.name);
        this.disabled.set(chat, set);
        return true;
    }
    enable(name, chat = GLOBAL) {
        const info = this.get(name);
        if (!info)
            return false;
        return this.disabled.get(chat)?.delete(info.name) ?? false;
    }
    isDisabled(name, chat) {
        const main = this.get(name)?.name ?? name.toLowerCase();
        return !!this.disabled.get(GLOBAL)?.has(main) || (!!chat && !!this.disabled.get(chat)?.has(main));
    }
    /** banned numbers can't run any router command (owners are never blocked) */
    ban(number) {
        const n = digits(number);
        if (n)
            this.banned.add(n);
        return this;
    }
    unban(number) {
        this.banned.delete(digits(number));
        return this;
    }
    isBanned(number) {
        return this.banned.has(digits(number));
    }
    // ===== help / suggestions =====
    /** help menu text grouped by category */
    help(prefix = '.', opts = {}) {
        const groups = new Map();
        for (const i of this.list(opts.includeHidden)) {
            if (i.owner && !opts.owner)
                continue;
            if (this.isDisabled(i.name, opts.chat))
                continue;
            const line = `• ${prefix}${i.name}${i.usage ? ` ${i.usage}` : ''}${i.description ? ` — ${i.description}` : ''}`;
            const lines = groups.get(i.category) ?? [];
            lines.push(line);
            groups.set(i.category, lines);
        }
        const out = [`*${this.options.helpTitle ?? 'Daftar Perintah'}*`];
        for (const [category, lines] of groups)
            out.push('', `*${category}*`, ...lines);
        return out.join('\n');
    }
    /** closest visible command name to a mistyped one, if it is near enough */
    closest(cmd) {
        const limit = cmd.length <= 4 ? 1 : 2;
        let best;
        let bestDistance = limit + 1;
        for (const [name, info] of this.byName) {
            if (info.hidden)
                continue;
            const d = levenshtein(cmd, name);
            if (d > 0 && d < bestDistance) {
                best = name;
                bestDistance = d;
            }
        }
        return best;
    }
    // ===== wiring =====
    /** hook into OnMessage: disable / ban guard, "did you mean" and the help command */
    attach() {
        this.active = true;
        if (this.installed)
            return this;
        this.installed = true;
        this.host.use(this.guard);
        this.host.on('unknown', this.onUnknown);
        const wanted = this.options.help === false ? [] : (this.options.help ?? ['menu', 'help']);
        const names = wanted.filter(n => !this.byName.has(n.toLowerCase()));
        if (names.length) {
            this.add({
                name: names,
                description: 'Tampilkan daftar perintah',
                category: 'Info',
                run: ctx => ctx.reply(this.help(ctx.prefix || '.', { chat: ctx.from, owner: ctx.isOwner }))
            });
        }
        return this;
    }
    /** the guard and suggestions stop working (OnMessage has no way to remove middleware) */
    detach() {
        this.active = false;
        return this;
    }
}
//# sourceMappingURL=command-router.js.map