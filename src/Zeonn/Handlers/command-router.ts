// Patch@Zeonn: CommandRouter — command registry on top of OnMessage: metadata, categories, auto help menu,
// per-chat enable / disable, banned users and "did you mean" for unknown commands.

import type { CommandOptions, MessageContext } from './on-message'

export type CommandDef = CommandOptions & {
  /** one name, or a list: the first is the main name, the rest are aliases */
  name: string | string[]
  run: (ctx: MessageContext) => unknown
  description?: string
  /** shown after the name in the help menu, e.g. "<jumlah>" */
  usage?: string
  /** help menu section (default: 'Lainnya') */
  category?: string
  /** registered, but left out of the help menu */
  hidden?: boolean
}

export type CommandInfo = CommandOptions & {
  name: string
  aliases: string[]
  description?: string
  usage?: string
  category: string
  hidden: boolean
}

/** the part of OnMessage the router needs, so it can be unit-tested with a stub */
export type RouterHost = {
  command(names: string | string[], run: (ctx: MessageContext) => unknown, options?: CommandOptions): unknown
  use(fn: (ctx: MessageContext, next: () => Promise<unknown>) => unknown): unknown
  on(name: 'unknown', fn: (ctx: MessageContext) => unknown): unknown
}

export type CommandRouterOptions = {
  /** reply when a disabled command is used. false = stay silent (default: 'Perintah ini sedang dimatikan.') */
  disabledMessage?: string | false
  /** reply when a banned user uses a command. false / undefined = stay silent */
  bannedMessage?: string | false
  /** suggest the closest command for unknown ones (default: true) */
  suggest?: boolean
  suggestMessage?: (cmd: string, suggestion: string, prefix: string) => string
  /** names of the built-in help command. false = don't register one (default: ['menu', 'help']) */
  help?: string[] | false
  helpTitle?: string
}

export type HelpOptions = {
  /** hide commands disabled in this chat */
  chat?: string
  /** show owner-only commands */
  owner?: boolean
  includeHidden?: boolean
}

const GLOBAL = '*'
const DEFAULT_CATEGORY = 'Lainnya'

/** edit distance between two strings (swapping two neighbouring letters counts as one edit) */
export const levenshtein = (a: string, b: string): number => {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
    }
  }

  return d[a.length]![b.length]!
}

const digits = (v: string) => ((v.split('@')[0] || '').split(':')[0] || '').replace(/\D/g, '')

export class CommandRouter {
  private readonly host: RouterHost
  private readonly options: CommandRouterOptions
  private readonly byName = new Map<string, CommandInfo>()
  private readonly disabled = new Map<string, Set<string>>()
  private readonly banned = new Set<string>()
  private installed = false
  private active = false

  constructor(host: RouterHost, options: CommandRouterOptions = {}) {
    this.host = host
    this.options = options
  }

  // ===== registry =====

  /** register a command (goes to OnMessage) together with its help metadata */
  add(def: CommandDef) {
    const { name, run, description, usage, category, hidden, ...options } = def
    const names = ([] as string[])
      .concat(name)
      .map(n => n.trim().toLowerCase())
      .filter(Boolean)
    if (!names.length) throw new Error('CommandRouter.add() needs a command name')
    const info: CommandInfo = {
      ...options,
      name: names[0]!,
      aliases: names.slice(1),
      description,
      usage,
      category: category || DEFAULT_CATEGORY,
      hidden: !!hidden
    }
    for (const n of names) this.byName.set(n, info)
    this.host.command(names, run, options)
    return this
  }

  /** a command registered through the router, by any of its names */
  get(name: string) {
    return this.byName.get(name.toLowerCase())
  }

  /** unique commands in registration order */
  list(includeHidden = false) {
    return [...new Set(this.byName.values())].filter(i => includeHidden || !i.hidden)
  }

  // ===== enable / disable / ban =====

  /** switch a command off everywhere, or only in `chat` */
  disable(name: string, chat = GLOBAL) {
    const info = this.get(name)
    if (!info) return false
    const set = this.disabled.get(chat) ?? new Set<string>()
    set.add(info.name)
    this.disabled.set(chat, set)
    return true
  }

