export type LinkType = 'whatsapp-group' | 'whatsapp-channel' | 'whatsapp' | 'url';
export type LinkInfo = {
    /** the link as found in the text (trailing punctuation removed) */
    raw: string;
    /** normalized absolute URL: https://host/path */
    url: string;
    /** lower-case host without "www." */
    host: string;
    type: LinkType;
    /** group invite code or channel id, when the link has one */
    code?: string;
    /** true when the link had no http(s):// in front of it (e.g. "example.com/x") */
    bare: boolean;
};
export type LinkCheckResult = {
    /** any link at all */
    found: boolean;
    links: LinkInfo[];
    /** links that are not allowed (this is what an anti-link feature acts on) */
    blocked: LinkInfo[];
    /** links that matched the allow list */
    allowed: LinkInfo[];
};
export type LinkDetectorOptions = {
    /** domains that are fine, subdomains included: ['youtube.com'] also allows m.youtube.com */
    allowDomains?: string[];
    /** group invite codes / channel ids that are fine (e.g. your own group's invite code) */
    allowCodes?: string[];
    /** when set, ONLY these domains count as blocked; every other link is ignored */
    blockDomains?: string[];
    /** also detect links without http(s):// like "example.com/abc" (default: true) */
    detectBare?: boolean;
    /** block links to WhatsApp groups / channels / wa.me even when their domain is allowed (default: true) */
    alwaysBlockWhatsApp?: boolean;
};
/** every text piece of a message (text, captions, link preview URLs) including wrapped messages like ephemeral / view once / edited */
export declare const getMessageTexts: (message: Record<string, any> | null | undefined, depth?: number, out?: Set<string>) => string[];
export declare const extractLinks: (text: string, detectBare?: boolean) => LinkInfo[];
export declare class LinkDetector {
    private readonly options;
    private readonly allowDomains;
    private readonly allowCodes;
    private readonly blockDomains;
    constructor(options?: LinkDetectorOptions);
    allowDomain(domain: string): this;
    disallowDomain(domain: string): this;
    /** allow one specific group invite code / channel id */
    allowCode(code: string): this;
    disallowCode(code: string): this;
    /** all links in a string or in a message (any type) */
    extract(input: string | Record<string, any> | null | undefined): LinkInfo[];
    /** does this link match the allow list? */
    isAllowed(link: LinkInfo): boolean;
    /** is this link something an anti-link feature should act on? */
    isBlocked(link: LinkInfo): boolean;
    /** quick yes/no: does the string / message contain any link? */
    has(input: string | Record<string, any> | null | undefined): boolean;
    /** full result for a string or message: all links, and which of them are blocked / allowed */
    check(input: string | Record<string, any> | null | undefined): LinkCheckResult;
}
//# sourceMappingURL=link-detector.d.ts.map