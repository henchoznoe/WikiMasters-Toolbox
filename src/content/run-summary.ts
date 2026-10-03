import { getAccountId } from './account'
import { storedMessage } from './presentation'
import { openPriceInspector } from './price-inspector'
import {
  type PriceQuote,
  presentPrice,
  readPriceQuote,
  requestPriceQuote,
} from './prices'
import { createRarityBadge } from './rarity'

export type RunCard = {
  id: string | null
  title: string
  rarity: string | null
  pack: number
}

export type RunSummary = {
  accountId: string
  mode: 'manual' | 'auto'
  opened: number
  detail: string
  finishedAt: number
  cards: RunCard[]
  expanded: boolean
}

export const RUN_SUMMARY_KEY = 'wm_toolbox_last_pack_run_v2:'
const PRICE_PREFETCH_LIMIT = 50
const RUN_RETENTION = 7 * 86400_000
function cleanRunSummaries(): void {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, i) =>
      sessionStorage.key(i),
    ).filter((key): key is string => !!key?.startsWith(RUN_SUMMARY_KEY))
    const rows = keys
      .map(key => {
        try {
          return {
            key,
            at:
              Number(
                JSON.parse(sessionStorage.getItem(key) ?? '{}').finishedAt,
              ) || 0,
          }
        } catch {
          return { key, at: 0 }
        }
      })
      .sort((a, b) => b.at - a.at)
    for (const [index, row] of rows.entries()) {
      if (
        index >= 10 ||
        row.at > Date.now() ||
        Date.now() - row.at > RUN_RETENTION
      )
        sessionStorage.removeItem(row.key)
    }
  } catch {
    /* Session storage unavailable. */
  }
}
let priceObserver: IntersectionObserver | null = null

function limitedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 180)
    : null
}

export function captureRunCards(cards: unknown[], pack: number): RunCard[] {
  return cards.map(value => {
    const entry =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {}
    const nested =
      entry.card && typeof entry.card === 'object'
        ? (entry.card as Record<string, unknown>)
        : entry
    const identity = mapCard(value, true)
    return {
      id: identity?.id ?? null,
      title:
        limitedString(nested.wikipedia_title) ||
        limitedString(nested.title) ||
        limitedString(entry.wikipedia_title) ||
        'Carte inconnue',
      rarity:
        identity?.rarity ??
        limitedString(entry.snapshot_rarity) ??
        limitedString(nested.rarity),
      pack,
    }
  })
}

export function saveRunSummary(summary: RunSummary): void {
  summary = { ...summary, cards: summary.cards.slice(0, 500) }
  try {
    sessionStorage.setItem(
      RUN_SUMMARY_KEY + summary.accountId,
      JSON.stringify(summary),
    )
  } catch {
    /* Session storage unavailable. */
  }
  cleanRunSummaries()
  renderRunSummary()
}

export function readRunSummary(): RunSummary | null {
  cleanRunSummaries()
  try {
    const raw = sessionStorage.getItem(RUN_SUMMARY_KEY + getAccountId())
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<RunSummary>
    if (
      typeof value.accountId !== 'string' ||
      value.accountId !== getAccountId() ||
      (value.mode !== 'manual' && value.mode !== 'auto') ||
      !Number.isSafeInteger(value.opened) ||
      (value.opened ?? -1) < 0 ||
      typeof value.detail !== 'string' ||
      typeof value.finishedAt !== 'number' ||
      !Number.isFinite(value.finishedAt) ||
      value.finishedAt > Date.now() ||
      Date.now() - value.finishedAt > RUN_RETENTION
    )
      return null
    const cards = Array.isArray(value.cards)
      ? value.cards.filter(
          (card): card is RunCard =>
            card &&
            typeof card === 'object' &&
            (card.id === null || typeof card.id === 'string') &&
            typeof card.title === 'string' &&
            (card.rarity === null || typeof card.rarity === 'string') &&
            Number.isSafeInteger(card.pack) &&
            card.pack > 0,
        )
      : []
    return { ...value, cards, expanded: value.expanded === true } as RunSummary
  } catch {
    return null
  }
}

export function setRunSummaryExpanded(expanded: boolean): void {
  const summary = readRunSummary()
  if (!summary || summary.expanded === expanded) return
  summary.expanded = expanded
  try {
    sessionStorage.setItem(
      RUN_SUMMARY_KEY + summary.accountId,
      JSON.stringify(summary),
    )
  } catch {
    /* Session storage unavailable. */
  }
  if (expanded) prefetchPrices(summary)
}

function prefetchPrices(summary: RunSummary): void {
  const ids = new Set<string>()
  for (const card of summary.cards.slice(0, PRICE_PREFETCH_LIMIT)) {
    if (card.id) ids.add(card.id)
  }
  for (const id of ids) requestPriceQuote(id)
}

function priceText(quote: PriceQuote | null): string {
  if (!quote) return '—'
  const presentation = presentPrice(quote)
  return `${presentation.value}${presentation.age ? ` · ${presentation.age}` : ''}`
}

function priceHint(quote: PriceQuote | null): string {
  if (!quote) return 'Aucun identifiant de marché pour cette carte'
  const presentation = presentPrice(quote)
  return `${presentation.hint}${presentation.age ? ` · chargé il y a ${presentation.age}` : ''}`
}

