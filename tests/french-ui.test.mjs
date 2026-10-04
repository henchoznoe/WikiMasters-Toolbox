import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

async function expose(imports, context = {}) {
  const result = await build({
    stdin: {
      contents: Object.entries(imports)
        .map(
          ([module, names]) =>
            `import {${names}} from './src/content/${module}.ts'; Object.assign(globalThis,{${names}});`,
        )
        .join('\n'),
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
    URL,
    URLSearchParams,
    structuredClone,
  })
  vm.runInNewContext(result.outputFiles[0].text, context)
  return context
}

class Element {
  children = []
  dataset = {}
  attributes = new Map()
  style = {}
  classList = { add() {}, toggle() {} }
  textContent = ''
  constructor(tag) {
    this.tag = tag
  }
  append(...children) {
    this.children.push(
      ...children.map(child =>
        typeof child === 'string'
          ? Object.assign(new Element('#text'), { textContent: child })
          : child,
      ),
    )
  }
  replaceChildren(...children) {
    this.children = children
  }
  get firstElementChild() {
    return this.children[0]
  }
  setAttribute(key, value) {
    this.attributes.set(key, value)
  }
  addEventListener() {}
  attachShadow() {
    return {}
  }
}
function flatten(node) {
  return [node, ...node.children.flatMap(flatten)]
}

test('price controls and accessibility labels are in French', async () => {
  const c = await expose(
    { 'price-panel': 'createPriceControls', shared: 'createToolboxRoot' },
    {
      IntersectionObserver: class {
        observe() {}
        disconnect() {}
      },
      CSSStyleSheet: class {
        replaceSync() {}
      },
      document: {
        createElement: tag => new Element(tag),
        querySelector: () => null,
      },
      location: { pathname: '/marketplace' },
      window: { addEventListener() {} },
      localStorage: { getItem: () => null },
      sessionStorage: { getItem: () => null },
    },
  )
  const nodes = flatten(c.createPriceControls())
  const text = nodes
    .map(
      n =>
        `${n.textContent} ${n.title ?? ''} ${n.attributes.get('aria-label') ?? ''}`,
    )
    .join('\n')
  for (const label of [
    'Prix manquants',
    'Alertes de prix',
    'Périmètre d’actualisation des prix',
    'Actualiser les prix en cache',
  ])
    assert.ok(text.includes(label), label)
  assert.doesNotMatch(
    text,
    /\b(Prices|Load|Refresh|Packs|Discard|Unknown|Shiny)\b/,
  )
  assert.deepEqual(
    nodes
      .filter(n => n.dataset.priceScope)
      .flatMap(n => n.children.map(option => option.value)),
    ['page'],
  )
  const host = new Element('div')
  c.createToolboxRoot(host)
  assert.equal(host.lang, 'fr')
})
