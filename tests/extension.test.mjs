import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

const dist = new URL('../dist/', import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))

async function exposeModule(module, names, context, extra = '') {
  const imports = names.join(', ')
  const result = await build({
    stdin: {
      contents: `import { ${imports} } from './src/content/${module}.ts'; ${extra}; Object.assign(globalThis, { ${imports} })`,
      resolveDir: root,
      sourcefile: 'test-entry.ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    define: { WM_TOOLBOX_CSS: '""' },
  })
  Object.assign(context, { AbortController, AbortSignal, URL })
  vm.runInNewContext(result.outputFiles[0].text, context)
}

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

test('the shared panel resolves labels by page', async () => {
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
  }
  await exposeModule('panel', ['resolvePanelPage'], context)
  const pages = [
    {
      id: 'catalogue',
      label: 'Catalogue',
      matches: path => path === '/global-collection',
    },
    {
      id: 'collection',
      label: 'Collection',
      matches: path => path === '/collection',
    },
  ]
  assert.equal(
    context.resolvePanelPage('/global-collection', pages).label,
    'Catalogue',
  )
  assert.equal(
    context.resolvePanelPage('/collection', pages).label,
    'Collection',
  )
  assert.equal(context.resolvePanelPage('/settings', pages), null)
})

test('card prices use the exact rarity without borrowing another rarity', async () => {
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    localStorage: {
      getItem: key =>
        key === 'wm_toolbox_price_v1_card-1'
          ? JSON.stringify({
              fetchedAt: Date.now(),
              ok: true,
              averages: { R: 25 },
            })
          : null,
    },
    Date,
  }
  await exposeModule('prices', ['readPriceQuote'], context)
  const quote = context.readPriceQuote('card-1', 'R')
  assert.equal(quote.status, 'available')
  assert.equal(quote.average, 25)
  assert.ok(quote.fetchedAt <= Date.now())
  assert.equal(context.readPriceQuote('card-1', 'UR').status, 'no-sales')
})

test('missing market cards are distinct from temporary price errors', async () => {
  const entries = new Map([
    [
      'wm_toolbox_price_v1_missing',
      JSON.stringify({
        fetchedAt: Date.now(),
        ok: false,
        notFound: true,
        averages: {},
      }),
    ],
    [
      'wm_toolbox_price_v1_error',
      JSON.stringify({ fetchedAt: Date.now(), ok: false, averages: {} }),
    ],
  ])
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    localStorage: { getItem: key => entries.get(key) || null },
    Date,
  }
  await exposeModule('prices', ['readPriceQuote'], context)
  assert.equal(context.readPriceQuote('missing', 'C').status, 'not-found')
  assert.equal(context.readPriceQuote('error', 'C').status, 'unavailable')
})

test('price presentation shows fetch age without implying a sale window', async () => {
  const context = {
    CSSStyleSheet: class {
      replaceSync() {}
    },
    IntersectionObserver: class {},
    Date,
    Intl,
  }
  await exposeModule('prices', ['formatPriceAge', 'presentPrice'], context)
  const fetchedAt = Date.now() - 2 * 60 * 60 * 1000
  assert.equal(context.formatPriceAge(fetchedAt, fetchedAt + 30_000), '<1 min')
  assert.equal(
    context.formatPriceAge(fetchedAt, fetchedAt + 125 * 60_000),
    '2 h',
  )
  const available = context.presentPrice({
    status: 'available',
    average: 125,
    fetchedAt,
  })
  assert.equal(available.value, '125 W')
  assert.equal(available.age, '2 h')
  assert.match(available.hint, /période de calcul non précisée/)
  const noSales = context.presentPrice({ status: 'no-sales', fetchedAt })
  assert.equal(noSales.value, '—')
  assert.equal(noSales.age, '2 h')
  const failed = context.presentPrice({ status: 'unavailable', fetchedAt })
  assert.equal(failed.value, '!')
  assert.equal(failed.age, '')
  assert.equal(context.presentPrice({ status: 'loading' }).value, '…')
})
