import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import { nativeMarketStubs } from './browser-stubs.mjs'

const DAY = 86400_000
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const AUCTION = '33333333-3333-4333-8333-333333333333'
async function expose(imports, context = {}) {
  const result = await build({
    stdin: {
      contents: imports
        .map(
          ([module, names]) =>
            `import {${names}} from './src/content/${module}.ts'; Object.assign(globalThis,{${names}});`,
        )
        .join('\n'),
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    write: false,
  })
  Object.assign(context, { AbortController, AbortSignal, URL, URLSearchParams })
  vm.runInNewContext(result.outputFiles[0].text, context)
  return context
}
function harness() {
  let now = Date.UTC(2026, 9, 3, 10)
  const map = new Map()
  return {
    map,
    advance: n => {
      now += n
    },
    context: {
      Date: class extends Date {
        static now() {
          return now
        }
      },
      localStorage: {
        get length() {
          return map.size
        },
        key: n => [...map.keys()][n] ?? null,
        getItem: key => map.get(key) ?? null,
        setItem: (key, value) => map.set(key, value),
        removeItem: key => map.delete(key),
      },
      setTimeout: (cb, ms) => {
        if (ms !== 12_000) queueMicrotask(cb)
        return 1
      },
      clearTimeout() {},
    },
  }
}
const rule = (at, extra = {}) => ({
  id: 'catalogue',
  rarity: 'R',
  threshold: 10,
  direction: 'above',
  previous: null,
  at,
  ...extra,
})

test('alerts only notify threshold crossings from fresh exact-rarity observations and deduplicate reads', async () => {
  const h = harness()
  const c = await expose(
    [
      ['account', 'setAccountId'],
      ['price-alerts', 'setPriceAlert,observePriceAlerts,readPriceAlerts'],
    ],
    h.context,
  )
  c.setAccountId(A)
  assert.match(c.setPriceAlert(rule(c.Date.now())), /saved/)
  h.advance(1000)
  c.observePriceAlerts('catalogue', { R: 12 }, c.Date.now())
  assert.equal(
    c.readPriceAlerts().events.length,
    0,
    'first read establishes a baseline',
  )
  h.advance(1000)
  c.observePriceAlerts('other', { R: 5 }, c.Date.now())
  c.observePriceAlerts('catalogue', { C: 8 }, c.Date.now())
  assert.equal(
    c.readPriceAlerts().rules[0].previous,
    null,
    'no-sales gap resets exact-rarity baseline',
  )
  h.advance(1000)
  c.observePriceAlerts('catalogue', { R: 8 }, c.Date.now())
  h.advance(1000)
  const at = c.Date.now()
  c.observePriceAlerts('catalogue', { R: 10 }, at)
  c.observePriceAlerts('catalogue', { R: 10 }, at)
  assert.equal(c.readPriceAlerts().events.length, 1)
  assert.equal(c.readPriceAlerts().events[0].average, 10)
  h.advance(2 * DAY)
  c.observePriceAlerts('catalogue', { R: 1 }, at + 1)
  assert.equal(
    c.readPriceAlerts().rules[0].previous,
    10,
    'stale observation ignored',
  )
  c.observePriceAlerts('catalogue', { R: -1 }, c.Date.now())
  assert.equal(c.readPriceAlerts().rules[0].previous, 10)
})

test('alerts isolate accounts, validate thresholds, bound notifications and surface storage failures', async () => {
  const h = harness()
  const c = await expose(
    [
      ['account', 'setAccountId'],
      [
        'price-alerts',
        'setPriceAlert,observePriceAlerts,readPriceAlerts,removePriceAlert,clearPriceAlertEvents',
      ],
    ],
    h.context,
  )
  assert.match(c.setPriceAlert(rule(c.Date.now())), /Sign in/)
  c.setAccountId(A)
  assert.match(
    c.setPriceAlert(rule(c.Date.now(), { threshold: 0 })),
    /positive/,
  )
  assert.match(
    c.setPriceAlert(rule(c.Date.now(), { rarity: 'invalid' })),
    /positive/,
  )
  c.setPriceAlert(rule(c.Date.now(), { direction: 'below', previous: 12 }))
  for (let i = 0; i < 220; i++) {
    h.advance(1000)
    c.observePriceAlerts('catalogue', { R: i % 2 ? 12 : 10 }, c.Date.now())
  }
  assert.equal(c.readPriceAlerts().events.length, 100)
  c.setAccountId(B)
  assert.equal(c.readPriceAlerts().rules.length, 0)
  c.setAccountId(A)
  assert.equal(c.readPriceAlerts().rules.length, 1)
  c.clearPriceAlertEvents()
  assert.equal(c.readPriceAlerts().events.length, 0)
  c.removePriceAlert('catalogue', 'R')
  assert.equal(c.readPriceAlerts().rules.length, 0)
  h.context.localStorage.setItem = () => {
    throw new Error('quota')
  }
  assert.match(c.setPriceAlert(rule(c.Date.now())), /unavailable/)
})

test('price engine alerts only on successful reads; failed refresh retains reference and diagnostics beyond retry delay', async () => {
  const h = harness()
  let amount = 8,
    status = 200,
    calls = 0
  h.context.fetch = async () => {
    calls++
    return {
      ok: status === 200,
      status,
      headers: { get: () => null },
      json: async () => ({ summary: { R: { average: amount } } }),
    }
  }
  const c = await expose(
    [
      ['account', 'setAccountId'],
      ['price-alerts', 'setPriceAlert,readPriceAlerts'],
      [
        'price-store',
        'requestPriceQuote,readPriceQuote,readPriceHistory,cachedPriceIds',
      ],
    ],
    h.context,
  )
  c.setAccountId(A)
  await c.requestPriceQuote('catalogue')
  const first = c.readPriceQuote('catalogue', 'R')
  c.setPriceAlert(rule(c.Date.now(), { previous: 8 }))
  h.advance(61_000)
  amount = 12
  status = 503
  await c.requestPriceQuote('catalogue', true)
  assert.equal(c.readPriceAlerts().events.length, 0)
  assert.equal(c.readPriceQuote('catalogue', 'R').fetchedAt, first.fetchedAt)
  h.advance(61_000)
  status = 200
  await c.requestPriceQuote('catalogue', true)
  assert.equal(c.readPriceAlerts().events.length, 1)
  assert.equal(
    c.readPriceHistory('catalogue', 'R').length,
    1,
    'same-day graph replacement does not erase crossing',
  )
  assert.equal(c.cachedPriceIds().length, 1)
  h.advance(61_000)
  status = 404
  await c.requestPriceQuote('missing', true)
  h.advance(61_000)
  assert.equal(c.readPriceQuote('missing', 'R').status, 'not-found')
  status = 500
  await c.requestPriceQuote('error', true)
  h.advance(61_000)
  assert.equal(c.readPriceQuote('error', 'R').status, 'unavailable')
  assert.equal(calls, 5)
})

test('diagnostics deduplicate copies, preserve variants and include failed retained prices', async () => {
  const c = await expose([
    ['price-diagnostics', 'diagnosePrices,priceDiagnostic'],
  ])
  const card = { id: 'a', rarity: 'R', shiny: false }
  const rows = c.diagnosePrices(
    [
      card,
      { ...card, copyId: 'other' },
      { ...card, rarity: 'C' },
      { ...card, shiny: true },
      { ...card, id: 'notfound' },
      { ...card, id: 'unloaded' },
    ],
    (id, rarity) =>
      id === 'notfound'
        ? { status: 'not-found', fetchedAt: 1 }
        : id === 'unloaded'
          ? { status: 'loading' }
          : rarity === 'C'
            ? { status: 'available', average: 7, fetchedAt: 1, failed: true }
            : { status: 'no-sales', fetchedAt: 1 },
  )
  assert.equal(rows.length, 4)
  assert.deepEqual(
    Array.from(rows, row => row.reason),
    ['no-sales', 'error', 'no-sales', 'not-found'],
  )
})

test('dashboard keeps rarity amounts, errors, coverage and observed gaps distinct from concluded sales', async () => {
  const c = await expose([
    ['price-diagnostics', 'priceDashboard,historyDiagnostic'],
  ])
  const h = [
    { at: 1000, average: 0 },
    { at: 3 * DAY + 1000, average: null },
    { at: 4 * DAY + 1000, average: 12 },
  ]
  const diag = c.historyDiagnostic(h)
  assert.equal(diag.delta, 12)
  assert.equal(diag.gaps, 2)
  assert.equal(diag.missing, 1)
  const rows = c.priceDashboard(
    ['a', 'b', 'c', 'd'],
    (id, rarity) =>
      rarity !== 'R'
        ? { status: 'loading' }
        : id === 'a'
          ? { status: 'available', average: 10, fetchedAt: 1, failed: true }
          : id === 'b'
            ? { status: 'no-sales', fetchedAt: 1 }
            : id === 'c'
              ? { status: 'not-found', fetchedAt: 1 }
              : { status: 'loading' },
    (id, rarity) => (id === 'a' && rarity === 'R' ? h : []),
  )
  const rare = rows.find(row => row.rarity === 'R')
  assert.equal(rare.sum, 10)
  assert.equal(rare.known, 1)
  assert.equal(rare.stale, 1)
  assert.equal(rare.missing, 1)
  assert.equal(rare.errors, 1)
  assert.equal(rare.unloaded, 1)
  assert.equal(rows.find(row => row.rarity === 'C').sum, 0)
  assert.equal(rare.histories.length, 1)
})

test('listing comparisons distinguish starting, bid and concluded amounts with uncertain and zero references', async () => {
  const c = await expose([['price-comparison', 'listingComparison']])
  const row = {
    id: AUCTION,
    card: { id: 'a', title: 'Synthetic', rarity: 'R', shiny: false },
    base: 5,
    bid: 15,
    final: 20,
    status: 'active',
  }
  const quote = { status: 'available', average: 10, fetchedAt: Date.now() }
  const result = c.listingComparison(row, quote)
  assert.match(result.text, /Starting price 5 W · vs average -5 W · -50.0%/)
  assert.match(result.text, /Current bid 15 W · vs average \+5 W · \+50.0%/)
  assert.match(result.hint, /average only/)
  assert.doesNotMatch(result.text, /Final sale/)
  assert.match(
    c.listingComparison({ ...row, status: 'settled_sold' }, quote).text,
    /Final sale 20 W/,
  )
  assert.doesNotMatch(
    c.listingComparison(row, { ...quote, average: 0 }).text,
    /%/,
  )
  assert.match(
    c.listingComparison(row, { ...quote, failed: true }).hint,
    /refresh failed/,
  )
  assert.match(
    c.listingComparison(row, { status: 'no-sales', fetchedAt: Date.now() })
      .text,
    /vs average —/,
  )
  assert.match(
    c.listingComparison({ ...row, card: { ...row.card, shiny: true } }, quote)
      .text,
    /shiny reference unavailable/,
  )
})

test('native listing observations strip private identity and explicit shiny is required; route/account resets clear memory', async () => {
  const h = harness()
  const c = await expose(
    [
      ['account', 'setAccountId'],
      [
        'price-listings',
        'observePriceListings,readPriceListings,clearPriceListings',
      ],
    ],
    h.context,
  )
  const row = {
    id: AUCTION,
    card: {
      id: 'catalogue',
      title: 'Synthetic',
      rarity: 'R',
      shiny: false,
      copyId: 'private-copy',
    },
    base: 5,
    bid: null,
    final: null,
    status: 'active',
    endAt: null,
    sellerId: A,
  }
  c.setAccountId(A)
  c.observePriceListings([row])
  assert.equal(c.readPriceListings().length, 1)
  assert.equal(
    JSON.stringify(c.readPriceListings()).includes('private-copy'),
    false,
  )
  assert.equal(
    JSON.stringify(c.readPriceListings()).includes('sellerId'),
    false,
  )
  c.setAccountId(B)
  assert.equal(c.readPriceListings().length, 0)
  c.observePriceListings([{ ...row, card: { ...row.card, shiny: undefined } }])
  assert.equal(c.readPriceListings().length, 0)
  c.observePriceListings([row])
  c.clearPriceListings()
  assert.equal(c.readPriceListings().length, 0)
})

test('network forwards only comparison fields without changing game responses', async () => {
  const events = []
  const payload = {
    auction: {
      id: AUCTION,
      card_id: 'catalogue',
      user_card_id: 'private-copy',
      card: { id: 'catalogue', wikipedia_title: 'Synthetic', rarity: 'L' },
      snapshot_rarity: 'R',
      is_shiny: false,
      base_amount: 10,
      current_bid: 20,
      status: 'active',
      seller_id: A,
      buyer: { secret: 'private-profile' },
    },
  }
  const window = {
    fetch: async () => new Response(JSON.stringify(payload)),
    dispatchEvent: event => events.push(JSON.parse(event.detail)),
  }
  const built = await build({
    entryPoints: ['src/network.ts'],
    bundle: true,
    write: false,
    format: 'iife',
  })
  class Event {
    constructor(type, data) {
      this.type = type
      this.detail = data.detail
    }
  }
  class XHR {
    open() {}
    send() {}
  }
  vm.runInNewContext(built.outputFiles[0].text, {
    window,
    ...nativeMarketStubs(window),
    location: { origin: 'https://www.wiki-masters.com' },
    XMLHttpRequest: XHR,
    CustomEvent: Event,
    Request,
    URL,
  })
  assert.deepEqual(
    await (await window.fetch(`/api/marketplace/${AUCTION}`)).json(),
    payload,
  )
  await new Promise(resolve => setImmediate(resolve))
  const event = events.find(row => row.kind === 'price-listings')
  assert.equal(event.listings[0].card.rarity, 'R')
  assert.equal(event.listings[0].bid, 20)
  assert.equal(JSON.stringify(event).includes('private-'), false)
  assert.equal(JSON.stringify(event).includes(A), false)
})

test('listing mapper never falls back to catalogue rarity or infers missing shiny', async () => {
  const c = await expose([['price-comparison', 'mapPriceListing']])
  const raw = {
    id: AUCTION,
    card_id: 'catalogue',
    card: { id: 'catalogue', wikipedia_title: 'Synthetic', rarity: 'L' },
    snapshot_rarity: 'R',
    is_shiny: false,
    status: 'active',
    base_amount: 0,
  }
  assert.equal(c.mapPriceListing(raw).card.rarity, 'R')
  assert.equal(
    c.mapPriceListing({ ...raw, snapshot_rarity: undefined }).card.rarity,
    null,
  )
  assert.equal(c.mapPriceListing({ ...raw, is_shiny: undefined }), null)
})

test('alert cap preserves existing rules, reloads them and expires old notifications', async () => {
  const h = harness()
  const imports = [
    ['account', 'setAccountId'],
    ['price-alerts', 'setPriceAlert,readPriceAlerts,observePriceAlerts'],
  ]
  const c = await expose(imports, h.context)
  c.setAccountId(A)
  for (let i = 0; i < 50; i++)
    assert.match(
      c.setPriceAlert(rule(c.Date.now(), { id: `card-${i}`, previous: 8 })),
      /saved/,
    )
  assert.match(
    c.setPriceAlert(rule(c.Date.now(), { id: 'overflow' })),
    /50 alerts maximum/,
  )
  assert.match(
    c.setPriceAlert(rule(c.Date.now(), { id: 'card-0', previous: 8 })),
    /saved/,
  )
  h.advance(1000)
  c.observePriceAlerts('card-0', { R: 12 }, c.Date.now())
  const fresh = await expose(imports, { ...h.context })
  fresh.setAccountId(A)
  assert.equal(fresh.readPriceAlerts().rules.length, 50)
  assert.equal(fresh.readPriceAlerts().events.length, 1)
  h.advance(31 * DAY)
  assert.equal(fresh.readPriceAlerts().events.length, 0)
})

test('dashboard revision invalidates on writes, cross-tab history changes and cache clears without fetching', async () => {
  const h = harness()
  let calls = 0
  h.context.fetch = async () => {
    calls++
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ summary: { R: { average: 8 } } }),
    }
  }
  const c = await expose(
    [
      [
        'price-store',
        'priceDataRevision,requestPriceQuote,syncPricesFromStorage,cachedPriceIds',
      ],
      ['cache', 'clearCache'],
    ],
    h.context,
  )
  const start = c.priceDataRevision()
  await c.requestPriceQuote('catalogue')
  assert.ok(c.priceDataRevision() > start)
  const afterRead = c.priceDataRevision()
  c.syncPricesFromStorage('wm_toolbox_price_history_v1_catalogue')
  assert.ok(c.priceDataRevision() > afterRead)
  const afterStorage = c.priceDataRevision()
  c.clearCache('history')
  assert.ok(c.priceDataRevision() > afterStorage)
  c.cachedPriceIds()
  assert.equal(calls, 1)
})

