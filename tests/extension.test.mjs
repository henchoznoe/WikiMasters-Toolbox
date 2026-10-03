import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import { nativeMarketStubs } from './browser-stubs.mjs'

const dist = new URL('../dist/', import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222'

async function exposeModule(module, names, context, extra = '') {
  const imports = names.join(', ')
  const result = await build({
    stdin: {
      contents: `import { ${imports} } from './src/content/${module}.ts'; ${extra}; Object.assign(globalThis, { ${imports} })`,
      resolveDir: root,
      sourcefile: 'test-entry.ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    define: { WM_TOOLBOX_CSS: '""' },
  })
  Object.assign(context, { AbortController, AbortSignal, URL })
  vm.runInNewContext(result.outputFiles[0].text, context)
}

test('the package contains only Chrome-targeted files', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', dist), 'utf8'),
  )
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.minimum_chrome_version, '111')
  assert.equal(manifest.browser_specific_settings, undefined)
  assert.equal(manifest.web_accessible_resources, undefined)
  assert.equal(manifest.content_scripts[1].css, undefined)
  assert.deepEqual(
    manifest.content_scripts.map(script => script.matches),
    [['https://www.wiki-masters.com/*'], ['https://www.wiki-masters.com/*']],
  )
  assert.deepEqual((await readdir(dist)).sort(), [
    'content.js',
    'icons',
    'manifest.json',
    'network.js',
  ])
  for (const size of [16, 32, 48, 128]) {
    const icon = await readFile(new URL(`icons/icon-${size}.png`, dist))
    assert.equal(icon.subarray(1, 4).toString(), 'PNG')
  }
})

test('the shared panel resolves labels by page', async () => {
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
  }
  await exposeModule('panel', ['resolvePanelPage'], context)
  const pages = [
    { id: 'packs', label: 'Paquets', matches: path => path === '/pulls' },
    {
      id: 'collection',
      label: 'Collection',
      matches: path => path === '/collection',
    },
  ]
  assert.equal(context.resolvePanelPage('/pulls', pages).label, 'Paquets')
  assert.equal(
    context.resolvePanelPage('/collection', pages).label,
    'Collection',
  )
  assert.equal(context.resolvePanelPage('/settings', pages), null)
})

