import {
  type Card,
  cardVariantKey,
  mapOwnedCard,
  type OwnedCard,
} from '../cards'
import { getAccountId, onAccountChange, setAccountId } from './account'

export const COLLECTION_PREFIX = 'wm_toolbox_collection_v1:'
const PAGE_SIZE = 50
const MAX_PAGES = 2000
const FRESH_FOR = 5 * 60_000
const RESUME_FOR = 15 * 60_000

type Snapshot = {
  accountId: string
  pages: OwnedCard[][]
  total: number | null
  complete: boolean
  updatedAt: number
  startedAt: number
  enabled: boolean
}
export type CollectionState = {
  status: 'idle' | 'loading' | 'paused' | 'error' | 'complete' | 'stale'
  cards: readonly OwnedCard[]
  pages: number
  total: number | null
  updatedAt: number
  error: string | null
  persistent: boolean
  retrying: boolean
}
let snapshot: Snapshot | null = null
let status: CollectionState['status'] = 'idle'
let error: string | null = null
let persistent = true
let retrying = false
let controller: AbortController | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

export function onCollectionChange(listener: () => void): void {
  listeners.add(listener)
}
function notify(): void {
  for (const listener of listeners) listener()
}
function emptySnapshot(accountId: string, enabled = false): Snapshot {
  return {
    accountId,
    pages: [],
    total: null,
    complete: false,
    updatedAt: 0,
    startedAt: 0,
    enabled,
  }
}
function persist(): void {
  if (!snapshot) return
  try {
    localStorage.setItem(
      COLLECTION_PREFIX + snapshot.accountId,
      JSON.stringify(snapshot),
    )
    persistent = true
  } catch {
    persistent = false
  }
}
function validStoredCopy(value: unknown, owner: string): value is OwnedCard {
  if (!value || typeof value !== 'object') return false
  const card = value as OwnedCard
  return (
    typeof card.id === 'string' &&
    !!card.id &&
    typeof card.copyId === 'string' &&
    !!card.copyId &&
    card.ownerId === owner &&
    typeof card.title === 'string' &&
    (card.rarity === null || typeof card.rarity === 'string') &&
    typeof card.shiny === 'boolean' &&
    typeof card.starred === 'boolean' &&
    Array.isArray(card.tagIds) &&
    card.tagIds.every(id => typeof id === 'string') &&
    (card.obtainedAt === null || typeof card.obtainedAt === 'string')
  )
}
function restore(): void {
  controller?.abort()
  controller = null
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  error = null
  retrying = false
  persistent = true
  const id = getAccountId()
  snapshot = id ? emptySnapshot(id) : null
  status = 'idle'
  if (id) {
    try {
      const raw = localStorage.getItem(COLLECTION_PREFIX + id)
      const saved = raw ? (JSON.parse(raw) as Snapshot) : null
      if (
        saved?.accountId === id &&
        Array.isArray(saved.pages) &&
        saved.pages.length <= MAX_PAGES &&
        saved.pages.every(
          page =>
            Array.isArray(page) &&
            page.length <= PAGE_SIZE &&
            page.every(card => validStoredCopy(card, id)),
        ) &&
        (saved.total === null ||
          (Number.isSafeInteger(saved.total) && saved.total >= 0)) &&
        typeof saved.complete === 'boolean' &&
        typeof saved.enabled === 'boolean' &&
        Number.isFinite(saved.updatedAt) &&
        Number.isFinite(saved.startedAt)
      ) {
        const copies = saved.pages.flat()
        if (
          new Set(copies.map(card => card.copyId)).size !== copies.length ||
          (saved.complete && saved.total !== copies.length)
        )
          throw new Error('Invalid stored collection')
        snapshot = saved
        status = saved.complete
          ? 'complete'
          : saved.pages.length
            ? 'paused'
            : 'idle'
        if (Date.now() - saved.startedAt > RESUME_FOR && !saved.complete) {
          snapshot = emptySnapshot(id, saved.enabled)
          status = 'stale'
        }
        if (saved.complete && Date.now() - saved.updatedAt > FRESH_FOR)
          status = 'stale'
      }
    } catch {
      /* Corrupt or unavailable storage: start a fresh index. */
    }
  }
  notify()
}
onAccountChange(restore)

