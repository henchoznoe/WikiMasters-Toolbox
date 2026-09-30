const contentWindow = window as Window & {
  __wmToolboxContentInstalled?: boolean
}
declare const WM_TOOLBOX_CSS: string

const toolboxSheet = new CSSStyleSheet()
toolboxSheet.replaceSync(WM_TOOLBOX_CSS)

function createToolboxRoot(host: HTMLElement): ShadowRoot {
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [toolboxSheet]
  return root
}

type Card = { id: string; title: string; rarity: string | null }
type PriceEntry = {
  fetchedAt: number
  ok: boolean
  averages: Record<string, number>
}
type AutoPrefs = {
  enabled: boolean
  minMinutes: number
  maxMinutes: number
  nextAt: number
}
type PackResponse = {
  cards?: unknown[]
  packs_remaining?: number
  rate_limited?: boolean
  rate_limit_daily?: boolean
  retry_after?: string
  error?: string
  message?: string
}
type PackStats = {
  day: string
  dailyReset: boolean
  packs: number
  counts: Record<string, number>
}

const PRICE_TTL = 24 * 60 * 60 * 1000
const ERROR_TTL = 60 * 1000
const PRICE_PREFIX = 'wm_toolbox_price_v1_'
const AUTO_KEY = 'wm_toolbox_auto_v1'
const STATS_KEY = 'wm_toolbox_pack_stats_v1'
const PANEL_KEY = 'wm_toolbox_panel_collapsed_v1'
const MAX_PACKS_PER_CYCLE = 100
const RARITIES = ['L', 'UR', 'SR', 'R', 'PC', 'C', 'Other'] as const
const cardsById = new Map<string, Card>()
const idsByTitle = new Map<string, string>()
const prices = new Map<string, PriceEntry>()
const priceQueue: string[] = []
const queuedPrices = new Set<string>()
const activePrices = new Set<string>()
let priceRequests = 0

function normalizeTitle(value: string | null): string {
  return (value || '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

function isCard(value: unknown): value is Card {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Card).id === 'string' &&
      typeof (value as Card).title === 'string',
  )
}

function registerCards(cards: Card[]): void {
  for (const card of cards) {
    cardsById.set(card.id, card)
    idsByTitle.set(normalizeTitle(card.title), card.id)
  }
  scheduleRender()
}

function readCachedPrice(id: string): PriceEntry | null {
  const memory = prices.get(id)
  if (
    memory &&
    Date.now() - memory.fetchedAt < (memory.ok ? PRICE_TTL : ERROR_TTL)
  )
    return memory
  try {
    const raw = localStorage.getItem(PRICE_PREFIX + id)
    const entry = raw ? (JSON.parse(raw) as PriceEntry) : null
    if (
      entry &&
      typeof entry.fetchedAt === 'number' &&
      typeof entry.ok === 'boolean' &&
      entry.averages &&
      typeof entry.averages === 'object' &&
      Date.now() - entry.fetchedAt < (entry.ok ? PRICE_TTL : ERROR_TTL)
    ) {
      prices.set(id, entry)
      return entry
    }
  } catch {
    /* Storage unavailable. */
  }
  return null
}

function chosenAverage(
  entry: PriceEntry,
  rarity: string | null,
): number | null {
  if (rarity && Number.isFinite(entry.averages[rarity]))
    return entry.averages[rarity]
  const values = Object.values(entry.averages).filter(Number.isFinite)
  return values.length === 1 ? values[0] : null
}

function rarityFromElement(card: Element): string | null {
  for (const element of card.querySelectorAll('span, div')) {
    const text = element.textContent?.trim()
    if (text && /^(L|UR|SR|R|PC|C)$/.test(text)) return text
  }
  return null
}

function getCardElement(heading: Element): HTMLElement | null {
  return heading.closest<HTMLElement>(
    'div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]',
  )
}

