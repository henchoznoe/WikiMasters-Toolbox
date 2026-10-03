import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('French controls and accessibility labels preserve technical option values', async () => {
  const c = await expose(
    {
      'collection-browser': 'createCollectionBrowser',
      'price-panel': 'createPriceControls',
      'packs-panel': 'createPacksBody',
      'selection-panel': 'createSelectionControls',
      'market-panel': 'createMarketBody',
      shared: 'createToolboxRoot',
    },
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
        createTextNode: text =>
          Object.assign(new Element('#text'), { textContent: text }),
        querySelector: () => null,
      },
      location: { pathname: '/marketplace' },
      window: { addEventListener() {} },
      navigator: { locks: null },
      localStorage: { getItem: () => null },
      sessionStorage: { getItem: () => null },
    },
  )
  const nodes = [
    c.createCollectionBrowser(),
    c.createPriceControls(),
    c.createPacksBody(),
    c.createSelectionControls(),
    c.createMarketBody(),
  ].flatMap(flatten)
  const text = nodes
    .map(
      n =>
        `${n.textContent} ${n.title ?? ''} ${n.placeholder ?? ''} ${n.attributes.get('aria-label') ?? ''}`,
    )
    .join('\n')
  for (const label of [
    'Filtres / vues / doublons',
    'Nom de la vue',
    'Sélectionner les résultats',
    'Prix manquants',
    'Alertes de prix',
    'Paquets par ouverture manuelle',
    'Sélection / défausse',
    'Mes ventes',
    'Périmètre d’actualisation des prix',
  ])
    assert.ok(text.includes(label), label)
  assert.doesNotMatch(
    text,
    /\b(Prices|Select|Save|Load|Refresh|Missing|Packs|Discard|Unknown|Shiny|Show|Hide)\b/,
  )
  const options = nodes.filter(n => n.tag === 'option')
  for (const code of [
    'any',
    'yes',
    'no',
    'asc',
    'desc',
    'price',
    'page',
    'collection',
    'no-sales',
    'not-found',
    'error',
  ])
    assert.ok(
      options.some(n => n.value === code),
      code,
    )
  const host = new Element('div')
  c.createToolboxRoot(host)
  assert.equal(host.lang, 'fr')
})

test('French amounts and state labels keep missing prices and stored receipts explicit', async () => {
  const c = await expose(
    {
      presentation: 'statusLabel,storedMessage,errorMessage',
      'price-presentation': 'presentPrice',
      'market-model': 'priceDifference',
    },
    { Error },
  )
  const quote = {
    status: 'available',
    average: 1234.5,
    fetchedAt: Date.UTC(2026, 9, 3),
  }
  assert.equal(c.presentPrice(quote).value, '1\u202f234,5 W')
  assert.equal(c.priceDifference(1851.75, quote), '+617,25 W · +50,0 %')
  assert.equal(c.presentPrice({ ...quote, status: 'no-sales' }).value, '—')
  assert.match(
    c.presentPrice({ ...quote, failed: true }).hint,
    /actualisation échouée/,
  )
  assert.equal(c.statusLabel('committed'), 'engagée (copie indéterminée)')
  assert.equal(c.statusLabel('discarded'), 'défaussée')
  assert.equal(c.statusLabel('constructor'), 'inconnu')
  assert.equal(
    c.storedMessage('Reached your 2-pack limit.'),
    'Limite atteinte : 2 paquets.',
  )
  assert.equal(c.storedMessage('No packs remain.'), 'Il ne reste aucun paquet.')
  assert.equal(
    c.storedMessage('Failed: Request timed out.'),
    'Échec : Délai de requête dépassé.',
  )
  assert.equal(c.storedMessage('Message natif'), 'Message natif')
  assert.equal(c.storedMessage('constructor'), 'constructor')
  assert.equal(
    c.errorMessage(new TypeError('Failed to fetch'), 'Indisponible'),
    'Erreur réseau ; réessayez plus tard',
  )
  const manifest = JSON.parse(
    await readFile(new URL('../dist/manifest.json', import.meta.url)),
  )
  assert.match(manifest.description, /Prix moyens des cartes/)
})
