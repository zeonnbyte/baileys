/**
 * NumberResolver
 * Parser & resolver nomor WhatsApp: semua format nomor, semua kode negara,
 * konversi PN <-> LID, dan helper terkait (sender pesan, mention, kandidat JID).
 *
 * Tidak punya dependency runtime ke modul lain (hanya type structural), jadi aman dipakai di mana saja.
 */

export type NumberKind =
	| 'pn'
	| 'lid'
	| 'hosted'
	| 'hosted.lid'
	| 'group'
	| 'broadcast'
	| 'newsletter'
	| 'bot'
	| 'unknown'

/** Subset dari LIDMappingStore (sock.signalRepository.lidMapping) */
export interface LIDStoreLike {
	getLIDForPN(pn: string): Promise<string | null>
	getPNForLID(lid: string): Promise<string | null>
	storeLIDPNMappings?(pairs: { lid: string; pn: string }[]): Promise<void>
}

export interface OnWhatsAppResult {
	jid: string
	exists: boolean
	lid?: string
}

export interface NumberResolverOptions {
	/** Negara default untuk nomor lokal (tanpa kode negara). ISO2 ('ID') atau kode ('62' / '+62') */
	defaultCountry?: string
	/** Biasanya sock.signalRepository.lidMapping */
	lidStore?: LIDStoreLike
	/** Biasanya sock.onWhatsApp (dipakai untuk verifikasi kandidat nomor) */
	onWhatsApp?: (...jids: string[]) => Promise<OnWhatsAppResult[] | undefined>
	/** 521xxxxxxxxxx -> 52xxxxxxxxxx (Meksiko). Default: true */
	fixMexico?: boolean
}

export interface ParsedNumber {
	input: string
	kind: NumberKind
	user: string
	server: string
	device?: number
	/** JID ternormalisasi, tanpa device & tanpa agent */
	jid: string
	/** Hanya untuk PN */
	e164?: string
	countryCode?: string
	nationalNumber?: string
	regions?: string[]
	valid: boolean
	/** Ada lebih dari satu tafsiran (mis. nomor lokal vs internasional tanpa +) */
	ambiguous?: boolean
	/** JID alternatif yang mungkin benar (ambigu, 9 Brasil, 9 Argentina, 521 Meksiko) */
	alternatives?: string[]
}

export interface ResolveResult {
	input: string
	parsed: ParsedNumber | null
	/** JID final yang dipakai buat kirim pesan, null kalau tidak ada di WhatsApp */
	jid: string | null
	pn: string | null
	lid: string | null
	/** undefined = tidak diverifikasi (onWhatsApp tidak diset) */
	exists?: boolean
}

export interface SenderInfo {
	pn: string | null
	lid: string | null
}

type KeyLike = {
	remoteJid?: string | null
	participant?: string | null
	remoteJidAlt?: string | null
	participantAlt?: string | null
}

type SockLike = {
	signalRepository?: { lidMapping?: LIDStoreLike }
	onWhatsApp?: (...jids: string[]) => Promise<OnWhatsAppResult[] | undefined>
}

// ---------------------------------------------------------------------------
// Tabel kode negara (E.164, prefix-free)
// ---------------------------------------------------------------------------

