// Patch@Zeonn: Reconnect — automatic reconnect with exponential backoff + jitter. Stops on logout / replaced / bad session.
// DisconnectReason values: loggedOut 401, forbidden 403, multideviceMismatch 411, connectionReplaced 440, badSession 500
const FATAL = [401, 403, 411, 440, 500];
const RESTART_REQUIRED = 515;
export class Reconnect {
    /** `start` creates a new socket and calls `reconnect.attach(sock)` on it */
    constructor(start, options = {}) {
        this.start = start;
        this.hooks = {};
        this.retries = 0;
        this.connected = false;
        this.stopped = false;
        this.baseDelay = options.baseDelay ?? 1000;
        this.maxDelay = options.maxDelay ?? 30000;
        this.maxRetry = options.maxRetry ?? Infinity;
        this.fatal = new Set(options.fatal ?? FATAL);
    }
    on(name, fn) {
        this.hooks[name] = fn;
        return this;
    }
    emit(name, ...args) {
        try {
            ;
            this.hooks[name]?.(...args);
        }
        catch (error) {
            console.error(`[Reconnect:${name}]`, error);
        }
    }
    /** watch this socket's connection. Call it for every new socket */
    attach(sock) {
        this.sock = sock;
        this.stopped = false;
        sock.ev.on('connection.update', (update) => this.onUpdate(sock, update));
        return this;
    }
    onUpdate(sock, { connection, lastDisconnect, qr }) {
        if (sock !== this.sock)
            return; // ignore the old socket
        if (qr)
            this.emit('qr', qr);
        if (connection === 'connecting')
            this.emit('connecting');
        if (connection === 'open') {
            clearTimeout(this.timer);
            this.timer = undefined;
            this.retries = 0;
            this.connected = true;
            this.emit('open');
        }
        if (connection === 'close') {
            this.connected = false;
            const error = lastDisconnect?.error;
            const code = error?.output?.statusCode;
            this.emit('close', code, error);
            if (this.stopped)
                return;
            if (code !== undefined && this.fatal.has(code))
                return this.emit('fatal', code, error);
            if (code === RESTART_REQUIRED)
                return this.schedule(0, code); // normal right after pairing
            this.retry(code, error);
        }
    }
    retry(code, error) {
        if (this.retries >= this.maxRetry)
            return this.emit('giveup', code, error);
        const exp = Math.min(this.baseDelay * 2 ** this.retries++, this.maxDelay);
        this.schedule(Math.round(exp * (0.8 + Math.random() * 0.4)), code);
    }
    schedule(delay, code) {
        if (this.timer)
            return;
        this.emit('retry', delay, this.retries, code);
        this.timer = setTimeout(async () => {
            this.timer = undefined;
            if (this.stopped)
                return;
            try {
                await this.start();
            }
            catch (error) {
                this.emit('error', error);
                this.retry(undefined, error);
            }
        }, delay);
    }
    /** forget failed attempts */
    reset() {
        this.retries = 0;
        return this;
    }
    /** stop reconnecting and close the current socket */
    stop() {
        this.stopped = true;
        clearTimeout(this.timer);
        this.timer = undefined;
        try {
            this.sock?.end?.(undefined);
        }
        catch { }
        return this;
    }
}
//# sourceMappingURL=reconnect.js.map