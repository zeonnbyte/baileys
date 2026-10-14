// Patch@Zeonn: AutoStatus — views (and optionally reacts to) status updates, one at a time with random human-like delays.

import { type AnyEvents, normJid, sleep as realSleep } from '../common'

export type StatusKind = 'text' | 'image' | 'video' | 'audio' | 'other'

export type AutoStatusOptions = {
  /** mark statuses as viewed (default: true) */
  view?: boolean
  /** emoji to react with; with a list one is picked at random. false / undefined = never react */
  react?: string | string[] | false
  /** chance 0..1 that a status gets a reaction (default: 1) */
  reactChance?: number
  /** wait a random time in this range before acting, ms (default: [2000, 8000]) */
  delay?: [number, number]
  /** only these numbers / JIDs. Empty = everyone */
  only?: string[]
  /** never these numbers / JIDs */
  ignore?: string[]
  /** only these kinds of status. Empty = all */
  kinds?: StatusKind[]
  /** skip statuses older than this many seconds. 0 = off (default: 0) */
  maxAgeSeconds?: number
  onStatus?: (info: { sender: string; kind: StatusKind; viewed: boolean; reaction?: string }) => void
  logger?: { warn(obj: unknown, msg?: string): void }
  /** overrides, mainly for tests */
  random?: () => number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export type StatusMessage = {
  key: {
    id?: string | null
    remoteJid?: string | null
    participant?: string | null
    participantAlt?: string | null
    fromMe?: boolean | null
  }
  message?: Record<string, any> | null
  messageTimestamp?: number | { toNumber(): number } | null
}

export type AutoStatusResult = { handled: boolean; viewed: boolean; reaction?: string; reason?: string }

/** the part of the socket AutoStatus needs */
export type AutoStatusSocket = {
  ev: AnyEvents
  user?: { id?: string }
  readMessages(keys: any[]): Promise<unknown>
  sendMessage(jid: string, content: any, options?: any): Promise<unknown>
}

const userPart = (jid: string | undefined | null) => {
  if (!jid) return ''
  const raw = jid.includes('@') ? jid.split('@')[0]!.split(':')[0]! : jid
  return raw.replace(/[^0-9a-zA-Z]/g, '')
}

const toSeconds = (v: StatusMessage['messageTimestamp']) =>
  typeof v === 'number' ? v : v && typeof v.toNumber === 'function' ? v.toNumber() : 0

export const getStatusKind = (message: Record<string, any> | null | undefined): StatusKind => {
  if (!message) return 'other'
  if (message.imageMessage) return 'image'
  if (message.videoMessage) return 'video'
  if (message.audioMessage) return 'audio'
  if (message.conversation || message.extendedTextMessage) return 'text'
  return 'other'
}

export class AutoStatus {
  private running = false
  private chain: Promise<unknown> = Promise.resolve()
  private readonly seen = new Set<string>()
  private readonly sock: AutoStatusSocket
  private readonly options: AutoStatusOptions
  private readonly only: Set<string>
  private readonly ignore: Set<string>
  private readonly listener = (arg: { messages: StatusMessage[]; type: string }) => {
    if (arg.type !== 'notify') return
    for (const msg of arg.messages) {
      if (msg.key.remoteJid !== 'status@broadcast') continue
      void this.handle(msg).catch(error => this.options.logger?.warn({ error }, 'autostatus failed'))
    }
  }

  constructor(sock: AutoStatusSocket, options: AutoStatusOptions = {}) {
    this.sock = sock
    this.options = options
    this.only = new Set((options.only ?? []).map(userPart).filter(Boolean))
    this.ignore = new Set((options.ignore ?? []).map(userPart).filter(Boolean))
  }

  get isRunning() {
    return this.running
  }

  /** listen to incoming statuses and act automatically */
  start() {
    if (!this.running) {
      this.sock.ev.on('messages.upsert', this.listener)
      this.running = true
    }

    return this
  }

  stop() {
    if (this.running) {
      this.sock.ev.off('messages.upsert', this.listener)
      this.running = false
    }

    return this
  }

  /** handle one status. Calls are queued, so statuses are processed one at a time */
  handle(msg: StatusMessage): Promise<AutoStatusResult> {
    const run = this.chain.then(() => this.process(msg))
    this.chain = run.catch(() => undefined)
    return run
  }

  private random() {
    return this.options.random ? this.options.random() : Math.random()
  }

  private sleep(ms: number) {
    return this.options.sleep ? this.options.sleep(ms) : realSleep(ms)
  }

  private now() {
    return this.options.now ? this.options.now() : Date.now()
  }

  private async process(msg: StatusMessage): Promise<AutoStatusResult> {
    const o = this.options
    const { key } = msg
    const skip = (reason: string): AutoStatusResult => ({ handled: false, viewed: false, reason })
    if (key.remoteJid !== 'status@broadcast') return skip('not a status')
    if (key.fromMe) return skip('own status')
    const sender = key.participant || key.participantAlt || ''
    if (!sender || !key.id) return skip('no sender')
    const content = msg.message
    if (!content || content.protocolMessage || content.senderKeyDistributionMessage) return skip('no content')

    const nums = [key.participant, key.participantAlt].filter((x): x is string => !!x).map(userPart)
    if (this.only.size && !nums.some(n => this.only.has(n))) return skip('not in only')
    if (nums.some(n => this.ignore.has(n))) return skip('ignored')
    const kind = getStatusKind(content)
    if (o.kinds?.length && !o.kinds.includes(kind)) return skip('kind')
    const ts = toSeconds(msg.messageTimestamp)
    const maxAge = o.maxAgeSeconds ?? 0
    if (ts && maxAge > 0 && this.now() / 1000 - ts > maxAge) return skip('too old')

    if (this.seen.has(key.id)) return skip('duplicate')
    this.seen.add(key.id)
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value as string)

    const [min, max] = o.delay ?? [2000, 8000]
    await this.sleep(Math.max(0, min + this.random() * Math.max(0, max - min)))

    let viewed = false
    if (o.view !== false) {
      try {
        await this.sock.readMessages([key])
        viewed = true
      } catch (error) {
        o.logger?.warn({ error, sender }, 'autostatus: view failed')
      }
    }

    let reaction: string | undefined
    const emojis = o.react ? ([] as string[]).concat(o.react).filter(Boolean) : []
    if (emojis.length && this.random() < (o.reactChance ?? 1)) {
      const emoji = emojis[Math.min(emojis.length - 1, Math.floor(this.random() * emojis.length))]!
      try {
        const me = normJid(this.sock.user?.id)
        await this.sock.sendMessage('status@broadcast', { react: { text: emoji, key } }, { statusJidList: [sender, me].filter(Boolean) })
        reaction = emoji
      } catch (error) {
        o.logger?.warn({ error, sender }, 'autostatus: react failed')
      }
    }

    try {
      o.onStatus?.({ sender, kind, viewed, reaction })
    } catch (error) {
      o.logger?.warn({ error }, 'autostatus: onStatus threw')
    }

    return { handled: true, viewed, reaction }
  }
}
