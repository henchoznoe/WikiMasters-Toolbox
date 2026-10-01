import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
async function expose(module, names, context = {}) {
  const result = await build({
    stdin: {
      contents: `import {${names.join(',')}} from './src/content/${module}.ts'; Object.assign(globalThis,{${names.join(',')}})`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  })
  vm.runInNewContext(result.outputFiles[0].text, context)
  return context
}
const day = 86400_000
function harness(fetch) {
  let now = Date.UTC(2026, 0, 15, 12)
  const stored = new Map()
  return {
    stored,
    advance: n => {
      now += n
    },
    context: {
      Date: class extends Date {
        static now() {
          return now
        }
      },
      setTimeout: callback => {
        now += 650
        queueMicrotask(callback)
        return 1
      },
      clearTimeout() {},
      AbortSignal,
      fetch,
      localStorage: {
        getItem: k => stored.get(k) ?? null,
        setItem: (k, v) => stored.set(k, v),
        removeItem: k => stored.delete(k),
      },
    },
  }
}
const response = (summary, status = 200) => ({
  ok: status === 200,
  status,
  headers: { get: () => null },
  json: async () => ({ summary }),
})

test('summary rejects malformed and negative prices and preserves zero without borrowing rarity', async () => {
  const { parseSummary } = await expose('price-model', ['parseSummary'])
  assert.equal(parseSummary(undefined), null)
  assert.equal(parseSummary([]), null)
  assert.equal(parseSummary({ R: { average: -1 } }), null)
  assert.equal(parseSummary({ R: { average: true } }), null)
  assert.equal(parseSummary({ R: { average: 'NaN' } }), null)
  assert.equal(parseSummary({ R: { average: 0 }, C: { average: null } }).R, 0)
})

test('robust estimates need actual unique recent settled sales of the correct rarity', async () => {
  const { analyzeSales } = await expose('price-model', ['analyzeSales'])
  const now = Date.now()
  const sales = Array.from({ length: 20 }, (_, n) => ({
    id: String(n),
    rarity: 'R',
    final_price: n === 19 ? 1000 : 10 + (n % 3),
    settled_at: new Date(now - (n + 1) * 1000).toISOString(),
  }))
  sales.push(
    sales[0],
    {
      ...sales[0],
      id: 'old',
      settled_at: new Date(now - 31 * day).toISOString(),
    },
    {
      ...sales[0],
      id: 'future',
      settled_at: new Date(now + day).toISOString(),
    },
    { ...sales[0], id: 'wrong', rarity: 'UR' },
    { ...sales[0], id: 'invalid', final_price: -1 },
  )
  const result = analyzeSales(sales, 'R', now)
  assert.equal(result.count, 20)
  assert.equal(result.median, 11)
  assert.equal(result.outliers, 1)
  assert.equal(result.confidence, 'moderate')
  assert.ok(result.low >= 10 && result.high <= 12)
  assert.equal(analyzeSales(sales.slice(0, 4), 'R', now).median, null)
  assert.equal(analyzeSales(sales.slice(0, 9), 'R', now).low, null)
  assert.equal(analyzeSales(sales, 'C', now).count, 0)
})

test('history replaces a same UTC-day observation without inventing intervening days', async () => {
  const { appendObservation } = await expose('price-model', [
    'appendObservation',
  ])
  const now = Math.floor(Date.now() / day) * day + 1000
  const rows = appendObservation(
    [
      { at: now - 100 * day, average: 2 },
      { at: now - 3 * day, average: 10 },
      { at: now - 10, average: 20 },
    ],
    { at: now, average: null },
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].average, 10)
  assert.equal(rows[1].average, null)
  assert.equal(rows[1].at - rows[0].at, 3 * day)
})

