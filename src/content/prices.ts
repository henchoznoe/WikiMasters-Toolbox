import { type Card, createToolboxRoot, normalizeTitle } from './shared'

type PriceEntry = {
  fetchedAt: number
  ok: boolean
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
  if (rarity && Number.isFinite(entry.averages[rarity]))
    return entry.averages[rarity]
  const values = Object.values(entry.averages).filter(Number.isFinite)
  return values.length === 1 ? values[0] : null
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
  let host = card.querySelector<HTMLElement>('[data-wm-toolbox-price]')
  if (!host) {
    host = document.createElement('span')
    host.dataset.wmToolboxPrice = id
    const badge = document.createElement('span')
    badge.className = 'wm-price-badge'
    createToolboxRoot(host).append(badge)
    heading.insertAdjacentElement('afterend', host)
  }
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  const cached = readCachedPrice(id)
  if (!cached) {
    if (badge.textContent !== 'Average price…')
      badge.textContent = 'Average price…'
    badge.title = 'Loading average price'
    visiblePriceObserver.observe(card)
    return
  }
  const average = chosenAverage(
    cached,
    cardsById.get(id)?.rarity || rarityFromElement(card),
  )
  const formatted =
    average === null
      ? '—'
      : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
          average,
        )
  const text = cached.ok
    ? `Avg. ${formatted}${average === null ? '' : ' W'}`
    : 'Price unavailable'
  if (badge.textContent !== text) badge.textContent = text
  badge.title = cached.ok
    ? 'Average sale price, cached for 24 hours'
    : 'Temporary error; retry in one minute'
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
    const badge = document.createElement('div')
    badge.className = 'wm-price-badge wm-price-badge-large'
    createToolboxRoot(host).append(badge)
    heading.insertAdjacentElement('afterend', host)
  }
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  const cached = readCachedPrice(id)
  if (!cached) {
    if (badge.textContent !== 'Average price…')
      badge.textContent = 'Average price…'
    enqueuePrice(id)
    return
  }
  const average = chosenAverage(cached, cardsById.get(id)?.rarity || null)
  const text = cached.ok
    ? `Average price: ${average === null ? '—' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(average)} W`}`
    : 'Average price unavailable'
  if (badge.textContent !== text) badge.textContent = text
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
