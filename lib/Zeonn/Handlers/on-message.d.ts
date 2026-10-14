import { type AnyEvents, GroupCache, type GroupMetaLike } from '../common.js';
export type MessageKey = {
    id?: string | null;
    remoteJid?: string | null;
    fromMe?: boolean | null;
    participant?: string | null;
    participantAlt?: string | null;
    remoteJidAlt?: string | null;
};
export type IncomingMessage = {
    key: MessageKey;
    message?: Record<string, any> | null;
    messageTimestamp?: number | {
        toNumber(): number;
    } | null;
    pushName?: string | null;
    participant?: string | null;
};
export type QuotedMessage = {
    id?: string;
    sender?: string;
    key: MessageKey;
    message?: Record<string, any>;
    type?: string;
    text: string;
    isMedia: boolean;
};
export type MessageContext = {
    sock: OnMessageSocket;
    m: IncomingMessage;
    key: MessageKey;
    /** chat JID */
    from: string;
    isGroup: boolean;
    /** sender as WhatsApp gave it (can be @lid) */
    sender: string;
    /** sender as phone number JID when it can be resolved */
    senderPn: string;
    /** sender's phone number */
    number: string;
    pushName: string;
    /** content type: conversation, imageMessage, ... */
    type: string;
    text: string;
    prefix: string;
    /** command name, lower-case, without prefix */
    cmd: string;
    args: string[];
    /** everything after the command */
    q: string;
    quoted: QuotedMessage | null;
    mentions: string[];
    isMedia: boolean;
    isOwner: boolean;
    send(content: string | Record<string, any>, options?: Record<string, any>): Promise<unknown>;
    reply(content: string | Record<string, any>, options?: Record<string, any>): Promise<unknown>;
    react(emoji: string): Promise<unknown>;
    delete(): Promise<unknown>;
    download(): Promise<unknown>;
    downloadQuoted(): Promise<unknown>;
    typing(): Promise<unknown>;
    recording(): Promise<unknown>;
    paused(): Promise<unknown>;
    meta(): Promise<GroupMetaLike | undefined>;
    isAdmin(): Promise<boolean>;
    isBotAdmin(): Promise<boolean>;
};
export type CommandOptions = {
    /** only in groups */
    group?: boolean;
    /** only in private chats */
    private?: boolean;
    /** only owners */
    owner?: boolean;
    /** only group admins (owners bypass) */
    admin?: boolean;
    /** the bot must be a group admin */
    botAdmin?: boolean;
    /** per-user cooldown, ms */
    cooldown?: number;
};
export type CommandRun = (ctx: MessageContext) => unknown;
export type ReactionEvent = {
    sock: OnMessageSocket;
    key: MessageKey;
    from: string;
    /** the emoji, '' when removed */
    text: string;
    remove: boolean;
    sender: string;
};
export type OnMessageEvents = {
    /** every parsed message */
    message: MessageContext;
    /** a registered command was matched and passed its guards */
    command: MessageContext;
    /** a message with text that is not a registered command */
    text: MessageContext;
    /** looked like a command (has prefix) but is not registered */
    unknown: MessageContext;
    reaction: ReactionEvent;
    delete: Record<string, any>;
};
export type OnMessageOptions = {
    /** command prefixes (default: . / ! #) */
    prefixes?: string[];
    /** treat the first word of every message as a command (default: false) */
    noPrefix?: boolean;
    /** owner numbers */
    owners?: string[];
    /** mark messages as read (default: true) */
    autoRead?: boolean;
    /** ignore messages sent by the bot itself (default: true) */
    ignoreSelf?: boolean;
    /** skip messages older than this many seconds, e.g. backlog after reconnect. 0 = off (default: 120) */
    maxAge?: number;
    /** enables ctx.typing() / ctx.recording() / ctx.paused() */
    presence?: {
        typing(jid: string): Promise<unknown>;
        recording(jid: string): Promise<unknown>;
        paused(jid: string): Promise<unknown>;
    } | null;
    /** share one GroupCache with OnGroup */
    groups?: GroupCache;
    /** guard replies */
    messages?: Partial<{
        group: string;
        private: string;
        owner: string;
        admin: string;
        botAdmin: string;
        cooldown: (seconds: number) => string;
    }>;
    onError?: (error: unknown, ctx?: MessageContext) => void;
};
/** the part of the socket OnMessage needs */
export type OnMessageSocket = {
    ev: AnyEvents;
    user?: {
        id?: string;
        lid?: string;
    };
    logger?: unknown;
    signalRepository?: any;
    updateMediaMessage?: any;
    readMessages(keys: any[]): Promise<any>;
    sendMessage(jid: string, content: any, options?: any): Promise<any>;
    groupMetadata(jid: string): Promise<any>;
};
type Entry = CommandOptions & {
    names: string[];
    run: CommandRun;
};
type Middleware = (ctx: MessageContext, next: () => Promise<unknown>) => unknown;
/** text of a message: text, caption, button / list / native-flow replies */
export declare const getCommandText: (content: Record<string, any> | undefined, type: string | undefined) => string;
export declare class OnMessage {
    private readonly handlers;
    private readonly middleware;
    private readonly seen;
    private readonly cooldowns;
    private readonly sock;
    private readonly prefixes;
    private readonly noPrefix;
    private readonly owners;
    private readonly autoRead;
    private readonly ignoreSelf;
    private readonly maxAge;
    private readonly presence;
    private readonly groups;
    private readonly texts;
    private readonly onError;
    readonly commands: Map<string, Entry>;
    constructor(sock: OnMessageSocket, options?: OnMessageOptions);
    /** register a command. `names` can be one name or several (aliases) */
    command(names: string | string[], run: CommandRun, options?: CommandOptions): this;
    /** middleware runs before every command / text. Call next() to continue */
    use(fn: Middleware): this;
    on<K extends keyof OnMessageEvents>(name: K, fn: (arg: OnMessageEvents[K]) => unknown): this;
    attach(): this;
    detach(): this;
    private emit;
    private readonly onUpsert;
    private readonly onReaction;
    private readonly onDelete;
    private handle;
    private dispatch;
}
export {};
//# sourceMappingURL=on-message.d.ts.map