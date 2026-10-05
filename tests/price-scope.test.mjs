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
async function bridge(fetch, XHR) {
  const events = []
  const context = {
    window: {
      fetch,
      dispatchEvent: event => events.push(JSON.parse(event.detail)),
    },
    Request,
    URL,
    crypto: { randomUUID: () => 'native-pull-fixture' },
    location: { origin },
    XMLHttpRequest:
      XHR ??
      class {
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
  return { events, window: context.window, XHR: context.XMLHttpRequest }
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

test('native actions stay unchanged; pack responses forward only result metadata', async () => {
  const calls = []
  const { events, window } = await bridge(async (...args) => {
    calls.push(args)
    return json({
      cards: Array.from({ length: 5 }, () => ({
        id: A,
        wikipedia_title: 'Fixture',
        rarity: 'R',
        is_shiny: false,
        privateField: 'private',
      })),
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
    assert.equal((await response.json()).cards[0].id, A)
  }
  await settle()
  assert.deepEqual(events, [
    {
      kind: 'pull-result',
      accountId: null,
      id: 'native-pull-fixture',
      cards: Array.from({ length: 5 }, () => ({
        catalogueId: A,
        title: 'Fixture',
        rarity: 'R',
        shiny: false,
      })),
    },
  ])
  assert.equal(JSON.stringify(events).includes('private'), false)
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

test('failed openings and human verification produce no pack result or retry', async () => {
  const calls = []
  const { events, window } = await bridge(async (...args) => {
    calls.push(args)
    return new Response(
      JSON.stringify({
        human_verification_required: true,
        challenge_token: 'must-not-forward',
        cards: [],
      }),
      { status: 400 },
    )
  })
  const init = { method: 'POST', body: 'native body' }
  const response = await window.fetch('/api/packs/open', init)
  await settle()
  assert.equal(response.status, 400)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], init)
  assert.deepEqual(events, [])
})

test('native XHR pack results strip private fields and leave open/send arguments intact', async () => {
  const calls = []
  class NativeXHR {
    status = 200
    responseType = 'json'
    response = {
      cards: Array.from({ length: 5 }, () => ({
        id: A,
        wikipedia_title: 'Fixture',
        rarity: 'PC',
        is_shiny: true,
        user_card_id: 'private-copy',
      })),
      challenge_token: 'private',
    }
    listeners = []
    open(...args) {
      calls.push(args)
    }
    addEventListener(_name, callback) {
      this.listeners.push(callback)
    }
    send(...args) {
      calls.push(args)
      for (const listener of this.listeners) listener()
    }
  }
  const { events, XHR } = await bridge(() => {
    throw new Error('Unexpected fetch')
  }, NativeXHR)
  const request = new XHR()
  request.open('POST', '/api/packs/open', true)
  request.send('native body')
  assert.deepEqual(calls, [
    ['POST', '/api/packs/open', true, undefined, undefined],
    ['native body'],
  ])
  assert.equal(events[0].kind, 'pull-result')
  assert.equal(events[0].cards[0].shiny, true)
  assert.equal(JSON.stringify(events).includes('private'), false)
})

test('a late native pack response is discarded when the detected account changes', async () => {
  let account = A
  let complete
  const { events, window } = await bridge(async url =>
    String(url).includes('get_my_profile')
      ? json({ id: account })
      : new Promise(resolve => {
          complete = resolve
        }),
  )
  const profile = 'https://fixture.supabase.co/rest/v1/rpc/get_my_profile'
  await window.fetch(profile)
  await settle()
  const pending = window.fetch('/api/packs/open', { method: 'POST' })
  account = B
  await window.fetch(profile)
  await settle()
  complete(
    json({
      cards: Array.from({ length: 5 }, () => ({
        id: A,
        wikipedia_title: 'Fixture',
        rarity: 'R',
      })),
    }),
  )
  await pending
  await settle()
  assert.equal(
    events.some(event => event.kind === 'pull-result'),
    false,
  )
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

test('pack route is passive and never imports old gameplay modules or settings', async () => {
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
  vm.runInNewContext(
    await bundle(
      "import {toolboxPages} from './src/content/routes.ts';globalThis.pages=toolboxPages",
    ),
    c,
  )
  const page = c.pages.find(page => page.matches('/pulls'))
  assert.equal(page.id, 'pulls')
  assert.equal(page.read, undefined)
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