test('shared price requests deduplicate, use catalogue IDs and keep last good price after a failed refresh', async () => {
  let calls = 0
  const h = harness(async url => {
    assert.match(url, /\/catalogue\/sales\?scope=summary$/)
    calls++
    return response({ R: { average: 7 } }, calls === 1 ? 200 : 503)
  })
  await expose(
    'price-store',
    ['requestPriceQuote', 'readPriceQuote', 'readPriceHistory'],
    h.context,
  )
  await Promise.all([
    h.context.requestPriceQuote('catalogue'),
    h.context.requestPriceQuote('catalogue'),
  ])
  assert.equal(calls, 1)
  assert.equal(h.context.readPriceQuote('catalogue', 'R').average, 7)
  assert.equal(h.context.readPriceQuote('catalogue', 'C').status, 'no-sales')
  h.advance(day + 1)
  await h.context.requestPriceQuote('catalogue', true)
  const retained = h.context.readPriceQuote('catalogue', 'R')
  assert.equal(retained.average, 7)
  assert.equal(retained.stale, true)
  assert.equal(retained.failed, true)
  assert.ok(retained.lastAttempt > retained.fetchedAt)
  assert.equal(h.context.readPriceHistory('catalogue', 'R').length, 1)
  await h.context.requestPriceQuote('catalogue', true)
  assert.equal(calls, 2)
})

test('batches skip fresh entries, deduplicate copies, cap requests and stop after an in-flight read', async () => {
  let calls = 0
  let release
  const h = harness(async () => {
    calls++
    if (calls === 2)
      await new Promise(resolve => {
        release = resolve
      })
    return response({ C: { average: 1 } })
  })
  await expose(
    'price-store',
    [
      'requestPriceQuote',
      'startPriceBatch',
      'cancelPriceBatch',
      'getPriceBatch',
    ],
    h.context,
  )
  h.context.cancelPriceBatch()
  assert.equal(h.context.getPriceBatch().cancelled, false)
  await h.context.requestPriceQuote('fresh')
  const batch = h.context.startPriceBatch(
    ['fresh', 'a', 'a', 'b', 'c'],
    false,
    2,
  )
  while (!release) await new Promise(resolve => setImmediate(resolve))
  h.context.cancelPriceBatch()
  release()
  await batch
  assert.equal(calls, 2)
  assert.equal(h.context.getPriceBatch().cancelled, true)
  await h.context.startPriceBatch(['b', 'b', 'c', 'd'], false, 1)
  assert.equal(calls, 3)
  assert.equal(h.context.getPriceBatch().total, 1)
})

test('rate limits pause remaining price reads without automatic retries', async () => {
  let calls = 0
  const h = harness(async () => {
    calls++
    return response({}, 429)
  })
  await expose(
    'price-store',
    ['startPriceBatch', 'priceRequestLimit', 'readPriceQuote'],
    h.context,
  )
  await h.context.startPriceBatch(['a', 'b', 'c'])
  assert.equal(calls, 1)
  assert.match(h.context.priceRequestLimit(), /Server pause/)
  assert.equal(h.context.readPriceQuote('a', 'R').status, 'unavailable')
  h.advance(61_000)
  await h.context.startPriceBatch(['b'])
  assert.equal(calls, 2)
})

test('PRO requirement is explicit, cached briefly and never replaced with invented sales', async () => {
  let calls = 0
  const h = harness(async () => {
    calls++
    return {
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({ code: 'pro_required' }),
    }
  })
  await expose(
    'price-store',
    ['requestPriceDetail', 'readPriceDetail'],
    h.context,
  )
  await h.context.requestPriceDetail('a')
  assert.equal(h.context.readPriceDetail('a').status, 'pro-required')
  assert.equal(h.context.readPriceDetail('a').analyses, undefined)
  await h.context.requestPriceDetail('a')
  assert.equal(calls, 1)
})

test('individual sales analyses do not survive an account change during the read', async () => {
  let release
  const h = harness(async () => {
    await new Promise(resolve => {
      release = resolve
    })
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ sales: [] }),
    }
  })
  const result = await build({
    stdin: {
      contents: `import {setAccountId} from './src/content/account.ts'; import {requestPriceDetail,readPriceDetail,resetPriceAccount} from './src/content/price-store.ts'; Object.assign(globalThis,{setAccountId,requestPriceDetail,readPriceDetail,resetPriceAccount})`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  })
  vm.runInNewContext(result.outputFiles[0].text, h.context)
  h.context.setAccountId('11111111-1111-4111-8111-111111111111')
  const pending = h.context.requestPriceDetail('a')
  h.context.setAccountId('22222222-2222-4222-8222-222222222222')
  h.context.resetPriceAccount()
  release()
  await pending
  assert.equal(h.context.readPriceDetail('a').status, 'idle')
})

