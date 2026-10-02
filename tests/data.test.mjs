import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import { nativeMarketStubs } from './browser-stubs.mjs'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
async function expose(path, names, context, extra = '') {
  const result = await build({
    stdin: {
      contents: `import { ${names.join(',')} } from './src/${path}.ts'; ${extra}; Object.assign(globalThis,{${names.join(',')}})`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    write: false,
    define: { WM_TOOLBOX_CSS: '""' },
  })
  Object.assign(context, { AbortController, AbortSignal, URL })
  vm.runInNewContext(result.outputFiles[0].text, context)
}
function row(index, owner = A) {
  return {
    id: `copy-${index}`,
    card_id: 'catalogue-shared',
    user_id: owner,
    count: 1,
    snapshot_rarity: index % 2 ? 'C' : 'R',
    is_shiny: index === 1,
    card: {
      id: 'catalogue-shared',
      wikipedia_title: 'Same title',
      rarity: 'SR',
    },
    tags: [{ id: 'protected' }],
    starred: index === 0,
  }
}
async function indexContext(fetch, stored = new Map(), timers = {}) {
  const context = {
    fetch,
    AbortController,
    Response,
    Date,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    ...timers,
  }
  await expose(
    'content/collection',
    [
      'loadCollection',
      'stopCollectionLoad',
      'getCollectionState',
      'getOwnedCopy',
      'getOwnedVariants',
      'invalidateCollection',
      'observeCollection',
    ],
    context,
    "import {setAccountId} from './src/content/account.ts'; globalThis.setAccountId=setAccountId",
  )
  context.setAccountId(A)
  return context
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status })

test('identities distinguish catalogue, snapshot rarity and each owned copy', async () => {
  const context = {}
  await expose('cards', ['mapCard', 'mapOwnedCard', 'cardVariantKey'], context)
  const first = context.mapOwnedCard(row(0))
  const second = context.mapOwnedCard(row(1))
  assert.equal(first.id, second.id)
  assert.notEqual(first.copyId, second.copyId)
  assert.equal(first.rarity, 'R')
  assert.equal(second.rarity, 'C')
  assert.notEqual(context.cardVariantKey(first), context.cardVariantKey(second))
  assert.equal(context.mapOwnedCard({ ...row(0), count: 2 }), null)
  assert.equal(context.mapOwnedCard({ ...row(0), id: null }), null)
  assert.equal(context.mapOwnedCard({ ...row(0), tags: undefined }), null)
  assert.equal(context.mapOwnedCard({ ...row(0), starred: undefined }), null)
  assert.equal(
    context.mapCard({ id: 'auction-id', card: row(0).card }).copyId,
    null,
  )
})

test('price rendering refuses ambiguous titles and uses the visible rarity', async () => {
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {},
  }
  await expose(
    'content/prices',
    ['registerCards', 'resolveVisibleCard'],
    context,
  )
  context.registerCards([
    {
      id: 'catalogue-1',
      title: 'Same',
      rarity: 'R',
      copyId: 'copy-1',
      shiny: false,
    },
    {
      id: 'catalogue-1',
      title: 'Same',
      rarity: 'C',
      copyId: 'copy-2',
      shiny: false,
    },
  ])
  assert.equal(context.resolveVisibleCard('Same', 'R').rarity, 'R')
  assert.equal(context.resolveVisibleCard('Same', null), null)
  context.registerCards([
    {
      id: 'catalogue-2',
      title: 'Same',
      rarity: 'R',
      copyId: 'copy-3',
      shiny: false,
    },
  ])
  assert.equal(context.resolveVisibleCard('Same', 'R'), null)
})

test('catalogue hydration restores public cards from native cached filtered pages without importing ownership', async () => {
  const pages = new Map([
    [
      'gc_v11_/api/cards?page=2&rarity=R',
      JSON.stringify({
        cards: [
          { id: 'cached-card', wikipedia_title: 'Cached title', rarity: 'R' },
        ],
        friendOwners: { 'cached-card': [{ id: 'private-friend' }] },
      }),
    ],
    ['gc_v11_/api/cards?page=3', '{invalid'],
    [
      'other_private_cache',
      JSON.stringify({
        cards: [{ id: 'ignored', wikipedia_title: 'Ignored', rarity: 'C' }],
      }),
    ],
  ])
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {},
    location: { pathname: '/global-collection' },
    sessionStorage: {
      length: pages.size,
      key: index => [...pages.keys()][index],
      getItem: key => pages.get(key) ?? null,
    },
    AbortSignal,
    fetch: async () => json({ cards: [] }),
  }
  await expose(
    'content/prices',
    ['hydrateRoute', 'resolveVisibleCard'],
    context,
  )
  await context.hydrateRoute()
  const card = context.resolveVisibleCard('Cached title', 'R')
  assert.equal(card.id, 'cached-card')
  assert.equal(card.copyId, null)
  assert.equal(card.ownerId, undefined)
  assert.equal(context.resolveVisibleCard('Ignored', 'C'), null)
})