function renderBadge(card: HTMLElement, id: string): void {
  const heading = card.querySelector('h3')
  if (!heading?.parentElement) return
  let host = card.querySelector<HTMLElement>('[data-wm-toolbox-price]')
  if (!host) {
    host = document.createElement('span')
    host.dataset.wmToolboxPrice = id
    const badge = document.createElement('span')
    badge.className = 'wm-price-badge'
    createToolboxRoot(host).append(badge)
    heading.insertAdjacentElement('afterend', host)
  }
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  const cached = readCachedPrice(id)
  if (!cached) {
    if (badge.textContent !== 'Average price…')
      badge.textContent = 'Average price…'
    badge.title = 'Loading average price'
    visiblePriceObserver.observe(card)
    return
  }
  const average = chosenAverage(
    cached,
    cardsById.get(id)?.rarity || rarityFromElement(card),
  )
  const formatted =
    average === null
      ? '—'
      : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
          average,
        )
  const text = cached.ok
    ? `Avg. ${formatted}${average === null ? '' : ' W'}`
    : 'Price unavailable'
  if (badge.textContent !== text) badge.textContent = text
  badge.title = cached.ok
    ? 'Average sale price, cached for 24 hours'
    : 'Temporary error; retry in one minute'
}

const visiblePriceObserver = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      visiblePriceObserver.unobserve(entry.target)
      const id = (entry.target as HTMLElement).dataset.wmToolboxCardId
      if (id) enqueuePrice(id)
    }
  },
  { rootMargin: '320px 0px' },
)

function enqueuePrice(id: string): void {
  if (readCachedPrice(id) || queuedPrices.has(id) || activePrices.has(id))
    return
  queuedPrices.add(id)
  priceQueue.push(id)
  pumpPrices()
}

function pumpPrices(): void {
  while (priceRequests < 3 && priceQueue.length) {
    const id = priceQueue.shift()
    if (!id) break
    queuedPrices.delete(id)
    if (readCachedPrice(id) || activePrices.has(id)) continue
    activePrices.add(id)
    priceRequests += 1
    void loadPrice(id).finally(() => {
      activePrices.delete(id)
      priceRequests -= 1
      scheduleRender()
      pumpPrices()
    })
  }
}

