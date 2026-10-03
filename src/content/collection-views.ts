import { getAccountId, onAccountChange } from './account'
import {
  type CollectionQuery,
  defaultCollectionQuery,
  normalizeQuery,
} from './collection-query'

export const VIEWS_PREFIX = 'wm_toolbox_views_v1:'
export type SavedView = {
  name: string
  query: CollectionQuery
  savedAt: number
  syncedAt: number
}
type Preferences = {
  version: 1
  accountId: string
  compact: boolean
  views: SavedView[]
}
let compact = false
let views: SavedView[] = []
let error: string | null = null
const listeners = new Set<() => void>()
export function onViewsChange(listener: () => void): void {
  listeners.add(listener)
}
function notify(): void {
  for (const listener of listeners) listener()
}
function restore(): void {
  compact = false
  views = []
  error = null
  const owner = getAccountId()
  if (owner) {
    try {
      const raw = localStorage.getItem(VIEWS_PREFIX + owner)
      const data =
        raw && raw.length <= 100_000 ? (JSON.parse(raw) as Preferences) : null
      if (
        data?.version === 1 &&
        data.accountId === owner &&
        typeof data.compact === 'boolean' &&
        Array.isArray(data.views) &&
        data.views.length <= 30
      ) {
        compact = data.compact
        for (const view of data.views) {
          const query = normalizeQuery(view?.query)
          if (
            query &&
            typeof view.name === 'string' &&
            view.name.trim() &&
            view.name.length <= 60 &&
            Number.isFinite(view.savedAt) &&
            view.savedAt > 0 &&
            view.savedAt <= Date.now() &&
            Number.isFinite(view.syncedAt) &&
            view.syncedAt >= 0 &&
            view.syncedAt <= Date.now() &&
            !views.some(v => v.name === view.name)
          )
            views.push({
              name: view.name,
              query,
              savedAt: view.savedAt,
              syncedAt: view.syncedAt,
            })
        }
      }
    } catch {
      error = 'Views unavailable'
    }
  }
  notify()
}
onAccountChange(restore)
export function syncViewsFromStorage(key: string | null): void {
  if (key === null || key === VIEWS_PREFIX + getAccountId()) restore()
}
export function getViewPreferences() {
  return { compact, views: structuredClone(views), error }
}
function persist(nextCompact: boolean, nextViews: SavedView[]): boolean {
  const owner = getAccountId()
  if (!owner) return false
  try {
    localStorage.setItem(
      VIEWS_PREFIX + owner,
      JSON.stringify({
        version: 1,
        accountId: owner,
        compact: nextCompact,
        views: nextViews,
      }),
    )
    compact = nextCompact
    views = nextViews
    error = null
    notify()
    return true
  } catch {
    error = 'Not saved locally'
    notify()
    return false
  }
}
export function setCompact(value: boolean): void {
  persist(value, views)
}
export function saveView(
  name: string,
  query: CollectionQuery,
  syncedAt: number,
): boolean {
  const clean = name.trim()
  const normalized = normalizeQuery(query)
  if (
    !clean ||
    clean.length > 60 ||
    !normalized ||
    !Number.isFinite(syncedAt) ||
    syncedAt < 0 ||
    syncedAt > Date.now()
  )
    return false
  const next = views.filter(view => view.name !== clean)
  if (next.length >= 30) {
    error = '30 views maximum'
    notify()
    return false
  }
  return persist(compact, [
    ...next,
    { name: clean, query: normalized, savedAt: Date.now(), syncedAt },
  ])
}
export function deleteView(name: string): void {
  persist(
    compact,
    views.filter(view => view.name !== name),
  )
}
export function markViewSynced(
  name: string,
  query: CollectionQuery,
  at: number,
): void {
  const view = views.find(view => view.name === name)
  if (
    view &&
    at > view.syncedAt &&
    at <= Date.now() &&
    JSON.stringify(view.query) === JSON.stringify(query)
  )
    persist(
      compact,
      views.map(v => (v.name === name ? { ...v, syncedAt: at } : v)),
    )
}
export { defaultCollectionQuery }
