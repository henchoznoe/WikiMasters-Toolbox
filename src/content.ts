import { getAccountId, onAccountChange, setAccountId } from './content/account'
import { cleanCaches, onCacheChange } from './content/cache'
import {
  onCompatibilityChange,
  resetCompatibility,
  setCompatibilityIssue,
} from './content/compatibility'
import { renderDataControls } from './content/data-panel'
import { resetToolboxPanel, syncToolboxPanel } from './content/panel'
import { setPriceAlertCallback } from './content/price-alerts'
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
  hydrateRoute,
  registerCards,
  renderCards,
  renderMarketplace,
  resetRegisteredCards,
  setPriceRenderCallback,
} from './content/prices'
import { cancelRequests, setRequestCallback } from './content/requests'
import { toolboxPages } from './content/routes'
import { type SaleSample, validSample } from './content/sales-model'
import { observeSaleSamples } from './content/sales-store'
import { isCard } from './content/shared'

const contentWindow = window as Window & {
  __wmToolboxContentInstalled?: boolean
}
let renderTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRender(): void {
  if (renderTimer) return
  renderTimer = setTimeout(() => {
    renderTimer = null
    renderCards()
    renderMarketplace()
    syncToolboxPanel(location.pathname, toolboxPages)
    renderPricePanel()
    renderPriceInspector()
    renderDataControls()
  }, 80)
}
setPriceAlertCallback(scheduleRender)
setPriceRenderCallback(scheduleRender)
setRequestCallback(scheduleRender)
onCompatibilityChange(scheduleRender)
onCacheChange(scheduleRender)
onAccountChange(() => {
  cancelRouteRead()
  cancelPriceBatch()
  resetToolboxPanel()
  closePriceInspector()
  resetRegisteredCards()
  scheduleRender()
  void hydrateRoute()
})

if (!contentWindow.__wmToolboxContentInstalled) {
  contentWindow.__wmToolboxContentInstalled = true
  window.addEventListener('wm-toolbox:data', (event: Event) => {
    try {
      const data = JSON.parse((event as CustomEvent<string>).detail)
      if (data.kind === 'account') {
        setAccountId(data.accountId)
        return
      }
      if (data.accountId !== getAccountId()) return
      if (data.kind === 'price-listings') observePriceListings(data.listings)
      else if (data.kind === 'sale-samples' && Array.isArray(data.samples))
        observeSaleSamples(
          data.samples
            .slice(0, 1000)
            .filter((row: unknown): row is SaleSample => validSample(row)),
        )
      else if (data.kind === 'compatibility' && typeof data.source === 'string')
        setCompatibilityIssue(
          data.source,
          data.compatible === true
            ? null
            : 'Format des données du jeu modifié ; rechargez la page',
        )
      else if (Array.isArray(data.cards))
        registerCards(data.cards.filter(isCard), data.kind)
      scheduleRender()
    } catch {
      /* Invalid event. */
    }
  })
  window.addEventListener('storage', event => {
    syncPricesFromStorage(event.key)
    scheduleRender()
  })
  let previousPath = location.pathname + location.search
  const observer = new MutationObserver(() => {
    if (location.pathname + location.search !== previousPath) {
      cancelRouteRead()
      cancelPriceBatch()
      cancelRequests()
      resetRegisteredCards()
      clearPriceListings()
      resetCompatibility()
      resetToolboxPanel()
      closePriceInspector()
      previousPath = location.pathname + location.search
      void hydrateRoute()
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
    void hydrateRoute()
  }
  // Update age labels locally. No timer performs gameplay actions.
  window.setInterval(() => {
    if (document.visibilityState === 'visible') scheduleRender()
  }, 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRender()
  })
  start()
}
