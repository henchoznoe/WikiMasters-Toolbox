<div align="center">

<img src="icons/icon-128.png" alt="WikiMasters Toolbox" width="96" height="96">

# WikiMasters Toolbox

A companion extension for everyday play on WikiMasters.

[![CI](https://github.com/henchoznoe/WikiMasters-Toolbox/actions/workflows/ci.yml/badge.svg)](https://github.com/henchoznoe/WikiMasters-Toolbox/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/henchoznoe/WikiMasters-Toolbox)](https://github.com/henchoznoe/WikiMasters-Toolbox/releases/latest)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/wikimasters-toolbox/nekkambfdbbmledkjpeagiafncciaalf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Biome](https://img.shields.io/badge/Biome-39B420?logo=biome&logoColor=white)](https://biomejs.dev/)

[Install extension](https://chromewebstore.google.com/detail/wikimasters-toolbox/nekkambfdbbmledkjpeagiafncciaalf) · [Roadmap](ROADMAP.md) · [Report an issue](https://github.com/henchoznoe/WikiMasters-Toolbox/issues)

</div>

## Overview

WikiMasters Toolbox brings useful context and controls directly into [WikiMasters](https://www.wiki-masters.com/), making it easier to manage a growing collection and understand card values while playing. Its compact interface follows the game's visual style and keeps the information close to the cards.

Every option is designed for a **free WikiMasters account**. Toolbox uses the game's available data and keeps its settings, caches and statistics in your browser. It is an independent community project, with no developer-operated backend, analytics or advertising. See the [privacy policy](PRIVACY.md) for the stored data and the [roadmap](ROADMAP.md) for planned work.

## Installation

Install [WikiMasters Toolbox from the Chrome Web Store](https://chromewebstore.google.com/detail/wikimasters-toolbox/nekkambfdbbmledkjpeagiafncciaalf), then open or reload WikiMasters while signed in. The Toolbox appears directly on supported game pages. Chrome manages updates for the Store installation.

## Local development

Use **Node.js 24** and **pnpm 12.4.2**, matching GitHub Actions and `package.json`.

```sh
git clone https://github.com/henchoznoe/WikiMasters-Toolbox.git
cd WikiMasters-Toolbox
pnpm install --frozen-lockfile
pnpm build
```

Open `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist/` directory. After editing the source, rebuild, reload the extension, then reload the WikiMasters tab.

The extension runs against the live game. For browser testing, use a dedicated account and check which actions consume packs or change cards before executing them.

### Commands

| Command | Purpose |
| --- | --- |
| `pnpm build` | Check TypeScript and bundle the extension into `dist/` |
| `pnpm lint` | Check formatting and lint rules with Biome |
| `pnpm format` | Apply Biome formatting and fixes |
| `pnpm test` | Run the tests against the current build; run `pnpm build` first |
| `pnpm check` | Run lint, build and tests |
| `pnpm package` | Run all checks and create the Chrome ZIP in `artifacts/` |

### Project structure

```text
src/
├── content.ts          # Startup, navigation and page events
├── network.ts          # Bridge for relevant native game responses
├── cards.ts            # Card and possession identity mapping
├── content/            # Collection, prices, packs and shared Toolbox UI
└── toolbox.css         # Styles scoped to the extension's shadow roots
tests/                  # Node tests and mocked game responses
scripts/                # Build, packaging and Store publication
.github/workflows/      # CI, releases and Chrome Web Store delivery
manifest.json           # Chrome Manifest V3
ROADMAP.md              # Prioritized backlog
AGENTS.md               # Repository guidance; CLAUDE.md links to this file
```

## Contributing

Issues and pull requests are welcome. Check the [roadmap](ROADMAP.md) before starting; open an issue to discuss larger changes or suggest an idea. Bug reports should include the game page, reproduction steps, expected behavior and extension version. Remove account details and session data from logs or screenshots.

Create a branch from `develop`, keep the change focused, and open your PR against **`develop`**. Follow [Conventional Commits](https://www.conventionalcommits.org/) for commits and PR titles (`feat:`, `fix:`, `docs:`, etc.). Read [AGENTS.md](AGENTS.md) for the architecture and implementation conventions; [CLAUDE.md](CLAUDE.md) is a symlink to the same guidance.

Before submitting:

```sh
pnpm check
pnpm package
```

Describe what changed and how it was verified. Add regression coverage for behavior changes, and check affected UI in Chrome when possible. Keep new functionality usable with a free game account and reuse the shared Toolbox components.

## Releases and automatic deployment

The delivery path is **feature branch → `develop` → `main` → GitHub Release → Chrome Web Store**.

1. [CI](.github/workflows/ci.yml) checks pull requests and pushes to `develop` and `main`, then builds a downloadable Chrome ZIP.
2. A merge to `main` runs the [release workflow](.github/workflows/release.yml). [semantic-release](release.config.mjs) determines whether a release is needed and calculates its version from Conventional Commits and existing tags.
3. For a new release, the workflow applies the version in its workspace, creates the Git tag, and attaches the versioned ZIP to a GitHub Release. It does not push a version commit back to `main`.
4. With `CWS_ENABLED=true`, that release dispatches [Publish Chrome extension](.github/workflows/publish-chrome.yml). It checks out the release tag, applies its version, rebuilds and verifies the package, then uploads it and submits it to the Chrome Web Store. Google controls review and final availability.

Merging a PR into `develop` validates the change; Store delivery starts from a new release on `main`. The tracked version in `package.json` and `manifest.json` is development metadata. Use the versioned GitHub Release ZIP for a manual Store upload.

### Maintainer setup

Configure the publishing account and OAuth access using the [Chrome Web Store API guide](https://developer.chrome.com/docs/webstore/using-api). Publication uses the GitHub environment **`chrome-web-store`** and these repository or environment secrets:

| Secret | Purpose |
| --- | --- |
| `CWS_CLIENT_ID` | Google OAuth client ID |
| `CWS_CLIENT_SECRET` | Google OAuth client secret |
| `CWS_REFRESH_TOKEN` | Refresh token for the publishing account |
| `CWS_PUBLISHER_ID` | Chrome Web Store publisher ID |
| `CWS_EXTENSION_ID` | Existing Store item ID |

Set the repository variable **`CWS_ENABLED=true`** once the Store item and credentials are ready. Keep credentials out of Git. With the secrets provided as local environment variables, this command verifies access without uploading or submitting a package:

```sh
node scripts/publish-chrome.mjs --verify
```

To retry a failed submission, run **Actions → Publish Chrome extension → Run workflow** on `main` with the existing release tag. Store listing text, screenshots and privacy declarations are maintained separately in the Developer Dashboard.

## License

[MIT](LICENSE).
