import { cardVariantKey, mapCard } from '../cards'
import { getAccountId, setAccountId } from './account'
import { type Card, createToolboxRoot, normalizeTitle } from './shared'

type PriceEntry = {
  fetchedAt: number
  ok: boolean
  notFound?: boolean
  averages: Record<string, number>
}

const PRICE_TTL = 24 * 60 * 60 * 1000
const ERROR_TTL = 60 * 1000
const PRICE_PREFIX = 'wm_toolbox_price_v1_'
const cardsByVariant = new Map<string, Card>()
const variantsByTitle = new Map<string, Set<string>>()
let marketplaceCard: Card | null = null
const prices = new Map<string, PriceEntry>()
const priceQueue: string[] = []
const queuedPrices = new Set<string>()
const activePrices = new Set<string>()
let priceRequests = 0
let requestRender: () => void = () => {}

export function setPriceRenderCallback(callback: () => void): void {
  requestRender = callback
}

export function registerCards(cards: Card[], kind?: string): void {
  if (kind === 'marketplace')
    marketplaceCard = cards.length === 1 ? cards[0] : null
  for (const card of cards) {
    const key = cardVariantKey(card)
    cardsByVariant.set(key, card)
    const title = normalizeTitle(card.title)
    const variants = variantsByTitle.get(title) ?? new Set<string>()
    variants.add(key)
    variantsByTitle.set(title, variants)
  }
  requestRender()
}

export function resetRegisteredCards(): void {
  cardsByVariant.clear()
  variantsByTitle.clear()
  marketplaceCard = null
  for (const host of document.querySelectorAll(
    '[data-wm-toolbox-price], [data-wm-toolbox-marketplace]',
  ))
    host.remove()
}

export function resolveVisibleCard(
  title: string | null,
  rarity: string | null,
): Card | null {
  const candidates = [
    ...(variantsByTitle.get(normalizeTitle(title)) ?? []),
  ].flatMap(key => {
    const card = cardsByVariant.get(key)
    return card && (!rarity || card.rarity === rarity) ? [card] : []
  })
  // Display-only fallback for DOM without IDs; ambiguity must never pick the last title seen.
  if (new Set(candidates.map(card => card.id)).size !== 1) return null
  if (!rarity && new Set(candidates.map(card => card.rarity)).size > 1)
    return null
  return candidates[0] ?? null
}

function readCachedPrice(id: string): PriceEntry | null {
  const memory = prices.get(id)
  if (
    memory &&
    Date.now() - memory.fetchedAt < (memory.ok ? PRICE_TTL : ERROR_TTL)
  )
    return memory
  try {
    const raw = localStorage.getItem(PRICE_PREFIX + id)
    const entry = raw ? (JSON.parse(raw) as PriceEntry) : null
    if (
      entry &&
      typeof entry.fetchedAt === 'number' &&
      typeof entry.ok === 'boolean' &&
      entry.averages &&
      typeof entry.averages === 'object' &&
      Date.now() - entry.fetchedAt < (entry.ok ? PRICE_TTL : ERROR_TTL)
    ) {
      prices.set(id, entry)
      return entry
    }
  } catch {
    /* Storage unavailable. */
  }
  return null
}

function chosenAverage(
  entry: PriceEntry,
  rarity: string | null,
): number | null {
  if (rarity)
    return Number.isFinite(entry.averages[rarity])
      ? entry.averages[rarity]
      : null
  const values = Object.values(entry.averages).filter(Number.isFinite)
  return values.length === 1 ? values[0] : null
}

export type PriceQuote =
  | { status: 'loading' }
  | { status: 'unavailable'; fetchedAt: number }
  | { status: 'no-sales'; fetchedAt: number }
  | { status: 'not-found'; fetchedAt: number }
  | { status: 'available'; average: number; fetchedAt: number }