const RAW_CODES = `1:US,CA,AG,AI,AS,BB,BM,BS,DM,DO,GD,GU,JM,KN,KY,LC,MP,MS,PR,SX,TC,TT,VC,VG,VI;7:RU,KZ;20:EG;27:ZA;30:GR;31:NL;32:BE;33:FR;34:ES;36:HU;39:IT,VA;40:RO;41:CH;43:AT;44:GB,GG,IM,JE;45:DK;46:SE;47:NO,SJ;48:PL;49:DE;51:PE;52:MX;53:CU;54:AR;55:BR;56:CL;57:CO;58:VE;60:MY;61:AU,CX,CC;62:ID;63:PH;64:NZ;65:SG;66:TH;81:JP;82:KR;84:VN;86:CN;90:TR;91:IN;92:PK;93:AF;94:LK;95:MM;98:IR;211:SS;212:MA,EH;213:DZ;216:TN;218:LY;220:GM;221:SN;222:MR;223:ML;224:GN;225:CI;226:BF;227:NE;228:TG;229:BJ;230:MU;231:LR;232:SL;233:GH;234:NG;235:TD;236:CF;237:CM;238:CV;239:ST;240:GQ;241:GA;242:CG;243:CD;244:AO;245:GW;246:IO;247:AC;248:SC;249:SD;250:RW;251:ET;252:SO;253:DJ;254:KE;255:TZ;256:UG;257:BI;258:MZ;260:ZM;261:MG;262:RE,YT;263:ZW;264:NA;265:MW;266:LS;267:BW;268:SZ;269:KM;290:SH,TA;291:ER;297:AW;298:FO;299:GL;350:GI;351:PT;352:LU;353:IE;354:IS;355:AL;356:MT;357:CY;358:FI,AX;359:BG;370:LT;371:LV;372:EE;373:MD;374:AM;375:BY;376:AD;377:MC;378:SM;380:UA;381:RS;382:ME;383:XK;385:HR;386:SI;387:BA;389:MK;420:CZ;421:SK;423:LI;500:FK;501:BZ;502:GT;503:SV;504:HN;505:NI;506:CR;507:PA;508:PM;509:HT;590:GP,BL,MF;591:BO;592:GY;593:EC;594:GF;595:PY;596:MQ;597:SR;598:UY;599:CW,BQ;670:TL;672:NF,AQ;673:BN;674:NR;675:PG;676:TO;677:SB;678:VU;679:FJ;680:PW;681:WF;682:CK;683:NU;685:WS;686:KI;687:NC;688:TV;689:PF;690:TK;691:FM;692:MH;850:KP;852:HK;853:MO;855:KH;856:LA;880:BD;886:TW;960:MV;961:LB;962:JO;963:SY;964:IQ;965:KW;966:SA;967:YE;968:OM;970:PS;971:AE;972:IL;973:BH;974:QA;975:BT;976:MN;977:NP;992:TJ;993:TM;994:AZ;995:GE;996:KG;998:UZ;800:001;808:001;870:001;878:001;881:001;882:001;883:001;888:001;979:001`

const CODE_TO_REGIONS = new Map<string, string[]>()
const ISO_TO_CODE = new Map<string, string>()
for (const entry of RAW_CODES.split(';')) {
	const [code, regions] = entry.split(':') as [string, string]
	const list = regions.split(',')
	CODE_TO_REGIONS.set(code, list)
	for (const iso of list) {
		if (iso !== '001' && !ISO_TO_CODE.has(iso)) ISO_TO_CODE.set(iso, code)
	}
}

/** Kode negara yang nomor lokalnya memang diawali 0 (jangan dibuang) */
const KEEP_LEADING_ZERO = new Set(['39', '225'])
/** Trunk prefix selain "0" */
const TRUNK_PREFIX: Record<string, string> = { '1': '1', '7': '8' }
/** Panjang maksimum nomor nasional (tanpa trunk) untuk deteksi nomor lokal */
const MAX_NATIONAL: Record<string, number> = {
	'1': 10, '7': 10, '20': 10, '27': 9, '33': 9, '34': 9, '39': 10, '44': 10, '49': 11, '52': 10,
	'55': 11, '60': 10, '62': 12, '63': 10, '65': 8, '66': 9, '81': 10, '82': 10, '84': 10, '86': 11,
	'90': 10, '91': 10, '92': 10, '212': 9, '234': 10, '254': 9, '880': 10, '966': 9, '971': 9
}