test('cached legacy averages remain usable but malformed or future cache cannot produce a quote', async () => {
  const h = harness(async () => response({}))
  const fetchedAt = h.context.Date.now()
  h.stored.set(
    'wm_toolbox_price_v1_bad',
    JSON.stringify({ ok: true, fetchedAt, averages: { R: -8 } }),
  )
  h.stored.set(
    'wm_toolbox_price_v1_good',
    JSON.stringify({ ok: true, fetchedAt, averages: { C: 0 } }),
  )
  h.stored.set(
    'wm_toolbox_price_v1_future',
    JSON.stringify({ ok: true, fetchedAt: fetchedAt + 1, averages: { C: 1 } }),
  )
  await expose('price-store', ['readPriceQuote'], h.context)
  assert.equal(h.context.readPriceQuote('bad', 'R').status, 'loading')
  assert.equal(h.context.readPriceQuote('future', 'C').status, 'loading')
  assert.equal(h.context.readPriceQuote('good', 'C').average, 0)
  assert.equal(h.context.readPriceQuote('good', null).status, 'unknown-rarity')
})

test('global, marketplace and trade adapters expose only canonical card metadata', async () => {
  const payloads = {
    '/api/cards': {
      cards: [
        {
          id: 'catalogue',
          wikipedia_title: 'Global',
          rarity: 'L',
          privateField: 'hidden',
        },
      ],
    },
    '/api/marketplace': {
      auctions: [
        {
          id: 'auction',
          card_id: 'catalogue',
          card: { id: 'catalogue', wikipedia_title: 'Global', rarity: 'R' },
          seller: { privateField: 'hidden' },
        },
      ],
    },
    '/api/trades': {
      trades: [
        {
          items: [
            {
              card_id: 'catalogue',
              card: { id: 'catalogue', wikipedia_title: 'Global', rarity: 'C' },
              offered_by: 'hidden',
            },
          ],
        },
      ],
    },
    '/api/profile/peer/collection': {
      collection: [
        {
          id: 'foreign-copy',
          card: { id: 'catalogue', wikipedia_title: 'Global', rarity: 'UR' },
          snapshot_rarity: 'SR',
          user_id: 'hidden',
        },
      ],
    },
    '/api/my-collection?owned_by=peer': {
      collection: [
        {
          id: 'foreign-copy',
          card: { id: 'catalogue', wikipedia_title: 'Global', rarity: 'UR' },
          snapshot_rarity: 'R',
          user_id: 'hidden',
        },
      ],
    },
  }
  const events = []
  const window = {
    fetch: async url => new Response(JSON.stringify(payloads[url])),
    dispatchEvent: event => events.push(JSON.parse(event.detail)),
  }
  class XHR {
    open() {}
    send() {}
  }
  class Event {
    constructor(type, data) {
      this.type = type
      this.detail = data.detail
    }
  }
  const result = await build({
    entryPoints: [`${root}/src/network.ts`],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  })
  vm.runInNewContext(result.outputFiles[0].text, {
    window,
    location: { origin: 'https://www.wiki-masters.com' },
    XMLHttpRequest: XHR,
    CustomEvent: Event,
    Request,
    URL,
  })
  for (const url of Object.keys(payloads)) {
    const response = await window.fetch(url)
    assert.deepEqual(await response.json(), payloads[url])
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.deepEqual(
    events.map(event => event.kind),
    [
      'catalogue',
      'market-list',
      'trades',
      'peer-collection',
      'peer-collection',
    ],
  )
  assert.deepEqual(
    events.map(event => event.cards[0].rarity),
    ['L', 'R', 'C', 'SR', 'R'],
  )
  for (const event of events) {
    assert.equal(event.cards[0].id, 'catalogue')
    assert.equal(event.cards[0].copyId, null)
    assert.equal(event.accountId, null)
    assert.equal(JSON.stringify(event).includes('hidden'), false)
  }
})

test('a saved per-tab budget survives reloading the price engine', async () => {
  let calls = 0
  const h = harness(async () => {
    calls++
    return response({})
  })
  h.context.sessionStorage = {
    getItem: () =>
      JSON.stringify({
        requests: Array.from({ length: 200 }, () => h.context.Date.now()),
        cooldown: 0,
      }),
    setItem() {},
  }
  await expose(
    'price-store',
    ['requestPriceQuote', 'priceRequestLimit'],
    h.context,
  )
  await h.context.requestPriceQuote('a')
  assert.equal(calls, 0)
  assert.match(h.context.priceRequestLimit(), /200 requests/)
})
