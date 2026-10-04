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