test('the network bridge exposes only relevant card data and preserves fetch responses', async () => {
  const events = []
  const responseBody = {
    collection: [
      { card_id: 'card-1', card: { wikipedia_title: 'Example', rarity: 'R' } },
    ],
  }
  const window = {
    fetch: async url =>
      new Response(
        JSON.stringify(
          url === '/api/packs/open'
            ? {
                cards: [
                  { id: 'card-2', wikipedia_title: 'Another', rarity: 'UR' },
                ],
              }
            : String(url).includes('/rest/v1/profiles')
              ? [{ id: ACCOUNT_A, username: 'Example' }]
              : responseBody,
        ),
        {
          headers: { 'content-type': 'application/json' },
        },
      ),
    dispatchEvent: event => events.push(event),
  }
  class FakeXHR {
    open() {}
    send() {}
  }
  class FakeEvent {
    constructor(type, options) {
      this.type = type
      this.detail = options.detail
    }
  }
  const code = await readFile(new URL('network.js', dist), 'utf8')
  vm.runInNewContext(code, {
    window,
    location: { origin: 'https://www.wiki-masters.com' },
    ...nativeMarketStubs(window),
    XMLHttpRequest: FakeXHR,
    Request,
    CustomEvent: FakeEvent,
    URL,
    WeakMap,
  })

  const response = await window.fetch('/api/my-collection?page=0')
  assert.deepEqual(await response.json(), responseBody)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(events.length, 1)
  assert.deepEqual(JSON.parse(events[0].detail), {
    kind: 'collection',
    cards: [
      {
        id: 'card-1',
        title: 'Example',
        rarity: 'R',
        copyId: null,
        shiny: false,
      },
    ],
    accountId: null,
  })

  await window.fetch('/api/packs/open', { method: 'POST' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(JSON.parse(events[2].detail), {
    kind: 'pack',
    cards: [
      {
        id: 'card-2',
        title: 'Another',
        rarity: 'UR',
        copyId: null,
        shiny: false,
      },
    ],
    accountId: null,
  })

  await window.fetch('https://example.com/api/my-collection')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(events.length, 3)

  await window.fetch(
    `https://example.supabase.co/rest/v1/profiles?select=id%2Cusername&id=eq.${ACCOUNT_A}`,
  )
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(JSON.parse(events[3].detail), {
    kind: 'account',
    accountId: ACCOUNT_A,
  })
})

test('automatic opening consumes one pack and stops when none remain', async () => {
  let requests = 0
  const stored = new Map()
  const context = {
    window: { addEventListener() {} },
    document: {
      body: {},
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    location: { pathname: '/' },
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    navigator: { locks: null },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    CSSStyleSheet: class {
      replaceSync() {}
    },
    MutationObserver: class {
      observe() {}
    },
    fetch: async (url, options) => {
      assert.equal(url, '/api/packs/open')
      assert.equal(options.method, 'POST')
      assert.equal(options.credentials, 'include')
      requests += 1
      return new Response(
        JSON.stringify({
          cards: [{ id: 'card-1', rarity: 'UR' }],
          packs_remaining: 0,
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      )
    },
    Response,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => {},
    console,
    Intl,
    Math,
    Date,
    Map,
    Set,
  }
  await exposeModule(
    'packs',
    ['openAvailablePacks'],
    context,
    "import { setAccountId } from './src/content/account.ts'; globalThis.setAccountId = setAccountId",
  )
  context.setAccountId(ACCOUNT_A)
  await context.openAvailablePacks(new AbortController().signal)
  assert.equal(requests, 1)
  const stats = JSON.parse(stored.get(`wm_toolbox_pack_stats_v2:${ACCOUNT_A}`))
  assert.equal(stats.packs, 1)
  assert.equal(stats.counts.UR, 1)
  assert.equal(stats.counts.Other, 0)
})

test('manual bulk opening refreshes the game after every available pack is opened', async () => {
  const stored = new Map()
  let requests = 0
  let reloads = 0
  const context = {
    window: { addEventListener() {} },
    document: { body: null, querySelector: () => null },
    location: {
      pathname: '/pulls',
      reload: () => {
        reloads += 1
      },
    },
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key),
    },
    sessionStorage: {
      getItem: key => stored.get(`session:${key}`) || null,
      setItem: (key, value) => stored.set(`session:${key}`, value),
    },
    navigator: {
      locks: {
        request: (_name, options, callback) =>
          typeof options === 'function' ? options() : callback({}),
      },
    },
    IntersectionObserver: class {
      observe() {}
    },
    CSSStyleSheet: class {
      replaceSync() {}
    },
    MutationObserver: class {
      observe() {}
    },
    fetch: async () => {
      requests += 1
      return new Response(
        JSON.stringify({
          cards: [
            {
              card_id: `card-${requests}`,
              snapshot_rarity: 'R',
              rarity: 'R',
              card: { wikipedia_title: `Card ${requests}` },
            },
          ],
          packs_remaining: 3 - requests,
        }),
      )
    },
    Response,
    AbortController,
    AbortSignal,
    setTimeout: (callback, delay) => {
      if (delay < 10_000) queueMicrotask(callback)
      return 1
    },
    clearTimeout: () => {},
    requestAnimationFrame: () => {},
    Date,
    Map,
    Set,
  }
  await exposeModule(
    'packs',
    ['runPacks'],
    context,
    "import { setAccountId } from './src/content/account.ts'; globalThis.setAccountId = setAccountId",
  )
  context.setAccountId(ACCOUNT_A)
  await context.runPacks('manual')
  await Promise.resolve()
  assert.equal(requests, 3)
  assert.equal(reloads, 1)
  const stats = JSON.parse(stored.get(`wm_toolbox_pack_stats_v2:${ACCOUNT_A}`))
  assert.equal(stats.packs, 3)
  assert.equal(stats.counts.R, 3)
  const summary = JSON.parse(
    stored.get(`session:wm_toolbox_last_pack_run_v2:${ACCOUNT_A}`),
  )
  assert.equal(summary.opened, 3)
  assert.equal(summary.detail, 'Il ne reste aucun paquet.')
  assert.equal(summary.cards.length, 3)
  assert.deepEqual(JSON.parse(JSON.stringify(summary.cards[0])), {
    id: 'card-1',
    title: 'Card 1',
    rarity: 'R',
    pack: 1,
  })
  assert.equal(summary.expanded, true)
})

test('a manual pack limit stops without requesting an extra pack', async () => {
  const stored = new Map()
  let requests = 0
  let reloads = 0
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    window: { addEventListener() {} },
    document: { body: null, querySelector: () => null },
    location: {
      pathname: '/pulls',
      reload: () => {
        reloads += 1
      },
    },
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key),
    },
    sessionStorage: {
      getItem: key => stored.get(`session:${key}`) || null,
      setItem: (key, value) => stored.set(`session:${key}`, value),
    },
    navigator: {
      locks: {
        request: (_name, options, callback) =>
          typeof options === 'function' ? options() : callback({}),
      },
    },
    fetch: async () => {
      requests += 1
      return new Response(
        JSON.stringify({
          cards: [
            {
              id: `card-${requests}`,
              wikipedia_title: `Card ${requests}`,
              rarity: 'C',
            },
          ],
          packs_remaining: 5 - requests,
        }),
      )
    },
    Response,
    AbortController,
    setTimeout: (callback, ms) => {
      if (ms === 12_000) return 2
      queueMicrotask(callback)
      return 1
    },
    clearTimeout: () => {},
    Date,
  }
  await exposeModule(
    'packs',
    ['runPacks', 'setManualLimit'],
    context,
    "import { setAccountId } from './src/content/account.ts'; globalThis.setAccountId = setAccountId",
  )
  context.setAccountId(ACCOUNT_A)
  context.setManualLimit(2)
  await context.runPacks('manual')
  await Promise.resolve()
  assert.equal(requests, 2)
  assert.equal(reloads, 1)
  assert.equal(
    JSON.parse(stored.get(`wm_toolbox_pack_stats_v2:${ACCOUNT_A}`)).packs,
    2,
  )
  const summary = JSON.parse(
    stored.get(`session:wm_toolbox_last_pack_run_v2:${ACCOUNT_A}`),
  )
  assert.equal(summary.opened, 2)
  assert.equal(summary.detail, 'Limite atteinte : 2 paquets.')
  assert.equal(summary.cards.length, 2)
  assert.equal(summary.cards[1].title, 'Card 2')
})

