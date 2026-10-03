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
      text: 'Comparaison — · référence des brillantes indisponible',
      hint: 'La moyenne native n’isole pas les prix des brillantes',
    }
  const values: [string, number | null][] =
    row.status === 'settled_sold'
      ? [['Vente finale', row.final]]
      : [
          ['Mise de départ', row.base],
          ['Offre actuelle', row.bid],
        ]
  return {
    text: `${values.map(([label, value]) => `${label} ${value ?? '—'} W · écart à la moyenne ${value === null ? '—' : priceDifference(value, quote)}`).join(' | ')} · moyenne seule · référence ${reference.value}${reference.age ? ` · ${reference.age}` : ''}`,
    hint: `${reference.hint} · les mises de départ et offres ne sont pas des ventes conclues · pourcentage indisponible si la référence est nulle`,
  }
}
