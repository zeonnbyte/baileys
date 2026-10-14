import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.ZROOT || 'lib'
const L = async p => {
  for (const ext of ['.js', '.ts']) {
    const f = path.resolve(ROOT, p + ext)
    if (fs.existsSync(f)) return import(pathToFileURL(f).href)
  }
  throw new Error('file tidak ada: ' + ROOT + '/' + p)
}

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok   ' + name) }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + String(e.message).split('\n')[0]) }
}
const mkEv = () => {
  const m = new Map()
  return {
    on: (e, f) => { if (!m.has(e)) m.set(e, []); m.get(e).push(f) },
    off: (e, f) => { m.set(e, (m.get(e) ?? []).filter(x => x !== f)) },
    emit: (e, a) => (m.get(e) ?? []).forEach(f => f(a)),
    count: e => (m.get(e) ?? []).length
  }
}

const { CommandRouter, levenshtein } = await L('Zeonn/Handlers/command-router')
const { AntiTagAll, getMentionedNumbers } = await L('Zeonn/Moderation/anti-tag-all')
const { AutoStatus, getStatusKind } = await L('Zeonn/Connection/auto-status')
const { SendQueue } = await L('Zeonn/Connection/send-queue')

console.log('\n[CommandRouter]')
const mkHost = () => {
  const h = { cmds: [], mws: [], unk: [], command(n, r, o) { h.cmds.push({ n, r, o }) }, use(f) { h.mws.push(f) }, on(n, f) { h.unk.push(f) } }
  return h
}
const mkCtx = (o = {}) => {
  const replies = []
  return { cmd: 'ping', prefix: '.', number: '628111', from: '1@g.us', isOwner: false, reply: async x => { replies.push(x) }, replies, ...o }
}
await t('add() mendaftar nama, alias, dan opsi ke host', () => {
  const h = mkHost(), r = new CommandRouter(h)
  r.add({ name: ['ping', 'p'], run: () => {}, cooldown: 5, description: 'cek', category: 'Info' })
  assert.deepEqual(h.cmds[0].n, ['ping', 'p'])
  assert.deepEqual(h.cmds[0].o, { cooldown: 5 })
  assert.equal(r.get('P').name, 'ping')
  assert.throws(() => r.add({ name: '  ', run: () => {} }))
})
await t('help() dikelompokkan, hidden dan owner disembunyikan', () => {
  const h = mkHost(), r = new CommandRouter(h)
  r.add({ name: 'ping', run: () => {}, description: 'cek bot', category: 'Info' })
  r.add({ name: 'sticker', run: () => {}, usage: '<gambar>', category: 'Media' })
  r.add({ name: 'secret', run: () => {}, hidden: true })
  r.add({ name: 'bc', run: () => {}, owner: true })
  const txt = r.help('.')
  assert.ok(txt.includes('*Info*') && txt.includes('*Media*'))
  assert.ok(txt.includes('• .ping — cek bot'))
  assert.ok(txt.includes('• .sticker <gambar>'))
  assert.ok(!txt.includes('secret') && !txt.includes('.bc'))
  assert.ok(r.help('.', { owner: true }).includes('.bc'))
})
await t('attach() sekali saja + daftarkan menu/help', () => {
  const h = mkHost(), r = new CommandRouter(h)
  r.attach().attach()
  assert.equal(h.mws.length, 1)
  assert.equal(h.unk.length, 1)
  assert.deepEqual(h.cmds[0].n, ['menu', 'help'])
  const h2 = mkHost()
  new CommandRouter(h2, { help: false }).attach()
  assert.equal(h2.cmds.length, 0)
})
await t('disable / enable global dan per chat', async () => {
  const h = mkHost(), r = new CommandRouter(h)
  r.add({ name: ['ping', 'p'], run: () => {} }).attach()
  const guard = h.mws[0]
  let called = 0
  const next = async () => { called++ }
  assert.equal(r.disable('p'), true)
  assert.equal(r.disable('nope'), false)
  const c = mkCtx()
  await guard(c, next)
  assert.equal(called, 0)
  assert.deepEqual(c.replies, ['Perintah ini sedang dimatikan.'])
  assert.equal(r.enable('ping'), true)
  await guard(mkCtx(), next)
  assert.equal(called, 1)
  r.disable('ping', 'a@g.us')
  await guard(mkCtx({ from: 'a@g.us' }), next)
  assert.equal(called, 1)
  await guard(mkCtx({ from: 'b@g.us' }), next)
  assert.equal(called, 2)
  assert.ok(!r.help('.', { chat: 'a@g.us' }).includes('.ping'))
})
await t('owner lolos disable & ban; user biasa kena ban', async () => {
  const h = mkHost(), r = new CommandRouter(h, { bannedMessage: 'dibanned' })
  r.add({ name: 'ping', run: () => {} }).attach()
  const guard = h.mws[0]
  let called = 0
  const next = async () => { called++ }
  r.disable('ping')
  r.ban('+62 811-1')
  assert.ok(r.isBanned('628111'))
  const c = mkCtx()
  await guard(c, next)
  assert.equal(called, 0)
  assert.deepEqual(c.replies, ['dibanned'])
  await guard(mkCtx({ isOwner: true }), next)
  assert.equal(called, 1)
  r.unban('628111').enable('ping')
  await guard(mkCtx(), next)
  assert.equal(called, 2)
  await guard(mkCtx({ cmd: 'lain' }), next)
  assert.equal(called, 3)
})
await t('saran perintah mirip untuk command salah ketik', async () => {
  const h = mkHost(), r = new CommandRouter(h)
  r.add({ name: 'ping', run: () => {} }).add({ name: 'stiker', run: () => {} }).attach()
  const unknown = h.unk[0]
  const a = mkCtx({ cmd: 'pign' })
  await unknown(a)
  assert.deepEqual(a.replies, ['Perintah tidak dikenal. Maksud kamu .ping?'])
  const b = mkCtx({ cmd: 'zzzzzzzz' })
  await unknown(b)
  assert.equal(b.replies.length, 0)
  assert.equal(levenshtein('kitten', 'sitting'), 3)
  assert.equal(levenshtein('', 'abc'), 3)
})