/** Rentang panjang nomor nasional (tanpa kode negara & trunk) [min, max]. Selain ini: 4..(15 - panjang kode) */
const NSN_LENGTH: Record<string, [number, number]> = {
	'1': [10, 10], '7': [10, 10], '20': [8, 10], '27': [9, 9], '33': [9, 9], '34': [9, 9], '39': [6, 11],
	'44': [7, 10], '49': [6, 13], '52': [10, 11], '54': [10, 11], '55': [10, 11], '60': [7, 10], '62': [7, 12],
	'63': [8, 10], '65': [8, 8], '66': [8, 9], '81': [9, 10], '82': [8, 11], '84': [8, 10], '86': [7, 12],
	'90': [10, 10], '91': [10, 10], '92': [8, 10], '212': [9, 9], '234': [7, 10], '254': [7, 10], '880': [9, 10],
	'966': [8, 9], '971': [8, 9]
}

export const getNationalLengthRange = (cc: string): [number, number] =>
	NSN_LENGTH[cc] ?? [4, 15 - cc.length]

const SERVER_KIND: Record<string, NumberKind> = {
	's.whatsapp.net': 'pn',
	'c.us': 'pn',
	lid: 'lid',
	hosted: 'hosted',
	'hosted.lid': 'hosted.lid',
	'g.us': 'group',
	broadcast: 'broadcast',
	newsletter: 'newsletter',
	bot: 'bot'
}

const PN_SERVER = 's.whatsapp.net'

// ---------------------------------------------------------------------------
// Helper murni
// ---------------------------------------------------------------------------

/** Bersihkan karakter tak terlihat & ubah digit non-ASCII (fullwidth, Arab, Persia) ke ASCII */
const cleanInput = (s: string): string =>
	s
		.normalize('NFKC')
		.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
		.replace(/[\u0660-\u0669]/g, ch => String(ch.charCodeAt(0) - 0x0660))
		.replace(/[\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) - 0x06f0))
		.trim()

/** Cari kode negara dari awal digit (kode E.164 bersifat prefix-free) */
export const findCountryCode = (digits: string): string | null => {
	for (let len = 1; len <= 3; len++) {
		const c = digits.slice(0, len)
		if (CODE_TO_REGIONS.has(c)) return c
	}

	return null
}

/** ISO2 / '62' / '+62' -> '62' */
export const toCountryCode = (country?: string): string | undefined => {
	if (!country) return undefined
	const c = cleanInput(country).replace(/^\+/, '').toUpperCase()
	if (/^\d+$/.test(c)) return CODE_TO_REGIONS.has(c) ? c : undefined
	return ISO_TO_CODE.get(c)
}

/** Daftar region (ISO2) dari kode negara */
export const getRegions = (code: string): string[] => CODE_TO_REGIONS.get(code.replace(/^\+/, '')) ?? []

/** Semua kode negara yang didukung */
export const getAllCountryCodes = (): string[] => [...CODE_TO_REGIONS.keys()]

const groupDigits = (nsn: string): string => {
	const parts: string[] = []
	let rest = nsn
	const sizes = [3, 4]
	let i = 0
	while (rest.length > 0) {
		const size = sizes[i++] ?? 4
		if (rest.length <= size + 1) {
			parts.push(rest)
			break
		}

		parts.push(rest.slice(0, size))
		rest = rest.slice(size)
	}

	return parts.join('-')
}

// ---------------------------------------------------------------------------
// NumberResolver
// ---------------------------------------------------------------------------

export class NumberResolver {
	private readonly defaultCode?: string
	private readonly lidStore?: LIDStoreLike
	private readonly onWhatsApp?: NumberResolverOptions['onWhatsApp']
	private readonly fixMexico: boolean

	constructor(opts: NumberResolverOptions = {}) {
		this.defaultCode = toCountryCode(opts.defaultCountry)
		this.lidStore = opts.lidStore
		this.onWhatsApp = opts.onWhatsApp
		this.fixMexico = opts.fixMexico ?? true
	}

	// ------------------------------ parsing (sync) ------------------------------

