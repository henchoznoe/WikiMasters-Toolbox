import { getAccountId, onAccountChange } from './account'
import { PRICE_TTL, RARITIES, type Summary } from './price-model'

let storageWarning = ''
onAccountChange(() => {
  storageWarning = ''
})
let notify = (): void => {}
export function setPriceAlertCallback(callback: () => void): void {
  notify = callback
}
export const ALERT_PREFIX = 'wm_toolbox_price_alerts_v1:'
export type PriceAlert = {
  id: string
  rarity: string
  threshold: number
  direction: 'above' | 'below'
  previous: number | null
  at: number
}
export type AlertEvent = {
  id: string
  rarity: string
  threshold: number
  direction: 'above' | 'below'
  average: number
  at: number
}
type AlertState = { rules: PriceAlert[]; events: AlertEvent[]; warning: string }
const validTime = (at: unknown): at is number =>
  typeof at === 'number' && Number.isFinite(at) && at >= 0 && at <= Date.now()
function validRule(row: PriceAlert): boolean {
  return (
    !!row &&
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    row.id.length <= 200 &&
    RARITIES.some(r => r === row.rarity) &&
    Number.isFinite(row.threshold) &&
    row.threshold > 0 &&
    (row.direction === 'above' || row.direction === 'below') &&
    validTime(row.at) &&
    (row.previous === null ||
      (Number.isFinite(row.previous) && row.previous >= 0))
  )
}
export function readPriceAlerts(): AlertState {
  const owner = getAccountId()
  if (!owner)
    return {
      rules: [],
      events: [],
      warning: 'Connectez-vous pour enregistrer des alertes',
    }
  try {
    const data = JSON.parse(localStorage.getItem(ALERT_PREFIX + owner) ?? '{}')
    if (data.accountId !== owner)
      return { rules: [], events: [], warning: storageWarning }
    return {
      rules: Array.isArray(data.rules)
        ? data.rules.filter(validRule).slice(-50)
        : [],
      events: Array.isArray(data.events)
        ? data.events
            .filter(
              (row: AlertEvent) =>
                validRule({ ...row, previous: row.average }) &&
                validTime(row.at) &&
                Date.now() - row.at <= 30 * 86400_000,
            )
            .slice(-100)
        : [],
      warning: storageWarning,
    }
  } catch {
    return {
      rules: [],
      events: [],
      warning: 'Stockage des alertes indisponible',
    }
  }
}
function save(state: AlertState): boolean {
  const owner = getAccountId()
  if (!owner) return false
  try {
    localStorage.setItem(
      ALERT_PREFIX + owner,
      JSON.stringify({
        accountId: owner,
        rules: state.rules,
        events: state.events.slice(-100),
      }),
    )
    storageWarning = ''
    notify()
    return true
  } catch {
    storageWarning =
      'Stockage des alertes indisponible · dernière observation non enregistrée'
    notify()
    return false
  }
}
export function setPriceAlert(rule: PriceAlert): string {
  if (!getAccountId()) return 'Connectez-vous pour enregistrer des alertes'
  if (!validRule(rule)) return 'Choisissez un seuil positif en W'
  const state = readPriceAlerts()
  state.rules = state.rules.filter(
    row => row.id !== rule.id || row.rarity !== rule.rarity,
  )
  if (state.rules.length >= 50)
    return '50 alertes maximum · supprimez-en une d’abord'
  state.rules.push(rule)
  return save(state)
    ? 'Alerte enregistrée · observations uniquement'
    : 'Stockage des alertes indisponible'
}
export function removePriceAlert(id: string, rarity: string): boolean {
  const state = readPriceAlerts()
  state.rules = state.rules.filter(
    row => row.id !== id || row.rarity !== rarity,
  )
  return save(state)
}
export function clearPriceAlertEvents(): boolean {
  const state = readPriceAlerts()
  state.events = []
  return save(state)
}
export function observePriceAlerts(
  id: string,
  averages: Summary,
  at: number,
): void {
  if (!getAccountId() || !validTime(at) || Date.now() - at >= PRICE_TTL) return
  const state = readPriceAlerts()
  let changed = false
  for (const rule of state.rules) {
    if (rule.id !== id || at <= rule.at) continue
    const value = averages[rule.rarity] ?? null
    if (value !== null && (!Number.isFinite(value) || value < 0)) continue
    if (
      value !== null &&
      rule.previous !== null &&
      (rule.direction === 'above'
        ? rule.previous < rule.threshold && value >= rule.threshold
        : rule.previous > rule.threshold && value <= rule.threshold)
    )
      state.events.push({
        id,
        rarity: rule.rarity,
        threshold: rule.threshold,
        direction: rule.direction,
        average: value,
        at,
      })
    rule.previous = value
    rule.at = at
    changed = true
  }
  if (changed) save(state)
}
