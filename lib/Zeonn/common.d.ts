export type AnyEvents = {
    on: (event: any, listener: any) => any;
    off: (event: any, listener: any) => any;
};
export type Member = string | {
    id: string;
    lid?: string;
    phoneNumber?: string;
    admin?: string | null;
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
};
export type GroupMetaLike = {
    subject?: string;
    participants?: Exclude<Member, string>[];
    [key: string]: any;
};
export declare const sleep: (ms: number) => Promise<void>;
/** "628123:5@s.whatsapp.net" -> "628123" */
export declare const userNum: (jid: string | undefined | null) => string;
export declare const normJid: (jid: string | undefined | null) => string;
/** every number a participant is known by (id / lid / phoneNumber) */
export declare const memberNums: (p: Member) => string[];
/** LID -> phone number JID. Returns the original JID when it cannot be resolved */
export declare const toPn: (sock: {
    signalRepository?: any;
}, jid: string | undefined | null) => Promise<string>;
export declare const findMember: (meta: GroupMetaLike | null | undefined, jids: (string | undefined)[]) => {
    id: string;
    lid?: string;
    phoneNumber?: string;
    admin?: string | null;
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
} | undefined;
export declare const isAdminMember: (p: Member | undefined) => boolean;
export declare const botJids: (sock: {
    user?: {
        id?: string;
        lid?: string;
    };
}) => (string | undefined)[];
/**
 * Group metadata cache shared by OnMessage and OnGroup.
 * Also usable as `cachedGroupMetadata: async jid => cache.peek(jid)` in the socket config.
 */
export declare class GroupCache {
    private readonly map;
    private readonly ttl;
    private sock?;
    constructor(ttl?: number);
    bind(sock: {
        groupMetadata(jid: string): Promise<any>;
    }): this;
    /** cached value only, never fetches */
    peek(jid: string): GroupMetaLike | undefined;
    get(jid: string, force?: boolean): Promise<GroupMetaLike | undefined>;
    set(jid: string, meta: GroupMetaLike): this;
    drop(jid: string): this;
}
//# sourceMappingURL=common.d.ts.map