  enable(name: string, chat = GLOBAL) {
    const info = this.get(name)
    if (!info) return false
    return this.disabled.get(chat)?.delete(info.name) ?? false
  }

  isDisabled(name: string, chat?: string) {
    const main = this.get(name)?.name ?? name.toLowerCase()
    return !!this.disabled.get(GLOBAL)?.has(main) || (!!chat && !!this.disabled.get(chat)?.has(main))
  }

  /** banned numbers can't run any router command (owners are never blocked) */
  ban(number: string) {
    const n = digits(number)
    if (n) this.banned.add(n)
    return this
  }

  unban(number: string) {
    this.banned.delete(digits(number))
    return this
  }

  isBanned(number: string) {
    return this.banned.has(digits(number))
  }

  // ===== help / suggestions =====

  /** help menu text grouped by category */
  help(prefix = '.', opts: HelpOptions = {}) {
    const groups = new Map<string, string[]>()
    for (const i of this.list(opts.includeHidden)) {
      if (i.owner && !opts.owner) continue
      if (this.isDisabled(i.name, opts.chat)) continue
      const line = `• ${prefix}${i.name}${i.usage ? ` ${i.usage}` : ''}${i.description ? ` — ${i.description}` : ''}`
      const lines = groups.get(i.category) ?? []
      lines.push(line)
      groups.set(i.category, lines)
    }

    const out = [`*${this.options.helpTitle ?? 'Daftar Perintah'}*`]
    for (const [category, lines] of groups) out.push('', `*${category}*`, ...lines)
    return out.join('\n')
  }

  /** closest visible command name to a mistyped one, if it is near enough */
  closest(cmd: string): string | undefined {
    const limit = cmd.length <= 4 ? 1 : 2
    let best: string | undefined
    let bestDistance = limit + 1
    for (const [name, info] of this.byName) {
      if (info.hidden) continue
      const d = levenshtein(cmd, name)
      if (d > 0 && d < bestDistance) {
        best = name
        bestDistance = d
      }
    }

    return best
  }

  // ===== wiring =====

  /** hook into OnMessage: disable / ban guard, "did you mean" and the help command */
  attach() {
    this.active = true
    if (this.installed) return this
    this.installed = true
    this.host.use(this.guard)
    this.host.on('unknown', this.onUnknown)
    const wanted = this.options.help === false ? [] : (this.options.help ?? ['menu', 'help'])
    const names = wanted.filter(n => !this.byName.has(n.toLowerCase()))
    if (names.length) {
      this.add({
        name: names,
        description: 'Tampilkan daftar perintah',
        category: 'Info',
        run: ctx => ctx.reply(this.help(ctx.prefix || '.', { chat: ctx.from, owner: ctx.isOwner }))
      })
    }

    return this
  }

  /** the guard and suggestions stop working (OnMessage has no way to remove middleware) */
  detach() {
    this.active = false
    return this
  }

  private readonly guard = async (ctx: MessageContext, next: () => Promise<unknown>) => {
    const info = this.active && ctx.cmd ? this.byName.get(ctx.cmd) : undefined
    if (!info || ctx.isOwner) return next()
    if (this.banned.has(digits(ctx.number))) {
      const text = this.options.bannedMessage
      if (text) await ctx.reply(text)
      return
    }

    if (this.isDisabled(info.name, ctx.from)) {
      const text = this.options.disabledMessage ?? 'Perintah ini sedang dimatikan.'
      if (text) await ctx.reply(text)
      return
    }

    return next()
  }

  private readonly onUnknown = async (ctx: MessageContext) => {
    if (!this.active || this.options.suggest === false || !ctx.cmd) return
    const suggestion = this.closest(ctx.cmd)
    if (!suggestion) return
    const text = this.options.suggestMessage
      ? this.options.suggestMessage(ctx.cmd, suggestion, ctx.prefix)
      : `Perintah tidak dikenal. Maksud kamu ${ctx.prefix}${suggestion}?`
    await ctx.reply(text)
  }
}