async function loadPrice(id: string): Promise<void> {
  let entry: PriceEntry
  try {
    const response = await fetch(
      `/api/marketplace/cards/${encodeURIComponent(id)}/sales?scope=summary`,
      {
        credentials: 'include',
        signal: AbortSignal.timeout(12_000),
      },
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = (await response.json()) as {
      summary?: Record<string, { average?: unknown }>
    }
    const averages: Record<string, number> = {}
    for (const [rarity, value] of Object.entries(json.summary || {})) {
      if (value?.average == null || value.average === '') continue
      const average = Number(value?.average)
      if (Number.isFinite(average)) averages[rarity] = average
    }
    entry = { fetchedAt: Date.now(), ok: true, averages }
  } catch (error) {
    console.debug('[WikiMasters Toolbox] price unavailable', id, error)
    entry = { fetchedAt: Date.now(), ok: false, averages: {} }
  }
  prices.set(id, entry)
  try {
    localStorage.setItem(PRICE_PREFIX + id, JSON.stringify(entry))
  } catch {
    /* Storage unavailable. */
  }
}

function renderCards(): void {
  if (!/^\/(collection|pulls)(\/|$)/.test(location.pathname)) return
  for (const heading of document.querySelectorAll('h3')) {
    const id = idsByTitle.get(normalizeTitle(heading.textContent))
    if (!id) continue
    const card = getCardElement(heading)
    if (!card) continue
    card.dataset.wmToolboxCardId = id
    renderBadge(card, id)
  }
}

function renderMarketplace(): void {
  if (!/^\/marketplace\/[0-9a-f-]{36}\/?$/i.test(location.pathname)) return
  const heading = [...document.querySelectorAll('h1')].find(element =>
    idsByTitle.has(normalizeTitle(element.textContent)),
  )
  if (!heading) return
  const id = idsByTitle.get(normalizeTitle(heading.textContent))
  if (!id) return
  let host = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-marketplace]',
  )
  if (!host) {
    host = document.createElement('div')
    host.dataset.wmToolboxMarketplace = '1'
    const badge = document.createElement('div')
    badge.className = 'wm-price-badge wm-price-badge-large'
    createToolboxRoot(host).append(badge)
    heading.insertAdjacentElement('afterend', host)
  }
  const badge = host.shadowRoot?.firstElementChild as HTMLElement | null
  if (!badge) return
  const cached = readCachedPrice(id)
  if (!cached) {
    if (badge.textContent !== 'Average price…')
      badge.textContent = 'Average price…'
    enqueuePrice(id)
    return
  }
  const average = chosenAverage(cached, cardsById.get(id)?.rarity || null)
  const text = cached.ok
    ? `Average price: ${average === null ? '—' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(average)} W`}`
    : 'Average price unavailable'
  if (badge.textContent !== text) badge.textContent = text
}

function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function emptyStats(dailyReset = false): PackStats {
  return {
    day: localDay(),
    dailyReset,
    packs: 0,
    counts: Object.fromEntries(RARITIES.map(rarity => [rarity, 0])),
  }
}

function writeStats(stats: PackStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats))
  } catch {
    /* Storage unavailable. */
  }
}

function readStats(): PackStats {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (!raw) return emptyStats()
    const parsed = JSON.parse(raw) as Partial<PackStats>
    const stats: PackStats = {
      day: typeof parsed.day === 'string' ? parsed.day : localDay(),
      dailyReset: parsed.dailyReset === true,
      packs: Math.max(0, Math.floor(Number(parsed.packs) || 0)),
      counts: Object.fromEntries(
        RARITIES.map(rarity => [
          rarity,
          Math.max(0, Math.floor(Number(parsed.counts?.[rarity]) || 0)),
        ]),
      ),
    }
    if (stats.dailyReset && stats.day !== localDay()) {
      const reset = emptyStats(true)
      writeStats(reset)
      return reset
    }
    return stats
  } catch {
    return emptyStats()
  }
}

async function updateStats(
  change: (stats: PackStats) => PackStats,
): Promise<void> {
  const update = (): void => {
    writeStats(change(readStats()))
    renderStats()
    scheduleDailyReset()
  }
  if (navigator.locks)
    await navigator.locks.request('wm-toolbox-pack-stats', update)
  else update()
}

async function recordPack(cards: unknown[]): Promise<void> {
  if (!cards.length) return
  await updateStats(stats => {
    stats.packs += 1
    for (const value of cards) {
      const rarity =
        value && typeof value === 'object' && 'rarity' in value
          ? (value as { rarity?: unknown }).rarity
          : null
      const key =
        typeof rarity === 'string' &&
        RARITIES.includes(rarity as (typeof RARITIES)[number])
          ? rarity
          : 'Other'
      stats.counts[key] += 1
    }
    return stats
  })
}

let dailyResetTimer: ReturnType<typeof setTimeout> | null = null

function scheduleDailyReset(): void {
  if (dailyResetTimer) clearTimeout(dailyResetTimer)
  dailyResetTimer = null
  if (!readStats().dailyReset) return
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  dailyResetTimer = setTimeout(
    () => {
      readStats()
      renderStats()
      scheduleDailyReset()
    },
    Math.max(1_000, next.getTime() - now.getTime() + 100),
  )
}

const DEFAULT_PREFS: AutoPrefs = {
  enabled: false,
  minMinutes: 20,
  maxMinutes: 100,
  nextAt: 0,
}
let prefs = readPrefs()
let autoTimer: ReturnType<typeof setTimeout> | null = null
let runController: AbortController | null = null
let runMode: 'manual' | 'auto' | null = null
let statusText = 'Disabled'
let openedThisCycle = 0
let confirmationTimer: ReturnType<typeof setTimeout> | null = null

function readPanelCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(PANEL_KEY)
    if (saved !== null) return saved === 'true'
  } catch {
    /* Storage unavailable. */
  }
  return window.matchMedia('(max-width: 600px)').matches
}

function writePanelCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PANEL_KEY, String(collapsed))
  } catch {
    /* Storage unavailable. */
  }
}

function readPrefs(): AutoPrefs {
  try {
    const raw = localStorage.getItem(AUTO_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<AutoPrefs>) : {}
    const min = Number(parsed.minMinutes)
    const max = Number(parsed.maxMinutes)
    const minMinutes = Number.isFinite(min)
      ? Math.max(1, Math.min(10080, Math.round(min)))
      : 20
    const maxMinutes = Number.isFinite(max)
      ? Math.max(minMinutes, Math.min(10080, Math.round(max)))
      : 100
    return {
      enabled: parsed.enabled === true,
      minMinutes,
      maxMinutes,
      nextAt: Number(parsed.nextAt) || 0,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function writePrefs(): void {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(prefs))
  } catch {
    /* Storage unavailable. */
  }
}

function randomDelay(): number {
  return Math.round(
    (prefs.minMinutes + Math.random() * (prefs.maxMinutes - prefs.minMinutes)) *
      60_000,
  )
}

function formatLocalTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')}`
}

