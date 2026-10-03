declare const WM_TOOLBOX_CSS: string

const toolboxSheet = new CSSStyleSheet()
toolboxSheet.replaceSync(WM_TOOLBOX_CSS)

export type { Card } from '../cards'

import type { Card } from '../cards'

export function createToolboxRoot(host: HTMLElement): ShadowRoot {
  host.lang = 'fr'
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [toolboxSheet]
  return root
}

export function normalizeTitle(value: string | null): string {
  return (value || '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function isCard(value: unknown): value is Card {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Card).id === 'string' &&
      typeof (value as Card).title === 'string' &&
      ((value as Card).rarity === null ||
        typeof (value as Card).rarity === 'string') &&
      ((value as Card).copyId === null ||
        typeof (value as Card).copyId === 'string') &&
      typeof (value as Card).shiny === 'boolean',
  )
}
