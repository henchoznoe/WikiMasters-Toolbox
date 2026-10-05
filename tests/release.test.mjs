import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import releaseGit from '@semantic-release/git'
import config from '../release.config.mjs'
import { releasePackage, releaseVersion } from '../scripts/release-package.mjs'
import { releaseFixture } from './release-fixture.mjs'

test('release ZIP version must match its stable Chrome release tag', async t => {
  const fixture = await releaseFixture(t)
  assert.equal((await releasePackage('v1.3.0', fixture.url)).version, '1.3.0')
  for (const tag of [
    'main',
    '--help',
    'v1.3.0-beta.1',
    'v01.3.0',
    'v65536.0.0',
    'v0.0.0',
  ])
    assert.throws(() => releaseVersion(tag))
  await writeFile(
    join(fixture.root, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version: '1.1.0' }),
  )
  execFileSync('zip', ['-q', fixture.archive, 'manifest.json'], {
    cwd: fixture.root,
  })
  await assert.rejects(
    releasePackage('v1.3.0', fixture.url),
    /must match v1.3.0/,
  )
  await writeFile(fixture.archive, 'Not a ZIP.')
  await assert.rejects(
    releasePackage('v1.3.0', fixture.url),
    /integrity check failed/,
  )
})

test('semantic-release commits both version files and sync preserves newer develop work', async t => {
  const fixture = await releaseFixture(t, '1.2.0')
  const remote = join(fixture.root, 'remote.git')
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: fixture.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '--bare', remote)
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  git('config', 'core.hooksPath', join(fixture.root, 'empty-hooks'))
  git('add', 'package.json', 'manifest.json')
  git('commit', '-m', 'feat: baseline')
  git('tag', 'v1.2.0')
  git('branch', 'develop')
  git('remote', 'add', 'origin', remote)
  git('push', 'origin', 'main', 'develop', '--tags')
  git('switch', 'develop')
  await writeFile(
    join(fixture.root, 'development.txt'),
    'New work after the release merge.\n',
  )
  git('add', 'development.txt')
  git('commit', '-m', 'feat: newer development work')
  git('push', 'origin', 'develop')
  git('switch', 'main')
  for (const file of ['package.json', 'manifest.json']) {
    const json = JSON.parse(await readFile(join(fixture.root, file), 'utf8'))
    json.version = '1.3.0'
    await writeFile(join(fixture.root, file), JSON.stringify(json))
  }
  await writeFile(
    join(fixture.root, 'unrelated.txt'),
    'Must stay out of the release commit.\n',
  )
  const [, options] = config.plugins.find(
    plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/git',
  )
  await releaseGit.prepare(options, {
    cwd: fixture.root,
    env: process.env,
    branch: { name: 'main' },
    options: { repositoryUrl: remote },
    lastRelease: { version: '1.2.0', gitTag: 'v1.2.0' },
    nextRelease: { version: '1.3.0', gitTag: 'v1.3.0', notes: 'Test release.' },
    logger: { log() {}, error() {} },
  })
  assert.equal(
    git('log', '-1', '--format=%s'),
    'chore(release): 1.3.0 [skip ci]',
  )
  assert.deepEqual(
    git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')
      .split('\n')
      .sort(),
    ['manifest.json', 'package.json'],
  )
  git('tag', 'v1.3.0')
  git('push', 'origin', 'v1.3.0')
  execFileSync(
    process.execPath,
    [join(fixture.root, 'scripts/sync-release.mjs'), 'v1.3.0'],
    { cwd: fixture.root, stdio: 'pipe' },
  )
  git('fetch', 'origin')
  for (const branch of ['origin/main', 'origin/develop', 'v1.3.0']) {
    for (const file of ['package.json', 'manifest.json'])
      assert.equal(
        JSON.parse(git('show', `${branch}:${file}`)).version,
        '1.3.0',
      )
  }
  assert.equal(
    git('show', 'origin/develop:development.txt'),
    'New work after the release merge.',
  )
  git('merge-base', '--is-ancestor', 'origin/main', 'origin/develop')
  assert.throws(() => git('show', 'origin/main:unrelated.txt'))
})
