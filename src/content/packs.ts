import { getAccountId } from './account'
import { captureRunCards, type RunCard, saveRunSummary } from './run-summary'
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
export const MANUAL_LIMIT_KEY = 'wm_toolbox_manual_limit_v1'
const MAX_PACKS_PER_CYCLE = 100
const OPEN_LOCK = 'wm-toolbox-auto-open'
const AUTO_RETRY_MS = 5_000
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
let scheduleClaimPending = false
let manualLimit = readManualLimit()

type OpenResult = {
  opened: number
  remaining: number | null
  reason: 'empty' | 'limit' | 'safety-cap'
}

function readManualLimit(): number | null {
  try {
    const raw = localStorage.getItem(MANUAL_LIMIT_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isInteger(value) && value >= 1 && value <= MAX_PACKS_PER_CYCLE
      ? value
      : null
  } catch {
    return null
  }
}

export function getManualLimit(): number | null {
  return manualLimit
}

export function setManualLimit(value: number | null): void {
  manualLimit =
    value === null || !Number.isFinite(value)
      ? null
      : Math.max(1, Math.min(MAX_PACKS_PER_CYCLE, Math.round(value)))
  try {
    if (manualLimit === null) localStorage.removeItem(MANUAL_LIMIT_KEY)
    else localStorage.setItem(MANUAL_LIMIT_KEY, String(manualLimit))
  } catch {
    /* Storage unavailable. */
  }
  clearOpenAllConfirmation()
}

export function syncManualLimitFromStorage(): void {
  manualLimit = readManualLimit()
  clearOpenAllConfirmation()
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
      nextAt: Math.max(0, Number(parsed.nextAt) || 0),
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
  prefs.nextAt = enabled ? Date.now() + randomDelay() : 0
  writePrefs()
  if (!enabled) {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    if (runMode === 'auto') runController?.abort(new Error('Stopped by user'))
    setStatus('Disabled')
  } else scheduleAuto()
}

export function setMinMinutes(value: number): void {
  prefs.minMinutes = Math.max(1, Math.min(10080, Math.round(value) || 20))
  prefs.maxMinutes = Math.max(prefs.maxMinutes, prefs.minMinutes)
  if (prefs.enabled) prefs.nextAt = Date.now() + randomDelay()
  writePrefs()
  if (prefs.enabled) scheduleAuto()
}

export function setMaxMinutes(value: number): void {
  prefs.maxMinutes = Math.max(
    prefs.minMinutes,
    Math.min(10080, Math.round(value) || 100),
  )
  if (prefs.enabled) prefs.nextAt = Date.now() + randomDelay()
  writePrefs()
  if (prefs.enabled) scheduleAuto()
}

export function syncPrefsFromStorage(): void {
  prefs = readPrefs()
  if (!prefs.enabled) {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    if (runMode === 'auto')
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

function schedulePassiveRetry(): void {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    autoTimer = null
    scheduleAuto()
  }, AUTO_RETRY_MS)
}

async function claimMissingSchedule(): Promise<void> {
  if (scheduleClaimPending) return
  if (!navigator.locks) {
    setStatus('Cross-tab lock unavailable')
    return
  }
  scheduleClaimPending = true
  try {
    await navigator.locks.request(OPEN_LOCK, { ifAvailable: true }, lock => {
      if (!lock) {
        setStatus('Another tab is opening packs')
        schedulePassiveRetry()
        return
      }
      prefs = readPrefs()
      if (!prefs.enabled) return
      if (prefs.nextAt === 0) {
        prefs.nextAt = Date.now() + randomDelay()
        writePrefs()
      }
      scheduleAuto()
    })
  } finally {
    scheduleClaimPending = false
  }
}

export function scheduleAuto(): void {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = null
  prefs = readPrefs()
  if (!prefs.enabled || runController) return
  if (prefs.nextAt === 0) {
    void claimMissingSchedule()
    return
  }
  const remaining = Math.max(1_000, prefs.nextAt - Date.now())
  setStatus(
    prefs.nextAt <= Date.now()
      ? 'Scheduled opening is due…'
      : `Next opening around ${formatLocalTime(prefs.nextAt)}`,
  )
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
      throw new Error(
        json.rate_limit_daily
          ? 'Daily pack limit reached'
          : `The game returned HTTP ${response.status}`,
      )
    return json
  }
  throw new Error('Opening stopped by the game rate limit')
}

