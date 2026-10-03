import { type Card, cardVariantKey } from '../cards'
import { type Observation, RARITIES } from './price-model'
import type { PriceQuote } from './price-store'

export type Diagnostic = 'no-sales' | 'not-found' | 'error'
export function priceDiagnostic(quote: PriceQuote): Diagnostic | null {
  if (quote.status === 'unavailable' || ('failed' in quote && quote.failed))
    return 'error'
  return quote.status === 'no-sales' || quote.status === 'not-found'
    ? quote.status
    : null
}
export function diagnosePrices(
  cards: readonly Card[],
  quote: (id: string, rarity: string | null) => PriceQuote,
) {
  return [
    ...new Map(cards.map(card => [cardVariantKey(card), card])).values(),
  ].flatMap(card => {
    const value = quote(card.id, card.rarity)
    const reason = priceDiagnostic(value)
    return reason ? [{ card, quote: value, reason }] : []
  })
}
export function historyDiagnostic(points: Observation[]) {
  const missing = points.filter(row => row.average === null).length
  const known = points.filter(row => row.average !== null)
  const first = known[0],
    last = known.at(-1)
  const gaps = points
    .slice(1)
    .reduce(
      (total, row, i) =>
        total +
        Math.max(
          0,
          Math.floor(row.at / 86400_000) -
            Math.floor(points[i].at / 86400_000) -
            1,
        ),
      0,
    )
  return {
    missing,
    observed: points.length,
    gaps,
    first,
    last,
    delta:
      first && last && first !== last
        ? (last.average as number) - (first.average as number)
        : null,
  }
}

export function priceDashboard(
  ids: string[],
  quote: (id: string, rarity: string) => PriceQuote,
  history: (id: string, rarity: string) => Observation[],
) {
  return RARITIES.map(rarity => {
    const quotes = ids.map(id => quote(id, rarity))
    const known = quotes.filter(q => q.status === 'available')
    const histories = ids.flatMap(id => {
      const points = history(id, rarity)
      return points.length ? [{ id, rarity, ...historyDiagnostic(points) }] : []
    })
    return {
      rarity,
      known: known.length,
      sum: known.reduce((sum, q) => sum + q.average, 0),
      stale: known.filter(q => q.stale || q.failed).length,
      missing: quotes.filter(q => q.status === 'no-sales').length,
      errors: quotes.filter(
        q => q.status === 'not-found' || q.status === 'unavailable',
      ).length,
      unloaded: quotes.filter(
        q => q.status === 'loading' || q.status === 'unknown-rarity',
      ).length,
      histories,
    }
  })
}
