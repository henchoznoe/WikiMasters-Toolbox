import { resolveCardIdentity } from './card-identity'
import {
  pruneCardPriceLayouts,
  releaseCardPriceSpace,
  reserveCardPriceSpace,
  resetCardPriceLayouts,
} from './card-price-layout'
import { setCompatibilityIssue } from './compatibility'
import { setLoadingText } from './loading'
import {
  cardSelectors,
  parsePageCards,
  resolvePageAdapter,
} from './page-adapters'
import { mapPriceListing } from './price-comparison'
import { currentPriceContext } from './price-context'
import { observePriceListings } from './price-listings'
import { presentPrice, priceFreshness } from './price-presentation'
import { requestJson } from './requests'
import { saleSample } from './sales-model'
import { observeSaleSamples } from './sales-store'

export { formatPriceAge, presentPrice } from './price-presentation'

import { cardVariantKey, mapCard } from '../cards'
import { getAccountId } from './account'
import { openPriceInspector } from './price-inspector'
import {
  isPriceLoading,
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
    const heading = element.querySelector('h3')
    const modalHeading = element.matches('h2')
      ? element
      : element.querySelector('h2')
    const listingHeading =
      element.matches('h1') &&
      marketplaceCard &&
      normalizeTitle(element.textContent) ===
        normalizeTitle(marketplaceCard.title)
    const hints = nativeCardHints(element)
    const card = listingHeading
      ? marketplaceCard
      : resolveVisibleCard(
          heading?.textContent ??
            modalHeading?.textContent ??
            element.getAttribute('title'),
          heading
            ? rarityFromElement(element)
            : modalHeading?.parentElement
              ? rarityFromElement(modalHeading.parentElement)
              : (element.textContent?.match(/^(L|UR|SR|R|PC|C)\s*·/)?.[1] ??
                null),
          hints.id,
          hints.shiny,
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
    if (cardsByVariant.size > 10_000) {
      const oldest = cardsByVariant.keys().next().value as string
      const removed = cardsByVariant.get(oldest)
      cardsByVariant.delete(oldest)
      if (removed) {
        const title = normalizeTitle(removed.title)
        const variants = variantsByTitle.get(title)
        variants?.delete(oldest)
        if (!variants?.size) variantsByTitle.delete(title)
      }
    }
    const title = normalizeTitle(card.title)
    const variants = variantsByTitle.get(title) ?? new Set<string>()
    variants.add(key)
    variantsByTitle.set(title, variants)
  }
  requestRender()
}

export function resetRegisteredCards(): void {
  resetCardPriceLayouts()
  cardsByVariant.clear()
  variantsByTitle.clear()
  marketplaceCard = null
  visiblePriceObserver.disconnect()
  for (const card of document.querySelectorAll<HTMLElement>(
    '[data-wm-toolbox-card-id]',
  )) {
    delete card.dataset.wmToolboxCardId
    delete card.dataset.wmToolboxCardTitle
    delete card.dataset.wmToolboxCardRarity
  }
  for (const host of document.querySelectorAll(
    '[data-wm-toolbox-price], [data-wm-toolbox-marketplace]',
  ))
    host.remove()
}

export function resolveVisibleCard(
  title: string | null,
  rarity: string | null,
  id: string | null = null,
  shiny: boolean | null = null,
): Card | null {
  const cards = id
    ? [...cardsByVariant.values()]
    : [...(variantsByTitle.get(normalizeTitle(title)) ?? [])].flatMap(key => {
        const card = cardsByVariant.get(key)
        return card ? [card] : []
      })
  return resolveCardIdentity(cards, { title, rarity, id, shiny })
}
function nativeCardHints(element: HTMLElement): {
  id: string | null
  shiny: boolean | null
} {
  return {
    id:
      element.getAttribute('data-card-id') ??
      element.getAttribute('data-catalogue-id'),
    shiny:
      element.getAttribute('data-is-shiny') === 'true'
        ? true
        : element.getAttribute('data-is-shiny') === 'false'
          ? false
          : null,
  }
}

