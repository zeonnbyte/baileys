import { jest } from '@jest/globals'
import { NumberResolver } from '../../Utils/number-utils'

describe('NumberResolver', () => {
	const r = new NumberResolver({ defaultCountry: 'ID' })

	it('parse berbagai format nomor Indonesia', () => {
		for (const n of ['+62 812-3456-7890', '0812 3456 7890', '(0812) 3456.7890', '00628123456789' + '0', '6281234567890', '81234567890'.slice(0, 10), '+62 (0)8123456789', 'wa.me/628123456789', '@628123456789', '628123456789@c.us', '628123456789:12@s.whatsapp.net']) {
			expect(r.parse(n)?.valid).toBe(true)
		}
		expect(r.toJid('0812-3456-789')).toBe('628123456789@s.whatsapp.net')
	})

	it('digit non-ASCII', () => {
		expect(r.toJid('٠٨١٢٣٤٥٦٧٨٩')).toBe('628123456789@s.whatsapp.net')
	})

	it('negara lain', () => {
		expect(r.toJid('+1 (415) 555-2671')).toBe('14155552671@s.whatsapp.net')
		expect(r.toJid('+44 7911 123456')).toBe('447911123456@s.whatsapp.net')
		expect(r.toJid('+521 55 1234 5678')).toBe('525512345678@s.whatsapp.net')
	})

	it('lid & mapping', async () => {
		const lr = new NumberResolver({
			lidStore: {
				getPNForLID: async lid => (lid.startsWith('123456789012345') ? '628123456789:3@s.whatsapp.net' : null),
				getLIDForPN: async pn => (pn.startsWith('628123456789') ? '123456789012345@lid' : null)
			}
		})
		expect(await lr.toPN('123456789012345@lid')).toBe('628123456789@s.whatsapp.net')
		expect(await lr.toLID('+62 812 3456 789')).toBe('123456789012345@lid')
		expect(await lr.sameUser('123456789012345@lid', '628123456789@c.us')).toBe(true)
	})
})
