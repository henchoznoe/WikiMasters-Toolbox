import { setLoadingText } from './loading'
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
  const details = document.createElement('section')
  details.className = 'wm-price-controls'
  details.setAttribute('aria-label', 'Prix des cartes de cette page')
  const overview = document.createElement('div')
  overview.className = 'wm-price-overview'
  overview.dataset.priceOverview = '1'
  overview.setAttribute('aria-live', 'polite')
  const intro = document.createElement('p')
  intro.className = 'wm-note'
  intro.textContent =
    'Cartes de cette page · choisissez les raretés à actualiser'
  const freshness = document.createElement('p')
  freshness.className = 'wm-price-context'
  freshness.dataset.priceContext = '1'
  const controls = document.createElement('div')
  controls.className = 'wm-price-controls-body'
  const rarities = document.createElement('div')
  rarities.className = 'wm-price-rarities'
  for (const rarity of RARITIES) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'wm-price-rarity wm-rarity-surface'
    button.dataset.rarity = rarity.toLowerCase()
    button.dataset.priceFilter = rarity
    button.setAttribute('aria-pressed', 'true')
    button.setAttribute('aria-label', `Inclure ${rarity}`)
    const count = document.createElement('span')
    count.className = 'wm-rarity-count'
    count.dataset.priceRarityCount = rarity
    button.append(createRarityBadge(rarity), count)
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
  forceLabel.className = 'wm-setting-row'
  const force = document.createElement('input')
  force.type = 'checkbox'
  force.dataset.priceForce = '1'
  forceLabel.append(force, ' Actualiser les prix en cache')
  const capLabel = document.createElement('label')
  capLabel.className = 'wm-setting-row'
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
  const settings = document.createElement('details')
  settings.className = 'wm-price-settings'
  const settingsHeading = document.createElement('summary')
  settingsHeading.textContent = 'Options d’actualisation'
  settings.append(settingsHeading, forceLabel, capLabel)
  controls.append(
    overview,
    intro,
    rarities,
    freshness,
    actions,
    progress,
    state,
    settings,
  )
  controls.append(createPriceInsights())
  details.append(controls)
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
  const force = root.querySelector<HTMLInputElement>('[data-price-force]')
  if (!text || !progress || !start || !stop) return
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
  const batchText =
    state.total || state.cancelled
      ? `${state.done} / ${state.total} · ${state.running ? 'en cours' : state.cancelled ? 'arrêté' : state.done < state.total ? 'en pause' : '✓'}${state.failed ? ` · ${state.failed} !` : ''}${state.skipped ? ` · ${state.skipped} ignorées` : ''}${limit ? ` · ${limit}` : ''}`
      : `${pending} / ${ids.length} cartes${limit ? ` · ${limit}` : ''}`
  setLoadingText(text, batchText, state.running)
  text.title = `Récapitulatif uniquement · 1 requête / 650 ms · 200 / heure par onglet · actualisation ≥1 min · « Arrêter » termine la lecture actuelle ; les lectures automatiques en file pour les cartes visibles sont indépendantes.`
  start.textContent =
    currentPriceContext() === 'decision'
      ? 'Actualiser avant de décider'
      : 'Actualiser les prix'
  const context = root.querySelector<HTMLElement>('[data-price-context]')
  if (context)
    context.textContent =
      currentPriceContext() === 'decision'
        ? 'Marché / échange · seuil de fraîcheur 15 min'
        : 'Lecture automatique des cartes visibles · cache 24 h'
  const overview = root.querySelector<HTMLElement>('[data-price-overview]')
  if (overview) {
    const allIds = [...new Set(cards.map(card => card.id))]
    const unknown = [
      ...document.querySelectorAll<HTMLElement>('[data-wm-toolbox-price]'),
    ].filter(host => !host.dataset.wmToolboxPrice).length
    const stats = [
      [allIds.length, 'cartes identifiées'],
      [pending, 'à actualiser'],
      [unknown, 'identités inconnues'],
    ] as const
    const key = JSON.stringify(stats)
    if (overview.dataset.key !== key) {
      overview.dataset.key = key
      overview.replaceChildren(
        ...stats.map(([value, label]) => {
          const stat = document.createElement('div')
          const count = document.createElement('strong')
          count.textContent = new Intl.NumberFormat('fr-FR').format(value)
          const caption = document.createElement('span')
          caption.textContent = label
          stat.append(count, caption)
          return stat
        }),
      )
    }
  }
  for (const count of root.querySelectorAll<HTMLElement>(
    '[data-price-rarity-count]',
  )) {
    const next = String(
      cards.filter(card => card.rarity === count.dataset.priceRarityCount)
        .length,
    )
    if (count.textContent !== next) count.textContent = next
  }
  text.title +=
    ' · album : 24 h ; vente / échange : 15 min · seuls les prix plus anciens sont actualisés, sauf si « Actualiser les prix en cache » est coché.'
  start.disabled = state.running || !pending || !!limit
  stop.hidden = !state.running
  progress.hidden = !state.running
  progress.max = Math.max(1, state.total)
  progress.value = state.done
}
