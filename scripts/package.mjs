import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(
  await readFile(new URL('dist/manifest.json', root), 'utf8'),
)
await mkdir(new URL('artifacts/', root), { recursive: true })
const output = fileURLToPath(
  new URL(`artifacts/wikimasters-toolbox-${manifest.version}.zip`, root),
)
await rm(output, { force: true })
const result = spawnSync(
  'zip',
  [
    '-q',
    '-X',
    '-r',
    output,
    'manifest.json',
    'network.js',
    'content.js',
    'icons',
  ],
  {
    cwd: fileURLToPath(new URL('dist/', root)),
    stdio: 'inherit',
  },
)
if (result.status !== 0) throw new Error(`zip exited with ${result.status}`)
console.log(output)
