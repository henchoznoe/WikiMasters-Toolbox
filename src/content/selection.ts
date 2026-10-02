import { cardVariantKey, type OwnedCard } from '../cards'

export type Protection = 'favorites' | 'tags' | 'committed' | 'unique' | 'shiny'
export type SelectionRules = {
  rarities: Set<string>
  added: Set<string>
  removed: Set<string>
  protect: Record<Protection, boolean>
  keep: number
}
export type Commitments = {
  catalogueIds: Set<string>
  copyIds: Set<string>
  saleCopyIds?: Set<string>
  tradeCopyIds?: Set<string>
}
export type SelectionPlan = {
  cards: OwnedCard[]
  blocked: Map<string, string>
  rarities: Map<string, number>
  groups: {
    title: string
    rarity: string | null
    shiny: boolean
    before: number
    after: number
  }[]
}

export function defaultSelectionRules(): SelectionRules {
  return {
    rarities: new Set(),
    added: new Set(),
    removed: new Set(),
    keep: 1,
    protect: {
      favorites: true,
      tags: true,
      committed: true,
      unique: true,
      shiny: true,
    },
  }
}

export function buildSelection(
  cards: readonly OwnedCard[],
  rules: SelectionRules,
  commitments: Commitments,
): SelectionPlan {
  const groups = new Map<string, OwnedCard[]>()
  const blocked = new Map<string, string>()
  const selected: OwnedCard[] = []
  const summaries: SelectionPlan['groups'] = []
  const keep =
    Number.isSafeInteger(rules.keep) && rules.keep >= 0 ? rules.keep : Infinity
  for (const card of cards) {
    const key = cardVariantKey(card)
    const group = groups.get(key) ?? []
    group.push(card)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const requested: OwnedCard[] = []
    for (const card of group) {
      const reason =
        rules.protect.favorites && card.starred
          ? 'Favorite'
          : rules.protect.tags && card.tagIds.length
            ? 'Tagged'
            : rules.protect.committed &&
                (commitments.copyIds.has(card.copyId) ||
                  commitments.catalogueIds.has(card.id))
              ? 'Sale / trade'
              : rules.protect.unique && group.length === 1
                ? 'Only copy'
                : rules.protect.shiny && card.shiny
                  ? 'Shiny'
                  : null
      if (reason) blocked.set(card.copyId, reason)
      else if (
        !rules.removed.has(card.copyId) &&
        (rules.added.has(card.copyId) || rules.rarities.has(card.rarity ?? ''))
      )
        requested.push(card)
    }
    // Unselected and protected copies already count toward the retained minimum.
    // Keep the oldest available copies, with possession ID as a stable tie-breaker.
    requested.sort(
      (a, b) =>
        (a.obtainedAt ?? '').localeCompare(b.obtainedAt ?? '') ||
        a.copyId.localeCompare(b.copyId),
    )
    const reserve = Math.max(
      0,
      Math.min(requested.length, keep - (group.length - requested.length)),
    )
    for (const card of requested.slice(0, reserve))
      blocked.set(card.copyId, `Keep ${keep}`)
    const discarded = requested.slice(reserve)
    selected.push(...discarded)
    if (discarded.length)
      summaries.push({
        title: group[0].title,
        rarity: group[0].rarity,
        shiny: group[0].shiny,
        before: group.length,
        after: group.length - discarded.length,
      })
  }
  const rarities = new Map<string, number>()
  for (const card of selected) {
    const key = card.rarity ?? '?'
    rarities.set(key, (rarities.get(key) ?? 0) + 1)
  }
  return { cards: selected, blocked, rarities, groups: summaries }
}

export function selectionFingerprint(cards: readonly OwnedCard[]): string {
  return JSON.stringify(
    [...cards]
      .sort((a, b) => a.copyId.localeCompare(b.copyId))
      .map(card => [
        card.copyId,
        card.id,
        card.rarity,
        card.shiny,
        card.starred,
        [...card.tagIds].sort(),
        card.ownerId,
      ]),
  )
}