test('scheduled opening uses local 24-hour time', async () => {
  const context = {
    window: { addEventListener() {} },
    document: { body: null },
    location: { pathname: '/' },
    localStorage: { getItem: () => null },
    IntersectionObserver: class {},
    MutationObserver: class {},
    requestAnimationFrame: () => {},
    CSSStyleSheet: class {
      replaceSync() {}
    },
    Date,
    Map,
    Set,
  }
  await exposeModule('packs', ['formatLocalTime'], context)
  const timestamp = new Date(2026, 8, 30, 22, 24).getTime()
  assert.equal(context.formatLocalTime(timestamp), '22h24')
})

test('card prices use the opened rarity without borrowing another rarity', async () => {
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    localStorage: {
      getItem: key =>
        key === 'wm_toolbox_price_v1_card-1'
          ? JSON.stringify({
              fetchedAt: Date.now(),
              ok: true,
              averages: { R: 25 },
            })
          : null,
    },
    Date,
  }
  await exposeModule('prices', ['readPriceQuote'], context)
  const quote = context.readPriceQuote('card-1', 'R')
  assert.equal(quote.status, 'available')
  assert.equal(quote.average, 25)
  assert.ok(quote.fetchedAt <= Date.now())
  assert.equal(context.readPriceQuote('card-1', 'UR').status, 'no-sales')
})

test('missing market cards are distinct from temporary price errors', async () => {
  const entries = new Map([
    [
      'wm_toolbox_price_v1_missing',
      JSON.stringify({
        fetchedAt: Date.now(),
        ok: false,
        notFound: true,
        averages: {},
      }),
    ],
    [
      'wm_toolbox_price_v1_error',
      JSON.stringify({ fetchedAt: Date.now(), ok: false, averages: {} }),
    ],
  ])
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    localStorage: { getItem: key => entries.get(key) || null },
    Date,
  }
  await exposeModule('prices', ['readPriceQuote'], context)
  assert.equal(context.readPriceQuote('missing', 'C').status, 'not-found')
  assert.equal(context.readPriceQuote('error', 'C').status, 'unavailable')
})

