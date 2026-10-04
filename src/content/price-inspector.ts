import { formatDate, formatDateTime } from './date-format'
import { setLoadingText } from './loading'
import { currentPriceContext, priceTooOld } from './price-context'
import { createPriceGraph } from './price-graph'
import { RARITIES } from './price-model'
import { presentPrice, priceFreshness } from './price-presentation'
import {
  canRefreshPrice,
  isPriceLoading,
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
    control.className = 'wm-price-rarity wm-rarity-surface'
    control.dataset.rarity = r.toLowerCase()
    control.dataset.priceRarity = r
    control.append(createRarityBadge(r))
    rarities.append(control)
  }
  const value = document.createElement('p')
  value.dataset.priceInspectorValue = '1'
  const freshness = document.createElement('p')
  freshness.className = 'wm-price-freshness'
  freshness.dataset.priceFreshness = '1'
  freshness.setAttribute('role', 'status')
  const history = document.createElement('div')
  history.dataset.priceHistory = '1'
  const sample = document.createElement('div')
  sample.dataset.priceSalesSample = '1'
  const actions = document.createElement('div')
  actions.className = 'wm-price-actions'
  actions.append(
    button('↻', 'Actualiser cette carte · une tentative par minute', () => {
      void requestPriceQuote(id, true)
    }),
  )
  if (actions.firstElementChild)
    actions.firstElementChild.className = 'wm-primary-button'
  actions.firstElementChild?.setAttribute('data-price-refresh', '1')
  const method = document.createElement('details')
  method.className = 'wm-price-method'
  const summary = document.createElement('summary')
  summary.textContent = 'Méthode'
  method.append(summary)
  for (const text of [
    'Moyenne : récapitulatif WikiMasters pour cette rareté, période et volume inconnus. Âge : date de lecture, pas de vente. La surcote des brillantes n’est pas exposée. Fraîcheur : 24 h pour l’album ; 15 min pour la vente / l’échange. L’âge original est conservé si l’actualisation échoue. Graphique local : une moyenne observée par jour UTC sur les 90 derniers jours ; les jours absents restent des trous. Les dates et heures sont affichées dans le fuseau de Berne (UTC+2 en été, UTC+1 en hiver).',
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
    freshness,
    actions,
    history,
    sample,
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
    setLoadingText(
      refresh,
      isPriceLoading(id)
        ? 'Actualisation en cours'
        : context === 'decision' && priceTooOld(quote, context)
          ? '↻ Actualiser avant de décider'
          : '↻ Actualiser',
      isPriceLoading(id),
    )
  }
  const presentation = presentPrice(quote, context, shiny)
  const freshness = root.querySelector<HTMLElement>('[data-price-freshness]')
  const state = priceFreshness(quote, context)
  if (freshness) {
    freshness.textContent = shiny
      ? 'Variante brillante · moyenne native et graphe indisponibles'
      : state.text
    freshness.dataset.warning = String(shiny || state.warning)
  }
  const value = root.querySelector<HTMLElement>('[data-price-inspector-value]')
  if (value) {
    setLoadingText(
      value,
      `${presentation.value}${presentation.age ? ` · ${presentation.age}` : ''}`,
      !shiny && (presentation.status === 'loading' || isPriceLoading(id)),
    )
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
        ? `Fins d’enchères : ${formatDate(estimate.oldest)} – ${formatDate(estimate.newest)} · dernière le ${formatDateTime(estimate.newest)}`
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
    if (shiny) {
      const caption = document.createElement('p')
      caption.className = 'wm-note'
      caption.textContent =
        'Aucun historique distinct des brillantes exposé par la moyenne native'
      history.append(caption)
    } else history.append(createPriceGraph(points))
  }
}
