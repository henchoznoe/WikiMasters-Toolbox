import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const now = Date.parse('2026-10-05T12:00:00Z')
class Clock extends Date {
  static now() {
    return now
  }
}
function memory() {
  const data = new Map()
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
const card = extra => ({
  title: 'Fixture',
  rarity: 'R',
  shiny: false,
  catalogueId: null,
  ...extra,
})
const pack = (id = 'first', extra = {}) => ({
  id,
  observedAt: now,
  cards: Array.from({ length: 5 }, () => card(extra)),
})
async function expose(modules, context = {}) {
  const source = Object.entries(modules)
    .map(
      ([module, names]) =>
        `import {${names}} from './src/content/${module}.ts';Object.assign(globalThis,{${names}});`,
    )
    .join('\n')
  const output = await build({
    stdin: { contents: source, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
    define: { WM_TOOLBOX_CSS: '""' },
  })
  Object.assign(context, {
    Date: Clock,
    Intl,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    CSSStyleSheet: class {
      replaceSync() {}
    },
    crypto: { randomUUID: () => 'generated' },
    localStorage: context.localStorage ?? memory(),
    sessionStorage: context.sessionStorage ?? memory(),
    navigator: context.navigator ?? {
      locks: { request: async (_key, update) => update() },
    },
  })
  vm.runInNewContext(output.outputFiles[0].text, context)
  return context
}
const model = {
  'pulls-model':
    'bernDay,emptyPullStats,addPull,parsePullStats,PullCapture,validPullResult',
}
const store = {
  account: 'setAccountId',
  'pulls-store':
    'readPullStats,recordPull,resetPullStats,readLastPull,saveLastPull,activePullId,completeActivePull,activePullCompleted,pullsStorageUnavailable',
}

test('Bern day boundary and Swiss summer/winter time ignore the browser timezone', async () => {
  const c = await expose(model)
  for (const [before, after, day] of [
    ['2026-10-05T21:59:59Z', '2026-10-05T22:00:00Z', '2026-10-06'],
    ['2026-01-05T22:59:59Z', '2026-01-05T23:00:00Z', '2026-01-06'],
    ['2026-03-29T21:59:59Z', '2026-03-29T22:00:00Z', '2026-03-30'],
    ['2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z', '2026-10-26'],
  ]) {
    assert.notEqual(c.bernDay(Date.parse(before)), day)
    assert.equal(c.bernDay(Date.parse(after)), day)
  }
})
test('unknown rarities and shiny states stay explicit; midnight preserves the cumulative sample', async () => {
  const c = await expose(model)
  const result = pack()
  result.cards[0] = card({ rarity: null, shiny: null })
  result.cards[1] = card({ rarity: 'L', shiny: true })
  const stats = c.addPull(c.emptyPullStats(A, now), result, now)
  assert.equal(stats.daily.rarities.unknown, 1)
  assert.equal(stats.daily.rarities.L, 1)
  assert.equal(stats.daily.shiny, 1)
  assert.equal(stats.daily.unknownShiny, 1)
  const tomorrow = c.parsePullStats(stats, A, now + 86400_000)
  assert.equal(tomorrow.daily.packs, 0)
  assert.equal(tomorrow.cumulative.packs, 1)
  assert.equal(
    c.parsePullStats({ ...stats, accountId: B }, A, now).cumulative.packs,
    0,
  )
  assert.equal(
    c.parsePullStats(
      { ...stats, cumulative: { ...stats.cumulative, cards: -1 } },
      A,
      now,
    ).cumulative.packs,
    0,
  )
})
test('progressive slots, repeated renders and identical consecutive packs count correctly', async () => {
  const c = await expose(model)
  const capture = new c.PullCapture('one', true)
  for (let slot = 1; slot <= 4; slot++) capture.observe(slot, card())
  assert.equal(capture.result(now), null)
  capture.observe(5, card())
  capture.observe(2, card())
  const first = capture.result(now)
  const stats = c.addPull(c.emptyPullStats(A, now), first, now)
  assert.equal(c.addPull(stats, first, now).cumulative.packs, 1)
  assert.equal(
    c.addPull(stats, { ...first, id: 'two' }, now).cumulative.packs,
    2,
  )
  capture.observe(2, card({ title: 'Different result' }))
  assert.equal(capture.result(now), null)
  assert.equal(capture.automatic, false)
})
test('durable counters and tab-only last result are scoped to the detected account', async () => {
  const c = await expose(store)
  c.setAccountId(A)
  await c.recordPull(pack())
  c.saveLastPull(pack())
  assert.equal(c.readPullStats().daily.packs, 1)
  c.setAccountId(B)
  assert.equal(c.readPullStats().daily.packs, 0)
  assert.equal(c.readLastPull(), null)
  c.setAccountId(A)
  assert.equal(c.readLastPull().id, 'first')
  assert.equal(
    JSON.stringify(
      [...Array(c.localStorage.length)].map((_, i) =>
        c.localStorage.getItem(c.localStorage.key(i)),
      ),
    ).includes('Fixture'),
    false,
  )
  await c.resetPullStats()
  await c.recordPull(pack())
  assert.equal(c.readPullStats().daily.packs, 0)
  assert.equal(c.readPullStats().cumulative.packs, 0)
})
test('two tabs serialize increments and reuse receipt metadata after reload', async () => {
  const localStorage = memory()
  const sessionStorage = memory()
  let queue = Promise.resolve()
  const navigator = {
    locks: {
      request: (_key, update) => {
        const next = queue.then(update)
        queue = next.catch(() => {})
        return next
      },
    },
  }
  const c = await expose(store, { localStorage, sessionStorage, navigator })
  const d = await expose(store, { localStorage, navigator })
  c.setAccountId(A)
  d.setAccountId(A)
  await Promise.all([
    c.recordPull(pack('one')),
    d.recordPull(pack('two')),
    c.recordPull(pack('one')),
  ])
  assert.equal(c.readPullStats().cumulative.packs, 2)
  c.activePullId('one')
  const reloaded = await expose(store, {
    localStorage,
    sessionStorage,
    navigator,
  })
  reloaded.setAccountId(A)
  assert.equal(reloaded.activePullId(), 'one')
  await reloaded.recordPull(pack(reloaded.activePullId()))
  assert.equal(reloaded.readPullStats().cumulative.packs, 2)
})
test('an account change while waiting for a lock cancels registration; missing locks suspend it', async () => {
  let apply
  const c = await expose(store, {
    navigator: {
      locks: {
        request: (_key, update) =>
          new Promise(resolve => {
            apply = () => resolve(update())
          }),
      },
    },
  })
  c.setAccountId(A)
  const pending = c.recordPull(pack())
  c.setAccountId(B)
  apply()
  assert.equal(await pending, false)
  c.setAccountId(A)
  assert.equal(c.readPullStats().cumulative.packs, 0)
  const noLocks = await expose(store, { navigator: {} })
  noLocks.setAccountId(A)
  assert.equal(await noLocks.recordPull(pack()), false)
})
test('unavailable storage keeps explicitly temporary counters without restarting each update', async () => {
  const unavailable = {
    getItem() {
      throw Error('blocked')
    },
    setItem() {
      throw Error('blocked')
    },
  }
  const c = await expose(store, {
    localStorage: unavailable,
    sessionStorage: unavailable,
  })
  c.setAccountId(A)
  await c.recordPull(pack('one'))
  await c.recordPull(pack('two'))
  c.saveLastPull(pack('two'))
  assert.equal(c.readPullStats().cumulative.packs, 2)
  assert.equal(c.readLastPull().id, 'two')
  assert.equal(c.pullsStorageUnavailable(), true)
})

test('a completed tab observation survives receipt eviction and cannot be counted after reload', async () => {
  const localStorage = memory()
  const sessionStorage = memory()
  const c = await expose(store, { localStorage, sessionStorage })
  c.setAccountId(A)
  c.activePullId('old')
  await c.recordPull(pack('old'))
  c.completeActivePull('old')
  for (let i = 0; i < 101; i++) await c.recordPull(pack(`other-${i}`))
  assert.equal(c.readPullStats().receipts.includes('old'), false)
  const d = await expose(store, { localStorage, sessionStorage })
  d.setAccountId(A)
  assert.equal(d.activePullCompleted(), true)
})

test('cancelled work does not register after route changes or a change away and back to an account', async () => {
  let apply
  const c = await expose(store, {
    navigator: {
      locks: {
        request: (_key, update) =>
          new Promise(resolve => {
            apply = () => resolve(update())
          }),
      },
    },
  })
  c.setAccountId(A)
  let active = true
  let pending = c.recordPull(pack(), () => active)
  active = false
  apply()
  assert.equal(await pending, false)
  pending = c.recordPull(pack())
  c.setAccountId(B)
  c.setAccountId(A)
  apply()
  assert.equal(await pending, false)
  assert.equal(c.readPullStats().cumulative.packs, 0)
})

class Element {
  dataset = {}
  children = []
  attributes = new Map()
  shown = true
  constructor(textContent = '') {
    this.textContent = textContent
  }
  checkVisibility() {
    return this.shown
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name, value) {
    this.attributes.set(name, value)
  }
  closest(selector) {
    return selector.startsWith('[hidden]') ? null : this.cardElement
  }
  attachShadow() {
    this.shadowRoot = new Element()
    return this.shadowRoot
  }
  replaceChildren(...children) {
    this.children = children
  }
  append(...children) {
    this.children.push(...children)
  }
  after(host) {
    this.cardElement.host = host
  }
  remove() {}
  querySelector(selector) {
    if (selector === 'h3') return this.heading ?? null
    if (selector === '[data-wm-pull-rarity]') return this.host ?? null
    return null
  }
  querySelectorAll(selector) {
    return selector === 'h3' ? [this.heading] : (this.labels ?? [])
  }
}
function domFrame() {
  const marker = new Element('Carte1 / 5')
  const element = new Element()
  const heading = new Element('Fixture')
  heading.cardElement = element
  element.heading = heading
  element.labels = [new Element('R')]
  marker.parentElement = element
  let active = true
  const document = {
    querySelectorAll: selector =>
      selector === 'div, p' ? (active ? [marker] : []) : [],
    querySelector: () => (active ? heading : null),
    createElement: () => new Element(),
  }
  return {
    marker,
    heading,
    element,
    document,
    hide: () => {
      active = false
    },
  }
}
const observer = {
  ...store,
  'pulls-observer':
    'observeNativePull,syncPullObservation,pullObservationState,confirmPull,leavePulls,readPullFrame',
}
test('DOM observer waits for all visible positions; metadata cannot reveal hidden results', async () => {
  const dom = domFrame()
  const calls = []
  const c = await expose(observer, {
    document: dom.document,
    location: { pathname: '/pulls' },
    fetch: (...args) => calls.push(args),
  })
  c.setAccountId(A)
  c.observeNativePull('native', pack().cards)
  for (let slot = 1; slot <= 4; slot++) {
    dom.marker.textContent = `Carte ${slot} / 5`
    c.syncPullObservation()
  }
  assert.equal(c.readLastPull(), null)
  assert.equal(c.readPullStats().daily.packs, 0)
  dom.element.shown = false
  c.syncPullObservation()
  dom.element.shown = true
  dom.marker.textContent = 'Carte 5 / 5'
  c.syncPullObservation()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(c.readPullStats().daily.packs, 1)
  c.syncPullObservation()
  assert.equal(c.readPullStats().daily.packs, 1)
  assert.equal(calls.length, 0)
})
test('restored results require manual validation; resets and reloads cannot recount them', async () => {
  const dom = domFrame()
  const c = await expose(observer, {
    document: dom.document,
    location: { pathname: '/pulls' },
  })
  c.setAccountId(A)
  for (let slot = 1; slot <= 5; slot++) {
    dom.marker.textContent = `Carte ${slot} / 5`
    c.syncPullObservation()
  }
  assert.equal(c.readPullStats().daily.packs, 0)
  assert.equal(c.pullObservationState().canRecord, true)
  await c.confirmPull()
  await c.resetPullStats()
  c.leavePulls()
  for (let slot = 1; slot <= 5; slot++) {
    dom.marker.textContent = `Carte ${slot} / 5`
    c.syncPullObservation()
  }
  await c.confirmPull()
  assert.equal(c.readPullStats().daily.packs, 0)
  assert.match(c.pullObservationState().message, /déjà enregistré/)
})
test('ambiguous identities and altered or hidden result layouts stay unknown or suspended', async () => {
  const dom = domFrame()
  const c = await expose(observer, {
    document: dom.document,
    location: { pathname: '/pulls' },
  })
  c.setAccountId(A)
  const cards = pack().cards
  cards[0].catalogueId = A
  cards[1].catalogueId = B
  c.observeNativePull('ambiguous', cards)
  for (let slot = 1; slot <= 5; slot++) {
    dom.marker.textContent = `Carte ${slot} / 5`
    c.syncPullObservation()
  }
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(c.readLastPull().cards.every(card => card.catalogueId === null))
  dom.element.shown = false
  assert.equal(c.readPullFrame(), null)
  dom.element.shown = true
  dom.marker.textContent = 'Carte 5 / 6'
  assert.equal(c.readPullFrame(), null)
})

const flatten = node => [node, ...node.children.flatMap(flatten)]
class UiNode extends Element {
  listeners = new Map()
  constructor(tag) {
    super()
    this.tag = tag
  }
  addEventListener(name, listener) {
    this.listeners.set(name, listener)
  }
  querySelector(selector) {
    const match = selector.match(/^\[data-([a-z-]+)\]$/)
    if (match) {
      const key = match[1].replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase(),
      )
      return flatten(this).find(node => node.dataset[key] !== undefined) ?? null
    }
    return flatten(this).find(node => node.tag === selector) ?? null
  }
}
test('last-pack prices retain native order, exclude uncertain variants and show partial coverage', async () => {
  let body
  const c = await expose(
    {
      ...store,
      'pulls-panel': 'createPullsBody,renderPullsPanel',
      'price-store': 'requestPriceQuote,readPriceQuote',
    },
    {
      document: {
        createElement: tag => new UiNode(tag),
        querySelector: () => ({ shadowRoot: body }),
      },
      location: { pathname: '/pulls' },
      window: {},
      fetch: async () => new Response('{}', { status: 503 }),
    },
  )
  c.setAccountId(A)
  const result = pack('prices')
  result.cards = [
    card({ title: 'Normal', catalogueId: A }),
    card({ title: 'Brillante', catalogueId: A, shiny: true }),
    card({ title: 'Variante inconnue', catalogueId: A, shiny: null }),
    card({ title: 'Identité inconnue' }),
    card({ title: 'Prix nul', rarity: 'PC', catalogueId: A }),
  ]
  c.saveLastPull(result)
  const fetchedAt = now - 60_001
  c.localStorage.setItem(
    `wm_toolbox_price_v1_${A}`,
    JSON.stringify({ fetchedAt, ok: true, averages: { R: 25, PC: 0 } }),
  )
  body = c.createPullsBody()
  c.renderPullsPanel()
  const rows = body.querySelector('[data-pull-cards]').children
  assert.deepEqual(
    rows.map(row => row.children[1].textContent),
    result.cards.map(card => card.title),
  )
  assert.match(rows[0].querySelector('button').textContent, /25 W/)
  assert.match(rows[4].querySelector('button').textContent, /0 W/)
  for (const index of [1, 2, 3])
    assert.equal(
      rows[index].querySelector('button').textContent,
      'Prix inconnu',
    )
  assert.match(
    body.querySelector('[data-pull-total]').textContent,
    /25 W · 2\/5/,
  )
  await c.requestPriceQuote(A, true)
  c.renderPullsPanel()
  const price = rows[0].querySelector('button')
  assert.match(price.textContent, /25 W !/)
  assert.match(price.title, /actualisation échouée/)
  assert.equal(c.readPriceQuote(A, 'R').fetchedAt, fetchedAt)
  const allUnknown = pack('unknown', { shiny: null })
  c.saveLastPull(allUnknown)
  c.renderPullsPanel()
  assert.match(
    body.querySelector('[data-pull-total]').textContent,
    /Sous-total inconnu · 0\/5/,
  )
  const controls = flatten(body)
    .map(node => `${node.textContent} ${node.getAttribute('aria-label') ?? ''}`)
    .join('\n')
  assert.match(controls, /Réinitialiser les statistiques/)
  assert.match(controls, /Période des statistiques/)
})
