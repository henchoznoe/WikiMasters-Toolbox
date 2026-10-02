import { type Card, cardVariantKey } from '../cards'
import { getAccountId, onAccountChange } from './account'
import { type Auction, mapAuction } from './market-model'
import { requestMarketJson } from './price-store'

type Listings = {
  rows: Auction[]
  at: number
  page: number
  more: boolean
  error: string | null
  loading: boolean
}
const empty = (): Listings => ({
  rows: [],
  at: 0,
  page: 0,
  more: true,
  error: null,
  loading: false,
})
let mine = empty()
let comparable = empty()
let target: Card | null = null
let run: AbortController | null = null
let notify = (): void => {}
export function setMarketCallback(callback: () => void): void {
  notify = callback
}
export function getMarketState() {
  return { mine, comparable, target }
}
export function cancelMarketReads(): void {
  run?.abort()
  run = null
  mine.loading = false
  comparable.loading = false
}
export function resetMarket(): void {
  cancelMarketReads()
  mine = empty()
  comparable = empty()
  target = null
  notify()
}
onAccountChange(resetMarket)
export function observeMarket(json: unknown): void {
  if (!getAccountId() || !json || typeof json !== 'object') return
  const data = json as Record<string, unknown>
  if (
    data.mine !== true ||
    !Array.isArray(data.selling) ||
    !Array.isArray(data.history)
  )
    return
  // Seller/bidder profiles are deliberately dropped by the mapper.
  const active = data.selling
    .map(mapAuction)
    .filter((row): row is Auction => !!row)
  const history = data.history
    .map(mapAuction)
    .filter((row): row is Auction => !!row && row.sellerId === getAccountId())
  mine = {
    rows: [
      ...new Map([...active, ...history].map(row => [row.id, row])).values(),
    ].slice(0, 500),
    at: Date.now(),
    page: 1,
    more: false,
    error: null,
    loading: false,
  }
  notify()
}
export function observeMarketSales(selling: unknown, history: unknown): void {
  const raw = (rows: unknown): unknown[] =>
    Array.isArray(rows)
      ? rows.flatMap(value => {
          if (!value || typeof value !== 'object') return []
          const row = value as Auction
          if (
            !row.card ||
            typeof row.card.id !== 'string' ||
            typeof row.card.title !== 'string'
          )
            return []
          return [
            {
              id: row.id,
              card_id: row.card.id,
              user_card_id: row.card.copyId,
              snapshot_rarity: row.card.rarity,
              is_shiny: row.card.shiny,
              card: {
                id: row.card.id,
                wikipedia_title: row.card.title,
                rarity: row.card.rarity,
              },
              seller_id: row.sellerId,
              base_amount: row.base,
              current_bid: row.bid,
              final_price: row.final,
              end_at:
                typeof row.endAt === 'number'
                  ? new Date(row.endAt).toISOString()
                  : null,
              status: row.status,
            },
          ]
        })
      : []
  observeMarket({ mine: true, selling: raw(selling), history: raw(history) })
}
export function chooseComparables(card: Card): void {
  if (target && cardVariantKey(target) === cardVariantKey(card)) return
  cancelMarketReads()
  target = card
  comparable = empty()
  notify()
}
export async function loadMarket(
  mineOnly = false,
  more = false,
): Promise<void> {
  if (run || !getAccountId() || (!mineOnly && !target)) return
  const owner = getAccountId()
  const card = target
  const state = mineOnly ? mine : comparable
  if (!more && !state.error && state.at && Date.now() - state.at < 30_000)
    return
  if (!mineOnly && more && (!state.more || state.page >= 10)) return
  const request = new AbortController()
  run = request
  state.loading = true
  state.error = null
  notify()
  try {
    const page = more ? state.page + 1 : 1
    const query = new URLSearchParams({
      page: String(page),
      limit: mineOnly ? '1' : '50',
      ...(mineOnly
        ? { mine: '1' }
        : {
            q: card?.title ?? '',
            rarity: card?.rarity ?? '',
            sort: 'ending_soon',
          }),
    })
    const data = await requestMarketJson(
      `/api/marketplace?${query}`,
      request.signal,
    )
    if (request.signal.aborted || getAccountId() !== owner || run !== request)
      return
    if (mineOnly) {
      if (
        data.mine !== true ||
        !Array.isArray(data.selling) ||
        !Array.isArray(data.history)
      )
        throw new Error('Sales unavailable')
      observeMarket(data)
    } else {
      if (!Array.isArray(data.auctions) || typeof data.hasMore !== 'boolean')
        throw new Error('Comparables unavailable')
      const mapped = data.auctions.map(mapAuction)
      if (mapped.some(row => !row))
        throw new Error('Listing identity unavailable')
      const unique = new Map((more ? state.rows : []).map(row => [row.id, row]))
      for (const row of mapped) if (row) unique.set(row.id, row)
      state.rows = [...unique.values()]
      state.at = Date.now()
      state.page = page
      state.more = data.hasMore
    }
  } catch (cause) {
    if (!request.signal.aborted)
      state.error =
        cause instanceof Error ? cause.message : 'Market unavailable'
  } finally {
    if (run === request) {
      run = null
      state.loading = false
      notify()
    }
  }
}
