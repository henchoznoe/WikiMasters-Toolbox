import {
  AUTO_KEY,
  getPrefs,
  scheduleAuto,
  syncPrefsFromStorage,
} from './content/packs'
import { refreshPacksControls } from './content/packs-panel'
import { syncToolboxPanel } from './content/panel'
import {
  hydrateRoute,
  registerCards,
  renderCards,
  renderMarketplace,
  setPriceRenderCallback,
} from './content/prices'
import { toolboxPages } from './content/routes'
import { isCard } from './content/shared'
import {
  recordPack,
  renderStats,
  STATS_KEY,
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
  }, 80)
}
setPriceRenderCallback(scheduleRender)

if (!contentWindow.__wmToolboxContentInstalled) {
  contentWindow.__wmToolboxContentInstalled = true
  window.addEventListener('wm-toolbox:data', (event: Event) => {
    try {
      const data = JSON.parse((event as CustomEvent<string>).detail) as {
        kind?: string
        cards?: unknown[]
      }
      if (Array.isArray(data.cards)) {
        const cards = data.cards.filter(isCard)
        registerCards(cards)
        if (data.kind === 'pack') void recordPack(cards)
      }
    } catch {
      /* Invalid event. */
    }
  })
  window.addEventListener('storage', event => {
    if (event.key === STATS_KEY) {
      renderStats()
      scheduleDailyReset()
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
  start()
}
