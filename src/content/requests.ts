import { onAccountChange, setAccountId } from './account'

const MAX_REQUESTS = 200
let notify: () => void = () => {}
export function setRequestCallback(callback: () => void): void {
  notify = callback
}

type Job = {
  key: string
  run: () => Promise<void>
  resolve: () => void
  promise: Promise<void>
  signal?: AbortSignal
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
export function requestLimit(): string {
  const now = Date.now()
  requests = requests.filter(at => at > now - 3600_000)
  return cooldown > now
    ? `Server pause · ${Math.ceil((cooldown - now) / 1000)} s`
    : requests.length >= MAX_REQUESTS
      ? '200 requests / hour reached'
      : ''
}
export function scheduleRead(
  key: string,
  run: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const existing = jobs.get(key)
  if (existing) return existing.promise
  if (signal?.aborted || queue.length >= 200 || requestLimit())
    return Promise.resolve()
  let resolve = () => {}
  const promise = new Promise<void>(done => {
    resolve = done
  })
  const stop = (): void => {
    const index = queue.indexOf(job)
    if (index < 0) return
    queue.splice(index, 1)
    if (jobs.get(key) === job) jobs.delete(key)
    job.resolve()
  }
  const done = resolve
  const job: Job = {
    key,
    run,
    promise,
    signal,
    resolve: () => {
      signal?.removeEventListener('abort', stop)
      done()
    },
  }
  signal?.addEventListener('abort', stop, { once: true })
  jobs.set(key, job)
  queue.push(job)
  pump()
  return promise
}
function pump(): void {
  if (running || timer || !queue.length) return
  if (requestLimit()) {
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
      if (jobs.get(job.key) === job) jobs.delete(job.key)
      running = false
      job.resolve()
      notify()
      pump()
    })
}

let scope = new AbortController()
let epoch = 0
export function getRequestEpoch(): number {
  return epoch
}
export function cancelRequests(): void {
  epoch += 1
  scope.abort(new Error('Page or account changed'))
  scope = new AbortController()
  if (timer) clearTimeout(timer)
  timer = null
  for (const job of queue.splice(0)) {
    jobs.delete(job.key)
    job.resolve()
  }
  // Active jobs retain their own scope and cannot update a later page.
  jobs.clear()
  reads.clear()
}
onAccountChange(cancelRequests)

export async function requestData(
  url: string,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<{ response: Response; json: unknown }> {
  const request = new AbortController()
  const current = scope.signal
  const sources = [current, ...(signal ? [signal] : [])]
  const abort = (): void => request.abort(new Error('Request stopped'))
  for (const source of sources) {
    if (source.aborted) abort()
    source.addEventListener('abort', abort, { once: true })
  }
  const timeout = setTimeout(
    () => request.abort(new Error('Request timed out')),
    12_000,
  )
  try {
    if (request.signal.aborted) throw request.signal.reason
    const operation = async (): Promise<{
      response: Response
      json: unknown
    }> => {
      const response = await fetch(url, {
        ...init,
        credentials: 'include',
        signal: request.signal,
      })
      if (request.signal.aborted) throw request.signal.reason
      if (response.status >= 500) cooldown = Date.now() + 30_000
      if (response.status === 429) {
        const value = response.headers.get('Retry-After')
        const seconds = Number(value)
        const delay =
          value && !Number.isFinite(seconds)
            ? Date.parse(value) - Date.now()
            : seconds * 1000
        cooldown =
          Date.now() +
          Math.min(
            300_000,
            Math.max(60_000, Number.isFinite(delay) ? delay : 60_000),
          )
      }
      saveBudget()
      if (response.status === 401) {
        setAccountId(null)
        throw new Error('Session expired')
      }
      // The timeout covers decoding too. Recheck scope when a fetch implementation ignores abort.
      let json: unknown
      try {
        json = await response.json()
      } catch {
        if (response.ok)
          throw new Error('Game response changed; reload the page')
        json = null
      }
      if (request.signal.aborted) throw request.signal.reason
      return { response, json }
    }
    let rejectAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(request.signal.reason)
      request.signal.addEventListener('abort', rejectAbort, { once: true })
    })
    try {
      return await Promise.race([operation(), aborted])
    } finally {
      request.signal.removeEventListener('abort', rejectAbort)
    }
  } finally {
    clearTimeout(timeout)
    for (const source of sources) source.removeEventListener('abort', abort)
  }
}

