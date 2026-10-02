import {
  appendObservation,
  type Observation,
  PRICE_TTL,
  parseSummary,
  RARITIES,
  RETRY_DELAY,
  type Summary,
} from './price-model'

const PREFIX = 'wm_toolbox_price_v1_'
const HISTORY = 'wm_toolbox_price_history_v1_'
const MAX_REQUESTS = 200
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
  if (entries.has(id)) return entries.get(id) ?? null
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
    !jobs.has(`summary:${id}`) &&
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
  entries.set(id, row)
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(row))
  } catch {
    /* Memory cache remains usable. */
  }
  if (row.ok && !row.failed) {
    try {
      const history: Record<string, Observation[]> = {}
      for (const rarity of RARITIES)
        history[rarity] = appendObservation(readPriceHistory(id, rarity), {
          at: row.fetchedAt,
          average: row.averages[rarity] ?? null,
        })
      localStorage.setItem(HISTORY + id, JSON.stringify(history))
      const index: string[] = JSON.parse(
        localStorage.getItem(`${HISTORY}index`) ?? '[]',
      )
      const next = [...index.filter(key => key !== id), id]
      for (const key of next.slice(0, Math.max(0, next.length - 300)))
        localStorage.removeItem(HISTORY + key)
      localStorage.setItem(`${HISTORY}index`, JSON.stringify(next.slice(-300)))
    } catch {
      /* No invented history when persistence fails. */
    }
  }
  notify()
}

type Job = {
  key: string
  run: () => Promise<void>
  resolve: () => void
  promise: Promise<void>
}
const queue: Job[] = []
const jobs = new Map<string, Job>()
let running = false
let nextStart = 0
let cooldown = 0
let requests: number[] = []
try {
  const budget = JSON.parse(
    sessionStorage.getItem('wm_toolbox_price_budget_v1') ?? '{}',
  )
  if (Array.isArray(budget.requests))
    requests = budget.requests.filter(
      (at: unknown): at is number =>
        typeof at === 'number' &&
        Number.isFinite(at) &&
        at <= Date.now() &&
        at > Date.now() - 3600_000,
    )
  if (typeof budget.cooldown === 'number' && Number.isFinite(budget.cooldown))
    cooldown = Math.min(budget.cooldown, Date.now() + 300_000)
} catch {
  /* A per-page budget remains available without session storage. */
}
function saveBudget(): void {
  try {
    sessionStorage.setItem(
      'wm_toolbox_price_budget_v1',
      JSON.stringify({ requests, cooldown }),
    )
  } catch {
    /* Storage unavailable. */
  }
}
let timer: ReturnType<typeof setTimeout> | null = null
export function priceRequestLimit(): string {
  const now = Date.now()
  requests = requests.filter(at => at > now - 3600_000)
  return cooldown > now
    ? `Server pause · ${Math.ceil((cooldown - now) / 1000)} s`
    : requests.length >= MAX_REQUESTS
      ? '200 requests / hour reached'
      : ''
}
function schedule(key: string, run: () => Promise<void>): Promise<void> {
  const existing = jobs.get(key)
  if (existing) return existing.promise
  if (queue.length >= 200 || priceRequestLimit()) return Promise.resolve()
  let resolve = () => {}
  const promise = new Promise<void>(done => {
    resolve = done
  })
  const job = { key, run, resolve, promise }
  jobs.set(key, job)
  queue.push(job)
  pump()
  return promise
}
function pump(): void {
  if (running || timer || !queue.length) return
  if (priceRequestLimit()) {
    for (const job of queue.splice(0)) {
      jobs.delete(job.key)
      job.resolve()
    }
    notify()
    return
  }
  const wait = Math.max(0, nextStart - Date.now())
  if (wait) {
    timer = setTimeout(() => {
      timer = null
      pump()
    }, wait)
    return
  }
  const job = queue.shift()
  if (!job) return
  running = true
  requests.push(Date.now())
  saveBudget()
  nextStart = Date.now() + 650
  void job
    .run()
    .catch(() => {})
    .finally(() => {
      jobs.delete(job.key)
      running = false
      job.resolve()
      notify()
      pump()
    })
}
async function get(url: string): Promise<Response> {
  const response = await fetch(url, {
    credentials: 'include',
    signal: AbortSignal.timeout(12_000),
  })
  if (response.status >= 500) cooldown = Date.now() + 30_000
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'))
    cooldown =
      Date.now() +
      Math.min(
        300_000,
        Math.max(60_000, Number.isFinite(seconds) ? seconds * 1000 : 60_000),
      )
  }
  saveBudget()
  return response
}
export function requestPriceQuote(id: string, force = false): Promise<void> {
  if (!id || id.length > 200) return Promise.resolve()
  const row = readEntry(id)
  if (
    row &&
    (force
      ? Date.now() - (row.lastAttempt ?? row.fetchedAt) < RETRY_DELAY
      : fresh(row))
  )
    return Promise.resolve()
  return schedule(`summary:${id}`, async () => {
    const at = Date.now()
    try {
      const response = await get(
        `/api/marketplace/cards/${encodeURIComponent(id)}/sales?scope=summary`,
      )
      if (response.status === 404) {
        save(id, { fetchedAt: at, ok: false, notFound: true, averages: {} })
        return
      }
      if (!response.ok) throw new Error('Price unavailable')
      const json = await response.json()
      const averages = parseSummary(json.summary)
      if (!averages) throw new Error('Invalid summary')
      save(id, { fetchedAt: at, ok: true, averages })
    } catch {
      save(
        id,
        row?.ok
          ? { ...row, lastAttempt: at, failed: true }
          : { fetchedAt: at, ok: false, averages: {} },
      )
    }
  })
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
