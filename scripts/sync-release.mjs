import { execFileSync } from 'node:child_process'
import { releaseVersion } from './release-package.mjs'

const tag = process.argv[2]
releaseVersion(tag)
const git = (...args) => execFileSync('git', args, { stdio: 'inherit' })
git('fetch', 'origin', 'main', 'develop', '--tags')
git('merge-base', '--is-ancestor', tag, 'origin/main')
git('config', 'user.name', 'github-actions[bot]')
git(
  'config',
  'user.email',
  '41898282+github-actions[bot]@users.noreply.github.com',
)
git('switch', '-c', 'release-sync-develop', 'origin/develop')
git('merge', '--no-ff', tag, '-m', `chore: sync release ${tag} into develop`)
git('push', 'origin', 'HEAD:develop')
