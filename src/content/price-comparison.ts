import type { Auction } from './market-model'
import { mapAuction, priceDifference } from './market-model'
import { RARITIES } from './price-model'
import { presentPrice } from './price-presentation'
import type { PriceQuote } from './price-store'

export type PriceListing = Pick<
  Auction,
  'id' | 'base' | 'bid' | 'final' | 'endAt' | 'status'
> & {
  card: { id: string; rarity: string | null; shiny: boolean; title: string }
}
/** Only native snapshot fields may identify the priced listing variant. */
export function mapPriceListing(raw: unknown): PriceListing | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  if (typeof source.is_shiny !== 'boolean') return null
  const row = mapAuction(raw)
  if (!row) return null
  const rarity =
    RARITIES.find(rarity => rarity === source.snapshot_rarity) ?? null
  return {
    id: row.id,
    card: {
      id: row.card.id,
      title: row.card.title,
      rarity,
      shiny: source.is_shiny,
    },
    base: row.base,
    bid: row.bid,
    final: row.final,
    endAt: row.endAt,
    status: row.status,
  }
}
export function listingComparison(
  row: PriceListing,
  quote: PriceQuote,
): { text: string; hint: string } {
  const reference = presentPrice(quote, 'decision')
  if (row.card.shiny)
    return {
      text: 'Comparison — · shiny reference unavailable',
      hint: 'Native average does not isolate shiny prices',
    }
  const values: [string, number | null][] =
    row.status === 'settled_sold'
      ? [['Final sale', row.final]]
      : [
          ['Starting price', row.base],
          ['Current bid', row.bid],
        ]
  return {
    text: `${values.map(([label, value]) => `${label} ${value ?? '—'} W · vs average ${value === null ? '—' : priceDifference(value, quote)}`).join(' | ')} · average only · reference ${reference.value}${reference.age ? ` · ${reference.age}` : ''}`,
    hint: `${reference.hint} · starting amounts and bids are not concluded sales · percentage unavailable when reference is zero`,
  }
}
