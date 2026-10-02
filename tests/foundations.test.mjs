import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import { nativeMarketStubs } from './browser-stubs.mjs'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
function storage() {
  const data = new Map()
  return {
    data,
    get length() {
      return data.size
    },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  }
}
function fixture(fetch = async () => new Response('{}')) {
  let now = Date.now()
  const timers = new Map()
  let sequence = 0
  const context = {
    AbortController,
    AbortSignal,
    URL,
    Response,
    fetch,
    localStorage: storage(),
    sessionStorage: storage(),
    Date: class extends Date {
      static now() {
        return now
      }
    },
    setTimeout: (callback, ms) => {
      const id = ++sequence
      if (ms === 12_000) timers.set(id, callback)
      else {
        now += ms
        queueMicrotask(callback)
      }
      return id
    },
    clearTimeout: id => timers.delete(id),
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {
      observe() {}
      disconnect() {}
    },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    location: { pathname: '/pulls' },
    navigator: { locks: null },
  }
  return {
    context,
    timers,
    advance: ms => {
      now += ms
    },
  }
}
async function expose(context, imports) {
  const source = Object.entries(imports)
    .map(
      ([path, names]) =>
        `import {${names}} from './src/${path}.ts'; Object.assign(globalThis,{${names}});`,
    )
    .join('\n')
  const result = await build({
    stdin: { contents: source, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
    define: { WM_TOOLBOX_CSS: '""' },
  })
  vm.runInNewContext(result.outputFiles[0].text, context)
  return context
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('account settings and verification never inherit shared legacy or another account values', async () => {
  const f = fixture()
  f.context.localStorage.setItem(
    'wm_toolbox_auto_v1',
    JSON.stringify({
      enabled: true,
      verificationRequired: true,
      minMinutes: 2,
    }),
  )
  const c = await expose(f.context, {
    'content/account': 'setAccountId',
    'content/packs':
      'getPrefs,setManualLimit,getManualLimit,setMinMinutes,requirePackVerification',
  })
  c.setAccountId(A)
  assert.equal(c.getPrefs().enabled, false)
  assert.equal(c.getPrefs().verificationRequired, false)
  c.setMinMinutes(7)
  c.setManualLimit(3)
  c.requirePackVerification()
  c.setAccountId(B)
  assert.equal(c.getPrefs().minMinutes, 20)
  assert.equal(c.getPrefs().verificationRequired, false)
  assert.equal(c.getManualLimit(), null)
  c.setAccountId(A)
  assert.equal(c.getPrefs().minMinutes, 7)
  assert.equal(c.getManualLimit(), 3)
  assert.equal(c.getPrefs().verificationRequired, true)
  c.setAccountId(null)
  assert.equal(c.getPrefs().enabled, false)
  assert.equal(c.getManualLimit(), null)
})

test('cache cleanup bounds entries and age and targeted clearing preserves another account and site data', async () => {
  const f = fixture()
  const c = await expose(f.context, {
    'content/account': 'setAccountId',
    'content/cache':
      'writeCache,inspectCache,clearCache,cleanCaches,cachePolicies',
  })
  const saved = c.localStorage
  saved.setItem('native-cache', 'preserve')
  saved.setItem(
    `wm_toolbox_collection_v1:${A}`,
    JSON.stringify({ updatedAt: c.Date.now() }),
  )
  saved.setItem(
    `wm_toolbox_collection_v1:${B}`,
    JSON.stringify({ updatedAt: c.Date.now() }),
  )
  saved.setItem(
    'wm_toolbox_price_v1_expired',
    JSON.stringify({ fetchedAt: c.Date.now() - 31 * 86400_000 }),
  )
  saved.setItem('wm_toolbox_price_v1_corrupt', '{broken')
  for (let i = 0; i < 1001; i++)
    saved.setItem(
      `wm_toolbox_price_v1_${i}`,
      JSON.stringify({ fetchedAt: c.Date.now() - i }),
    )
  c.cleanCaches()
  assert.equal(c.inspectCache('prices').count, 1000)
  assert.equal(saved.getItem('wm_toolbox_price_v1_1000'), null)
  assert.equal(saved.getItem('wm_toolbox_price_v1_expired'), null)
  assert.equal(saved.getItem('wm_toolbox_price_v1_corrupt'), null)
  c.setAccountId(A)
  c.clearCache('collection')
  assert.equal(saved.getItem(`wm_toolbox_collection_v1:${A}`), null)
  assert.ok(saved.getItem(`wm_toolbox_collection_v1:${B}`))
  assert.equal(saved.getItem('native-cache'), 'preserve')
  assert.equal(c.writeCache('prices', 'native-cache', {}), false)
  assert.equal(
    c.writeCache('prices', 'wm_toolbox_price_v1_oversize', {
      fetchedAt: c.Date.now(),
      text: 'a'.repeat(2 * 1024 * 1024),
    }),
    false,
  )
})

test('shared reads deduplicate independently cancellable clients and serialize different views', async () => {
  let finish
  const calls = []
  const f = fixture(async url => {
    calls.push(url)
    if (url === '/api/a')
      await new Promise(resolve => {
        finish = resolve
      })
    return new Response(JSON.stringify({ url }))
  })
  const c = await expose(f.context, { 'content/requests': 'requestJson' })
  const first = new AbortController()
  const cancelled = c.requestJson('/api/a', first.signal)
  const surviving = c.requestJson('/api/a', new AbortController().signal)
  const queued = c.requestJson('/api/b', new AbortController().signal)
  first.abort(new Error('Cancelled client'))
  await assert.rejects(cancelled, /Cancelled client/)
  assert.deepEqual(calls, ['/api/a'])
  finish()
  assert.equal((await surviving).url, '/api/a')
  assert.equal((await queued).url, '/api/b')
  assert.deepEqual(calls, ['/api/a', '/api/b'])
})

test('server pauses apply across price, collection and writes; transport retries are bounded', async () => {
  let calls = 0
  const f = fixture(async () => {
    calls++
    return new Response('{}', {
      status: 429,
      headers: { 'Retry-After': '120' },
    })
  })
  const c = await expose(f.context, {
    'content/requests': 'requestJson,requestWrite,requestLimit',
  })
  await assert.rejects(c.requestJson('/api/prices'), /429/)
  await assert.rejects(c.requestJson('/api/collection'), /Server pause/)
  await assert.rejects(
    c.requestWrite('/api/write', new AbortController().signal, {}),
    /Server pause/,
  )
  assert.equal(calls, 1)
  f.advance(121_000)
  assert.equal(c.requestLimit(), '')
  c.fetch = async () => {
    calls++
    throw new Error('Network error')
  }
  await assert.rejects(c.requestJson('/api/retry'), /Network error/)
  assert.equal(calls, 4)
  await assert.rejects(
    c.requestWrite('/api/write', new AbortController().signal, {}),
    /Network error/,
  )
  assert.equal(calls, 5)
})

test('account and route cancellation reject late responses and drop queued reads', async () => {
  let release
  let calls = 0
  const f = fixture(async () => {
    calls++
    return new Promise(resolve => {
      release = resolve
    })
  })
  const c = await expose(f.context, {
    'content/account': 'setAccountId',
    'content/requests': 'requestJson,cancelRequests',
  })
  c.setAccountId(A)
  const active = c.requestJson('/api/collection')
  const queued = c.requestJson('/api/market')
  const rejected = Promise.all([
    assert.rejects(active, /stopped/i),
    assert.rejects(queued, /stopped/i),
  ])
  c.setAccountId(B)
  release(new Response('{"old":true}'))
  await rejected
  assert.equal(calls, 1)
  c.fetch = async () => new Response('{"new":true}')
  assert.equal((await c.requestJson('/api/collection')).new, true)
  c.cancelRequests()
})

test('the shared timeout covers stalled response decoding and releases the queue', async () => {
  const f = fixture(async () => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    json: () => new Promise(() => {}),
  }))
  const c = await expose(f.context, { 'content/requests': 'requestWrite' })
  const writing = c.requestWrite('/api/write', new AbortController().signal, {})
  await settle()
  for (const timer of f.timers.values()) timer()
  await assert.rejects(writing, /timed out/)
  c.fetch = async () => new Response('{}')
  await c.requestWrite('/api/next', new AbortController().signal, {})
})

