import { cardVariantKey, type OwnedCard } from '../cards'
import type { PriceQuote } from './price-store'

/** Retain one copy of each catalogue/rarity/shiny variant for the duplicate subtotal. */
export function collectionValue(
  cards: readonly OwnedCard[],
  quote: (id: string, rarity: string | null) => PriceQuote,
) {
  const all: {
    total: number | null
    copies: number
    unknown: number
    stale: number
  } = { total: 0, copies: 0, unknown: 0, stale: 0 }
  const duplicates = { ...all }
  const seen = new Set<string>()
  const copies = new Set<string>()
  let oldest = 0
  for (const card of cards) {
    if (copies.has(card.copyId)) continue
    copies.add(card.copyId)
    const variant = cardVariantKey(card)
    const duplicate = seen.has(variant)
    seen.add(variant)
    const price = quote(card.id, card.rarity)
    for (const subtotal of duplicate ? [all, duplicates] : [all]) {
      subtotal.copies++
      // Native summaries do not expose a separate shiny price.
      if (card.shiny || price.status !== 'available') subtotal.unknown++
      else {
        if (subtotal.total !== null) {
          const total = subtotal.total + price.average
          subtotal.total = Number.isFinite(total) ? total : null
        }
        if (price.stale || price.failed) subtotal.stale++
      }
    }
    if (!card.shiny && price.status === 'available')
      oldest = oldest ? Math.min(oldest, price.fetchedAt) : price.fetchedAt
  }
  return { all, duplicates, oldest }
}