type Read = {
  promise: Promise<Record<string, unknown>>
  controller: AbortController
  clients: Set<object>
}
let readSequence = 0
const reads = new Map<string, Read>()
export function requestJson(
  url: string,
  signal?: AbortSignal,
  onRetry?: () => void,
): Promise<Record<string, unknown>> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  let reading = reads.get(url)
  if (reading?.controller.signal.aborted) {
    reads.delete(url)
    reading = undefined
  }
  if (!reading) {
    const controller = new AbortController()
    const promise = readJson(url, controller.signal, onRetry)
    reading = { promise, controller, clients: new Set() }
    reads.set(url, reading)
    const current = reading
    void promise
      .finally(() => {
        if (reads.get(url) === current) reads.delete(url)
      })
      .catch(() => {})
  }
  const current = reading
  const client = {}
  current.clients.add(client)
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', stop)
      current.clients.delete(client)
      if (!current.clients.size)
        current.controller.abort(new Error('Read stopped'))
    }
    const stop = (): void => {
      finish()
      reject(signal?.reason ?? new Error('Stopped'))
    }
    signal?.addEventListener('abort', stop, { once: true })
    current.promise.then(
      value => {
        if (!signal?.aborted) resolve(value)
        finish()
      },
      cause => {
        reject(cause)
        finish()
      },
    )
  })
}
export class RequestAdmissionError extends Error {}
export async function requestReadData(
  url: string,
  signal?: AbortSignal,
  onRetry?: () => void,
): Promise<{ response: Response; json: unknown }> {
  const expected = epoch
  const sequence = ++readSequence
  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted || expected !== epoch) throw new Error('Read stopped')
    let result: { response: Response; json: unknown } | undefined
    let transportFailure = false
    await scheduleRead(
      `read:${expected}:${sequence}:${url}`,
      async () => {
        if (signal?.aborted || expected !== epoch) return
        try {
          result = await requestData(url, signal)
        } catch (cause) {
          failure = cause
          transportFailure = !(
            cause instanceof Error &&
            /^(Session|Game response)/.test(cause.message)
          )
        }
      },
      signal,
    )
    if (signal?.aborted || expected !== epoch) throw new Error('Read stopped')
    if (result) return result
    if (!transportFailure)
      throw (
        failure ??
        new RequestAdmissionError(requestLimit() || 'Read queue is full')
      )
    if (attempt === 2 || requestLimit()) break
    onRetry?.()
  }
  throw failure ?? new Error('Read unavailable')
}
async function readJson(
  url: string,
  signal: AbortSignal,
  onRetry?: () => void,
): Promise<Record<string, unknown>> {
  const { response, json } = await requestReadData(url, signal, onRetry)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new Error('Game response changed; reload the page')
  return json as Record<string, unknown>
}

let writeSequence = 0
/** Writes share scheduling and timeout, but are never deduplicated or retried. */
export async function requestWrite(
  url: string,
  signal: AbortSignal,
  init: RequestInit,
): Promise<{ response: Response; json: unknown }> {
  const expected = epoch
  let result: { response: Response; json: unknown } | undefined
  let failure: unknown
  await scheduleRead(
    `write:${++writeSequence}`,
    async () => {
      if (signal.aborted || expected !== epoch) return
      try {
        result = await requestData(url, signal, { ...init, method: 'POST' })
      } catch (cause) {
        failure = cause
      }
    },
    signal,
  )
  if (failure) throw failure
  if (!result) throw new Error(requestLimit() || 'Write stopped before sending')
  return result
}

export function serverPauseMs(): number {
  return Math.max(0, cooldown - Date.now())
}
