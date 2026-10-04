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
  Object.assign(context, { AbortController, AbortSignal, URL })
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
      setTimeout: (callback, ms) => {
        if (ms === 12_000) return 2
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
      'isPriceLoading',
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
  assert.equal(h.context.isPriceLoading('a'), true)
  h.context.cancelPriceBatch()
  assert.equal(
    h.context.isPriceLoading('a'),
    true,
    'stopping the batch must not hide an in-flight read',
  )
  release()
  await batch
  assert.equal(h.context.isPriceLoading('a'), false)
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
  assert.match(h.context.priceRequestLimit(), /Pause serveur/)
  assert.equal(h.context.readPriceQuote('a', 'R').status, 'unavailable')
  h.advance(61_000)
  await h.context.startPriceBatch(['b'])
  assert.equal(calls, 2)
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
  assert.match(h.context.priceRequestLimit(), /200 requêtes/)
})
