export const RARITIES = ['C', 'PC', 'R', 'SR', 'UR', 'L'] as const
export const PRICE_TTL = 24 * 60 * 60 * 1000
export const RETRY_DELAY = 60_000
export type Summary = Record<string, number>

export function parseSummary(raw: unknown): Summary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const result: Summary = {}
  for (const rarity of RARITIES) {
    const row = (raw as Record<string, unknown>)[rarity]
    if (row === undefined || row === null) continue
    if (typeof row !== 'object' || Array.isArray(row)) return null
    const value = (row as Record<string, unknown>).average
    if (value === null || value === '') continue
    if (typeof value === 'string' && !value.trim()) return null
    if (typeof value !== 'number' && typeof value !== 'string') return null
    const average = Number(value)
    if (!Number.isFinite(average) || average < 0) return null
    result[rarity] = average
  }
  return result
}

export type SaleAnalysis = {
  count: number
  oldest: number | null
  newest: number | null
  median: number | null
  low: number | null
  high: number | null
  outliers: number
  confidence: 'insufficient' | 'low' | 'moderate'
}

export function quantile(sorted: number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction
  const low = Math.floor(index)
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
}

// Estimate only actual settled sales of the requested rarity within the last 30 days.
// The endpoint's coverage is unknown: this is an accessible sample, not total market volume.
export function analyzeSales(
  raw: unknown,
  rarity: string,
  now = Date.now(),
): SaleAnalysis {
  const seen = new Set<string>()
  const sales: { price: number; at: number }[] = []
  if (Array.isArray(raw)) {
    for (const row of raw.slice(0, 2000)) {
      if (!row || typeof row !== 'object' || row.rarity !== rarity) continue
      if (typeof row.id !== 'string' || !row.id || seen.has(row.id)) continue
      if (typeof row.settled_at !== 'string') continue
      const at = Date.parse(row.settled_at)
      const price = row.final_price
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0)
        continue
      if (!Number.isFinite(at) || at > now || at < now - 30 * 86400_000)
        continue
      seen.add(row.id)
      sales.push({ price, at })
    }
  }
  const values = sales.map(sale => sale.price).sort((a, b) => a - b)
  const count = values.length
  const q1 = count ? quantile(values, 0.25) : 0
  const q3 = count ? quantile(values, 0.75) : 0
  const iqr = q3 - q1
  const median = count >= 5 ? quantile(values, 0.5) : null
  const outliers = values.filter(
    value => value < q1 - 1.5 * iqr || value > q3 + 1.5 * iqr,
  ).length
  return {
    count,
    oldest: count ? Math.min(...sales.map(sale => sale.at)) : null,
    newest: count ? Math.max(...sales.map(sale => sale.at)) : null,
    median,
    low: count >= 10 ? q1 : null,
    high: count >= 10 ? q3 : null,
    outliers,
    confidence:
      count < 5
        ? 'insufficient'
        : count >= 20 &&
            iqr <= Math.max(1, median ?? 0) &&
            outliers / count <= 0.1
          ? 'moderate'
          : 'low',
  }
}

export type Observation = { at: number; average: number | null }
export function appendObservation(
  history: Observation[],
  point: Observation,
): Observation[] {
  const cutoff = point.at - 90 * 86400_000
  const filtered = history.filter(
    row =>
      row.at >= cutoff &&
      row.at <= point.at &&
      Number.isFinite(row.at) &&
      (row.average === null ||
        (Number.isFinite(row.average) && row.average >= 0)),
  )
  const day = Math.floor(point.at / 86400_000)
  return [
    ...filtered.filter(row => Math.floor(row.at / 86400_000) !== day),
    point,
  ].slice(-90)
}
