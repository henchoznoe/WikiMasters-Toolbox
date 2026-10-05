import { getAccountId, onAccountChange } from './account'
import {
  addPull,
  emptyPullStats,
  type PullResult,
  type PullStats,
  parsePullStats,
  validPullResult,
} from './pulls-model'

export const PULL_STATS_PREFIX = 'wm_toolbox_pull_counts_v1:'
export const PULL_RESULT_PREFIX = 'wm_toolbox_pull_result_v1:'
const ACTIVE_PREFIX = 'wm_toolbox_pull_active_v1:'
const fallback = new Map<string, PullStats>()
const results = new Map<string, PullResult>()
const volatileAccounts = new Set<string>()
const activeIds = new Map<string, string>()
const completedIds = new Map<string, string>()
let accountEpoch = 0
onAccountChange(() => {
  accountEpoch += 1
})
let changed: () => void = () => {}
export function setPullsCallback(callback: () => void): void {
  changed = callback
}
export function pullsStorageUnavailable(): boolean {
  return volatileAccounts.has(getAccountId() ?? '')
}
/** Only an observation ID survives reloads; unrevealed cards never enter storage. */
export function activePullId(next?: string | null): string | null {
  const accountId = getAccountId()
  if (!accountId) return null
  const key = ACTIVE_PREFIX + accountId
  if (next !== undefined) {
    if (next === null) activeIds.delete(accountId)
    else activeIds.set(accountId, next)
    try {
      if (next === null) sessionStorage.removeItem(key)
      else
        sessionStorage.setItem(
          key,
          JSON.stringify({
            id: next,
            completed: completedIds.get(accountId) === next,
          }),
        )
    } catch {
      volatileAccounts.add(accountId)
    }
  }
  try {
    const row = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (
      typeof row?.id === 'string' &&
      row.id.length > 0 &&
      row.id.length <= 100
    ) {
      if (row.completed === true) completedIds.set(accountId, row.id)
      return row.id
    }
  } catch {
    volatileAccounts.add(accountId)
  }
  return activeIds.get(accountId) ?? null
}
export function activePullCompleted(): boolean {
  const accountId = getAccountId()
  const id = activePullId()
  return !!accountId && !!id && completedIds.get(accountId) === id
}
export function completeActivePull(id: string): void {
  const accountId = getAccountId()
  if (!accountId || activePullId() !== id) return
  completedIds.set(accountId, id)
  activePullId(id)
}

export function readPullStats(
  accountId = getAccountId(),
  now = Date.now(),
): PullStats {
  if (!accountId) return emptyPullStats('', now)
  let value: unknown = fallback.get(accountId)
  if (!volatileAccounts.has(accountId)) {
    try {
      const raw = localStorage.getItem(PULL_STATS_PREFIX + accountId)
      if (raw) value = JSON.parse(raw)
    } catch {
      volatileAccounts.add(accountId)
    }
  }
  const stats = parsePullStats(value, accountId, now)
  if (!value) fallback.set(accountId, stats)
  return stats
}
function saveStats(stats: PullStats): void {
  fallback.set(stats.accountId, stats)
  try {
    localStorage.setItem(
      PULL_STATS_PREFIX + stats.accountId,
      JSON.stringify(stats),
    )
    volatileAccounts.delete(stats.accountId)
  } catch {
    volatileAccounts.add(stats.accountId)
  }
}
export function readLastPull(): PullResult | null {
  const accountId = getAccountId()
  if (!accountId) return null
  try {
    const row = JSON.parse(
      sessionStorage.getItem(PULL_RESULT_PREFIX + accountId) ?? 'null',
    )
    if (row?.accountId === accountId && validPullResult(row.result))
      return row.result
  } catch {
    volatileAccounts.add(accountId)
  }
  return results.get(accountId) ?? null
}
export function saveLastPull(result: PullResult): void {
  const accountId = getAccountId()
  if (!accountId || !validPullResult(result)) return
  results.set(accountId, result)
  try {
    sessionStorage.setItem(
      PULL_RESULT_PREFIX + accountId,
      JSON.stringify({ accountId, result }),
    )
  } catch {
    volatileAccounts.add(accountId)
  }
}
async function update(
  accountId: string,
  change: (stats: PullStats) => PullStats,
  current: () => boolean = () => true,
): Promise<boolean> {
  const epoch = accountEpoch
  if (typeof navigator === 'undefined' || !navigator.locks) return false
  try {
    return await navigator.locks.request(
      `wm-toolbox-pull-counts:${accountId}`,
      () => {
        if (
          getAccountId() !== accountId ||
          epoch !== accountEpoch ||
          !current()
        )
          return false
        saveStats(change(readPullStats(accountId)))
        changed()
        return true
      },
    )
  } catch {
    return false
  }
}
export async function recordPull(
  result: PullResult,
  current: () => boolean = () => true,
): Promise<boolean> {
  const accountId = getAccountId()
  if (!accountId || !validPullResult(result)) return false
  return update(accountId, stats => addPull(stats, result, Date.now()), current)
}
export async function resetPullStats(): Promise<boolean> {
  const accountId = getAccountId()
  if (!accountId) return false
  return update(accountId, stats => ({
    ...emptyPullStats(accountId, Date.now()),
    // Keep receipts so resetting cannot register the current result a second time.
    receipts: stats.receipts,
  }))
}
