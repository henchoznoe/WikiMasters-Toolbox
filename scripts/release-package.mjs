import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function compareChromeVersions(left, right) {
  const parts = version => {
    if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version || ''))
      throw new Error('Cannot compare an unknown Chrome Web Store version.')
    const result = version.split('.').map(Number)
    if (result.some(part => part > 65535))
      throw new Error('Chrome Web Store version is outside the version range.')
    return result
  }
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < 4; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0)
    if (difference) return Math.sign(difference)
  }
  return 0
}

export function releaseVersion(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag || ''))
    throw new Error('Expected a stable release tag, such as v1.2.3.')
  const version = tag.slice(1)
  if (
    version === '0.0.0' ||
    version.split('.').some(part => Number(part) > 65535)
  )
    throw new Error('Release version is outside the Chrome version range.')
  return version
}

export async function releasePackage(
  tag,
  root = new URL('../', import.meta.url),
) {
  const version = releaseVersion(tag)
  const file = new URL(`artifacts/wikimasters-toolbox-${version}.zip`, root)
  const zip = await readFile(file)
  const integrity = spawnSync('unzip', ['-tq', fileURLToPath(file)], {
    encoding: 'utf8',
  })
  if (integrity.status !== 0)
    throw new Error('Release ZIP integrity check failed.')
  const result = spawnSync(
    'unzip',
    ['-p', fileURLToPath(file), 'manifest.json'],
    {
      encoding: 'utf8',
    },
  )
  if (result.status !== 0)
    throw new Error('Cannot read the release ZIP manifest.')
  const manifest = JSON.parse(result.stdout)
  if (manifest.manifest_version !== 3 || manifest.version !== version)
    throw new Error(
      `Release ZIP manifest must match ${tag} and use Manifest V3.`,
    )
  return { version, zip }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === '--validate-tag') releaseVersion(process.argv[3])
  else {
    const { version } = await releasePackage(process.argv[2])
    console.log(`Release ZIP verified: ${version}.`)
  }
}