test('price presentation shows fetch age without implying a sale window', async () => {
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {},
    Date,
    Intl,
  }
  await exposeModule('prices', ['formatPriceAge', 'presentPrice'], context)
  const fetchedAt = Date.now() - 2 * 60 * 60 * 1000
  assert.equal(context.formatPriceAge(fetchedAt, fetchedAt + 30_000), '<1 min')
  assert.equal(
    context.formatPriceAge(fetchedAt, fetchedAt + 125 * 60_000),
    '2 h',
  )
  const available = context.presentPrice({
    status: 'available',
    average: 125,
    fetchedAt,
  })
  assert.equal(available.value, '125 W')
  assert.equal(available.age, '2 h')
  assert.match(available.hint, /période de calcul non précisée/)
  const noSales = context.presentPrice({ status: 'no-sales', fetchedAt })
  assert.equal(noSales.value, '—')
  assert.equal(noSales.age, '2 h')
  const failed = context.presentPrice({ status: 'unavailable', fetchedAt })
  assert.equal(failed.value, '!')
  assert.equal(failed.age, '')
  assert.equal(context.presentPrice({ status: 'loading' }).value, '…')
})

test('the run recap ranks known prices highest and leaves missing prices last', async () => {
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
  }
  await exposeModule('run-summary', ['compareRunPrices'], context)
  const priced = [
    { status: 'available', average: 4, fetchedAt: 1 },
    { status: 'unavailable', fetchedAt: 1 },
    { status: 'available', average: 25, fetchedAt: 1 },
  ]
  priced.sort(context.compareRunPrices)
  assert.deepEqual(
    priced.map(quote => quote.average ?? null),
    [25, 4, null],
  )
})

test('two due tabs share one automatic run and one next schedule', async () => {
  const initial = {
    enabled: true,
    minMinutes: 1,
    maxMinutes: 1,
    nextAt: Date.now() - 1_000,
  }
  const stored = new Map([
    [`wm_toolbox_auto_v2:${ACCOUNT_A}`, JSON.stringify(initial)],
  ])
  const autoWrites = []
  const held = new Set()
  const locks = {
    request: (name, options, callback) => {
      const action = typeof options === 'function' ? options : callback
      if (held.has(name)) return Promise.resolve(action(null))
      held.add(name)
      return Promise.resolve()
        .then(() => action({ name }))
        .finally(() => held.delete(name))
    },
  }
  let requests = 0
  const summaries = []
  const makeContext = () => ({
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    window: { addEventListener() {} },
    document: { querySelector: () => null },
    location: { pathname: '/', reload: () => {} },
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => {
        stored.set(key, value)
        if (key === `wm_toolbox_auto_v2:${ACCOUNT_A}`)
          autoWrites.push(JSON.parse(value))
      },
    },
    sessionStorage: {
      getItem: () => null,
      setItem: (key, value) => {
        if (key.startsWith('wm_toolbox_last_pack_run_v2:'))
          summaries.push(JSON.parse(value))
      },
    },
    navigator: { locks },
    fetch: async () => {
      requests += 1
      return new Response(
        JSON.stringify({
          cards: [
            { id: 'card-auto', wikipedia_title: 'Auto card', rarity: 'R' },
          ],
          packs_remaining: 0,
        }),
      )
    },
    Response,
    AbortController,
    setTimeout: () => 1,
    clearTimeout: () => {},
    Date,
  })
  const first = makeContext()
  const second = makeContext()
  const extra =
    "import { setAccountId } from './src/content/account.ts'; globalThis.setAccountId = setAccountId"
  await exposeModule('packs', ['runPacks'], first, extra)
  await exposeModule('packs', ['runPacks'], second, extra)
  first.setAccountId(ACCOUNT_A)
  second.setAccountId(ACCOUNT_A)
  await Promise.all([first.runPacks('auto'), second.runPacks('auto')])
  assert.equal(requests, 1)
  assert.equal(autoWrites.length, 2)
  assert.equal(autoWrites[0].nextAt, 0)
  assert.ok(autoWrites[1].nextAt > Date.now())
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].mode, 'auto')
  assert.equal(summaries[0].cards[0].title, 'Auto card')
})