test('collection filters and price diagnostics share exact-rarity references without fetching or changing selection', async () => {
  const h = harness()
  h.context.structuredClone = structuredClone
  h.context.fetch = () => {
    throw new Error('Local collection filtering must not fetch')
  }
  const c = await expose(
    [
      ['account', 'setAccountId'],
      ['collection-query', 'defaultCollectionQuery,queryCollectionView'],
      ['selection', 'defaultSelectionRules,buildSelection'],
      ['price-diagnostics', 'diagnosePrices'],
      ['price-store', 'readPriceQuote,syncPricesFromStorage'],
    ],
    h.context,
  )
  c.setAccountId(A)
  const at = c.Date.now() - 1000
  h.map.set(
    'wm_toolbox_price_v1_catalogue',
    JSON.stringify({ ok: true, fetchedAt: at, averages: { R: 8 } }),
  )
  const base = {
    id: 'catalogue',
    title: 'Synthetic',
    rarity: 'R',
    shiny: false,
    ownerId: A,
    starred: false,
    tagIds: [],
    obtainedAt: null,
    category: 'Synthetic',
    atk: 8,
    def: 4,
    hasImage: true,
  }
  const cards = [
    { ...base, copyId: 'copy-1' },
    { ...base, copyId: 'copy-2', starred: true },
    { ...base, copyId: 'copy-3', rarity: 'C' },
    { ...base, copyId: 'copy-4', shiny: true },
  ]
  const rules = c.defaultSelectionRules()
  rules.added.add('copy-1')
  const guards = { catalogueIds: new Set(), copyIds: new Set() }
  const selected = () =>
    Array.from(c.buildSelection(cards, rules, guards).cards, row => row.copyId)
  const before = JSON.stringify(cards)
  const q = {
    ...c.defaultCollectionQuery(),
    knownPrice: 'yes',
    sort: 'price',
    descending: true,
  }
  assert.deepEqual(
    Array.from(
      c.queryCollectionView(cards, q, c.readPriceQuote, false),
      row => row.copyId,
    ),
    ['copy-1', 'copy-2'],
  )
  const diagnostics = c.diagnosePrices(cards, c.readPriceQuote)
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].card.rarity, 'C')
  assert.equal(diagnostics[0].reason, 'no-sales')
  const plan = selected()
  h.map.set(
    'wm_toolbox_price_v1_catalogue',
    JSON.stringify({
      ok: true,
      fetchedAt: at,
      lastAttempt: c.Date.now(),
      failed: true,
      averages: { R: 8 },
    }),
  )
  c.syncPricesFromStorage('wm_toolbox_price_v1_catalogue')
  assert.equal(
    c.queryCollectionView(cards, q, c.readPriceQuote, false).length,
    2,
    'retained known prices remain filterable after refresh failure',
  )
  assert.ok(
    c
      .diagnosePrices(cards, c.readPriceQuote)
      .some(
        row =>
          row.card.id === 'catalogue' &&
          row.card.rarity === 'R' &&
          !row.card.shiny &&
          row.reason === 'error',
      ),
  )
  assert.equal(c.readPriceQuote('catalogue', 'R').fetchedAt, at)
  assert.deepEqual(selected(), plan)
  assert.equal(JSON.stringify(cards), before)
})

