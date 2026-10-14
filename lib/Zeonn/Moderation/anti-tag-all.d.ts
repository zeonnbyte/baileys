import { type AnyEvents, GroupCache } from '../common.js';
export type AntiTagAllAction = 'delete' | 'warn' | 'kick';
export type AntiTagAllReason = 'mentions' | 'ratio';
export type AntiTagAllOptions = {
    /** this many mentions in one message count as tag-all (default: 15). 0 = off */
    maxMentions?: number;
    /** also flag when mentions reach this share of the group's members, 0..1 (default: 0.5). 0 = off */
    maxRatio?: number;
    /** the ratio rule only applies from this many mentions, so tiny groups don't trigger (default: 5) */
    minMentions?: number;
    /** what to do (default: ['delete', 'warn']). The bot must be a group admin to delete / kick */
    actions?: AntiTagAllAction[];
    /** with 'kick': kick on this many violations (default: 3) */
    kickAfter?: number;
    /** violations are forgotten after this long, ms (default: 3_600_000) */
    strikeTtlMs?: number;
    /** warning text. false = none. A function gets the sender and the mention count */
    warning?: string | false | ((sender: string, mentions: number) => string | false | undefined);
    /** numbers / JIDs that are never flagged */
    allow?: string[];
    /** group admins are never flagged (default: true) */
    allowAdmins?: boolean;
    /** ignore messages older than this many seconds, e.g. backlog after reconnecting (default: 30) */
    maxAgeSeconds?: number;
    /** share one GroupCache with OnMessage / OnGroup */
    groups?: GroupCache;
    onViolation?: (info: {
        sender: string;
        chat: string;
        mentions: number;
        strikes: number;
    }) => void;
    logger?: {
        info(obj: unknown, msg?: string): void;
        warn(obj: unknown, msg?: string): void;
    };
    /** clock override, mainly for tests */
    now?: () => number;
};
export type TagMessage = {
    key: {
        id?: string | null;
        remoteJid?: string | null;
        participant?: string | null;
        participantAlt?: string | null;
        fromMe?: boolean | null;
    };
    message?: Record<string, any> | null;
    messageTimestamp?: number | {
        toNumber(): number;
    } | null;
};
export type AntiTagAllVerdict = {
    flagged: boolean;
    reason?: AntiTagAllReason;
    mentions: number;
    sender?: string;
    strikes?: number;
};
/** the part of the socket AntiTagAll needs */
export type AntiTagAllSocket = {
    ev: AnyEvents;
    sendMessage(jid: string, content: any, options?: any): Promise<unknown>;
    groupMetadata(jid: string): Promise<any>;
    groupParticipantsUpdate(jid: string, participants: string[], action: 'remove'): Promise<unknown>;
};
/** unique numbers mentioned in a message (mentions inside a quoted message are not counted) */
export declare const getMentionedNumbers: (message: Record<string, any> | null | undefined) => string[];
export declare class AntiTagAll {
    private running;
    private readonly sock;
    private readonly options;
    private readonly groups;
    private readonly allowed;
    private readonly strikes;
    private readonly listener;
    constructor(sock: AntiTagAllSocket, options?: AntiTagAllOptions);
    get isRunning(): boolean;
    /** listen to incoming messages and act automatically */
    start(): this;
    stop(): this;
    allow(jid: string): this;
    disallow(jid: string): this;
    private now;
    /** pure decision, sends nothing. `groupSize` enables the ratio rule */
    check(msg: TagMessage, groupSize?: number): AntiTagAllVerdict;
    /** check() + side effects (delete / warn / kick). Used by start() */
    handle(msg: TagMessage): Promise<AntiTagAllVerdict>;
    private addStrike;
    private safe;
}
//# sourceMappingURL=anti-tag-all.d.ts.map