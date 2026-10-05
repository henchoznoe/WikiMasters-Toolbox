import { getAccountId } from './account'
import { formatDateTime } from './date-format'
import { setLoadingText } from './loading'
import { openPriceInspector } from './price-inspector'
import { RARITIES } from './price-model'
import { presentPrice } from './price-presentation'
import { canRefreshPrice, readPriceQuote, startPriceBatch } from './price-store'
import { confirmPull, pullObservationState } from './pulls-observer'
import {
  pullsStorageUnavailable,
  readLastPull,
  readPullStats,
  resetPullStats,
} from './pulls-store'
import { createRarityBadge } from './rarity'

const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
})
export function createPullsBody(): HTMLElement {
  const body = document.createElement('div')
  body.className = 'wm-panel-body wm-pulls-body'
  const status = document.createElement('p')
  status.className = 'wm-note'
  status.dataset.pullStatus = '1'
  status.setAttribute('role', 'status')
  const manual = document.createElement('button')
  manual.type = 'button'
  manual.className = 'wm-primary-button'
  manual.dataset.pullRecord = '1'
  manual.textContent = 'Enregistrer ce paquet'
  manual.hidden = true
  manual.addEventListener('click', () => {
    void confirmPull()
  })
  const select = document.createElement('select')
  select.dataset.pullPeriod = '1'
  select.setAttribute('aria-label', 'Période des statistiques de paquets')
  for (const [value, text] of [
    ['daily', 'Aujourd’hui'],
    ['cumulative', 'Depuis la dernière remise à zéro'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    select.append(option)
  }
  select.addEventListener('change', renderPullsPanel)
  const stats = document.createElement('div')
  stats.dataset.pullStats = '1'
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'wm-quiet-button'
  reset.textContent = 'Réinitialiser les statistiques'
  reset.dataset.pullReset = '1'
  reset.addEventListener('click', () => {
    const owner = getAccountId()
    if (
      !owner ||
      !window.confirm(
        'Réinitialiser les statistiques du jour et le cumul de ce compte ? Cette action ne peut pas être annulée.',
      ) ||
      getAccountId() !== owner
    )
      return
    void resetPullStats()
  })
  const note = document.createElement('p')
  note.className = 'wm-note'
  note.textContent =
    'Résultats observés par Toolbox · les pourcentages décrivent cet échantillon, pas les probabilités du jeu. Le jour change à minuit à Berne ; le cumul reste conservé.'
  const last = document.createElement('details')
  last.className = 'wm-pull-last'
  last.dataset.pullLast = '1'
  const summary = document.createElement('summary')
  summary.textContent = 'Dernier paquet observé'
  const list = document.createElement('div')
  list.dataset.pullCards = '1'
  const total = document.createElement('p')
  total.className = 'wm-note'
  total.dataset.pullTotal = '1'
  const refresh = document.createElement('button')
  refresh.type = 'button'
  refresh.className = 'wm-quiet-button'
  refresh.dataset.pullRefresh = '1'
  refresh.textContent = 'Actualiser les prix'
  refresh.addEventListener('click', () => {
    const result = readLastPull()
    if (result)
      void startPriceBatch(
        result.cards
          .filter(
            card => card.catalogueId && card.rarity && card.shiny === false,
          )
          .map(card => card.catalogueId as string),
        true,
        5,
      )
  })
  last.append(summary, list, total, refresh)
  body.append(status, manual, select, stats, reset, note, last)
  return body
}
export function renderPullsPanel(): void {
  const root = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-panel="pulls"]',
  )?.shadowRoot
  if (!root) return
  const observation = pullObservationState()
  const status = root.querySelector<HTMLElement>('[data-pull-status]')
  if (status) {
    const text =
      observation.message +
      (pullsStorageUnavailable()
        ? ' · Stockage indisponible : conservation temporaire dans cet onglet'
        : '')
    if (status.textContent !== text) status.textContent = text
  }
  const manual = root.querySelector<HTMLButtonElement>('[data-pull-record]')
  if (manual) manual.hidden = !observation.canRecord
  const owner = getAccountId()
  const reset = root.querySelector<HTMLButtonElement>('[data-pull-reset]')
  if (reset) reset.disabled = !owner
  const period =
    root.querySelector<HTMLSelectElement>('[data-pull-period]')?.value ??
    'daily'
  const stats = readPullStats()
  const counts = period === 'cumulative' ? stats.cumulative : stats.daily
  const container = root.querySelector<HTMLElement>('[data-pull-stats]')
  const signature = JSON.stringify([owner, period, stats])
  if (container && container.dataset.signature !== signature) {
    container.dataset.signature = signature
    const summary = document.createElement('p')
    summary.className = 'wm-pull-summary'
    summary.textContent = `${number.format(counts.packs)} paquet${counts.packs === 1 ? '' : 's'} · ${number.format(counts.cards)} carte${counts.cards === 1 ? '' : 's'}`
    const grid = document.createElement('div')
    grid.className = 'wm-pull-stats'
    for (const rarity of [...RARITIES].reverse()) {
      const tile = document.createElement('div')
      tile.className = 'wm-rarity-surface wm-pull-stat'
      tile.dataset.rarity = rarity.toLowerCase()
      const badge = createRarityBadge(rarity)
      const value = document.createElement('strong')
      value.textContent = number.format(counts.rarities[rarity])
      const ratio = document.createElement('span')
      ratio.textContent = counts.cards
        ? percent.format(counts.rarities[rarity] / counts.cards)
        : '—'
      tile.append(badge, value, ratio)
      grid.append(tile)
    }
    const unknown = document.createElement('p')
    unknown.className = 'wm-note'
    unknown.textContent = `Rareté inconnue : ${number.format(counts.rarities.unknown)}${counts.cards ? ` · ${percent.format(counts.rarities.unknown / counts.cards)}` : ''}`
    const shiny = document.createElement('p')
    shiny.className = 'wm-note'
    shiny.textContent = `Brillantes : ${number.format(counts.shiny)} · brillance indéterminée : ${number.format(counts.unknownShiny)}`
    const since = document.createElement('p')
    since.className = 'wm-note'
    since.textContent = owner
      ? `Début du suivi : ${formatDateTime(stats.since)} · Berne`
      : 'En attente du compte WikiMasters'
    container.replaceChildren(summary, grid, unknown, shiny, since)
  }
  const result = readLastPull()
  const details = root.querySelector<HTMLDetailsElement>('[data-pull-last]')
  if (!details) return
  details.hidden = !result
  if (!result) return
  const list = root.querySelector<HTMLElement>('[data-pull-cards]')
  if (!list) return
  if (list.dataset.result !== result.id) {
    list.dataset.result = result.id
    list.replaceChildren()
    for (const card of result.cards) {
      const row = document.createElement('div')
      row.className = 'wm-pull-card'
      const title = document.createElement('span')
      title.className = 'wm-pull-title'
      title.textContent = card.title
      title.title = card.title
      const variant = document.createElement('small')
      variant.textContent =
        card.shiny === true ? '✦' : card.shiny === null ? '?' : ''
      variant.title =
        card.shiny === true
          ? 'Brillante'
          : card.shiny === null
            ? 'Brillance inconnue'
            : 'Carte non brillante'
      variant.setAttribute('role', 'img')
      variant.setAttribute('aria-label', variant.title)
      variant.hidden = card.shiny === false
      const price = document.createElement('button')
      price.type = 'button'
      price.className = 'wm-price-badge'
      price.addEventListener('click', () => {
        if (card.catalogueId && card.rarity && card.shiny === false)
          openPriceInspector(card.catalogueId, card.rarity, card.title, false)
      })
      row.append(createRarityBadge(card.rarity), title, variant, price)
      list.append(row)
    }
  }
  let total = 0
  let evaluated = 0
  for (const [index, card] of result.cards.entries()) {
    const button = list.children[index]?.querySelector('button')
    if (!button) continue
    const quote =
      card.catalogueId && card.rarity && card.shiny === false
        ? readPriceQuote(card.catalogueId, card.rarity)
        : null
    const presentation = quote ? presentPrice(quote) : null
    const text = presentation
      ? `${presentation.value}${presentation.age ? ` · ${presentation.age}` : ''}`
      : 'Prix inconnu'
    setLoadingText(button, text, quote?.status === 'loading')
    button.disabled = !quote
    button.title =
      presentation?.hint ??
      (card.shiny === true
        ? 'Prix des brillantes inconnu'
        : 'Identité ou variante incertaine · aucun prix déduit')
    button.setAttribute('aria-label', `${card.title} · ${button.title}`)
    if (quote?.status === 'available') {
      total += quote.average
      evaluated += 1
    }
  }
  const totalNode = root.querySelector<HTMLElement>('[data-pull-total]')
  if (totalNode)
    totalNode.textContent = `${formatDateTime(result.observedAt)} · Berne · ${evaluated ? `Sous-total : ${number.format(total)} W` : 'Sous-total inconnu'} · ${evaluated}/5 cartes évaluées`
  const refresh = root.querySelector<HTMLButtonElement>('[data-pull-refresh]')
  if (refresh)
    refresh.disabled = !result.cards.some(
      card =>
        card.catalogueId &&
        card.rarity &&
        card.shiny === false &&
        canRefreshPrice(card.catalogueId),
    )
}