function updatePriceBadge(badge: HTMLElement, quote: PriceQuote): void {
  const presentation = presentPrice(
    quote,
    currentPriceContext(),
    badge.dataset.shiny === 'true',
  )
  badge.dataset.status = presentation.status
  const freshness = priceFreshness(quote, currentPriceContext())
  const detail = badge.querySelector<HTMLElement>('.wm-price-state')
  if (detail) {
    const next =
      badge.dataset.shiny === 'true'
        ? 'Variante brillante · prix inconnu'
        : currentPriceContext() === 'decision'
          ? freshness.text
          : ''
    if (detail.textContent !== next) detail.textContent = next
    detail.hidden = !next
  }
  badge.dataset.warning = String(freshness.warning)
  const value = badge.querySelector<HTMLElement>('.wm-price-value')
  const age = badge.querySelector<HTMLElement>('.wm-price-age')
  if (value)
    setLoadingText(
      value,
      presentation.value,
      presentation.status === 'loading' ||
        isPriceLoading(badge.dataset.cardId ?? ''),
    )
  if (age) {
    const next = presentation.age ? `· ${presentation.age}` : ''
    if (age.textContent !== next) age.textContent = next
    age.hidden = !presentation.age
  }
  if (badge.title !== presentation.hint) badge.title = presentation.hint
  const spoken = `${presentation.status === 'available' ? 'Prix moyen de vente' : 'État du prix moyen de vente'}: ${presentation.value}${presentation.age ? `, vérifié il y a ${presentation.age}` : ''}. ${presentation.hint}`
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
        badge.dataset.shiny === 'true',
      )
  })
  badge.className = `wm-price-badge${large ? ' wm-price-badge-large' : ''}`
  const value = document.createElement('span')
  value.className = 'wm-price-value'
  const age = document.createElement('span')
  age.className = 'wm-price-age'
  age.hidden = true
  const line = document.createElement('span')
  line.className = 'wm-price-badge-main'
  line.append(value, age)
  const detail = document.createElement('span')
  detail.className = 'wm-price-state'
  detail.hidden = true
  badge.append(line, detail)
  return badge
}

function showUnknownPrice(badge: HTMLButtonElement): void {
  badge.disabled = true
  delete badge.dataset.cardId
  badge.dataset.warning = 'true'
  badge.setAttribute(
    'aria-label',
    'Prix inconnu · identité ou rareté ambiguë · aucune lecture',
  )
  badge.dataset.status = 'unknown-rarity'
  const value = badge.querySelector('.wm-price-value')
  const age = badge.querySelector<HTMLElement>('.wm-price-age')
  const detail = badge.querySelector<HTMLElement>('.wm-price-state')
  if (value) setLoadingText(value as HTMLElement, 'Prix inconnu', false)
  if (age) age.hidden = true
  if (detail) {
    detail.textContent = 'Identité ou rareté ambiguë'
    detail.hidden = false
  }
  badge.title =
    'Carte non identifiée avec certitude · aucune lecture ni prix déduit'
}
function renderUnknownInline(anchor: HTMLElement): void {
  delete anchor.dataset.wmToolboxCardId
  delete anchor.dataset.wmToolboxCardTitle
  delete anchor.dataset.wmToolboxCardRarity
  visiblePriceObserver.unobserve(anchor)
  let host = anchor.nextElementSibling as HTMLElement | null
  if (!host?.hasAttribute('data-wm-toolbox-inline-price')) {
    host = document.createElement('span')
    host.dataset.wmToolboxInlinePrice = '1'
    createToolboxRoot(host).append(createPriceBadge())
    anchor.after(host)
  }
  host.dataset.wmToolboxPrice = ''
  const badge = host.shadowRoot?.firstElementChild as HTMLButtonElement | null
  if (badge) showUnknownPrice(badge)
}

