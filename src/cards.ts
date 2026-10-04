import { RARITIES } from './content/price-model'

export type Card = {
  /** Catalogue ID, used for market prices. Never a possession ID. */
  id: string
  title: string
  rarity: string | null
  copyId: string | null
  shiny: boolean
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
      RARITIES.find(
        rarity =>
          rarity ===
          (entry.snapshot_rarity !== undefined
            ? entry.snapshot_rarity
            : source.rarity),
      ) ?? null,
    copyId:
      nonemptyString(entry.user_card_id) ??
      (possession && nested ? nonemptyString(entry.id) : null),
    shiny: entry.is_shiny === true || source.is_shiny === true,
  }
}

export function cardVariantKey(
  card: Pick<Card, 'id' | 'rarity' | 'shiny'>,
): string {
  return JSON.stringify([card.id, card.rarity, card.shiny])
}
