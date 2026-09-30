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
const cardsById = new Map<string, Card>()
const idsByTitle = new Map<string, string>()
const prices = new Map<string, PriceEntry>()
const priceQueue: string[] = []
const queuedPrices = new Set<string>()
const activePrices = new Set<string>()
let priceRequests = 0
let requestRender: () => void = () => {}

export function setPriceRenderCallback(callback: () => void): void {
  requestRender = callback
}

export function registerCards(cards: Card[]): void {
  for (const card of cards) {
    cardsById.set(card.id, card)
    idsByTitle.set(normalizeTitle(card.title), card.id)
  }
  requestRender()
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

function renderBadge(card: HTMLElement, id: string): void {
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
  const quote = readPriceQuote(
    id,
    cardsById.get(id)?.rarity || rarityFromElement(card),
  )
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
    const id = idsByTitle.get(normalizeTitle(heading.textContent))
    if (!id) continue
    const card = getCardElement(heading)
    if (!card) continue
    card.dataset.wmToolboxCardId = id
    renderBadge(card, id)
  }
}

export function renderMarketplace(): void {
  if (!/^\/marketplace\/[0-9a-f-]{36}\/?$/i.test(location.pathname)) return
  const heading = [...document.querySelectorAll('h1')].find(element =>
    idsByTitle.has(normalizeTitle(element.textContent)),
  )
  if (!heading) return
  const id = idsByTitle.get(normalizeTitle(heading.textContent))
  if (!id) return
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
  const quote = readPriceQuote(id, cardsById.get(id)?.rarity || null)
  updatePriceBadge(badge, quote)
  if (quote.status === 'loading') enqueuePrice(id)
}

export async function hydrateRoute(): Promise<void> {
  const path = location.pathname
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
    if (Array.isArray(json.collection)) {
      registerCards(
        json.collection
          .map(row => {
            if (!row || typeof row !== 'object') return null
            const entry = row as {
              card_id?: string
              card?: { id?: string; wikipedia_title?: string; rarity?: string }
            }
            const id = entry.card_id || entry.card?.id
            const title = entry.card?.wikipedia_title
            return id && title
              ? { id, title, rarity: entry.card?.rarity || null }
              : null
          })
          .filter((card): card is Card => card !== null),
      )
    } else if (json.auction && typeof json.auction === 'object') {
      const auctionData = json.auction as {
        card_id?: string
        snapshot_rarity?: string
        card?: { id?: string; wikipedia_title?: string; rarity?: string }
      }
      const id = auctionData.card_id || auctionData.card?.id
      const title = auctionData.card?.wikipedia_title
      if (id && title)
        registerCards([
          {
            id,
            title,
            rarity:
              auctionData.snapshot_rarity || auctionData.card?.rarity || null,
          },
        ])
    }
  } catch (error) {
    console.debug('[WikiMasters Toolbox] page data unavailable', error)
  }
}
