import { createDataControls } from './data-panel'
import { createToolboxRoot } from './shared'

export type ToolboxPage = {
  id: string
  label: string
  matches: (path: string) => boolean
  read?: () => Promise<void>
  createBody: () => HTMLElement
  onMount?: () => void
  onHide?: () => void
  onUnmount?: () => void
}

const PANEL_KEY = 'wm_toolbox_panel_collapsed_v1'
let activePage: ToolboxPage | null = null

function readPanelCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(PANEL_KEY)
    if (saved !== null) return saved === 'true'
  } catch {
    /* Storage unavailable. */
  }
  return false
}

function writePanelCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PANEL_KEY, String(collapsed))
  } catch {
    /* Storage unavailable. */
  }
}

export function resolvePanelPage(
  path: string,
  pages: readonly ToolboxPage[],
): ToolboxPage | null {
  return pages.find(page => page.matches(path)) ?? null
}

export function syncToolboxPanel(
  path: string,
  pages: readonly ToolboxPage[],
): void {
  const page = resolvePanelPage(path, pages)
  const existing = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-panel]',
  )
  if (existing && activePage?.id === page?.id) return
  if (activePage && activePage.id !== page?.id) activePage.onUnmount?.()
  existing?.remove()
  activePage = page
  if (!page || !document.body) return

  const host = document.createElement('div')
  host.dataset.wmToolboxPanel = page.id
  host.style.position = 'fixed'
  host.style.bottom = '16px'
  host.style.right = '16px'
  host.style.zIndex = '2147483647'
  const panel = document.createElement('section')
  panel.setAttribute(
    'aria-label',
    `Toolbox ${page.label.toLowerCase()} : commandes`,
  )
  panel.className = 'wm-panel'
  const initiallyExpanded = !readPanelCollapsed()
  panel.classList.toggle('wm-panel-open', initiallyExpanded)

  const header = document.createElement('div')
  header.className = 'wm-panel-header'
  const title = document.createElement('h2')
  title.className = 'wm-panel-title'
  title.textContent = 'Toolbox · Prix'
  const mark = document.createElement('span')
  mark.className = 'wm-panel-mark'
  mark.textContent = page.label
  const disclosure = document.createElement('button')
  disclosure.type = 'button'
  disclosure.className = 'wm-panel-disclosure'
  disclosure.setAttribute(
    'aria-label',
    `${initiallyExpanded ? 'Masquer' : 'Afficher'} les commandes Toolbox`,
  )
  disclosure.setAttribute('aria-expanded', String(initiallyExpanded))
  disclosure.textContent = initiallyExpanded ? 'Réduire' : 'Ouvrir'
  disclosure.addEventListener('click', () => {
    const expanded = panel.classList.toggle('wm-panel-open')
    writePanelCollapsed(!expanded)
    if (!expanded) page.onHide?.()
    disclosure.setAttribute(
      'aria-label',
      `${expanded ? 'Masquer' : 'Afficher'} les commandes Toolbox`,
    )
    disclosure.setAttribute('aria-expanded', String(expanded))
    disclosure.textContent = expanded ? 'Réduire' : 'Ouvrir'
  })
  header.append(title, mark, disclosure)
  const body = page.createBody()
  body.append(createDataControls())
  panel.append(header, body)
  createToolboxRoot(host).append(panel)
  document.body.append(host)
  page.onMount?.()
}

export function resetToolboxPanel(): void {
  document.querySelector('[data-wm-toolbox-panel]')?.remove()
  activePage = null
}