console.log('\n[AntiTagAll]')
const jids = n => Array.from({ length: n }, (_, i) => `62800${String(i).padStart(5, '0')}@s.whatsapp.net`)
const tagMsg = (n, sender = '6281@s.whatsapp.net', id = 'A1') => ({
  key: { id, remoteJid: 'g1@g.us', participant: sender, fromMe: false },
  message: { extendedTextMessage: { text: 'hai', contextInfo: { mentionedJid: jids(n) } } }
})
const mkGroupSock = participants => {
  const s = {
    ev: mkEv(), sent: [], kicked: [],
    async sendMessage(j, c, o) { s.sent.push([j, c, o]) },
    async groupMetadata() { return { participants } },
    async groupParticipantsUpdate(j, p, a) { s.kicked.push([j, p, a]) }
  }
  return s
}
const members = [{ id: '6281@s.whatsapp.net' }, { id: '6282@s.whatsapp.net', admin: 'admin' }, ...jids(20).map(id => ({ id }))]
await t('getMentionedNumbers: unik, mention di quoted tidak dihitung', () => {
  assert.equal(getMentionedNumbers(tagMsg(20).message).length, 20)
  const dup = { extendedTextMessage: { contextInfo: { mentionedJid: ['1@s.whatsapp.net', '1:5@s.whatsapp.net', '2@lid'] } } }
  assert.equal(getMentionedNumbers(dup).length, 2)
  const reply = { extendedTextMessage: { text: 'x', contextInfo: { quotedMessage: { extendedTextMessage: { contextInfo: { mentionedJid: jids(30) } } } } } }
  assert.equal(getMentionedNumbers(reply).length, 0)
  assert.equal(getMentionedNumbers(null).length, 0)
})
await t('check(): aturan mentions, fromMe, allow', () => {
  const a = new AntiTagAll(mkGroupSock(members))
  assert.equal(a.check(tagMsg(3)).flagged, false)
  const v = a.check(tagMsg(20))
  assert.equal(v.flagged, true)
  assert.equal(v.reason, 'mentions')
  assert.equal(v.mentions, 20)
  const own = tagMsg(20); own.key.fromMe = true
  assert.equal(a.check(own).flagged, false)
  assert.equal(a.check({ key: { remoteJid: '1@s.whatsapp.net', participant: 'x' }, message: tagMsg(20).message }).flagged, false)
  a.allow('+6281')
  assert.equal(a.check(tagMsg(20)).flagged, false)
  a.disallow('6281')
  assert.equal(a.check(tagMsg(20)).flagged, true)
})
await t('check(): aturan rasio butuh ukuran grup', () => {
  const a = new AntiTagAll(mkGroupSock(members), { maxMentions: 0 })
  assert.equal(a.check(tagMsg(6), 10).reason, 'ratio')
  assert.equal(a.check(tagMsg(6), 100).flagged, false)
  assert.equal(a.check(tagMsg(6)).flagged, false)
  assert.equal(a.check(tagMsg(3), 4).flagged, false)
})
await t('handle(): hapus + peringatan, admin dilewati', async () => {
  const s = mkGroupSock(members)
  const a = new AntiTagAll(s)
  const v = await a.handle(tagMsg(20))
  assert.equal(v.flagged, true)
  assert.equal(v.strikes, 1)
  assert.deepEqual(s.sent[0][1], { delete: tagMsg(20).key })
  assert.ok(s.sent[1][1].text.includes('6281'))
  assert.deepEqual(s.sent[1][1].mentions, ['6281@s.whatsapp.net'])
  const before = s.sent.length
  const v2 = await a.handle(tagMsg(20, '6282@s.whatsapp.net', 'A2'))
  assert.equal(v2.flagged, false)
  assert.equal(s.sent.length, before)
  assert.equal((await a.handle(tagMsg(2))).flagged, false)
})
await t('handle(): kick setelah kickAfter pelanggaran, strike kedaluwarsa', async () => {
  let clock = 0
  const s = mkGroupSock(members)
  const a = new AntiTagAll(s, { actions: ['kick'], kickAfter: 2, strikeTtlMs: 1000, now: () => clock })
  await a.handle(tagMsg(20, '6281@s.whatsapp.net', 'K1'))
  assert.equal(s.kicked.length, 0)
  clock = 5000
  const v = await a.handle(tagMsg(20, '6281@s.whatsapp.net', 'K2'))
  assert.equal(v.strikes, 1)
  assert.equal(s.kicked.length, 0)
  clock = 5500
  await a.handle(tagMsg(20, '6281@s.whatsapp.net', 'K3'))
  assert.deepEqual(s.kicked, [['g1@g.us', ['6281@s.whatsapp.net'], 'remove']])
  assert.equal(s.sent.length, 0)
})
await t('handle(): warning kustom/false, onViolation, aksi gagal tidak melempar', async () => {
  const s = mkGroupSock(members)
  s.sendMessage = async () => { throw new Error('not admin') }
  const seen = []
  const a = new AntiTagAll(s, { warning: false, onViolation: i => seen.push(i), logger: { info() {}, warn() {} } })
  const v = await a.handle(tagMsg(20))
  assert.equal(v.flagged, true)
  assert.equal(seen[0].mentions, 20)
  const s2 = mkGroupSock(members)
  await new AntiTagAll(s2, { actions: ['warn'], warning: (u, n) => `x${n}` }).handle(tagMsg(20))
  assert.equal(s2.sent[0][1].text, 'x20')
})
await t('start()/stop() lewat event messages.upsert', async () => {
  const s = mkGroupSock(members)
  const a = new AntiTagAll(s, { actions: ['delete'] })
  a.start().start()
  assert.equal(s.ev.count('messages.upsert'), 1)
  s.ev.emit('messages.upsert', { type: 'append', messages: [tagMsg(20)] })
  s.ev.emit('messages.upsert', { type: 'notify', messages: [tagMsg(20)] })
  await new Promise(r => setTimeout(r, 20))
  assert.equal(s.sent.length, 1)
  a.stop()
  assert.equal(s.ev.count('messages.upsert'), 0)
  assert.equal(a.isRunning, false)
})

