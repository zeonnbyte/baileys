import { type AnyEvents, GroupCache, type GroupMetaLike } from '../common.js';
export type GreetTemplates = Partial<Record<'join' | 'leave' | 'kick' | 'promote' | 'demote', string>>;
export type OnGroupOptions = {
    /**
     * auto messages. `true` = default texts, or your own per event.
     * Placeholders: {tag} {number} {subject} {count} {author}
     */
    templates?: boolean | GreetTemplates;
    /** per group / event switch for the auto messages (default: always on) */
    enabled?: (groupId: string, event: string) => boolean | Promise<boolean>;
    /** share one GroupCache with OnMessage */
    groups?: GroupCache;
    onError?: (error: unknown, ctx?: unknown) => void;
};
/** the part of the socket OnGroup needs */
export type OnGroupSocket = {
    ev: AnyEvents;
    user?: {
        id?: string;
        lid?: string;
    };
    signalRepository?: any;
    groupMetadata(jid: string): Promise<any>;
    sendMessage(jid: string, content: any, options?: any): Promise<any>;
    groupRequestParticipantsUpdate(jid: string, participants: string[], action: 'approve' | 'reject'): Promise<any>;
};
type Sender = (content: string | Record<string, any>, options?: Record<string, any>) => Promise<unknown>;
export type ParticipantContext = {
    sock: OnGroupSocket;
    /** group JID */
    id: string;
    action: string;
    event: string;
    participant: unknown;
    /** participant JID as the group uses it (can be @lid) */
    jid: string;
    /** participant phone number JID when it can be resolved */
    pn: string;
    number: string;
    lid?: string;
    /** "@number", matches `mentions` */
    tag: string;
    mentions: string[];
    author?: string;
    authorPn?: string;
    authorTag: string;
    /** join: 'self' = via link; leave: 'self' = left on their own */
    by: 'self' | 'admin';
    meta?: GroupMetaLike;
    subject: string;
    count: number;
    isBot: boolean;
    send: Sender;
};
export type ParticipantsBatch = {
    sock: OnGroupSocket;
    id: string;
    action: string;
    participants: unknown[];
    author?: string;
    authorPn?: string;
    meta?: GroupMetaLike;
};
export type ChangeContext = {
    sock: OnGroupSocket;
    id: string;
    /** the new value of the changed field */
    value?: unknown;
    update: Record<string, any>;
    author?: string;
    authorPn?: string;
    send: Sender;
};
export type CreateContext = {
    sock: OnGroupSocket;
    id: string;
    meta: GroupMetaLike;
    send: Sender;
};
export type RequestContext = {
    sock: OnGroupSocket;
    id: string;
    /** created | revoked | rejected */
    action: string;
    participant: string;
    pn?: string;
    number: string;
    author?: string;
    authorPn?: string;
    method?: string;
    approve(): Promise<unknown>;
    reject(): Promise<unknown>;
    send: Sender;
};
type ParticipantEvent = 'join' | 'leave' | 'kick' | 'promote' | 'demote' | 'modify' | 'botJoin' | 'botLeave' | 'botPromote' | 'botDemote';
type ChangeEvent = 'subject' | 'desc' | 'announce' | 'restrict' | 'memberAddMode' | 'joinApproval' | 'ephemeral' | 'invite';
export type OnGroupEvents = {
    [K in ParticipantEvent]: ParticipantContext;
} & {
    [K in ChangeEvent]: ChangeContext;
} & {
    /** every participants.update, one call per batch */
    participants: ParticipantsBatch;
    /** any groups.update */
    update: ChangeContext;
    create: CreateContext;
    request: RequestContext;
};
export declare class OnGroup {
    private readonly handlers;
    private readonly sock;
    private readonly groups;
    private readonly templates;
    private readonly enabled;
    private readonly onError;
    constructor(sock: OnGroupSocket, options?: OnGroupOptions);
    on<K extends keyof OnGroupEvents>(name: K, fn: (ctx: OnGroupEvents[K]) => unknown): this;
    attach(): this;
    detach(): this;
    /** cached group metadata */
    meta(id: string, force?: boolean): Promise<GroupMetaLike | undefined>;
    private emit;
    private sender;
    private readonly onParticipants;
    private greet;
    private readonly onUpdate;
    private readonly onUpsert;
    private readonly onRequest;
}
export {};
//# sourceMappingURL=on-group.d.ts.map