import { BERN_TIME_ZONE } from './date-format'
import { RARITIES } from './price-model'

export type PullCard = {
  title: string
  rarity: string | null
  shiny: boolean | null
  catalogueId: string | null
}
export type PullResult = {
  id: string
  observedAt: number
  cards: PullCard[]
}
export type PullCounts = {
  packs: number
  cards: number
  rarities: Record<string, number>
  shiny: number
  unknownShiny: number
}
export type PullStats = {
  accountId: string
  since: number
  day: string
  daily: PullCounts
  cumulative: PullCounts
  receipts: string[]
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export function bernDay(at: number): string {
  const parts = dayFormat.formatToParts(at)
  return ['year', 'month', 'day']
    .map(type => parts.find(part => part.type === type)?.value)
    .join('-')
}
export function emptyPullCounts(): PullCounts {
  return {
    packs: 0,
    cards: 0,
    rarities: Object.fromEntries([...RARITIES, 'unknown'].map(r => [r, 0])),
    shiny: 0,
    unknownShiny: 0,
  }
}
export function emptyPullStats(accountId: string, now: number): PullStats {
  return {
    accountId,
    since: now,
    day: bernDay(now),
    daily: emptyPullCounts(),
    cumulative: emptyPullCounts(),
    receipts: [],
  }
}
export function validPullCard(value: unknown): value is PullCard {
  if (!value || typeof value !== 'object') return false
  const card = value as PullCard
  return (
    typeof card.title === 'string' &&
    !!card.title.trim() &&
    card.title.length <= 500 &&
    (card.rarity === null || RARITIES.some(r => r === card.rarity)) &&
    (card.shiny === null || typeof card.shiny === 'boolean') &&
    (card.catalogueId === null ||
      (typeof card.catalogueId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(card.catalogueId)))
  )
}
export function validPullResult(
  value: unknown,
  now = Date.now(),
): value is PullResult {
  if (!value || typeof value !== 'object') return false
  const result = value as PullResult
  return (
    typeof result.id === 'string' &&
    result.id.length > 0 &&
    result.id.length <= 100 &&
    Number.isFinite(result.observedAt) &&
    result.observedAt > 0 &&
    result.observedAt <= now &&
    Array.isArray(result.cards) &&
    result.cards.length === 5 &&
    result.cards.every(validPullCard)
  )
}
function validCounts(value: unknown): value is PullCounts {
  if (!value || typeof value !== 'object') return false
  const counts = value as PullCounts
  const integer = (n: unknown): n is number =>
    Number.isSafeInteger(n) && Number(n) >= 0
  return (
    integer(counts.packs) &&
    integer(counts.cards) &&
    counts.cards === counts.packs * 5 &&
    integer(counts.shiny) &&
    integer(counts.unknownShiny) &&
    counts.shiny + counts.unknownShiny <= counts.cards &&
    !!counts.rarities &&
    typeof counts.rarities === 'object' &&
    [...RARITIES, 'unknown'].every(r => integer(counts.rarities[r])) &&
    [...RARITIES, 'unknown'].reduce((sum, r) => sum + counts.rarities[r], 0) ===
      counts.cards
  )
}
export function parsePullStats(
  value: unknown,
  accountId: string,
  now: number,
): PullStats {
  if (!value || typeof value !== 'object') return emptyPullStats(accountId, now)
  const stats = value as PullStats
  if (
    stats.accountId !== accountId ||
    !Number.isFinite(stats.since) ||
    stats.since <= 0 ||
    stats.since > now ||
    typeof stats.day !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(stats.day) ||
    stats.day > bernDay(now) ||
    !validCounts(stats.daily) ||
    !validCounts(stats.cumulative) ||
    stats.daily.packs > stats.cumulative.packs ||
    !Array.isArray(stats.receipts) ||
    stats.receipts.length > 100 ||
    !stats.receipts.every(
      id => typeof id === 'string' && id.length > 0 && id.length <= 100,
    )
  )
    return emptyPullStats(accountId, now)
  return {
    ...stats,
    day: bernDay(now),
    daily: stats.day === bernDay(now) ? stats.daily : emptyPullCounts(),
  }
}
function addCards(counts: PullCounts, cards: PullCard[]): PullCounts {
  const next = {
    ...counts,
    packs: counts.packs + 1,
    cards: counts.cards + cards.length,
    rarities: { ...counts.rarities },
  }
  for (const card of cards) {
    next.rarities[card.rarity ?? 'unknown'] += 1
    if (card.shiny === true) next.shiny += 1
    if (card.shiny === null) next.unknownShiny += 1
  }
  return next
}
export function addPull(
  stats: PullStats,
  result: PullResult,
  now: number,
): PullStats {
  const current = parsePullStats(stats, stats.accountId, now)
  if (!validPullResult(result, now) || current.receipts.includes(result.id))
    return current
  return {
    ...current,
    daily:
      bernDay(result.observedAt) === current.day
        ? addCards(current.daily, result.cards)
        : current.daily,
    cumulative: addCards(current.cumulative, result.cards),
    receipts: [...current.receipts, result.id].slice(-100),
  }
}

/** Slots, rather than titles, distinguish two identical cards in the same pack. */
export class PullCapture {
  id: string
  automatic: boolean
  cards = new Map<number, PullCard>()
  incompatible = false
  constructor(id: string, automatic: boolean) {
    this.id = id
    this.automatic = automatic
  }
  observe(slot: number, card: PullCard): void {
    if (this.incompatible || slot < 1 || slot > 5 || !validPullCard(card))
      return
    const previous = this.cards.get(slot)
    if (previous && JSON.stringify(previous) !== JSON.stringify(card)) {
      this.incompatible = true
      this.automatic = false
      return
    }
    this.cards.set(slot, card)
  }
  result(now: number): PullResult | null {
    if (this.incompatible || this.cards.size !== 5) return null
    return {
      id: this.id,
      observedAt: now,
      cards: [1, 2, 3, 4, 5].map(slot => this.cards.get(slot) as PullCard),
    }
  }
}