export function getCollectionState(): CollectionState {
  return {
    status:
      status === 'complete' &&
      snapshot &&
      Date.now() - snapshot.updatedAt > FRESH_FOR
        ? 'stale'
        : status,
    cards: snapshot?.pages.flat() ?? [],
    pages: snapshot?.pages.length ?? 0,
    total: snapshot?.total ?? null,
    updatedAt: snapshot?.updatedAt ?? 0,
    error,
    persistent,
    retrying,
  }
}
export function getOwnedCopy(copyId: string): OwnedCard | null {
  // Only an authoritative, fresh index can feed an action on a possession.
  if (
    status !== 'complete' ||
    !snapshot ||
    Date.now() - snapshot.updatedAt > FRESH_FOR
  )
    return null
  return snapshot?.pages.flat().find(card => card.copyId === copyId) ?? null
}
export function getOwnedVariants(): Map<string, OwnedCard[]> {
  const groups = new Map<string, OwnedCard[]>()
  for (const card of getCollectionState().cards) {
    const key = cardVariantKey(card)
    groups.set(key, [...(groups.get(key) ?? []), card])
  }
  return groups
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const stop = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    }, ms)
    signal.addEventListener('abort', stop, { once: true })
  })
}
async function readJson(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (signal.aborted) throw signal.reason
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const request = new AbortController()
    const abort = (): void => request.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => request.abort(), 15_000)
    let waitMs = 500 * 2 ** attempt
    try {
      const response = await fetch(url, {
        credentials: 'include',
        signal: request.signal,
      })
      if (response.status === 401) {
        setAccountId(null)
        throw new Error('Session expired')
      }
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500)
          throw new Error(`HTTP ${response.status}`)
        const retryAfter = Number(response.headers.get('retry-after'))
        if (Number.isFinite(retryAfter) && retryAfter > 0)
          waitMs = Math.min(8000, retryAfter * 1000)
        throw new Error(`The game is busy (HTTP ${response.status})`)
      }
      const json: unknown = await response.json()
      if (!json || typeof json !== 'object' || Array.isArray(json))
        throw new Error('Invalid collection response')
      retrying = false
      return json as Record<string, unknown>
    } catch (cause) {
      if (signal.aborted) throw signal.reason
      const message = cause instanceof Error ? cause.message : 'Network error'
      if (
        attempt === 2 ||
        /^HTTP 4/.test(message) ||
        message === 'Invalid collection response'
      )
        throw cause
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    retrying = true
    notify()
    await delay(waitMs, signal)
  }
  throw new Error('Collection unavailable')
}
async function readTotal(signal: AbortSignal): Promise<number> {
  const json = await readJson('/api/my-collection/stats', signal)
  const total =
    json.total === null || json.total === undefined ? NaN : Number(json.total)
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error('Collection total unavailable')
  return total
}
async function readPage(
  page: number,
  owner: string,
  signal: AbortSignal,
): Promise<OwnedCard[]> {
  const json = await readJson(
    `/api/my-collection?sort=added&page=${page}&stats=0`,
    signal,
  )
  if (!Array.isArray(json.collection) || json.collection.length > PAGE_SIZE)
    throw new Error('Invalid collection page')
  const cards = json.collection.map(mapOwnedCard)
  if (cards.some(card => !card || card.ownerId !== owner))
    throw new Error('Possession identity unavailable')
  return cards as OwnedCard[]
}
function fingerprint(cards: readonly OwnedCard[]): string {
  return JSON.stringify(
    cards.map(card => [
      card.copyId,
      card.id,
      card.rarity,
      card.shiny,
      card.starred,
      card.tagIds,
    ]),
  )
}

export function stopCollectionLoad(): void {
  controller?.abort(new Error('Loading stopped'))
}

