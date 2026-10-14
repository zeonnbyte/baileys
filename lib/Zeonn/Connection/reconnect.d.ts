import type { AnyEvents } from '../common.js';
export type ReconnectOptions = {
    /** first retry delay, ms (default: 1000) */
    baseDelay?: number;
    /** longest retry delay, ms (default: 30_000) */
    maxDelay?: number;
    /** give up after this many failed attempts (default: unlimited) */
    maxRetry?: number;
    /** status codes that must NOT be retried (default: logged out, forbidden, replaced, multi-device mismatch, bad session) */
    fatal?: number[];
};
export type ReconnectEvents = {
    connecting: [];
    qr: [qr: string];
    open: [];
    close: [code: number | undefined, error: Error | undefined];
    /** a retry was scheduled */
    retry: [delayMs: number, attempt: number, code: number | undefined];
    /** a fatal code was hit, no retry will happen */
    fatal: [code: number | undefined, error: Error | undefined];
    /** maxRetry reached */
    giveup: [code: number | undefined, error: unknown];
    /** start() threw */
    error: [error: unknown];
};
/** the part of the socket Reconnect needs */
export type ReconnectSocket = {
    ev: AnyEvents;
    end?: (error: Error | undefined) => void;
};
export declare class Reconnect {
    private readonly start;
    private readonly hooks;
    private timer?;
    private readonly baseDelay;
    private readonly maxDelay;
    private readonly maxRetry;
    private readonly fatal;
    private sock?;
    retries: number;
    connected: boolean;
    stopped: boolean;
    /** `start` creates a new socket and calls `reconnect.attach(sock)` on it */
    constructor(start: () => unknown, options?: ReconnectOptions);
    on<K extends keyof ReconnectEvents>(name: K, fn: (...args: ReconnectEvents[K]) => void): this;
    private emit;
    /** watch this socket's connection. Call it for every new socket */
    attach(sock: ReconnectSocket): this;
    private onUpdate;
    private retry;
    private schedule;
    /** forget failed attempts */
    reset(): this;
    /** stop reconnecting and close the current socket */
    stop(): this;
}
//# sourceMappingURL=reconnect.d.ts.map