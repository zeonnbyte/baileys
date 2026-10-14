import type { CommandOptions, MessageContext } from './on-message.js';
export type CommandDef = CommandOptions & {
    /** one name, or a list: the first is the main name, the rest are aliases */
    name: string | string[];
    run: (ctx: MessageContext) => unknown;
    description?: string;
    /** shown after the name in the help menu, e.g. "<jumlah>" */
    usage?: string;
    /** help menu section (default: 'Lainnya') */
    category?: string;
    /** registered, but left out of the help menu */
    hidden?: boolean;
};
export type CommandInfo = CommandOptions & {
    name: string;
    aliases: string[];
    description?: string;
    usage?: string;
    category: string;
    hidden: boolean;
};
/** the part of OnMessage the router needs, so it can be unit-tested with a stub */
export type RouterHost = {
    command(names: string | string[], run: (ctx: MessageContext) => unknown, options?: CommandOptions): unknown;
    use(fn: (ctx: MessageContext, next: () => Promise<unknown>) => unknown): unknown;
    on(name: 'unknown', fn: (ctx: MessageContext) => unknown): unknown;
};
export type CommandRouterOptions = {
    /** reply when a disabled command is used. false = stay silent (default: 'Perintah ini sedang dimatikan.') */
    disabledMessage?: string | false;
    /** reply when a banned user uses a command. false / undefined = stay silent */
    bannedMessage?: string | false;
    /** suggest the closest command for unknown ones (default: true) */
    suggest?: boolean;
    suggestMessage?: (cmd: string, suggestion: string, prefix: string) => string;
    /** names of the built-in help command. false = don't register one (default: ['menu', 'help']) */
    help?: string[] | false;
    helpTitle?: string;
};
export type HelpOptions = {
    /** hide commands disabled in this chat */
    chat?: string;
    /** show owner-only commands */
    owner?: boolean;
    includeHidden?: boolean;
};
/** edit distance between two strings (swapping two neighbouring letters counts as one edit) */
export declare const levenshtein: (a: string, b: string) => number;
export declare class CommandRouter {
    private readonly host;
    private readonly options;
    private readonly byName;
    private readonly disabled;
    private readonly banned;
    private installed;
    private active;
    constructor(host: RouterHost, options?: CommandRouterOptions);
    /** register a command (goes to OnMessage) together with its help metadata */
    add(def: CommandDef): this;
    /** a command registered through the router, by any of its names */
    get(name: string): CommandInfo | undefined;
    /** unique commands in registration order */
    list(includeHidden?: boolean): CommandInfo[];
    /** switch a command off everywhere, or only in `chat` */
    disable(name: string, chat?: string): boolean;
    enable(name: string, chat?: string): boolean;
    isDisabled(name: string, chat?: string): boolean;
    /** banned numbers can't run any router command (owners are never blocked) */
    ban(number: string): this;
    unban(number: string): this;
    isBanned(number: string): boolean;
    /** help menu text grouped by category */
    help(prefix?: string, opts?: HelpOptions): string;
    /** closest visible command name to a mistyped one, if it is near enough */
    closest(cmd: string): string | undefined;
    /** hook into OnMessage: disable / ban guard, "did you mean" and the help command */
    attach(): this;
    /** the guard and suggestions stop working (OnMessage has no way to remove middleware) */
    detach(): this;
    private readonly guard;
    private readonly onUnknown;
}
//# sourceMappingURL=command-router.d.ts.map