export function formatPriceAge(fetchedAt: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60_000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} j`
}

function priceCheckDate(fetchedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(fetchedAt))
}

type PricePresentation = {
  status: PriceQuote['status']
  value: string
  age: string
  hint: string
}

export function presentPrice(quote: PriceQuote): PricePresentation {
  if (quote.status === 'loading')
    return {
      status: 'loading',
      value: '…',
      age: '',
      hint: 'Loading average sale price',
    }
  const checked = priceCheckDate(quote.fetchedAt)
  if (quote.status === 'unavailable')
    return {
      status: quote.status,
      value: '!',
      age: '',
      hint: `Price request failed · last attempt ${checked} · retry in one minute`,
    }
  if (quote.status === 'not-found')
    return {
      status: quote.status,
      value: '—',
      age: '',
      hint: `No market price found · last attempt ${checked} · retry in one minute`,
    }
  const age = formatPriceAge(quote.fetchedAt)
  if (quote.status === 'no-sales')
    return {
      status: quote.status,
      value: '—',
      age,
      hint: `No sales data for this rarity · checked ${checked}`,
    }
  return {
    status: quote.status,
    value: `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(quote.average)} W`,
    age,
    hint: `Average sale price for this rarity · checked ${checked} · source period not specified by WikiMasters`,
  }
}

function updatePriceBadge(badge: HTMLElement, quote: PriceQuote): void {
  const presentation = presentPrice(quote)
  badge.dataset.status = presentation.status
  const value = badge.querySelector<HTMLElement>('.wm-price-value')
  const age = badge.querySelector<HTMLElement>('.wm-price-age')
  if (value && value.textContent !== presentation.value)
    value.textContent = presentation.value
  if (age) {
    const next = presentation.age ? `· ${presentation.age}` : ''
    if (age.textContent !== next) age.textContent = next
    age.hidden = !presentation.age
  }
  if (badge.title !== presentation.hint) badge.title = presentation.hint
  const spoken = `${presentation.status === 'available' ? 'Average sale price' : 'Average sale price status'}: ${presentation.value}${presentation.age ? `, checked ${presentation.age} ago` : ''}. ${presentation.hint}`
  if (badge.getAttribute('aria-label') !== spoken)
    badge.setAttribute('aria-label', spoken)
}

function createPriceBadge(large = false): HTMLElement {
  const badge = document.createElement('span')
  badge.className = `wm-price-badge${large ? ' wm-price-badge-large' : ''}`
  const value = document.createElement('span')
  value.className = 'wm-price-value'
  const age = document.createElement('span')
  age.className = 'wm-price-age'
  age.hidden = true
  badge.append(value, age)
  return badge
}

export function readPriceQuote(id: string, rarity: string | null): PriceQuote {
  const cached = readCachedPrice(id)
  if (!cached) return { status: 'loading' }
  if (cached.notFound)
    return { status: 'not-found', fetchedAt: cached.fetchedAt }
  if (!cached.ok) return { status: 'unavailable', fetchedAt: cached.fetchedAt }
  const average = chosenAverage(cached, rarity)
  return average === null
    ? { status: 'no-sales', fetchedAt: cached.fetchedAt }
    : { status: 'available', average, fetchedAt: cached.fetchedAt }
}

export function requestPriceQuote(id: string): void {
  enqueuePrice(id)
}

function rarityFromElement(card: Element): string | null {
  for (const element of card.querySelectorAll('span, div')) {
    const text = element.textContent?.trim()
    if (text && /^(L|UR|SR|R|PC|C)$/.test(text)) return text
  }
  return null
}

function getCardElement(heading: Element): HTMLElement | null {
  return heading.closest<HTMLElement>(
    'div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]',
  )
}

function renderBadge(card: HTMLElement, identity: Card): void {
  const { id, rarity } = identity
  const heading = card.querySelector('h3')
  if (!heading?.parentElement) return
  const onCollection = /^\/collection(\/|$)/.test(location.pathname)
  const stats = onCollection
    ? heading.parentElement.querySelector<HTMLElement>(':scope > div.mt-auto')
    : null
  if (onCollection && !stats) return
  let host = card.querySelector<HTMLElement>('[data-wm-toolbox-price]')
  if (!host) {
    host = document.createElement(onCollection ? 'div' : 'span')
    host.dataset.wmToolboxPrice = id
    createToolboxRoot(host).append(createPriceBadge())
  }
  if (onCollection) {
    host.dataset.wmToolboxPriceLayout = 'collection'
    if (
      stats &&
      (host.parentElement !== stats || host !== stats.lastElementChild)
    )
      stats.append(host)
  } else {
    delete host.dataset.wmToolboxPriceLayout
    if (host.previousElementSibling !== heading) heading.after(host)
  }
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  host.dataset.wmToolboxPrice = id
  const quote = readPriceQuote(id, rarity)
  updatePriceBadge(badge, quote)
  if (quote.status === 'loading') {
    visiblePriceObserver.observe(card)
  }
}

const visiblePriceObserver = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      visiblePriceObserver.unobserve(entry.target)
      const id = (entry.target as HTMLElement).dataset.wmToolboxCardId
      if (id) enqueuePrice(id)
    }
  },
  { rootMargin: '320px 0px' },
)

function enqueuePrice(id: string): void {
  if (readCachedPrice(id) || queuedPrices.has(id) || activePrices.has(id))
    return
  queuedPrices.add(id)
  priceQueue.push(id)
  pumpPrices()
}

function pumpPrices(): void {
  while (priceRequests < 3 && priceQueue.length) {
    const id = priceQueue.shift()
    if (!id) break
    queuedPrices.delete(id)
    if (readCachedPrice(id) || activePrices.has(id)) continue
    activePrices.add(id)
    priceRequests += 1
    void loadPrice(id).finally(() => {
      activePrices.delete(id)
      priceRequests -= 1
      requestRender()
      pumpPrices()
    })
  }
}

async function loadPrice(id: string): Promise<void> {
  let entry: PriceEntry
  try {
    const response = await fetch(
      `/api/marketplace/cards/${encodeURIComponent(id)}/sales?scope=summary`,
      {
        credentials: 'include',
        signal: AbortSignal.timeout(12_000),
      },
    )
    if (response.status === 404) {
      entry = { fetchedAt: Date.now(), ok: false, notFound: true, averages: {} }
    } else {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const json = (await response.json()) as {
        summary?: Record<string, { average?: unknown }>
      }
      const averages: Record<string, number> = {}
      for (const [rarity, value] of Object.entries(json.summary || {})) {
        if (value?.average == null || value.average === '') continue
        const average = Number(value?.average)
        if (Number.isFinite(average)) averages[rarity] = average
      }
      entry = { fetchedAt: Date.now(), ok: true, averages }
    }
  } catch (error) {
    console.debug('[WikiMasters Toolbox] price unavailable', id, error)
    entry = { fetchedAt: Date.now(), ok: false, averages: {} }
  }
  prices.set(id, entry)
  try {
    localStorage.setItem(PRICE_PREFIX + id, JSON.stringify(entry))
  } catch {
    /* Storage unavailable. */
  }
}

export function renderCards(): void {
  if (!/^\/(collection|pulls)(\/|$)/.test(location.pathname)) return
  for (const heading of document.querySelectorAll('h3')) {
    const card = getCardElement(heading)
    if (!card) continue
    const identity = resolveVisibleCard(
      heading.textContent,
      rarityFromElement(card),
    )
    if (!identity) {
      delete card.dataset.wmToolboxCardId
      card.querySelector('[data-wm-toolbox-price]')?.remove()
      continue
    }
    card.dataset.wmToolboxCardId = identity.id
    renderBadge(card, identity)
  }
}

export function renderMarketplace(): void {
  if (!/^\/marketplace\/[0-9a-f-]{36}\/?$/i.test(location.pathname)) return
  const identity = marketplaceCard
  if (!identity) return
  const heading = [...document.querySelectorAll('h1')].find(
    element =>
      normalizeTitle(identity.title) === normalizeTitle(element.textContent),
  )
  if (!heading) return
  const { id, rarity } = identity
  let host = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-marketplace]',
  )
  if (!host) {
    host = document.createElement('div')
    host.dataset.wmToolboxMarketplace = '1'
    createToolboxRoot(host).append(createPriceBadge(true))
    heading.insertAdjacentElement('afterend', host)
  }
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  const quote = readPriceQuote(id, rarity)
  updatePriceBadge(badge, quote)
  if (quote.status === 'loading') enqueuePrice(id)
}

export async function hydrateRoute(): Promise<void> {
  const path = location.pathname
  const expectedAccount = getAccountId()
  marketplaceCard = null
  let url: string | null = null
  if (/^\/collection(\/|$)/.test(path))
    url = '/api/my-collection?sort=rarity&page=0&stats=0'
  const auction = path.match(/^\/marketplace\/([0-9a-f-]{36})\/?$/i)?.[1]
  if (auction) url = `/api/marketplace/${auction}`
  if (!url) return
  try {
    const response = await fetch(url, {
      credentials: 'include',
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return
    const json = (await response.json()) as Record<string, unknown>
    if (location.pathname !== path) return
    if (expectedAccount && getAccountId() !== expectedAccount) return
    if (Array.isArray(json.collection)) {
      const owner = json.collection.find(
        row =>
          row && typeof row === 'object' && typeof row.user_id === 'string',
      )?.user_id
      if (owner && getAccountId() && owner !== getAccountId()) return
      if (owner) setAccountId(owner)
      registerCards(
        json.collection
          .map(row => mapCard(row, true))
          .filter((card): card is Card => card !== null),
      )
    } else if (json.auction && typeof json.auction === 'object') {
      const card = mapCard(json.auction)
      if (card) registerCards([card], 'marketplace')
    }
  } catch (error) {
    console.debug('[WikiMasters Toolbox] page data unavailable', error)
  }
}