console.log('\n[AutoStatus]')
const stMsg = (o = {}) => ({
  key: { id: 'S' + Math.random().toString(36).slice(2), remoteJid: 'status@broadcast', participant: '62811@s.whatsapp.net', fromMe: false, ...o.key },
  message: o.message ?? { imageMessage: { caption: 'x' } }
})
const mkStSock = () => {
  const s = { ev: mkEv(), user: { id: '62899:5@s.whatsapp.net' }, read: [], sent: [],
    async readMessages(k) { s.read.push(k) }, async sendMessage(j, c, o) { s.sent.push([j, c, o]) } }
  return s
}
const fast = { sleep: async () => {}, random: () => 0 }
await t('getStatusKind', () => {
  assert.equal(getStatusKind({ imageMessage: {} }), 'image')
  assert.equal(getStatusKind({ videoMessage: {} }), 'video')
  assert.equal(getStatusKind({ extendedTextMessage: {} }), 'text')
  assert.equal(getStatusKind({ audioMessage: {} }), 'audio')
  assert.equal(getStatusKind({ stickerMessage: {} }), 'other')
})
await t('default: lihat saja, tanpa reaksi', async () => {
  const s = mkStSock()
  const m = stMsg()
  const r = await new AutoStatus(s, fast).handle(m)
  assert.deepEqual(r, { handled: true, viewed: true, reaction: undefined })
  assert.deepEqual(s.read, [[m.key]])
  assert.equal(s.sent.length, 0)
})
await t('react: kirim ke status@broadcast dengan statusJidList', async () => {
  const s = mkStSock()
  const m = stMsg()
  const r = await new AutoStatus(s, { ...fast, react: ['💚', '🔥'] }).handle(m)
  assert.equal(r.reaction, '💚')
  assert.equal(s.sent[0][0], 'status@broadcast')
  assert.deepEqual(s.sent[0][1], { react: { text: '💚', key: m.key } })
  assert.deepEqual(s.sent[0][2], { statusJidList: ['62811@s.whatsapp.net', '62899@s.whatsapp.net'] })
})
await t('reactChance 0 dan view:false', async () => {
  const s = mkStSock()
  const r = await new AutoStatus(s, { sleep: async () => {}, random: () => 0.5, react: '💚', reactChance: 0, view: false }).handle(stMsg())
  assert.equal(r.reaction, undefined)
  assert.equal(r.viewed, false)
  assert.equal(s.read.length + s.sent.length, 0)
})
await t('filter: only / ignore / kinds / fromMe / non-status / protocol', async () => {
  const s = mkStSock()
  const only = new AutoStatus(s, { ...fast, only: ['62822'] })
  assert.equal((await only.handle(stMsg())).reason, 'not in only')
  assert.equal((await only.handle(stMsg({ key: { participant: '62822:3@s.whatsapp.net' } }))).handled, true)
  const ign = new AutoStatus(s, { ...fast, ignore: ['+62 811'] })
  assert.equal((await ign.handle(stMsg())).reason, 'ignored')
  const kinds = new AutoStatus(s, { ...fast, kinds: ['video'] })
  assert.equal((await kinds.handle(stMsg())).reason, 'kind')
  const base = new AutoStatus(s, fast)
  assert.equal((await base.handle(stMsg({ key: { fromMe: true } }))).reason, 'own status')
  assert.equal((await base.handle(stMsg({ key: { remoteJid: '1@g.us' } }))).reason, 'not a status')
  assert.equal((await base.handle(stMsg({ message: { protocolMessage: {} } }))).reason, 'no content')
})
await t('duplikat dilewati, status lama dilewati', async () => {
  const s = mkStSock()
  const a = new AutoStatus(s, { ...fast, maxAgeSeconds: 100, now: () => 1_000_000 })
  const m = stMsg()
  assert.equal((await a.handle(m)).handled, true)
  assert.equal((await a.handle(m)).reason, 'duplicate')
  const old = stMsg(); old.messageTimestamp = 1000 - 500
  assert.equal((await a.handle(old)).reason, 'too old')
  const fresh = stMsg(); fresh.messageTimestamp = 950
  assert.equal((await a.handle(fresh)).handled, true)
})
await t('diproses satu per satu dengan delay acak', async () => {
  const s = mkStSock(), slept = [], order = []
  const a = new AutoStatus(s, { delay: [1000, 3000], random: () => 0.5, sleep: async ms => { slept.push(ms) }, onStatus: i => order.push(i.sender) })
  const ms = ['62811', '62822', '62833'].map(n => stMsg({ key: { participant: n + '@s.whatsapp.net' } }))
  await Promise.all(ms.map(m => a.handle(m)))
  assert.deepEqual(slept, [2000, 2000, 2000])
  assert.deepEqual(order, ms.map(m => m.key.participant))
  assert.deepEqual(s.read.map(k => k[0].participant), order)
})
await t('gagal lihat / react tidak melempar', async () => {
  const s = mkStSock()
  s.readMessages = async () => { throw new Error('x') }
  s.sendMessage = async () => { throw new Error('y') }
  const r = await new AutoStatus(s, { ...fast, react: '💚', logger: { warn() {} } }).handle(stMsg())
  assert.deepEqual(r, { handled: true, viewed: false, reaction: undefined })
})
await t('start()/stop() hanya status@broadcast type notify', async () => {
  const s = mkStSock()
  const a = new AutoStatus(s, fast).start().start()
  assert.equal(s.ev.count('messages.upsert'), 1)
  s.ev.emit('messages.upsert', { type: 'notify', messages: [stMsg(), stMsg({ key: { remoteJid: '1@g.us' } })] })
  s.ev.emit('messages.upsert', { type: 'append', messages: [stMsg()] })
  await new Promise(r => setTimeout(r, 20))
  assert.equal(s.read.length, 1)
  a.stop()
  assert.equal(s.ev.count('messages.upsert'), 0)
})

