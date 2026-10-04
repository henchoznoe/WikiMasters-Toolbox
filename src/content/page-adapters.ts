import { type Card, mapCard } from '../cards'

export type PageAdapter = {
  id: string
  matches: (path: string) => boolean
  url: (path: string) => string | null
  kind: string
  cards: (data: Record<string, unknown>) => unknown[] | null
}
const array = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value : null
export const pageAdapters: readonly PageAdapter[] = [
  {
    id: 'collection',
    matches: path => /^\/collection(\/|$)/.test(path),
    url: () => '/api/my-collection?sort=rarity&page=0&stats=0',
    kind: 'collection',
    cards: data => array(data.collection),
  },
  {
    id: 'catalogue',
    matches: path => /^\/global-collection(\/|$)/.test(path),
    url: () => '/api/cards?page=0&sort=rarity',
    kind: 'catalogue',
    cards: data => array(data.cards),
  },
  {
    id: 'trades',
    matches: path => /^\/trades(\/|$)/.test(path),
    url: () => '/api/trades',
    kind: 'trades',
    cards: data => {
      if (
        !Array.isArray(data.trades) ||
        data.trades.some(
          trade =>
            !trade || typeof trade !== 'object' || !Array.isArray(trade.items),
        )
      )
        return null
      return data.trades.flatMap(trade => trade.items)
    },
  },
  {
    id: 'market',
    matches: path => /^\/marketplace(\/|$)/.test(path),
    url: path => {
      const id = path.match(/^\/marketplace\/([0-9a-f-]{36})\/?$/i)?.[1]
      return id ? `/api/marketplace/${id}` : '/api/marketplace?page=1&limit=50'
    },
    kind: 'market-list',
    cards: data => (data.auction ? [data.auction] : array(data.auctions)),
  },
]
export function resolvePageAdapter(path: string): PageAdapter | null {
  return pageAdapters.find(adapter => adapter.matches(path)) ?? null
}
export function parsePageCards(
  adapter: PageAdapter,
  data: Record<string, unknown>,
): Card[] | null {
  const raw = adapter.cards(data)
  if (!raw) return null
  const mapped = raw.map(row => mapCard(row))
  return mapped.some(card => !card) ? null : (mapped as Card[])
}
export const cardSelectors = {
  grid: 'div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"], a[href^="/marketplace/"]',
  stats: ':scope > div.mt-auto',
  modal: '[role="tablist"][aria-label="Vue de la carte"]',
} as const
