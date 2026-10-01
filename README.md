# WikiMasters Toolbox

A Chrome extension for [WikiMasters](https://www.wiki-masters.com/) focused on collection tools, card prices and packs:

- Average sale prices on cards in the collection, marketplace detail pages, and pack views.
- A full local collection index with identified copies, loading progress, stop/resume and synchronization after game actions.
- Selection by rarity across the full collection, protected copies, keep-N rules, a discard preview and controlled execution.
- Optional automatic opening of available packs at a configurable interval.
- A manual action to open all available packs or a chosen number, plus local statistics by card rarity.

The extension is independent of WikiMasters. It uses only the game's own API and stores the price cache, automation preferences, and pack statistics in the browser. Automatic opening is **off by default** and consumes available packs when enabled.

## Development

Requirements: Node.js 24 and pnpm 12.4.2.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package
```

Load the `dist/` directory in `chrome://extensions/` after enabling Developer mode. Reload the extension and the WikiMasters tab after each build. The ZIP in `artifacts/` is intended for the Chrome Web Store.

The source lives in `src/`. TypeScript checks every module, then esbuild bundles two browser scripts into `dist/network.js` and `dist/content.js`. The small stylesheet in `src/toolbox.css` is embedded in `content.js` and applied only inside the extension's shadow roots, leaving the game's styles untouched. The packaged extension contains the two scripts, icons, and `manifest.json`.

`src/content.ts` handles startup and page events. The `src/content/` modules separate the collection index, prices, pack opening, statistics, and the panel UI. `src/cards.ts` maps game data to catalogue IDs, snapshot rarities, shiny variants and possession IDs; catalogue IDs identify price requests, while possession IDs identify owned copies. `src/content/routes.ts` lists the pages that have a Toolbox panel. Each page supplies its label, route match, content, and optional mount or cleanup hooks; `src/content/panel.ts` supplies the shared **Toolbox** header and show/hide behavior. Add future page panels through this registry rather than placing their controls in the entry script. Panels are available on `/collection` and `/pulls`.

## Usage

On `/collection`, **Load collection** builds a local index of the current account's full, unfiltered collection, using the game's pages of 50 copies. It shows the loaded count and marks an incomplete index as partial. **Stop** keeps valid pages; **Resume** continues after checking the total and first page. The small refresh button restarts an interrupted load. Progress survives a reload when local storage is available. A saved partial traversal expires after 15 minutes, and a completed index becomes stale after five minutes. Busy servers and temporary network errors receive at most three attempts per request. A failed request never counts as an empty page.

After the first load, observed pack openings, marketplace/trade mutations, discards, favorites and tags invalidate the index and schedule a fresh traversal. Returning to the collection, changed native collection totals and newly observed copies also trigger synchronization. Returning to a visible tab refreshes an index older than five minutes, to avoid repeated traversals while switching windows. Account changes cancel the previous traversal and restore only that account's index. Loading or refreshing the index performs no action on cards.

The index keeps each possession separately, including copies of the same catalogue card with different snapshot rarities or shiny variants. Grouped rows without distinct possession IDs are rejected. The game does not expose an atomic pagination snapshot: Toolbox checks copy IDs, page lengths, the final total and the first page before marking the index complete, but remote changes are detected on subsequent observations rather than in real time. Collection actions use possession IDs and revalidate the full index and sale/trade protections after confirmation. Price badges use the visible rarity and skip ambiguous title matches when the DOM exposes no stable ID; a title match never identifies a possession for an action.

Open **Select / discard** to refresh the entire collection and load sale/trade protections. Choose one or more colored rarity tiles. **Keep / protect** excludes favorites, tagged cards, cards in active sales or pending trades, unique variants and shiny cards by default. **Keep per variant** retains at least N copies of each catalogue ID + rarity + shiny variant; protected or individually excluded copies count toward that minimum. A unique card can be selected only when its protection is disabled and N is 0. **Adjust copies** searches every indexed copy, with pages of 30 and a selected-only view. Each checkbox identifies a possession; title matches never feed a discard. All rarity controls use the shared `/pulls` color palette and textured backgrounds. Use `createRarityBadge` and `.wm-rarity-surface` for future rarity UI.

**Preview** shows the selected counts by rarity and each affected variant's before/after quantities. **Discard N** is the final confirmation of permanent removal. Toolbox then rechecks the complete collection and commitments; a changed snapshot cancels execution and requires another preview. It uses the game's native `POST /api/user-cards/bulk-discard` with one identified copy per request so each result remains attributable, sequentially with at least 350 ms between requests. This avoids relying on an undocumented larger batch limit. Browser locks prevent simultaneous Toolbox discard runs for the same account across tabs. **Stop** finishes the current write, then stops subsequent requests. Writes are never retried automatically; network failures, 429/5xx responses, timeouts or unexpected results stop the run and mark that copy uncertain. Definitive per-copy rejections remain visible in the result list. Changing account, leaving the collection or observing another collection change stops subsequent writes.

The last discard journal is stored locally per account before every write and after its response. If the journal cannot be saved, execution stops before the next write. After an interrupted reload, a pending request is shown as uncertain; execution never resumes automatically. The result lists successful, failed, uncertain and unattempted copies. After an attempted action the index is invalidated and the collection page reloads to update the game's card grid and balance; the journal survives this reload. Protection checks are snapshots, not server reservations: another device can change a card between the check and a write, and the game remains authoritative. The extension never bypasses a server rejection or privilege requirement.

Average prices appear when supported card data is available on collection, marketplace detail, and pack pages. In the collection, the price is centered below each card's attack and defense stats. A compact age next to collection and marketplace prices shows when this browser last fetched the value; hover for the exact local time and status. The pack summary includes that check time in each price tooltip. Prices are cached for 24 hours; temporary errors are cached for one minute. The game API returns an average by rarity, but does not state the number of sales or the period used to calculate it. The 24-hour cache duration is not the sale-history window.

On `/pulls`, leave **Packs per manual run** empty to open all available packs (up to 100), or enter a limit from 1 to 100. Click the opening button twice within eight seconds to confirm. The extension opens packs one at a time without the game's animations and shows progress as it goes. Use the same button to stop a manual run. After a manual or automatic run, **Last run** opens in the side panel with the received cards, their rarities, available average sale prices, a total for priced cards, and the stop or error reason. Cards with known prices appear from most to least expensive; cards without a price follow in opening order. For multiple packs, a small tag shows each card's pack number. You can collapse the summary; a long card list scrolls inside the panel. An ellipsis means a price is loading, and a dash means it is unavailable; hover over the dash for the reason. The summary remains available after the page reloads and belongs to the detected account in that tab. Earlier summaries cannot gain card details retroactively. The page reloads after a run that opened at least one pack so the game's own remaining-pack counter stays current. The panel can be shown or hidden at any screen size, and your choice is saved in this browser.

The panel also lets you enable automatic opening and set a minimum and maximum delay in minutes. Those settings and the next opening time appear only while automation is enabled. The time uses the browser's local 24-hour format. Keep a WikiMasters tab open for the schedule to run. Tabs share one scheduled time, and only one tab opens packs at a time. Each automatic cycle stops after 100 packs or when the game reports that none remain. Run the manual action again if the 100-pack limit is reached with packs still available. Turn the automation toggle off to stop an automatic cycle.

Pack statistics count cards by rarity and packs opened through the game's normal button, the manual Toolbox button, and automatic opening. Counts are stored locally in this browser for the detected WikiMasters account. Existing shared counts from earlier Toolbox versions remain in browser storage but are not assigned to any account, since they may include packs from different accounts. New account-specific totals therefore start at zero. The previous daily-reset preference is retained as the initial setting. **Reset** clears the current account's counts after confirmation. **Daily reset** resets those counts at the next local midnight, or on the next visit if Chrome was closed.

## Releases

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`feat:`, `fix:`, `docs:`, etc.). CI checks every PR and pushes to `develop` and `main`. On `main`, semantic-release calculates the next semantic version, updates `package.json` and `manifest.json`, packages the extension, creates a Git tag, and attaches the ZIP to a GitHub Release.

