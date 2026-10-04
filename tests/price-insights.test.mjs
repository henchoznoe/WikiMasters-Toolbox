import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

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
test('price engine failed refresh retains reference and diagnostics beyond retry delay', async () => {
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
      [
        'price-store',
        'requestPriceQuote,readPriceQuote,readPriceHistory,cachedPriceIds',
      ],
    ],
    h.context,
  )
  await c.requestPriceQuote('catalogue')
  const first = c.readPriceQuote('catalogue', 'R')
  h.advance(61_000)
  amount = 12
  status = 503
  await c.requestPriceQuote('catalogue', true)
  assert.equal(c.readPriceQuote('catalogue', 'R').fetchedAt, first.fetchedAt)
  h.advance(61_000)
  status = 200
  await c.requestPriceQuote('catalogue', true)
  assert.equal(
    c.readPriceHistory('catalogue', 'R').length,
    1,
    'successful same-day read replaces the observation',
  )
  assert.equal(c.readPriceHistory('catalogue', 'R')[0].average, 12)
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
  assert.match(
    result.text,
    /Mise de départ 5 W · écart à la moyenne -5 W · -50,0 %/,
  )
  assert.match(
    result.text,
    /Offre actuelle 15 W · écart à la moyenne \+5 W · \+50,0 %/,
  )
  assert.match(result.hint, /moyenne seule/)
  assert.doesNotMatch(result.text, /Vente finale/)
  assert.match(
    c.listingComparison({ ...row, status: 'settled_sold' }, quote).text,
    /Vente finale 20 W/,
  )
  assert.doesNotMatch(
    c.listingComparison(row, { ...quote, average: 0 }).text,
    /%/,
  )
  assert.match(
    c.listingComparison(row, { ...quote, failed: true }).hint,
    /actualisation échouée/,
  )
  assert.match(
    c.listingComparison(row, { status: 'no-sales', fetchedAt: Date.now() })
      .text,
    /écart à la moyenne —/,
  )
  assert.match(
    c.listingComparison({ ...row, card: { ...row.card, shiny: true } }, quote)
      .text,
    /référence des brillantes indisponible/,
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