	/**
	 * Parse nomor/JID dalam format apa pun:
	 * "+62 812-3456-7890", "0812 3456 7890", "(0812) 3456.7890", "0062812...", "62812...",
	 * "wa.me/62812...", "@62812...", "62812...@c.us", "62812...:12@s.whatsapp.net", "123...@lid",
	 * digit Arab/Persia/fullwidth, karakter tak terlihat, "+62 (0)812", ekstensi "x123".
	 */
	parse(input: string | number | null | undefined): ParsedNumber | null {
		if (input === null || input === undefined) return null
		let raw = cleanInput(String(input))
		if (!raw) return null

		// link wa.me / ?phone=  -> selalu internasional
		const url = raw.match(/(?:wa\.me\/|[?&]phone=)\+?(\d[\d\s().-]*)/i)
		if (url) raw = '+' + url[1]!.replace(/\D/g, '')

		// mention "@628..."
		if (raw.startsWith('@')) raw = raw.slice(1)

		if (raw.includes('@')) return this.parseJid(String(input), raw)
		return this.parseNumber(String(input), raw)
	}

	/** JID ternormalisasi (tanpa device). String kosong kalau tidak valid */
	normalizeJid(input: string | number | null | undefined): string {
		return this.parse(input)?.jid ?? ''
	}

	isValid(input: string | number | null | undefined): boolean {
		return !!this.parse(input)?.valid
	}

	/** Bentuk yang enak dibaca / E.164 / JID */
	format(input: string | number, style: 'e164' | 'international' | 'jid' = 'e164'): string | null {
		const p = this.parse(input)
		if (!p || p.kind !== 'pn' || !p.valid) return null
		if (style === 'jid') return p.jid
		if (style === 'e164') return p.e164!
		return `+${p.countryCode} ${groupDigits(p.nationalNumber!)}`
	}

	/** Sync: nomor -> JID PN (tanpa lookup LID). null kalau tidak valid */
	toJid(input: string | number): string | null {
		const p = this.parse(input)
		if (!p) return null
		if (p.kind === 'pn') return p.valid ? p.jid : null
		return p.jid
	}

	/** Kandidat JID (urut dari paling mungkin) untuk satu nomor */
	candidates(input: string | number): string[] {
		const p = this.parse(input)
		if (!p || !p.valid) return []
		return [p.jid, ...(p.alternatives ?? [])]
	}

