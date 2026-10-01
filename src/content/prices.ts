import { presentPrice } from './price-presentation'

export { formatPriceAge, presentPrice } from './price-presentation'

import { cardVariantKey, mapCard } from '../cards'
import { getAccountId, setAccountId } from './account'
import { openPriceInspector } from './price-inspector'
import {
  needsPrice,
  type PriceQuote,
  readPriceQuote,
  requestPriceQuote,
  setPriceStoreCallback,
} from './price-store'
import { type Card, createToolboxRoot, normalizeTitle } from './shared'

export {
  type PriceQuote,
  readPriceQuote,
  requestPriceQuote,
} from './price-store'

const cardsByVariant = new Map<string, Card>()
const variantsByTitle = new Map<string, Set<string>>()
let marketplaceCard: Card | null = null
let requestRender: () => void = () => {}
export function setPriceRenderCallback(callback: () => void): void {
  requestRender = callback
  setPriceStoreCallback(callback)
}
export function getVisiblePriceCards(): Card[] {
  return [
    ...document.querySelectorAll<HTMLElement>('[data-wm-toolbox-card-id]'),
  ].flatMap(element => {
    const card = resolveVisibleCard(
      element.dataset.wmToolboxCardTitle ??
        element.querySelector('h3')?.textContent ??
        element.querySelector('h2')?.textContent ??
        null,
      element.dataset.wmToolboxCardRarity ?? rarityFromElement(element),
    )
    return card ? [card] : []
  })
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
  const badge = document.createElement('button')
  badge.type = 'button'
  badge.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    if (badge.dataset.cardId && badge.dataset.rarity)
      openPriceInspector(
        badge.dataset.cardId,
        badge.dataset.rarity,
        badge.dataset.cardTitle ?? '',
      )
  })
  badge.className = `wm-price-badge${large ? ' wm-price-badge-large' : ''}`
  const value = document.createElement('span')
  value.className = 'wm-price-value'
  const age = document.createElement('span')
  age.className = 'wm-price-age'
  age.hidden = true
  badge.append(value, age)
  return badge
}

function rarityFromElement(card: Element): string | null {
  for (const element of card.querySelectorAll('span, div')) {
    const text = element.textContent?.trim()
    if (text && /^(L|UR|SR|R|PC|C)$/.test(text)) return text
  }
  for (const element of card.querySelectorAll('[style]')) {
    const match = element
      .getAttribute('style')
      ?.match(/--color-rarity-(l|ur|sr|r|pc|c)\b/i)
    if (match) return match[1].toUpperCase()
  }
  return null
}

function getCardElement(heading: Element): HTMLElement | null {
  return heading.closest<HTMLElement>(
    'div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"], a[href^="/marketplace/"]',
  )
}

function renderBadge(card: HTMLElement, identity: Card): void {
  const { id, rarity } = identity
  const heading = card.querySelector('h3')
  if (!heading?.parentElement) return
  const stats = heading.parentElement.querySelector<HTMLElement>(
    ':scope > div.mt-auto',
  )
  if (!stats) return
  let host = card.querySelector<HTMLElement>('[data-wm-toolbox-price]')
  if (!host) {
    host = document.createElement('div')
    host.dataset.wmToolboxPrice = id
    createToolboxRoot(host).append(createPriceBadge())
  }
  host.dataset.wmToolboxPriceLayout = 'footer'
  if (host.parentElement !== stats || host !== stats.lastElementChild)
    stats.append(host)
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  host.dataset.wmToolboxPrice = id
  const quote = readPriceQuote(id, rarity)
  badge.dataset.cardId = id
  badge.dataset.rarity = rarity ?? ''
  badge.dataset.cardTitle = identity.title
  updatePriceBadge(badge, quote)
  if (needsPrice(id)) {
    visiblePriceObserver.observe(card)
  }
}

const visiblePriceObserver = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      visiblePriceObserver.unobserve(entry.target)
      const id = (entry.target as HTMLElement).dataset.wmToolboxCardId
      if (id) void requestPriceQuote(id)
    }
  },
  { rootMargin: '320px 0px' },
)