Chrome Web Store publication is prepared through the [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api). Initial setup is required:

1. Create the extension item in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), complete its listing and privacy fields, and upload the first version manually if the API does not yet accept updates to the item.
2. Enable two-step verification on the publishing Google account. Enable the Chrome Web Store API in Google Cloud and obtain OAuth client credentials and a refresh token as described in Google's guide.
3. Add repository or `chrome-web-store` environment secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, and `CWS_EXTENSION_ID`. Add the repository variable `CWS_ENABLED=true` once the item is ready.
4. Each new GitHub Release then dispatches the publication workflow. A failed Chrome submission can be retried with the workflow's manual `tag` input. Store review and final availability remain controlled by Google.

Do not commit credentials. The GitHub repository must be public before using its `PRIVACY.md` URL as the Store privacy policy URL.

## Validation limits

Collection checks cover distinct possession IDs and variants, ambiguous titles, interrupted loading and restoration, bounded server retries, account changes, native mutation notifications, changed totals and duplicate IDs across pages. Chrome verification loaded all 240 copies across five pages, restored a traversal interrupted by a reload at 200 copies, and resumed it to completion. A native favorite change invalidated the index and triggered synchronization; the favorite was then restored to its original state. Live sales and accepted trades have not been executed as part of this verification.

Selection/action tests cover all pages, retained quantities, default protections, manual adjustments, changed snapshots, account changes, lock contention, in-flight stop, per-copy rejection and uncertain outcomes/journal restoration. Live selection and preview were checked across all collection pages, including exact rarity totals after explicitly disabling unique-copy retention. A confirmed native discard succeeded, updated the game collection and balance, and restored its successful receipt after the automatic reload. The complete index then resynchronized.

The automated checks validate the build, package, API interception, manual limits, account-specific statistics, shared scheduling, mocked pack opening, and daily statistics reset. The extension was also loaded in Chrome and checked on signed-in collection, marketplace detail, and pack pages. Automatic opening and a one-pack manual run have been verified on the live game. The manual run updated account-specific statistics and kept its summary after the game's pack counter refreshed from 5 to 4 on reload. The game's price requests can fail temporarily during busy periods, so affected cards display “Price unavailable” and retry after one minute. A supported way to refresh the game's on-page pack counter without reloading was not found, so the extension retains the page reload after opening packs.

## License

MIT. See [LICENSE](LICENSE).
