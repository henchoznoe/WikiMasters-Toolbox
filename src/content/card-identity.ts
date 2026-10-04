import type { Card } from '../cards'
import { RARITIES } from './price-model'
import { normalizeTitle } from './shared'

export type CardHints = {
  title: string | null
  rarity: string | null
  id?: string | null
  shiny?: boolean | null
}
/** Native catalogue IDs may disambiguate titles; inferred IDs are never evidence. */
export function resolveCardIdentity(
  cards: Card[],
  hints: CardHints,
): Card | null {
  if (!hints.rarity || !RARITIES.some(rarity => rarity === hints.rarity))
    return null
  const candidates = cards.filter(
    card =>
      card.rarity === hints.rarity &&
      (!hints.id || card.id === hints.id) &&
      (!hints.title ||
        normalizeTitle(card.title) === normalizeTitle(hints.title)) &&
      (hints.shiny == null || card.shiny === hints.shiny),
  )
  if (!hints.id && !hints.title) return null
  if (
    new Set(candidates.map(card => card.id)).size !== 1 ||
    new Set(candidates.map(card => card.shiny)).size !== 1
  )
    return null
  return candidates[0] ?? null
}
