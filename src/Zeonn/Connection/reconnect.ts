// Patch@Zeonn: Reconnect — automatic reconnect with exponential backoff + jitter. Stops on logout / replaced / bad session.

import type { AnyEvents } from '../common'

export type ReconnectOptions = {
/** first retry delay, ms (default: 1000) */
baseDelay?: number
/** longest retry delay, ms (default: 30_000) */
maxDelay?: number
/** give up after this many failed attempts (default: unlimited) */
maxRetry?: number
/** status codes that must NOT be retried (default: logged out, forbidden, replaced, multi-device mismatch, bad session) */
fatal?: number[]
}

export type ReconnectEvents = {
connecting: []
qr: [qr: string]
open: []
close: [code: number | undefined, error: Error | undefined]
/** a retry was scheduled */
retry: [delayMs: number, attempt: number, code: number | undefined]
/** a fatal code was hit, no retry will happen */
fatal: [code: number | undefined, error: Error | undefined]
/** maxRetry reached */
giveup: [code: number | undefined, error: unknown]
/** start() threw */
error: [error: unknown]
}

/** the part of the socket Reconnect needs */
export type ReconnectSocket = { ev: AnyEvents; end?: (error: Error | undefined) => void }

type DisconnectError = Error & { output?: { statusCode?: number } }

// DisconnectReason values: loggedOut 401, forbidden 403, multideviceMismatch 411, connectionReplaced 440, badSession 500
const FATAL = [401, 403, 411, 440, 500]
const RESTART_REQUIRED = 515

export class Reconnect {
private readonly hooks: { [K in keyof ReconnectEvents]?: (...args: ReconnectEvents[K]) => void } = {}
private timer?: ReturnType<typeof setTimeout>
private readonly baseDelay: number
private readonly maxDelay: number
private readonly maxRetry: number
private readonly fatal: Set<number>
private sock?: ReconnectSocket
retries = 0
connected = false
stopped = false

/** `start` creates a new socket and calls `reconnect.attach(sock)` on it */
constructor(
private readonly start: () => unknown,
options: ReconnectOptions = {}
) {
this.baseDelay = options.baseDelay ?? 1000
this.maxDelay = options.maxDelay ?? 30_000
this.maxRetry = options.maxRetry ?? Infinity
this.fatal = new Set(options.fatal ?? FATAL)
}

on<K extends keyof ReconnectEvents>(name: K, fn: (...args: ReconnectEvents[K]) => void) {
this.hooks[name] = fn as any
return this
}

private emit<K extends keyof ReconnectEvents>(name: K, ...args: ReconnectEvents[K]) {
try {
;(this.hooks[name] as ((...a: ReconnectEvents[K]) => void) | undefined)?.(...args)
} catch (error) {
console.error(`[Reconnect:${name}]`, error)
}
}

/** watch this socket's connection. Call it for every new socket */
attach(sock: ReconnectSocket) {
this.sock = sock
this.stopped = false
sock.ev.on(
'connection.update',
(update: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string }) => this.onUpdate(sock, update)
)
return this
}

private onUpdate(
sock: ReconnectSocket,
{ connection, lastDisconnect, qr }: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string }
) {
if (sock !== this.sock) return // ignore the old socket
if (qr) this.emit('qr', qr)
if (connection === 'connecting') this.emit('connecting')

if (connection === 'open') {
clearTimeout(this.timer)
this.timer = undefined
this.retries = 0
this.connected = true
this.emit('open')
}

if (connection === 'close') {
this.connected = false
const error = lastDisconnect?.error as DisconnectError | undefined
const code = error?.output?.statusCode
this.emit('close', code, error)
if (this.stopped) return
if (code !== undefined && this.fatal.has(code)) return this.emit('fatal', code, error)
if (code === RESTART_REQUIRED) return this.schedule(0, code) // normal right after pairing
this.retry(code, error)
}
}

private retry(code: number | undefined, error: unknown) {
if (this.retries >= this.maxRetry) return this.emit('giveup', code, error)
const exp = Math.min(this.baseDelay * 2 ** this.retries++, this.maxDelay)
this.schedule(Math.round(exp * (0.8 + Math.random() * 0.4)), code)
}

private schedule(delay: number, code: number | undefined) {
if (this.timer) return
this.emit('retry', delay, this.retries, code)
this.timer = setTimeout(async () => {
this.timer = undefined
if (this.stopped) return
try {
await this.start()
} catch (error) {
this.emit('error', error)
this.retry(undefined, error)
}
}, delay)
}

/** forget failed attempts */
reset() {
this.retries = 0
return this
}

/** stop reconnecting and close the current socket */
stop() {
this.stopped = true
clearTimeout(this.timer)
this.timer = undefined
try {
this.sock?.end?.(undefined)
} catch {}

return this
}
}
