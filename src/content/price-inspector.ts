import {
  currentPriceContext,
  type PriceContext,
  priceTooOld,
} from './price-context'
import { type Observation, RARITIES } from './price-model'
import { presentPrice } from './price-presentation'
import {
  canRefreshPrice,
  readPriceHistory,
  readPriceQuote,
  requestPriceQuote,
} from './price-store'
import { createRarityBadge } from './rarity'
import { estimateSales } from './sales-model'
import { readSaleSamples } from './sales-store'
import { createToolboxRoot } from './shared'

let selected: {
  id: string
  rarity: string
  title: string
  shiny: boolean
  context: PriceContext
} | null = null
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
  shiny = false,
): void {
  let nextOpener = document.activeElement as HTMLElement | null
  while (nextOpener?.shadowRoot?.activeElement)
    nextOpener = nextOpener.shadowRoot.activeElement as HTMLElement
  closePriceInspector()
  opener = nextOpener
  selected = {
    id,
    rarity,
    title,
    shiny,
    context: currentPriceContext(),
  }
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
  const sample = document.createElement('div')
  sample.dataset.priceSalesSample = '1'
  const actions = document.createElement('div')
  actions.className = 'wm-collection-actions'
  actions.append(
    button('↻', 'Refresh this card · one attempt per minute', () => {
      void requestPriceQuote(id, true)
    }),
  )
  actions.firstElementChild?.setAttribute('data-price-refresh', '1')
  const method = document.createElement('details')
  method.className = 'wm-price-method'
  const summary = document.createElement('summary')
  summary.textContent = 'Method'
  method.append(summary)
  for (const text of [
    'Average: WikiMasters summary for this rarity, source window and volume unknown. Age: when checked, not when sold. Shiny premium is not exposed. Album freshness: 24 h; sale/trade: 15 min. Refresh preserves the original age on failure. Local graph: one average observation per UTC day, last 90 days; missing days are gaps.',
    'Sales sample: explicit settled_sold results with final amount, auction end time, snapshot rarity and shiny status, from free native history or visited auctions. One result per auction, same catalogue ID, rarity and shiny status. Last 30 days by auction end time; up to 1,000 results per account.',
    'Median: at least 5 sales on 3 distinct UTC end days. Indicative Q1–Q3 range: at least 10 sales on 3 days, linear interpolation, middle half of observed prices. Extremes: outside Q1 − 1.5×IQR / Q3 + 1.5×IQR; they remain in the median.',
    'These are minimum display thresholds, not proof of market coverage. The observed volume is incomplete. Selection can be biased: the range is not a confidence interval or a prediction.',
  ]) {
    const explanation = document.createElement('p')
    explanation.className = 'wm-note'
    explanation.textContent = text
    method.append(explanation)
  }
  dialog.append(header, rarities, value, actions, sample, history, method)
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
  const { id, rarity, shiny, context } = selected
  const quote = readPriceQuote(id, rarity)
  const refresh = root.querySelector<HTMLButtonElement>('[data-price-refresh]')
  if (refresh) {
    refresh.disabled = !canRefreshPrice(id)
    refresh.textContent =
      context === 'decision' && priceTooOld(quote, context)
        ? '↻ Refresh before decision'
        : '↻'
  }
  const presentation = presentPrice(quote, context)
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
  const sample = root.querySelector<HTMLElement>('[data-price-sales-sample]')
  if (sample) {
    const estimate = estimateSales(readSaleSamples(), { id, rarity, shiny })
    const money = (value: number) =>
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
    const lines = [
      `Observed concluded sales · ${rarity} · ${shiny ? 'shiny' : 'normal'} · ${estimate.count} / 30 days · ${estimate.days} UTC days`,
      estimate.median === null
        ? 'Median — · needs 5 sales on 3 distinct days'
        : `Local median ${money(estimate.median)} W · ${estimate.extremes} extreme values retained`,
      estimate.range
        ? `Indicative Q1–Q3: ${money(estimate.range[0])}–${money(estimate.range[1])} W · incomplete sample`
        : 'Range — · needs 10 sales on 3 distinct days',
      estimate.oldest && estimate.newest
        ? `Auction ends: ${new Date(estimate.oldest).toLocaleDateString()} – ${new Date(estimate.newest).toLocaleDateString()} · latest ${new Date(estimate.newest).toLocaleString()}`
        : 'Observe free market history / concluded listings to build a sample',
    ]
    const signature = JSON.stringify(lines)
    if (sample.dataset.signature !== signature) {
      sample.dataset.signature = signature
      sample.replaceChildren(
        ...lines.map(text => {
          const p = document.createElement('p')
          p.className = 'wm-note'
          p.textContent = text
          return p
        }),
      )
    }
  }
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
}
