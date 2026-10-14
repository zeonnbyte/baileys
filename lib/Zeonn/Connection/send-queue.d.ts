export type SendPriority = 'high' | 'normal' | 'low';
export type SendQueueOptions = {
    /** random wait between two sends, ms (default: [800, 2500]) */
    delay?: [number, number];
    /** minimum gap between two sends to the same chat, ms (default: 1500) */
    perChatMs?: number;
    /** max sends per rolling minute. 0 = unlimited (default: 25) */
    perMinute?: number;
    /** retries after a failed send (default: 1) */
    retries?: number;
    /** wait before the first retry, doubled each time, ms (default: 2000) */
    retryDelayMs?: number;
    /** reject new sends once this many wait. 0 = unlimited (default: 200) */
    maxQueue?: number;
    onError?: (error: unknown, info: {
        jid: string;
        attempt: number;
    }) => void;
    /** overrides, mainly for tests */
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
};
/** the part of the socket SendQueue needs */
export type SendQueueSocket = {
    sendMessage: (jid: string, content: any, options?: any) => Promise<any>;
};
export declare class SendQueue {
    private readonly sock;
    private readonly raw;
    private readonly opts;
    private items;
    private running;
    private paused;
    private lastAt;
    private sentAt;
    private readonly chatAt;
    private idle;
    constructor(sock: SendQueueSocket, options?: SendQueueOptions);
    /** messages waiting */
    get size(): number;
    get isPaused(): boolean;
    /** queue a message. Resolves with what sendMessage returned. `high` jumps ahead of `normal` and `low` */
    send(jid: string, content: any, options?: any, priority?: SendPriority): Promise<any>;
    /** make sock.sendMessage() go through the queue */
    patch(): this;
    unpatch(): this;
    pause(): this;
    resume(): this;
    /** reject everything still waiting, returns how many */
    clear(): number;
    /** resolves when nothing is waiting or being sent */
    drain(): Promise<void>;
    private now;
    private sleep;
    private notifyIdle;
    private pump;
    /** wait until the delay, per-chat and per-minute rules allow the next send */
    private wait;
    private deliver;
}
//# sourceMappingURL=send-queue.d.ts.map