import { recordPack } from './stats'

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

export const AUTO_KEY = 'wm_toolbox_auto_v1'
const MAX_PACKS_PER_CYCLE = 100
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

export function getPrefs(): AutoPrefs {
  return { ...prefs }
}

export function getStatus(): string {
  return statusText
}

export function setAutoEnabled(enabled: boolean): void {
  prefs.enabled = enabled
  prefs.nextAt = 0
  writePrefs()
  if (!enabled) {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    if (runMode === 'auto') runController?.abort(new Error('Stopped by user'))
    setStatus('Disabled')
  } else scheduleAuto(true)
}

export function setMinMinutes(value: number): void {
  prefs.minMinutes = Math.max(1, Math.min(10080, Math.round(value) || 20))
  prefs.maxMinutes = Math.max(prefs.maxMinutes, prefs.minMinutes)
  writePrefs()
  if (prefs.enabled) scheduleAuto(true)
}

export function setMaxMinutes(value: number): void {
  prefs.maxMinutes = Math.max(
    prefs.minMinutes,
    Math.min(10080, Math.round(value) || 100),
  )
  writePrefs()
  if (prefs.enabled) scheduleAuto(true)
}

export function syncPrefsFromStorage(): void {
  prefs = readPrefs()
  if (!prefs.enabled) {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    runController?.abort(new Error('Stopped from another tab'))
    setStatus('Disabled')
  } else scheduleAuto()
}

export function leavePacksPage(): void {
  clearOpenAllConfirmation()
  if (runMode === 'manual')
    runController?.abort(new Error('Left the Packs page'))
}

export function onOpenAllClick(): void {
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

export function formatLocalTime(timestamp: number): string {
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

export function scheduleAuto(reset = false): void {
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

export async function openOnePack(signal: AbortSignal): Promise<PackResponse> {
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

export async function openAvailablePacks(
  signal: AbortSignal,
): Promise<boolean> {
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

export async function runPacks(mode: 'manual' | 'auto'): Promise<void> {
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

export function updateOpenAllButton(): void {
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

export function clearOpenAllConfirmation(): void {
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
