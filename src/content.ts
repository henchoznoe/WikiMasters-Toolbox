import { getAccountId, onAccountChange, setAccountId } from './content/account'
import {
  getCollectionState,
  invalidateCollection,
  observeCollection,
  onCollectionChange,
  refreshCollectionIfNeeded,
  syncCollectionFromStorage,
} from './content/collection'
import {
  onSelectionChange,
  setDiscardRefreshCallback,
} from './content/collection-actions'
import { renderCollectionPanel } from './content/collection-panel'
import { renderMarketPanel, resetMarketPanel } from './content/market-panel'
import {
  cancelMarketReads,
  chooseComparables,
  observeMarketSales,
  setMarketCallback,
} from './content/market-store'
import {
  AUTO_KEY,
  getPrefs,
  MANUAL_LIMIT_KEY,
  observeNativePack,
  requirePackVerification,
  scheduleAuto,
  syncManualLimitFromStorage,
  syncPrefsFromStorage,
} from './content/packs'
import { refreshPacksControls } from './content/packs-panel'
import { syncToolboxPanel } from './content/panel'
import {
  closePriceInspector,
  renderPriceInspector,
} from './content/price-inspector'
import { renderPricePanel } from './content/price-panel'
import { cancelPriceBatch, syncPricesFromStorage } from './content/price-store'
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
import {
  leaveMarket,
  observeSaleCard,
  observeSaleResult,
  requireSaleCheck,
  setSaleCallback,
} from './content/sale'
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
    renderPricePanel()
    renderPriceInspector()
    renderMarketPanel()
  }, 80)
}
setPriceRenderCallback(scheduleRender)
setMarketCallback(scheduleRender)
setSaleCallback(scheduleRender)
onSelectionChange(scheduleRender)
setDiscardRefreshCallback(() => {
  if (/^\/collection(\/|$)/.test(location.pathname)) location.reload()
})
onCollectionChange(() => {
  registerCards([...getCollectionState().cards])
  scheduleRender()
})
onAccountChange(() => {
  cancelPriceBatch()
  resetMarketPanel()
  closePriceInspector()
  resetRegisteredCards()
  void hydrateRoute()
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
        card?: unknown
        selling?: unknown
        history?: unknown
        status?: unknown
        auctionId?: unknown
      }
      if (data.kind === 'account') {
        setAccountId(data.accountId)
        return
      }
      if (data.accountId !== getAccountId()) return
      if (data.kind === 'sale-context') {
        observeSaleCard(data.card)
        return
      }
      if (data.kind === 'sale-check-required') {
        requireSaleCheck()
        return
      }
      if (data.kind === 'sale-adapter-error') {
        requireSaleCheck()
        return
      }
      if (data.kind === 'sale-result') {
        observeSaleResult(data.status, data.auctionId)
        return
      }
      if (data.kind === 'market-sales') {
        observeMarketSales(data.selling, data.history)
        return
      }
      if (data.kind === 'pack-verification-required') {
        requirePackVerification()
        return
      }
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
        if (data.kind === 'marketplace' && cards.length === 1)
          chooseComparables(cards[0])
        if (data.kind === 'collection') observeCollection(cards)
        registerCards(cards, data.kind)
        if (data.kind === 'pack' && cards.length) {
          observeNativePack()
          void recordPack(cards)
        }
      }
    } catch {
      /* Invalid event. */
    }
  })
  window.addEventListener('storage', event => {
    syncCollectionFromStorage(event.key)
    syncPricesFromStorage(event.key)
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
      cancelPriceBatch()
      cancelMarketReads()
      leaveMarket()
      resetMarketPanel()
      closePriceInspector()
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
