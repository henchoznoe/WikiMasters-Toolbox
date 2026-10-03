import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import { nativeMarketStubs } from './browser-stubs.mjs'

const DAY = 86400_000
const NOW = Date.UTC(2026, 9, 2, 12)
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const auction = n => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`
const card = { id: 'catalogue-a', rarity: 'R', shiny: false }
const sample = (n, extra = {}) => ({
  auctionId: auction(n),
  ...card,
  amount: n + 1,
  endedAt: NOW - (n % 4) * DAY,
  ...extra,
})
const raw = (extra = {}) => ({
  id: auction(1),
  card_id: card.id,
  user_card_id: 'private-copy',
  card: { id: card.id, wikipedia_title: 'Synthetic card', rarity: 'L' },
  snapshot_rarity: 'R',
  is_shiny: false,
  status: 'settled_sold',
  final_price: 12,
  end_at: new Date(NOW - DAY).toISOString(),
  seller_id: A,
  buyer: { sensitive: 'drop' },
  ...extra,
})
async function expose(module, names, context = {}, extra = '') {
  const result = await build({
    stdin: {
      contents: `import {${names}} from './src/content/${module}.ts'; Object.assign(globalThis,{${names}}); ${extra}`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    write: false,
    define: { WM_TOOLBOX_CSS: '""' },
  })
  Object.assign(context, { AbortController, AbortSignal, URL, URLSearchParams })
  vm.runInNewContext(result.outputFiles[0].text, context)
  return context
}
const plain = value => JSON.parse(JSON.stringify(value))
function memory() {
  const map = new Map()
  return {
    map,
    get length() {
      return map.size
    },
    key: n => [...map.keys()][n] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  }
}
class Clock extends Date {
  static now() {
    return NOW
  }
}

test('sale samples require an explicit concluded result, final amount, end time and variant', async () => {
  const c = await expose('sales-model', 'saleSample,validSample')
  assert.deepEqual(
    plain(c.saleSample(raw(), NOW)),
    sample(1, { amount: 12, endedAt: NOW - DAY }),
  )
  for (const extra of [
    { status: 'active', current_bid: 12 },
    { status: 'settled_unsold' },
    { status: 'cancelled' },
    { final_price: null },
    { final_price: '12' },
    { final_price: -1 },
    { final_price: 0 },
    { final_price: 1.5 },
    { end_at: null },
    { end_at: new Date(NOW + DAY).toISOString() },
    { end_at: new Date(NOW - 31 * DAY).toISOString() },
    { snapshot_rarity: undefined },
    { snapshot_rarity: '??' },
    { is_shiny: undefined },
    { id: 'not-an-auction' },
    { card_id: 'different-catalogue' },
  ])
    assert.equal(c.saleSample(raw(extra), NOW), null, JSON.stringify(extra))
})

test('samples deduplicate auctions, preserve final results, strip private fields and remain bounded', async () => {
  const c = await expose('sales-model', 'mergeSamples,SALES_CAP')
  const first = sample(1)
  const result = c.mergeSamples(
    [first],
    [
      sample(1, { amount: 999 }),
      sample(2, { buyer_id: 'private' }),
      sample(3, { endedAt: NOW - 31 * DAY }),
    ],
    NOW,
  )
  assert.equal(result.length, 2)
  assert.equal(
    result.find(row => row.auctionId === first.auctionId).amount,
    first.amount,
  )
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(
    c.mergeSamples(
      [],
      Array.from({ length: 1200 }, (_, n) => sample(n)),
      NOW,
    ).length,
    c.SALES_CAP,
  )
})

test('median and quartile range use sufficient exact-variant samples and retain extremes', async () => {
  const c = await expose('sales-model', 'estimateSales')
  const rows = Array.from({ length: 10 }, (_, n) =>
    sample(n, { amount: n === 9 ? 1000 : n + 1 }),
  )
  for (const variant of [{ id: 'other' }, { rarity: 'C' }, { shiny: true }])
    rows.push(sample(rows.length + 1, { ...variant, amount: 9000 }))
  const result = c.estimateSales(rows, card, NOW)
  assert.equal(result.count, 10)
  assert.equal(result.median, 5.5)
  assert.deepEqual(plain(result.range), [3.25, 7.75])
  assert.equal(result.extremes, 1)
  assert.equal(c.estimateSales(rows.slice(0, 4), card, NOW).median, null)
  const five = c.estimateSales(rows.slice(0, 5), card, NOW)
  assert.equal(five.median, 3)
  assert.equal(five.range, null)
  assert.equal(
    c.estimateSales(
      rows.map(row => ({ ...row, endedAt: NOW })),
      card,
      NOW,
    ).median,
    null,
  )
  assert.equal(c.estimateSales(rows, card, NOW + 31 * DAY).median, null)
})

test('sales persistence is isolated per account and can be cleared without affecting another account', async () => {
  const localStorage = memory()
  const c = await expose(
    'sales-store',
    'observeSaleSamples,readSaleSamples',
    { localStorage, Date: Clock },
    "import {setAccountId} from './src/content/account.ts'; import {clearCache,inspectCache} from './src/content/cache.ts'; Object.assign(globalThis,{setAccountId,clearCache,inspectCache})",
  )
  c.observeSaleSamples([sample(1)])
  assert.equal(localStorage.length, 0)
  c.setAccountId(A)
  c.observeSaleSamples([sample(1, { seller_id: 'private' })])
  c.setAccountId(B)
  assert.equal(c.readSaleSamples().length, 0)
  c.observeSaleSamples([sample(2)])
  assert.equal(c.inspectCache('sales').count, 1)
  c.clearCache('sales')
  assert.equal(c.readSaleSamples().length, 0)
  c.setAccountId(A)
  assert.equal(c.readSaleSamples().length, 1)
  assert.equal(
    [...localStorage.map.values()].join('').includes('private'),
    false,
  )
  c.setAccountId(null)
  assert.equal(c.readSaleSamples().length, 0)
})

test('free native market history contributes concluded observations without mixing active or unsold listings', async () => {
  const c = await expose(
    'market-store',
    'observeMarket',
    { localStorage: memory(), Date: Clock },
    "import {setAccountId} from './src/content/account.ts'; import {readSaleSamples} from './src/content/sales-store.ts'; Object.assign(globalThis,{setAccountId,readSaleSamples})",
  )
  c.setAccountId(A)
  c.observeMarket({
    mine: true,
    selling: [raw({ status: 'active' })],
    history: [raw(), raw({ id: auction(2), status: 'settled_unsold' })],
  })
  assert.equal(c.readSaleSamples().length, 1)
  assert.equal(c.readSaleSamples()[0].amount, 12)
})

test('collection value excludes unknown and shiny prices, retains one variant copy and preserves zero', async () => {
  const c = await expose('collection-value', 'collectionValue')
  const copy = (n, extra = {}) => ({
    ...card,
    copyId: `copy-${n}`,
    ownerId: A,
    title: 'Synthetic',
    starred: false,
    tagIds: [],
    obtainedAt: null,
    ...extra,
  })
  const cards = [
    copy(1),
    copy(2),
    copy(3, { rarity: 'C' }),
    copy(4, { shiny: true }),
    copy(5, { shiny: true }),
    copy(6, { id: 'unknown' }),
    copy(7, { id: 'zero' }),
    copy(8, { id: 'zero' }),
    copy(1),
  ]
  const result = c.collectionValue(cards, (id, rarity) =>
    id === 'unknown'
      ? { status: 'no-sales', fetchedAt: NOW }
      : {
          status: 'available',
          average: id === 'zero' ? 0 : rarity === 'R' ? 10 : 2,
          fetchedAt: NOW - DAY,
          stale: true,
        },
  )
  assert.deepEqual(plain(result.all), {
    total: 22,
    copies: 8,
    unknown: 3,
    stale: 5,
  })
  assert.deepEqual(plain(result.duplicates), {
    total: 10,
    copies: 3,
    unknown: 1,
    stale: 2,
  })
  assert.equal(result.oldest, NOW - DAY)
  const overflow = c.collectionValue([copy(1), copy(2)], () => ({
    status: 'available',
    average: Number.MAX_VALUE,
    fetchedAt: NOW,
  }))
  assert.equal(overflow.all.total, null)
})

test('decision freshness is 15 minutes while album reuse remains 24 hours and original failure age is visible', async () => {
  const c = await expose(
    'price-context',
    'priceTooOld,priceContext',
    { Date: Clock },
    "import {presentPrice} from './src/content/price-presentation.ts'; globalThis.presentPrice=presentPrice",
  )
  const quote = {
    status: 'available',
    average: 12,
    fetchedAt: NOW - 15 * 60_000,
  }
  assert.equal(c.priceTooOld(quote, 'decision'), true)
  assert.equal(
    c.priceTooOld({ ...quote, fetchedAt: quote.fetchedAt + 1 }, 'decision'),
    false,
  )
  assert.equal(c.priceTooOld(quote, 'album'), false)
  assert.equal(c.priceContext('/trades/abc'), 'decision')
  assert.equal(c.priceContext('/collection'), 'album')
  const failed = c.presentPrice(
    { ...quote, failed: true, lastAttempt: NOW },
    'decision',
  )
  assert.equal(failed.age, '15 min')
  assert.match(failed.hint, /actualisez avant de décider/)
  assert.match(failed.hint, /actualisation échouée/)
  assert.equal(c.presentPrice(quote).value, '12 W')
  assert.equal(c.presentPrice(quote, 'decision').value, '12 W ↻')
})

test('targeted decision batches bypass album TTL, deduplicate and preserve timestamps after a failed refresh', async () => {
  const localStorage = memory()
  localStorage.setItem(
    'wm_toolbox_price_v1_old',
    JSON.stringify({
      fetchedAt: NOW - 20 * 60_000,
      ok: true,
      averages: { R: 12 },
    }),
  )
  localStorage.setItem(
    'wm_toolbox_price_v1_recent',
    JSON.stringify({
      fetchedAt: NOW - 2 * 60_000,
      ok: true,
      averages: { R: 15 },
    }),
  )
  let calls = 0
  const c = await expose(
    'price-store',
    'startPriceBatch,readPriceQuote,needsPriceForContext',
    {
      localStorage,
      sessionStorage: memory(),
      Date: Clock,
      setTimeout,
      clearTimeout,
      fetch: async url => {
        calls++
        assert.match(url, /\/old\/sales\?scope=summary$/)
        return new Response('Busy', { status: 503 })
      },
    },
  )
  assert.equal(c.needsPriceForContext('old', 'album'), false)
  assert.equal(c.needsPriceForContext('old', 'decision'), true)
  await c.startPriceBatch(['old', 'old', 'recent'], false, 50, 'decision')
  assert.equal(calls, 1)
  const quote = c.readPriceQuote('old', 'R')
  assert.equal(quote.average, 12)
  assert.equal(quote.fetchedAt, NOW - 20 * 60_000)
  assert.equal(quote.lastAttempt, NOW)
  assert.equal(quote.failed, true)
  assert.equal(c.needsPriceForContext('old', 'decision'), false)
})

test('mapped market metadata cannot manufacture an explicit shiny flag for samples', async () => {
  const c = await expose(
    'market-store',
    'observeMarketSales',
    { localStorage: memory(), Date: Clock },
    "import {setAccountId} from './src/content/account.ts'; import {mapAuction} from './src/content/market-model.ts'; import {readSaleSamples} from './src/content/sales-store.ts'; Object.assign(globalThis,{setAccountId,mapAuction,readSaleSamples})",
  )
  c.setAccountId(A)
  c.observeMarketSales([], [c.mapAuction(raw({ is_shiny: undefined }))])
  assert.equal(c.readSaleSamples().length, 0)
})

test('native sale observation forwards only validated fields and leaves the response intact', async () => {
  const events = []
  const payload = {
    mine: true,
    selling: [],
    history: [raw(), raw({ id: auction(2), is_shiny: undefined })],
  }
  const window = {
    fetch: async url =>
      new Response(
        JSON.stringify(
          String(url).includes('profiles') ? [{ id: A }] : payload,
        ),
      ),
    dispatchEvent: event => events.push(JSON.parse(event.detail)),
  }
  const result = await build({
    entryPoints: ['src/network.ts'],
    bundle: true,
    write: false,
    format: 'iife',
  })
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
  vm.runInNewContext(result.outputFiles[0].text, {
    window,
    Date: Clock,
    location: { origin: 'https://www.wiki-masters.com' },
    ...nativeMarketStubs(window),
    XMLHttpRequest: XHR,
    CustomEvent: Event,
    Request,
    URL,
  })
  await window.fetch(
    `https://game.supabase.co/rest/v1/profiles?select=id&id=eq.${A}`,
  )
  await new Promise(resolve => setImmediate(resolve))
  const response = await window.fetch('/api/marketplace?mine=1')
  assert.deepEqual(await response.json(), plain(payload))
  await new Promise(resolve => setImmediate(resolve))
  const observation = events.find(event => event.kind === 'sale-samples')
  assert.equal(observation.accountId, A)
  assert.deepEqual(observation.samples, [
    sample(1, { amount: 12, endedAt: NOW - DAY }),
  ])
  for (const privateField of [
    'buyer',
    'seller',
    'private-copy',
    'Synthetic card',
  ])
    assert.equal(JSON.stringify(observation).includes(privateField), false)
})

