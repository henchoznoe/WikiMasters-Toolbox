import { getAccountId } from './account'
import {
  readPriceAlerts,
  removePriceAlert,
  setPriceAlert,
} from './price-alerts'
import { currentPriceContext, priceTooOld } from './price-context'
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
  }
  const host = document.createElement('div')
  host.dataset.wmPriceInspector = '1'
  const root = createToolboxRoot(host)
  const dialog = document.createElement('section')
  dialog.className = 'wm-price-inspector'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', `Prix · ${title}`)
  const header = document.createElement('div')
  header.className = 'wm-price-inspector-header'
  const heading = document.createElement('h2')
  heading.textContent = title
  const close = button('×', 'Fermer le détail des prix', closePriceInspector)
  header.append(heading, close)
  const rarities = document.createElement('div')
  rarities.className = 'wm-price-rarities'
  for (const r of RARITIES) {
    const control = button('', `Prix pour ${r}`, () => {
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
    button('↻', 'Actualiser cette carte · une tentative par minute', () => {
      void requestPriceQuote(id, true)
    }),
  )
  actions.firstElementChild?.setAttribute('data-price-refresh', '1')
  const alert = document.createElement('details')
  alert.className = 'wm-price-method'
  const alertHeading = document.createElement('summary')
  alertHeading.textContent = 'Alerte de prix · moyenne native par rareté'
  const direction = document.createElement('select')
  direction.setAttribute('aria-label', 'Sens de l’alerte de prix')
  for (const [value, label] of [
    ['above', 'Franchit à la hausse ≥'],
    ['below', 'Franchit à la baisse ≤'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    direction.append(option)
  }
  const threshold = document.createElement('input')
  threshold.type = 'number'
  threshold.min = '0'
  threshold.step = 'any'
  threshold.setAttribute('aria-label', 'Seuil de l’alerte de prix (W)')
  const alertStatus = document.createElement('p')
  alertStatus.className = 'wm-note'
  alertStatus.setAttribute('role', 'status')
  const saveAlert = button(
    'Enregistrer l’alerte',
    'Enregistrer l’alerte pour cette rareté',
    () => {
      if (!selected) return
      const quote = readPriceQuote(selected.id, selected.rarity)
      alertStatus.textContent = setPriceAlert({
        id: selected.id,
        rarity: selected.rarity,
        threshold: Number(threshold.value),
        direction: direction.value === 'below' ? 'below' : 'above',
        previous:
          quote.status === 'available' && !quote.stale && !quote.failed
            ? quote.average
            : null,
        at: Date.now(),
      })
      removeAlert.disabled = !readPriceAlerts().rules.some(
        row => row.id === selected?.id && row.rarity === selected?.rarity,
      )
    },
  )
  const removeAlert = button(
    'Supprimer l’alerte',
    'Supprimer l’alerte pour cette rareté',
    () => {
      if (selected)
        alertStatus.textContent = removePriceAlert(selected.id, selected.rarity)
          ? 'Alerte supprimée'
          : 'Stockage des alertes indisponible'
      removeAlert.disabled = !readPriceAlerts().rules.some(
        row => row.id === selected?.id && row.rarity === selected?.rarity,
      )
    },
  )
  const syncAlert = () => {
    const saved = readPriceAlerts().rules.find(
      row => row.id === selected?.id && row.rarity === selected?.rarity,
    )
    threshold.value = saved ? String(saved.threshold) : ''
    direction.value = saved?.direction ?? 'above'
    saveAlert.disabled = shiny || !getAccountId()
    removeAlert.disabled = !saved
    alertStatus.textContent = shiny
      ? 'Prix des brillantes indisponible · aucune alerte déduite'
      : !getAccountId()
        ? 'Connectez-vous pour enregistrer des alertes'
        : 'Observations fraîches de Toolbox uniquement · aucune surveillance continue · la première lecture connue établit la référence ; l’absence de données de vente la réinitialise.'
  }
  alert.addEventListener('toggle', syncAlert)
  rarities.addEventListener('click', syncAlert)
  alert.append(
    alertHeading,
    direction,
    threshold,
    saveAlert,
    removeAlert,
    alertStatus,
  )
  syncAlert()
  const method = document.createElement('details')
  method.className = 'wm-price-method'
  const summary = document.createElement('summary')
  summary.textContent = 'Méthode'
  method.append(summary)
  for (const text of [
    'Moyenne : récapitulatif WikiMasters pour cette rareté, période et volume inconnus. Âge : date de lecture, pas de vente. La surcote des brillantes n’est pas exposée. Fraîcheur : 24 h pour l’album ; 15 min pour la vente / l’échange. L’âge original est conservé si l’actualisation échoue. Graphique local : une moyenne observée par jour UTC sur les 90 derniers jours ; les jours absents restent des trous.',
    'Échantillon de ventes : ventes explicitement conclues avec montant final, fin d’enchère, rareté et variante brillante au moment de la vente, issues de l’historique natif gratuit ou des enchères consultées. Un résultat par enchère, pour le même ID du catalogue, la même rareté et la même variante brillante. Les 30 derniers jours selon la fin d’enchère ; jusqu’à 1 000 résultats par compte.',
    'Médiane : au moins 5 ventes conclues sur 3 jours UTC distincts. Fourchette indicative Q1–Q3 : au moins 10 ventes sur 3 jours, interpolation linéaire, moitié centrale des prix observés. Valeurs extrêmes : hors de Q1 − 1,5×écart interquartile / Q3 + 1,5×écart interquartile ; elles restent dans le calcul de la médiane.',
    'Ces seuils minimaux permettent l’affichage sans prouver la couverture du marché. Le volume observé est incomplet. L’échantillon peut être biaisé : la fourchette n’est ni un intervalle de confiance ni une prédiction.',
  ]) {
    const explanation = document.createElement('p')
    explanation.className = 'wm-note'
    explanation.textContent = text
    method.append(explanation)
  }
  dialog.append(
    header,
    rarities,
    value,
    actions,
    alert,
    sample,
    history,
    method,
  )
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
    'Observations locales du prix moyen ; les jours manquants restent des trous',
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
    title.textContent = `${new Date(point.at).toLocaleString('fr-FR')} · ${point.average} W`
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
  const { id, rarity, shiny } = selected
  const context = currentPriceContext()
  const quote = readPriceQuote(id, rarity)
  const refresh = root.querySelector<HTMLButtonElement>('[data-price-refresh]')
  if (refresh) {
    refresh.disabled = !canRefreshPrice(id)
    refresh.textContent =
      context === 'decision' && priceTooOld(quote, context)
        ? '↻ Actualiser avant de décider'
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
      new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
    const lines = [
      `Ventes conclues observées · ${rarity} · ${shiny ? 'brillante' : 'normale'} · ${estimate.count} / 30 jours · ${estimate.days} jours UTC`,
      estimate.median === null
        ? 'Médiane — · nécessite 5 ventes sur 3 jours distincts'
        : `Médiane locale ${money(estimate.median)} W · ${estimate.extremes} valeurs extrêmes conservées`,
      estimate.range
        ? `Fourchette indicative Q1–Q3 : ${money(estimate.range[0])}–${money(estimate.range[1])} W · échantillon incomplet`
        : 'Fourchette — · nécessite 10 ventes sur 3 jours distincts',
      estimate.oldest && estimate.newest
        ? `Fins d’enchères : ${new Date(estimate.oldest).toLocaleDateString('fr-FR')} – ${new Date(estimate.newest).toLocaleDateString('fr-FR')} · dernière le ${new Date(estimate.newest).toLocaleString('fr-FR')}`
        : 'Consultez l’historique gratuit du marché / les ventes conclues pour constituer un échantillon',
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
      ? `${points.length} observation${points.length === 1 ? '' : 's'} locale${points.length === 1 ? '' : 's'}${gaps ? ` · ${gaps} jours manquants` : ''}${unpriced ? ` · ${unpriced} sans données de vente` : ''} · ${new Date(points[0].at).toLocaleDateString('fr-FR')} – ${new Date(points.at(-1)?.at ?? 0).toLocaleDateString('fr-FR')}${known.length ? ` · ${Math.min(...known)}–${Math.max(...known)} W` : ''}`
      : 'Aucune observation locale pour le moment'
    history.append(caption)
  }
}
