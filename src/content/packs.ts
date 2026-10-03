import { getAccountId, onAccountChange } from './account'
import { invalidateCollection } from './collection'
import { errorMessage } from './presentation'
import { requestWrite, serverPauseMs } from './requests'
import { captureRunCards, type RunCard, saveRunSummary } from './run-summary'
import { recordPack } from './stats'

type AutoPrefs = {
  enabled: boolean
  minMinutes: number
  maxMinutes: number
  nextAt: number
  verificationRequired: boolean
}
type PackResponse = {
  cards?: unknown[]
  packs_remaining?: number
  rate_limited?: boolean
  rate_limit_daily?: boolean
  retry_after?: string
  error?: string
  message?: string
  human_verification_required?: boolean
}

export const AUTO_KEY = 'wm_toolbox_auto_v2:'
export const MANUAL_LIMIT_KEY = 'wm_toolbox_manual_limit_v2:'
const MAX_PACKS_PER_CYCLE = 100
const OPEN_LOCK = 'wm-toolbox-auto-open'
const AUTO_RETRY_MS = 5_000
const DEFAULT_PREFS: AutoPrefs = {
  enabled: false,
  minMinutes: 20,
  maxMinutes: 100,
  nextAt: 0,
  verificationRequired: false,
}
let prefs = readPrefs()
let autoTimer: ReturnType<typeof setTimeout> | null = null
let runController: AbortController | null = null
let runMode: 'manual' | 'auto' | null = null
let statusText = 'Désactivé'
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
    const raw = getAccountId()
      ? localStorage.getItem(MANUAL_LIMIT_KEY + getAccountId())
      : null
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
  if (!getAccountId()) return
  manualLimit =
    value === null || !Number.isFinite(value)
      ? null
      : Math.max(1, Math.min(MAX_PACKS_PER_CYCLE, Math.round(value)))
  try {
    if (manualLimit === null)
      localStorage.removeItem(MANUAL_LIMIT_KEY + getAccountId())
    else
      localStorage.setItem(
        MANUAL_LIMIT_KEY + getAccountId(),
        String(manualLimit),
      )
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
    const raw = getAccountId()
      ? localStorage.getItem(AUTO_KEY + getAccountId())
      : null
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
      verificationRequired: parsed.verificationRequired === true,
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

const VERIFICATION_STATUS =
  'Vérification requise · utilisez le bouton d’ouverture du jeu'
class HumanVerificationError extends Error {}

export function requirePackVerification(): void {
  prefs = readPrefs()
  prefs.verificationRequired = true
  prefs.nextAt = 0
  writePrefs()
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = null
  runController?.abort(new HumanVerificationError(VERIFICATION_STATUS))
  setStatus(VERIFICATION_STATUS)
  updateOpenAllButton()
}

// A successful native opening confirms that the game's verification is complete.
// The game manages its challenge and credentials; the Toolbox observes only cards.
export function observeNativePack(): void {
  prefs = readPrefs()
  if (!prefs.verificationRequired) return
  prefs.verificationRequired = false
  prefs.nextAt = prefs.enabled ? Date.now() + randomDelay() : 0
  writePrefs()
  setStatus('Vérification terminée')
  updateOpenAllButton()
  if (prefs.enabled) scheduleAuto()
}

export function setAutoEnabled(enabled: boolean): void {
  if (!getAccountId()) return
  prefs.enabled = enabled
  prefs.nextAt =
    enabled && !prefs.verificationRequired ? Date.now() + randomDelay() : 0
  writePrefs()
  if (!enabled) {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    if (runMode === 'auto') runController?.abort(new Error('Arrêt demandé'))
    setStatus(prefs.verificationRequired ? VERIFICATION_STATUS : 'Désactivé')
  } else scheduleAuto()
}

export function setMinMinutes(value: number): void {
  prefs.minMinutes = Math.max(1, Math.min(10080, Math.round(value) || 20))
  prefs.maxMinutes = Math.max(prefs.maxMinutes, prefs.minMinutes)
  if (prefs.enabled && !prefs.verificationRequired)
    prefs.nextAt = Date.now() + randomDelay()
  writePrefs()
  if (prefs.enabled) scheduleAuto()
}

export function setMaxMinutes(value: number): void {
  prefs.maxMinutes = Math.max(
    prefs.minMinutes,
    Math.min(10080, Math.round(value) || 100),
  )
  if (prefs.enabled && !prefs.verificationRequired)
    prefs.nextAt = Date.now() + randomDelay()
  writePrefs()
  if (prefs.enabled) scheduleAuto()
}

export function syncPrefsFromStorage(): void {
  prefs = readPrefs()
  updateOpenAllButton()
  if (prefs.verificationRequired) {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    runController?.abort(new HumanVerificationError(VERIFICATION_STATUS))
    setStatus(VERIFICATION_STATUS)
    return
  }
  if (!prefs.enabled) {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    if (runMode === 'auto')
      runController?.abort(new Error('Arrêt depuis un autre onglet'))
    setStatus('Désactivé')
  } else scheduleAuto()
}

export function leavePacksPage(): void {
  clearOpenAllConfirmation()
  if (runMode === 'manual')
    runController?.abort(new Error('Page des paquets quittée'))
}

export function onOpenAllClick(): void {
  if (runMode === 'manual') {
    runController?.abort(new Error('Arrêt demandé'))
    return
  }
  if (!getAccountId()) {
    setStatus('En attente de votre compte WikiMasters…')
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
  if (!getAccountId()) return
  try {
    localStorage.setItem(AUTO_KEY + getAccountId(), JSON.stringify(prefs))
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
  if (status) {
    status.textContent = statusText
    status.hidden = statusText === 'Désactivé'
  }
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
    setStatus('Verrou entre onglets indisponible')
    return
  }
  scheduleClaimPending = true
  try {
    await navigator.locks.request(OPEN_LOCK, { ifAvailable: true }, lock => {
      if (!lock) {
        setStatus('Un autre onglet ouvre des paquets')
        schedulePassiveRetry()
        return
      }
      prefs = readPrefs()
      if (!prefs.enabled || prefs.verificationRequired) return
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
  if (prefs.verificationRequired) {
    setStatus(VERIFICATION_STATUS)
    return
  }
  if (!prefs.enabled || runController) return
  if (prefs.nextAt === 0) {
    void claimMissingSchedule()
    return
  }
  const remaining = Math.max(1_000, prefs.nextAt - Date.now())
  setStatus(
    prefs.nextAt <= Date.now()
      ? 'Ouverture programmée en attente…'
      : `Prochaine ouverture vers ${formatLocalTime(prefs.nextAt)}`,
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
  if (signal.aborted) throw signal.reason
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await requestWrite('/api/packs/open', signal, {
      headers: { accept: '*/*' },
    })
    const response = result.response
    const json = result.json as PackResponse
    if (!json || typeof json !== 'object')
      throw new Error('Réponse du paquet modifiée')
    if (json.human_verification_required === true) {
      requirePackVerification()
      throw new HumanVerificationError(VERIFICATION_STATUS)
    }
    if (json.rate_limited && !json.rate_limit_daily) {
      const retryAt = Date.parse(json.retry_after || '')
      const waitMs = Math.max(retryAt - Date.now() + 200, serverPauseMs())
      if (
        !Number.isFinite(waitMs) ||
        waitMs < 0 ||
        waitMs > 120_000 ||
        attempt === 2
      ) {
        throw new Error('Limite temporaire de requêtes ; réessayez plus tard')
      }
      setStatus('Le jeu est occupé. Nouvelle tentative bientôt…')
      await wait(waitMs, signal)
      continue
    }
    if (!response.ok)
      throw new Error(
        json.rate_limit_daily
          ? 'Limite quotidienne de paquets atteinte'
          : `Le jeu a renvoyé HTTP ${response.status}`,
      )
    return json
  }
  throw new Error('Ouverture arrêtée par la limite de requêtes du jeu')
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
      throw new Error('Compte WikiMasters modifié pendant l’ouverture')
    setStatus(`Ouverture du paquet ${index + 1}…`)
    const response = await openOnePack(signal)
    if (
      signal.aborted ||
      (expectedAccountId && getAccountId() !== expectedAccountId)
    )
      throw new Error('Compte WikiMasters modifié pendant l’ouverture')
    if (!Array.isArray(response.cards) || response.cards.length === 0) {
      if (response.packs_remaining === 0)
        return { opened: openedThisCycle, remaining: 0, reason: 'empty' }
      throw new Error('Le jeu a renvoyé un paquet sans cartes')
    }
    openedThisCycle += 1
    invalidateCollection()
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
  const expectedAccount = getAccountId()
  if (!expectedAccount || runController || (mode === 'auto' && !prefs.enabled))
    return
  clearOpenAllConfirmation()
  if (!navigator.locks) {
    setStatus('Verrou entre onglets indisponible')
    return
  }
  await navigator.locks.request(
    OPEN_LOCK,
    { ifAvailable: true },
    async lock => {
      if (!lock) {
        setStatus('Un autre onglet ouvre des paquets')
        if (mode === 'auto') schedulePassiveRetry()
        return
      }
      if (getAccountId() !== expectedAccount) return
      prefs = readPrefs()
      if (prefs.verificationRequired) {
        setStatus(VERIFICATION_STATUS)
        updateOpenAllButton()
        return
      }
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
              ? 'Aucun paquet disponible.'
              : 'Il ne reste aucun paquet.'
            : result.reason === 'limit'
              ? `Limite atteinte : ${limit} paquets.`
              : `Arrêt à la limite de sécurité de ${MAX_PACKS_PER_CYCLE} paquets.`
        setStatus(
          `${openedThisCycle} paquet${openedThisCycle === 1 ? '' : 's'} ouvert${openedThisCycle === 1 ? '' : 's'}`,
        )
      } catch (error) {
        detail =
          error instanceof HumanVerificationError
            ? VERIFICATION_STATUS
            : runController.signal.aborted
              ? runController.signal.reason instanceof Error
                ? `${runController.signal.reason.message}.`
                : 'Ouverture arrêtée.'
              : error instanceof Error
                ? `Échec : ${errorMessage(error, 'Ouverture indisponible')}.`
                : 'Échec : le jeu n’a pas pu ouvrir le paquet suivant.'
        if (getAccountId() === accountId) setStatus(detail)
      } finally {
        const shouldRefresh =
          getAccountId() === accountId &&
          openedThisCycle > 0 &&
          !readPrefs().verificationRequired &&
          /^\/pulls(\/|$)/.test(location.pathname)
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
        if (
          getAccountId() === accountId &&
          prefs.enabled &&
          !prefs.verificationRequired
        ) {
          prefs.nextAt = Date.now() + randomDelay()
          writePrefs()
        }
        if (prefs.enabled && !prefs.verificationRequired) scheduleAuto()
        if (shouldRefresh)
          setTimeout(() => {
            if (
              getAccountId() === accountId &&
              /^\/pulls(\/|$)/.test(location.pathname)
            )
              location.reload()
          }, 800)
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
  button.disabled =
    !getAccountId() || runMode === 'auto' || prefs.verificationRequired
  button.classList.toggle('wm-open-all-confirm', confirmationTimer !== null)
  button.textContent = prefs.verificationRequired
    ? 'Vérifiez avec le bouton d’ouverture du jeu'
    : runMode === 'manual'
      ? `Arrêter l’ouverture (${openedThisCycle})`
      : runMode === 'auto'
        ? 'Ouverture automatique…'
        : confirmationTimer
          ? manualLimit === null
            ? 'Confirmer l’ouverture de tous les paquets'
            : `Confirmer l’ouverture : jusqu’à ${manualLimit} ${manualLimit === 1 ? 'paquet' : 'paquets'}`
          : manualLimit === null
            ? 'Ouvrir tous les paquets disponibles'
            : `Ouvrir jusqu’à ${manualLimit} ${manualLimit === 1 ? 'paquet' : 'paquets'}`
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
    label.textContent = 'Vérification des paquets disponibles…'
  } else {
    meter.max = Math.max(1, total)
    meter.value = opened
    label.textContent = `${opened} / ${total} paquets ouverts`
  }
}

function hideProgress(): void {
  const progress = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLElement>('[data-wm-toolbox-progress]')
  if (progress) progress.hidden = true
}

onAccountChange(() => {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = null
  clearOpenAllConfirmation()
  runController?.abort(new Error('Compte WikiMasters modifié'))
  prefs = readPrefs()
  manualLimit = readManualLimit()
  setStatus(
    getAccountId() ? 'Désactivé' : 'En attente de votre compte WikiMasters…',
  )
  updateOpenAllButton()
  if (prefs.enabled && !runController) scheduleAuto()
})
