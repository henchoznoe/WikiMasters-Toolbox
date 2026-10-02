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
    return note('—', 'Price not loaded · use Prices for the loaded collection')
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
  input.setAttribute('aria-label', 'Proposed starting price (W)')
  const duration = document.createElement('select')
  duration.setAttribute('aria-label', 'Proposed sale duration')
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
  const details = section('Most expensive', 'wmRanking')
  details.append(
    note('Load collection, then prices. Missing prices remain visible.'),
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
      `${rows.length} variants · ${rows.filter(row => row.quote.status !== 'available').length} without price${state.status !== 'complete' ? ' · partial index' : ''}`,
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
    copies.setAttribute('aria-label', `Choose copy of ${row.card.title}`)
    for (const copy of row.copies) {
      const option = document.createElement('option')
      option.value = copy.copyId
      option.textContent = `Copy ${copy.copyId.slice(0, 8)}${copy.starred ? ' ★' : ''}${copy.tagIds.length ? ' · tagged' : ''}`
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
    const prepare = button('Prepare sale', () => {
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
    const inspect = button('Inspect', () => inspectCopy(copies.value))
    prepare.disabled = state.status !== 'complete'
    item.append(
      title,
      createRarityBadge(row.card.rarity ?? '?'),
      price(row.card.id, row.card.rarity),
      note(`${row.copies.length} copies${row.card.shiny ? ' · shiny' : ''}`),
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
  previous.setAttribute('aria-label', 'Previous ranking page')
  const next = button('→', () => {
    rankingPage++
    rankingKey = ''
    renderRanking()
  })
  next.disabled = rankingPage + 1 >= pages
  next.setAttribute('aria-label', 'Next ranking page')
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
      `Start ${row.base ?? '—'} W · best ${row.bid ?? '—'} W · ${end}`,
      row.endAt === null
        ? 'End time unavailable'
        : new Date(row.endAt).toLocaleString(),
    ),
    note(
      row.status === 'settled_sold'
        ? `Sold · ${row.final ?? '—'} W`
        : row.status === 'settled_unsold'
          ? 'Unsold'
          : row.status === 'cancelled'
            ? 'Cancelled'
            : row.status === 'active'
              ? 'Active · result unknown'
              : 'Result unknown',
    ),
  )
  return node
}
export function createMarketControls(): HTMLElement {
  const details = section('My sales', 'wmMySales')
  details.append(
    button('Refresh', () => {
      void loadMarket(true)
    }),
    button('Stop', cancelMarketReads),
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
  const comparables = section('Active comparables', 'wmPageComparables')
  const cards = document.createElement('select')
  cards.dataset.wmComparableCard = '1'
  cards.setAttribute('aria-label', 'Card for active comparables')
  cards.addEventListener('change', () => {
    const card = getVisiblePriceCards().find(
      card => cardVariantKey(card) === cards.value,
    )
    if (card) chooseComparables(card)
    renderMarketPanel()
  })
  const order = document.createElement('select')
  order.setAttribute('aria-label', 'Sort active comparables')
  for (const [value, label] of [
    ['end', 'End time'],
    ['price', 'Price'],
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
    button('Search / refresh', () => {
      void loadMarket()
    }),
    button('Stop', cancelMarketReads),
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
        option.textContent = `${card.title} · ${card.rarity ?? '?'}${card.shiny ? ' · shiny' : ''}`
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
                  ? `${state.rows.length} sales · ${new Date(state.at).toLocaleTimeString()}`
                  : 'Refresh to load your sales')),
          'Observed sales only · missing or expired listings do not imply a sale',
        ),
      )
      for (const row of state.rows) list.append(auctionRow(row))
      if (journal) {
        const result = note(
          `Last confirmation: ${journal.status === 'unknown' ? 'uncertain · verify in the game' : journal.status} · ${new Date(journal.at).toLocaleTimeString()}`,
        )
        list.append(result)
        if (journal.auctionId) {
          const link = document.createElement('a')
          link.href = `/marketplace/${journal.auctionId}`
          link.textContent = 'Open confirmed listing'
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
              ? `${rows.length} active · ${state.more ? 'partial search' : '✓'} · ${new Date(state.at).toLocaleTimeString()}`
              : 'Search active comparables')),
      'Same catalogue ID, rarity and shiny status · asking prices are not concluded sales · max 10 pages',
    ),
  )
  for (const row of rows) list.append(auctionRow(row))
  const more = button('More', () => {
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
      note('Copy identity unavailable · reload the game before selling'),
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
    const label = document.createElement('label')
    label.className = 'wm-note'
    label.append(
      acknowledge,
      ' Allow sale of a protected copy (favorite, tagged, shiny or retained)',
    )
    const check = button('Check copy', () => {
      void checkSale(acknowledge.checked)
    })
    check.dataset.wmSaleCheck = '1'
    const refresh = button('↻ price', () => {
      if (getSaleState().card)
        void requestPriceQuote(getSaleState().card?.id ?? '', true)
    })
    refresh.dataset.wmSaleRefresh = '1'
    const draft = draftControls(null)
    draft.body.hidden = true
    const apply = button('Apply proposal', () => {
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
    const comparables = section('Active comparables', 'wmSaleComparables')
    const order = document.createElement('select')
    order.setAttribute('aria-label', 'Sort comparables')
    for (const [value, text] of [
      ['end', 'End time'],
      ['price', 'Price'],
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
      button('Search / refresh', () => {
        chooseComparables(getSaleState().card as NonNullable<typeof state.card>)
        void loadMarket()
      }),
      button('Stop', cancelMarketReads),
      order,
      list,
    )
    body.append(
      summary,
      refresh,
      difference,
      note(
        `Copy ${state.card.copyId?.slice(0, 8)} · 1 copy`,
        'The game alone submits the sale after your confirmation',
      ),
      label,
      check,
      button('Stop', stopSaleCheck),
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
  const quote = presentPrice(readPriceQuote(state.card.id, state.card.rarity))
  const summary = root.querySelector<HTMLElement>('[data-wm-sale-quote]')
  if (summary) {
    summary.textContent = `Average ${quote.value} · ${quote.age || '—'}`
    summary.title = quote.hint
  }
  const difference = root.querySelector<HTMLElement>(
    '[data-wm-sale-difference]',
  )
  if (difference)
    difference.textContent = `Entered vs average: ${priceDifference(Number(input.value), readPriceQuote(state.card.id, state.card.rarity))}`
  const check = root.querySelector<HTMLButtonElement>('[data-wm-sale-check]')
  if (check) {
    check.disabled = state.busy || state.submitted
    check.textContent = state.busy
      ? '…'
      : state.checked
        ? '✓ Check again'
        : 'Check copy'
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
          ? '✓ Confirm in the game within 30 s'
          : 'Check collection / sale / trade protections'))
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
