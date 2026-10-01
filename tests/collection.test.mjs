import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status })
async function expose(path, names, context, extra = '') {
  const result = await build({
    stdin: {
      contents: `import { ${names.join(',')} } from './src/${path}.ts'; ${extra};Object.assign(globalThis,{${names.join(',')}})`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    write: false,
  })
  vm.runInNewContext(result.outputFiles[0].text, context)
}
function copy(n, values = {}) {
  return {
    id: 'catalogue',
    copyId: `copy-${n}`,
    title: 'Card',
    rarity: 'C',
    shiny: false,
    ownerId: OWNER,
    starred: false,
    tagIds: [],
    obtainedAt: `2026-10-01T00:00:0${n}Z`,
    ...values,
  }
}
function row(card) {
  return {
    id: card.copyId,
    user_id: card.ownerId,
    card_id: card.id,
    starred: card.starred,
    tags: card.tagIds.map(id => ({ id })),
    is_shiny: card.shiny,
    obtained_at: card.obtainedAt,
    count: 1,
    card: { id: card.id, wikipedia_title: card.title, rarity: card.rarity },
  }
}
const ids = cards => Array.from(cards, c => c.copyId)
const emptyCommitments = () => ({ catalogueIds: new Set(), copyIds: new Set() })

async function model() {
  const context = {}
  await expose(
    'content/selection',
    ['buildSelection', 'defaultSelectionRules'],
    context,
  )
  const rules = context.defaultSelectionRules()
  rules.rarities.add('C')
  return { ...context, rules }
}

test('selection spans every copy and keeps separate rarities and shiny variants', async () => {
  const c = await model()
  const cards = [
    copy(0),
    copy(1),
    copy(2, { rarity: 'R' }),
    copy(3, { rarity: 'R' }),
    copy(4, { shiny: true }),
  ]
  c.rules.rarities.add('R')
  c.rules.protect.shiny = false
  const plan = c.buildSelection(cards, c.rules, emptyCommitments())
  assert.deepEqual(ids(plan.cards), ['copy-1', 'copy-3'])
  assert.equal(plan.groups.length, 2)
  assert.ok(plan.groups.every(group => group.before === 2 && group.after === 1))
  assert.equal(plan.blocked.get('copy-4'), 'Only copy')
})

test('favorites, tags, sale copies and catalogue trades are retained before keep N', async () => {
  const c = await model()
  const cards = [
    copy(0, { starred: true }),
    copy(1, { tagIds: ['tag'] }),
    copy(2),
    copy(3),
    copy(4, { id: 'trade' }),
    copy(5, { id: 'trade' }),
  ]
  c.rules.keep = 3
  const commitments = {
    catalogueIds: new Set(['trade']),
    copyIds: new Set(['copy-2']),
  }
  const plan = c.buildSelection(cards, c.rules, commitments)
  assert.deepEqual(ids(plan.cards), ['copy-3'])
  assert.equal(plan.blocked.get('copy-0'), 'Favorite')
  assert.equal(plan.blocked.get('copy-1'), 'Tagged')
  assert.equal(plan.blocked.get('copy-2'), 'Sale / trade')
  assert.equal(plan.blocked.get('copy-4'), 'Sale / trade')
  assert.equal(plan.groups[0].after, 3)
})

test('manual exclusions count as retained copies and additions never bypass protections', async () => {
  const c = await model()
  const cards = [
    copy(0),
    copy(1),
    copy(2),
    copy(3, { starred: true }),
    copy(4, { id: 'single', rarity: 'L' }),
  ]
  c.rules.removed.add('copy-0')
  c.rules.added.add('copy-4')
  c.rules.added.add('copy-3')
  c.rules.keep = 2
  assert.deepEqual(
    ids(c.buildSelection(cards, c.rules, emptyCommitments()).cards),
    ['copy-1', 'copy-2'],
  )
  c.rules.protect.unique = false
  c.rules.keep = 0
  assert.deepEqual(
    ids(c.buildSelection(cards, c.rules, emptyCommitments()).cards),
    ['copy-1', 'copy-2', 'copy-4'],
  )
  c.rules.keep = NaN
  assert.equal(
    c.buildSelection(cards, c.rules, emptyCommitments()).cards.length,
    0,
  )
})

async function actions({
  cards = [copy(0), copy(1), copy(2)],
  post,
  guards,
  locks = true,
  stored = new Map(),
} = {}) {
  const mutable = [...cards]
  const writes = []
  const context = {
    AbortController,
    Response,
    Date,
    setTimeout: (cb, ms) => setTimeout(cb, ms >= 15_000 ? ms : 0),
    clearTimeout,
    navigator: {
      locks: locks
        ? { request: async (_key, _options, fn) => fn({ name: 'lock' }) }
        : undefined,
    },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    fetch: async (url, options = {}) => {
      if (options.method === 'POST') {
        const copyId = JSON.parse(options.body).card_ids[0]
        writes.push(copyId)
        if (post) return post(copyId, mutable, context)
        mutable.splice(
          mutable.findIndex(card => card.copyId === copyId),
          1,
        )
        return json({ discarded_count: 1, failed: [] })
      }
      if (url.includes('/marketplace?'))
        return guards ? guards(url) : json({ mine: true, selling: [] })
      if (url.includes('/trades?'))
        return guards ? guards(url) : json({ trades: [] })
      if (url.endsWith('/stats')) return json({ total: mutable.length })
      const page = Number(
        new URL(url, 'https://example.com').searchParams.get('page'),
      )
      return json({
        collection: mutable.slice(page * 50, (page + 1) * 50).map(row),
      })
    },
  }
  await expose(
    'content/collection-actions',
    [
      'checkSelection',
      'getSelectionState',
      'editSelection',
      'previewDiscard',
      'executeDiscard',
      'stopDiscard',
      'parseCommitments',
      'parseDiscardResult',
    ],
    context,
    "import {setAccountId} from './src/content/account.ts';import {invalidateCollection,loadCollection,getCollectionState} from './src/content/collection.ts'; Object.assign(globalThis,{setAccountId,invalidateCollection,loadCollection,getCollectionState})",
  )
  context.setAccountId(OWNER)
  return { context, mutable, writes, stored }
}
async function prepare(c) {
  await c.checkSelection()
  c.editSelection(rules => rules.rarities.add('C'))
  c.previewDiscard()
  assert.equal(c.getSelectionState().reviewed, true)
}

test('commitments require valid sources and distinguish selling possession IDs from catalogue trade IDs', async () => {
  const { context: c } = await actions()
  const guards = c.parseCommitments(
    {
      mine: true,
      selling: [{ user_card_id: 'copy-1' }, { card: { id: 'catalogue-2' } }],
    },
    {
      trades: [
        {
          status: 'pending',
          initiator_id: OWNER,
          recipient_id: OTHER,
          items: [
            { offered_by: OWNER, card_id: 'catalogue-3' },
            { offered_by: OTHER, card_id: 'their-card' },
          ],
        },
      ],
    },
    OWNER,
  )
  assert.deepEqual(Array.from(guards.copyIds), ['copy-1'])
  assert.deepEqual(Array.from(guards.catalogueIds), [
    'catalogue-2',
    'catalogue-3',
  ])
  assert.throws(() =>
    c.parseCommitments({ selling: [] }, { trades: [] }, OWNER),
  )
  assert.throws(() =>
    c.parseCommitments({ mine: true, selling: [{}] }, { trades: [] }, OWNER),
  )
})

test('confirmed execution uses possession IDs, keeps N and resynchronizes afterward', async () => {
  const { context: c, mutable, writes } = await actions()
  await c.executeDiscard()
  assert.equal(writes.length, 0)
  await prepare(c)
  await c.executeDiscard()
  assert.deepEqual(writes, ['copy-1', 'copy-2'])
  assert.deepEqual(ids(mutable), ['copy-0'])
  assert.equal(
    c.getSelectionState().results.filter(r => r.status === 'discarded').length,
    2,
  )
  assert.equal(c.getCollectionState().status, 'stale')
  await c.loadCollection(true)
  assert.deepEqual(ids(c.getCollectionState().cards), ['copy-0'])
})

test('collection or protection changes after preview prevent writes', async () => {
  const { context: c, mutable, writes } = await actions()
  await prepare(c)
  mutable[1].starred = true
  await c.executeDiscard()
  assert.equal(writes.length, 0)
  assert.match(c.getSelectionState().error, /Collection changed/)
  let committed = false
  const second = await actions({
    guards: async url =>
      url.includes('/trades?')
        ? json({ trades: [] })
        : json({
            mine: true,
            selling: committed ? [{ card_id: 'catalogue' }] : [],
          }),
  })
  await prepare(second.context)
  committed = true
  await second.context.executeDiscard()
  assert.equal(second.writes.length, 0)
  assert.match(second.context.getSelectionState().error, /Protections changed/)
})

test('stop waits for the in-flight result and prevents the next copy', async () => {
  let finish
  let started
  const pending = new Promise(resolve => {
    started = resolve
  })
  const { context: c, writes } = await actions({
    post: async () => {
      started()
      return new Promise(resolve => {
        finish = resolve
      })
    },
  })
  await prepare(c)
  const executing = c.executeDiscard()
  await pending
  c.stopDiscard()
  finish(json({ discarded_count: 1, failed: [] }))
  await executing
  assert.deepEqual(writes, ['copy-1'])
  assert.equal(c.getSelectionState().results[0].status, 'discarded')
  assert.equal(
    c.getSelectionState().total - c.getSelectionState().results.length,
    1,
  )
})

test('uncertain network and server outcomes stop without retry and survive reload', async () => {
  for (const post of [
    async () => {
      throw new Error('lost response')
    },
    async () => json({ error: 'busy' }, 503),
    async () => json({ discarded_count: 2, failed: [] }),
  ]) {
    const { context: c, writes, stored } = await actions({ post })
    await prepare(c)
    await c.executeDiscard()
    assert.deepEqual(writes, ['copy-1'])
    assert.equal(c.getSelectionState().results[0].status, 'unknown')
    const restored = await actions({ stored })
    assert.equal(
      restored.context.getSelectionState().results[0].status,
      'unknown',
    )
    assert.equal(restored.context.getSelectionState().reviewed, false)
  }
})

test('per-copy game rejection is reported and later copies can complete', async () => {
  const { context: c, writes } = await actions({
    post: async id =>
      id === 'copy-1'
        ? json({ discarded_count: 0, failed: [{ reason: 'In trade' }] })
        : json({ discarded_count: 1, failed: [] }),
  })
  await prepare(c)
  await c.executeDiscard()
  assert.deepEqual(writes, ['copy-1', 'copy-2'])
  assert.equal(c.getSelectionState().results[0].status, 'failed')
  assert.equal(c.getSelectionState().results[0].error, 'In trade')
  assert.equal(c.getSelectionState().results[1].status, 'discarded')
})

test('account changes during a write stop subsequent requests and keep the old receipt scoped', async () => {
  let finish
  let started
  const pending = new Promise(resolve => {
    started = resolve
  })
  const { context: c, writes } = await actions({
    post: async () => {
      started()
      return new Promise(resolve => {
        finish = resolve
      })
    },
  })
  await prepare(c)
  const executing = c.executeDiscard()
  await pending
  c.setAccountId(OTHER)
  finish(json({ discarded_count: 1, failed: [] }))
  await executing
  assert.deepEqual(writes, ['copy-1'])
  assert.equal(c.getSelectionState().results.length, 0)
  c.setAccountId(OWNER)
  assert.equal(c.getSelectionState().results[0].status, 'discarded')
})

test('unavailable or occupied browser locks prevent writes', async () => {
  const { context: c, writes } = await actions({ locks: false })
  await prepare(c)
  await c.executeDiscard()
  assert.equal(writes.length, 0)
  assert.match(c.getSelectionState().error, /locking/)
  const second = await actions()
  await prepare(second.context)
  second.context.navigator.locks.request = async (_key, _options, fn) =>
    fn(null)
  await second.context.executeDiscard()
  assert.equal(second.writes.length, 0)
  assert.match(second.context.getSelectionState().error, /another tab/)
})

test('selection checks every page and keeps the retained minimum beyond the visible page', async () => {
  const cards = Array.from({ length: 103 }, (_, n) => copy(n))
  const { context: c } = await actions({ cards })
  await c.checkSelection()
  c.editSelection(rules => {
    rules.rarities.add('C')
    rules.keep = 2
  })
  const value = c.getSelectionState()
  assert.equal(value.ready, true)
  assert.equal(c.getCollectionState().pages, 3)
  assert.equal(value.plan.cards.length, 101)
  assert.equal(value.plan.groups[0].after, 2)
  assert.ok(value.plan.cards.some(card => card.copyId === 'copy-102'))
})

test('interrupted requests are journaled as uncertain before a response is available', async () => {
  let finish
  let started
  const pending = new Promise(resolve => {
    started = resolve
  })
  const { context: c, stored } = await actions({
    post: async () => {
      started()
      return new Promise(resolve => {
        finish = resolve
      })
    },
  })
  await prepare(c)
  const executing = c.executeDiscard()
  await pending
  assert.equal(c.getSelectionState().results[0].status, 'pending')
  const receipt = JSON.parse(stored.get(`wm_toolbox_discard_v1:${OWNER}`))
  assert.equal(receipt.results[0].status, 'unknown')
  c.stopDiscard()
  finish(json({ discarded_count: 1 }))
  await executing
  assert.equal(c.getSelectionState().results[0].status, 'discarded')
})

test('unavailable receipt storage prevents a destructive request', async () => {
  const { context: c, writes } = await actions()
  await prepare(c)
  c.localStorage.setItem = () => {
    throw new Error('quota')
  }
  await c.executeDiscard()
  assert.equal(writes.length, 0)
  assert.match(c.getSelectionState().error, /saved locally/)
})