export function renderCards(): void {
  if (
    !/^\/(collection|global-collection|pulls|marketplace|trades)(\/|$)/.test(
      location.pathname,
    )
  )
    return
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
    card.dataset.wmToolboxCardTitle = identity.title
    card.dataset.wmToolboxCardRarity = identity.rarity ?? ''
    renderBadge(card, identity)
  }
  for (const heading of document.querySelectorAll<HTMLElement>('h2')) {
    const parent = heading.parentElement
    if (
      !parent?.querySelector('[role="tablist"][aria-label="Vue de la carte"]')
    )
      continue
    const card = resolveVisibleCard(
      heading.textContent,
      rarityFromElement(parent),
    )
    if (!card) continue
    const hasFooter = [
      ...(parent.parentElement?.querySelectorAll<HTMLElement>(
        '[data-wm-toolbox-price-layout="footer"]',
      ) ?? []),
    ].some(host => host.dataset.wmToolboxPrice === card.id)
    if (hasFooter) {
      if (
        heading.nextElementSibling?.hasAttribute('data-wm-toolbox-inline-price')
      )
        heading.nextElementSibling.remove()
    } else renderInlinePrice(heading, card)
  }
  if (/^\/trades(\/|$)/.test(location.pathname)) {
    for (const pill of document.querySelectorAll<HTMLElement>('span[title]')) {
      const rarity = pill.textContent?.match(/^(L|UR|SR|R|PC|C)\s*·/)?.[1]
      if (!rarity) continue
      const card = resolveVisibleCard(pill.title, rarity)
      if (card) renderInlinePrice(pill, card)
    }
  }
}

function renderInlinePrice(anchor: HTMLElement, identity: Card): void {
  let host = anchor.nextElementSibling as HTMLElement | null
  if (!host?.hasAttribute('data-wm-toolbox-inline-price')) {
    host = document.createElement('span')
    host.dataset.wmToolboxInlinePrice = '1'
    createToolboxRoot(host).append(createPriceBadge())
    anchor.after(host)
  }
  host.dataset.wmToolboxPrice = identity.id
  anchor.dataset.wmToolboxCardId = identity.id
  anchor.dataset.wmToolboxCardTitle = identity.title
  anchor.dataset.wmToolboxCardRarity = identity.rarity ?? ''
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  badge.dataset.cardId = identity.id
  badge.dataset.rarity = identity.rarity ?? ''
  badge.dataset.cardTitle = identity.title
  updatePriceBadge(badge, readPriceQuote(identity.id, identity.rarity))
  if (needsPrice(identity.id)) visiblePriceObserver.observe(anchor)
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
  heading.dataset.wmToolboxCardId = id
  heading.dataset.wmToolboxCardTitle = identity.title
  heading.dataset.wmToolboxCardRarity = rarity ?? ''
  let host = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-marketplace]',
  )
  if (
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-wm-toolbox-price-layout="footer"]',
      ),
    ].some(footer => footer.dataset.wmToolboxPrice === id)
  ) {
    host?.remove()
    return
  }
  if (!host) {
    host = document.createElement('div')
    host.dataset.wmToolboxMarketplace = '1'
    createToolboxRoot(host).append(createPriceBadge(true))
    heading.insertAdjacentElement('afterend', host)
  }
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  const quote = readPriceQuote(id, rarity)
  badge.dataset.cardId = id
  badge.dataset.rarity = rarity ?? ''
  badge.dataset.cardTitle = identity.title
  updatePriceBadge(badge, quote)
  if (needsPrice(id)) void requestPriceQuote(id)
}

export async function hydrateRoute(): Promise<void> {
  const path = location.pathname
  const expectedAccount = getAccountId()
  marketplaceCard = null
  let url: string | null = null
  if (/^\/global-collection(\/|$)/.test(path)) {
    url = '/api/cards?page=0&sort=rarity'
    // The game's catalogue can restore filtered pages without making a fetch.
    // Recover only public card metadata; ownership and friend fields are ignored.
    try {
      const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
        sessionStorage.key(index),
      ).filter(
        (key): key is string => !!key && /^gc_v\d+_\/api\/cards\?/.test(key),
      )
      for (const key of keys.slice(-100)) {
        try {
          const cached = JSON.parse(sessionStorage.getItem(key) ?? '{}')
          if (Array.isArray(cached.cards))
            registerCards(
              cached.cards
                .slice(0, 50)
                .map((row: unknown) => mapCard(row))
                .filter((card: Card | null): card is Card => card !== null),
            )
        } catch {
          /* Ignore a malformed native cache page. */
        }
      }
    } catch {
      /* Live response interception still works without session storage. */
    }
  }
  if (path === '/trades') url = '/api/trades'
  if (path === '/marketplace') url = '/api/marketplace?page=1&limit=50'
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
    } else if (Array.isArray(json.cards) || Array.isArray(json.auctions)) {
      registerCards(
        ((json.cards as unknown[]) ?? (json.auctions as unknown[]))
          .map(row => mapCard(row))
          .filter((card): card is Card => card !== null),
      )
    } else if (Array.isArray(json.trades)) {
      registerCards(
        json.trades
          .flatMap(trade => (Array.isArray(trade?.items) ? trade.items : []))
          .map(row => mapCard(row))
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