test('route contracts reject malformed identities and separate catalogue, trade, market and pack adapters', async () => {
  const c = await expose(fixture().context, {
    'content/page-adapters': 'resolvePageAdapter,parsePageCards,cardSelectors',
    'content/compatibility': 'setCompatibilityIssue,collectionCompatible',
    'content/account': 'setAccountId',
  })
  for (const [path, id] of [
    ['/collection', 'collection'],
    ['/global-collection', 'catalogue'],
    ['/trades', 'trades'],
    ['/marketplace', 'market'],
    ['/pulls', 'packs'],
  ])
    assert.equal(c.resolvePageAdapter(path).id, id)
  assert.equal(c.resolvePageAdapter('/settings'), null)
  const catalogue = c.resolvePageAdapter('/global-collection')
  assert.equal(
    c.parsePageCards(catalogue, { cards: [{ wikipedia_title: 'Missing ID' }] }),
    null,
  )
  assert.equal(c.parsePageCards(catalogue, { renamed: [] }), null)
  assert.equal(
    c.parsePageCards(c.resolvePageAdapter('/trades'), {
      trades: [{ items: null }],
    }),
    null,
  )
  const valid = c.parsePageCards(catalogue, {
    cards: [{ id: 'public-id', wikipedia_title: 'Synthetic', rarity: 'R' }],
  })
  assert.equal(valid[0].id, 'public-id')
  assert.equal(valid[0].copyId, null)
  assert.match(c.cardSelectors.grid, /rounded-2xl/)
  assert.match(c.cardSelectors.modal, /Vue de la carte/)
  c.setAccountId(A)
  c.setCompatibilityIssue('collection', 'Changed')
  assert.equal(c.collectionCompatible(), false)
  c.setAccountId(B)
  assert.equal(c.collectionCompatible(), true)
})