test('an interrupted index resumes saved pages, includes all copies and survives reload', async () => {
  const stored = new Map()
  const pages = []
  let interrupted = false
  let context
  const fetch = async (url, options) => {
    assert.equal(options.credentials, 'include')
    if (url.endsWith('/stats')) return json({ total: 53 })
    const page = Number(
      new URL(url, 'https://example.com').searchParams.get('page'),
    )
    pages.push(page)
    if (page === 1 && !interrupted) {
      interrupted = true
      context.stopCollectionLoad()
      throw new Error('aborted')
    }
    return json({
      collection: Array.from({ length: page ? 3 : 50 }, (_, i) =>
        row(page * 50 + i),
      ),
    })
  }
  context = await indexContext(fetch, stored)
  await context.loadCollection()
  assert.equal(context.getCollectionState().status, 'paused')
  assert.equal(context.getCollectionState().cards.length, 50)
  assert.equal(context.getOwnedCopy('copy-1'), null)
  await context.loadCollection()
  assert.equal(context.getCollectionState().status, 'complete')
  assert.equal(context.getCollectionState().cards.length, 53)
  assert.equal(context.getOwnedCopy('copy-1').rarity, 'C')
  assert.equal(context.getOwnedVariants().size, 3)
  // First page is only rechecked for consistency, not traversed again as a missing page.
  assert.deepEqual(pages, [0, 1, 0, 1, 0])
  const restored = await indexContext(fetch, stored)
  assert.equal(restored.getCollectionState().status, 'complete')
  assert.equal(restored.getCollectionState().cards.length, 53)
})

test('busy servers pause shared reads and preserve valid pages', async () => {
  let failures = 0
  const context = await indexContext(
    async url => {
      if (url.endsWith('/stats')) return json({ total: 51 })
      if (url.includes('page=0'))
        return json({
          collection: Array.from({ length: 50 }, (_, i) => row(i)),
        })
      failures += 1
      return json({ error: 'busy' }, failures === 1 ? 429 : 503)
    },
    new Map(),
    {
      setTimeout: (callback, ms) =>
        ms === 12_000 ? 1 : setTimeout(callback, 0),
      clearTimeout: id => clearTimeout(id),
    },
  )
  await context.loadCollection()
  assert.equal(failures, 1)
  assert.equal(context.getCollectionState().status, 'error')
  assert.equal(context.getCollectionState().pages, 1)
  assert.equal(context.getCollectionState().cards.length, 50)
})

test('pagination drift and duplicate possession IDs never produce a complete index', async () => {
  const context = await indexContext(async url =>
    url.endsWith('/stats')
      ? json({ total: 51 })
      : json({
          collection: url.includes('page=0')
            ? Array.from({ length: 50 }, (_, i) => row(i))
            : [row(0)],
        }),
  )
  await context.loadCollection()
  assert.equal(context.getCollectionState().status, 'error')
  assert.equal(context.getCollectionState().cards.length, 0)
  assert.equal(context.getOwnedCopy('copy-0'), null)
})

