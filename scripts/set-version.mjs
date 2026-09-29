import { readFile, writeFile } from 'node:fs/promises'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  throw new Error('Expected a stable semantic version, such as 1.2.3.')
}
if (version.split('.').some(part => Number(part) > 65535)) {
  throw new Error('Chrome requires each version component to be at most 65535.')
}

for (const file of ['package.json', 'manifest.json']) {
  const url = new URL(`../${file}`, import.meta.url)
  const json = JSON.parse(await readFile(url, 'utf8'))
  json.version = version
  await writeFile(url, `${JSON.stringify(json, null, 2)}\n`)
}
