import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Patch@Zeonn: auto convert audio/mp3 to voice note (VN) for channels (@newsletter). Needs ffmpeg.
export const VN_MIMETYPE = 'audio/ogg; codecs=opus';
export class AudioToVN {
    constructor(opts = {}) {
        this.ffmpegPath = opts.ffmpegPath || 'ffmpeg';
        this.bitrate = opts.bitrate || '48k';
        this.timeoutMs = opts.timeoutMs ?? 60000;
        this.logger = opts.logger;
    }
    supports(jid) {
        return jid.endsWith('@newsletter');
    }
    needsConversion(content) {
        if (!content || typeof content !== 'object')
            return false;
        const c = content;
        if (!c.audio)
            return false;
        const mime = String(c.mimetype || '').toLowerCase();
        const alreadyVN = c.ptt === true && mime.includes('ogg') && mime.includes('opus');
        return !alreadyVN;
    }
    async toBuffer(input) {
        if (Buffer.isBuffer(input))
            return input;
        if (typeof input === 'string')
            return this.fromLocationOrUrl(input);
        if ('url' in input)
            return this.fromLocationOrUrl(input.url.toString());
        if ('stream' in input) {
            const chunks = [];
            for await (const chunk of input.stream)
                chunks.push(Buffer.from(chunk));
            return Buffer.concat(chunks);
        }
        throw new Error('unsupported audio input');
    }
    async fromLocationOrUrl(location) {
        if (/^https?:\/\//i.test(location)) {
            const res = await fetch(location);
            if (!res.ok)
                throw new Error(`failed to download audio (${res.status})`);
            return Buffer.from(await res.arrayBuffer());
        }
        return fs.readFile(location);
    }
    runFfmpeg(inPath, outPath) {
        return new Promise((resolve, reject) => {
            const args = ['-y', '-i', inPath, '-vn', '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', this.bitrate, '-ar', '48000', '-ac', '1', '-application', 'voip', '-f', 'ogg', outPath];
            const proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = '';
            proc.stderr.on('data', d => {
                stderr = (stderr + d.toString()).slice(-2000);
            });
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                reject(new Error('ffmpeg timeout'));
            }, this.timeoutMs);
            proc.on('error', err => {
                clearTimeout(timer);
                reject(err);
            });
            proc.on('close', code => {
                clearTimeout(timer);
                if (code === 0)
                    resolve();
                else
                    reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().split('\n').pop()}`));
            });
        });
    }
    /** audio in (mp3, m4a, wav, ...), Ogg Opus buffer out */
    async convert(input) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const inPath = join(tmpdir(), `vn-in-${id}`);
        const outPath = join(tmpdir(), `vn-out-${id}.ogg`);
        try {
            await fs.writeFile(inPath, await this.toBuffer(input));
            await this.runFfmpeg(inPath, outPath);
            return await fs.readFile(outPath);
        }
        finally {
            await fs.unlink(inPath).catch(() => { });
            await fs.unlink(outPath).catch(() => { });
        }
    }
    /** returns new content (ptt + opus) when converted, otherwise the same content */
    async process(jid, content) {
        if (!this.supports(jid) || !this.needsConversion(content))
            return content;
        const c = content;
        try {
            const ogg = await this.convert(c.audio);
            const { seconds, waveform, ...rest } = c;
            return { ...rest, audio: ogg, ptt: true, mimetype: VN_MIMETYPE };
        }
        catch (error) {
            this.logger?.warn({ trace: error?.stack, jid }, 'audio to VN failed, sending the original audio');
            return content;
        }
    }
}
//# sourceMappingURL=audio-to-vn.js.map