test('account changes discard pending responses and mutations invalidate old copies', async () => {
  const stored = new Map()
  let resolvePage
  let waitForPage
  const pageStarted = new Promise(resolve => {
    waitForPage = resolve
  })
  const context = await indexContext(async url => {
    if (url.endsWith('/stats')) return json({ total: 1 })
    waitForPage()
    return new Promise(resolve => {
      resolvePage = resolve
    })
  }, stored)
  const loading = context.loadCollection()
  await pageStarted
  context.setAccountId(B)
  resolvePage(json({ collection: [row(0)] }))
  await loading
  assert.equal(context.getCollectionState().cards.length, 0)
  assert.equal(context.getCollectionState().status, 'idle')
  assert.equal(stored.has(`wm_toolbox_collection_v1:${B}`), false)
  const synced = await indexContext(
    async url =>
      url.endsWith('/stats')
        ? json({ total: 1 })
        : json({ collection: [row(0)] }),
    stored,
    { setTimeout: (cb, ms) => (ms === 1000 ? 1 : setTimeout(cb, ms)) },
  )
  await synced.loadCollection()
  assert.equal(synced.getOwnedCopy('copy-0').copyId, 'copy-0')
  synced.invalidateCollection()
  assert.equal(synced.getCollectionState().status, 'stale')
  assert.equal(synced.getCollectionState().cards.length, 0)
  assert.equal(synced.getOwnedCopy('copy-0'), null)
})

test('native mutations invalidate the current account and late login responses are ignored', async () => {
  const events = []
  let owner = A
  let resolvePage
  const window = {
    dispatchEvent: event => events.push(JSON.parse(event.detail)),
    fetch: async url => {
      if (String(url).includes('get_my_profile')) return json({ id: owner })
      if (url === '/api/my-collection')
        return new Promise(resolve => {
          resolvePage = resolve
        })
      if (url === '/api/trades/accept') return json({ error: 'busy' }, 503)
      if (String(url).includes('/auth/v1/logout'))
        return new Response(null, { status: 204 })
      return json({ discarded_count: 1 })
    },
  }
  await expose('network', [], {
    window,
    URL,
    Request,
    location: { origin: 'https://www.wiki-masters.com' },
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
  })
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  const profile = 'https://example.supabase.co/rest/v1/rpc/get_my_profile'
  await window.fetch(profile)
  await settle()
  assert.deepEqual(events.at(-1), { kind: 'account', accountId: A })
  const late = window.fetch('/api/my-collection')
  owner = B
  await window.fetch(profile)
  await settle()
  assert.equal(events.at(-1).accountId, B)
  resolvePage(json({ collection: [row(0)] }))
  await late
  await settle()
  assert.equal(events.filter(event => event.kind === 'collection').length, 0)
  await window.fetch('/api/user-cards/copy-1/discard', { method: 'POST' })
  await settle()
  assert.deepEqual(events.at(-1), { kind: 'collection-changed', accountId: B })
  const before = events.length
  await window.fetch('https://example.com/api/user-cards/copy-1/discard', {
    method: 'POST',
  })
  await settle()
  assert.equal(events.length, before)
  await window.fetch('/api/trades/accept', { method: 'POST' })
  await settle()
  assert.deepEqual(events.at(-1), { kind: 'collection-changed', accountId: B })
  await window.fetch('https://example.supabase.co/auth/v1/logout', {
    method: 'POST',
  })
  await settle()
  assert.deepEqual(events.at(-1), { kind: 'account', accountId: null })
})

test('native totals and new possession observations invalidate a completed index', async () => {
  const timers = {
    setTimeout: (callback, ms) => (ms === 1000 ? 1 : setTimeout(callback, ms)),
  }
  const context = await indexContext(
    async url =>
      url.endsWith('/stats')
        ? json({ total: 1 })
        : json({ collection: [row(0)] }),
    new Map(),
    timers,
  )
  await context.loadCollection()
  context.observeCollection([], 0)
  assert.equal(context.getCollectionState().status, 'stale')
  assert.equal(context.getCollectionState().cards.length, 0)
  await context.loadCollection()
  context.observeCollection([
    {
      id: 'catalogue-shared',
      copyId: 'new-copy',
      title: 'Same title',
      rarity: 'R',
      shiny: false,
    },
  ])
  assert.equal(context.getCollectionState().status, 'stale')
})

test('the page boundary check tolerates reordered rows and tags without treating them as changed possessions', async () => {
  let pageRead = 0
  const context = await indexContext(async url => {
    if (url.endsWith('/stats')) return json({ total: 3 })
    pageRead += 1
    const cards = [row(0), row(1), row(2)].map(card => ({
      ...card,
      tags:
        pageRead > 1 ? [{ id: 'b' }, { id: 'a' }] : [{ id: 'a' }, { id: 'b' }],
    }))
    return json({ collection: pageRead > 1 ? cards.reverse() : cards })
  })
  await context.loadCollection()
  assert.equal(context.getCollectionState().status, 'complete')
  assert.equal(context.getCollectionState().cards.length, 3)
})
