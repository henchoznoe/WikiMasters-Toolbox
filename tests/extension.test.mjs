import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const dist = new URL('../dist/', import.meta.url)

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

test('the network bridge exposes only relevant card data and preserves fetch responses', async () => {
  const events = []
  const responseBody = {
    collection: [
      { card_id: 'card-1', card: { wikipedia_title: 'Example', rarity: 'R' } },
    ],
  }
  const window = {
    fetch: async () =>
      new Response(JSON.stringify(responseBody), {
        headers: { 'content-type': 'application/json' },
      }),
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

  await window.fetch('https://example.com/api/my-collection')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(events.length, 1)
})

test('automatic opening consumes one pack and stops when none remain', async () => {
  let requests = 0
  const context = {
    window: { addEventListener() {} },
    document: {
      body: {},
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    location: { pathname: '/' },
    localStorage: {
      getItem: () => null,
      setItem() {},
    },
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
        JSON.stringify({ cards: [{ id: 'card-1' }], packs_remaining: 0 }),
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
  const code = await readFile(new URL('content.js', dist), 'utf8')
  vm.runInNewContext(
    `${code}\nglobalThis.testOpen = openAvailablePacks`,
    context,
  )
  await context.testOpen(new AbortController().signal)
  assert.equal(requests, 1)
})
