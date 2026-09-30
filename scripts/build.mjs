import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = new URL('../', import.meta.url)
const dist = new URL('../dist/', import.meta.url)
const manifest = JSON.parse(
  await readFile(new URL('manifest.json', root), 'utf8'),
)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

if (manifest.manifest_version !== 3 || manifest.version !== pkg.version) {
  throw new Error(
    'Manifest and package versions must match, and Manifest V3 is required.',
  )
}
if (manifest.browser_specific_settings || manifest.web_accessible_resources) {
  throw new Error('Unexpected browser-specific settings or exposed scripts.')
}
if (
  manifest.content_scripts?.length !== 2 ||
  manifest.content_scripts.some(
    entry =>
      entry.matches?.length !== 1 ||
      entry.matches[0] !== 'https://www.wiki-masters.com/*',
  )
) {
  throw new Error('Content scripts must target only WikiMasters.')
}

const css = await readFile(new URL('src/toolbox.css', root), 'utf8')
await build({
  entryPoints: [
    fileURLToPath(new URL('src/network.ts', root)),
    fileURLToPath(new URL('src/content.ts', root)),
  ],
  outdir: fileURLToPath(dist),
  entryNames: '[name]',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome111',
  define: { WM_TOOLBOX_CSS: JSON.stringify(css) },
})
for (const script of manifest.content_scripts) {
  for (const path of [...(script.js || []), ...(script.css || [])]) {
    const file = new URL(path, dist)
    if (!(await stat(file)).isFile())
      throw new Error(`Missing build output: ${path}`)
  }
}
await mkdir(new URL('icons/', dist), { recursive: true })
for (const path of Object.values(manifest.icons || {})) {
  if (typeof path !== 'string' || !/^icons\/icon-\d+\.png$/.test(path)) {
    throw new Error('Invalid icon path in manifest.')
  }
  await copyFile(new URL(path, root), new URL(path, dist))
}
await copyFile(new URL('manifest.json', root), new URL('manifest.json', dist))
