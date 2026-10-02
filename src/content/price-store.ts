import { cachePolicies, onCacheChange, writeCache } from './cache'
import {
  appendObservation,
  type Observation,
  PRICE_TTL,
  parseSummary,
  RARITIES,
  RETRY_DELAY,
  type Summary,
} from './price-model'
import {
  requestReadData as get,
  getRequestEpoch,
  requestLimit as priceRequestLimit,
  RequestAdmissionError,
  requestJson,
} from './requests'

const PREFIX = 'wm_toolbox_price_v1_'
const HISTORY = 'wm_toolbox_price_history_v1_'
const entries = new Map<string, PriceEntry>()
let notify: () => void = () => {}
export function setPriceStoreCallback(callback: () => void): void {
  notify = callback
}

type PriceEntry = {
  fetchedAt: number
  ok: boolean
  notFound?: boolean
  averages: Summary
  lastAttempt?: number
  failed?: boolean
}
export type PriceQuote =
  | { status: 'loading' }
  | { status: 'unavailable'; fetchedAt: number; reason?: string }
  | { status: 'unknown-rarity'; fetchedAt: number }
  | {
      status: 'no-sales'
      fetchedAt: number
      failed?: boolean
      lastAttempt?: number
      stale?: boolean
    }
  | { status: 'not-found'; fetchedAt: number }
  | {
      status: 'available'
      average: number
      fetchedAt: number
      stale?: boolean
      lastAttempt?: number
      failed?: boolean
    }

function readEntry(id: string): PriceEntry | null {
  const cached = entries.get(id)
  if (cached && Date.now() - cached.fetchedAt <= cachePolicies.prices.retention)
    return cached
  entries.delete(id)
  try {
    const raw = localStorage.getItem(PREFIX + id)
    const row = raw ? JSON.parse(raw) : null
    if (
      row &&
      typeof row.ok === 'boolean' &&
      Number.isFinite(row.fetchedAt) &&
      row.fetchedAt > 0 &&
      (row.lastAttempt === undefined ||
        (typeof row.lastAttempt === 'number' &&
          Number.isFinite(row.lastAttempt) &&
          row.lastAttempt > 0 &&
          row.lastAttempt <= Date.now())) &&
      row.fetchedAt <= Date.now() &&
      Date.now() - row.fetchedAt <= cachePolicies.prices.retention &&
      row.averages &&
      typeof row.averages === 'object' &&
      !Array.isArray(row.averages) &&
      Object.entries(row.averages).every(
        ([r, v]) =>
          RARITIES.includes(r as (typeof RARITIES)[number]) &&
          typeof v === 'number' &&
          Number.isFinite(v) &&
          v >= 0,
      )
    ) {
      entries.set(id, row)
      if (entries.size > 1000)
        entries.delete(entries.keys().next().value as string)
      return row
    }
  } catch {
    /* Storage unavailable. */
  }
  return null
}
function fresh(row: PriceEntry): boolean {
  return (
    Date.now() - (row.lastAttempt ?? row.fetchedAt) <
    (row.failed || !row.ok ? RETRY_DELAY : PRICE_TTL)
  )
}
export function canRefreshPrice(id: string): boolean {
  const row = readEntry(id)
  return (
    !pendingPrices.has(id) &&
    (!row || Date.now() - (row.lastAttempt ?? row.fetchedAt) >= RETRY_DELAY) &&
    !priceRequestLimit()
  )
}
export function needsPrice(id: string): boolean {
  const row = readEntry(id)
  return !row || !fresh(row)
}
export function readPriceQuote(id: string, rarity: string | null): PriceQuote {
  const row = readEntry(id)
  if (!row) {
    const limit = priceRequestLimit()
    return limit
      ? { status: 'unavailable', fetchedAt: Date.now(), reason: limit }
      : { status: 'loading' }
  }
  if (!row.ok && !fresh(row)) {
    const limit = priceRequestLimit()
    return limit
      ? { status: 'unavailable', fetchedAt: row.fetchedAt, reason: limit }
      : { status: 'loading' }
  }
  if (row.notFound) return { status: 'not-found', fetchedAt: row.fetchedAt }
  if (!row.ok) return { status: 'unavailable', fetchedAt: row.fetchedAt }
  if (!rarity) return { status: 'unknown-rarity', fetchedAt: row.fetchedAt }
  const average = row.averages[rarity]
  return average === undefined
    ? {
        status: 'no-sales',
        fetchedAt: row.fetchedAt,
        failed: row.failed,
        lastAttempt: row.lastAttempt,
        stale: Date.now() - row.fetchedAt >= PRICE_TTL,
      }
    : {
        status: 'available',
        average,
        fetchedAt: row.fetchedAt,
        stale: Date.now() - row.fetchedAt >= PRICE_TTL,
        lastAttempt: row.lastAttempt,
        failed: row.failed,
      }
}

