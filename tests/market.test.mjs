import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const AUCTION = '33333333-3333-4333-8333-333333333333'
const CARD = {
  id: 'catalogue',
  title: 'Same title',
  rarity: 'R',
  copyId: 'copy-a',
  shiny: false,
}
const copy = (extra = {}) => ({
  ...CARD,
  ownerId: OWNER,
  starred: false,
  tagIds: [],
  obtainedAt: null,
  ...extra,
})
const row = (extra = {}) => ({
  id: AUCTION,
  card_id: CARD.id,
  user_card_id: CARD.copyId,
  snapshot_rarity: 'R',
  card: { id: CARD.id, wikipedia_title: CARD.title, rarity: 'L' },
  is_shiny: false,
  seller_id: OWNER,
  base_amount: 10,
  current_bid: null,
  end_at: new Date(Date.now() + 3600_000).toISOString(),
  status: 'active',
  ...extra,
})
const json = data => new Response(JSON.stringify(data))
async function expose(module, names, context = {}, extra = '') {
  const result = await build({
    stdin: {
      contents: `import {${names}} from './src/${module}.ts'; Object.assign(globalThis,{${names}}); ${extra}`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    write: false,
    define: { WM_TOOLBOX_CSS: '""' },
  })
  Object.assign(context, { AbortController, AbortSignal, URL })
  vm.runInNewContext(result.outputFiles[0].text, context)
  return context
}
function memory() {
  const map = new Map()
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
  }
}
function events() {
  const handlers = new Map()
  return {
    addEventListener(name, fn) {
      handlers.set(name, [...(handlers.get(name) ?? []), fn])
    },
    dispatchEvent(event) {
      for (const fn of handlers.get(event.type) ?? []) fn(event)
      return !event.defaultPrevented
    },
  }
}
class Event {
  constructor(type, options = {}) {
    this.type = type
    Object.assign(this, options)
    this.defaultPrevented = false
  }
  preventDefault() {
    this.defaultPrevented = true
  }
  stopImmediatePropagation() {
    this.stopped = true
  }
}

