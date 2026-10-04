import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const NOW = Date.UTC(2026, 9, 4, 12)
const DAY = 86400_000
class Clock extends Date {
  static now() {
    return NOW
  }
}
class Node {
  children = []
  attributes = new Map()
  listeners = new Map()
  dataset = {}
  constructor(tag) {
    this.tag = tag
  }
  append(...children) {
    this.children.push(...children)
  }
  replaceChildren(...children) {
    this.children = children
  }
  setAttribute(key, value) {
    this.attributes.set(key, value)
  }
  getAttribute(key) {
    return this.attributes.get(key) ?? null
  }
  addEventListener(key, listener) {
    this.listeners.set(key, listener)
  }
  focus() {
    this.listeners.get('focus')?.({})
  }
}
const flatten = node => [node, ...node.children.flatMap(flatten)]
async function expose(module, names, context = {}) {
  const result = await build({
    stdin: {
      contents: `import {${names}} from './src/content/${module}.ts';Object.assign(globalThis,{${names}})`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    write: false,
    define: { WM_TOOLBOX_CSS: '""' },
  })
  Object.assign(context, {
    AbortController,
    AbortSignal,
    Date: Clock,
    Intl,
    CSSStyleSheet: class {
      replaceSync() {}
    },
  })
  vm.runInNewContext(result.outputFiles[0].text, context)
  return context
}
const card = extra => ({
  id: 'a',
  title: 'Same title',
  rarity: 'R',
  shiny: false,
  copyId: null,
  ...extra,
})

test('identity resolution requires exact native rarity and rejects conflicting IDs, titles and shiny variants', async () => {
  const c = await expose('card-identity', 'resolveCardIdentity')
  const cards = [
    card(),
    card({ copyId: 'second-copy' }),
    card({ id: 'b' }),
    card({ rarity: 'L' }),
  ]
  assert.equal(
    c.resolveCardIdentity(cards, { title: 'Same title', rarity: 'R' }),
    null,
  )
  assert.equal(
    c.resolveCardIdentity(cards, { title: 'Same title', rarity: 'R', id: 'a' })
      .id,
    'a',
  )
  assert.equal(
    c.resolveCardIdentity(cards, {
      title: 'Other title',
      rarity: 'R',
      id: 'a',
    }),
    null,
  )
  assert.equal(
    c.resolveCardIdentity(cards, {
      title: 'Same title',
      rarity: null,
      id: 'a',
    }),
    null,
  )
  assert.equal(
    c.resolveCardIdentity(cards, {
      title: 'Same title',
      rarity: 'UR',
      id: 'a',
    }),
    null,
  )
  assert.equal(
    c.resolveCardIdentity(cards, {
      title: 'Same title',
      rarity: 'R',
      id: 'possession',
    }),
    null,
  )
  const variants = [card(), card({ shiny: true })]
  assert.equal(
    c.resolveCardIdentity(variants, { title: 'Same title', rarity: 'R' }),
    null,
  )
  assert.equal(
    c.resolveCardIdentity(variants, {
      title: 'Same title',
      rarity: 'R',
      shiny: true,
    }).shiny,
    true,
  )
  assert.equal(
    c.resolveCardIdentity([card()], { title: ' Same   title ', rarity: 'R' })
      .id,
    'a',
  )
})

test('snapshot rarity is authoritative; missing or invalid variants never fall back to the catalogue rarity', async () => {
  const result = await build({
    stdin: {
      contents:
        "import {mapCard} from './src/cards.ts';globalThis.mapCard=mapCard",
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    write: false,
  })
  const c = {}
  vm.runInNewContext(result.outputFiles[0].text, c)
  const raw = {
    card_id: 'a',
    snapshot_rarity: '?',
    card: { id: 'a', wikipedia_title: 'Same title', rarity: 'L' },
  }
  assert.equal(c.mapCard(raw).rarity, null)
  assert.equal(c.mapCard({ ...raw, snapshot_rarity: null }).rarity, null)
  assert.equal(c.mapCard({ ...raw, snapshot_rarity: 'R' }).rarity, 'R')
  assert.equal(c.mapCard({ ...raw, card_id: 'b' }), null)
})

test('freshness exposes date, threshold and failed refresh together without replacing the original reading', async () => {
  const c = await expose(
    'price-presentation',
    'priceFreshness,presentPrice,priceCheckDate',
  )
  const quote = {
    status: 'available',
    average: 12,
    fetchedAt: NOW - 20 * 60_000,
    lastAttempt: NOW,
    failed: true,
  }
  const state = c.priceFreshness(quote, 'decision')
  assert.equal(state.warning, true)
  for (const text of [
    c.priceCheckDate(quote.fetchedAt),
    'Seuil 15 min',
    'à actualiser',
    'Actualisation échouée',
    c.priceCheckDate(NOW),
    'ancienne référence conservée',
  ])
    assert.ok(state.text.includes(text), text)
  assert.match(
    c.priceFreshness(quote, 'album').text,
    /Cache 24 h · récent.*échouée/,
  )
  assert.equal(
    c.priceFreshness(
      { ...quote, failed: false, fetchedAt: NOW - 15 * 60_000 + 1 },
      'decision',
    ).warning,
    false,
  )
  assert.equal(
    c.priceFreshness(
      { ...quote, failed: false, fetchedAt: NOW - 15 * 60_000 },
      'decision',
    ).warning,
    true,
  )
  assert.equal(c.presentPrice(quote, 'decision', true).value, '—')
  assert.match(
    c.presentPrice(quote, 'decision', true).hint,
    /brillantes inconnu/,
  )
})

test('timeline distinguishes no observation from a successful reading without sales and never bridges either gap', async () => {
  const document = {
    createElement: tag => new Node(tag),
    createElementNS: (_ns, tag) => new Node(tag),
  }
  const c = await expose(
    'price-graph',
    'priceTimeline,graphScale,createPriceGraph',
    { document },
  )
  const points = [
    { at: NOW - 5 * DAY, average: 0 },
    { at: NOW - 4 * DAY, average: 12.5 },
    { at: NOW - 2 * DAY, average: null },
    { at: NOW - DAY, average: 8 },
    { at: NOW, average: 9 },
    { at: NOW + DAY, average: 9000 },
  ]
  const days = c.priceTimeline(points)
  assert.deepEqual(
    Array.from(days, day => day.kind),
    ['price', 'price', 'missing', 'no-sales', 'price', 'price'],
  )
  const nodes = flatten(c.createPriceGraph(points))
  assert.equal(
    nodes.filter(node => node.attributes.get('class') === 'wm-graph-line')
      .length,
    2,
  )
  assert.ok(nodes.some(node => node.textContent?.includes('12,5 W')))
  assert.ok(nodes.some(node => node.textContent?.includes('Jour non observé')))
  assert.ok(
    nodes.some(node =>
      node.textContent?.includes('Lecture sans données de vente'),
    ),
  )
  assert.ok(nodes.some(node => node.tag === 'text' && node.textContent === 'W'))
  assert.equal(c.graphScale(c.priceTimeline([{ at: NOW, average: 0 }])).min, 0)
  assert.ok(c.graphScale(c.priceTimeline([{ at: NOW, average: 12 }])).max > 12)
  const empty = flatten(c.createPriceGraph([{ at: NOW, average: null }]))
  assert.equal(
    empty.filter(node => node.attributes.get('class') === 'wm-graph-grid')
      .length,
    0,
  )
})

test('graph focus and arrow keys visit prices, missing days and no-sales days with a visible date/value readout', async () => {
  const document = {
    createElement: tag => new Node(tag),
    createElementNS: (_ns, tag) => new Node(tag),
  }
  const c = await expose('price-graph', 'createPriceGraph', { document })
  const nodes = flatten(
    c.createPriceGraph([
      { at: NOW - 2 * DAY, average: 10 },
      { at: NOW, average: null },
    ]),
  )
  const controls = nodes.filter(
    node => node.attributes.get('class') === 'wm-graph-day',
  )
  const readout = nodes.find(
    node => node.className === 'wm-note wm-graph-readout',
  )
  let prevented = false
  controls[0].focus()
  assert.match(readout.textContent, /10 W.*UTC/)
  controls[0].listeners.get('keydown')({
    key: 'ArrowRight',
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.match(readout.textContent, /jour non observé/)
  assert.equal(controls[1].attributes.get('tabindex'), '0')
  assert.equal(controls[0].attributes.get('tabindex'), '-1')
  controls[1].listeners.get('keydown')({ key: 'End', preventDefault() {} })
  assert.match(readout.textContent, /lecture sans données de vente/)
  controls[2].listeners.get('mouseenter')({})
  assert.match(readout.textContent, /UTC/)
  controls[2].listeners.get('keydown')({ key: 'Home', preventDefault() {} })
  assert.match(readout.textContent, /10 W/)
})

test('recycled card markup replaces a previous quote with an explicit unknown state and schedules no ambiguous reads', async () => {
  class Element extends Node {
    parentElement = null
    className = ''
    append(...children) {
      for (const child of children) {
        if (child.parentElement)
          child.parentElement.children = child.parentElement.children.filter(
            node => node !== child,
          )
        child.parentElement = this
        this.children.push(child)
      }
    }
    get firstElementChild() {
      return this.children[0] ?? null
    }
    get lastElementChild() {
      return this.children.at(-1) ?? null
    }
    attachShadow() {
      this.shadowRoot = new Element('shadow')
      return this.shadowRoot
    }
    querySelectorAll(selector) {
      const descendants = this.children.flatMap(child => flatten(child))
      if (selector === 'span, div')
        return descendants.filter(child => ['span', 'div'].includes(child.tag))
      if (selector === '[style]') return []
      if (selector.startsWith('.'))
        return descendants.filter(child =>
          child.className?.split(' ').includes(selector.slice(1)),
        )
      if (selector === ':scope > div.mt-auto')
        return this.children.filter(child => child.className === 'mt-auto')
      const key = selector
        .match(/^\[data-([^\]]+)\]$/)?.[1]
        ?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      return descendants.filter(child =>
        key ? key in child.dataset : child.tag === selector,
      )
    }
    matches(selector) {
      return this.tag === selector
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null
    }
    remove() {
      this.parentElement.children = this.parentElement.children.filter(
        child => child !== this,
      )
    }
  }
  const tile = new Element('div')
  tile.closest = () => null
  const body = new Element('div')
  const heading = new Element('h3')
  heading.textContent = 'Same title'
  heading.closest = () => tile
  const rarity = new Element('span')
  rarity.textContent = 'R'
  const stats = new Element('div')
  stats.className = 'mt-auto'
  body.append(heading, rarity, stats)
  tile.append(body)
  let observed = 0
  const c = await expose(
    'prices',
    'registerCards,renderCards,getVisiblePriceCards',
    {
      document: {
        createElement: tag => new Element(tag),
        querySelectorAll: selector =>
          selector === 'h3'
            ? [heading]
            : selector === '[data-wm-toolbox-card-id]' &&
                tile.dataset.wmToolboxCardId
              ? [tile]
              : [],
        querySelector: () => null,
      },
      location: { pathname: '/global-collection' },
      localStorage: {
        getItem: key =>
          key === 'wm_toolbox_price_v1_a'
            ? JSON.stringify({ fetchedAt: NOW, ok: true, averages: { R: 77 } })
            : null,
      },
      IntersectionObserver: class {
        observe() {
          observed++
        }
        unobserve() {}
        disconnect() {}
      },
    },
  )
  c.registerCards([card(), card({ id: 'b' })])
  c.renderCards()
  const badge = stats.firstElementChild.shadowRoot.firstElementChild
  assert.equal(badge.disabled, true)
  assert.equal(
    badge.querySelector('.wm-price-value').textContent,
    'Prix inconnu',
  )
  assert.equal(observed, 0)
  tile.setAttribute('data-card-id', 'a')
  c.renderCards()
  assert.equal(badge.disabled, false)
  assert.equal(badge.dataset.cardId, 'a')
  assert.equal(badge.querySelector('.wm-price-value').textContent, '77 W')
  rarity.textContent = 'UR'
  assert.equal(
    c.getVisiblePriceCards().length,
    0,
    'batch must reject changed markup even before the next render',
  )
  c.renderCards()
  assert.equal(badge.disabled, true)
  assert.equal(badge.dataset.cardId, undefined)
  assert.equal(tile.dataset.wmToolboxCardId, undefined)
  assert.equal(
    badge.querySelector('.wm-price-value').textContent,
    'Prix inconnu',
  )
  assert.match(badge.getAttribute('aria-label'), /Prix inconnu/)
  assert.doesNotMatch(badge.getAttribute('aria-label'), /77/)
  assert.equal(observed, 0)
  const listing = new Element('a')
  listing.append(tile)
  tile.closest = () => listing
  rarity.textContent = 'R'
  c.renderCards()
  assert.equal(
    stats.children.length,
    0,
    'market badge must sit outside the clipped card footer',
  )
  assert.equal(listing.lastElementChild.dataset.wmToolboxPriceLayout, 'market')
  assert.equal(listing.lastElementChild.shadowRoot.firstElementChild, badge)
})

test('listing comparisons keep the reading date, decision threshold and failure visible in their text', async () => {
  const c = await expose('price-comparison', 'listingComparison')
  const row = {
    id: 'listing',
    card: { id: 'a', rarity: 'R', shiny: false, title: 'Same title' },
    base: 5,
    bid: 10,
    final: null,
    status: 'active',
  }
  const quote = {
    status: 'available',
    average: 12,
    fetchedAt: NOW - 20 * 60_000,
    lastAttempt: NOW,
    failed: true,
  }
  const result = c.listingComparison(row, quote)
  assert.match(
    result.text,
    /Lu le .*Seuil 15 min.*à actualiser.*Actualisation échouée.*ancienne référence conservée/,
  )
  assert.match(result.text, /Mise de départ/)
  assert.match(result.text, /Offre actuelle/)
})

test('loading indicators have an explicit French label, stay stable while rendering and stop on completion', async () => {
  const c = await expose('loading', 'setLoadingText', {
    document: { createElement: tag => new Node(tag) },
  })
  const target = new Node('p')
  c.setLoadingText(target, 'Actualisation en cours', true)
  const spinner = target.children[0]
  assert.equal(spinner.className, 'wm-loader')
  assert.equal(spinner.getAttribute('aria-hidden'), 'true')
  assert.equal(target.children[1].textContent, 'Actualisation en cours')
  assert.equal(target.getAttribute('aria-busy'), 'true')
  c.setLoadingText(target, 'Actualisation en cours', true)
  assert.equal(target.children[0], spinner)
  c.setLoadingText(target, 'Actualisation terminée', false)
  assert.equal(target.getAttribute('aria-busy'), 'false')
  assert.equal(target.textContent, 'Actualisation terminée')
})
