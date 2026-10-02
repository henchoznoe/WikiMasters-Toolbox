import { getAccountId } from './account'
import { writeCache } from './cache'
import { mergeSamples, type SaleSample } from './sales-model'

export const SALES_PREFIX = 'wm_toolbox_sales_sample_v1:'
export function readSaleSamples(): SaleSample[] {
  const owner = getAccountId()
  if (!owner) return []
  try {
    const data = JSON.parse(localStorage.getItem(SALES_PREFIX + owner) ?? '{}')
    return data.accountId === owner && Array.isArray(data.rows)
      ? mergeSamples([], data.rows)
      : []
  } catch {
    return []
  }
}

export function observeSaleSamples(incoming: SaleSample[]): void {
  const owner = getAccountId()
  if (!owner || !incoming.length) return
  const before = readSaleSamples()
  const rows = mergeSamples(before, incoming)
  if (JSON.stringify(rows) === JSON.stringify(before)) return
  writeCache('sales', SALES_PREFIX + owner, {
    accountId: owner,
    observedAt: Date.now(),
    rows,
  })
}
