import { cardVariantKey, type OwnedCard } from '../cards'
import type { PriceQuote } from './price-store'
import type { Commitments } from './selection'

export type TriState = 'any' | 'yes' | 'no'
export const SORTS = [
  'title',
  'price',
  'quantity',
  'rarity',
  'atk',
  'def',
  'ratio',
  'obtained',
] as const
export type CollectionQuery = {
  search: string
  rarities: string[]
  tag: string
  favorite: TriState
  duplicate: TriState
  knownPrice: TriState
  missingImage: TriState
  category: string
  priceMin: number | null
  priceMax: number | null
  atkMin: number | null
  atkMax: number | null
  defMin: number | null
  defMax: number | null
  sort: (typeof SORTS)[number]
  descending: boolean
}
export function defaultCollectionQuery(): CollectionQuery {
  return {
    search: '',
    rarities: [],
    tag: '',
    favorite: 'any',
    duplicate: 'any',
    knownPrice: 'any',
    missingImage: 'any',
    category: '',
    priceMin: null,
    priceMax: null,
    atkMin: null,
    atkMax: null,
    defMin: null,
    defMax: null,
    sort: 'title',
    descending: false,
  }
}
export function normalizeQuery(value: unknown): CollectionQuery | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const result = defaultCollectionQuery()
  for (const key of ['search', 'tag', 'category'] as const) {
    if (typeof source[key] !== 'string' || source[key].length > 200) return null
    result[key] = source[key]
  }
  if (
    !Array.isArray(source.rarities) ||
    source.rarities.length > 6 ||
    source.rarities.some(r => !['C', 'PC', 'R', 'SR', 'UR', 'L'].includes(r))
  )
    return null
  result.rarities = [...new Set(source.rarities)]
  for (const key of [
    'favorite',
    'duplicate',
    'knownPrice',
    'missingImage',
  ] as const) {
    if (!['any', 'yes', 'no'].includes(String(source[key]))) return null
    result[key] = source[key] as TriState
  }
  for (const key of [
    'priceMin',
    'priceMax',
    'atkMin',
    'atkMax',
    'defMin',
    'defMax',
  ] as const) {
    const n = source[key]
    if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0))
      return null
    result[key] = n as number | null
  }
  if (
    !SORTS.includes(source.sort as CollectionQuery['sort']) ||
    typeof source.descending !== 'boolean'
  )
    return null
  result.sort = source.sort as CollectionQuery['sort']
  result.descending = source.descending
  return result
}
export function folded(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}
const tri = (filter: TriState, value: boolean | null): boolean =>
  filter === 'any' || (value !== null && value === (filter === 'yes'))
const range = (
  value: number | null,
  min: number | null,
  max: number | null,
): boolean =>
  (min === null && max === null) ||
  (value !== null &&
    (min === null || value >= min) &&
    (max === null || value <= max))
export function variantGroups(
  cards: readonly OwnedCard[],
): Map<string, OwnedCard[]> {
  const groups = new Map<string, OwnedCard[]>()
  for (const card of cards) {
    const key = cardVariantKey(card)
    const group = groups.get(key) ?? []
    group.push(card)
    groups.set(key, group)
  }
  return groups
}
export function queryCollection(
  cards: readonly OwnedCard[],
  query: CollectionQuery,
  quote: (id: string, rarity: string | null) => PriceQuote,
): OwnedCard[] {
  const groups = variantGroups(cards)
  const prices = new Map<string, number | null>()
  const price = (card: OwnedCard): number | null => {
    const key = cardVariantKey(card)
    if (!prices.has(key)) {
      const value = quote(card.id, card.rarity)
      prices.set(
        key,
        !card.shiny && value.status === 'available' ? value.average : null,
      )
    }
    return prices.get(key) ?? null
  }
  const quantity = (card: OwnedCard): number =>
    groups.get(cardVariantKey(card))?.length ?? 0
  const result = cards.filter(
    card =>
      folded(card.title).includes(folded(query.search)) &&
      (!query.rarities.length || query.rarities.includes(card.rarity ?? '')) &&
      (!query.tag ||
        (query.tag === '@tagged'
          ? !!card.tagIds.length
          : query.tag === '@untagged'
            ? !card.tagIds.length
            : card.tagIds.includes(query.tag))) &&
      tri(query.favorite, card.starred) &&
      tri(query.duplicate, quantity(card) > 1) &&
      tri(query.knownPrice, price(card) !== null) &&
      tri(
        query.missingImage,
        card.hasImage === undefined || card.hasImage === null
          ? null
          : !card.hasImage,
      ) &&
      (!query.category ||
        folded(card.category ?? '').includes(folded(query.category))) &&
      range(price(card), query.priceMin, query.priceMax) &&
      range(card.atk ?? null, query.atkMin, query.atkMax) &&
      range(card.def ?? null, query.defMin, query.defMax),
  )
  const metric = (card: OwnedCard): number | null => {
    switch (query.sort) {
      case 'price':
        return price(card)
      case 'quantity':
        return quantity(card)
      case 'rarity': {
        const n = ['C', 'PC', 'R', 'SR', 'UR', 'L'].indexOf(card.rarity ?? '')
        return n < 0 ? null : n
      }
      case 'atk':
        return card.atk ?? null
      case 'def':
        return card.def ?? null
      case 'ratio':
        return card.atk != null && card.def != null && card.def > 0
          ? card.atk / card.def
          : null
      case 'obtained': {
        const n = card.obtainedAt ? Date.parse(card.obtainedAt) : NaN
        return Number.isFinite(n) ? n : null
      }
      default:
        return null
    }
  }
  return result.sort((a, b) => {
    const x = metric(a),
      y = metric(b)
    const title = a.title.localeCompare(b.title)
    if (query.sort !== 'title') {
      if (x === null && y !== null) return 1
      if (x !== null && y === null) return -1
      if (x !== null && y !== null && x !== y)
        return (x - y) * (query.descending ? -1 : 1)
    } else if (title) return title * (query.descending ? -1 : 1)
    return (
      title ||
      cardVariantKey(a).localeCompare(cardVariantKey(b)) ||
      a.copyId.localeCompare(b.copyId)
    )
  })
}
/** Grouped results include only matching copies of duplicate variants. Counts remain global. */
export function queryCollectionView(
  cards: readonly OwnedCard[],
  query: CollectionQuery,
  quote: (id: string, rarity: string | null) => PriceQuote,
  grouped: boolean,
): OwnedCard[] {
  const result = queryCollection(cards, query, quote)
  if (!grouped) return result
  const groups = variantGroups(cards)
  return result.filter(
    card => (groups.get(cardVariantKey(card))?.length ?? 0) > 1,
  )
}
export type CopyAvailability =
  | 'free'
  | 'sale'
  | 'trade'
  | 'committed'
  | 'unknown'
export function copyAvailability(
  card: OwnedCard,
  commitments: Commitments,
  ready: boolean,
): CopyAvailability {
  if (!ready) return 'unknown'
  if (commitments.saleCopyIds?.has(card.copyId)) return 'sale'
  if (commitments.tradeCopyIds?.has(card.copyId)) return 'trade'
  if (
    commitments.copyIds.has(card.copyId) ||
    commitments.catalogueIds.has(card.id)
  )
    return 'committed'
  return 'free'
}
