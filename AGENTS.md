# Repository guidance

## Scope

WikiMasters Toolbox is a Chrome Manifest V3 extension dedicated to card prices for WikiMasters. Every option must work with a free game account. Use only price data available to that account; do not add subscription-dependent endpoints, upgrade prompts or paid-account branches.

Keep the scope limited to price references, graphs, freshness, refresh, local observations, concluded-sale estimates, diagnostics and price alerts. Automated reads for those tools are in scope. Do not add gameplay actions, background gameplay schedules, collection management, native form prefilling or write endpoints. Do not claim official approval or compliance of the price tools with the game's rules.

All user-facing Toolbox text must be in French, including tooltips, confirmations, errors and accessibility labels. Format displayed numbers and dates using French conventions. Keep code identifiers, protocol values, storage keys and technical documentation in English; `ROADMAP.md` is in French. Preserve native card titles and user-provided content.

The interface should remain compact and consistent with the game. Use `…` for loading, concise status messages and existing Toolbox styles. Keep the README as a project overview with installation, contribution and delivery instructions; planned work belongs in `ROADMAP.md`.

`AGENTS.md` is the single source of repository guidance. `CLAUDE.md` must remain a relative symlink to `AGENTS.md`; edit this file when updating instructions.

## Architecture

- `src/network.ts` runs in the page's main world and observes relevant native fetch/XHR responses. Forward only the metadata needed by Toolbox; leave the game's requests and responses intact.
- `src/content.ts` runs in the isolated content-script world and coordinates startup, account changes, SPA navigation and rendering.
- Keep domain logic in `src/content/`. Register page panels in `routes.ts` and reuse `panel.ts` and shared shadow-root helpers.
- Use `src/cards.ts` for identity mapping. Catalogue IDs identify price requests. A title match is display-only and must reject ambiguous catalogue or rarity identities.
- Scope price alerts and concluded-sale samples to the detected account. Cancel relevant work on account or route changes.
- Apply styles through `src/toolbox.css` inside extension shadow roots. Reuse `createRarityBadge` and `.wm-rarity-surface` for colored, textured rarity controls everywhere.

## Price data

- Keep prices tied to the exact rarity. Unknown prices or missing data must remain explicit; do not substitute another rarity or invent market history.
- The price cache lasts 24 hours; that is not the game's sales calculation window. Preserve original fetch timestamps when a refresh fails.
- Reuse request deduplication, budgets, timeouts, cancellation and server pauses. Avoid adding parallel or repeated requests outside the existing request policies.
- The shared transport must accept only allowlisted read URLs and send GET requests. Native game requests and responses must remain intact; observe only metadata needed for prices.
- Do not add migration or legacy compatibility modules: this is a fresh, price-only extension.
- Keep credentials, authentication headers, cookies, session data and live account inventory out of source files, logs, documentation and PR descriptions. Update `PRIVACY.md` when local storage or data use changes.

## Development and verification

Use Node.js 24 and pnpm 12.4.2. TypeScript and Biome are configured in the repository; follow their existing rules and keep dependency changes deliberate.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package
```

`pnpm check` runs lint, build and Node tests. Tests that inspect `dist/` require a current build. `pnpm package` runs the checks and creates the Chrome ZIP under `artifacts/`. Both `dist/` and `artifacts/` are generated and ignored; edit `src/` rather than generated bundles.

Add focused regression tests for changed behavior. For affected UI, load `dist/` through `chrome://extensions/`, reload the extension and game tab, then inspect the real flow. The game can fail temporarily during busy hours; distinguish server failures from extension regressions and report unverified flows accurately.

## Git and delivery

- Start work from current `develop`; use `codex/` for agent-created branches unless the user specifies another name.
- Use Conventional Commits and a Conventional Commit PR title. Do not add an agent as a commit co-author.
- Open PRs against `develop`, include the verification performed, and wait for CI. Leave merging and release approval to the maintainer unless explicitly authorized.
- Releases originate from `main`. semantic-release derives the version, tags the release and creates the GitHub ZIP. Do not manually bump tracked versions during normal feature work.
- Chrome Web Store publication is dispatched for a new release when `CWS_ENABLED=true`; credentials come from GitHub secrets and the `chrome-web-store` environment. Publishing or retrying a Store submission requires explicit user authorization.
