import { type Observation, RARITIES } from './price-model'
import { presentPrice } from './price-presentation'
import {
  canRefreshPrice,
  priceRequestLimit,
  readPriceDetail,
  readPriceHistory,
  readPriceQuote,
  requestPriceDetail,
  requestPriceQuote,
} from './price-store'
import { createRarityBadge } from './rarity'
import { createToolboxRoot } from './shared'

let selected: { id: string; rarity: string; title: string } | null = null
let opener: HTMLElement | null = null
export function closePriceInspector(): void {
  document.querySelector('[data-wm-price-inspector]')?.remove()
  selected = null
  opener?.focus()
  opener = null
}
export function openPriceInspector(
  id: string,
  rarity: string,
  title: string,
): void {
  let nextOpener = document.activeElement as HTMLElement | null
  while (nextOpener?.shadowRoot?.activeElement)
    nextOpener = nextOpener.shadowRoot.activeElement as HTMLElement
  closePriceInspector()
  opener = nextOpener
  selected = { id, rarity, title }
  const host = document.createElement('div')
  host.dataset.wmPriceInspector = '1'
  const root = createToolboxRoot(host)
  const dialog = document.createElement('section')
  dialog.className = 'wm-price-inspector'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', `Prices · ${title}`)
  const header = document.createElement('div')
  header.className = 'wm-price-inspector-header'
  const heading = document.createElement('h2')
  heading.textContent = title
  const close = button('×', 'Close price details', closePriceInspector)
  header.append(heading, close)
  const rarities = document.createElement('div')
  rarities.className = 'wm-price-rarities'
  for (const r of RARITIES) {
    const control = button('', `Prices for ${r}`, () => {
      if (selected) selected.rarity = r
      renderPriceInspector()
    })
    control.dataset.rarity = r.toLowerCase()
    control.dataset.priceRarity = r
    control.append(createRarityBadge(r))
    rarities.append(control)
  }
  const value = document.createElement('p')
  value.dataset.priceInspectorValue = '1'
  const history = document.createElement('div')
  history.dataset.priceHistory = '1'
  const analysis = document.createElement('p')
  analysis.dataset.priceAnalysis = '1'
  analysis.className = 'wm-note'
  const actions = document.createElement('div')
  actions.className = 'wm-collection-actions'
  actions.append(
    button('↻', 'Refresh this card · one attempt per minute', () => {
      void requestPriceQuote(id, true)
    }),
    button(
      'Sales',
      'Analyze accessible settled sales · PRO may be required',
      () => {
        void requestPriceDetail(id)
      },
    ),
  )
  actions.firstElementChild?.setAttribute('data-price-refresh', '1')
  const method = document.createElement('details')
  method.className = 'wm-price-method'
  const summary = document.createElement('summary')
  summary.textContent = 'Method'
  const explanation = document.createElement('p')
  explanation.className = 'wm-note'
  explanation.textContent =
    'Average: WikiMasters summary for this rarity, source window and volume unknown. Age: when checked, not when sold. Shiny premium is not exposed. Local graph: one observation per UTC day, last 90 days; missing days are gaps. Sales: accessible sample settled in the last 30 days, coverage unknown. Median from 5 sales; range from 10: middle 50% (P25–P75), not a guaranteed sale price. Outliers: outside 1.5 × IQR, retained in the sample. Confidence stays low unless ≥20 sales with limited dispersion; never a fair-price guarantee.'
  method.append(summary, explanation)
  dialog.append(header, rarities, value, actions, history, analysis, method)
  root.append(dialog)
  document.body.append(host)
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closePriceInspector()
    }
  })
  close.focus()
  void requestPriceQuote(id)
  renderPriceInspector()
}
function button(
  text: string,
  title: string,
  action: () => void,
): HTMLButtonElement {
  const result = document.createElement('button')
  result.type = 'button'
  result.className = 'wm-quiet-button'
  result.textContent = text
  result.title = title
  result.setAttribute('aria-label', title)
  result.addEventListener('click', action)
  return result
}
function graph(points: Observation[]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 280 88')
  svg.setAttribute('role', 'img')
  svg.setAttribute(
    'aria-label',
    'Local average price observations; missing days are gaps',
  )
  const actual = points.filter(point => point.average !== null)
  const first = points[0]?.at ?? Date.now()
  const last = points.at(-1)?.at ?? first
  const min = Math.min(...actual.map(point => point.average as number))
  const max = Math.max(...actual.map(point => point.average as number))
  const position = (point: Observation) => [
    10 + (260 * (point.at - first)) / Math.max(86400_000, last - first),
    76 - (64 * ((point.average as number) - min)) / Math.max(1, max - min),
  ]
  let previous: Observation | null = null
  for (const point of points) {
    if (point.average === null) {
      previous = null
      continue
    }
    const [x, y] = position(point)
    if (
      previous &&
      Math.floor(point.at / 86400_000) - Math.floor(previous.at / 86400_000) ===
        1
    ) {
      const [px, py] = position(previous)
      const line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', String(px))
      line.setAttribute('y1', String(py))
      line.setAttribute('x2', String(x))
      line.setAttribute('y2', String(y))
      line.setAttribute('stroke', 'currentColor')
      svg.append(line)
    }
    const circle = document.createElementNS(ns, 'circle')
    circle.setAttribute('cx', String(x))
    circle.setAttribute('cy', String(y))
    circle.setAttribute('r', '3')
    circle.setAttribute('fill', 'currentColor')
    const title = document.createElementNS(ns, 'title')
    title.textContent = `${new Date(point.at).toLocaleString()} · ${point.average} W`
    circle.append(title)
    svg.append(circle)
    previous = point
  }
  return svg
}
export function renderPriceInspector(): void {
  if (!selected) return
  const root = document.querySelector('[data-wm-price-inspector]')?.shadowRoot
  if (!root) return
  const { id, rarity } = selected
  const refresh = root.querySelector<HTMLButtonElement>('[data-price-refresh]')
  if (refresh) refresh.disabled = !canRefreshPrice(id)
  const presentation = presentPrice(readPriceQuote(id, rarity))
  const value = root.querySelector<HTMLElement>('[data-price-inspector-value]')
  if (value) {
    value.textContent = `${presentation.value}${presentation.age ? ` · ${presentation.age}` : ''}`
    value.title = presentation.hint
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '[data-price-rarity]',
  ))
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.priceRarity === rarity),
    )
  const history = root.querySelector<HTMLElement>('[data-price-history]')
  const points = readPriceHistory(id, rarity)
  const fingerprint = JSON.stringify(points)
  if (history && history.dataset.points !== fingerprint) {
    history.dataset.points = fingerprint
    history.replaceChildren()
    const caption = document.createElement('p')
    caption.className = 'wm-note'
    const known = points.flatMap(point =>
      point.average === null ? [] : [point.average],
    )
    if (known.length >= 2) history.append(graph(points))
    const span = points.length
      ? Math.floor((points.at(-1)?.at ?? 0) / 86400_000) -
        Math.floor(points[0].at / 86400_000) +
        1
      : 0
    const gaps = span - points.length
    const unpriced = points.length - known.length
    caption.textContent = points.length
      ? `${points.length} local observation${points.length === 1 ? '' : 's'}${gaps ? ` · ${gaps} missing days` : ''}${unpriced ? ` · ${unpriced} without sales` : ''} · ${new Date(points[0].at).toLocaleDateString()} – ${new Date(points.at(-1)?.at ?? 0).toLocaleDateString()}${known.length ? ` · ${Math.min(...known)}–${Math.max(...known)} W` : ''}`
      : 'No local observations yet'
    history.append(caption)
  }
  const detail = readPriceDetail(id)
  const result = root.querySelector<HTMLElement>('[data-price-analysis]')
  if (!result) return
  const analysis = detail.analyses?.[rarity]
  result.textContent =
    priceRequestLimit() ||
    (detail.status === 'loading'
      ? '…'
      : detail.status === 'pro-required'
        ? 'Detailed sales require WikiMasters PRO · average only'
        : detail.status === 'unavailable'
          ? 'Sales request failed · !'
          : analysis
            ? `${analysis.count} accessible sales / 30 days · ${analysis.confidence} confidence${analysis.median !== null ? ` · median ${money(analysis.median)} W` : ' · ≥5 sales needed for median'}${analysis.low !== null && analysis.high !== null ? ` · indicative range ${money(analysis.low)}–${money(analysis.high)} W` : ' · ≥10 sales needed for range'} · ${analysis.outliers} outliers${analysis.oldest && analysis.newest ? ` · ${new Date(analysis.oldest).toLocaleDateString()} – ${new Date(analysis.newest).toLocaleDateString()}` : ''}`
            : 'Average only · volume / period unknown')
  result.title = detail.at
    ? `Sales last checked ${new Date(detail.at).toLocaleString()}`
    : 'Detailed sales are loaded only on request'
}
function money(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
    value,
  )
}
