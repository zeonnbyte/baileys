import type { Readable } from 'stream';
import type { ILogger } from '../../Utils/logger.js';
export declare const VN_MIMETYPE = "audio/ogg; codecs=opus";
export type AudioToVNOptions = {
    ffmpegPath?: string;
    bitrate?: string;
    timeoutMs?: number;
    logger?: ILogger;
};
type AudioInput = Buffer | {
    url: string | URL;
} | {
    stream: Readable;
} | string;
export declare class AudioToVN {
    private readonly ffmpegPath;
    private readonly bitrate;
    private readonly timeoutMs;
    private readonly logger?;
    constructor(opts?: AudioToVNOptions);
    supports(jid: string): boolean;
    needsConversion(content: unknown): boolean;
    private toBuffer;
    private fromLocationOrUrl;
    private runFfmpeg;
    /** audio in (mp3, m4a, wav, ...), Ogg Opus buffer out */
    convert(input: AudioInput): Promise<Buffer>;
    /** returns new content (ptt + opus) when converted, otherwise the same content */
    process<T>(jid: string, content: T): Promise<T>;
}
export {};
//# sourceMappingURL=audio-to-vn.d.ts.map