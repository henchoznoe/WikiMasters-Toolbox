import { PRICE_TTL } from './price-model'
import type { PriceQuote } from './price-store'

export type PriceContext = 'album' | 'decision'
export const DECISION_TTL = 15 * 60_000
export function priceContext(path: string): PriceContext {
  return /^\/(trades|marketplace)(\/|$)/.test(path) ? 'decision' : 'album'
}
export function currentPriceContext(): PriceContext {
  return document.querySelector('input[aria-label="Mise de départ"]')
    ? 'decision'
    : priceContext(location.pathname)
}
export function priceTooOld(
  quote: PriceQuote,
  context: PriceContext,
  now = Date.now(),
): boolean {
  return (
    (quote.status === 'available' || quote.status === 'no-sales') &&
    now - quote.fetchedAt >= (context === 'decision' ? DECISION_TTL : PRICE_TTL)
  )
}
