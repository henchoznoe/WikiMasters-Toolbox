/** Shared rarity appearance for Toolbox controls and future collection features. */
export function createRarityBadge(rarity: string | null): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.className = 'wm-rarity-surface wm-rarity-badge'
  badge.dataset.rarity = (rarity ?? 'other').toLowerCase()
  badge.textContent = rarity ?? '?'
  return badge
}