export function readPriceHistory(id: string, rarity: string): Observation[] {
  try {
    const rows = JSON.parse(localStorage.getItem(HISTORY + id) ?? '{}')[rarity]
    return Array.isArray(rows)
      ? rows
          .filter(
            row =>
              row &&
              Number.isFinite(row.at) &&
              row.at <= Date.now() &&
              row.at >= Date.now() - 90 * 86400_000 &&
              (row.average === null ||
                (typeof row.average === 'number' &&
                  Number.isFinite(row.average) &&
                  row.average >= 0)),
          )
          .slice(-90)
      : []
  } catch {
    return []
  }
}
function save(id: string, row: PriceEntry): void {
  entries.delete(id)
  entries.set(id, row)
  if (entries.size > 1000) entries.delete(entries.keys().next().value as string)
  writeCache('prices', PREFIX + id, row)
  if (row.ok && !row.failed) {
    try {
      const history: Record<string, Observation[]> = {}
      for (const rarity of RARITIES)
        history[rarity] = appendObservation(readPriceHistory(id, rarity), {
          at: row.fetchedAt,
          average: row.averages[rarity] ?? null,
        })
      writeCache('history', HISTORY + id, history)
    } catch {
      /* No invented history when persistence fails. */
    }
  }
  notify()
}

export { requestLimit as priceRequestLimit } from './requests'
export function requestMarketJson(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  return requestJson(url, signal)
}
let cacheEpoch = 0
const pendingPrices = new Map<string, Promise<void>>()
export function requestPriceQuote(id: string, force = false): Promise<void> {
  if (!id || id.length > 200) return Promise.resolve()
  const pending = pendingPrices.get(id)
  if (pending) return pending
  const row = readEntry(id)
  if (
    row &&
    (force
      ? Date.now() - (row.lastAttempt ?? row.fetchedAt) < RETRY_DELAY
      : fresh(row))
  )
    return Promise.resolve()
  const cacheVersion = cacheEpoch
  const reading = (async () => {
    const at = Date.now()
    const epoch = getRequestEpoch()
    try {
      const { response, json } = await get(
        `/api/marketplace/cards/${encodeURIComponent(id)}/sales?scope=summary`,
      )
      if (cacheVersion !== cacheEpoch) return
      if (response.status === 404) {
        save(id, { fetchedAt: at, ok: false, notFound: true, averages: {} })
        return
      }
      if (!response.ok) throw new Error('Price unavailable')
      const averages = parseSummary(
        (json as Record<string, unknown> | null)?.summary,
      )
      if (!averages) throw new Error('Invalid summary')
      save(id, { fetchedAt: at, ok: true, averages })
    } catch (cause) {
      if (cause instanceof RequestAdmissionError) return
      if (getRequestEpoch() !== epoch || cacheVersion !== cacheEpoch) return
      save(
        id,
        row?.ok
          ? { ...row, lastAttempt: at, failed: true }
          : { fetchedAt: at, ok: false, averages: {} },
      )
    }
  })()
  pendingPrices.set(id, reading)
  void reading.finally(() => {
    if (pendingPrices.get(id) === reading) pendingPrices.delete(id)
  })
  return reading
}

export type BatchState = {
  running: boolean
  done: number
  total: number
  skipped: number
  failed: number
  cancelled: boolean
}
let batch: BatchState = {
  running: false,
  done: 0,
  total: 0,
  skipped: 0,
  failed: 0,
  cancelled: false,
}
let generation = 0
export function getPriceBatch(): BatchState {
  return { ...batch }
}
export function cancelPriceBatch(): void {
  if (!batch.running) return
  generation += 1
  batch.running = false
  batch.cancelled = true
  notify()
}
export async function startPriceBatch(
  ids: string[],
  force = false,
  cap = 50,
): Promise<void> {
  if (batch.running) return
  const token = ++generation
  const unique = [...new Set(ids)]
  const selected = unique
    .filter(id => (force ? canRefreshPrice(id) : needsPrice(id)))
    .slice(0, Math.max(1, Math.min(100, Math.floor(cap) || 50)))
  batch = {
    running: true,
    done: 0,
    total: selected.length,
    skipped: unique.length - selected.length,
    failed: 0,
    cancelled: false,
  }
  notify()
  for (const id of selected) {
    if (generation !== token) return
    if (priceRequestLimit()) break
    const before = readEntry(id)?.lastAttempt ?? readEntry(id)?.fetchedAt
    await requestPriceQuote(id, force)
    if (generation !== token) return
    const row = readEntry(id)
    if ((row?.lastAttempt ?? row?.fetchedAt) === before) batch.skipped += 1
    else if (!row?.ok || row.failed) batch.failed += 1
    batch.done += 1
    notify()
  }
  if (generation === token) {
    batch.running = false
    notify()
  }
}

export function syncPricesFromStorage(key: string | null): void {
  if (!key || key.startsWith(PREFIX)) {
    entries.clear()
    notify()
  }
}

onCacheChange(kind => {
  if (kind === 'prices') {
    cacheEpoch += 1
    pendingPrices.clear()
    entries.clear()
    notify()
  }
})
