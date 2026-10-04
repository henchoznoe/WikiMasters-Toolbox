import { type Card, mapCard, nonemptyString } from '../cards'
import type { PriceQuote } from './price-store'

export type Auction = {
  id: string
  card: Card
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
    base: amount(row.listing_base_amount) ?? amount(row.base_amount),
    bid: amount(row.current_bid),
    final: amount(row.final_price),
    endAt: Number.isFinite(end) ? end : null,
    status: row.status as string,
  }
}
export function priceDifference(value: number, quote: PriceQuote): string {
  if (!Number.isFinite(value) || value < 0 || quote.status !== 'available')
    return '—'
  const delta = value - quote.average
  const sign = delta > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(delta)} W${quote.average > 0 ? ` · ${sign}${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((delta / quote.average) * 100)} %` : ''}`
}