export async function openAvailablePacks(
  signal: AbortSignal,
  maxPacks = MAX_PACKS_PER_CYCLE,
  expectedAccountId?: string,
  onPackOpened?: (cards: RunCard[]) => void,
): Promise<OpenResult> {
  openedThisCycle = 0
  let remaining: number | null = null
  updateProgress(0, null)
  const limit = Math.max(1, Math.min(MAX_PACKS_PER_CYCLE, maxPacks))
  for (let index = 0; index < limit; index += 1) {
    if (signal.aborted) throw signal.reason
    if (expectedAccountId && getAccountId() !== expectedAccountId)
      throw new Error('WikiMasters account changed during the run')
    setStatus(`Opening pack ${index + 1}…`)
    const response = await openOnePack(signal)
    if (!Array.isArray(response.cards) || response.cards.length === 0) {
      if (response.packs_remaining === 0)
        return { opened: openedThisCycle, remaining: 0, reason: 'empty' }
      throw new Error('The game returned a pack without cards')
    }
    openedThisCycle += 1
    onPackOpened?.(captureRunCards(response.cards, openedThisCycle))
    const reportedRemaining = Number(response.packs_remaining)
    remaining = Number.isFinite(reportedRemaining)
      ? Math.max(0, reportedRemaining)
      : null
    await recordPack(response.cards, expectedAccountId)
    updateProgress(
      openedThisCycle,
      remaining === null ? null : Math.min(limit, openedThisCycle + remaining),
    )
    updateOpenAllButton()
    if (remaining === 0)
      return { opened: openedThisCycle, remaining, reason: 'empty' }
    if (openedThisCycle === limit)
      return {
        opened: openedThisCycle,
        remaining,
        reason: limit === MAX_PACKS_PER_CYCLE ? 'safety-cap' : 'limit',
      }
    await wait(500 + Math.round(Math.random() * 1_500), signal)
  }
  return { opened: openedThisCycle, remaining, reason: 'empty' }
}

export async function runPacks(mode: 'manual' | 'auto'): Promise<void> {
  if (runController || (mode === 'auto' && !prefs.enabled)) return
  clearOpenAllConfirmation()
  if (!navigator.locks) {
    setStatus('Cross-tab lock unavailable')
    return
  }
  await navigator.locks.request(
    OPEN_LOCK,
    { ifAvailable: true },
    async lock => {
      if (!lock) {
        setStatus('Another tab is opening packs')
        if (mode === 'auto') schedulePassiveRetry()
        return
      }
      prefs = readPrefs()
      if (mode === 'auto') {
        if (!prefs.enabled) return
        if (prefs.nextAt === 0 || prefs.nextAt > Date.now()) {
          scheduleAuto()
          return
        }
      }
      const accountId = getAccountId()
      runController = new AbortController()
      runMode = mode
      if (mode === 'auto') {
        prefs.nextAt = 0
        writePrefs()
      }
      updateOpenAllButton()
      const limit =
        mode === 'manual'
          ? (manualLimit ?? MAX_PACKS_PER_CYCLE)
          : MAX_PACKS_PER_CYCLE
      const openedCards: RunCard[] = []
      let detail = ''
      try {
        const result = await openAvailablePacks(
          runController.signal,
          limit,
          accountId ?? undefined,
          cards =>
            openedCards.push(...cards.slice(0, 500 - openedCards.length)),
        )
        detail =
          result.reason === 'empty'
            ? result.opened === 0
              ? 'No packs were available.'
              : 'No packs remain.'
            : result.reason === 'limit'
              ? `Reached your ${limit}-pack limit.`
              : `Stopped at the ${MAX_PACKS_PER_CYCLE}-pack safety limit.`
        setStatus(
          `${openedThisCycle} pack${openedThisCycle === 1 ? '' : 's'} opened`,
        )
      } catch (error) {
        detail = runController.signal.aborted
          ? runController.signal.reason instanceof Error
            ? `${runController.signal.reason.message}.`
            : 'Opening stopped.'
          : error instanceof Error
            ? `Failed: ${error.message}.`
            : 'Failed: the game could not open the next pack.'
        setStatus(detail)
      } finally {
        const shouldRefresh =
          openedThisCycle > 0 && /^\/pulls(\/|$)/.test(location.pathname)
        const summaryAccountId = accountId ?? getAccountId()
        if (summaryAccountId)
          saveRunSummary({
            accountId: summaryAccountId,
            mode,
            opened: openedThisCycle,
            detail,
            finishedAt: Date.now(),
            cards: openedCards,
            expanded: true,
          })
        hideProgress()
        runController = null
        runMode = null
        updateOpenAllButton()
        prefs = readPrefs()
        if (prefs.enabled) {
          prefs.nextAt = Date.now() + randomDelay()
          writePrefs()
          scheduleAuto()
        }
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
          ? manualLimit === null
            ? 'Confirm opening all packs'
            : `Confirm opening up to ${manualLimit} ${manualLimit === 1 ? 'pack' : 'packs'}`
          : manualLimit === null
            ? 'Open all available packs'
            : `Open up to ${manualLimit} ${manualLimit === 1 ? 'pack' : 'packs'}`
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

function hideProgress(): void {
  const progress = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLElement>('[data-wm-toolbox-progress]')
  if (progress) progress.hidden = true
}