function setStatus(value: string): void {
  statusText = value
  const status = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLElement>('[data-wm-toolbox-status]')
  if (status) status.textContent = statusText
}

function scheduleAuto(reset = false): void {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = null
  if (!prefs.enabled || runController) return
  if (reset || prefs.nextAt <= Date.now()) {
    prefs.nextAt = Date.now() + randomDelay()
    writePrefs()
  }
  const remaining = Math.max(1_000, prefs.nextAt - Date.now())
  setStatus(`Next opening around ${formatLocalTime(prefs.nextAt)}`)
  autoTimer = setTimeout(() => {
    autoTimer = null
    void runAuto()
  }, remaining)
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function openOnePack(signal: AbortSignal): Promise<PackResponse> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const requestController = new AbortController()
    const timeout = setTimeout(
      () => requestController.abort(new Error('Request timed out')),
      15_000,
    )
    const abort = (): void => requestController.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    let response: Response
    let json: PackResponse
    try {
      response = await fetch('/api/packs/open', {
        method: 'POST',
        credentials: 'include',
        headers: { accept: '*/*' },
        signal: requestController.signal,
      })
      json = (await response.json()) as PackResponse
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    if (json.rate_limited && !json.rate_limit_daily) {
      const retryAt = Date.parse(json.retry_after || '')
      const waitMs = retryAt - Date.now() + 200
      if (
        !Number.isFinite(waitMs) ||
        waitMs < 0 ||
        waitMs > 120_000 ||
        attempt === 2
      ) {
        throw new Error('Temporary rate limit; try again later')
      }
      setStatus('The game is busy. Retrying shortly…')
      await wait(waitMs, signal)
      continue
    }
    if (!response.ok)
      throw new Error(json.error || json.message || `HTTP ${response.status}`)
    return json
  }
  throw new Error('Opening stopped by the game rate limit')
}

async function openAvailablePacks(signal: AbortSignal): Promise<boolean> {
  openedThisCycle = 0
  let remaining = Number.NaN
  updateProgress(0, null)
  for (let index = 0; index < MAX_PACKS_PER_CYCLE; index += 1) {
    if (signal.aborted) throw signal.reason
    setStatus(`Opening pack ${index + 1}…`)
    const response = await openOnePack(signal)
    if (!Array.isArray(response.cards) || response.cards.length === 0) {
      if (response.packs_remaining === 0) break
      throw new Error('The game returned a pack without cards')
    }
    openedThisCycle += 1
    remaining = Number(response.packs_remaining)
    await recordPack(response.cards)
    updateProgress(
      openedThisCycle,
      Number.isFinite(remaining)
        ? openedThisCycle + Math.max(0, remaining)
        : null,
    )
    updateOpenAllButton()
    if (Number.isFinite(remaining) && remaining <= 0) break
    await wait(500 + Math.round(Math.random() * 1_500), signal)
  }
  return openedThisCycle === MAX_PACKS_PER_CYCLE && remaining > 0
}

