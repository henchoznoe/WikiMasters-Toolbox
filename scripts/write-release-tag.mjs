import { mkdir, writeFile } from 'node:fs/promises'

const tag = process.argv[2]
if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('Invalid release tag.')
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
await writeFile(
  new URL('../artifacts/release-tag.txt', import.meta.url),
  `${tag}\n`,
)