test('clearing prices during a request cannot repopulate the cleared cache with its late response', async () => {
  let release
  const f = fixture(
    () =>
      new Promise(resolve => {
        release = resolve
      }),
  )
  const c = await expose(f.context, {
    'content/price-store': 'requestPriceQuote,readPriceQuote',
    'content/cache': 'clearCache',
  })
  const reading = c.requestPriceQuote('synthetic')
  c.clearCache('prices')
  release(new Response('{"summary":{"R":{"average":9}}}'))
  await reading
  assert.equal(c.localStorage.getItem('wm_toolbox_price_v1_synthetic'), null)
  assert.equal(c.readPriceQuote('synthetic', 'R').status, 'loading')
})

test('a pack response arriving after account change cannot affect the new account statistics or settings', async () => {
  let release
  const f = fixture(
    () =>
      new Promise(resolve => {
        release = resolve
      }),
  )
  f.context.navigator.locks = {
    request: async (_name, _options, callback) => callback({}),
  }
  const c = await expose(f.context, {
    'content/account': 'setAccountId',
    'content/packs': 'runPacks,getPrefs',
    'content/stats': 'readStats',
  })
  c.setAccountId(A)
  const opening = c.runPacks('manual')
  await settle()
  c.setAccountId(B)
  release(
    new Response(
      '{"cards":[{"id":"synthetic","wikipedia_title":"Synthetic","rarity":"R"}],"packs_remaining":0}',
    ),
  )
  await opening
  assert.equal(c.readStats().packs, 0)
  assert.equal(c.getPrefs().enabled, false)
  assert.equal(c.localStorage.getItem(`wm_toolbox_pack_stats_v2:${B}`), null)
  const old = JSON.parse(
    c.sessionStorage.getItem(`wm_toolbox_last_pack_run_v2:${A}`),
  )
  assert.equal(old.opened, 0)
  assert.equal(old.cards.length, 0)
})

