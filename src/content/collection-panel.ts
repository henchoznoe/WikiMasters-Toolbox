import { getAccountId } from './account'
import {
  getCollectionState,
  loadCollection,
  stopCollectionLoad,
} from './collection'
import { getSelectionState } from './collection-actions'
import {
  createCollectionBrowser,
  renderCollectionBrowser,
} from './collection-browser'
import { collectionValue } from './collection-value'
import {
  createMarketControls,
  createRankingControls,
  renderMarketPanel,
} from './market-panel'
import { createPriceControls } from './price-panel'
import { formatPriceAge } from './price-presentation'
import { readPriceQuote, startPriceBatch } from './price-store'
import { registerCards } from './prices'
import {
  createSelectionControls,
  renderSelectionPanel,
} from './selection-panel'

export function createCollectionBody(): HTMLElement {
  const body = document.createElement('div')
  body.className = 'wm-panel-body'
  const summary = document.createElement('p')
  summary.className = 'wm-collection-summary'
  summary.dataset.wmCollectionSummary = '1'
  summary.setAttribute('role', 'status')
  summary.setAttribute('aria-live', 'polite')
  const progress = document.createElement('progress')
  progress.dataset.wmCollectionProgress = '1'
  progress.className = 'wm-collection-progress'
  progress.setAttribute(
    'aria-label',
    'Progression du chargement de la collection',
  )
  const actions = document.createElement('div')
  actions.className = 'wm-collection-actions'
  const load = document.createElement('button')
  load.type = 'button'
  load.className = 'wm-primary-button'
  load.dataset.wmCollectionLoad = '1'
  load.addEventListener('click', () => {
    if (getCollectionState().status === 'loading') stopCollectionLoad()
    else void loadCollection()
  })
  const fresh = document.createElement('button')
  fresh.type = 'button'
  fresh.className = 'wm-quiet-button'
  fresh.dataset.wmCollectionFresh = '1'
  fresh.textContent = '↻'
  fresh.title = 'Recharger la collection complète'
  fresh.setAttribute('aria-label', fresh.title)
  fresh.addEventListener('click', () => {
    void loadCollection(true)
  })
  actions.append(load, fresh)
  const note = document.createElement('p')
  note.className = 'wm-note'
  note.dataset.wmCollectionNote = '1'
  body.append(
    summary,
    progress,
    actions,
    note,
    createCollectionBrowser(),
    createSelectionControls(),
    createPriceControls(),
    createValueControls(),
    createRankingControls(),
    createMarketControls(),
  )
  return body
}

export function renderCollectionPanel(): void {
  const state = getCollectionState()
  const root = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-panel="collection"]',
  )?.shadowRoot
  if (!root) return
  const summary = root.querySelector<HTMLElement>(
    '[data-wm-collection-summary]',
  )
  const progress = root.querySelector<HTMLProgressElement>(
    '[data-wm-collection-progress]',
  )
  const load = root.querySelector<HTMLButtonElement>(
    '[data-wm-collection-load]',
  )
  const fresh = root.querySelector<HTMLButtonElement>(
    '[data-wm-collection-fresh]',
  )
  const note = root.querySelector<HTMLElement>('[data-wm-collection-note]')
  if (!summary || !progress || !load || !fresh || !note) return
  const account = getAccountId()
  const complete = state.status === 'complete'
  const loading = state.status === 'loading'
  const resumable =
    (state.status === 'paused' || state.status === 'error') && state.pages > 0
  summary.textContent = !account
    ? '…'
    : `${state.cards.length}${state.total === null ? '' : ` / ${state.total}`} cartes · ${complete ? '✓' : loading ? '…' : 'partiel'}`
  summary.title = `${state.pages} pages${state.updatedAt ? ` · vérifié le ${new Date(state.updatedAt).toLocaleString('fr-FR')}` : ''}`
  progress.hidden = !loading
  if (state.total !== null) {
    progress.max = Math.max(1, state.total)
    progress.value = state.cards.length
  } else progress.removeAttribute('value')
  load.textContent = loading
    ? 'Arrêter'
    : resumable
      ? 'Reprendre'
      : complete
        ? 'Actualiser'
        : 'Charger la collection'
  const actionBusy = ['checking', 'verifying', 'running'].includes(
    getSelectionState().phase,
  )
  load.disabled = !account || (actionBusy && !loading)
  fresh.hidden = !resumable
  fresh.disabled = loading || !account || actionBusy
  note.textContent =
    state.error ??
    (state.retrying
      ? '…'
      : !state.persistent
        ? 'Non enregistré localement.'
        : '')
  note.title = state.retrying
    ? 'Le jeu est occupé ; nouvelle tentative sur la page actuelle.'
    : (state.error ?? '')
  note.hidden = !note.textContent
  renderCollectionBrowser()
  renderSelectionPanel()
  renderCollectionValue()
  renderMarketPanel()
}

