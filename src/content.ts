import { getAccountId, onAccountChange, setAccountId } from './content/account'
import {
  getCollectionState,
  invalidateCollection,
  observeCollection,
  onCollectionChange,
  refreshCollectionIfNeeded,
  syncCollectionFromStorage,
} from './content/collection'
import { renderCollectionPanel } from './content/collection-panel'
import {
  AUTO_KEY,
  getPrefs,
  MANUAL_LIMIT_KEY,
  scheduleAuto,
  syncManualLimitFromStorage,
  syncPrefsFromStorage,
} from './content/packs'
import { refreshPacksControls } from './content/packs-panel'
import { syncToolboxPanel } from './content/panel'
import {
  hydrateRoute,
  registerCards,
  renderCards,
  renderMarketplace,
  resetRegisteredCards,
  setPriceRenderCallback,
} from './content/prices'
import { toolboxPages } from './content/routes'
import { renderRunSummary } from './content/run-summary'
import { isCard } from './content/shared'
import {
  recordPack,
  renderStats,
  STATS_PREFIX,
  scheduleDailyReset,
} from './content/stats'

const contentWindow = window as Window & {
  __wmToolboxContentInstalled?: boolean
}

let renderTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRender(): void {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    renderCards()
    renderMarketplace()
    syncToolboxPanel(location.pathname, toolboxPages)
    renderRunSummary()
    renderCollectionPanel()
  }, 80)
}
setPriceRenderCallback(scheduleRender)
onCollectionChange(() => {
  registerCards([...getCollectionState().cards])
  scheduleRender()
})
onAccountChange(() => {
  resetRegisteredCards()
  registerCards([...getCollectionState().cards])
  renderStats()
  renderRunSummary()
  scheduleDailyReset()
  scheduleRender()
  if (/^\/collection(\/|$)/.test(location.pathname))
    refreshCollectionIfNeeded(true)
})

if (!contentWindow.__wmToolboxContentInstalled) {
  contentWindow.__wmToolboxContentInstalled = true
  window.addEventListener('wm-toolbox:data', (event: Event) => {
    try {
      const data = JSON.parse((event as CustomEvent<string>).detail) as {
        kind?: string
        cards?: unknown[]
        accountId?: unknown
        total?: unknown
      }
      if (data.kind === 'account') {
        setAccountId(data.accountId)
        return
      }
      if (data.accountId !== getAccountId()) return
      if (data.kind === 'collection-changed') {
        invalidateCollection()
        return
      }
      if (data.kind === 'collection-total') {
        observeCollection([], data.total)
        return
      }
      if (Array.isArray(data.cards)) {
        const cards = data.cards.filter(isCard)
        if (data.kind === 'collection') observeCollection(cards)
        registerCards(cards, data.kind)
        if (data.kind === 'pack') void recordPack(cards)
      }
    } catch {
      /* Invalid event. */
    }
  })
  window.addEventListener('storage', event => {
    syncCollectionFromStorage(event.key)
    if (event.key === `${STATS_PREFIX}${getAccountId()}`) {
      renderStats()
      scheduleDailyReset()
      return
    }
    if (event.key === MANUAL_LIMIT_KEY) {
      syncManualLimitFromStorage()
      refreshPacksControls()
      return
    }
    if (event.key !== AUTO_KEY) return
    syncPrefsFromStorage()
    refreshPacksControls()
  })
  let previousPath = location.pathname
  const observer = new MutationObserver(() => {
    if (location.pathname !== previousPath) {
      previousPath = location.pathname
      void hydrateRoute()
      if (/^\/collection(\/|$)/.test(previousPath))
        refreshCollectionIfNeeded(true)
    }
    scheduleRender()
  })
  const start = (): void => {
    if (!document.body) {
      requestAnimationFrame(start)
      return
    }
    observer.observe(document.body, { childList: true, subtree: true })
    scheduleRender()
    void hydrateRoute()
    scheduleDailyReset()
    if (getPrefs().enabled) scheduleAuto()
  }
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      scheduleRender()
      if (/^\/collection(\/|$)/.test(location.pathname))
        refreshCollectionIfNeeded()
    }
  }, 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleRender()
      if (/^\/collection(\/|$)/.test(location.pathname))
        refreshCollectionIfNeeded()
    }
  })
  start()
}