function rarityFromElement(card: Element): string | null {
  const labels = new Set(
    [...card.querySelectorAll('span, div')].flatMap(element => {
      const text = element.textContent?.trim()
      return text && /^(L|UR|SR|R|PC|C)$/.test(text) ? [text] : []
    }),
  )
  if (labels.size) return labels.size === 1 ? [...labels][0] : null
  const styles = new Set(
    [...card.querySelectorAll('[style]')].flatMap(element => {
      const matches = [
        ...(element.getAttribute('style') ?? '').matchAll(
          /--color-rarity-(l|ur|sr|r|pc|c)\b/gi,
        ),
      ]
      return matches.map(match => match[1].toUpperCase())
    }),
  )
  return styles.size === 1 ? [...styles][0] : null
}

function getCardElement(heading: Element): HTMLElement | null {
  return heading.closest<HTMLElement>(cardSelectors.grid)
}

function renderBadge(card: HTMLElement, identity: Card): void {
  const { id, rarity } = identity
  const heading = card.querySelector('h3')
  if (!heading?.parentElement) return
  const stats = heading.parentElement.querySelector<HTMLElement>(
    cardSelectors.stats,
  )
  if (!stats) return
  const container =
    card.closest<HTMLElement>('a[href^="/marketplace/"]') ?? card
  let host = container.querySelector<HTMLElement>('[data-wm-toolbox-price]')
  if (!host) {
    host = document.createElement('div')
    host.dataset.wmToolboxPrice = id
    createToolboxRoot(host).append(createPriceBadge())
  }
  const marketLink = card.closest<HTMLElement>('a[href^="/marketplace/"]')
  const target = marketLink ?? stats
  host.dataset.wmToolboxPriceLayout = marketLink ? 'market' : 'footer'
  if (host.parentElement !== target || host !== target.lastElementChild)
    target.append(host)
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  host.dataset.wmToolboxPrice = id
  const quote = readPriceQuote(id, rarity)
  ;(badge as HTMLButtonElement).disabled = false
  badge.dataset.cardId = id
  badge.dataset.rarity = rarity ?? ''
  badge.dataset.cardTitle = identity.title
  badge.dataset.shiny = String(identity.shiny)
  updatePriceBadge(badge, quote)
  if (marketLink) releaseCardPriceSpace(host)
  else reserveCardPriceSpace(card, host)
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
  pruneCardPriceLayouts()
  if (
    !/^\/(collection|global-collection|marketplace|trades)(\/|$)/.test(
      location.pathname,
    )
  )
    return
  let missingLayout = false
  for (const heading of document.querySelectorAll('h3')) {
    const card = getCardElement(heading)
    if (!card) {
      if (resolveVisibleCard(heading.textContent, null)) missingLayout = true
      continue
    }
    const identity = resolveVisibleCard(
      heading.textContent,
      rarityFromElement(card),
      nativeCardHints(card).id,
      nativeCardHints(card).shiny,
    )
    if (!identity) {
      delete card.dataset.wmToolboxCardId
      delete card.dataset.wmToolboxCardTitle
      delete card.dataset.wmToolboxCardRarity
      visiblePriceObserver.unobserve(card)
      const stats = heading.parentElement?.querySelector(cardSelectors.stats)
      if (stats) {
        const target =
          card.closest<HTMLElement>('a[href^="/marketplace/"]') ?? stats
        const container = target === stats ? card : target
        let host = container.querySelector<HTMLElement>(
          '[data-wm-toolbox-price]',
        )
        if (!host) {
          host = document.createElement('div')
          createToolboxRoot(host).append(createPriceBadge())
        }
        host.dataset.wmToolboxPrice = ''
        host.dataset.wmToolboxPriceLayout =
          target === stats ? 'footer' : 'market'
        if (host.parentElement !== target || host !== target.lastElementChild)
          target.append(host)
        const badge = host.shadowRoot
          ?.firstElementChild as HTMLButtonElement | null
        if (badge) showUnknownPrice(badge)
        if (target === stats) reserveCardPriceSpace(card, host)
        else releaseCardPriceSpace(host)
      }
      continue
    }
    card.dataset.wmToolboxCardId = identity.id
    card.dataset.wmToolboxCardTitle = identity.title
    card.dataset.wmToolboxCardRarity = identity.rarity ?? ''
    if (!heading.parentElement?.querySelector(cardSelectors.stats))
      missingLayout = true
    renderBadge(card, identity)
  }
  setCompatibilityIssue(
    'card-ui',
    missingLayout
      ? 'Présentation des cartes modifiée ; certains prix masqués'
      : null,
  )
  for (const heading of document.querySelectorAll<HTMLElement>('h2')) {
    const parent = heading.parentElement
    if (!parent?.querySelector(cardSelectors.modal)) continue
    const card = resolveVisibleCard(
      heading.textContent,
      rarityFromElement(parent),
    )
    if (!card) {
      renderUnknownInline(heading)
      continue
    }
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
      else renderUnknownInline(pill)
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
  ;(badge as HTMLButtonElement).disabled = false
  badge.dataset.cardId = identity.id
  badge.dataset.rarity = identity.rarity ?? ''
  badge.dataset.cardTitle = identity.title
  badge.dataset.shiny = String(identity.shiny)
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
  ;(badge as HTMLButtonElement).disabled = false
  badge.dataset.cardId = id
  badge.dataset.rarity = rarity ?? ''
  badge.dataset.cardTitle = identity.title
  badge.dataset.shiny = String(identity.shiny)
  updatePriceBadge(badge, quote)
  if (rarity && needsPrice(id)) void requestPriceQuote(id)
}

let hydration: AbortController | null = null
export function cancelRouteRead(): void {
  hydration?.abort()
  hydration = null
}
export async function hydrateRoute(): Promise<void> {
  cancelRouteRead()
  const run = new AbortController()
  hydration = run
  const path = location.pathname
  const expectedAccount = getAccountId()
  const adapter = resolvePageAdapter(path)
  marketplaceCard = null
  if (!adapter) return
  if (!expectedAccount && ['collection', 'trades'].includes(adapter.id)) return
  const url = adapter.url(path)
  if (adapter.id === 'catalogue') {
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
  if (!url) return
  try {
    const json = await requestJson(url, run.signal)
    if (
      run.signal.aborted ||
      location.pathname !== path ||
      getAccountId() !== expectedAccount
    )
      return
    if (adapter.id === 'market') {
      const rows = Array.isArray(json.auctions)
        ? json.auctions
        : json.auction
          ? [json.auction]
          : []
      observePriceListings(rows.map(mapPriceListing).filter(Boolean))
      observeSaleSamples(
        rows.slice(0, 1000).flatMap(row => {
          const sample = saleSample(row)
          return sample ? [sample] : []
        }),
      )
    }
    const cards = parsePageCards(adapter, json)
    if (!cards) {
      setCompatibilityIssue(
        adapter.id,
        'Format des données du jeu modifié ; rechargez la page',
      )
      return
    }
    if (adapter.kind === 'collection') {
      const raw = json.collection as Record<string, unknown>[]
      const owners = new Set(
        raw.map(row => row.user_id).filter(value => typeof value === 'string'),
      )
      if (
        owners.size > 1 ||
        (expectedAccount &&
          [...owners].some(owner => owner !== expectedAccount))
      ) {
        setCompatibilityIssue(
          'collection',
          'Compte de la collection différent ; actions suspendues',
        )
        return
      }
    }
    setCompatibilityIssue(adapter.id, null)
    setCompatibilityIssue(`read:${adapter.id}`, null)
    registerCards(cards, json.auction ? 'marketplace' : adapter.kind)
  } catch {
    if (!run.signal.aborted && getAccountId() === expectedAccount)
      setCompatibilityIssue(
        `read:${adapter.id}`,
        'Données de page indisponibles ; rechargez pour réessayer',
      )
  } finally {
    if (hydration === run) hydration = null
  }
}
