import { type Card, cardVariantKey } from '../cards'
import { mapAuction } from './market-model'
import { RARITIES } from './price-model'

export const SALES_WINDOW = 30 * 86400_000
export const SALES_CAP = 1000
export type SaleSample = {
  auctionId: string
  id: string
  rarity: string
  shiny: boolean
  amount: number
  endedAt: number
}

export function validSample(
  value: unknown,
  now = Date.now(),
): value is SaleSample {
  if (!value || typeof value !== 'object') return false
  const row = value as SaleSample
  return (
    typeof row.auctionId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      row.auctionId,
    ) &&
    typeof row.id === 'string' &&
    !!row.id &&
    row.id.length <= 200 &&
    RARITIES.includes(row.rarity as (typeof RARITIES)[number]) &&
    typeof row.shiny === 'boolean' &&
    Number.isSafeInteger(row.amount) &&
    row.amount > 0 &&
    Number.isFinite(row.endedAt) &&
    row.endedAt <= now &&
    row.endedAt >= now - SALES_WINDOW
  )
}

/** Only explicit native settlement results; asking/bid prices are never samples. */
export function saleSample(raw: unknown, now = Date.now()): SaleSample | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  if (
    typeof source.is_shiny !== 'boolean' ||
    typeof source.snapshot_rarity !== 'string'
  )
    return null
  const row = mapAuction(raw)
  if (row?.status !== 'settled_sold') return null
  const sample = {
    auctionId: row.id.toLowerCase(),
    id: row.card.id,
    rarity: source.snapshot_rarity,
    shiny: source.is_shiny,
    amount: row.final as number,
    endedAt: row.endAt as number,
  }
  return validSample(sample, now) ? sample : null
}

export function mergeSamples(
  previous: SaleSample[],
  incoming: SaleSample[],
  now = Date.now(),
): SaleSample[] {
  const rows = new Map<string, SaleSample>()
  for (const row of [...previous, ...incoming]) {
    if (!validSample(row, now)) continue
    const sample: SaleSample = {
      auctionId: row.auctionId.toLowerCase(),
      id: row.id,
      rarity: row.rarity,
      shiny: row.shiny,
      amount: row.amount,
      endedAt: row.endedAt,
    }
    // Finalized results are immutable. Conflicting observations cannot silently change a price.
    const old = rows.get(sample.auctionId)
    if (old && JSON.stringify(old) !== JSON.stringify(sample)) continue
    rows.set(sample.auctionId, sample)
  }
  return [...rows.values()]
    .sort(
      (a, b) => b.endedAt - a.endedAt || a.auctionId.localeCompare(b.auctionId),
    )
    .slice(0, SALES_CAP)
}

function quantile(values: number[], p: number): number {
  const index = (values.length - 1) * p
  const lo = Math.floor(index),
    hi = Math.ceil(index)
  return values[lo] + (values[hi] - values[lo]) * (index - lo)
}

export function estimateSales(
  samples: SaleSample[],
  card: Pick<Card, 'id' | 'rarity' | 'shiny'>,
  now = Date.now(),
) {
  const rows = mergeSamples([], samples, now).filter(
    row => cardVariantKey(row) === cardVariantKey(card),
  )
  const values = rows.map(row => row.amount).sort((a, b) => a - b)
  const days = new Set(rows.map(row => Math.floor(row.endedAt / 86400_000)))
    .size
  const count = rows.length
  const ready = count >= 5 && days >= 3
  const q1 = ready ? quantile(values, 0.25) : null
  const q3 = ready ? quantile(values, 0.75) : null
  const iqr = q1 === null || q3 === null ? null : q3 - q1
  return {
    count,
    days,
    median: ready ? quantile(values, 0.5) : null,
    range: ready && count >= 10 ? [q1 as number, q3 as number] : null,
    extremes:
      iqr === null
        ? null
        : values.filter(
            value =>
              value < (q1 as number) - 1.5 * iqr ||
              value > (q3 as number) + 1.5 * iqr,
          ).length,
    oldest: rows.at(-1)?.endedAt ?? null,
    newest: rows[0]?.endedAt ?? null,
  }
}
