# Repository guidance

## Scope

WikiMasters Toolbox is a Chrome Manifest V3 extension for WikiMasters. Every option must work with a free game account. Use only data and actions available to that account; do not add subscription-dependent endpoints, upgrade prompts or paid-account branches.

Equivalent capabilities may be implemented for free using local logic or freely accessible game data, even if the game charges for its own implementation. Preserve this distinction when planning features: assess the data needed, rather than excluding an idea because of the native game's pricing.

The interface should remain compact and consistent with the game. Use `…` for loading, concise status messages and existing Toolbox styles. Keep the README as a project overview with installation, contribution and delivery instructions; planned work belongs in `ROADMAP.md`.

`AGENTS.md` is the single source of repository guidance. `CLAUDE.md` must remain a relative symlink to `AGENTS.md`; edit this file when updating instructions.

## Architecture

- `src/network.ts` runs in the page's main world and observes relevant native fetch/XHR responses. Forward only the metadata needed by Toolbox; leave the game's requests and responses intact.
- `src/content.ts` runs in the isolated content-script world and coordinates startup, account changes, SPA navigation and rendering.
- Keep domain logic in `src/content/`. Register page panels in `routes.ts` and reuse `panel.ts` and shared shadow-root helpers.
- Use `src/cards.ts` for identity mapping. Catalogue IDs identify price requests; possession IDs identify owned copies and card actions. A title match must never identify a copy for a mutation.
- Scope account-specific collections, receipts and statistics to the detected account. Cancel relevant work on account or route changes.
- Apply styles through `src/toolbox.css` inside extension shadow roots. Reuse `createRarityBadge` and `.wm-rarity-surface` for colored, textured rarity controls everywhere.

## Data and game actions

- Keep prices tied to the exact rarity. Unknown prices or missing data must remain explicit; do not substitute another rarity or invent market history.
- The price cache lasts 24 hours; that is not the game's sales calculation window. Preserve original fetch timestamps when a refresh fails.
- Reuse request deduplication, budgets, timeouts, cancellation and server pauses. Avoid adding parallel or repeated requests outside the existing request policies.
- Card actions must use a complete, validated collection and recheck protections before execution. Keep previews, confirmation, browser locks and per-account journals. Do not retry an uncertain write automatically.
- When the game requests human verification for packs, pause Toolbox opening and let the native game handle its popup. Do not read or store challenge tokens. A successful native opening restores the controls and the normal automatic schedule.
- Keep credentials, authentication headers, cookies, session data and live account inventory out of source files, logs, documentation and PR descriptions. Update `PRIVACY.md` when local storage or data use changes.

## Development and verification

Use Node.js 24 and pnpm 12.4.2. TypeScript and Biome are configured in the repository; follow their existing rules and keep dependency changes deliberate.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package
```

`pnpm check` runs lint, build and Node tests. Tests that inspect `dist/` require a current build. `pnpm package` runs the checks and creates the Chrome ZIP under `artifacts/`. Both `dist/` and `artifacts/` are generated and ignored; edit `src/` rather than generated bundles.

Add focused regression tests for changed behavior. For affected UI, load `dist/` through `chrome://extensions/`, reload the extension and game tab, then inspect the real flow. Use the user's authorization when testing live actions that consume packs or change cards, and follow the browser tool's confirmation requirements. The game can fail temporarily during busy hours; distinguish server failures from extension regressions and report unverified flows accurately.

## Git and delivery

- Start work from current `develop`; use `codex/` for agent-created branches unless the user specifies another name.
- Use Conventional Commits and a Conventional Commit PR title. Do not add an agent as a commit co-author.
- Open PRs against `develop`, include the verification performed, and wait for CI. Leave merging and release approval to the maintainer unless explicitly authorized.
- Releases originate from `main`. semantic-release derives the version, tags the release and creates the GitHub ZIP. Do not manually bump tracked versions during normal feature work.
- Chrome Web Store publication is dispatched for a new release when `CWS_ENABLED=true`; credentials come from GitHub secrets and the `chrome-web-store` environment. Publishing or retrying a Store submission requires explicit user authorization.
