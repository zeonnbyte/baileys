// Patch@Zeonn: LinkDetector — finds and classifies links in any message type. Meant as the building block for anti-link features.
const TLDS = [
    'com', 'net', 'org', 'info', 'biz', 'xyz', 'online', 'site', 'store', 'shop', 'club', 'top', 'vip', 'live',
    'link', 'app', 'dev', 'io', 'co', 'me', 'id', 'gg', 'ly', 'tv', 'cc', 'to', 'ai', 'us', 'uk', 'in', 'ru',
    'cn', 'jp', 'kr', 'sg', 'my', 'ph', 'th', 'vn', 'au', 'de', 'fr', 'nl', 'br', 'tk', 'ml', 'ga', 'cf', 'gq',
    'fun', 'pro', 'tech', 'cloud', 'page', 'space', 'website', 'win', 'bet', 'casino', 'ws', 'sh', 'so', 'is',
    'be', 'ch', 'es', 'it', 'pl', 'eu', 'ca', 'mx', 'ar', 'cl', 'tr', 'ir', 'pk', 'bd', 'lk', 'np', 'za', 'ng'
];
const URL_REGEX = new RegExp([
    '(?:https?:\\/\\/|www\\.)[^\\s<>"\']+',
    `(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS.join('|')})(?![a-z0-9-])(?::\\d{1,5})?(?:[\\/?#][^\\s<>"']*)?`
].join('|'), 'gi');
const TRAILING = /[.,;:!?)\]}'"»”’*_~]+$/;
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g;
/** undo common obfuscation: zero-width chars, full-width characters, "[.]" / "(.)", spaces around dots in known hosts */
const normalizeText = (text) => text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}/g, '.')
    .replace(/\bhxxps?:\/\//gi, m => (m.toLowerCase().startsWith('hxxps') ? 'https://' : 'http://'))
    .replace(/\b(chat|api|wa)\s*\.\s*(whatsapp)\s*\.\s*(com)\b/gi, '$1.$2.$3')
    .replace(/\bwhatsapp\s*\.\s*com\b/gi, 'whatsapp.com');
const classify = (host, path) => {
    if (host === 'chat.whatsapp.com') {
        const code = path.split(/[/?#]/).filter(Boolean)[0];
        return { type: 'whatsapp-group', code };
    }
    if (host === 'whatsapp.com' || host === 'api.whatsapp.com') {
        const parts = path.split(/[/?#]/).filter(Boolean);
        if (parts[0] === 'channel' && parts[1])
            return { type: 'whatsapp-channel', code: parts[1] };
        return { type: 'whatsapp' };
    }
    if (host === 'wa.me' || host === 'wa.link')
        return { type: 'whatsapp' };
    return { type: 'url' };
};
/** every text piece of a message (text, captions, link preview URLs) including wrapped messages like ephemeral / view once / edited */
export const getMessageTexts = (message, depth = 0, out = new Set()) => {
    if (!message || typeof message !== 'object' || depth > 6)
        return [...out];
    for (const [key, value] of Object.entries(message)) {
        if (typeof value === 'string') {
            if (['conversation', 'text', 'caption', 'matchedText', 'canonicalUrl', 'selectedDisplayText'].includes(key) && value)
                out.add(value);
        }
        else if (value && typeof value === 'object') {
            getMessageTexts(value, depth + 1, out);
        }
    }
    return [...out];
};
export const extractLinks = (text, detectBare = true) => {
    const links = [];
    const seen = new Set();
    for (const match of normalizeText(text).matchAll(URL_REGEX)) {
        let raw = match[0].replace(TRAILING, '');
        if (!raw)
            continue;
        const hasScheme = /^https?:\/\//i.test(raw);
        const bare = !hasScheme && !/^www\./i.test(raw);
        if (bare && !detectBare)
            continue;
        // "name@example.com" is an e-mail address, not a link
        const before = match.index > 0 ? normalizeText(text).charAt(match.index - 1) : '';
        if (before === '@')
            continue;
        let parsed;
        try {
            parsed = new URL(hasScheme ? raw : `https://${raw}`);
        }
        catch {
            continue;
        }
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (!host.includes('.'))
            continue;
        const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        const { type, code } = classify(host, parsed.pathname);
        const url = `https://${host}${path === '/' ? '' : path}`;
        if (seen.has(url))
            continue;
        seen.add(url);
        raw = raw.trim();
        links.push({ raw, url, host, type, ...(code ? { code } : {}), bare });
    }
    return links;
};
const matchesDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const cleanDomain = (d) => d.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
export class LinkDetector {
    constructor(options = {}) {
        this.options = options;
        this.allowDomains = new Set((options.allowDomains || []).map(cleanDomain).filter(Boolean));
        this.allowCodes = new Set(options.allowCodes || []);
        this.blockDomains = new Set((options.blockDomains || []).map(cleanDomain).filter(Boolean));
    }
    allowDomain(domain) {
        this.allowDomains.add(cleanDomain(domain));
        return this;
    }
    disallowDomain(domain) {
        this.allowDomains.delete(cleanDomain(domain));
        return this;
    }
    /** allow one specific group invite code / channel id */
    allowCode(code) {
        this.allowCodes.add(code);
        return this;
    }
    disallowCode(code) {
        this.allowCodes.delete(code);
        return this;
    }
    /** all links in a string or in a message (any type) */
    extract(input) {
        const texts = typeof input === 'string' ? [input] : getMessageTexts(input);
        const seen = new Set();
        const links = [];
        for (const text of texts) {
            for (const link of extractLinks(text, this.options.detectBare !== false)) {
                if (!seen.has(link.url)) {
                    seen.add(link.url);
                    links.push(link);
                }
            }
        }
        return links;
    }
    /** does this link match the allow list? */
    isAllowed(link) {
        if (link.code && this.allowCodes.has(link.code))
            return true;
        const isWa = link.type !== 'url';
        if (isWa && this.options.alwaysBlockWhatsApp !== false)
            return false;
        return [...this.allowDomains].some(d => matchesDomain(link.host, d));
    }
    /** is this link something an anti-link feature should act on? */
    isBlocked(link) {
        if (this.isAllowed(link))
            return false;
        if (this.blockDomains.size)
            return [...this.blockDomains].some(d => matchesDomain(link.host, d));
        return true;
    }
    /** quick yes/no: does the string / message contain any link? */
    has(input) {
        return this.extract(input).length > 0;
    }
    /** full result for a string or message: all links, and which of them are blocked / allowed */
    check(input) {
        const links = this.extract(input);
        const blocked = links.filter(l => this.isBlocked(l));
        const allowed = links.filter(l => this.isAllowed(l));
        return { found: links.length > 0, links, blocked, allowed };
    }
}
//# sourceMappingURL=link-detector.js.map