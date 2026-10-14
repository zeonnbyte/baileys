import { type AnyEvents } from '../common.js';
export type PresenceType = 'unavailable' | 'available' | 'composing' | 'recording' | 'paused';
export type PresenceOptions = {
    /** how long a received presence counts as fresh, ms (default: 30_000) */
    ttl?: number;
    /** send 'available' every this many ms. 0 / undefined = off */
    heartbeat?: number;
    onError?: (error: unknown) => void;
};
export type PresenceEvent = {
    chat: string;
    jid: string;
    number: string;
    isGroup: boolean;
    presence: PresenceType;
    lastSeen?: number;
    at: number;
};
/** 'update' fires for every presence, the others fire for that presence only */
export type PresenceEventName = 'update' | PresenceType;
export type PresenceSocket = {
    ev: AnyEvents;
    presenceSubscribe(jid: string): Promise<any>;
    sendPresenceUpdate(type: PresenceType, toJid?: string): Promise<any>;
};
type PresenceData = {
    presence: PresenceType;
    lastSeen?: number;
    at: number;
};
export declare class Presence {
    private readonly sock;
    private readonly store;
    private readonly handlers;
    private readonly ttl;
    private readonly heartbeatMs;
    private readonly onError;
    private beat?;
    constructor(sock: PresenceSocket, options?: PresenceOptions);
    /** start listening to other people's presence */
    attach(): this;
    detach(): this;
    on(name: PresenceEventName, fn: (e: PresenceEvent) => unknown): this;
    private emit;
    private readonly onUpdate;
    /** last known presence of `jid` in `chat` (for private chats both are the same) */
    get(chat: string, jid?: string): PresenceData | undefined;
    private fresh;
    isOnline(chat: string, jid?: string): boolean;
    isTyping(chat: string, jid?: string): boolean;
    isRecording(chat: string, jid?: string): boolean;
    lastSeen(chat: string, jid?: string): number | undefined;
    subscribe(jid: string): Promise<any>;
    set(type: PresenceType, jid?: string): Promise<any>;
    online(): Promise<any>;
    offline(): Promise<any>;
    typing(jid: string): Promise<any>;
    recording(jid: string): Promise<any>;
    paused(jid: string): Promise<any>;
    /** pretend to type / record for `ms`, then pause */
    simulate(jid: string, ms?: number, type?: 'composing' | 'recording'): Promise<void>;
    /** show typing / recording while `fn` runs (refreshed every 8s), then pause */
    wrap<T>(jid: string, fn: () => Promise<T> | T, type?: 'composing' | 'recording'): Promise<T>;
    /** send 'available' every `ms`. 0 = stop */
    heartbeat(ms: number): this;
}
export {};
//# sourceMappingURL=presence.d.ts.map