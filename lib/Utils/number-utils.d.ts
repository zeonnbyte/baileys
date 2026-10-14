/**
 * NumberResolver
 * Parser & resolver nomor WhatsApp: semua format nomor, semua kode negara,
 * konversi PN <-> LID, dan helper terkait (sender pesan, mention, kandidat JID).
 *
 * Tidak punya dependency runtime ke modul lain (hanya type structural), jadi aman dipakai di mana saja.
 */
export type NumberKind = 'pn' | 'lid' | 'hosted' | 'hosted.lid' | 'group' | 'broadcast' | 'newsletter' | 'bot' | 'unknown';
/** Subset dari LIDMappingStore (sock.signalRepository.lidMapping) */
export interface LIDStoreLike {
    getLIDForPN(pn: string): Promise<string | null>;
    getPNForLID(lid: string): Promise<string | null>;
    storeLIDPNMappings?(pairs: {
        lid: string;
        pn: string;
    }[]): Promise<void>;
}
export interface OnWhatsAppResult {
    jid: string;
    exists: boolean;
    lid?: string;
}
export interface NumberResolverOptions {
    /** Negara default untuk nomor lokal (tanpa kode negara). ISO2 ('ID') atau kode ('62' / '+62') */
    defaultCountry?: string;
    /** Biasanya sock.signalRepository.lidMapping */
    lidStore?: LIDStoreLike;
    /** Biasanya sock.onWhatsApp (dipakai untuk verifikasi kandidat nomor) */
    onWhatsApp?: (...jids: string[]) => Promise<OnWhatsAppResult[] | undefined>;
    /** 521xxxxxxxxxx -> 52xxxxxxxxxx (Meksiko). Default: true */
    fixMexico?: boolean;
}
export interface ParsedNumber {
    input: string;
    kind: NumberKind;
    user: string;
    server: string;
    device?: number;
    /** JID ternormalisasi, tanpa device & tanpa agent */
    jid: string;
    /** Hanya untuk PN */
    e164?: string;
    countryCode?: string;
    nationalNumber?: string;
    regions?: string[];
    valid: boolean;
    /** Ada lebih dari satu tafsiran (mis. nomor lokal vs internasional tanpa +) */
    ambiguous?: boolean;
    /** JID alternatif yang mungkin benar (ambigu, 9 Brasil, 9 Argentina, 521 Meksiko) */
    alternatives?: string[];
}
export interface ResolveResult {
    input: string;
    parsed: ParsedNumber | null;
    /** JID final yang dipakai buat kirim pesan, null kalau tidak ada di WhatsApp */
    jid: string | null;
    pn: string | null;
    lid: string | null;
    /** undefined = tidak diverifikasi (onWhatsApp tidak diset) */
    exists?: boolean;
}
export interface SenderInfo {
    pn: string | null;
    lid: string | null;
}
type KeyLike = {
    remoteJid?: string | null;
    participant?: string | null;
    remoteJidAlt?: string | null;
    participantAlt?: string | null;
};
type SockLike = {
    signalRepository?: {
        lidMapping?: LIDStoreLike;
    };
    onWhatsApp?: (...jids: string[]) => Promise<OnWhatsAppResult[] | undefined>;
};
export declare const getNationalLengthRange: (cc: string) => [number, number];
/** Cari kode negara dari awal digit (kode E.164 bersifat prefix-free) */
export declare const findCountryCode: (digits: string) => string | null;
/** ISO2 / '62' / '+62' -> '62' */
export declare const toCountryCode: (country?: string) => string | undefined;
/** Daftar region (ISO2) dari kode negara */
export declare const getRegions: (code: string) => string[];
/** Semua kode negara yang didukung */
export declare const getAllCountryCodes: () => string[];
export declare class NumberResolver {
    private readonly defaultCode?;
    private readonly lidStore?;
    private readonly onWhatsApp?;
    private readonly fixMexico;
    constructor(opts?: NumberResolverOptions);
    /**
     * Parse nomor/JID dalam format apa pun:
     * "+62 812-3456-7890", "0812 3456 7890", "(0812) 3456.7890", "0062812...", "62812...",
     * "wa.me/62812...", "@62812...", "62812...@c.us", "62812...:12@s.whatsapp.net", "123...@lid",
     * digit Arab/Persia/fullwidth, karakter tak terlihat, "+62 (0)812", ekstensi "x123".
     */
    parse(input: string | number | null | undefined): ParsedNumber | null;
    /** JID ternormalisasi (tanpa device). String kosong kalau tidak valid */
    normalizeJid(input: string | number | null | undefined): string;
    isValid(input: string | number | null | undefined): boolean;
    /** Bentuk yang enak dibaca / E.164 / JID */
    format(input: string | number, style?: 'e164' | 'international' | 'jid'): string | null;
    /** Sync: nomor -> JID PN (tanpa lookup LID). null kalau tidak valid */
    toJid(input: string | number): string | null;
    /** Kandidat JID (urut dari paling mungkin) untuk satu nomor */
    candidates(input: string | number): string[];
    /** Ambil semua nomor valid dari teks bebas (termasuk mention @628...) */
    extract(text: string): ParsedNumber[];
    /** Ambil mention "@digit" dari teks sebagai JID mentah (PN atau LID belum dibedakan) */
    extractMentionDigits(text: string): string[];
    info(code: string): {
        code: string;
        regions: string[];
    } | null;
    /** Nomor / JID apa pun -> JID PN (tanpa device). null kalau tidak ketemu */
    toPN(input: string | number): Promise<string | null>;
    /** Nomor / JID apa pun -> JID LID (tanpa device). null kalau mapping belum ada */
    toLID(input: string | number): Promise<string | null>;
    toBoth(input: string | number): Promise<SenderInfo>;
    /** Apakah dua identitas (PN/LID/nomor mentah) orang yang sama */
    sameUser(a: string | number, b: string | number): Promise<boolean>;
    /**
     * Resolve nomor jadi JID siap kirim. Kalau onWhatsApp diset, semua kandidat
     * (nomor lokal/internasional, 9 Brasil/Argentina, 521 Meksiko) dicek dan yang terdaftar dipakai.
     */
    resolve(input: string | number): Promise<ResolveResult>;
    /**
     * Ambil pengirim (PN + LID) dari message key.
     * Memakai participant / remoteJid dan field alt (participantAlt, remoteJidAlt) kalau ada.
     */
    senderOf(key: KeyLike): Promise<SenderInfo>;
    /** Simpan pasangan PN <-> LID yang kamu tahu ke mapping store (sinkron dengan Signal). true kalau tersimpan */
    learn(a: string | number, b: string | number): Promise<boolean>;
    /** Resolve banyak input sekaligus (paralel) */
    resolveMany(inputs: (string | number)[]): Promise<ResolveResult[]>;
    private isPnLike;
    private isLidLike;
    /** parse + deteksi angka polos yang sebenarnya LID (cek ke mapping store) */
    private identify;
    private lidToPN;
    private pnToLID;
    private safe;
    private parseJid;
    private parseNumber;
    private buildPN;
}
/** Buat NumberResolver langsung dari socket (otomatis pakai lidMapping & onWhatsApp) */
export declare const makeNumberResolver: (sock: SockLike, opts?: Omit<NumberResolverOptions, "lidStore" | "onWhatsApp">) => NumberResolver;
export {};
//# sourceMappingURL=number-utils.d.ts.map