import { type AnyEvents } from '../common.js';
export type StatusKind = 'text' | 'image' | 'video' | 'audio' | 'other';
export type AutoStatusOptions = {
    /** mark statuses as viewed (default: true) */
    view?: boolean;
    /** emoji to react with; with a list one is picked at random. false / undefined = never react */
    react?: string | string[] | false;
    /** chance 0..1 that a status gets a reaction (default: 1) */
    reactChance?: number;
    /** wait a random time in this range before acting, ms (default: [2000, 8000]) */
    delay?: [number, number];
    /** only these numbers / JIDs. Empty = everyone */
    only?: string[];
    /** never these numbers / JIDs */
    ignore?: string[];
    /** only these kinds of status. Empty = all */
    kinds?: StatusKind[];
    /** skip statuses older than this many seconds. 0 = off (default: 0) */
    maxAgeSeconds?: number;
    onStatus?: (info: {
        sender: string;
        kind: StatusKind;
        viewed: boolean;
        reaction?: string;
    }) => void;
    logger?: {
        warn(obj: unknown, msg?: string): void;
    };
    /** overrides, mainly for tests */
    random?: () => number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
};
export type StatusMessage = {
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
export type AutoStatusResult = {
    handled: boolean;
    viewed: boolean;
    reaction?: string;
    reason?: string;
};
/** the part of the socket AutoStatus needs */
export type AutoStatusSocket = {
    ev: AnyEvents;
    user?: {
        id?: string;
    };
    readMessages(keys: any[]): Promise<unknown>;
    sendMessage(jid: string, content: any, options?: any): Promise<unknown>;
};
export declare const getStatusKind: (message: Record<string, any> | null | undefined) => StatusKind;
export declare class AutoStatus {
    private running;
    private chain;
    private readonly seen;
    private readonly sock;
    private readonly options;
    private readonly only;
    private readonly ignore;
    private readonly listener;
    constructor(sock: AutoStatusSocket, options?: AutoStatusOptions);
    get isRunning(): boolean;
    /** listen to incoming statuses and act automatically */
    start(): this;
    stop(): this;
    /** handle one status. Calls are queued, so statuses are processed one at a time */
    handle(msg: StatusMessage): Promise<AutoStatusResult>;
    private random;
    private sleep;
    private now;
    private process;
}
//# sourceMappingURL=auto-status.d.ts.map