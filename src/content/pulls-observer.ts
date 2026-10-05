import { getAccountId } from './account'
import { cancelPriceBatch, startPriceBatch } from './price-store'
import {
  PullCapture,
  type PullCard,
  type PullResult,
  validPullCard,
} from './pulls-model'
import {
  activePullCompleted,
  activePullId,
  completeActivePull,
  readPullStats,
  recordPull,
  saveLastPull,
} from './pulls-store'
import { createRarityBadge } from './rarity'
import { createToolboxRoot, normalizeTitle } from './shared'

let capture: PullCapture | null = null
let nativeCards: PullCard[] = []
let frameElement: HTMLElement | null = null
let recorded = false
let recording = false
let owner: string | null = null
let message = ''
let notify: () => void = () => {}
let result: PullResult | null = null
export function setPullObserverCallback(callback: () => void): void {
  notify = callback
}
export function pullObservationState(): {
  message: string
  canRecord: boolean
} {
  return { message, canRecord: !!result && !recorded && !recording }
}
export function leavePulls(): void {
  capture = null
  nativeCards = []
  frameElement = null
  result = null
  recorded = false
  recording = false
  owner = null
  message = ''
  cancelPriceBatch()
  for (const host of document.querySelectorAll('[data-wm-pull-rarity]'))
    host.remove()
}
export function observeNativePull(id: unknown, cards: unknown): void {
  if (
    !/^\/pulls\/?$/.test(location.pathname) ||
    !getAccountId() ||
    typeof id !== 'string' ||
    !id ||
    id.length > 100 ||
    !Array.isArray(cards) ||
    cards.length !== 5 ||
    !cards.every(validPullCard)
  )
    return
  leavePulls()
  owner = getAccountId()
  nativeCards = cards
  capture = new PullCapture(id, true)
  activePullId(id)
  recorded = activePullCompleted()
  message = 'Révélez les cinq cartes pour enregistrer le paquet'
  notify()
}
function visible(element: HTMLElement): boolean {
  return (
    element.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    }) && !element.closest('[hidden], [aria-hidden="true"]')
  )
}
export function readPullFrame(): {
  slot: number
  card: PullCard
  element: HTMLElement
} | null {
  const markers = [...document.querySelectorAll<HTMLElement>('div, p')].filter(
    element =>
      /^Carte\s*[1-5]\s*\/\s*5$/.test(element.textContent?.trim() ?? '') &&
      visible(element),
  )
  const marker = markers.at(-1)
  const slot = Number(marker?.textContent?.match(/^Carte\s*([1-5])/i)?.[1])
  const container = marker?.parentElement
  if (!container || !slot) return null
  const headings = [...container.querySelectorAll<HTMLElement>('h3')].filter(
    visible,
  )
  if (headings.length !== 1) return null
  const heading = headings[0]
  const element = heading.closest<HTMLElement>(
    'div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]',
  )
  const title = heading.textContent?.trim()
  if (!element || !title || !visible(element)) return null
  const rarities = new Set(
    [...element.querySelectorAll<HTMLElement>('div, span')]
      .filter(visible)
      .map(node => node.textContent?.trim())
      .filter(text => /^(C|PC|R|SR|UR|L)$/.test(text ?? '')),
  )
  const rarity = rarities.size === 1 ? ([...rarities][0] ?? null) : null
  const rawId =
    element.getAttribute('data-catalogue-id') ??
    element.getAttribute('data-card-id')
  const catalogueId = rawId && /^[0-9a-f-]{36}$/i.test(rawId) ? rawId : null
  const shinyAttribute = element.getAttribute('data-is-shiny')
  const shiny =
    shinyAttribute === 'true'
      ? true
      : shinyAttribute === 'false'
        ? false
        : [...element.querySelectorAll<HTMLElement>('span, div')].some(
              node =>
                visible(node) &&
                /^(Brillante|Shiny)$/i.test(node.textContent?.trim() ?? ''),
            )
          ? true
          : null
  return { slot, element, card: { title, rarity, catalogueId, shiny } }
}
function enrich(card: PullCard): PullCard {
  const candidates = nativeCards.filter(
    native =>
      normalizeTitle(native.title) === normalizeTitle(card.title) &&
      (!card.rarity || native.rarity === card.rarity) &&
      (!card.catalogueId || native.catalogueId === card.catalogueId) &&
      (card.shiny === null || native.shiny === card.shiny),
  )
  if (!candidates.length) return card
  const unique = new Set(candidates.map(candidate => JSON.stringify(candidate)))
  return unique.size === 1 ? { ...candidates[0], title: card.title } : card
}
function showRarity(element: HTMLElement, card: PullCard): void {
  const heading = element.querySelector('h3')
  if (!heading) return
  let host = element.querySelector<HTMLElement>('[data-wm-pull-rarity]')
  if (!host) {
    host = document.createElement('div')
    createToolboxRoot(host)
    heading.after(host)
  }
  const signature = JSON.stringify([card.rarity, card.shiny])
  if (host.dataset.wmPullRarity === signature) return
  host.dataset.wmPullRarity = signature
  const badge = createRarityBadge(card.rarity)
  badge.setAttribute(
    'aria-label',
    card.rarity ? `Rareté ${card.rarity}` : 'Rareté inconnue',
  )
  const label = document.createElement('span')
  label.className = 'wm-pull-variant'
  label.textContent =
    card.shiny === true
      ? 'Brillante'
      : card.shiny === null
        ? 'Brillance inconnue'
        : ''
  host.shadowRoot?.replaceChildren(badge, label)
}
export async function confirmPull(): Promise<void> {
  if (!result || recorded || recording || owner !== getAccountId()) return
  const expectedCapture = capture
  const pending = result
  const expectedOwner = owner
  recording = true
  const duplicate = readPullStats().receipts.includes(pending.id)
  const success = await recordPull(
    pending,
    () => capture === expectedCapture && /^\/pulls\/?$/.test(location.pathname),
  )
  if (capture !== expectedCapture || getAccountId() !== expectedOwner) return
  recording = false
  recorded = success
  if (!success && capture) capture.automatic = false
  if (success) completeActivePull(pending.id)
  message = success
    ? duplicate
      ? 'Paquet déjà enregistré · aucun double comptage'
      : 'Paquet enregistré · résultats observés par Toolbox'
    : 'Enregistrement suspendu · verrouillage local indisponible'
  if (success && !duplicate) {
    saveLastPull(pending)
    void startPriceBatch(
      pending.cards
        .filter(card => card.catalogueId && card.rarity && card.shiny === false)
        .map(card => card.catalogueId as string),
      false,
      5,
    )
  }
  notify()
}
export function syncPullObservation(): void {
  if (!/^\/pulls\/?$/.test(location.pathname)) return
  if (!getAccountId()) {
    message = 'En attente du compte WikiMasters'
    return
  }
  if (owner && owner !== getAccountId()) leavePulls()
  const frame = readPullFrame()
  if (!frame) {
    const hasMarker = [
      ...document.querySelectorAll<HTMLElement>('div, p'),
    ].some(element =>
      /^Carte\s*[1-5]\s*\/\s*5$/.test(element.textContent?.trim() ?? ''),
    )
    if (hasMarker) return // Animation between two revealed positions, not a new pack.
    if (frameElement) {
      // A transition to an opening screen separates results, even without a network event.
      leavePulls()
    }
    if (!capture) activePullId(null)
    message = document.querySelector('h3')
      ? 'Présentation du résultat incompatible · comptage suspendu'
      : 'Ouvrez un paquet dans le jeu puis révélez ses cinq cartes'
    return
  }
  if (!capture) {
    owner = getAccountId()
    const id = activePullId() ?? crypto.randomUUID()
    capture = new PullCapture(id, false)
    activePullId(id)
    recorded = activePullCompleted()
    if (recorded) message = 'Paquet déjà enregistré · aucun double comptage'
  }
  frameElement = frame.element
  const card = enrich(frame.card)
  showRarity(frame.element, card)
  capture.observe(frame.slot, card)
  if (capture.incompatible) {
    message = 'Résultat ambigu · comptage suspendu pour ce paquet'
    return
  }
  if (!recorded && !recording) {
    message = `${capture.cards.size}/5 cartes observées · visitez chaque carte du paquet`
    result = capture.result(Date.now())
    if (result) {
      message = 'Cinq cartes observées · confirmez l’enregistrement du paquet'
      if (capture.automatic) void confirmPull()
    }
  }
}
