import { getViewPreferences } from './collection-views'
import { cardSelectors } from './page-adapters'

const originalStyles = new Map<HTMLElement, Map<string, [string, string]>>()
function apply(element: HTMLElement, property: string, value: string): void {
  let styles = originalStyles.get(element)
  if (!styles) {
    styles = new Map()
    originalStyles.set(element, styles)
  }
  if (!styles.has(property))
    styles.set(property, [
      element.style.getPropertyValue(property),
      element.style.getPropertyPriority(property),
    ])
  if (element.style.getPropertyValue(property) !== value)
    element.style.setProperty(property, value)
}
export function renderCompactLayout(): void {
  const active =
    getViewPreferences().compact &&
    /^\/(collection|global-collection)(\/|$)/.test(location.pathname)
  for (const [element, styles] of originalStyles)
    if (!active || !element.isConnected) {
      for (const [property, [value, priority]] of styles) {
        if (value) element.style.setProperty(property, value, priority)
        else element.style.removeProperty(property)
      }
      originalStyles.delete(element)
    }
  for (const host of document.querySelectorAll<HTMLElement>(
    '[data-wm-toolbox-panel]',
  ))
    for (const input of host.shadowRoot?.querySelectorAll<HTMLInputElement>(
      '[data-wm-compact]',
    ) ?? [])
      input.checked = getViewPreferences().compact
  if (!active) return
  for (const heading of document.querySelectorAll('main h3')) {
    const card = heading.closest<HTMLElement>(cardSelectors.grid)
    if (!card) continue
    let container = card.parentElement
    if (!container) continue
    let style = getComputedStyle(container)
    // Owned cards have a plain wrapper; catalogue cards are direct flex children.
    if (style.display === 'block' && container.parentElement) {
      container = container.parentElement
      style = getComputedStyle(container)
    }
    if (style.display === 'flex' && style.flexWrap === 'wrap') {
      // Native cards keep their height, typography, price footer and action controls.
      apply(container, 'gap', '10px')
      apply(card, 'width', '140px')
    } else if (style.display === 'grid') {
      apply(
        container,
        'grid-template-columns',
        'repeat(auto-fill, minmax(min(100%, 140px), 1fr))',
      )
    }
  }
}