test('a native sale form uses decision freshness even on the collection route', async () => {
  let saleForm = false
  const c = await expose('price-context', 'currentPriceContext', {
    location: { pathname: '/collection' },
    document: { querySelector: () => (saleForm ? {} : null) },
  })
  assert.equal(c.currentPriceContext(), 'album')
  saleForm = true
  assert.equal(c.currentPriceContext(), 'decision')
})

test('an open inspector follows entry into and exit from a native sale context', async () => {
  class Node {
    children = []
    dataset = {}
    attributes = new Map()
    append(...children) {
      this.children.push(...children)
    }
    replaceChildren(...children) {
      this.children = children
    }
    get firstElementChild() {
      return this.children[0] ?? null
    }
    setAttribute(name, value) {
      this.attributes.set(name, value)
    }
    addEventListener() {}
    focus() {}
    remove() {}
    attachShadow() {
      this.shadowRoot = new Node()
      return this.shadowRoot
    }
    querySelectorAll(selector) {
      const key = selector
        .match(/^\[data-([^\]]+)\]$/)?.[1]
        ?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      return this.children.flatMap(child => [
        ...(key &&
        (key in child.dataset || child.attributes.has(selector.slice(1, -1)))
          ? [child]
          : []),
        ...child.querySelectorAll(selector),
      ])
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null
    }
  }
  const body = new Node()
  let saleForm = false
  const document = {
    body,
    activeElement: null,
    createElement: () => new Node(),
    querySelector: selector =>
      selector.startsWith('input[')
        ? saleForm
          ? {}
          : null
        : body.querySelector(selector),
  }
  const localStorage = memory()
  localStorage.setItem(
    'wm_toolbox_price_v1_old',
    JSON.stringify({
      fetchedAt: NOW - 20 * 60_000,
      ok: true,
      averages: { R: 12 },
    }),
  )
  const c = await expose(
    'price-inspector',
    'openPriceInspector,renderPriceInspector',
    {
      document,
      localStorage,
      Date: Clock,
      location: { pathname: '/collection' },
      CSSStyleSheet: class {
        replaceSync() {}
      },
    },
  )
  c.openPriceInspector('old', 'R', 'Synthetic card')
  const root = body.querySelector('[data-wm-price-inspector]').shadowRoot
  const value = root.querySelector('[data-price-inspector-value]')
  const refresh = root.querySelector('[data-price-refresh]')
  assert.equal(value.textContent, '12 W · 20 min')
  saleForm = true
  c.renderPriceInspector()
  assert.equal(value.textContent, '12 W ↻ · 20 min')
  assert.match(value.title, /actualisez avant de décider/)
  assert.equal(refresh.textContent, '↻ Actualiser avant de décider')
  saleForm = false
  c.renderPriceInspector()
  assert.equal(value.textContent, '12 W · 20 min')
  assert.equal(refresh.textContent, '↻')
})
