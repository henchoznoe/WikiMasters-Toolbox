export type Card = {
  /** Catalogue ID, used for market prices. Never a possession ID. */
  id: string
  title: string
  rarity: string | null
  copyId: string | null
  shiny: boolean
}

export type OwnedCard = Card & {
  copyId: string
  ownerId: string
  starred: boolean
  tagIds: string[]
  obtainedAt: string | null
}

export function nonemptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function mapCard(raw: unknown, possession = false): Card | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const nested = entry.card && typeof entry.card === 'object'
  const source = (nested ? entry.card : entry) as Record<string, unknown>
  const id = nonemptyString(entry.card_id) ?? nonemptyString(source.id)
  const title = nonemptyString(source.wikipedia_title)
  if (!id || !title) return null
  if (nested && nonemptyString(source.id) && source.id !== id) return null
  return {
    id,
    title,
    rarity:
      nonemptyString(entry.snapshot_rarity) ?? nonemptyString(source.rarity),
    copyId:
      nonemptyString(entry.user_card_id) ??
      (possession && nested ? nonemptyString(entry.id) : null),
    shiny: entry.is_shiny === true || source.is_shiny === true,
  }
}

export function mapOwnedCard(raw: unknown): OwnedCard | null {
  const card = mapCard(raw, true)
  if (!card?.copyId || !raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const ownerId = nonemptyString(entry.user_id)
  // A grouped catalogue row is not a list of identified copies.
  if (!ownerId || (entry.count !== undefined && entry.count !== 1)) return null
  // Actions must not interpret missing protection metadata as an unprotected copy.
  if (
    typeof entry.starred !== 'boolean' ||
    typeof entry.is_shiny !== 'boolean' ||
    !Array.isArray(entry.tags) ||
    entry.tags.some(
      tag => !tag || typeof tag !== 'object' || !nonemptyString(tag.id),
    )
  )
    return null
  return {
    ...card,
    copyId: card.copyId,
    ownerId: ownerId.toLowerCase(),
    starred: entry.starred === true,
    tagIds: Array.isArray(entry.tags)
      ? entry.tags.flatMap(tag => {
          const id =
            tag && typeof tag === 'object' ? nonemptyString(tag.id) : null
          return id ? [id] : []
        })
      : [],
    obtainedAt: nonemptyString(entry.obtained_at),
  }
}

export function cardVariantKey(
  card: Pick<Card, 'id' | 'rarity' | 'shiny'>,
): string {
  return JSON.stringify([card.id, card.rarity, card.shiny])
}
