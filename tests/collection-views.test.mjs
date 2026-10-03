import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
async function model(stored = new Map()) {
  const context = {
    structuredClone,
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
  }
  const bundle = await build({
    stdin: {
      contents: `import * as query from './src/content/collection-query.ts';import * as views from './src/content/collection-views.ts';import * as cards from './src/cards.ts';import * as selection from './src/content/selection.ts';import {setAccountId} from './src/content/account.ts';Object.assign(globalThis,query,views,cards,selection,{setAccountId});`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
  })
  vm.runInNewContext(bundle.outputFiles[0].text, context)
  context.setAccountId(A)
  return { c: context, stored }
}
const copy = (n, changes = {}) => ({
  id: 'card',
  copyId: `copy-${n}`,
  ownerId: A,
  title: 'École',
  rarity: 'R',
  shiny: false,
  starred: false,
  tagIds: [],
  obtainedAt: '2026-10-01T00:00:00Z',
  category: 'Éducation',
  atk: 10,
  def: 5,
  hasImage: false,
  ...changes,
})
const quote = (_id, rarity) =>
  rarity === 'R'
    ? { status: 'available', average: 0, fetchedAt: Date.now(), stale: false }
    : { status: 'no-sales', fetchedAt: Date.now(), stale: false }
const ids = rows => Array.from(rows, card => card.copyId)
const guards = () => ({ catalogueIds: new Set(), copyIds: new Set() })

test('combined filters span all pages and duplicate counts use the unfiltered exact variant', async () => {
  const { c } = await model()
  const cards = Array.from({ length: 103 }, (_, n) =>
    copy(n, { starred: n === 102, tagIds: n === 102 ? ['keep'] : [] }),
  )
  const q = {
    ...c.defaultCollectionQuery(),
    search: 'ecole',
    category: 'education',
    rarities: ['R'],
    tag: 'keep',
    favorite: 'yes',
    duplicate: 'yes',
    knownPrice: 'yes',
    missingImage: 'yes',
    priceMin: 0,
    priceMax: 0,
    atkMin: 10,
    atkMax: 10,
    defMin: 5,
    defMax: 5,
  }
  assert.deepEqual(ids(c.queryCollection(cards, q, quote)), ['copy-102'])
  q.atkMin = 11
  assert.equal(c.queryCollection(cards, q, quote).length, 0)
  q.atkMin = 10
  q.duplicate = 'no'
  assert.equal(c.queryCollection(cards, q, quote).length, 0)
})

test('unknown fields, zero-price averages and shiny variants remain distinct', async () => {
  const { c } = await model()
  const cards = [
    copy(0),
    copy(1),
    copy(2, { rarity: 'C' }),
    copy(3, { shiny: true }),
    copy(4, { id: 'other', atk: null, def: 0, hasImage: null }),
  ]
  const q = c.defaultCollectionQuery()
  q.duplicate = 'yes'
  assert.deepEqual(ids(c.queryCollection(cards, q, quote)), [
    'copy-0',
    'copy-1',
  ])
  q.duplicate = 'any'
  q.knownPrice = 'no'
  assert.deepEqual(
    new Set(ids(c.queryCollection(cards, q, quote))),
    new Set(['copy-2', 'copy-3']),
  )
  q.knownPrice = 'any'
  q.missingImage = 'no'
  assert.equal(c.queryCollection(cards, q, quote).length, 0)
  q.missingImage = 'yes'
  assert.equal(c.queryCollection(cards, q, quote).length, 4)
  q.missingImage = 'any'
  q.atkMin = 0
  assert.equal(c.queryCollection(cards, q, quote).length, 4)
})

test('all advanced sorts keep unknowns last in both directions and never modify selection or index', async () => {
  const { c } = await model()
  const cards = [
    copy(2, {
      id: 'other',
      title: 'B',
      rarity: 'L',
      atk: 20,
      def: 20,
      obtainedAt: '2026-10-02T00:00:00Z',
    }),
    copy(1),
    copy(0),
    copy(3, {
      id: 'unknown',
      title: 'C',
      rarity: null,
      atk: null,
      def: 0,
      obtainedAt: null,
    }),
  ]
  const before = JSON.stringify(cards)
  const rules = c.defaultSelectionRules()
  rules.added.add('copy-1')
  const selected = ids(c.buildSelection(cards, rules, guards()).cards)
  for (const sort of ['price', 'rarity', 'atk', 'ratio', 'obtained']) {
    for (const descending of [false, true]) {
      const rows = c.queryCollection(
        cards,
        { ...c.defaultCollectionQuery(), sort, descending },
        quote,
      )
      assert.equal(rows.at(-1).copyId, 'copy-3')
      assert.deepEqual(
        ids(c.buildSelection(cards, rules, guards()).cards),
        selected,
      )
    }
  }
  assert.equal(
    c.queryCollection(
      cards,
      { ...c.defaultCollectionQuery(), sort: 'quantity', descending: true },
      quote,
    )[0].id,
    'card',
  )
  assert.equal(
    c.queryCollection(
      cards,
      { ...c.defaultCollectionQuery(), sort: 'def', descending: true },
      quote,
    )[0].copyId,
    'copy-2',
  )
  assert.equal(JSON.stringify(cards), before)
})

test('query-based selections continue to obey favorites, commitments and keep N', async () => {
  const { c } = await model()
  const cards = [copy(0), copy(1), copy(2, { starred: true }), copy(3)]
  const rules = c.defaultSelectionRules()
  for (const card of c.queryCollection(
    cards,
    c.defaultCollectionQuery(),
    quote,
  ))
    rules.added.add(card.copyId)
  const commitments = guards()
  commitments.copyIds.add('copy-3')
  const plan = c.buildSelection(cards, rules, commitments)
  assert.deepEqual(ids(plan.cards), ['copy-0', 'copy-1'])
  assert.equal(plan.blocked.get('copy-2'), 'Favorite')
  assert.equal(plan.blocked.get('copy-3'), 'Sale / trade')
  assert.equal(plan.groups[0].after, 2)
})

test('availability never calls a catalogue-level commitment an identified sale or trade', async () => {
  const { c } = await model()
  const commitments = {
    catalogueIds: new Set(['card']),
    copyIds: new Set(['copy-1']),
    saleCopyIds: new Set(['copy-1']),
    tradeCopyIds: new Set(['copy-2']),
  }
  assert.equal(c.copyAvailability(copy(0), commitments, false), 'unknown')
  assert.equal(c.copyAvailability(copy(0), commitments, true), 'committed')
  assert.equal(c.copyAvailability(copy(1), commitments, true), 'sale')
  assert.equal(c.copyAvailability(copy(2), commitments, true), 'trade')
  assert.equal(
    c.copyAvailability(copy(3, { id: 'free' }), commitments, true),
    'free',
  )
})

test('owned metadata maps only explicit native fields and leaves missing data unknown', async () => {
  const { c } = await model()
  const raw = {
    id: 'copy',
    user_id: A,
    starred: false,
    is_shiny: false,
    tags: [{ id: 'tag', name: 'Keep' }],
    card: {
      id: 'catalogue',
      wikipedia_title: 'Fixture',
      rarity: 'R',
      atk: 0,
      def: 8,
      category: 'Test',
      image_url: '/image.jpg',
      hide_image: true,
    },
  }
  const mapped = c.mapOwnedCard(raw)
  assert.equal(mapped.atk, 0)
  assert.equal(mapped.def, 8)
  assert.equal(mapped.category, 'Test')
  assert.equal(mapped.hasImage, false)
  assert.equal(mapped.tagNames.tag, 'Keep')
  delete raw.card.atk
  delete raw.card.image_url
  delete raw.card.hide_image
  raw.card.def = -1
  const unknown = c.mapOwnedCard(raw)
  assert.equal(unknown.atk, null)
  assert.equal(unknown.def, null)
  assert.equal(unknown.hasImage, null)
  raw.card.hide_image = false
  assert.equal(c.mapOwnedCard(raw).hasImage, null)
  assert.equal(c.mapCard(raw).atk, undefined)
})

test('saved views persist queries, recompute new copies and stay isolated by account', async () => {
  const { c, stored } = await model()
  const q = { ...c.defaultCollectionQuery(), duplicate: 'yes', search: 'ecole' }
  assert.equal(c.saveView('  Doubles  ', q, 0), true)
  c.setCompact(true)
  const saved = c.getViewPreferences().views[0]
  assert.equal(saved.name, 'Doubles')
  assert.equal(saved.syncedAt, 0)
  const serialized = stored.get(c.VIEWS_PREFIX + A)
  assert.equal(serialized.includes('copy-'), false)
  q.search = 'changed'
  assert.equal(c.getViewPreferences().views[0].query.search, 'ecole')
  assert.deepEqual(
    ids(c.queryCollection([copy(8), copy(9)], saved.query, quote)),
    ['copy-8', 'copy-9'],
  )
  const at = Date.now() - 1000
  c.markViewSynced('Doubles', saved.query, at)
  assert.equal(c.getViewPreferences().views[0].syncedAt, at)
  c.markViewSynced('Doubles', q, Date.now())
  assert.equal(c.getViewPreferences().views[0].syncedAt, at)
  c.setAccountId(B)
  assert.equal(c.getViewPreferences().views.length, 0)
  assert.equal(c.getViewPreferences().compact, false)
  c.setAccountId(A)
  assert.equal(c.getViewPreferences().views.length, 1)
  assert.equal(c.getViewPreferences().compact, true)
  const restored = await model(stored)
  assert.equal(restored.c.getViewPreferences().views[0].query.search, 'ecole')
  c.deleteView('Doubles')
  assert.equal(c.getViewPreferences().views.length, 0)
})

test('saved preferences reject invalid versions, foreign owners and malformed filters', async () => {
  const { c, stored } = await model()
  const base = {
    version: 1,
    accountId: A,
    compact: true,
    views: [
      {
        name: 'Bad',
        query: c.defaultCollectionQuery(),
        savedAt: Date.now() - 1000,
        syncedAt: 0,
      },
    ],
  }
  for (const change of [
    { version: 2 },
    { accountId: B },
    {
      views: [
        { ...base.views[0], query: { ...base.views[0].query, atkMin: -1 } },
      ],
    },
  ]) {
    stored.set(c.VIEWS_PREFIX + A, JSON.stringify({ ...base, ...change }))
    c.syncViewsFromStorage(c.VIEWS_PREFIX + A)
    assert.equal(c.getViewPreferences().views.length, 0)
  }
  assert.equal(
    c.normalizeQuery({ ...c.defaultCollectionQuery(), sort: 'invalid' }),
    null,
  )
  assert.equal(
    c.normalizeQuery({ ...c.defaultCollectionQuery(), priceMin: Infinity }),
    null,
  )
})

test('view storage is bounded and storage failures preserve the last saved settings', async () => {
  const { c } = await model()
  for (let n = 0; n < 30; n++)
    assert.equal(c.saveView(`View ${n}`, c.defaultCollectionQuery(), 0), true)
  assert.equal(c.saveView('Overflow', c.defaultCollectionQuery(), 0), false)
  assert.equal(c.saveView('View 0', c.defaultCollectionQuery(), 0), true)
  c.localStorage.setItem = () => {
    throw new Error('quota')
  }
  c.setCompact(true)
  assert.equal(c.getViewPreferences().compact, false)
  assert.equal(c.getViewPreferences().error, 'Not saved locally')
  assert.equal(
    c.saveView('View 0', { ...c.defaultCollectionQuery(), search: 'new' }, 0),
    false,
  )
  assert.equal(
    c.getViewPreferences().views.find(v => v.name === 'View 0').query.search,
    '',
  )
})

test('compact layout restores the native grid on toggle and route change', async () => {
  const { c, stored } = await model()
  const values = new Map([['grid-template-columns', 'repeat(4, 1fr)']])
  const style = {
    getPropertyValue: key => values.get(key) ?? '',
    getPropertyPriority: () => '',
    setProperty: (key, value) => values.set(key, value),
    removeProperty: key => values.delete(key),
  }
  const grid = {
    style,
    isConnected: true,
  }
  const heading = { closest: () => ({ parentElement: grid }) }
  Object.assign(c, {
    document: {
      querySelectorAll: selector => (selector === 'main h3' ? [heading] : []),
    },
    getComputedStyle: () => ({ display: 'grid' }),
    location: { pathname: '/collection' },
    CSSStyleSheet: class {
      replaceSync() {}
    },
  })
  const bundle = await build({
    stdin: {
      contents: `import {renderCompactLayout} from './src/content/collection-layout.ts';import {setAccountId} from './src/content/account.ts';import {setCompact} from './src/content/collection-views.ts';Object.assign(globalThis,{renderCompactLayout,setAccountId,setCompact});`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { WM_TOOLBOX_CSS: '""' },
  })
  vm.runInNewContext(bundle.outputFiles[0].text, c)
  c.setAccountId(A)
  c.setCompact(true)
  c.renderCompactLayout()
  assert.match(values.get('grid-template-columns'), /140px/)
  c.setCompact(false)
  c.renderCompactLayout()
  assert.equal(values.get('grid-template-columns'), 'repeat(4, 1fr)')
  c.setCompact(true)
  c.location.pathname = '/global-collection'
  c.renderCompactLayout()
  assert.match(values.get('grid-template-columns'), /140px/)
  c.location.pathname = '/marketplace'
  c.renderCompactLayout()
  assert.equal(values.get('grid-template-columns'), 'repeat(4, 1fr)')
  c.location.pathname = '/collection'
  c.renderCompactLayout()
  c.setAccountId(B)
  c.renderCompactLayout()
  assert.equal(values.get('grid-template-columns'), 'repeat(4, 1fr)')
  const cardStyles = new Map()
  const card = {
    style: {
      ...style,
      getPropertyValue: key => cardStyles.get(key) ?? '',
      setProperty: (key, value) => cardStyles.set(key, value),
      removeProperty: key => cardStyles.delete(key),
    },
    isConnected: true,
    parentElement: grid,
  }
  heading.closest = () => card
  c.getComputedStyle = () => ({ display: 'flex', flexWrap: 'wrap' })
  c.setAccountId(A)
  c.setCompact(true)
  c.renderCompactLayout()
  assert.equal(values.get('gap'), '10px')
  assert.equal(cardStyles.get('width'), '140px')
  c.setCompact(false)
  c.renderCompactLayout()
  assert.equal(values.has('gap'), false)
  assert.equal(cardStyles.has('width'), false)
  const wrapper = { parentElement: grid }
  card.parentElement = wrapper
  c.getComputedStyle = element =>
    element === wrapper
      ? { display: 'block' }
      : { display: 'flex', flexWrap: 'wrap' }
  c.setCompact(true)
  c.renderCompactLayout()
  assert.equal(values.get('gap'), '10px')
  assert.equal(cardStyles.get('width'), '140px')
  c.setCompact(false)
  c.renderCompactLayout()
  assert.equal(values.has('gap'), false)
  assert.equal(cardStyles.has('width'), false)
  assert.ok(stored.has(c.VIEWS_PREFIX + A))
})

test('grouped selection matches never include hidden unique or nonmatching copies', async () => {
  const { c } = await model()
  const cards = [copy(0), copy(1, { starred: true }), copy(2, { id: 'unique' })]
  const query = { ...c.defaultCollectionQuery(), favorite: 'no' }
  assert.deepEqual(ids(c.queryCollectionView(cards, query, quote, true)), [
    'copy-0',
  ])
  assert.deepEqual(ids(c.queryCollectionView(cards, query, quote, false)), [
    'copy-0',
    'copy-2',
  ])
  assert.equal(
    c.queryCollectionView(cards, { ...query, duplicate: 'no' }, quote, true)
      .length,
    0,
  )
})