test('saved collection views and price alerts coexist and restore independently per account', async () => {
  const h = harness()
  h.context.structuredClone = structuredClone
  const c = await expose(
    [
      ['account', 'setAccountId'],
      ['collection-query', 'defaultCollectionQuery'],
      ['collection-views', 'saveView,setCompact,getViewPreferences'],
      ['price-alerts', 'setPriceAlert,readPriceAlerts,observePriceAlerts'],
    ],
    h.context,
  )
  c.setAccountId(A)
  c.saveView(
    'Synthetic view',
    { ...c.defaultCollectionQuery(), knownPrice: 'no' },
    0,
  )
  c.setCompact(true)
  c.setPriceAlert(rule(c.Date.now(), { previous: 8 }))
  h.advance(1000)
  c.observePriceAlerts('catalogue', { R: 12 }, c.Date.now())
  assert.equal(c.getViewPreferences().views[0].query.knownPrice, 'no')
  assert.equal(c.getViewPreferences().compact, true)
  assert.equal(c.readPriceAlerts().events.length, 1)
  c.setAccountId(B)
  assert.equal(c.getViewPreferences().views.length, 0)
  assert.equal(c.getViewPreferences().compact, false)
  assert.equal(c.readPriceAlerts().events.length, 0)
  c.setAccountId(A)
  assert.equal(c.getViewPreferences().views.length, 1)
  assert.equal(c.getViewPreferences().compact, true)
  assert.equal(c.readPriceAlerts().rules.length, 1)
  assert.equal(c.readPriceAlerts().events.length, 1)
})
