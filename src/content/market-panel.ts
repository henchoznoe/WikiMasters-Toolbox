import { cardVariantKey } from '../cards'
import { getAccountId } from './account'
import { getCollectionState } from './collection'
import {
  type Auction,
  comparableAuctions,
  priceDifference,
  rankCollection,
  SALE_DURATIONS,
  validSaleDraft,
} from './market-model'
import {
  cancelMarketReads,
  chooseComparables,
  getMarketState,
  loadMarket,
} from './market-store'
import { statusLabel } from './presentation'
import { createPriceControls, renderPricePanel } from './price-panel'
import { presentPrice } from './price-presentation'
import {
  canRefreshPrice,
  readPriceQuote,
  requestPriceQuote,
} from './price-store'
import { getVisiblePriceCards } from './prices'
import { createRarityBadge } from './rarity'
import {
  checkSale,
  getSaleState,
  inspectCopy,
  nativeMarket,
  readSaleJournal,
  requireSaleCheck,
  stopSaleCheck,
} from './sale'
import { createToolboxRoot } from './shared'

let rankingPage = 0
let rankingKey = ''
const rankingDrafts = new Map<
  string,
  { copyId: string; amount: string; duration: string }
>()
let saleHost: HTMLElement | null = null
let sort: 'end' | 'price' = 'end'
let pending: { copyId: string; amount: number; duration: number } | null = null
function button(text: string, click: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = 'wm-quiet-button'
  node.textContent = text
  node.addEventListener('click', click)
  return node
}
function note(text: string, hint = ''): HTMLParagraphElement {
  const node = document.createElement('p')
  node.className = 'wm-note'
  node.textContent = text
  node.title = hint
  return node
}
function section(title: string, key: string): HTMLDetailsElement {
  const node = document.createElement('details')
  node.className = 'wm-market-section'
  node.dataset[key] = '1'
  const summary = document.createElement('summary')
  summary.textContent = title
  node.append(summary)
  return node
}
function price(id: string, rarity: string | null): HTMLElement {
  const quote = presentPrice(readPriceQuote(id, rarity))
  if (quote.status === 'loading')
    return note(
      '—',
      'Prix non chargé · utilisez « Prix » pour la collection chargée',
    )
  return note(`${quote.value}${quote.age ? ` · ${quote.age}` : ''}`, quote.hint)
}
function draftControls(amount: number | null): {
  body: HTMLElement
  amount: HTMLInputElement
  duration: HTMLSelectElement
} {
  const body = document.createElement('div')
  body.className = 'wm-market-draft'
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '1'
  input.step = '1'
  input.placeholder = '—'
  input.value = amount === null ? '' : String(Math.max(1, Math.ceil(amount)))
  input.setAttribute('aria-label', 'Mise de départ proposée (W)')
  const duration = document.createElement('select')
  duration.setAttribute('aria-label', 'Durée de vente proposée')
  for (const value of SALE_DURATIONS) {
    const option = document.createElement('option')
    option.value = String(value)
    option.textContent = value < 60 ? `${value} min` : `${value / 60} h`
    duration.append(option)
  }
  duration.value = '60'
  body.append(input, duration)
  return { body, amount: input, duration }
}
export function createRankingControls(): HTMLElement {
  const details = section('Les plus chères', 'wmRanking')
  details.append(
    note(
      'Chargez la collection, puis les prix. Les prix manquants restent visibles.',
    ),
  )
  const content = document.createElement('div')
  content.dataset.wmRankingBody = '1'
  details.append(content)
  details.addEventListener('toggle', renderRanking)
  return details
}
export function renderRanking(): void {
  const root = document.querySelector(
    '[data-wm-toolbox-panel="collection"]',
  )?.shadowRoot
  const details = root?.querySelector<HTMLDetailsElement>('[data-wm-ranking]')
  const body = root?.querySelector<HTMLElement>('[data-wm-ranking-body]')
  if (!body || !details?.open) return
  const state = getCollectionState()
  const rows = rankCollection(state.cards, readPriceQuote)
  const pages = Math.max(1, Math.ceil(rows.length / 10))
  rankingPage = Math.min(rankingPage, pages - 1)
  const key = JSON.stringify([
    getAccountId(),
    rankingPage,
    state.status,
    state.updatedAt,
    Math.floor(Date.now() / 60_000),
    rows.map(row => [row.card.copyId, row.copies.length, row.quote]),
  ])
  if (key === rankingKey && body.childElementCount) return
  if (
    root?.activeElement?.matches('input, select') &&
    body.contains(root.activeElement)
  )
    return
  for (const item of body.querySelectorAll<HTMLElement>(
    '[data-ranking-variant]',
  )) {
    const selected = item.querySelector<HTMLSelectElement>(
      '[data-ranking-copy]',
    )
    const amount = item.querySelector<HTMLInputElement>(
      '.wm-market-draft input',
    )
    const duration = item.querySelector<HTMLSelectElement>(
      '.wm-market-draft select',
    )
    if (selected && amount && duration)
      rankingDrafts.set(item.dataset.rankingVariant ?? '', {
        copyId: selected.value,
        amount: amount.value,
        duration: duration.value,
      })
  }
  rankingKey = key
  const fragment = document.createDocumentFragment()
  fragment.append(
    note(
      `${rows.length} variantes · ${rows.filter(row => row.quote.status !== 'available').length} sans prix${state.status !== 'complete' ? ' · index partiel' : ''}`,
    ),
  )
  for (const [offset, row] of rows
    .slice(rankingPage * 10, rankingPage * 10 + 10)
    .entries()) {
    const item = document.createElement('div')
    item.className = 'wm-market-row'
    const variant = cardVariantKey(row.card)
    item.dataset.rankingVariant = variant
    const title = document.createElement('strong')
    title.textContent = `${rankingPage * 10 + offset + 1}. ${row.card.title}`
    const copies = document.createElement('select')
    copies.dataset.rankingCopy = '1'
    copies.setAttribute('aria-label', `Choisir une copie de ${row.card.title}`)
    for (const copy of row.copies) {
      const option = document.createElement('option')
      option.value = copy.copyId
      option.textContent = `Copie ${copy.copyId.slice(0, 8)}${copy.starred ? ' ★' : ''}${copy.tagIds.length ? ' · avec étiquette' : ''}`
      copies.append(option)
    }
    const controls = draftControls(
      row.quote.status === 'available' ? row.quote.average : null,
    )
    const savedDraft = rankingDrafts.get(variant)
    if (savedDraft) {
      if (row.copies.some(copy => copy.copyId === savedDraft.copyId))
        copies.value = savedDraft.copyId
      controls.amount.value = savedDraft.amount
      controls.duration.value = savedDraft.duration
    }
    const prepare = button('Préparer la vente', () => {
      const amount = Number(controls.amount.value),
        duration = Number(controls.duration.value)
      if (!validSaleDraft(amount, duration)) {
        controls.amount.reportValidity()
        return
      }
      pending = { copyId: copies.value, amount, duration }
      nativeMarket('inspect', {
        copyId: copies.value,
        title: row.card.title,
        sale: true,
      })
    })
    const inspect = button('Inspecter', () => inspectCopy(copies.value))
    prepare.disabled = state.status !== 'complete'
    item.append(
      title,
      createRarityBadge(row.card.rarity ?? '?'),
      price(row.card.id, row.card.rarity),
      note(
        `${row.copies.length} copies${row.card.shiny ? ' · brillante' : ''}`,
      ),
      copies,
      inspect,
      controls.body,
      prepare,
    )
    fragment.append(item)
  }
  const navigation = document.createElement('div')
  navigation.className = 'wm-selection-pagination'
  const previous = button('←', () => {
    rankingPage--
    rankingKey = ''
    renderRanking()
  })
  previous.disabled = rankingPage === 0
  previous.setAttribute('aria-label', 'Page précédente du classement')
  const next = button('→', () => {
    rankingPage++
    rankingKey = ''
    renderRanking()
  })
  next.disabled = rankingPage + 1 >= pages
  next.setAttribute('aria-label', 'Page suivante du classement')
  navigation.append(previous, note(`${rankingPage + 1} / ${pages}`), next)
  fragment.append(navigation)
  body.replaceChildren(fragment)
}
function auctionRow(row: Auction): HTMLElement {
  const node = document.createElement('div')
  node.className = 'wm-market-row'
  const link = document.createElement('a')
  link.href = `/marketplace/${row.id}`
  link.textContent = row.card.title
  const end =
    row.endAt === null
      ? '—'
      : row.endAt <= Date.now()
        ? 'ended'
        : `${Math.ceil((row.endAt - Date.now()) / 60_000)} min`
  node.append(
    link,
    createRarityBadge(row.card.rarity ?? '?'),
    note(
      `Départ ${row.base ?? '—'} W · meilleure offre ${row.bid ?? '—'} W · ${end}`,
      row.endAt === null
        ? 'Heure de fin indisponible'
        : new Date(row.endAt).toLocaleString('fr-FR'),
    ),
    note(
      row.status === 'settled_sold'
        ? `Vendue · ${row.final ?? '—'} W`
        : row.status === 'settled_unsold'
          ? 'Invendue'
          : row.status === 'cancelled'
            ? 'Annulée'
            : row.status === 'active'
              ? 'Active · résultat inconnu'
              : 'Résultat inconnu',
    ),
  )
  return node
}
export function createMarketControls(): HTMLElement {
  const details = section('Mes ventes', 'wmMySales')
  details.append(
    button('Actualiser', () => {
      void loadMarket(true)
    }),
    button('Arrêter', cancelMarketReads),
  )
  const list = document.createElement('div')
  list.dataset.wmSalesList = '1'
  details.append(list)
  details.addEventListener('toggle', renderMarketPanel)
  return details
}
export function createMarketBody(): HTMLElement {
  const body = document.createElement('div')
  body.className = 'wm-panel-body'
  const comparables = section(
    'Annonces comparables actives',
    'wmPageComparables',
  )
  const cards = document.createElement('select')
  cards.dataset.wmComparableCard = '1'
  cards.setAttribute('aria-label', 'Carte des annonces comparables actives')
  cards.addEventListener('change', () => {
    const card = getVisiblePriceCards().find(
      card => cardVariantKey(card) === cards.value,
    )
    if (card) chooseComparables(card)
    renderMarketPanel()
  })
  const order = document.createElement('select')
  order.setAttribute('aria-label', 'Trier les annonces comparables actives')
  for (const [value, label] of [
    ['end', 'Fin'],
    ['price', 'Prix'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    order.append(option)
  }
  order.addEventListener('change', () => {
    sort = order.value === 'price' ? 'price' : 'end'
    renderMarketPanel()
  })
  const list = document.createElement('div')
  list.dataset.wmComparables = '1'
  comparables.append(
    cards,
    button('Rechercher / actualiser', () => {
      void loadMarket()
    }),
    button('Arrêter', cancelMarketReads),
    order,
    list,
  )
  body.append(createMarketControls(), comparables, createPriceControls())
  return body
}
export function renderMarketPanel(): void {
  const root = document.querySelector('[data-wm-toolbox-panel]')?.shadowRoot
  const list = root?.querySelector<HTMLElement>('[data-wm-sales-list]')
  const state = getMarketState().mine
  const journal = readSaleJournal()
  const selector = root?.querySelector<HTMLSelectElement>(
    '[data-wm-comparable-card]',
  )
  if (selector && root) {
    const cards = [
      ...new Map(
        getVisiblePriceCards().map(card => [cardVariantKey(card), card]),
      ).values(),
    ]
    const signature = JSON.stringify(cards)
    if (selector.dataset.key !== signature) {
      selector.dataset.key = signature
      selector.replaceChildren()
      for (const card of cards) {
        const option = document.createElement('option')
        option.value = cardVariantKey(card)
        option.textContent = `${card.title} · ${card.rarity ?? '?'}${card.shiny ? ' · brillante' : ''}`
        selector.append(option)
      }
      const current = getMarketState().target
      if (
        current &&
        cards.some(card => cardVariantKey(card) === cardVariantKey(current))
      )
        selector.value = cardVariantKey(current)
      else if (cards[0]) chooseComparables(cards[0])
    }
    renderComparables(root)
  }
  if (
    list &&
    root?.querySelector<HTMLDetailsElement>('[data-wm-my-sales]')?.open
  ) {
    const key = JSON.stringify([
      state.at,
      state.error,
      state.loading,
      getAccountId(),
      journal,
      Math.floor(Date.now() / 60_000),
    ])
    if (list.dataset.key !== key) {
      list.dataset.key = key
      list.replaceChildren(
        note(
          state.loading
            ? '…'
            : (state.error ??
                (state.at
                  ? `${state.rows.length} ventes · ${new Date(state.at).toLocaleTimeString('fr-FR')}`
                  : 'Actualisez pour charger vos ventes')),
          'Ventes observées uniquement · une annonce absente ou expirée ne prouve pas une vente',
        ),
      )
      for (const row of state.rows) list.append(auctionRow(row))
      if (journal) {
        const result = note(
          `Dernière confirmation : ${journal.status === 'unknown' ? 'incertaine · vérifiez dans le jeu' : statusLabel(journal.status)} · ${new Date(journal.at).toLocaleTimeString('fr-FR')}`,
        )
        list.append(result)
        if (journal.auctionId) {
          const link = document.createElement('a')
          link.href = `/marketplace/${journal.auctionId}`
          link.textContent = 'Ouvrir l’annonce confirmée'
          list.append(link)
        }
      }
    }
  }
  renderPricePanel()
  renderRanking()
  renderSaleSupport()
}
function renderComparables(root: ShadowRoot): void {
  const list = root.querySelector<HTMLElement>('[data-wm-comparables]')
  const { comparable: state, target } = getMarketState()
  if (!list || !target) return
  const key = JSON.stringify([
    state.at,
    state.error,
    state.loading,
    sort,
    target.id,
    target.rarity,
    Math.floor(Date.now() / 60_000),
  ])
  if (list.dataset.key === key) return
  list.dataset.key = key
  const rows = comparableAuctions(state.rows, target, sort)
  list.replaceChildren(
    note(
      state.loading
        ? '…'
        : (state.error ??
            (state.at
              ? `${rows.length} actives · ${state.more ? 'recherche partielle' : '✓'} · ${new Date(state.at).toLocaleTimeString('fr-FR')}`
              : 'Rechercher des annonces comparables actives')),
      'Même ID du catalogue, rareté et variante brillante · les prix demandés ne sont pas des ventes conclues · max 10 pages',
    ),
  )
  for (const row of rows) list.append(auctionRow(row))
  const more = button('Suite', () => {
    void loadMarket(false, true)
  })
  more.disabled = state.loading || !state.more || state.page >= 10 || !state.at
  list.append(more)
}
export function renderSaleSupport(): void {
  const state = getSaleState()
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Mise de départ"]',
  )
  const frame = input?.closest<HTMLElement>('.card-frame')
  if (!frame || !input) {
    saleHost?.remove()
    saleHost = null
    return
  }
  if (!state.card) {
    if (saleHost?.isConnected && saleHost.dataset.copyId === '') return
    saleHost?.remove()
    saleHost = document.createElement('div')
    saleHost.dataset.wmSaleSupport = '1'
    saleHost.dataset.copyId = ''
    const body = document.createElement('section')
    body.className = 'wm-sale-support'
    body.append(
      note(
        'Identité de la copie indisponible · rechargez le jeu avant de vendre',
      ),
    )
    createToolboxRoot(saleHost).append(body)
    frame.append(saleHost)
    return
  }
  if (!saleHost?.isConnected || saleHost.dataset.copyId !== state.card.copyId) {
    saleHost?.remove()
    saleHost = document.createElement('div')
    saleHost.dataset.wmSaleSupport = '1'
    saleHost.dataset.copyId = state.card.copyId ?? ''
    const root = createToolboxRoot(saleHost)
    const body = document.createElement('section')
    body.className = 'wm-sale-support'
    const summary = note('')
    summary.dataset.wmSaleQuote = '1'
    const difference = note('')
    difference.dataset.wmSaleDifference = '1'
    const checkNote = note('')
    checkNote.dataset.wmSaleNote = '1'
    checkNote.setAttribute('role', 'status')
    const acknowledge = document.createElement('input')
    acknowledge.type = 'checkbox'
    acknowledge.dataset.wmSaleAcknowledge = '1'
    acknowledge.addEventListener('change', requireSaleCheck)
    const label = document.createElement('label')
    label.className = 'wm-note'
    label.append(
      acknowledge,
      ' Autoriser la vente d’une copie protégée (favori, étiquette, brillante ou conservée)',
    )
    const check = button('Vérifier la copie', () => {
      void checkSale(acknowledge.checked)
    })
    check.dataset.wmSaleCheck = '1'
    const refresh = button('↻ prix', () => {
      if (getSaleState().card)
        void requestPriceQuote(getSaleState().card?.id ?? '', true)
    })
    refresh.dataset.wmSaleRefresh = '1'
    refresh.title =
      'Actualisez cette carte avant de décider · les prix de vente doivent dater de moins de 15 min'
    const draft = draftControls(null)
    draft.body.hidden = true
    const apply = button('Appliquer la proposition', () => {
      if (!pending || pending.copyId !== getSaleState().card?.copyId) return
      const amount = Number(draft.amount.value),
        duration = Number(draft.duration.value)
      if (validSaleDraft(amount, duration))
        nativeMarket('fill', { copyId: pending.copyId, amount, duration })
    })
    if (pending?.copyId === state.card.copyId) {
      draft.amount.value = String(pending.amount)
      draft.duration.value = String(pending.duration)
      draft.body.hidden = false
    } else apply.hidden = true
    const comparables = section(
      'Annonces comparables actives',
      'wmSaleComparables',
    )
    const order = document.createElement('select')
    order.setAttribute('aria-label', 'Trier les annonces comparables')
    for (const [value, text] of [
      ['end', 'Fin'],
      ['price', 'Prix'],
    ]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      order.append(option)
    }
    order.value = sort
    order.addEventListener('change', () => {
      sort = order.value === 'price' ? 'price' : 'end'
      renderSaleSupport()
    })
    const list = document.createElement('div')
    list.dataset.wmComparables = '1'
    comparables.append(
      button('Rechercher / actualiser', () => {
        chooseComparables(getSaleState().card as NonNullable<typeof state.card>)
        void loadMarket()
      }),
      button('Arrêter', cancelMarketReads),
      order,
      list,
    )
    body.append(
      summary,
      refresh,
      difference,
      note(
        `Copie ${state.card.copyId?.slice(0, 8)} · 1 copie`,
        'Le jeu envoie la vente après votre confirmation',
      ),
      label,
      check,
      button('Arrêter', stopSaleCheck),
      checkNote,
      draft.body,
      apply,
      comparables,
    )
    root.append(body)
    frame.append(saleHost)
    input.addEventListener('input', renderSaleSupport)
  }
  const root = saleHost.shadowRoot
  if (!root) return
  const quote = presentPrice(
    readPriceQuote(state.card.id, state.card.rarity),
    'decision',
  )
  const summary = root.querySelector<HTMLElement>('[data-wm-sale-quote]')
  if (summary) {
    summary.textContent = `Moyenne ${quote.value} · ${quote.age || '—'} · fraîcheur de 15 min`
    summary.title = quote.hint
  }
  const difference = root.querySelector<HTMLElement>(
    '[data-wm-sale-difference]',
  )
  if (difference)
    difference.textContent = `Saisie / moyenne : ${priceDifference(Number(input.value), readPriceQuote(state.card.id, state.card.rarity))}`
  const check = root.querySelector<HTMLButtonElement>('[data-wm-sale-check]')
  if (check) {
    check.disabled = state.busy || state.submitted
    check.textContent = state.busy
      ? '…'
      : state.checked
        ? '✓ Vérifier à nouveau'
        : 'Vérifier la copie'
  }
  const refresh = root.querySelector<HTMLButtonElement>(
    '[data-wm-sale-refresh]',
  )
  if (refresh) refresh.disabled = !canRefreshPrice(state.card.id)
  const status = root.querySelector<HTMLElement>('[data-wm-sale-note]')
  if (status)
    status.textContent = state.submitted
      ? '…'
      : (state.error ??
        (state.checked
          ? '✓ Confirmez dans le jeu sous 30 s'
          : 'Vérifiez la collection et les protections de vente / échange'))
  renderComparables(root)
}
export function resetMarketPanel(): void {
  pending = null
  rankingPage = 0
  rankingKey = ''
  rankingDrafts.clear()
  saleHost?.remove()
  saleHost = null
}