	/** Ambil semua nomor valid dari teks bebas (termasuk mention @628...) */
	extract(text: string): ParsedNumber[] {
		const found = new Map<string, ParsedNumber>()
		const clean = cleanInput(text)
		const matches = clean.match(/\+?\(?\d[\d\s().-]{5,}\d|@\d{6,16}/g) ?? []
		for (const m of matches) {
			const p = this.parse(m)
			if (p?.valid && p.kind === 'pn' && !found.has(p.jid)) found.set(p.jid, p)
		}

		return [...found.values()]
	}

	/** Ambil mention "@digit" dari teks sebagai JID mentah (PN atau LID belum dibedakan) */
	extractMentionDigits(text: string): string[] {
		return [...new Set([...cleanInput(text).matchAll(/@(\d{6,16})\b/g)].map(m => m[1]!))]
	}

	info(code: string) {
		const c = toCountryCode(code)
		return c ? { code: c, regions: getRegions(c) } : null
	}

	// ------------------------------ LID / PN (async) ------------------------------

	/** Nomor / JID apa pun -> JID PN (tanpa device). null kalau tidak ketemu */
	async toPN(input: string | number): Promise<string | null> {
		const p = await this.identify(input)
		if (!p) return null
		if (this.isPnLike(p)) return p.valid || p.kind === 'hosted' ? p.jid : null
		if (this.isLidLike(p)) return this.lidToPN(p.user)
		return null
	}

	/** Nomor / JID apa pun -> JID LID (tanpa device). null kalau mapping belum ada */
	async toLID(input: string | number): Promise<string | null> {
		const p = await this.identify(input)
		if (!p) return null
		if (this.isLidLike(p)) return p.jid
		if (this.isPnLike(p) && p.valid) return this.pnToLID(p.user)
		return null
	}

	async toBoth(input: string | number): Promise<SenderInfo> {
		const p = await this.identify(input)
		if (!p) return { pn: null, lid: null }
		if (this.isLidLike(p)) return { lid: p.jid, pn: await this.lidToPN(p.user) }
		if (this.isPnLike(p) && p.valid) return { pn: p.jid, lid: await this.pnToLID(p.user) }
		return { pn: null, lid: null }
	}

	/** Apakah dua identitas (PN/LID/nomor mentah) orang yang sama */
	async sameUser(a: string | number, b: string | number): Promise<boolean> {
		const pa = this.parse(a)
		const pb = this.parse(b)
		if (!pa || !pb) return false
		if (pa.user === pb.user && pa.server === pb.server) return true
		const [x, y] = await Promise.all([this.toBoth(a), this.toBoth(b)])
		return (!!x.pn && x.pn === y.pn) || (!!x.lid && x.lid === y.lid)
	}

	/**
	 * Resolve nomor jadi JID siap kirim. Kalau onWhatsApp diset, semua kandidat
	 * (nomor lokal/internasional, 9 Brasil/Argentina, 521 Meksiko) dicek dan yang terdaftar dipakai.
	 */
	async resolve(input: string | number): Promise<ResolveResult> {
		const base: ResolveResult = { input: String(input), parsed: null, jid: null, pn: null, lid: null }
		const p = await this.identify(input)
		if (!p) return base
		base.parsed = p

		if (this.isLidLike(p)) {
			const pn = await this.lidToPN(p.user)
			return { ...base, jid: p.jid, lid: p.jid, pn }
		}

		if (!this.isPnLike(p) || !p.valid) {
			return { ...base, jid: p.kind === 'pn' ? null : p.jid }
		}

		const list = [p.jid, ...(p.alternatives ?? [])]
		if (!this.onWhatsApp) {
			return { ...base, jid: p.jid, pn: p.jid, lid: await this.pnToLID(p.user) }
		}

		let results: OnWhatsAppResult[] = []
		try {
			results = (await this.onWhatsApp(...list)) ?? []
		} catch {
			results = []
		}

		for (const cand of list) {
			const hit = results.find(r => r.exists && this.parse(r.jid)?.jid === cand)
			if (hit) {
				const lid = hit.lid ? (this.parse(hit.lid)?.jid ?? null) : await this.pnToLID(this.parse(cand)!.user)
				return { ...base, jid: cand, pn: cand, lid, exists: true }
			}
		}

		return { ...base, exists: false }
	}

	/**
	 * Ambil pengirim (PN + LID) dari message key.
	 * Memakai participant / remoteJid dan field alt (participantAlt, remoteJidAlt) kalau ada.
	 */
	async senderOf(key: KeyLike): Promise<SenderInfo> {
		const out: SenderInfo = { pn: null, lid: null }
		const raws = [key.participant, key.participantAlt, key.remoteJid, key.remoteJidAlt]
		for (const r of raws) {
			if (!r) continue
			const p = this.parse(r)
			if (!p || (!this.isPnLike(p) && !this.isLidLike(p))) continue
			if (this.isLidLike(p)) out.lid ??= p.jid
			else if (p.valid) out.pn ??= p.jid
		}

		if (out.pn && out.lid) return out
		const seed = out.pn ?? out.lid
		if (!seed) return out
		const both = await this.toBoth(seed)
		return { pn: out.pn ?? both.pn, lid: out.lid ?? both.lid }
	}

	/** Simpan pasangan PN <-> LID yang kamu tahu ke mapping store (sinkron dengan Signal). true kalau tersimpan */
	async learn(a: string | number, b: string | number): Promise<boolean> {
		if (!this.lidStore?.storeLIDPNMappings) return false
		const pa = this.parse(a)
		const pb = this.parse(b)
		if (!pa || !pb) return false
		const pn = [pa, pb].find(x => x.kind === 'pn' && x.valid)
		const lid = [pa, pb].find(x => x.kind === 'lid')
		if (!pn || !lid) return false
		return (await this.safe(async () => {
			await this.lidStore!.storeLIDPNMappings!([{ lid: lid.jid, pn: pn.jid }])
			return true
		})) ?? false
	}

	/** Resolve banyak input sekaligus (paralel) */
	async resolveMany(inputs: (string | number)[]): Promise<ResolveResult[]> {
		return Promise.all(inputs.map(i => this.resolve(i)))
	}

	// ------------------------------ internal ------------------------------

	private isPnLike(p: ParsedNumber) {
		return p.kind === 'pn' || p.kind === 'hosted'
	}

	private isLidLike(p: ParsedNumber) {
		return p.kind === 'lid' || p.kind === 'hosted.lid'
	}

	/** parse + deteksi angka polos yang sebenarnya LID (cek ke mapping store) */
	private async identify(input: string | number | null | undefined): Promise<ParsedNumber | null> {
		const p = this.parse(input)
		if (!p) return null
		const bare = !String(input).includes('@') || String(input).startsWith('@')
		if (bare && p.kind === 'pn' && this.lidStore && (!p.valid || p.user.length >= 14)) {
			const digits = String(p.input).replace(/\D/g, '')
			if (digits) {
				const pn = await this.safe(() => this.lidStore!.getPNForLID(`${digits}@lid`))
				if (pn) return this.parse(`${digits}@lid`)
			}
		}

		return p
	}

	private async lidToPN(lidUser: string): Promise<string | null> {
		if (!this.lidStore) return null
		const r = await this.safe(() => this.lidStore!.getPNForLID(`${lidUser}@lid`))
		const p = r ? this.parse(r) : null
		return p && p.kind === 'pn' ? p.jid : null
	}

	private async pnToLID(pnUser: string): Promise<string | null> {
		if (!this.lidStore) return null
		const r = await this.safe(() => this.lidStore!.getLIDForPN(`${pnUser}@${PN_SERVER}`))
		const p = r ? this.parse(r) : null
		return p && p.kind === 'lid' ? p.jid : null
	}

	private async safe<T>(fn: () => Promise<T>): Promise<T | null> {
		try {
			return await fn()
		} catch {
			return null
		}
	}

	private parseJid(original: string, raw: string): ParsedNumber | null {
		const at = raw.indexOf('@')
		const userPart = raw.slice(0, at)
		const serverRaw = raw.slice(at + 1).toLowerCase()
		if (!userPart || !serverRaw) return null

		const [userAgent, dev] = userPart.split(':') as [string, string | undefined]
		let user = userAgent.split('_')[0]!
		const kind = SERVER_KIND[serverRaw] ?? 'unknown'
		const server = serverRaw === 'c.us' ? PN_SERVER : serverRaw
		const device = dev && /^\d+$/.test(dev) ? +dev : undefined

		if (kind === 'pn' || kind === 'hosted' || kind === 'lid' || kind === 'hosted.lid') {
			user = user.replace(/\D/g, '')
			if (!user) return null
		}

		const base: ParsedNumber = {
			input: original,
			kind,
			user,
			server,
			device,
			jid: `${user}@${server}`,
			valid: true
		}

		if (kind === 'pn' || kind === 'hosted') {
			const cc = findCountryCode(user)
			const nsn = cc ? user.slice(cc.length) : ''
			base.valid = !!cc && user.length >= 7 && user.length <= 15
			base.e164 = `+${user}`
			if (cc) {
				base.countryCode = cc
				base.nationalNumber = nsn
				base.regions = getRegions(cc)
			}
		}

		return base
	}

	private parseNumber(original: string, rawIn: string): ParsedNumber | null {
		const raw = rawIn
			.replace(/\s*(?:ext\.?|extension|x|#)\s*\d+$/i, '') // ekstensi
			.replace(/\(\s*0\s*\)/g, '') // "+62 (0)812"
		const hadPlus = raw.trim().startsWith('+')
		const d = raw.replace(/\D/g, '')
		if (!d) return null

		let intl: string
		let ambiguous = false
		let altIntl: string | null = null
		const dc = this.defaultCode

		if (hadPlus) {
			intl = d
		} else if (d.startsWith('00')) {
			intl = d.slice(2)
		} else if (dc === '1' && d.startsWith('011')) {
			intl = d.slice(3)
		} else if (dc) {
			const trunk = TRUNK_PREFIX[dc] ?? '0'
			const keepZero = trunk === '0' && KEEP_LEADING_ZERO.has(dc)
			if (!keepZero && d.startsWith(trunk) && d.length > trunk.length) {
				intl = dc + d.slice(trunk.length)
			} else if (d.startsWith(dc) && d.length - dc.length >= 6) {
				intl = d
			} else if (d.length === 11 && d[0] === '1' && dc !== '1') {
				// 1 + 10 digit = format NANP (US/CA), bukan nomor lokal
				intl = d
			} else if (d.length <= (MAX_NATIONAL[dc] ?? 10)) {
				intl = dc + d
				if (d.length >= 8 && findCountryCode(d)) {
					ambiguous = true
					altIntl = d
				}
			} else {
				intl = d
			}
		} else {
			intl = d
		}

		const built = this.buildPN(original, intl)
		if (built && ambiguous && altIntl) {
			const alt = this.buildPN(original, altIntl)
			if (alt?.valid && alt.jid !== built.jid) {
				built.ambiguous = true
				built.alternatives = [...(built.alternatives ?? []), alt.jid]
			}
		}

		return built
	}

	private buildPN(original: string, intl: string): ParsedNumber {
		const cc = findCountryCode(intl)
		if (!cc) {
			return { input: original, kind: 'pn', user: intl, server: PN_SERVER, jid: `${intl}@${PN_SERVER}`, valid: false }
		}

		let nsn = intl.slice(cc.length)
		// "+620812..." -> buang trunk 0 yang salah tempat
		if (!KEEP_LEADING_ZERO.has(cc)) nsn = nsn.replace(/^0+/, '')

		const alternatives: string[] = []
		const mk = (c: string, n: string) => `${c}${n}@${PN_SERVER}`

		if (cc === '52') {
			if (/^1\d{10}$/.test(nsn)) {
				const fixed = nsn.slice(1)
				if (this.fixMexico) {
					alternatives.push(mk(cc, nsn))
					nsn = fixed
				} else {
					alternatives.push(mk(cc, fixed))
				}
			} else if (/^\d{10}$/.test(nsn)) {
				alternatives.push(mk(cc, '1' + nsn))
			}
		} else if (cc === '55') {
			// Brasil: digit 9 ekstra pada ponsel lama
			if (nsn.length === 11 && nsn[2] === '9') alternatives.push(mk(cc, nsn.slice(0, 2) + nsn.slice(3)))
			else if (nsn.length === 10 && /[6-9]/.test(nsn[2]!)) alternatives.push(mk(cc, nsn.slice(0, 2) + '9' + nsn.slice(2)))
		} else if (cc === '54') {
			// Argentina: prefix 9 untuk ponsel
			if (nsn.length === 11 && nsn.startsWith('9')) alternatives.push(mk(cc, nsn.slice(1)))
			else if (nsn.length === 10) alternatives.push(mk(cc, '9' + nsn))
		}

		const user = cc + nsn
		const [minLen, maxLen] = getNationalLengthRange(cc)
		const valid = user.length <= 15 && nsn.length >= minLen && nsn.length <= maxLen

		return {
			input: original,
			kind: 'pn',
			user,
			server: PN_SERVER,
			jid: `${user}@${PN_SERVER}`,
			e164: `+${user}`,
			countryCode: cc,
			nationalNumber: nsn,
			regions: getRegions(cc),
			valid,
			alternatives: alternatives.length ? alternatives : undefined
		}
	}
}

/** Buat NumberResolver langsung dari socket (otomatis pakai lidMapping & onWhatsApp) */
export const makeNumberResolver = (sock: SockLike, opts: Omit<NumberResolverOptions, 'lidStore' | 'onWhatsApp'> = {}) =>
	new NumberResolver({
		...opts,
		lidStore: sock.signalRepository?.lidMapping,
		onWhatsApp: sock.onWhatsApp ? (...jids) => sock.onWhatsApp!(...jids) : undefined
	})
