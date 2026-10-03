import { getAccountId } from './account'

type PackStats = {
  day: string
  dailyReset: boolean
  packs: number
  counts: Record<string, number>
}

export const STATS_PREFIX = 'wm_toolbox_pack_stats_v2:'
const RARITIES = ['L', 'UR', 'SR', 'R', 'PC', 'C', 'Other'] as const

export function statsStorageKey(accountId: string): string {
  return `${STATS_PREFIX}${accountId}`
}

function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function emptyStats(dailyReset = false): PackStats {
  return {
    day: localDay(),
    dailyReset,
    packs: 0,
    counts: Object.fromEntries(RARITIES.map(rarity => [rarity, 0])),
  }
}

function writeStats(accountId: string, stats: PackStats): void {
  try {
    localStorage.setItem(statsStorageKey(accountId), JSON.stringify(stats))
  } catch {
    /* Storage unavailable. */
  }
}

export function readStats(accountId = getAccountId()): PackStats {
  if (!accountId) return emptyStats()
  try {
    const raw = localStorage.getItem(statsStorageKey(accountId))
    if (!raw) return emptyStats()
    const parsed = JSON.parse(raw) as Partial<PackStats>
    const stats: PackStats = {
      day: typeof parsed.day === 'string' ? parsed.day : localDay(),
      dailyReset: parsed.dailyReset === true,
      packs: Math.max(0, Math.floor(Number(parsed.packs) || 0)),
      counts: Object.fromEntries(
        RARITIES.map(rarity => [
          rarity,
          Math.max(0, Math.floor(Number(parsed.counts?.[rarity]) || 0)),
        ]),
      ),
    }
    if (stats.dailyReset && stats.day !== localDay()) {
      const reset = emptyStats(true)
      writeStats(accountId, reset)
      return reset
    }
    return stats
  } catch {
    return emptyStats()
  }
}

async function updateStats(
  change: (stats: PackStats) => PackStats,
  accountId = getAccountId(),
): Promise<void> {
  if (!accountId) return
  const update = (): void => {
    writeStats(accountId, change(readStats(accountId)))
    renderStats()
    scheduleDailyReset()
  }
  if (navigator.locks)
    await navigator.locks.request(`wm-toolbox-pack-stats:${accountId}`, update)
  else update()
}

export async function recordPack(
  cards: unknown[],
  accountId = getAccountId(),
): Promise<void> {
  if (!cards.length) return
  await updateStats(stats => {
    stats.packs += 1
    for (const value of cards) {
      const rarity =
        value && typeof value === 'object' && 'rarity' in value
          ? (value as { rarity?: unknown }).rarity
          : null
      const key =
        typeof rarity === 'string' &&
        RARITIES.includes(rarity as (typeof RARITIES)[number])
          ? rarity
          : 'Other'
      stats.counts[key] += 1
    }
    return stats
  }, accountId)
}

let dailyResetTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleDailyReset(): void {
  if (dailyResetTimer) clearTimeout(dailyResetTimer)
  dailyResetTimer = null
  const accountId = getAccountId()
  if (!accountId || !readStats(accountId).dailyReset) return
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  dailyResetTimer = setTimeout(
    () => {
      readStats(accountId)
      renderStats()
      scheduleDailyReset()
    },
    Math.max(1_000, next.getTime() - now.getTime() + 100),
  )
}

export function renderStats(): void {
  const container = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLElement>('[data-wm-toolbox-stats]')
  if (!container) return
  if (!getAccountId()) {
    const message = document.createElement('p')
    message.className = 'wm-stats-pending'
    message.textContent = 'En attente de votre compte WikiMasters…'
    container.replaceChildren(message)
    return
  }
  const stats = readStats()
  const total = Object.values(stats.counts).reduce(
    (sum, count) => sum + count,
    0,
  )
  const title = document.createElement('h3')
  title.className = 'wm-stats-title'
  title.textContent = 'Statistiques des paquets'
  const summary = document.createElement('p')
  summary.className = 'wm-stats-summary'
  summary.textContent = `${stats.packs} paquet${stats.packs === 1 ? '' : 's'} · ${total} carte${total === 1 ? '' : 's'}`
  const head = document.createElement('div')
  head.className = 'wm-stats-head'
  head.append(title, summary)
  const grid = document.createElement('div')
  grid.className = 'wm-stats-grid'
  for (const rarity of RARITIES) {
    if (rarity === 'Other' && stats.counts.Other === 0) continue
    const tile = document.createElement('div')
    tile.className = 'wm-stat'
    tile.dataset.rarity = rarity.toLowerCase()
    const label = document.createElement('span')
    label.className = 'wm-stat-label'
    label.textContent = rarity === 'Other' ? 'Autres' : rarity
    const count = document.createElement('span')
    count.className = 'wm-stat-count'
    count.textContent = String(stats.counts[rarity])
    tile.append(label, count)
    grid.append(tile)
  }
  const controls = document.createElement('div')
  controls.className = 'wm-stats-controls'
  const dailyLabel = document.createElement('label')
  dailyLabel.className = 'wm-setting-toggle'
  dailyLabel.title =
    'Réinitialisation à minuit local, ou à la prochaine visite si Chrome est fermé'
  const dailyToggle = document.createElement('input')
  dailyToggle.type = 'checkbox'
  dailyToggle.checked = stats.dailyReset
  dailyToggle.addEventListener('change', () => {
    void updateStats(current => ({
      ...current,
      day: localDay(),
      dailyReset: dailyToggle.checked,
    }))
  })
  const dailyTrack = document.createElement('span')
  dailyTrack.className = 'wm-switch'
  dailyTrack.setAttribute('aria-hidden', 'true')
  dailyLabel.append(
    dailyToggle,
    dailyTrack,
    document.createTextNode('Réinitialisation quotidienne'),
  )
  const resetButton = document.createElement('button')
  resetButton.type = 'button'
  resetButton.className = 'wm-quiet-button'
  resetButton.textContent = 'Réinitialiser'
  resetButton.addEventListener('click', () => {
    if (!window.confirm('Réinitialiser toutes les statistiques des paquets ?'))
      return
    void updateStats(current => emptyStats(current.dailyReset))
  })
  controls.append(dailyLabel, resetButton)
  container.replaceChildren(head, grid, controls)
}
