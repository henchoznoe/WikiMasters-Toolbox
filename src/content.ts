import { getAccountId, onAccountChange, setAccountId } from './content/account'
import { cleanCaches, onCacheChange } from './content/cache'
import {
  getCollectionState,
  invalidateCollection,
  observeCollection,
  onCollectionChange,
  refreshCollectionIfNeeded,
  stopCollectionLoad,
  syncCollectionFromStorage,
} from './content/collection'
import {
  onSelectionChange,
  setDiscardRefreshCallback,
} from './content/collection-actions'
import { renderCompactLayout } from './content/collection-layout'
import { renderCollectionPanel } from './content/collection-panel'
import { onViewsChange, syncViewsFromStorage } from './content/collection-views'
import {
  onCompatibilityChange,
  resetCompatibility,
  setCompatibilityIssue,
} from './content/compatibility'
import { renderDataControls } from './content/data-panel'
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
import {
  resetToolboxPanel,
  resolvePanelPage,
  syncToolboxPanel,
} from './content/panel'
import { ALERT_PREFIX, setPriceAlertCallback } from './content/price-alerts'
import {
  closePriceInspector,
  renderPriceInspector,
} from './content/price-inspector'
import {
  clearPriceListings,
  observePriceListings,
} from './content/price-listings'
import { renderPricePanel } from './content/price-panel'
import { cancelPriceBatch, syncPricesFromStorage } from './content/price-store'
import {
  cancelRouteRead,
  registerCards,
  renderCards,
  renderMarketplace,
  resetRegisteredCards,
  setPriceRenderCallback,
} from './content/prices'
import { cancelRequests, setRequestCallback } from './content/requests'
import { toolboxPages } from './content/routes'
import { renderRunSummary } from './content/run-summary'
import {
  leaveMarket,
  observeSaleCard,
  observeSaleResult,
  requireSaleCheck,
  setSaleCallback,
} from './content/sale'
import { type SaleSample, validSample } from './content/sales-model'
import { observeSaleSamples, SALES_PREFIX } from './content/sales-store'
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
    renderCompactLayout()
    renderMarketplace()
    syncToolboxPanel(location.pathname, toolboxPages)
    renderRunSummary()
    renderCollectionPanel()
    renderPricePanel()
    renderPriceInspector()
    renderMarketPanel()
    renderDataControls()
  }, 80)
}
function readRoute(): void {
  void resolvePanelPage(location.pathname, toolboxPages)?.read?.()
}
setPriceAlertCallback(scheduleRender)
setPriceRenderCallback(scheduleRender)
setRequestCallback(scheduleRender)
onCompatibilityChange(scheduleRender)
onCacheChange(scheduleRender)
setMarketCallback(scheduleRender)
setSaleCallback(scheduleRender)
onSelectionChange(scheduleRender)
onViewsChange(scheduleRender)
setDiscardRefreshCallback(() => {
  if (/^\/collection(\/|$)/.test(location.pathname)) location.reload()
})
onCollectionChange(() => {
  registerCards([...getCollectionState().cards])
  scheduleRender()
})
onAccountChange(() => {
  cancelRouteRead()
  resetToolboxPanel()
  cleanCaches()
  cancelPriceBatch()
  resetMarketPanel()
  closePriceInspector()
  resetRegisteredCards()
  readRoute()
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
        source?: string
        compatible?: boolean
        samples?: unknown[]
        listings?: unknown[]
      }
      if (data.kind === 'account') {
        setAccountId(data.accountId)
        return
      }
      if (data.accountId !== getAccountId()) return
      if (data.kind === 'price-listings') {
        observePriceListings(data.listings)
        scheduleRender()
        return
      }
      if (data.kind === 'sale-samples' && Array.isArray(data.samples)) {
        observeSaleSamples(
          data.samples
            .slice(0, 1000)
            .filter((row): row is SaleSample => validSample(row)),
        )
        scheduleRender()
        return
      }
      if (data.kind === 'compatibility' && typeof data.source === 'string') {
        setCompatibilityIssue(
          data.source,
          data.compatible === true
            ? null
            : 'Format des données du jeu modifié ; rechargez la page',
        )
        return
      }
      if (data.kind === 'sale-context') {
        observeSaleCard(data.card)
        return
      }
      if (data.kind === 'sale-check-required') {
        requireSaleCheck()
        return
      }
      if (data.kind === 'sale-adapter-error') {
        setCompatibilityIssue(
          'sale-ui',
          'Commandes de vente modifiées ; actions Toolbox suspendues',
        )
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
    syncViewsFromStorage(event.key)
    syncCollectionFromStorage(event.key)
    syncPricesFromStorage(event.key)
    if (
      !event.key ||
      event.key === SALES_PREFIX + getAccountId() ||
      event.key === ALERT_PREFIX + getAccountId()
    )
      scheduleRender()
    if (event.key === `${STATS_PREFIX}${getAccountId()}`) {
      renderStats()
      scheduleDailyReset()
      return
    }
    if (event.key === MANUAL_LIMIT_KEY + getAccountId()) {
      syncManualLimitFromStorage()
      refreshPacksControls()
      return
    }
    if (event.key !== AUTO_KEY + getAccountId()) return
    syncPrefsFromStorage()
    refreshPacksControls()
  })
  let previousPath = location.pathname + location.search
  const observer = new MutationObserver(() => {
    if (location.pathname + location.search !== previousPath) {
      clearPriceListings()
      cancelRouteRead()
      cancelRequests()
      stopCollectionLoad()
      resetRegisteredCards()
      resetCompatibility()
      cancelPriceBatch()
      cancelMarketReads()
      leaveMarket()
      resetMarketPanel()
      closePriceInspector()
      previousPath = location.pathname + location.search
      readRoute()
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
    cleanCaches()
    observer.observe(document.body, { childList: true, subtree: true })
    scheduleRender()
    readRoute()
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
