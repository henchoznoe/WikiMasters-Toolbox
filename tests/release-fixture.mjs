import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function releaseFixture(t, version = '1.3.0') {
  const root = await mkdtemp(join(tmpdir(), 'toolbox-release-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'scripts'))
  await mkdir(join(root, 'artifacts'))
  for (const script of [
    'release-package.mjs',
    'publish-chrome.mjs',
    'sync-release.mjs',
  ])
    await copyFile(
      new URL(`../scripts/${script}`, import.meta.url),
      join(root, 'scripts', script),
    )
  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version }),
  )
  await writeFile(join(root, 'package.json'), JSON.stringify({ version }))
  const archive = join(root, 'artifacts', `wikimasters-toolbox-${version}.zip`)
  execFileSync('zip', ['-q', archive, 'manifest.json'], { cwd: root })
  return { root, archive, url: pathToFileURL(`${root}/`) }
}