function createValueControls(): HTMLElement {
  const details = document.createElement('details')
  details.className = 'wm-market-section'
  const summary = document.createElement('summary')
  summary.textContent = 'Valeur de la collection'
  const body = document.createElement('div')
  body.dataset.wmCollectionValue = '1'
  const refresh = document.createElement('button')
  refresh.type = 'button'
  refresh.className = 'wm-quiet-button'
  refresh.textContent = 'Charger / actualiser les prix · max 50'
  refresh.addEventListener('click', () => {
    void startPriceBatch(getCollectionState().cards.map(card => card.id))
  })
  details.append(summary, body, refresh)
  details.addEventListener('toggle', renderCollectionValue)
  return details
}

function renderCollectionValue(): void {
  const body = document
    .querySelector('[data-wm-toolbox-panel="collection"]')
    ?.shadowRoot?.querySelector<HTMLElement>('[data-wm-collection-value]')
  if (!body || !(body.parentElement as HTMLDetailsElement).open) return
  const state = getCollectionState()
  const value = collectionValue(state.cards, readPriceQuote)
  const share = (unknown: number, copies: number): string => {
    const percent = copies ? (100 * unknown) / copies : 0
    return percent > 0 && percent < 0.01
      ? '<0,01'
      : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(
          percent,
        )
  }
  const text = [
    state.status === 'complete'
      ? 'Index complet'
      : 'Copies chargées · index partiel',
    ...(
      [
        ['Toutes les copies', value.all],
        ['Doublons uniquement', value.duplicates],
      ] as const
    ).map(
      ([label, subtotal]) =>
        `${label}: ${subtotal.total === null ? '— (total trop élevé)' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(subtotal.total)} W · ${subtotal.copies - subtotal.unknown} / ${subtotal.copies} évaluées · ${subtotal.unknown} non évaluées (${share(subtotal.unknown, subtotal.copies)}%)${subtotal.stale ? ` · ${subtotal.stale} anciens / actualisation échouée` : ''}`,
    ),
    `Moyennes natives par rareté · copies brillantes non évaluées${value.oldest ? ` · prix le plus ancien : ${formatPriceAge(value.oldest)}` : ''}`,
  ]
  const signature = JSON.stringify(text)
  if (body.dataset.signature === signature) return
  body.dataset.signature = signature
  body.replaceChildren(
    ...text.map(text => {
      const note = document.createElement('p')
      note.className = 'wm-note'
      note.textContent = text
      return note
    }),
  )
  body.title =
    'Somme indicative des moyennes natives connues ; gain non garanti. Les prix manquants sont exclus, jamais considérés comme nuls. Le récapitulatif natif n’isole pas le prix des brillantes. Le calcul des doublons conserve une copie par ID du catalogue, rareté et variante brillante, indépendamment des règles de protection.'
}

export function mountCollectionBody(): void {
  registerCards([...getCollectionState().cards])
  renderCollectionPanel()
}