export function observeCollection(
  cards: readonly Card[],
  total?: unknown,
): void {
  if (!snapshot?.complete || status !== 'complete') return
  const indexed = new Map(
    snapshot.pages.flat().map(card => [card.copyId, card]),
  )
  const totalChanged =
    total !== null &&
    total !== undefined &&
    Number.isSafeInteger(Number(total)) &&
    Number(total) !== snapshot.total
  const copiesChanged = cards.some(card => {
    if (!card.copyId) return false
    const owned = indexed.get(card.copyId)
    return !owned || cardVariantKey(owned) !== cardVariantKey(card)
  })
  if (totalChanged || copiesChanged) invalidateCollection()
}
export function invalidateCollection(): void {
  const id = getAccountId()
  if (!id) return
  const enabled = snapshot?.enabled ?? false
  controller?.abort(new Error('Collection changed'))
  controller = null
  snapshot = emptySnapshot(id, enabled)
  status = 'stale'
  error = null
  retrying = false
  persist()
  notify()
  if (enabled) {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void loadCollection()
    }, 1000)
  }
}
export function refreshCollectionIfNeeded(force = false): void {
  if (!snapshot?.enabled || controller) return
  if (force || Date.now() - snapshot.updatedAt > FRESH_FOR) {
    if (snapshot.complete || status === 'stale') void loadCollection(true)
  }
}
export function syncCollectionFromStorage(key: string | null): void {
  if (key !== null && key !== COLLECTION_PREFIX + getAccountId()) return
  // A write from another tab makes an in-progress traversal unsafe.
  restore()
}

export async function loadCollection(fresh = false): Promise<void> {
  const id = getAccountId()
  if (!id || controller) return
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  if (
    !snapshot ||
    snapshot.accountId !== id ||
    fresh ||
    snapshot.complete ||
    Date.now() - snapshot.startedAt > RESUME_FOR
  )
    snapshot = emptySnapshot(id, true)
  snapshot.enabled = true
  if (!snapshot.startedAt) snapshot.startedAt = Date.now()
  const current = snapshot
  const run = new AbortController()
  controller = run
  status = 'loading'
  error = null
  retrying = false
  notify()
  try {
    const total = await readTotal(run.signal)
    if (run.signal.aborted || snapshot !== current || getAccountId() !== id)
      return
    if (current.pages.length && current.total !== total) current.pages = []
    current.total = total
    if (current.pages.length) {
      const first = await readPage(0, id, run.signal)
      if (fingerprint(first) !== fingerprint(current.pages[0]))
        current.pages = []
    }
    const seen = new Set(current.pages.flat().map(card => card.copyId))
    const targetPages = Math.ceil(total / PAGE_SIZE)
    if (targetPages > MAX_PAGES)
      throw new Error('Collection exceeds the local index limit')
    for (let page = current.pages.length; page < targetPages; page += 1) {
      const cards = await readPage(page, id, run.signal)
      if (run.signal.aborted || snapshot !== current || getAccountId() !== id)
        return
      const expected = Math.min(PAGE_SIZE, total - page * PAGE_SIZE)
      if (
        cards.length !== expected ||
        cards.some(card => seen.has(card.copyId)) ||
        new Set(cards.map(card => card.copyId)).size !== cards.length
      ) {
        current.pages = []
        throw new Error('Collection changed while loading; retry to refresh')
      }
      for (const card of cards) seen.add(card.copyId)
      current.pages.push(cards)
      current.updatedAt = Date.now()
      persist()
      notify()
      if (page + 1 < targetPages) await delay(150, run.signal)
    }
    // Offset pagination has no snapshot token: verify boundaries before claiming completeness.
    const finalTotal = await readTotal(run.signal)
    const first = total ? await readPage(0, id, run.signal) : []
    if (run.signal.aborted || snapshot !== current || getAccountId() !== id)
      return
    if (
      finalTotal !== total ||
      (total && fingerprint(first) !== fingerprint(current.pages[0]))
    ) {
      current.pages = []
      throw new Error('Collection changed while loading; retry to refresh')
    }
    current.complete = true
    current.updatedAt = Date.now()
    status = 'complete'
  } catch (cause) {
    if (snapshot !== current || getAccountId() !== id) return
    status = run.signal.aborted ? 'paused' : 'error'
    error = run.signal.aborted
      ? null
      : cause instanceof Error
        ? cause.message
        : 'Collection unavailable'
  } finally {
    if (controller === run) {
      controller = null
      retrying = false
      persist()
      notify()
    }
  }
}
