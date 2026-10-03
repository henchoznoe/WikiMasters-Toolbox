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
  progress.setAttribute('aria-label', 'Collection loading progress')
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
  fresh.title = 'Reload the full collection'
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
    : `${state.cards.length}${state.total === null ? '' : ` / ${state.total}`} cards · ${complete ? '✓' : loading ? '…' : 'partial'}`
  summary.title = `${state.pages} pages${state.updatedAt ? ` · checked ${new Date(state.updatedAt).toLocaleString()}` : ''}`
  progress.hidden = !loading
  if (state.total !== null) {
    progress.max = Math.max(1, state.total)
    progress.value = state.cards.length
  } else progress.removeAttribute('value')
  load.textContent = loading
    ? 'Stop'
    : resumable
      ? 'Resume'
      : complete
        ? 'Refresh'
        : 'Load collection'
  const actionBusy = ['checking', 'verifying', 'running'].includes(
    getSelectionState().phase,
  )
  load.disabled = !account || (actionBusy && !loading)
  fresh.hidden = !resumable
  fresh.disabled = loading || !account || actionBusy
  note.textContent =
    state.error ??
    (state.retrying ? '…' : !state.persistent ? 'Not saved locally.' : '')
  note.title = state.retrying
    ? 'The game is busy; retrying the current page.'
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
  summary.textContent = 'Collection value'
  const body = document.createElement('div')
  body.dataset.wmCollectionValue = '1'
  const refresh = document.createElement('button')
  refresh.type = 'button'
  refresh.className = 'wm-quiet-button'
  refresh.textContent = 'Load / refresh prices · max 50'
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
      ? '<0.01'
      : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
          percent,
        )
  }
  const text = [
    state.status === 'complete'
      ? 'Full index'
      : 'Loaded copies · partial index',
    ...(
      [
        ['All copies', value.all],
        ['Duplicates only', value.duplicates],
      ] as const
    ).map(
      ([label, subtotal]) =>
        `${label}: ${subtotal.total === null ? '— (total too large)' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(subtotal.total)} W · ${subtotal.copies - subtotal.unknown} / ${subtotal.copies} valued · ${subtotal.unknown} unvalued (${share(subtotal.unknown, subtotal.copies)}%)${subtotal.stale ? ` · ${subtotal.stale} stale / failed refresh` : ''}`,
    ),
    `Native rarity averages · shiny copies unvalued${value.oldest ? ` · oldest price ${formatPriceAge(value.oldest)}` : ''}`,
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
    'Indicative sum of known native averages; not guaranteed proceeds. Missing prices are excluded, never treated as zero. Shiny price is not separately exposed by the native summary. Duplicates retain one copy per catalogue ID, rarity and shiny variant, independently of protection rules.'
}

export function mountCollectionBody(): void {
  registerCards([...getCollectionState().cards])
  renderCollectionPanel()
}