test('daily statistics reset after the local date changes', async () => {
  const key = `wm_toolbox_pack_stats_v2:${ACCOUNT_A}`
  const stored = new Map([
    [
      key,
      JSON.stringify({
        day: '2000-01-01',
        dailyReset: true,
        packs: 4,
        counts: { R: 20 },
      }),
    ],
  ])
  const context = {
    window: { addEventListener() {} },
    document: { body: null, querySelector: () => null },
    location: { pathname: '/' },
    localStorage: {
      getItem: name => stored.get(name) || null,
      setItem: (name, value) => stored.set(name, value),
    },
    IntersectionObserver: class {
      observe() {}
    },
    CSSStyleSheet: class {
      replaceSync() {}
    },
    MutationObserver: class {
      observe() {}
    },
    navigator: { locks: null },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => {},
    Date,
    Map,
    Set,
  }
  await exposeModule('stats', ['readStats'], context)
  const stats = context.readStats(ACCOUNT_A)
  assert.equal(stats.packs, 0)
  assert.equal(stats.counts.R, 0)
  assert.equal(stats.dailyReset, true)
  assert.equal(JSON.parse(stored.get(key)).day, stats.day)
})

test('pack statistics stay with the account that opened the packs', async () => {
  const stored = new Map([
    ['wm_toolbox_pack_stats_v1', '{"packs":7,"dailyReset":true}'],
  ])
  const context = {
    document: { querySelector: () => null },
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    navigator: { locks: null },
    setTimeout: () => 1,
    clearTimeout: () => {},
    Date,
  }
  await exposeModule(
    'stats',
    ['readStats', 'recordPack'],
    context,
    "import { setAccountId } from './src/content/account.ts'; globalThis.setAccountId = setAccountId",
  )
  context.setAccountId(ACCOUNT_A)
  assert.equal(context.readStats().dailyReset, false)
  await context.recordPack([{ rarity: 'R' }])
  context.setAccountId(ACCOUNT_B)
  assert.equal(context.readStats().packs, 0)
  await context.recordPack([{ rarity: 'C' }])
  context.setAccountId(ACCOUNT_A)
  assert.equal(context.readStats().counts.R, 1)
  assert.equal(context.readStats().counts.C, 0)
  assert.equal(
    stored.get('wm_toolbox_pack_stats_v1'),
    '{"packs":7,"dailyReset":true}',
  )
})

test('temporary game rate limits pause and retry pack opening', async () => {
  let requests = 0
  let now = Date.now()
  const context = {
    window: { addEventListener() {} },
    document: { body: null, querySelector: () => null },
    location: { pathname: '/' },
    localStorage: { getItem: () => null },
    IntersectionObserver: class {
      observe() {}
    },
    CSSStyleSheet: class {
      replaceSync() {}
    },
    MutationObserver: class {
      observe() {}
    },
    fetch: async () => {
      requests += 1
      return requests === 1
        ? new Response(
            JSON.stringify({
              rate_limited: true,
              rate_limit_daily: false,
              retry_after: new Date(Date.now() - 100).toISOString(),
            }),
            { status: 429, headers: { 'content-type': 'application/json' } },
          )
        : new Response(
            JSON.stringify({ cards: [{ id: 'card-1' }], packs_remaining: 0 }),
          )
    },
    Response,
    AbortController,
    AbortSignal,
    setTimeout: (callback, ms) => {
      if (ms === 12_000) return 1
      now += ms
      return setTimeout(callback, 0)
    },
    clearTimeout,
    requestAnimationFrame: () => {},
    Date: class extends Date {
      static now() {
        return now
      }
    },
    Map,
    Set,
  }
  await exposeModule('packs', ['openOnePack'], context)
  const result = await context.openOnePack(new AbortController().signal)
  assert.equal(requests, 2)
  assert.equal(result.packs_remaining, 0)
})

