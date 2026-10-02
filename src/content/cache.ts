import { getAccountId } from './account'

const DAY = 86400_000
export const cachePolicies = {
  collection: {
    prefix: 'wm_toolbox_collection_v1:',
    label: 'Collection',
    freshness: 5 * 60_000,
    retention: 7 * DAY,
    maxEntries: 10,
    maxBytes: 16 * 1024 * 1024,
    account: true,
    time: 'updatedAt',
  },
  prices: {
    prefix: 'wm_toolbox_price_v1_',
    label: 'Prices · shared',
    freshness: DAY,
    retention: 30 * DAY,
    maxEntries: 1000,
    maxBytes: 2 * 1024 * 1024,
    account: false,
    time: 'fetchedAt',
  },
  history: {
    prefix: 'wm_toolbox_price_history_v1_',
    label: 'Price observations · shared',
    freshness: DAY,
    retention: 90 * DAY,
    maxEntries: 300,
    maxBytes: 8 * 1024 * 1024,
    account: false,
    time: 'history',
  },
} as const
export type CacheKind = keyof typeof cachePolicies
const listeners = new Set<(kind: CacheKind) => void>()
export function onCacheChange(listener: (kind: CacheKind) => void): void {
  listeners.add(listener)
}

type CacheRow = { key: string; bytes: number; at: number }
function rows(kind: CacheKind): CacheRow[] {
  const policy = cachePolicies[kind]
  const result: CacheRow[] = []
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.key(i),
    )
    for (const key of keys) {
      if (!key?.startsWith(policy.prefix)) continue
      const raw = localStorage.getItem(key) ?? ''
      let at = 0
      try {
        const value = JSON.parse(raw)
        at =
          policy.time === 'history'
            ? Math.max(
                0,
                ...Object.values(value).flatMap(items =>
                  Array.isArray(items)
                    ? items.map(row => Number(row?.at) || 0)
                    : [],
                ),
              )
            : Number(value?.[policy.time]) ||
              Number(value?.startedAt) ||
              Number(value?.storedAt) ||
              0
      } catch {
        /* Invalid cache entries are cleaned without reading other site data. */
      }
      result.push({ key, bytes: (key.length + raw.length) * 2, at })
    }
  } catch {
    /* Storage unavailable. */
  }
  return result.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key))
}
export function cleanCache(kind: CacheKind): void {
  const policy = cachePolicies[kind]
  let bytes = 0
  let count = 0
  for (const row of rows(kind)) {
    if (
      row.at <= 0 ||
      row.at > Date.now() ||
      Date.now() - row.at > policy.retention ||
      count >= policy.maxEntries ||
      bytes + row.bytes > policy.maxBytes
    ) {
      try {
        localStorage.removeItem(row.key)
      } catch {
        /* Storage unavailable. */
      }
    } else {
      count += 1
      bytes += row.bytes
    }
  }
}
export function writeCache(
  kind: CacheKind,
  key: string,
  value: unknown,
): boolean {
  const policy = cachePolicies[kind]
  if (!key.startsWith(policy.prefix)) return false
  try {
    const raw = JSON.stringify(value)
    if ((key.length + raw.length) * 2 > policy.maxBytes) return false
    localStorage.setItem(key, raw)
    cleanCache(kind)
    return localStorage.getItem(key) !== null
  } catch {
    return false
  }
}
export function inspectCache(kind: CacheKind): {
  count: number
  bytes: number
  updatedAt: number
} {
  cleanCache(kind)
  const policy = cachePolicies[kind]
  const visible = rows(kind).filter(
    row => !policy.account || row.key === policy.prefix + getAccountId(),
  )
  return {
    count: visible.length,
    bytes: visible.reduce((sum, row) => sum + row.bytes, 0),
    updatedAt: visible[0]?.at ?? 0,
  }
}
export function clearCache(kind: CacheKind): void {
  const policy = cachePolicies[kind]
  for (const row of rows(kind)) {
    if (policy.account && row.key !== policy.prefix + getAccountId()) continue
    try {
      localStorage.removeItem(row.key)
    } catch {
      /* Storage unavailable. */
    }
  }
  for (const listener of listeners) listener(kind)
}
export function cleanCaches(): void {
  for (const kind of Object.keys(cachePolicies) as CacheKind[]) cleanCache(kind)
}
