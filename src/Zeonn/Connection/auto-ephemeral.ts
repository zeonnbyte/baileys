import type { proto } from '../../../WAProto/index.js'

// Patch@Zeonn: auto disappearing-message timer.
// Remembers the disappearing-message timer of every chat (learned from incoming messages, timer-change
// notifications, chat updates and history sync) so that sendMessage() can attach it to *any* message type
// without the caller passing `ephemeralExpiration` every time.

type Entry = { expiration: number; ts: number }

type ChatLike = {
	id?: string | null
	ephemeralExpiration?: number | null
	ephemeralSettingTimestamp?: number | { toNumber(): number } | null
}

type MessageLike = {
	key?: { remoteJid?: string | null } | null
	message?: proto.IMessage | null
	messageTimestamp?: number | { toNumber(): number } | null
}

const toNum = (v: unknown): number => {
	if (typeof v === 'number') return v
	if (v && typeof (v as any).toNumber === 'function') return (v as any).toNumber()
	return 0
}

/** can this chat even have a disappearing-message timer? (not newsletters / status / broadcast lists) */
export const supportsAutoEphemeral = (jid: string) => !jid.endsWith('@newsletter') && !jid.endsWith('@broadcast')

/** finds contextInfo.expiration in any message type, including wrapped ones (ephemeral, view once, device sent, ...) */
export const getMessageExpiration = (message: proto.IMessage | null | undefined, depth = 0): number | undefined => {
	if (!message || depth > 5) return undefined
	for (const value of Object.values(message)) {
		if (!value || typeof value !== 'object') continue
		const v = value as any
		const exp = toNum(v.contextInfo?.expiration)
		if (exp > 0) return exp
		if (v.message && typeof v.message === 'object') {
			const inner = getMessageExpiration(v.message, depth + 1)
			if (inner) return inner
		}
	}

	return undefined
}

export const makeAutoEphemeral = () => {
	const store = new Map<string, Entry>()

	/** returns false when the value was ignored because we already know a newer setting */
	const set = (jid: string, expiration: number, ts = 0) => {
		if (!jid || !supportsAutoEphemeral(jid)) return false
		const prev = store.get(jid)
		if (prev && ts && prev.ts && ts < prev.ts) return false
		store.set(jid, { expiration: Math.max(0, expiration || 0), ts: ts || prev?.ts || 0 })
		return true
	}

	return {
		get: (jid: string): number | undefined => store.get(jid)?.expiration,
		set,
		/** chat objects from chats.upsert / chats.update / messaging-history.set */
		learnFromChats: (chats: ChatLike[] | undefined) => {
			for (const chat of chats || []) {
				if (!chat?.id || chat.ephemeralExpiration === undefined) continue
				set(chat.id, chat.ephemeralExpiration || 0, toNum(chat.ephemeralSettingTimestamp))
			}
		},
		/** incoming (or own) messages: any message carrying an expiration tells us the chat timer */
		learnFromMessages: (messages: MessageLike[] | undefined) => {
			for (const msg of messages || []) {
				const jid = msg?.key?.remoteJid
				const exp = getMessageExpiration(msg?.message)
				if (jid && exp) set(jid, exp, toNum(msg.messageTimestamp))
			}
		}
	}
}

export type AutoEphemeral = ReturnType<typeof makeAutoEphemeral>
