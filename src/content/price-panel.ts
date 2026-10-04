import { currentPriceContext } from './price-context'
import {
  createPriceInsights,
  renderPriceInsights,
} from './price-insights-panel'
import { RARITIES } from './price-model'
import {
  cancelPriceBatch,
  canRefreshPrice,
  getPriceBatch,
  needsPriceForContext,
  priceRequestLimit,
  startPriceBatch,
} from './price-store'
import { getVisiblePriceCards } from './prices'
import { createRarityBadge } from './rarity'

export function createPriceControls(): HTMLElement {
  const details = document.createElement('details')
  details.className = 'wm-price-controls'
  const summary = document.createElement('summary')
  summary.textContent = 'Prix'
  summary.dataset.priceControlsSummary = '1'
  const controls = document.createElement('div')
  controls.className = 'wm-price-controls-body'
  const scope = document.createElement('select')
  scope.setAttribute('aria-label', 'Périmètre d’actualisation des prix')
  scope.dataset.priceScope = '1'
  for (const [value, label] of [['page', 'Cartes de cette page']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    scope.append(option)
  }
  const rarities = document.createElement('div')
  rarities.className = 'wm-price-rarities'
  for (const rarity of RARITIES) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'wm-price-rarity'
    button.dataset.priceFilter = rarity
    button.setAttribute('aria-pressed', 'true')
    button.setAttribute('aria-label', `Inclure ${rarity}`)
    button.append(createRarityBadge(rarity))
    button.addEventListener('click', () => {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('aria-pressed') !== 'true'),
      )
      renderPricePanel()
    })
    rarities.append(button)
  }
  const forceLabel = document.createElement('label')
  forceLabel.className = 'wm-note'
  const force = document.createElement('input')
  force.type = 'checkbox'
  force.dataset.priceForce = '1'
  forceLabel.append(force, ' Actualiser les prix en cache')
  const capLabel = document.createElement('label')
  capLabel.className = 'wm-note'
  capLabel.textContent = 'Requêtes max '
  const cap = document.createElement('input')
  cap.type = 'number'
  cap.min = '1'
  cap.max = '100'
  cap.value = '50'
  cap.dataset.priceCap = '1'
  cap.setAttribute('aria-label', 'Nombre maximal de requêtes de prix')
  capLabel.append(cap)
  const actions = document.createElement('div')
  actions.className = 'wm-price-actions'
  const start = document.createElement('button')
  start.type = 'button'
  start.className = 'wm-primary-button'
  start.textContent = 'Charger'
  start.dataset.priceStart = '1'
  start.addEventListener('click', () => {
    const active = new Set(
      [...details.querySelectorAll<HTMLButtonElement>('[data-price-filter]')]
        .filter(button => button.getAttribute('aria-pressed') === 'true')
        .map(button => button.dataset.priceFilter),
    )
    const cards = getVisiblePriceCards()
    void startPriceBatch(
      cards.filter(card => active.has(card.rarity ?? '')).map(card => card.id),
      force.checked,
      Number(cap.value),
      currentPriceContext(),
    )
  })
  const stop = document.createElement('button')
  stop.type = 'button'
  stop.className = 'wm-quiet-button'
  stop.textContent = 'Arrêter'
  stop.dataset.priceStop = '1'
  stop.addEventListener('click', cancelPriceBatch)
  actions.append(start, stop)
  const progress = document.createElement('progress')
  progress.dataset.priceProgress = '1'
  progress.setAttribute('aria-label', 'Progression du chargement des prix')
  const state = document.createElement('p')
  state.dataset.priceBatch = '1'
  state.className = 'wm-note'
  state.setAttribute('role', 'status')
  controls.append(
    scope,
    rarities,
    forceLabel,
    capLabel,
    actions,
    progress,
    state,
  )
  controls.append(createPriceInsights())
  details.append(summary, controls)
  scope.addEventListener('change', renderPricePanel)
  force.addEventListener('change', renderPricePanel)
  return details
}
export function createPricesBody(): HTMLElement {
  const body = document.createElement('div')
  body.className = 'wm-panel-body'
  body.append(createPriceControls())
  return body
}
export function renderPricePanel(): void {
  renderPriceInsights()
  const root = document.querySelector('[data-wm-toolbox-panel]')?.shadowRoot
  if (!root) return
  const state = getPriceBatch()
  const text = root.querySelector<HTMLElement>('[data-price-batch]')
  const progress = root.querySelector<HTMLProgressElement>(
    '[data-price-progress]',
  )
  const start = root.querySelector<HTMLButtonElement>('[data-price-start]')
  const stop = root.querySelector<HTMLButtonElement>('[data-price-stop]')
  const scope = root.querySelector<HTMLSelectElement>('[data-price-scope]')
  const force = root.querySelector<HTMLInputElement>('[data-price-force]')
  if (!text || !progress || !start || !stop || !scope) return
  const active = new Set(
    [...root.querySelectorAll<HTMLButtonElement>('[data-price-filter]')]
      .filter(button => button.getAttribute('aria-pressed') === 'true')
      .map(button => button.dataset.priceFilter),
  )
  const cards = getVisiblePriceCards()
  const ids = [
    ...new Set(
      cards.filter(card => active.has(card.rarity ?? '')).map(card => card.id),
    ),
  ]
  const pending = ids.filter(id =>
    force?.checked
      ? canRefreshPrice(id)
      : needsPriceForContext(id, currentPriceContext()),
  ).length
  const limit = priceRequestLimit()
  text.textContent =
    state.total || state.cancelled
      ? `${state.done} / ${state.total} · ${state.running ? '…' : state.cancelled ? 'arrêté' : state.done < state.total ? 'en pause' : '✓'}${state.failed ? ` · ${state.failed} !` : ''}${state.skipped ? ` · ${state.skipped} ignorées` : ''}${limit ? ` · ${limit}` : ''}`
      : `${pending} / ${ids.length} cartes${limit ? ` · ${limit}` : ''}`
  text.title = `Récapitulatif uniquement · 1 requête / 650 ms · 200 / heure par onglet · actualisation ≥1 min · « Arrêter » termine la lecture actuelle ; les lectures automatiques en file pour les cartes visibles sont indépendantes.`
  start.textContent =
    currentPriceContext() === 'decision'
      ? 'Actualiser avant de décider'
      : 'Charger'
  text.title +=
    ' · album : 24 h ; vente / échange : 15 min · seuls les prix plus anciens sont actualisés, sauf si « Actualiser les prix en cache » est coché.'
  start.disabled = state.running || !pending || !!limit
  stop.hidden = !state.running
  progress.hidden = !state.running
  progress.max = Math.max(1, state.total)
  progress.value = state.done
}