async function runPacks(mode: 'manual' | 'auto'): Promise<void> {
  if (runController || (mode === 'auto' && !prefs.enabled)) return
  clearOpenAllConfirmation()
  if (!navigator.locks) {
    setStatus('Cross-tab lock unavailable')
    if (mode === 'auto') scheduleAuto(true)
    return
  }
  await navigator.locks.request(
    'wm-toolbox-auto-open',
    { ifAvailable: true },
    async lock => {
      if (!lock) {
        setStatus('Another tab is opening packs')
        if (mode === 'auto') scheduleAuto(true)
        return
      }
      prefs = readPrefs()
      if (mode === 'auto' && !prefs.enabled) return
      runController = new AbortController()
      runMode = mode
      if (mode === 'auto') {
        prefs.nextAt = 0
        writePrefs()
      }
      updateOpenAllButton()
      try {
        const capped = await openAvailablePacks(runController.signal)
        setStatus(
          capped
            ? `Stopped after ${MAX_PACKS_PER_CYCLE} packs. Run again to continue.`
            : `${openedThisCycle} pack${openedThisCycle === 1 ? '' : 's'} opened`,
        )
      } catch (error) {
        setStatus(
          runController.signal.aborted
            ? 'Opening stopped'
            : `Failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        const shouldRefresh =
          openedThisCycle > 0 && /^\/pulls(\/|$)/.test(location.pathname)
        runController = null
        runMode = null
        updateOpenAllButton()
        prefs = readPrefs()
        if (prefs.enabled) scheduleAuto(true)
        if (shouldRefresh) setTimeout(() => location.reload(), 800)
      }
    },
  )
}

async function runAuto(): Promise<void> {
  await runPacks('auto')
}

function makeInput(
  labelText: string,
  value: number,
  onChange: (value: number) => void,
): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'wm-field'
  const caption = document.createElement('span')
  caption.textContent = labelText
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '1'
  input.max = '10080'
  input.value = String(value)
  input.addEventListener('change', () => onChange(Number(input.value)))
  label.append(caption, input)
  return label
}

function updateOpenAllButton(): void {
  const button = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLButtonElement>('[data-wm-toolbox-open-all]')
  if (!button) return
  button.disabled = runMode === 'auto'
  button.classList.toggle('wm-open-all-confirm', confirmationTimer !== null)
  button.textContent =
    runMode === 'manual'
      ? `Stop opening (${openedThisCycle})`
      : runMode === 'auto'
        ? 'Opening automatically…'
        : confirmationTimer
          ? 'Confirm opening all packs'
          : 'Open all available packs'
}

function clearOpenAllConfirmation(): void {
  if (confirmationTimer) clearTimeout(confirmationTimer)
  confirmationTimer = null
  updateOpenAllButton()
}

function updateProgress(opened: number, total: number | null): void {
  const progress = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLElement>('[data-wm-toolbox-progress]')
  if (!progress) return
  progress.hidden = false
  const meter = progress.querySelector('progress')
  const label = progress.querySelector('[data-wm-toolbox-progress-label]')
  if (!meter || !label) return
  if (total === null) {
    meter.removeAttribute('value')
    label.textContent = 'Checking available packs…'
  } else {
    meter.max = Math.max(1, total)
    meter.value = opened
    label.textContent = `${opened} of ${total} packs opened`
  }
}

function renderStats(): void {
  const container = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLElement>('[data-wm-toolbox-stats]')
  if (!container) return
  const stats = readStats()
  const total = Object.values(stats.counts).reduce(
    (sum, count) => sum + count,
    0,
  )
  const title = document.createElement('h3')
  title.className = 'wm-stats-title'
  title.textContent = 'Pack statistics'
  const summary = document.createElement('p')
  summary.className = 'wm-stats-summary'
  summary.textContent = `${stats.packs} pack${stats.packs === 1 ? '' : 's'} · ${total} card${total === 1 ? '' : 's'}`
  const head = document.createElement('div')
  head.className = 'wm-stats-head'
  head.append(title, summary)
  const grid = document.createElement('div')
  grid.className = 'wm-stats-grid'
  for (const rarity of RARITIES) {
    if (rarity === 'Other' && stats.counts.Other === 0) continue
    const tile = document.createElement('div')
    tile.className = 'wm-stat'
    const label = document.createElement('span')
    label.className = 'wm-stat-label'
    label.textContent = rarity
    const count = document.createElement('span')
    count.className = 'wm-stat-count'
    count.textContent = String(stats.counts[rarity])
    tile.append(label, count)
    grid.append(tile)
  }
  const controls = document.createElement('div')
  controls.className = 'wm-stats-controls'
  const dailyLabel = document.createElement('label')
  dailyLabel.className = 'wm-setting-toggle'
  dailyLabel.title =
    'Reset at local midnight, or on the next visit if Chrome is closed'
  const dailyToggle = document.createElement('input')
  dailyToggle.type = 'checkbox'
  dailyToggle.checked = stats.dailyReset
  dailyToggle.addEventListener('change', () => {
    void updateStats(current => ({
      ...current,
      day: localDay(),
      dailyReset: dailyToggle.checked,
    }))
  })
  const dailyTrack = document.createElement('span')
  dailyTrack.className = 'wm-switch'
  dailyTrack.setAttribute('aria-hidden', 'true')
  dailyLabel.append(
    dailyToggle,
    dailyTrack,
    document.createTextNode('Daily reset'),
  )
  const resetButton = document.createElement('button')
  resetButton.type = 'button'
  resetButton.className = 'wm-quiet-button'
  resetButton.textContent = 'Reset counts'
  resetButton.addEventListener('click', () => {
    if (!window.confirm('Reset all pack statistics?')) return
    void updateStats(current => emptyStats(current.dailyReset))
  })
  controls.append(dailyLabel, resetButton)
  container.replaceChildren(head, grid, controls)
}

function ensureAutoPanel(): void {
  const existing = document.querySelector('[data-wm-toolbox-panel]')
  if (!/^\/pulls(\/|$)/.test(location.pathname)) {
    clearOpenAllConfirmation()
    if (runMode === 'manual')
      runController?.abort(new Error('Left the Packs page'))
    existing?.remove()
    return
  }
  if (existing || !document.body) return
  const host = document.createElement('div')
  host.dataset.wmToolboxPanel = '1'
  host.style.position = 'fixed'
  host.style.bottom = '16px'
  host.style.right = '16px'
  host.style.zIndex = '2147483647'
  const panel = document.createElement('section')
  panel.setAttribute('aria-label', 'WikiMasters Toolbox pack controls')
  panel.className = 'wm-panel'
  const initiallyExpanded = !readPanelCollapsed()
  panel.classList.toggle('wm-panel-open', initiallyExpanded)

  const header = document.createElement('div')
  header.className = 'wm-panel-header'
  const title = document.createElement('h2')
  title.className = 'wm-panel-title'
  title.textContent = 'WikiMasters Toolbox'
  const mark = document.createElement('span')
  mark.className = 'wm-panel-mark'
  mark.textContent = 'Packs'
  const disclosure = document.createElement('button')
  disclosure.type = 'button'
  disclosure.className = 'wm-panel-disclosure'
  disclosure.setAttribute(
    'aria-label',
    `${initiallyExpanded ? 'Hide' : 'Show'} Toolbox controls`,
  )
  disclosure.setAttribute('aria-expanded', String(initiallyExpanded))
  disclosure.textContent = initiallyExpanded ? 'Hide' : 'Show'
  disclosure.addEventListener('click', () => {
    const expanded = panel.classList.toggle('wm-panel-open')
    writePanelCollapsed(!expanded)
    if (!expanded) clearOpenAllConfirmation()
    disclosure.setAttribute(
      'aria-label',
      `${expanded ? 'Hide' : 'Show'} Toolbox controls`,
    )
    disclosure.setAttribute('aria-expanded', String(expanded))
    disclosure.textContent = expanded ? 'Hide' : 'Show'
  })
  header.append(title, mark, disclosure)
  const openAllButton = document.createElement('button')
  openAllButton.type = 'button'
  openAllButton.dataset.wmToolboxOpenAll = '1'
  openAllButton.className = 'wm-primary-button wm-open-all'
  openAllButton.textContent = 'Open all available packs'
  openAllButton.addEventListener('click', () => {
    if (runMode === 'manual') {
      runController?.abort(new Error('Stopped by user'))
      return
    }
    if (confirmationTimer) {
      clearOpenAllConfirmation()
      void runPacks('manual')
      return
    }
    confirmationTimer = setTimeout(clearOpenAllConfirmation, 8_000)
    updateOpenAllButton()
  })
  const progress = document.createElement('div')
  progress.dataset.wmToolboxProgress = '1'
  progress.className = 'wm-progress'
  progress.hidden = true
  const progressLabel = document.createElement('span')
  progressLabel.dataset.wmToolboxProgressLabel = '1'
  progressLabel.textContent = 'Checking available packs…'
  const progressMeter = document.createElement('progress')
  progressMeter.max = 1
  progress.append(progressLabel, progressMeter)
  const toggleLabel = document.createElement('label')
  toggleLabel.className = 'wm-setting-toggle'
  toggleLabel.style.marginTop = '13px'
  const toggle = document.createElement('input')
  toggle.type = 'checkbox'
  toggle.checked = prefs.enabled
  toggle.addEventListener('change', () => {
    prefs.enabled = toggle.checked
    prefs.nextAt = 0
    writePrefs()
    if (!prefs.enabled) {
      if (autoTimer) clearTimeout(autoTimer)
      autoTimer = null
      if (runMode === 'auto') runController?.abort(new Error('Stopped by user'))
      setStatus('Disabled')
    } else scheduleAuto(true)
  })
  const toggleTrack = document.createElement('span')
  toggleTrack.className = 'wm-switch'
  toggleTrack.setAttribute('aria-hidden', 'true')
  toggleLabel.append(
    toggle,
    toggleTrack,
    document.createTextNode('Open packs automatically'),
  )

  const fields = document.createElement('div')
  fields.className = 'wm-fields'
  fields.append(
    makeInput('Min. (minutes)', prefs.minMinutes, value => {
      prefs.minMinutes = Math.max(1, Math.min(10080, Math.round(value) || 20))
      prefs.maxMinutes = Math.max(prefs.maxMinutes, prefs.minMinutes)
      writePrefs()
      if (prefs.enabled) scheduleAuto(true)
      ensureAutoPanelRefresh()
    }),
    makeInput('Max. (minutes)', prefs.maxMinutes, value => {
      prefs.maxMinutes = Math.max(
        prefs.minMinutes,
        Math.min(10080, Math.round(value) || 100),
      )
      writePrefs()
      if (prefs.enabled) scheduleAuto(true)
      ensureAutoPanelRefresh()
    }),
  )
  const status = document.createElement('p')
  status.dataset.wmToolboxStatus = '1'
  status.setAttribute('role', 'status')
  status.className = 'wm-status'
  status.textContent = statusText
  const note = document.createElement('p')
  note.className = 'wm-note'
  note.textContent = 'Keep this tab open for scheduled opening.'
  const stats = document.createElement('section')
  stats.dataset.wmToolboxStats = '1'
  stats.className = 'wm-stats'
  const body = document.createElement('div')
  body.className = 'wm-panel-body'
  body.append(openAllButton, progress, toggleLabel, fields, status, note, stats)
  panel.append(header, body)
  createToolboxRoot(host).append(panel)
  document.body.append(host)
  updateOpenAllButton()
  renderStats()
}

function ensureAutoPanelRefresh(): void {
  const inputs = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelectorAll<HTMLInputElement>('input[type="number"]')
  if (!inputs) return
  if (inputs[0]) inputs[0].value = String(prefs.minMinutes)
  if (inputs[1]) inputs[1].value = String(prefs.maxMinutes)
}

let renderTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRender(): void {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    renderCards()
    renderMarketplace()
    ensureAutoPanel()
  }, 80)
}

async function hydrateRoute(): Promise<void> {
  const path = location.pathname
  let url: string | null = null
  if (/^\/collection(\/|$)/.test(path))
    url = '/api/my-collection?sort=rarity&page=0&stats=0'
  const auction = path.match(/^\/marketplace\/([0-9a-f-]{36})\/?$/i)?.[1]
  if (auction) url = `/api/marketplace/${auction}`
  if (!url) return
  try {
    const response = await fetch(url, {
      credentials: 'include',
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return
    const json = (await response.json()) as Record<string, unknown>
    if (Array.isArray(json.collection)) {
      registerCards(
        json.collection
          .map(row => {
            if (!row || typeof row !== 'object') return null
            const entry = row as {
              card_id?: string
              card?: { id?: string; wikipedia_title?: string; rarity?: string }
            }
            const id = entry.card_id || entry.card?.id
            const title = entry.card?.wikipedia_title
            return id && title
              ? { id, title, rarity: entry.card?.rarity || null }
              : null
          })
          .filter((card): card is Card => card !== null),
      )
    } else if (json.auction && typeof json.auction === 'object') {
      const auctionData = json.auction as {
        card_id?: string
        snapshot_rarity?: string
        card?: { id?: string; wikipedia_title?: string; rarity?: string }
      }
      const id = auctionData.card_id || auctionData.card?.id
      const title = auctionData.card?.wikipedia_title
      if (id && title)
        registerCards([
          {
            id,
            title,
            rarity:
              auctionData.snapshot_rarity || auctionData.card?.rarity || null,
          },
        ])
    }
  } catch (error) {
    console.debug('[WikiMasters Toolbox] page data unavailable', error)
  }
}

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
    prefs = readPrefs()
    if (!prefs.enabled) {
      if (autoTimer) clearTimeout(autoTimer)
      autoTimer = null
      runController?.abort(new Error('Stopped from another tab'))
      setStatus('Disabled')
    } else scheduleAuto()
    const toggle = document
      .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
      ?.shadowRoot?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (toggle) toggle.checked = prefs.enabled
    ensureAutoPanelRefresh()
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
    if (prefs.enabled) scheduleAuto()
  }
  start()
}
