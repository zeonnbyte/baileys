import type { proto } from '../../../WAProto/index.js';
type ChatLike = {
    id?: string | null;
    ephemeralExpiration?: number | null;
    ephemeralSettingTimestamp?: number | {
        toNumber(): number;
    } | null;
};
type MessageLike = {
    key?: {
        remoteJid?: string | null;
    } | null;
    message?: proto.IMessage | null;
    messageTimestamp?: number | {
        toNumber(): number;
    } | null;
};
/** can this chat even have a disappearing-message timer? (not newsletters / status / broadcast lists) */
export declare const supportsAutoEphemeral: (jid: string) => boolean;
/** finds contextInfo.expiration in any message type, including wrapped ones (ephemeral, view once, device sent, ...) */
export declare const getMessageExpiration: (message: proto.IMessage | null | undefined, depth?: number) => number | undefined;
export declare const makeAutoEphemeral: () => {
    get: (jid: string) => number | undefined;
    set: (jid: string, expiration: number, ts?: number) => boolean;
    /** chat objects from chats.upsert / chats.update / messaging-history.set */
    learnFromChats: (chats: ChatLike[] | undefined) => void;
    /** incoming (or own) messages: any message carrying an expiration tells us the chat timer */
    learnFromMessages: (messages: MessageLike[] | undefined) => void;
};
export type AutoEphemeral = ReturnType<typeof makeAutoEphemeral>;
export {};
//# sourceMappingURL=auto-ephemeral.d.ts.map