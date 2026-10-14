export type AntiSpamOptions = {
    /** max messages a sender may send within `windowMs` (default: 5) */
    maxMessages?: number;
    /** sliding window, ms (default: 10_000) */
    windowMs?: number;
    /** the same text this many times within the window counts as spam. 0 = off (default: 3) */
    maxRepeats?: number;
    /** how long a spammer stays muted, ms (default: 60_000) */
    muteMs?: number;
    /** block the sender after this many mutes. 0 / undefined = never block */
    blockAfter?: number;
    /** warning sent when someone gets muted. `false` / undefined = send nothing */
    warning?: string | false | ((sender: string, reason: AntiSpamReason) => string | false | undefined);
    /** numbers / JIDs that are never treated as spam (e.g. the bot owner) */
    allow?: string[];
    /** do not check messages sent in groups (default: false) */
    ignoreGroups?: boolean;
    /** ignore messages older than this many seconds, e.g. backlog replayed after reconnecting (default: 30) */
    maxAgeSeconds?: number;
    /** called whenever a sender gets muted */
    onSpam?: (info: {
        sender: string;
        chat: string;
        reason: AntiSpamReason;
        strikes: number;
    }) => void;
    logger?: {
        info(obj: unknown, msg?: string): void;
        warn(obj: unknown, msg?: string): void;
    };
    /** clock override, mainly for tests */
    now?: () => number;
};
export type AntiSpamReason = 'rate' | 'repeat' | 'muted';
export type AntiSpamVerdict = {
    spam: boolean;
    reason?: AntiSpamReason;
    sender?: string;
    justMuted?: boolean;
};
/** the minimal message shape AntiSpam needs; a ZeonnByte WAMessage fits it */
export type SpamMessage = {
    key: {
        remoteJid?: string | null;
        participant?: string | null;
        fromMe?: boolean | null;
    };
    message?: Record<string, any> | null;
    messageTimestamp?: number | {
        toNumber(): number;
    } | null;
};
/** the part of the socket AntiSpam needs, so it can be unit-tested with a stub */
export type AntiSpamSocket = {
    ev: {
        on(event: 'messages.upsert', listener: (arg: {
            messages: SpamMessage[];
            type: string;
        }) => void): void;
        off(event: 'messages.upsert', listener: (arg: {
            messages: SpamMessage[];
            type: string;
        }) => void): void;
    };
    sendMessage(jid: string, content: {
        text: string;
    }, options?: {
        quoted?: any;
    }): Promise<unknown>;
    updateBlockStatus(jid: string, action: 'block' | 'unblock'): Promise<void>;
};
/** text of any message type: conversation, extended text, captions */
export declare const getSpamText: (message: Record<string, any> | null | undefined, depth?: number) => string;
export declare class AntiSpam {
    private running;
    private readonly states;
    private readonly allowed;
    private readonly options;
    private readonly sock?;
    private checks;
    private readonly listener;
    /** `sock` is optional: without it AntiSpam only gives verdicts via check() and never sends or blocks anything */
    constructor(sock?: AntiSpamSocket, options?: AntiSpamOptions);
    get isRunning(): boolean;
    /** listen to incoming messages and take action automatically (warn / block) */
    start(): this;
    stop(): this;
    allow(jid: string): this;
    disallow(jid: string): this;
    /** is this sender currently muted? use it in your own message handler: `if (antispam.isMuted(sender)) return` */
    isMuted(jid: string): boolean;
    /** lift a mute / forget a sender */
    reset(jid: string): this;
    private now;
    private senderKey;
    /** decides whether this message is spam and records it. Pure decision: sends / blocks nothing */
    check(msg: SpamMessage): AntiSpamVerdict;
    /** check() + side effects (warning message, block, onSpam callback). Used by start() */
    handle(msg: SpamMessage): Promise<AntiSpamVerdict>;
    private cleanup;
}
//# sourceMappingURL=anti-spam.d.ts.map