console.log('\n[SendQueue]')
const mkQ = (opts = {}, fail = 0) => {
  let t0 = 0, failLeft = fail
  const calls = []
  const sock = { async sendMessage(jid, content, options) { calls.push({ jid, text: content.text, t: t0, options }); if (failLeft-- > 0) throw new Error('boom'); return 'ok:' + content.text } }
  const q = new SendQueue(sock, { delay: [0, 0], perChatMs: 0, perMinute: 0, now: () => t0, sleep: async ms => { t0 += ms }, random: () => 0, ...opts })
  return { q, sock, calls }
}
await t('urut kirim & hasil dikembalikan', async () => {
  const { q, calls } = mkQ()
  const r = await Promise.all([q.send('a', { text: '1' }), q.send('b', { text: '2' }, { quoted: 1 }), q.send('c', { text: '3' })])
  assert.deepEqual(r, ['ok:1', 'ok:2', 'ok:3'])
  assert.deepEqual(calls.map(c => c.text), ['1', '2', '3'])
  assert.deepEqual(calls[1].options, { quoted: 1 })
  await q.drain()
  assert.equal(q.size, 0)
})
await t('prioritas: high > normal > low', async () => {
  const { q, calls } = mkQ()
  q.pause()
  const ps = [q.send('a', { text: 'low' }, undefined, 'low'), q.send('a', { text: 'n1' }), q.send('a', { text: 'high' }, undefined, 'high'), q.send('a', { text: 'n2' })]
  assert.equal(q.size, 4)
  q.resume()
  await Promise.all(ps)
  assert.deepEqual(calls.map(c => c.text), ['high', 'n1', 'n2', 'low'])
})
await t('jeda acak antar kirim', async () => {
  const { q, calls } = mkQ({ delay: [100, 100] })
  await Promise.all(['1', '2', '3'].map(x => q.send('a', { text: x })))
  assert.deepEqual(calls.map(c => c.t), [0, 100, 200])
})
await t('jarak per chat', async () => {
  const { q, calls } = mkQ({ perChatMs: 1500 })
  await Promise.all([q.send('a', { text: '1' }), q.send('b', { text: '2' }), q.send('a', { text: '3' })])
  assert.deepEqual(calls.map(c => c.t), [0, 0, 1500])
})
await t('batas per menit', async () => {
  const { q, calls } = mkQ({ perMinute: 3 })
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map(j => q.send(j, { text: j })))
  assert.deepEqual(calls.map(c => c.t), [0, 0, 0, 60000, 60000])
})
await t('retry dengan backoff, lalu berhasil', async () => {
  const errs = []
  const { q, calls } = mkQ({ retries: 2, retryDelayMs: 500, onError: (e, i) => errs.push(i.attempt) }, 2)
  assert.equal(await q.send('a', { text: 'x' }), 'ok:x')
  assert.deepEqual(calls.map(c => c.t), [0, 500, 1500])
  assert.deepEqual(errs, [0, 1])
})
await t('gagal setelah retry habis, antrean lanjut', async () => {
  const { q, calls } = mkQ({ retries: 1, retryDelayMs: 10 }, 2)
  await assert.rejects(q.send('a', { text: 'x' }), /boom/)
  assert.equal(calls.length, 2)
  assert.equal(await q.send('a', { text: 'y' }), 'ok:y')
})
await t('maxQueue penuh & clear()', async () => {
  const { q } = mkQ({ maxQueue: 2 })
  q.pause()
  const ps = [q.send('a', { text: '1' }), q.send('a', { text: '2' })]
  const rejected = ps.map(p => p.then(() => 'ok', e => e.message))
  await assert.rejects(q.send('a', { text: '3' }), /full/)
  assert.equal(q.clear(), 2)
  assert.deepEqual(await Promise.all(rejected), ['send queue cleared', 'send queue cleared'])
  assert.equal(q.size, 0)
})
await t('patch() / unpatch() mengalihkan sock.sendMessage', async () => {
  const { q, sock, calls } = mkQ({ delay: [100, 100] })
  const orig = sock.sendMessage
  q.patch()
  assert.notEqual(sock.sendMessage, orig)
  const r = await Promise.all([sock.sendMessage('a', { text: '1' }), sock.sendMessage('a', { text: '2' })])
  assert.deepEqual(r, ['ok:1', 'ok:2'])
  assert.deepEqual(calls.map(c => c.t), [0, 100])
  q.unpatch()
  assert.equal(await sock.sendMessage('a', { text: '3' }), 'ok:3')
  assert.equal(calls[2].t, 100)
})
await t('drain() menunggu semua selesai', async () => {
  const { q, calls } = mkQ({ delay: [10, 10] })
  const ps = [q.send('a', { text: '1' }), q.send('a', { text: '2' })]
  await q.drain()
  assert.equal(calls.length, 2)
  await Promise.all(ps)
})

console.log('\nPASS: ' + pass + '  FAIL: ' + fail)
process.exit(fail ? 1 : 0)