export function compareRunPrices(
  left: PriceQuote | null,
  right: PriceQuote | null,
): number {
  if (left?.status === 'available' && right?.status === 'available')
    return right.average - left.average
  if (left?.status === 'available') return -1
  if (right?.status === 'available') return 1
  return 0
}

function observer(): IntersectionObserver {
  priceObserver ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      priceObserver?.unobserve(entry.target)
      const id = (entry.target as HTMLElement).dataset.wmRunCardId
      if (id) requestPriceQuote(id)
    }
  })
  return priceObserver
}

function buildRunBody(details: HTMLDetailsElement, summary: RunSummary): void {
  priceObserver?.disconnect()
  const heading = document.createElement('summary')
  heading.textContent = `Dernière ouverture · ${summary.opened} paquet${summary.opened === 1 ? '' : 's'}${summary.cards.length ? ` · ${summary.cards.length} cartes` : ''}`
  const body = document.createElement('div')
  body.className = 'wm-run-body'
  const meta = document.createElement('p')
  meta.className = 'wm-run-meta'
  meta.textContent = `${summary.mode === 'auto' ? 'Automatique' : 'Manuelle'} · ${storedMessage(summary.detail)} · ${new Date(summary.finishedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  body.append(meta)
  if (summary.cards.length) {
    const total = document.createElement('p')
    total.className = 'wm-run-total'
    body.append(total)
    const list = document.createElement('div')
    list.className = 'wm-run-cards'
    list.setAttribute('role', 'list')
    for (const [index, card] of summary.cards.entries()) {
      const row = document.createElement('div')
      row.className = 'wm-run-card'
      row.classList.toggle('wm-run-card-multi', summary.opened > 1)
      row.setAttribute('role', 'listitem')
      row.dataset.wmRunCardIndex = String(index)
      if (card.id) row.dataset.wmRunCardId = card.id
      const rarity = createRarityBadge(card.rarity)
      rarity.classList.add('wm-run-rarity')
      const title = document.createElement('span')
      title.className = 'wm-run-card-title'
      title.textContent = card.title
      title.title = `${card.title} · Paquet ${card.pack}`
      if (summary.opened > 1) {
        const packTag = document.createElement('span')
        packTag.className = 'wm-run-pack-tag'
        packTag.textContent = `P${card.pack}`
        row.append(rarity, title, packTag)
      } else row.append(rarity, title)
      const price = document.createElement('button')
      price.type = 'button'
      price.addEventListener('click', () => {
        if (card.id && card.rarity)
          openPriceInspector(card.id, card.rarity, card.title)
      })
      price.className = 'wm-run-card-price'
      price.textContent = '…'
      row.append(price)
      list.append(row)
    }
    body.append(list)
  }
  details.replaceChildren(heading, body)
  details.open = summary.expanded
  if (summary.expanded) prefetchPrices(summary)
}

export function renderRunSummary(): void {
  const details = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLDetailsElement>('[data-wm-toolbox-summary]')
  if (!details) return
  const summary = readRunSummary()
  details.hidden = !summary
  if (!summary) return
  const runKey = `${summary.accountId}:${summary.finishedAt}`
  if (details.dataset.wmRunKey !== runKey) {
    buildRunBody(details, summary)
    details.dataset.wmRunKey = runKey
  }
  if (!summary.cards.length) return
  let knownTotal = 0
  let knownCount = 0
  const ranked: {
    row: HTMLElement
    index: number
    quote: PriceQuote | null
  }[] = []
  for (const row of details.querySelectorAll<HTMLElement>('.wm-run-card')) {
    const index = Number(row.dataset.wmRunCardIndex)
    const card = summary.cards[index]
    if (!card) continue
    const quote = card.id ? readPriceQuote(card.id, card.rarity) : null
    ranked.push({ row, index, quote })
    const label = row.querySelector<HTMLElement>('.wm-run-card-price')
    if (label) {
      const next = priceText(quote)
      if (label.textContent !== next) label.textContent = next
      const hint = priceHint(quote)
      if (label.title !== hint) label.title = hint
      const spokenPrice =
        quote?.status === 'available' ? `Prix moyen de vente : ${next}` : hint
      if (label.getAttribute('aria-label') !== spokenPrice)
        label.setAttribute('aria-label', spokenPrice)
      if (quote && 'fetchedAt' in quote)
        label.dataset.wmPriceFetchedAt = String(quote.fetchedAt)
      else delete label.dataset.wmPriceFetchedAt
    }
    if (quote?.status === 'available') {
      knownCount += 1
      knownTotal += quote.average
    } else if (quote?.status === 'loading') {
      observer().observe(row)
    }
  }
  ranked.sort(
    (left, right) =>
      compareRunPrices(left.quote, right.quote) || left.index - right.index,
  )
  const list = details.querySelector<HTMLElement>('.wm-run-cards')
  if (list) {
    const orderedRows = ranked.map(item => item.row)
    if (orderedRows.some((row, index) => list.children[index] !== row))
      list.append(...orderedRows)
  }
  const total = details.querySelector<HTMLElement>('.wm-run-total')
  if (!total) return
  const next = knownCount
    ? `Total : ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(knownTotal)} W · ${knownCount}/${summary.cards.length} évaluées`
    : `0/${summary.cards.length} évaluées`
  if (total.textContent !== next) total.textContent = next
}

import { mapCard } from '../cards'