test('ranking groups exact variants, includes missing prices and never substitutes rarities', async () => {
  const c = await expose(
    'content/market-model',
    'rankCollection,priceDifference',
  )
  const cards = [
    copy(),
    copy({ copyId: 'copy-b' }),
    copy({ copyId: 'copy-c', rarity: 'C' }),
    copy({ copyId: 'copy-d', shiny: true }),
    copy({ id: 'other', copyId: 'copy-e' }),
  ]
  const ranked = c.rankCollection(cards, (id, rarity) =>
    id === 'other'
      ? { status: 'available', average: 80, fetchedAt: 1 }
      : rarity === 'R'
        ? { status: 'available', average: 10, fetchedAt: 1 }
        : { status: 'no-sales', fetchedAt: 1 },
  )
  assert.equal(ranked.length, 4)
  assert.equal(ranked[0].card.id, 'other')
  assert.equal(ranked.at(-1).card.rarity, 'C')
  assert.equal(ranked.find(r => r.card.copyId === 'copy-a').copies.length, 2)
  assert.equal(
    c.priceDifference(15, { status: 'available', average: 10, fetchedAt: 1 }),
    '+5 W · +50,0 %',
  )
  assert.equal(
    c.priceDifference(15, { status: 'available', average: 0, fetchedAt: 1 }),
    '+15 W',
  )
  assert.equal(c.priceDifference(15, { status: 'no-sales', fetchedAt: 1 }), '—')
})
test('active comparables require exact catalogue, rarity, shiny and active end time', async () => {
  const c = await expose(
    'content/market-model',
    'mapAuction,comparableAuctions,validSaleDraft,saleBlock',
  )
  const rows = [
    row(),
    row({ id: OTHER, base_amount: 5 }),
    row({ snapshot_rarity: 'C' }),
    row({
      card_id: 'other',
      card: { id: 'other', wikipedia_title: CARD.title, rarity: 'R' },
    }),
    row({ is_shiny: true }),
    row({ status: 'settled_sold' }),
    row({ end_at: new Date(Date.now() - 1).toISOString() }),
    row({ end_at: null }),
  ].map(c.mapAuction)
  assert.equal(c.comparableAuctions(rows, CARD, 'price').length, 2)
  assert.equal(c.comparableAuctions(rows, CARD, 'price')[0].id, OTHER)
  assert.equal(c.mapAuction(row({ card_id: 'wrong' })), null)
  assert.equal(c.mapAuction(row({ base_amount: '999' })).base, null)
  assert.equal(c.validSaleDraft(10, 60), true)
  assert.equal(c.validSaleDraft(1.5, 60), false)
  assert.equal(c.validSaleDraft(10, 999), false)
  assert.equal(
    c.saleBlock(copy(), OWNER, {
      copyIds: new Set(['copy-a']),
      catalogueIds: new Set(),
    }),
    'Copie en vente / échange',
  )
  assert.match(
    c.saleBlock(copy(), OTHER, { copyIds: new Set(), catalogueIds: new Set() }),
    /non détenue/,
  )
})
test('market reads deduplicate, reuse the price budget and stop on server pause', async () => {
  let calls = 0
  const storage = memory()
  const c = await expose(
    'content/price-store',
    'requestMarketJson,priceRequestLimit',
    {
      localStorage: storage,
      sessionStorage: memory(),
      fetch: async () => {
        calls++
        await new Promise(r => setTimeout(r, 10))
        return json({ auctions: [], hasMore: false })
      },
      AbortController,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      Date,
    },
  )
  const signal = new AbortController().signal
  const [a, b] = await Promise.all([
    c.requestMarketJson('/api/marketplace?page=1', signal),
    c.requestMarketJson('/api/marketplace?page=1', signal),
  ])
  assert.equal(calls, 1)
  assert.deepEqual(a, b)
  const paused = await expose(
    'content/price-store',
    'requestMarketJson,priceRequestLimit',
    {
      localStorage: memory(),
      sessionStorage: memory(),
      fetch: async () =>
        new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }),
      AbortController,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      Date,
    },
  )
  await assert.rejects(
    paused.requestMarketJson('/api/marketplace', signal),
    /429/,
  )
  await assert.rejects(
    paused.requestMarketJson('/api/trades', signal),
    /Pause serveur/,
  )
})
test('my sales exclude purchased history and clear on account changes', async () => {
  const window = events()
  const c = await expose(
    'content/market-store',
    'observeMarket,getMarketState,chooseComparables,loadMarket',
    {
      window,
      localStorage: memory(),
      sessionStorage: memory(),
      AbortController,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      Date,
      fetch: async () => json({ auctions: [], hasMore: false }),
    },
    "import {setAccountId} from './src/content/account.ts'; globalThis.setAccountId=setAccountId",
  )
  c.setAccountId(OWNER)
  c.observeMarket({
    mine: true,
    selling: [row()],
    history: [
      row({ id: OTHER, status: 'settled_sold' }),
      row({
        id: '44444444-4444-4444-8444-444444444444',
        seller_id: OTHER,
        status: 'settled_sold',
      }),
    ],
  })
  assert.equal(c.getMarketState().mine.rows.length, 2)
  c.setAccountId(OTHER)
  assert.equal(c.getMarketState().mine.rows.length, 0)
  c.chooseComparables(CARD)
  await c.loadMarket()
  assert.equal(c.getMarketState().comparable.more, false)
})
test('native adapter extracts possession props and gates confirmation without sending a write', async () => {
  const window = events(),
    document = events()
  const card = { id: CARD.id, wikipedia_title: CARD.title, rarity: 'R' }
  const input = {
    value: '15',
    __reactFiber$test: {
      memoizedProps: {},
      return: { memoizedProps: { card, userCardId: CARD.copyId } },
    },
    closest: () => frame,
  }
  const frame = {}
  document.body = {}
  document.querySelector = () => input
  const emitted = []
  const c = await expose(
    'native-market',
    'findNativeSale,installNativeMarket',
    {
      window,
      document,
      location: { pathname: '/collection' },
      MutationObserver: class {
        observe() {}
      },
      requestAnimationFrame: () => {},
      CustomEvent: Event,
      setTimeout,
      Date,
      HTMLInputElement: class {},
    },
  )
  c.installNativeMarket(
    () => OWNER,
    data => emitted.push(data),
  )
  assert.equal(c.findNativeSale().card.copyId, CARD.copyId)
  const launch = { textContent: "Lancer l'enchère" }
  const click = () => new Event('click', { target: { closest: () => launch } })
  const first = click()
  document.dispatchEvent(first)
  assert.equal(first.defaultPrevented, true)
  window.dispatchEvent(
    new Event('wm-toolbox:native-market', {
      detail: JSON.stringify({
        action: 'approve',
        accountId: OWNER,
        copyId: CARD.copyId,
      }),
    }),
  )
  window.addEventListener('wm-toolbox:sale-submit', event =>
    event.preventDefault(),
  )
  const blocked = click()
  document.dispatchEvent(blocked)
  assert.equal(blocked.defaultPrevented, true)
  delete input.__reactFiber$test
  assert.equal(c.findNativeSale(), null)
})
function saleContext(fetch, localStorage = memory()) {
  const window = events()
  return {
    window,
    CustomEvent: Event,
    localStorage,
    sessionStorage: memory(),
    CSSStyleSheet: class {
      replaceSync() {}
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    fetch,
    navigator: {
      locks: { request: async (_name, _options, callback) => callback({}) },
    },
  }
}
const ownRow = () => ({
  id: CARD.copyId,
  card_id: CARD.id,
  user_id: OWNER,
  count: 1,
  snapshot_rarity: 'R',
  is_shiny: false,
  starred: false,
  tags: [],
  card: { id: CARD.id, wikipedia_title: CARD.title, rarity: 'R' },
})
const saleNames =
  'observeSaleCard,checkSale,getSaleState,observeSaleResult,cancelSale,SALE_JOURNAL_PREFIX'
const accountExtra =
  "import {setAccountId} from './src/content/account.ts'; globalThis.setAccountId=setAccountId"
test('sale checks complete collection, protects unique copies, journals before native confirmation', async () => {
  const ctx = saleContext(async url =>
    url.includes('/stats')
      ? json({ total: 1 })
      : url.includes('/api/my-collection?')
        ? json({ collection: [ownRow()] })
        : url.includes('/api/trades')
          ? json({ trades: [] })
          : json({ mine: true, selling: [], history: [] }),
  )
  const c = await expose('content/sale', saleNames, ctx, accountExtra)
  c.setAccountId(OWNER)
  c.observeSaleCard(CARD)
  await c.checkSale(false)
  assert.match(c.getSaleState().error, /Copie unique/)
  const checking = c.checkSale(true)
  for (let i = 0; i < 240 && !c.getSaleState().checked; i++)
    await new Promise(r => setTimeout(r, 25))
  assert.equal(c.getSaleState().checked, true)
  const confirmation = new Event('wm-toolbox:sale-submit', {
    detail: JSON.stringify({ accountId: OWNER, card: CARD, amount: 15 }),
    cancelable: true,
  })
  c.window.dispatchEvent(confirmation)
  assert.equal(confirmation.defaultPrevented, false)
  const journal = JSON.parse(
    c.localStorage.getItem(c.SALE_JOURNAL_PREFIX + OWNER),
  )
  assert.equal(journal.status, 'unknown')
  assert.equal(journal.copyId, CARD.copyId)
  c.observeSaleCard(null) // Native modal can close before the observer receives the response.
  c.observeSaleResult('listed', AUCTION)
  await checking
  assert.equal(
    JSON.parse(c.localStorage.getItem(c.SALE_JOURNAL_PREFIX + OWNER)).status,
    'listed',
  )
})
test('sale never allows another account or a missing possession and fails closed if journal cannot persist', async () => {
  const storage = memory()
  const ctx = saleContext(
    async url =>
      url.includes('/stats')
        ? json({ total: 0 })
        : json({ mine: true, selling: [], history: [], trades: [] }),
    storage,
  )
  const c = await expose('content/sale', saleNames, ctx, accountExtra)
  c.setAccountId(OWNER)
  c.observeSaleCard(CARD)
  await c.checkSale(true)
  assert.match(c.getSaleState().error, /non détenue/)
  const confirmation = new Event('wm-toolbox:sale-submit', {
    detail: JSON.stringify({ accountId: OTHER, card: CARD, amount: 15 }),
  })
  c.window.dispatchEvent(confirmation)
  assert.equal(confirmation.defaultPrevented, true)
  assert.equal(storage.getItem(c.SALE_JOURNAL_PREFIX + OWNER), null)
})

test('cancelled searches and account changes discard late responses', async () => {
  let respond
  const context = {
    window: events(),
    localStorage: memory(),
    sessionStorage: memory(),
    AbortController,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Date,
    fetch: async () =>
      new Promise(resolve => {
        respond = resolve
      }),
  }
  const c = await expose(
    'content/market-store',
    'chooseComparables,loadMarket,getMarketState,cancelMarketReads',
    context,
    accountExtra,
  )
  c.setAccountId(OWNER)
  c.chooseComparables(CARD)
  const loading = c.loadMarket()
  await new Promise(resolve => setImmediate(resolve))
  c.cancelMarketReads()
  c.setAccountId(OTHER)
  respond(json({ auctions: [row()], hasMore: true }))
  await loading
  assert.equal(c.getMarketState().comparable.rows.length, 0)
  assert.equal(c.getMarketState().comparable.loading, false)
})
test('comparables page traversal is bounded and deduplicates listings', async () => {
  const requests = []
  const context = {
    window: events(),
    localStorage: memory(),
    sessionStorage: memory(),
    AbortController,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Date,
    fetch: async url => {
      requests.push(url)
      return json({ auctions: [row()], hasMore: true })
    },
  }
  const c = await expose(
    'content/market-store',
    'chooseComparables,loadMarket,getMarketState',
    context,
    accountExtra,
  )
  c.setAccountId(OWNER)
  c.chooseComparables(CARD)
  await c.loadMarket()
  for (let i = 0; i < 12; i++) await c.loadMarket(false, true)
  assert.equal(requests.length, 10)
  assert.equal(c.getMarketState().comparable.rows.length, 1)
  assert.ok(requests.every(url => url.includes('sort=ending_soon')))
})
test('receipt storage failure and a busy browser lock prevent native approval', async () => {
  const fetch = async url =>
    url.includes('/stats')
      ? json({ total: 1 })
      : url.includes('/api/my-collection?')
        ? json({ collection: [ownRow()] })
        : url.includes('/api/trades')
          ? json({ trades: [] })
          : json({ mine: true, selling: [], history: [] })
  const storage = memory()
  const ctx = saleContext(fetch, storage)
  const c = await expose('content/sale', saleNames, ctx, accountExtra)
  c.setAccountId(OWNER)
  c.observeSaleCard(CARD)
  const checking = c.checkSale(true)
  for (let i = 0; i < 240 && !c.getSaleState().checked; i++)
    await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(c.getSaleState().checked, true)
  storage.setItem = () => {
    throw new Error('Quota')
  }
  const confirmation = new Event('wm-toolbox:sale-submit', {
    detail: JSON.stringify({ accountId: OWNER, card: CARD, amount: 15 }),
  })
  c.window.dispatchEvent(confirmation)
  await checking
  assert.equal(confirmation.defaultPrevented, true)
  assert.equal(c.getSaleState().checked, false)
  c.navigator.locks.request = async (_name, _options, callback) =>
    callback(null)
  await c.checkSale(true)
  assert.match(c.getSaleState().error, /autre onglet/)
})
test('a committed copy remains unsellable even after acknowledging protections', async () => {
  const ctx = saleContext(async url =>
    url.includes('/stats')
      ? json({ total: 1 })
      : url.includes('/api/my-collection?')
        ? json({ collection: [ownRow()] })
        : url.includes('/api/trades')
          ? json({ trades: [] })
          : json({ mine: true, selling: [row()], history: [] }),
  )
  const c = await expose('content/sale', saleNames, ctx, accountExtra)
  c.setAccountId(OWNER)
  c.observeSaleCard(CARD)
  await c.checkSale(true)
  assert.equal(c.getSaleState().checked, false)
  assert.equal(c.getSaleState().error, 'Copie en vente / échange')
})

test('sale applies the retained-copy rule independently of the discard selection', async () => {
  const rows = [ownRow(), { ...ownRow(), id: 'copy-b' }]
  const ctx = saleContext(async url =>
    url.includes('/stats')
      ? json({ total: 2 })
      : url.includes('/api/my-collection?')
        ? json({ collection: rows })
        : url.includes('/api/trades')
          ? json({ trades: [] })
          : json({ mine: true, selling: [], history: [] }),
  )
  const c = await expose(
    'content/sale',
    saleNames,
    ctx,
    accountExtra +
      "; import {editSelection} from './src/content/collection-actions.ts'; globalThis.editSelection=editSelection",
  )
  c.setAccountId(OWNER)
  c.observeSaleCard(CARD)
  c.editSelection(rules => {
    rules.keep = 2
  })
  await c.checkSale(false)
  assert.match(c.getSaleState().error, /Conserver 2/)
  assert.equal(c.getSaleState().checked, false)
})
