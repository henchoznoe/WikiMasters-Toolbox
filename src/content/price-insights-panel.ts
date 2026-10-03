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
  const alerts = section('Alertes de prix', 'alerts')
  const alertBody = document.createElement('div')
  alertBody.dataset.priceAlertsBody = '1'
  const clear = button('Effacer les notifications', () => {
    const result = clearPriceAlertEvents()
    clear.title = result ? '' : 'Stockage des alertes indisponible'
    renderPriceInsights()
  })
  clear.dataset.priceAlertsClear = '1'
  alerts.append(
    note(
      'Choisissez un seuil dans le détail du prix d’une carte. Lectures fraîches de Toolbox uniquement · aucune surveillance en arrière-plan.',
    ),
    clear,
    alertBody,
  )
  const diagnostics = section('Prix manquants', 'diagnostics')
  const scope = document.createElement('select')
  scope.dataset.priceDiagnosticScope = '1'
  scope.setAttribute('aria-label', 'Périmètre des prix manquants')
  for (const [value, label] of [
    ['page', 'Cartes de cette page'],
    ['collection', 'Collection chargée'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    scope.append(option)
  }
  const filter = document.createElement('select')
  filter.dataset.priceDiagnosticFilter = '1'
  filter.setAttribute('aria-label', 'Cause du prix manquant')
  for (const [value, label] of [
    ['all', 'Toutes les causes'],
    ['no-sales', 'Aucune donnée de vente'],
    ['not-found', 'Introuvable'],
    ['error', 'Erreur / pause'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    filter.append(option)
  }
  const list = document.createElement('div')
  list.dataset.priceDiagnosticsBody = '1'
  const retry = button('Relancer les prix filtrés · max 10', () => {
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
      'Aucune donnée de vente : rareté absente du récapitulatif natif. Introuvable : réponse 404 du catalogue. Erreur : lecture ou actualisation échouée, ou requêtes suspendues. La relance utilise la progression et le bouton « Arrêter » du panneau Prix, avec ≥1 min par carte et le budget commun.',
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
  const dashboard = section('Tableau de bord du marché · local', 'dashboard')
  const dashboardBody = document.createElement('div')
  dashboardBody.dataset.priceDashboardBody = '1'
  dashboard.append(
    note(
      'Références publiques en cache, datant de 30 jours au plus · couverture incomplète. Les montants additionnent les moyennes par rareté du catalogue, sans représenter un chiffre d’affaires ni des ventes conclues. Historique : jours UTC observés sur 90 jours ; aucune interpolation des trous. Surcote des brillantes indisponible.',
    ),
    dashboardBody,
  )
  const comparisons = section('Annonce / moyenne', 'comparison')
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
          `${rows.length} annonces observées · dernière page uniquement · montants de la dernière lecture native${rows.length > 10 ? ' · 10 premières affichées' : ''}`,
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
            'Données de l’annonce indisponibles · ouvrez une annonce ; aucun montant n’est déduit du texte de la page.',
          ),
        )
      return nodes
    })
  }
  const alerts = root.querySelector<HTMLElement>('[data-price-alerts-body]')
  const state = readPriceAlerts()
  const pricesSummary = root.querySelector('[data-price-controls-summary]')
  if (pricesSummary)
    pricesSummary.textContent = `Prix${state.events.length ? ` · ${state.events.length} alertes` : ''}`
  const clear = root.querySelector<HTMLButtonElement>(
    '[data-price-alerts-clear]',
  )
  if (clear) clear.disabled = state.events.length === 0
  const summary = root.querySelector('[data-price-insights="alerts"] summary')
  if (summary)
    summary.textContent = `Alertes de prix${state.events.length ? ` · ${state.events.length}` : ''}`
  if (alerts?.parentElement?.hasAttribute('open'))
    replace(alerts, JSON.stringify(state), () => {
      const nodes: Node[] = [
        note(
          `${state.rules.length} / 50 alertes · ${state.events.length} notifications / 30 jours${state.warning ? ` · ${state.warning}` : ''}`,
        ),
      ]
      for (const event of state.events.slice(-10).reverse())
        nodes.push(
          note(
            `${event.id} · ${event.rarity} · ${event.direction === 'above' ? '≥' : '≤'} ${event.threshold} W · observé ${event.average} W · ${formatPriceAge(event.at)}`,
            new Date(event.at).toLocaleString('fr-FR'),
          ),
        )
      if (state.events.length > 10)
        nodes.push(note('10 dernières notifications affichées'))
      for (const rule of state.rules) {
        const row = document.createElement('div')
        row.className = 'wm-market-row'
        row.append(
          note(
            `${rule.id} · ${rule.rarity} · ${rule.direction === 'above' ? '≥' : '≤'} ${rule.threshold} W`,
          ),
          button('Détails', () =>
            openPriceInspector(rule.id, rule.rarity, rule.id),
          ),
          button('Supprimer', () => {
            if (!removePriceAlert(rule.id, rule.rarity))
              row.append(note('Stockage des alertes indisponible'))
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
            `${rows.length} variantes${scope === 'collection' && getCollectionState().status !== 'complete' ? ' · index partiel' : ''} · les prix non chargés ne sont pas des échecs`,
          ),
        ]
        for (const row of rows.slice(page * 10, page * 10 + 10)) {
          const node = document.createElement('div')
          node.className = 'wm-market-row'
          const label =
            row.reason === 'error'
              ? 'Erreur / pause'
              : row.reason === 'no-sales'
                ? 'Aucune donnée de vente'
                : 'Introuvable'
          node.append(
            note(row.card.title),
            createRarityBadge(row.card.rarity ?? '?'),
            note(label, presentPrice(row.quote).hint),
            button('Détails', () =>
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
        previous.setAttribute(
          'aria-label',
          'Page précédente des prix manquants',
        )
        next.setAttribute('aria-label', 'Page suivante des prix manquants')
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
      note(`${ids.length} ID du catalogue conservés · partagés entre comptes`),
    ]
    const table = document.createElement('table')
    table.className = 'wm-price-dashboard-table'
    const caption = document.createElement('caption')
    caption.textContent = 'Références par rareté en cache'
    table.append(caption)
    const head = table.createTHead().insertRow()
    for (const label of [
      'Rareté',
      'Connus',
      'Somme W',
      'Anciens / échecs',
      'Aucune vente',
      'Erreur / 404',
      'Non chargés',
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
        row.sum.toLocaleString('fr-FR', { maximumFractionDigits: 2 }),
        row.stale,
        row.missing,
        row.errors,
        row.unloaded,
      ])
        tr.insertCell().textContent = String(value)
    }
    nodes.push(
      table,
      note('Souvent sans prix · au moins 3 jours observés · 10 premiers'),
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
          `${row.missing} / ${row.observed} jours sans données de vente`,
        ),
      )
    nodes.push(
      note(
        'Évolution locale · 10 dernières variantes avec ≥2 observations connues',
      ),
    )
    for (const row of histories
      .filter(row => row.delta !== null)
      .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0))
      .slice(0, 10))
      nodes.push(
        historyRow(
          row.id,
          row.rarity,
          `${row.first?.average} → ${row.last?.average} W · ${(row.delta ?? 0) > 0 ? '+' : ''}${row.delta?.toLocaleString('fr-FR')} W · ${new Date(row.first?.at ?? 0).toLocaleDateString('fr-FR')} → ${new Date(row.last?.at ?? 0).toLocaleDateString('fr-FR')} · ${row.gaps} jours non observés · ${row.missing} jours sans données de vente`,
        ),
      )
    nodes.push(
      note(
        'L’évolution compare la première et la dernière observation réelle, pas des résultats de vente ; ouvrez « Détails » pour le graphique et les trous.',
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
    button('Détails', () => openPriceInspector(id, rarity, id)),
  )
  return row
}
