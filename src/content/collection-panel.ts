import { getAccountId } from './account'
import {
  getCollectionState,
  loadCollection,
  stopCollectionLoad,
} from './collection'
import { registerCards } from './prices'

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
  body.append(summary, progress, actions, note)
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
  load.disabled = !account
  fresh.hidden = !resumable
  fresh.disabled = loading || !account
  note.textContent =
    state.error ??
    (state.retrying ? '…' : !state.persistent ? 'Not saved locally.' : '')
  note.title = state.retrying
    ? 'The game is busy; retrying the current page.'
    : (state.error ?? '')
  note.hidden = !note.textContent
}

export function mountCollectionBody(): void {
  registerCards([...getCollectionState().cards])
  renderCollectionPanel()
}
