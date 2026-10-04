import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const origin = 'https://www.wiki-masters.com'
async function bundle(entry) {
  return (
    await build({
      stdin: { contents: entry, resolveDir: process.cwd() },
      bundle: true,
      write: false,
      format: 'iife',
      define: { WM_TOOLBOX_CSS: '""' },
    })
  ).outputFiles[0].text
}
function memory(entries = []) {
  const data = new Map(entries)
  return {
    get length() {
      return data.size
    },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  }
}
const json = data =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })
async function bridge(fetch) {
  const events = []
  const context = {
    window: {
      fetch,
      dispatchEvent: event => events.push(JSON.parse(event.detail)),
    },
    Request,
    URL,
    location: { origin },
    XMLHttpRequest: class {
      open() {}
      send() {}
    },
    CustomEvent: class {
      constructor(_type, options) {
        this.detail = options.detail
      }
    },
  }
  vm.runInNewContext(await readFile('dist/network.js', 'utf8'), context)
  return { events, window: context.window }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('Toolbox transport rejects unrelated URLs and can only send GET price reads', async () => {
  const calls = []
  const c = {
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    localStorage: memory(),
    sessionStorage: memory(),
    fetch: async (url, init) => {
      calls.push({ url, method: init.method })
      return json({ summary: {} })
    },
  }
  vm.runInNewContext(
    await bundle(
      "import {requestData} from './src/content/requests.ts';globalThis.read=requestData",
    ),
    c,
  )
  for (const url of [
    '/api/packs/open',
    '/api/user-cards/copy/discard',
    '/api/trades/accept',
    '/api/marketplace',
    'https://example.com/api/cards',
  ])
    await assert.rejects(c.read(url), /périmètre prix/)
  await c.read(
    '/api/marketplace/cards/catalogue/sales?scope=summary',
    undefined,
    { method: 'POST', body: '{}' },
  )
  assert.deepEqual(calls, [
    {
      url: '/api/marketplace/cards/catalogue/sales?scope=summary',
      method: 'GET',
    },
  ])
})

test('native game actions pass through unchanged and are never consumed by the price bridge', async () => {
  const calls = []
  const { events, window } = await bridge(async (...args) => {
    calls.push(args)
    return json({
      cards: [{ id: 'card', wikipedia_title: 'Fixture', rarity: 'R' }],
      auction_id: A,
    })
  })
  for (const url of [
    '/api/packs/open',
    '/api/user-cards/copy/discard',
    '/api/trades/accept',
    '/api/marketplace',
  ]) {
    const init = { method: 'POST', body: 'native body' }
    const response = await window.fetch(url, init)
    assert.equal(calls.at(-1)[1], init)
    assert.equal((await response.json()).cards[0].id, 'card')
  }
  await settle()
  assert.deepEqual(events, [])
})

test('price bridge preserves native responses, strips private metadata and forwards exact card variants', async () => {
  const raw = {
    cards: [
      {
        id: 'catalogue',
        wikipedia_title: 'Fixture',
        rarity: 'R',
        privateField: 'private',
      },
    ],
  }
  const { events, window } = await bridge(async () => json(raw))
  const response = await window.fetch('/api/cards')
  assert.deepEqual(await response.json(), raw)
  await settle()
  const event = events.find(row => row.kind === 'catalogue')
  assert.deepEqual(event.cards, [
    {
      id: 'catalogue',
      title: 'Fixture',
      rarity: 'R',
      copyId: null,
      shiny: false,
    },
  ])
  assert.equal(JSON.stringify(events).includes('private'), false)
})

test('late native page responses cannot leak card identities into a different account', async () => {
  let account = A
  let resolvePage
  const { events, window } = await bridge(async url =>
    String(url).includes('get_my_profile')
      ? json({ id: account })
      : new Promise(resolve => {
          resolvePage = resolve
        }),
  )
  const profile = 'https://fixture.supabase.co/rest/v1/rpc/get_my_profile'
  await window.fetch(profile)
  await settle()
  const late = window.fetch('/api/my-collection')
  account = B
  await window.fetch(profile)
  await settle()
  resolvePage(
    json({
      collection: [
        {
          id: 'copy',
          user_id: A,
          card: { id: 'catalogue', wikipedia_title: 'Fixture', rarity: 'R' },
        },
      ],
    }),
  )
  await late
  await settle()
  assert.equal(events.at(-1).accountId, B)
  assert.equal(
    events.some(row => row.kind === 'collection'),
    false,
  )
})

test('pack page installs no Toolbox controls or requests even with old settings present', async () => {
  const timers = []
  const intervals = []
  const storage = memory([
    [`wm_toolbox_auto_v2:${A}`, JSON.stringify({ enabled: true, nextAt: 1 })],
  ])
  const c = {
    window: {
      addEventListener() {},
      setInterval: callback => intervals.push(callback),
      matchMedia: () => ({ matches: false }),
    },
    document: {
      body: {},
      visibilityState: 'visible',
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => {
        throw new Error('Unexpected pack controls')
      },
    },
    location: { pathname: '/pulls', search: '' },
    localStorage: storage,
    sessionStorage: memory(),
    MutationObserver: class {
      observe() {}
    },
    IntersectionObserver: class {
      disconnect() {}
    },
    CSSStyleSheet: class {
      replaceSync() {}
    },
    AbortController,
    AbortSignal,
    URL,
    setTimeout: callback => {
      timers.push(callback)
      return timers.length
    },
    clearTimeout() {},
    fetch: () => {
      throw new Error('Unexpected pack request')
    },
  }
  vm.runInNewContext(await readFile('dist/content.js', 'utf8'), c)
  for (const callback of intervals) callback()
  for (const callback of timers.splice(0)) callback()
  assert.ok(storage.getItem(`wm_toolbox_auto_v2:${A}`))
  const files = await readdir('src/content')
  assert.equal(
    files.some(file =>
      /^(packs|stats|run-summary|selection|collection-actions|sale)\./.test(
        file,
      ),
    ),
    false,
  )
})
