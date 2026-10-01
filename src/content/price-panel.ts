import { getCollectionState } from './collection'
import { getSelectionState } from './collection-actions'
import { RARITIES } from './price-model'
import {
  cancelPriceBatch,
  canRefreshPrice,
  getPriceBatch,
  needsPrice,
  priceRequestLimit,
  startPriceBatch,
} from './price-store'
import { getVisiblePriceCards } from './prices'
import { createRarityBadge } from './rarity'

export function createPriceControls(): HTMLElement {
  const details = document.createElement('details')
  details.className = 'wm-price-controls'
  const summary = document.createElement('summary')
  summary.textContent = 'Prices'
  const controls = document.createElement('div')
  controls.className = 'wm-price-controls-body'
  const scope = document.createElement('select')
  scope.setAttribute('aria-label', 'Price refresh scope')
  scope.dataset.priceScope = '1'
  for (const [value, label] of [
    ['page', 'Cards on this page'],
    ['collection', 'Loaded collection'],
    ['selection', 'Selection'],
  ]) {
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
    button.setAttribute('aria-label', `Include ${rarity}`)
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
  forceLabel.append(force, ' Refresh cached prices')
  const capLabel = document.createElement('label')
  capLabel.className = 'wm-note'
  capLabel.textContent = 'Max requests '
  const cap = document.createElement('input')
  cap.type = 'number'
  cap.min = '1'
  cap.max = '100'
  cap.value = '50'
  cap.dataset.priceCap = '1'
  cap.setAttribute('aria-label', 'Maximum price requests')
  capLabel.append(cap)
  const actions = document.createElement('div')
  actions.className = 'wm-collection-actions'
  const start = document.createElement('button')
  start.type = 'button'
  start.className = 'wm-primary-button'
  start.textContent = 'Load'
  start.dataset.priceStart = '1'
  start.addEventListener('click', () => {
    const active = new Set(
      [...details.querySelectorAll<HTMLButtonElement>('[data-price-filter]')]
        .filter(button => button.getAttribute('aria-pressed') === 'true')
        .map(button => button.dataset.priceFilter),
    )
    const cards =
      scope.value === 'collection'
        ? getCollectionState().cards
        : scope.value === 'selection'
          ? getSelectionState().plan.cards
          : getVisiblePriceCards()
    void startPriceBatch(
      cards.filter(card => active.has(card.rarity ?? '')).map(card => card.id),
      force.checked,
      Number(cap.value),
    )
  })
  const stop = document.createElement('button')
  stop.type = 'button'
  stop.className = 'wm-quiet-button'
  stop.textContent = 'Stop'
  stop.dataset.priceStop = '1'
  stop.addEventListener('click', cancelPriceBatch)
  actions.append(start, stop)
  const progress = document.createElement('progress')
  progress.dataset.priceProgress = '1'
  progress.setAttribute('aria-label', 'Price loading progress')
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
  const cards =
    scope.value === 'collection'
      ? getCollectionState().cards
      : scope.value === 'selection'
        ? getSelectionState().plan.cards
        : getVisiblePriceCards()
  const ids = [
    ...new Set(
      cards.filter(card => active.has(card.rarity ?? '')).map(card => card.id),
    ),
  ]
  const pending = ids.filter(id =>
    force?.checked ? canRefreshPrice(id) : needsPrice(id),
  ).length
  const limit = priceRequestLimit()
  text.textContent =
    state.total || state.cancelled
      ? `${state.done} / ${state.total} · ${state.running ? '…' : state.cancelled ? 'stopped' : state.done < state.total ? 'paused' : '✓'}${state.failed ? ` · ${state.failed} !` : ''}${state.skipped ? ` · ${state.skipped} skipped` : ''}${limit ? ` · ${limit}` : ''}`
      : `${pending} / ${ids.length} cards${limit ? ` · ${limit}` : ''}`
  text.title = `Summary only · 1 request / 650 ms · 200 / hour per tab · refresh ≥1 min · collection scope uses the currently loaded index (${getCollectionState().status}) · Stop finishes the current read; queued automatic visible-card reads are independent.`
  start.disabled = state.running || !pending || !!limit
  stop.hidden = !state.running
  progress.hidden = !state.running
  progress.max = Math.max(1, state.total)
  progress.value = state.done
}
