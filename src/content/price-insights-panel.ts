import { getCollectionState } from './collection'
import {
  clearPriceAlertEvents,
  readPriceAlerts,
  removePriceAlert,
} from './price-alerts'
import { listingComparison } from './price-comparison'
import { diagnosePrices, priceDashboard } from './price-diagnostics'
import { openPriceInspector } from './price-inspector'
import { readPriceListings } from './price-listings'
import { formatPriceAge, presentPrice } from './price-presentation'
import {
  cachedPriceIds,
  canRefreshPrice,
  getPriceBatch,
  priceDataRevision,
  readPriceHistory,
  readPriceQuote,
  startPriceBatch,
} from './price-store'
import { getVisiblePriceCards } from './prices'
import { createRarityBadge } from './rarity'

function note(text: string, hint = ''): HTMLElement {
  const node = document.createElement('p')
  node.className = 'wm-note'
  node.textContent = text
  node.title = hint
  return node
}
function button(text: string, click: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = 'wm-quiet-button'
  node.textContent = text
  node.addEventListener('click', click)
  return node
}
function section(title: string, key: string): HTMLDetailsElement {
  const node = document.createElement('details')
  node.className = 'wm-market-section'
  node.dataset.priceInsights = key
  const summary = document.createElement('summary')
  summary.textContent = title
  node.append(summary)
  return node
}
function replace(body: HTMLElement, key: string, build: () => Node[]): void {
  if (body.dataset.key === key) return
  body.dataset.key = key
  body.replaceChildren(...build())
}
export function createPriceInsights(): HTMLElement {
  const body = document.createElement('div')
  body.className = 'wm-price-insights'
  const alerts = section('Price alerts', 'alerts')
  const alertBody = document.createElement('div')
  alertBody.dataset.priceAlertsBody = '1'
  const clear = button('Clear notifications', () => {
    const result = clearPriceAlertEvents()
    clear.title = result ? '' : 'Alert storage unavailable'
    renderPriceInsights()
  })
  clear.dataset.priceAlertsClear = '1'
  alerts.append(
    note(
      'Set a threshold in card price details. Fresh Toolbox reads only · no background polling.',
    ),
    clear,
    alertBody,
  )
  const diagnostics = section('Missing prices', 'diagnostics')
  const scope = document.createElement('select')
  scope.dataset.priceDiagnosticScope = '1'
  scope.setAttribute('aria-label', 'Missing price scope')
  for (const [value, label] of [
    ['page', 'Cards on this page'],
    ['collection', 'Loaded collection'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    scope.append(option)
  }
  const filter = document.createElement('select')
  filter.dataset.priceDiagnosticFilter = '1'
  filter.setAttribute('aria-label', 'Missing price reason')
  for (const [value, label] of [
    ['all', 'All reasons'],
    ['no-sales', 'No sales data'],
    ['not-found', 'Not found'],
    ['error', 'Error / paused'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    filter.append(option)
  }
  const list = document.createElement('div')
  list.dataset.priceDiagnosticsBody = '1'
  const retry = button('Retry filtered · max 10', () => {
    const cards =
      scope.value === 'collection'
        ? getCollectionState().cards
        : getVisiblePriceCards()
    const ids = diagnosePrices(cards, readPriceQuote)
      .filter(row => filter.value === 'all' || row.reason === filter.value)
      .map(row => row.card.id)
    void startPriceBatch(ids, true, 10)
  })
  retry.dataset.priceDiagnosticRetry = '1'
  diagnostics.append(
    scope,
    filter,
    retry,
    note(
      'No sales data: this rarity is absent from the native summary. Not found: catalogue endpoint returned 404. Error: failed read, failed refresh or request pause. Retry uses Prices progress / Stop, ≥1 min per card and the shared budget.',
    ),
    list,
  )
  scope.addEventListener('change', () => {
    list.dataset.page = '0'
    renderPriceInsights()
  })
  filter.addEventListener('change', () => {
    list.dataset.page = '0'
    renderPriceInsights()
  })
  const dashboard = section('Market dashboard · local', 'dashboard')
  const dashboardBody = document.createElement('div')
  dashboardBody.dataset.priceDashboardBody = '1'
  dashboard.append(
    note(
      'Public cached references, up to 30 days old · incomplete coverage. Amounts are sums of rarity averages per catalogue, not turnover or concluded sales. History: observed UTC days / 90 days; gaps are not interpolated. Shiny premiums unavailable.',
    ),
    dashboardBody,
  )
  const comparisons = section('Listing vs average', 'comparison')
  const comparisonBody = document.createElement('div')
  comparisonBody.dataset.priceComparisonBody = '1'
  comparisons.append(comparisonBody)
  comparisons.hidden = !/^\/marketplace(\/|$)/.test(location.pathname)
  body.append(comparisons, alerts, diagnostics, dashboard)
  comparisons.addEventListener('toggle', renderPriceInsights)
  for (const details of [alerts, diagnostics, dashboard])
    details.addEventListener('toggle', renderPriceInsights)
  return body
}
export function renderPriceInsights(): void {
  const root = document.querySelector('[data-wm-toolbox-panel]')?.shadowRoot
  if (!root) return
  const comparisonBody = root.querySelector<HTMLElement>(
    '[data-price-comparison-body]',
  )
  if (comparisonBody?.parentElement?.hasAttribute('open')) {
    const pathId = location.pathname.match(
      /^\/marketplace\/([0-9a-f-]{36})/i,
    )?.[1]
    const listings = readPriceListings().filter(
      row => !pathId || row.id === pathId,
    )
    const rows = listings.map(row => ({
      row,
      ...listingComparison(row, readPriceQuote(row.card.id, row.card.rarity)),
    }))
    replace(comparisonBody, JSON.stringify(rows), () => {
      const nodes: Node[] = [
        note(
          `${rows.length} observed listings · latest page only · amounts from the last native read${rows.length > 10 ? ' · first 10 shown' : ''}`,
        ),
      ]
      for (const { row, text, hint } of rows.slice(0, 10)) {
        const item = document.createElement('div')
        item.className = 'wm-market-row'
        const link = document.createElement('a')
        link.href = `/marketplace/${row.id}`
        link.textContent = row.card.title
        item.append(
          link,
          createRarityBadge(row.card.rarity ?? '?'),
          note(text, hint),
        )
        nodes.push(item)
      }
      if (!rows.length)
        nodes.push(
          note(
            'Listing metadata unavailable · open an announcement; no amount inferred from the page text.',
          ),
        )
      return nodes
    })
  }
  const alerts = root.querySelector<HTMLElement>('[data-price-alerts-body]')
  const state = readPriceAlerts()
  const pricesSummary = root.querySelector('[data-price-controls-summary]')
  if (pricesSummary)
    pricesSummary.textContent = `Prices${state.events.length ? ` · ${state.events.length} alerts` : ''}`
  const clear = root.querySelector<HTMLButtonElement>(
    '[data-price-alerts-clear]',
  )
  if (clear) clear.disabled = state.events.length === 0
  const summary = root.querySelector('[data-price-insights="alerts"] summary')
  if (summary)
    summary.textContent = `Price alerts${state.events.length ? ` · ${state.events.length}` : ''}`
  if (alerts?.parentElement?.hasAttribute('open'))
    replace(alerts, JSON.stringify(state), () => {
      const nodes: Node[] = [
        note(
          `${state.rules.length} / 50 alerts · ${state.events.length} notifications / 30 days${state.warning ? ` · ${state.warning}` : ''}`,
        ),
      ]
      for (const event of state.events.slice(-10).reverse())
        nodes.push(
          note(
            `${event.id} · ${event.rarity} · ${event.direction === 'above' ? '≥' : '≤'} ${event.threshold} W · observed ${event.average} W · ${formatPriceAge(event.at)}`,
            new Date(event.at).toLocaleString(),
          ),
        )
      if (state.events.length > 10)
        nodes.push(note('Latest 10 notifications shown'))
      for (const rule of state.rules) {
        const row = document.createElement('div')
        row.className = 'wm-market-row'
        row.append(
          note(
            `${rule.id} · ${rule.rarity} · ${rule.direction === 'above' ? '≥' : '≤'} ${rule.threshold} W`,
          ),
          button('Details', () =>
            openPriceInspector(rule.id, rule.rarity, rule.id),
          ),
          button('Remove', () => {
            if (!removePriceAlert(rule.id, rule.rarity))
              row.append(note('Alert storage unavailable'))
            renderPriceInsights()
          }),
        )
        nodes.push(row)
      }
      return nodes
    })
  const list = root.querySelector<HTMLElement>('[data-price-diagnostics-body]')
  if (list?.parentElement?.hasAttribute('open')) {
    const scope = root.querySelector<HTMLSelectElement>(
      '[data-price-diagnostic-scope]',
    )?.value
    const filter = root.querySelector<HTMLSelectElement>(
      '[data-price-diagnostic-filter]',
    )?.value
    const cards =
      scope === 'collection'
        ? getCollectionState().cards
        : getVisiblePriceCards()
    const rows = diagnosePrices(cards, readPriceQuote).filter(
      row => filter === 'all' || row.reason === filter,
    )
    const pages = Math.max(1, Math.ceil(rows.length / 10))
    const page = Math.min(Number(list.dataset.page) || 0, pages - 1)
    const retry = root.querySelector<HTMLButtonElement>(
      '[data-price-diagnostic-retry]',
    )
    if (retry)
      retry.disabled =
        getPriceBatch().running ||
        !rows.some(row => canRefreshPrice(row.card.id))
    replace(
      list,
      JSON.stringify([
        rows,
        page,
        scope,
        getCollectionState().status,
        Math.floor(Date.now() / 60_000),
      ]),
      () => {
        const nodes: Node[] = [
          note(
            `${rows.length} variants${scope === 'collection' && getCollectionState().status !== 'complete' ? ' · partial index' : ''} · unloaded prices are not failures`,
          ),
        ]
        for (const row of rows.slice(page * 10, page * 10 + 10)) {
          const node = document.createElement('div')
          node.className = 'wm-market-row'
          const label =
            row.reason === 'error'
              ? 'Error / paused'
              : row.reason === 'no-sales'
                ? 'No sales data'
                : 'Not found'
          node.append(
            note(row.card.title),
            createRarityBadge(row.card.rarity ?? '?'),
            note(label, presentPrice(row.quote).hint),
            button('Details', () =>
              openPriceInspector(
                row.card.id,
                row.card.rarity ?? 'C',
                row.card.title,
                row.card.shiny,
              ),
            ),
          )
          nodes.push(node)
        }
        const navigation = document.createElement('div')
        navigation.className = 'wm-selection-pagination'
        const previous = button('←', () => {
          list.dataset.page = String(page - 1)
          renderPriceInsights()
        })
        const next = button('→', () => {
          list.dataset.page = String(page + 1)
          renderPriceInsights()
        })
        previous.disabled = page === 0
        next.disabled = page + 1 >= pages
        previous.setAttribute('aria-label', 'Previous missing prices page')
        next.setAttribute('aria-label', 'Next missing prices page')
        navigation.append(previous, note(`${page + 1} / ${pages}`), next)
        nodes.push(navigation)
        return nodes
      },
    )
  }
  const dashboard = root.querySelector<HTMLElement>(
    '[data-price-dashboard-body]',
  )
  if (!dashboard?.parentElement?.hasAttribute('open')) return
  const dependency = `${priceDataRevision()}:${Math.floor(Date.now() / 60_000)}`
  if (dashboard.dataset.dependency === dependency) return
  dashboard.dataset.dependency = dependency
  const ids = cachedPriceIds()
  const data = priceDashboard(ids, readPriceQuote, readPriceHistory)
  replace(dashboard, JSON.stringify(data), () => {
    const nodes: Node[] = [
      note(`${ids.length} retained catalogue IDs · shared between accounts`),
    ]
    const table = document.createElement('table')
    table.className = 'wm-price-dashboard-table'
    const caption = document.createElement('caption')
    caption.textContent = 'Cached rarity references'
    table.append(caption)
    const head = table.createTHead().insertRow()
    for (const label of [
      'Rarity',
      'Known',
      'Sum W',
      'Old / failed',
      'No sales',
      'Error / 404',
      'Unloaded',
    ]) {
      const cell = document.createElement('th')
      cell.scope = 'col'
      cell.textContent = label
      head.append(cell)
    }
    const tbody = table.createTBody()
    for (const row of data) {
      const tr = tbody.insertRow()
      const rarityCell = document.createElement('th')
      rarityCell.scope = 'row'
      rarityCell.append(createRarityBadge(row.rarity))
      tr.append(rarityCell)
      for (const value of [
        row.known,
        row.sum.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        row.stale,
        row.missing,
        row.errors,
        row.unloaded,
      ])
        tr.insertCell().textContent = String(value)
    }
    nodes.push(
      table,
      note('Often without price · at least 3 observed days · top 10'),
    )
    const histories = data.flatMap(row => row.histories)
    for (const row of histories
      .filter(row => row.observed >= 3 && row.missing > 0)
      .sort(
        (a, b) =>
          b.missing / b.observed - a.missing / a.observed ||
          b.missing - a.missing,
      )
      .slice(0, 10))
      nodes.push(
        historyRow(
          row.id,
          row.rarity,
          `${row.missing} / ${row.observed} days without sales data`,
        ),
      )
    nodes.push(
      note('Local evolution · latest 10 variants with ≥2 known observations'),
    )
    for (const row of histories
      .filter(row => row.delta !== null)
      .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0))
      .slice(0, 10))
      nodes.push(
        historyRow(
          row.id,
          row.rarity,
          `${row.first?.average} → ${row.last?.average} W · ${(row.delta ?? 0) > 0 ? '+' : ''}${row.delta?.toLocaleString()} W · ${new Date(row.first?.at ?? 0).toLocaleDateString()} → ${new Date(row.last?.at ?? 0).toLocaleDateString()} · ${row.gaps} unobserved days · ${row.missing} no-sales days`,
        ),
      )
    nodes.push(
      note(
        'Evolution compares the first and last actual observations, not sale results; open Details for the graph and gaps.',
      ),
    )
    return nodes
  })
}
function historyRow(id: string, rarity: string, text: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'wm-market-row'
  row.append(
    note(id),
    createRarityBadge(rarity),
    note(text),
    button('Details', () => openPriceInspector(id, rarity, id)),
  )
  return row
}
