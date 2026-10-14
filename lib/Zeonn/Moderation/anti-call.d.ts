export type AntiCallOptions = {
    /** reject incoming calls (default: true). false = only report them through onCall */
    reject?: boolean;
    /** which calls to handle: 'all' (default), 'voice' or 'video' */
    only?: 'all' | 'voice' | 'video';
    /** where calls are handled: 'all' (default), 'chat' (private calls only) or 'group' (group calls only) */
    scope?: 'all' | 'chat' | 'group';
    /** private message to the caller after the call is rejected. `false` / undefined = send nothing */
    warning?: string | false | ((caller: string, strikes: number) => string | false | undefined);
    /** message posted in the group when a group call is rejected. `false` / undefined = send nothing */
    groupWarning?: string | false | ((caller: string, group: string, strikes: number) => string | false | undefined);
    /** block the caller after this many calls. 0 / undefined = never block */
    blockAfter?: number;
    /** a caller's strikes are forgotten after this many ms without calling. 0 / undefined = never forget */
    strikeResetMs?: number;
    /** numbers / JIDs whose calls are never rejected (e.g. the bot owner) */
    allow?: string[];
    /** group JIDs whose calls are never rejected */
    allowGroups?: string[];
    /** called for every handled call */
    onCall?: (info: AntiCallInfo) => void;
    logger?: {
        info(obj: unknown, msg?: string): void;
        warn(obj: unknown, msg?: string): void;
    };
    /** clock override, mainly for tests */
    now?: () => number;
};
export type AntiCallInfo = {
    caller: string;
    /** the group JID for group calls, otherwise the caller's chat */
    chat: string;
    callId: string;
    isVideo: boolean;
    isGroup: boolean;
    strikes: number;
};
/** the minimal call event AntiCall needs; a ZeonnByte WACallEvent fits it */
export type AntiCallEvent = {
    id: string;
    from: string;
    chatId?: string;
    groupJid?: string;
    isVideo?: boolean;
    isGroup?: boolean;
    status: string;
};
export type AntiCallVerdict = {
    handled: boolean;
    /** why the call was left alone, when handled is false */
    skipped?: 'status' | 'scope' | 'type' | 'allowed' | 'duplicate' | 'disabled';
    rejected?: boolean;
    blocked?: boolean;
    strikes?: number;
};
/** the part of the socket AntiCall needs, so it can be unit-tested with a stub */
export type AntiCallSocket = {
    ev: {
        on(event: 'call', listener: (calls: AntiCallEvent[]) => void): void;
        off(event: 'call', listener: (calls: AntiCallEvent[]) => void): void;
    };
    rejectCall(callId: string, callFrom: string): Promise<void>;
    sendMessage(jid: string, content: {
        text: string;
    }): Promise<unknown>;
    updateBlockStatus(jid: string, action: 'block' | 'unblock'): Promise<void>;
};
export declare class AntiCall {
    private running;
    private enabled;
    private readonly strikes;
    private readonly seen;
    private readonly allowed;
    private readonly allowedGroups;
    private readonly options;
    private readonly sock;
    private rejectedCount;
    private blockedCount;
    private readonly listener;
    constructor(sock: AntiCallSocket, options?: AntiCallOptions);
    get isRunning(): boolean;
    get isEnabled(): boolean;
    /** total rejected calls and blocked callers since this instance was created */
    get stats(): {
        rejected: number;
        blocked: number;
        tracked: number;
    };
    /** listen to incoming calls and handle them automatically */
    start(): this;
    stop(): this;
    /** pause / resume without removing the listener */
    enable(): this;
    disable(): this;
    allow(jid: string): this;
    disallow(jid: string): this;
    allowGroup(groupJid: string): this;
    disallowGroup(groupJid: string): this;
    /** is this caller exempt from call rejection? */
    isAllowed(jid: string): boolean;
    /** how many calls this caller has made so far (0 when unknown or expired) */
    getStrikes(jid: string): number;
    /** forget one caller's counter */
    reset(jid: string): this;
    /** forget every counter */
    resetAll(): this;
    private now;
    /** decides whether this call is handled, without rejecting / sending / blocking anything and without counting it */
    check(call: AntiCallEvent): AntiCallVerdict;
    /** handle one call event: count it, reject it, send the warnings, block if needed. Used by start() */
    handle(call: AntiCallEvent): Promise<AntiCallVerdict>;
}
//# sourceMappingURL=anti-call.d.ts.map