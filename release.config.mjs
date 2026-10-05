export default {
  branches: ['main'],
  repositoryUrl: 'git@github.com:henchoznoe/WikiMasters-Toolbox.git',
  tagFormat: 'v${version}',
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/exec',
      {
        prepareCmd:
          'node scripts/set-version.mjs ${nextRelease.version} && pnpm exec biome format --write package.json manifest.json && pnpm package',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['package.json', 'manifest.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          { path: 'artifacts/*.zip', label: 'Chrome extension package' },
        ],
      },
    ],
    [
      '@semantic-release/exec',
      {
        publishCmd: 'node scripts/write-release-tag.mjs ${nextRelease.gitTag}',
      },
    ],
  ],
}
