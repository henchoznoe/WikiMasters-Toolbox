import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

const dist = new URL('../dist/', import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))

async function exposeModule(module, names, context) {
  const imports = names.join(', ')
  const result = await build({
    stdin: {
      contents: `import { ${imports} } from './src/content/${module}.ts'; Object.assign(globalThis, { ${imports} })`,
      resolveDir: root,
      sourcefile: 'test-entry.ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    define: { WM_TOOLBOX_CSS: '""' },
  })
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
    { id: 'packs', label: 'Packs', matches: path => path === '/pulls' },
    {
      id: 'collection',
      label: 'Collection',
      matches: path => path === '/collection',
    },
  ]
  assert.equal(context.resolvePanelPage('/pulls', pages).label, 'Packs')
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
    cards: [{ id: 'card-1', title: 'Example', rarity: 'R' }],
  })

  await window.fetch('/api/packs/open')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(JSON.parse(events[1].detail), {
    kind: 'pack',
    cards: [{ id: 'card-2', title: 'Another', rarity: 'UR' }],
  })

  await window.fetch('https://example.com/api/my-collection')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(events.length, 2)
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
  await exposeModule('packs', ['openAvailablePacks'], context)
  await context.openAvailablePacks(new AbortController().signal)
  assert.equal(requests, 1)
  const stats = JSON.parse(stored.get('wm_toolbox_pack_stats_v1'))
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
          cards: [{ id: `card-${requests}`, rarity: 'R' }],
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
  await exposeModule('packs', ['runPacks'], context)
  await context.runPacks('manual')
  await Promise.resolve()
  assert.equal(requests, 3)
  assert.equal(reloads, 1)
  const stats = JSON.parse(stored.get('wm_toolbox_pack_stats_v1'))
  assert.equal(stats.packs, 3)
  assert.equal(stats.counts.R, 3)
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

test('daily statistics reset after the local date changes', async () => {
  const key = 'wm_toolbox_pack_stats_v1'
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
  const stats = context.readStats()
  assert.equal(stats.packs, 0)
  assert.equal(stats.counts.R, 0)
  assert.equal(stats.dailyReset, true)
  assert.equal(JSON.parse(stored.get(key)).day, stats.day)
})

test('temporary game rate limits pause and retry pack opening', async () => {
  let requests = 0
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
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => {},
    Date,
    Map,
    Set,
  }
  await exposeModule('packs', ['openOnePack'], context)
  const result = await context.openOnePack(new AbortController().signal)
  assert.equal(requests, 2)
  assert.equal(result.packs_remaining, 0)
})
