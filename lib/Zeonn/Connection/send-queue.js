// Patch@Zeonn: SendQueue — outgoing messages one at a time with random gaps, per-chat spacing, a per-minute cap,
// priorities and retries. patch() routes every sock.sendMessage() (including OnMessage replies) through the queue.
import { sleep as realSleep } from '../common.js';
const RANK = { high: 2, normal: 1, low: 0 };
export class SendQueue {
    constructor(sock, options = {}) {
        this.items = [];
        this.running = false;
        this.paused = false;
        this.lastAt = -Infinity;
        this.sentAt = [];
        this.chatAt = new Map();
        this.idle = [];
        this.sock = sock;
        this.raw = sock.sendMessage.bind(sock);
        this.opts = options;
    }
    /** messages waiting */
    get size() {
        return this.items.length;
    }
    get isPaused() {
        return this.paused;
    }
    /** queue a message. Resolves with what sendMessage returned. `high` jumps ahead of `normal` and `low` */
    send(jid, content, options, priority = 'normal') {
        const { maxQueue = 200 } = this.opts;
        if (maxQueue > 0 && this.items.length >= maxQueue)
            return Promise.reject(new Error('send queue is full'));
        return new Promise((resolve, reject) => {
            const job = { jid, content, options, rank: RANK[priority], resolve, reject };
            const at = this.items.findIndex(j => j.rank < job.rank);
            if (at === -1)
                this.items.push(job);
            else
                this.items.splice(at, 0, job);
            void this.pump();
        });
    }
    /** make sock.sendMessage() go through the queue */
    patch() {
        this.sock.sendMessage = (jid, content, options) => this.send(jid, content, options);
        return this;
    }
    unpatch() {
        this.sock.sendMessage = this.raw;
        return this;
    }
    pause() {
        this.paused = true;
        return this;
    }
    resume() {
        this.paused = false;
        void this.pump();
        return this;
    }
    /** reject everything still waiting, returns how many */
    clear() {
        const items = this.items;
        this.items = [];
        for (const job of items)
            job.reject(new Error('send queue cleared'));
        if (!this.running)
            this.notifyIdle();
        return items.length;
    }
    /** resolves when nothing is waiting or being sent */
    drain() {
        if (!this.running && !this.items.length)
            return Promise.resolve();
        return new Promise(resolve => this.idle.push(resolve));
    }
    now() {
        return this.opts.now ? this.opts.now() : Date.now();
    }
    sleep(ms) {
        return this.opts.sleep ? this.opts.sleep(ms) : realSleep(ms);
    }
    notifyIdle() {
        const list = this.idle;
        this.idle = [];
        for (const done of list)
            done();
    }
    async pump() {
        if (this.running || this.paused)
            return;
        this.running = true;
        try {
            while (!this.paused && this.items.length) {
                const job = this.items.shift();
                try {
                    await this.wait(job.jid);
                    job.resolve(await this.deliver(job));
                }
                catch (error) {
                    job.reject(error);
                }
            }
        }
        finally {
            this.running = false;
        }
        if (!this.items.length)
            this.notifyIdle();
    }
    /** wait until the delay, per-chat and per-minute rules allow the next send */
    async wait(jid) {
        const { delay = [800, 2500], perChatMs = 1500, perMinute = 25 } = this.opts;
        const now = this.now();
        this.sentAt = this.sentAt.filter(t => now - t < 60000);
        const random = this.opts.random ? this.opts.random() : Math.random();
        const gap = delay[0] + random * Math.max(0, delay[1] - delay[0]);
        let wait = Math.max(0, this.lastAt + gap - now, (this.chatAt.get(jid) ?? -Infinity) + perChatMs - now);
        if (perMinute > 0 && this.sentAt.length >= perMinute) {
            wait = Math.max(wait, this.sentAt[this.sentAt.length - perMinute] + 60000 - now);
        }
        if (wait > 0)
            await this.sleep(wait);
        const at = this.now();
        this.lastAt = at;
        this.chatAt.set(jid, at);
        this.sentAt.push(at);
        if (this.chatAt.size > 5000) {
            for (const [k, t] of this.chatAt)
                if (at - t > 60000)
                    this.chatAt.delete(k);
        }
    }
    async deliver(job) {
        const { retries = 1, retryDelayMs = 2000 } = this.opts;
        for (let attempt = 0;; attempt++) {
            try {
                return await this.raw(job.jid, job.content, job.options);
            }
            catch (error) {
                try {
                    this.opts.onError?.(error, { jid: job.jid, attempt });
                }
                catch {
                    // a throwing onError must not break the queue
                }
                if (attempt >= retries)
                    throw error;
                await this.sleep(retryDelayMs * 2 ** attempt);
            }
        }
    }
}
//# sourceMappingURL=send-queue.js.map