for (const [mode, beforeChallenge] of [
  ['manual', 0],
  ['manual', 1],
  ['auto', 0],
]) {
  test(`${mode} opening pauses for verification after ${beforeChallenge} packs and survives reload`, async () => {
    const stored = new Map([
      [
        `wm_toolbox_auto_v2:${ACCOUNT_A}`,
        JSON.stringify({
          enabled: mode === 'auto',
          minMinutes: 60,
          maxMinutes: 60,
          nextAt: Date.now() - 1000,
        }),
      ],
    ])
    let requests = 0
    let reloads = 0
    const timers = new Map()
    let timerId = 0
    const makeContext = () => ({
      window: { addEventListener() {} },
      document: { querySelector: () => null },
      location: {
        pathname: '/pulls',
        reload: () => {
          reloads += 1
        },
      },
      localStorage: {
        getItem: key => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value),
      },
      sessionStorage: {
        getItem: key => stored.get(`session:${key}`) || null,
        setItem: (key, value) => stored.set(`session:${key}`, value),
      },
      navigator: {
        locks: {
          request: (_name, options, callback) =>
            typeof options === 'function' ? options() : callback({}),
        },
      },
      CSSStyleSheet: class {
        replaceSync() {}
      },
      IntersectionObserver: class {
        observe() {}
      },
      fetch: async () => {
        requests += 1
        return requests <= beforeChallenge
          ? new Response(
              JSON.stringify({
                cards: [{ id: `card-${requests}`, rarity: 'C' }],
                packs_remaining: 10,
              }),
            )
          : new Response(
              JSON.stringify({
                human_verification_required: true,
                rate_limited: true,
              }),
              { status: 403 },
            )
      },
      AbortController,
      setTimeout: (callback, delay) => {
        const id = ++timerId
        if (delay < 10000) queueMicrotask(callback)
        else timers.set(id, callback)
        return id
      },
      clearTimeout: id => timers.delete(id),
      Date,
    })
    const names = [
      'runPacks',
      'scheduleAuto',
      'getPrefs',
      'getStatus',
      'observeNativePack',
      'setAutoEnabled',
    ]
    const extra =
      "import { setAccountId } from './src/content/account.ts'; globalThis.setAccountId = setAccountId"
    const context = makeContext()
    await exposeModule('packs', names, context, extra)
    context.setAccountId(ACCOUNT_A)
    await context.runPacks(mode)
    assert.equal(requests, beforeChallenge + 1)
    assert.equal(context.getPrefs().verificationRequired, true)
    assert.equal(context.getPrefs().nextAt, 0)
    assert.match(context.getStatus(), /Vérification requise/)
    assert.equal(timers.size, 0)
    assert.equal(reloads, 0)
    const summary = JSON.parse(
      stored.get(`session:wm_toolbox_last_pack_run_v2:${ACCOUNT_A}`),
    )
    assert.equal(summary.opened, beforeChallenge)
    assert.equal(summary.cards.length, beforeChallenge)
    assert.match(summary.detail, /Vérification requise/)
    const stats = stored.get(`wm_toolbox_pack_stats_v2:${ACCOUNT_A}`)
    assert.equal(stats ? JSON.parse(stats).packs : 0, beforeChallenge)

    const reloaded = makeContext()
    await exposeModule('packs', names, reloaded, extra)
    reloaded.setAccountId(ACCOUNT_A)
    reloaded.setAutoEnabled(true)
    reloaded.scheduleAuto()
    await reloaded.runPacks('auto')
    await reloaded.runPacks('manual')
    assert.equal(requests, beforeChallenge + 1)
    assert.equal(timers.size, 0)
    assert.equal(reloaded.getPrefs().nextAt, 0)
    assert.match(reloaded.getStatus(), /Vérification requise/)
    reloaded.observeNativePack()
    assert.equal(reloaded.getPrefs().verificationRequired, false)
    assert.ok(reloaded.getPrefs().nextAt > Date.now())
    assert.equal(timers.size, 1)
  })
}

test('the bridge recognizes the current single-profile response and forwards only a verification notice', async () => {
  const events = []
  const window = {
    fetch: async url =>
      String(url).includes('/profiles')
        ? new Response(JSON.stringify({ id: ACCOUNT_A, username: 'Example' }))
        : new Response(
            JSON.stringify({
              human_verification_required: true,
              private_field: 'never forward',
            }),
            { status: 403 },
          ),
    dispatchEvent: event => events.push(JSON.parse(event.detail)),
  }
  class FakeXHR {
    open() {}
    send() {}
  }
  class FakeEvent {
    constructor(_type, options) {
      this.detail = options.detail
    }
  }
  vm.runInNewContext(await readFile(new URL('network.js', dist), 'utf8'), {
    window,
    location: { origin: 'https://www.wiki-masters.com' },
    ...nativeMarketStubs(window),
    XMLHttpRequest: FakeXHR,
    Request,
    CustomEvent: FakeEvent,
    URL,
    WeakMap,
  })
  await window.fetch(
    `https://example.supabase.co/rest/v1/profiles?select=id%2C+username&id=eq.${ACCOUNT_A}`,
  )
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(events, [{ kind: 'account', accountId: ACCOUNT_A }])
  const response = await window.fetch('/api/packs/open', { method: 'POST' })
  assert.equal((await response.json()).human_verification_required, true)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(events[1], {
    kind: 'pack-verification-required',
    accountId: ACCOUNT_A,
  })
  await window.fetch('https://example.com/api/packs/open', { method: 'POST' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(events.length, 2)
})
