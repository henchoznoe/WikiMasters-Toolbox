import {
  type Card,
  cardVariantKey,
  mapCard,
  nonemptyString,
  type OwnedCard,
} from '../cards'
import type { PriceQuote } from './price-store'
import type { Commitments } from './selection'

export type Auction = {
  id: string
  card: Card
  sellerId: string | null
  base: number | null
  bid: number | null
  final: number | null
  endAt: number | null
  status: string
}
const uuid = /^[0-9a-f-]{36}$/i
function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}
export function mapAuction(raw: unknown): Auction | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const card = mapCard(row)
  const id = nonemptyString(row.id)
  if (!card || !id || !uuid.test(id) || !nonemptyString(row.status)) return null
  const end = typeof row.end_at === 'string' ? Date.parse(row.end_at) : NaN
  return {
    id,
    card,
    sellerId: nonemptyString(row.seller_id),
    base: amount(row.listing_base_amount) ?? amount(row.base_amount),
    bid: amount(row.current_bid),
    final: amount(row.final_price),
    endAt: Number.isFinite(end) ? end : null,
    status: row.status as string,
  }
}
export function comparableAuctions(
  rows: readonly Auction[],
  card: Card,
  sort: 'end' | 'price',
  now = Date.now(),
): Auction[] {
  return rows
    .filter(
      row =>
        row.card.id === card.id &&
        row.card.rarity === card.rarity &&
        row.card.shiny === card.shiny &&
        card.rarity !== null &&
        row.status === 'active' &&
        row.endAt !== null &&
        row.endAt > now,
    )
    .sort((a, b) =>
      sort === 'end'
        ? (a.endAt ?? Infinity) - (b.endAt ?? Infinity) ||
          a.id.localeCompare(b.id)
        : (a.bid ?? a.base ?? Infinity) - (b.bid ?? b.base ?? Infinity) ||
          (a.endAt ?? Infinity) - (b.endAt ?? Infinity),
    )
}
export function rankCollection(
  cards: readonly OwnedCard[],
  quote: (id: string, rarity: string | null) => PriceQuote,
) {
  const groups = new Map<
    string,
    { card: OwnedCard; copies: OwnedCard[]; quote: PriceQuote }
  >()
  for (const card of cards) {
    const key = cardVariantKey(card)
    const group = groups.get(key)
    if (group) group.copies.push(card)
    else
      groups.set(key, {
        card,
        copies: [card],
        quote: quote(card.id, card.rarity),
      })
  }
  return [...groups.values()].sort(
    (a, b) =>
      (b.quote.status === 'available' ? b.quote.average : -1) -
        (a.quote.status === 'available' ? a.quote.average : -1) ||
      a.card.title.localeCompare(b.card.title) ||
      cardVariantKey(a.card).localeCompare(cardVariantKey(b.card)),
  )
}
export function saleBlock(
  card: OwnedCard | null,
  owner: string | null,
  commitments: Commitments,
): string | null {
  if (!card || !owner || card.ownerId !== owner)
    return 'Copie non détenue · actualisez la collection'
  if (
    commitments.copyIds.has(card.copyId) ||
    commitments.catalogueIds.has(card.id)
  )
    return 'Copie en vente / échange'
  return null
}
export function priceDifference(value: number, quote: PriceQuote): string {
  if (!Number.isFinite(value) || value < 0 || quote.status !== 'available')
    return '—'
  const delta = value - quote.average
  const sign = delta > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(delta)} W${quote.average > 0 ? ` · ${sign}${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((delta / quote.average) * 100)} %` : ''}`
}
export const SALE_DURATIONS = [10, 30, 60, 180, 360, 720] as const
export function validSaleDraft(amount: number, duration: number): boolean {
  return (
    Number.isSafeInteger(amount) &&
    amount >= 1 &&
    SALE_DURATIONS.some(value => value === duration)
  )
}