async function bridge(fetch) {
  const events = []
  const window = {
    fetch,
    dispatchEvent: event => events.push(JSON.parse(event.detail)),
  }
  const context = {
    window,
    location: { origin: 'https://www.wiki-masters.com', pathname: '/' },
    URL,
    Request,
    ...nativeMarketStubs(window),
    XMLHttpRequest: class {
      open() {}
      send() {}
    },
    CustomEvent: class {
      constructor(_name, options) {
        this.detail = options.detail
      }
    },
  }
  await expose(context, { network: '' })
  return { window, events }
}

test('logout blocks late account discovery even before the first account response and with no response body', async () => {
  let release
  const c = await bridge(async url => {
    if (String(url).includes('get_my_profile'))
      return new Promise(resolve => {
        release = resolve
      })
    if (String(url).includes('/auth/v1/logout'))
      return new Response(null, { status: 204 })
    return new Response(
      JSON.stringify({
        collection: [
          {
            id: 'synthetic-copy',
            card_id: 'synthetic',
            user_id: A,
            card: {
              id: 'synthetic',
              wikipedia_title: 'Synthetic',
              rarity: 'R',
            },
          },
        ],
      }),
    )
  })
  const pending = c.window.fetch(
    'https://example.supabase.co/rest/v1/rpc/get_my_profile',
  )
  await c.window.fetch('https://example.supabase.co/auth/v1/logout', {
    method: 'POST',
  })
  release(new Response(JSON.stringify({ id: A })))
  await pending
  await settle()
  await c.window.fetch('/api/my-collection')
  await settle()
  assert.equal(
    c.events.some(event => event.kind === 'account' && event.accountId === A),
    false,
  )
  assert.equal(
    c.events.filter(event => event.kind === 'account').at(-1).accountId,
    null,
  )
})

test('native format changes expose only a diagnostic, keep native responses intact and recover on a valid page', async () => {
  let valid = false
  const c = await bridge(
    async () =>
      new Response(
        JSON.stringify(
          valid
            ? {
                cards: [
                  {
                    id: 'synthetic',
                    wikipedia_title: 'Synthetic',
                    rarity: 'R',
                  },
                ],
              }
            : { renamed: [], private_metadata: 'must-not-forward' },
        ),
      ),
  )
  const original = await c.window.fetch('/api/cards')
  assert.equal((await original.json()).private_metadata, 'must-not-forward')
  await settle()
  assert.equal(c.events.at(-1).kind, 'compatibility')
  assert.equal(c.events.at(-1).compatible, false)
  assert.equal(JSON.stringify(c.events).includes('must-not-forward'), false)
  valid = true
  await c.window.fetch('/api/cards')
  await settle()
  assert.equal(c.events.at(-2).compatible, true)
  assert.equal(c.events.at(-1).kind, 'catalogue')
})

test('a changed grid selector produces a visible compatibility diagnostic without attaching a price to another card', async () => {
  const f = fixture()
  const heading = { textContent: 'Synthetic', closest: () => null }
  f.context.document.querySelectorAll = selector =>
    selector === 'h3' ? [heading] : []
  f.context.location.pathname = '/collection'
  const c = await expose(f.context, {
    'content/prices': 'registerCards,renderCards',
    'content/compatibility': 'getCompatibilityIssues',
  })
  c.registerCards([
    {
      id: 'synthetic',
      title: 'Synthetic',
      rarity: 'R',
      copyId: null,
      shiny: false,
    },
  ])
  c.renderCards()
  assert.match(c.getCompatibilityIssues().join(' '), /Card layout changed/)
})

test('background diagnostics stay on their affected route and native count responses are not card contracts', async () => {
  const c = await expose(fixture().context, {
    'content/compatibility': 'setCompatibilityIssue,getCompatibilityIssues',
  })
  c.setCompatibilityIssue('trades', 'Trades format changed')
  assert.equal(c.getCompatibilityIssues('collection').length, 0)
  assert.equal(c.getCompatibilityIssues('trades').length, 1)
  const native = await bridge(async () => new Response('{"count":0}'))
  await native.window.fetch('/api/trades?count=1')
  await settle()
  assert.equal(
    native.events.some(event => event.kind === 'compatibility'),
    false,
  )
})
