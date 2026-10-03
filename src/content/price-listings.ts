import { getAccountId, onAccountChange } from './account'
import type { PriceListing } from './price-comparison'

let listings: PriceListing[] = []
export function clearPriceListings(): void {
  listings = []
}
onAccountChange(clearPriceListings)
export function readPriceListings(): PriceListing[] {
  return listings
}
export function observePriceListings(rows: unknown): void {
  if (!getAccountId() || !Array.isArray(rows)) return
  listings = rows.slice(0, 500).flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const row = value as PriceListing
    if (
      !/^[0-9a-f-]{36}$/i.test(row.id) ||
      !row.card ||
      typeof row.card.id !== 'string' ||
      typeof row.card.title !== 'string' ||
      typeof row.card.shiny !== 'boolean' ||
      (row.card.rarity !== null && typeof row.card.rarity !== 'string') ||
      typeof row.status !== 'string'
    )
      return []
    if (
      [row.base, row.bid, row.final].some(
        amount =>
          amount !== null &&
          (typeof amount !== 'number' ||
            !Number.isFinite(amount) ||
            amount < 0),
      )
    )
      return []
    return [
      {
        id: row.id,
        card: {
          id: row.card.id,
          title: row.card.title,
          rarity: row.card.rarity,
          shiny: row.card.shiny,
        },
        base: row.base,
        bid: row.bid,
        final: row.final,
        status: row.status,
        endAt:
          typeof row.endAt === 'number' && Number.isFinite(row.endAt)
            ? row.endAt
            : null,
      },
    ]
  })
}
