const toNum = (v) => {
    if (typeof v === 'number')
        return v;
    if (v && typeof v.toNumber === 'function')
        return v.toNumber();
    return 0;
};
/** can this chat even have a disappearing-message timer? (not newsletters / status / broadcast lists) */
export const supportsAutoEphemeral = (jid) => !jid.endsWith('@newsletter') && !jid.endsWith('@broadcast');
/** finds contextInfo.expiration in any message type, including wrapped ones (ephemeral, view once, device sent, ...) */
export const getMessageExpiration = (message, depth = 0) => {
    if (!message || depth > 5)
        return undefined;
    for (const value of Object.values(message)) {
        if (!value || typeof value !== 'object')
            continue;
        const v = value;
        const exp = toNum(v.contextInfo?.expiration);
        if (exp > 0)
            return exp;
        if (v.message && typeof v.message === 'object') {
            const inner = getMessageExpiration(v.message, depth + 1);
            if (inner)
                return inner;
        }
    }
    return undefined;
};
export const makeAutoEphemeral = () => {
    const store = new Map();
    /** returns false when the value was ignored because we already know a newer setting */
    const set = (jid, expiration, ts = 0) => {
        if (!jid || !supportsAutoEphemeral(jid))
            return false;
        const prev = store.get(jid);
        if (prev && ts && prev.ts && ts < prev.ts)
            return false;
        store.set(jid, { expiration: Math.max(0, expiration || 0), ts: ts || prev?.ts || 0 });
        return true;
    };
    return {
        get: (jid) => store.get(jid)?.expiration,
        set,
        /** chat objects from chats.upsert / chats.update / messaging-history.set */
        learnFromChats: (chats) => {
            for (const chat of chats || []) {
                if (!chat?.id || chat.ephemeralExpiration === undefined)
                    continue;
                set(chat.id, chat.ephemeralExpiration || 0, toNum(chat.ephemeralSettingTimestamp));
            }
        },
        /** incoming (or own) messages: any message carrying an expiration tells us the chat timer */
        learnFromMessages: (messages) => {
            for (const msg of messages || []) {
                const jid = msg?.key?.remoteJid;
                const exp = getMessageExpiration(msg?.message);
                if (jid && exp)
                    set(jid, exp, toNum(msg.messageTimestamp));
            }
        }
    };
};
//# sourceMappingURL=auto-ephemeral.js.map