# WikiMasters Toolbox

A Chrome extension for [WikiMasters](https://www.wiki-masters.com/) focused on card prices and packs:

- Average sale prices on cards in the collection, marketplace detail pages, and pack views.
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

`src/content.ts` handles startup and page events. The `src/content/` modules separate prices, pack opening, statistics, and the panel UI. `src/content/routes.ts` lists the pages that have a Toolbox panel. Each page supplies its label, route match, content, and optional mount or cleanup hooks; `src/content/panel.ts` supplies the shared **Toolbox** header and show/hide behavior. Add future page panels through this registry rather than placing their controls in the entry script. The extension currently shows a panel only on `/pulls`.

## Usage

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

The automated checks validate the build, package, API interception, manual limits, account-specific statistics, shared scheduling, mocked pack opening, and daily statistics reset. The extension was also loaded in Chrome and checked on signed-in collection, marketplace detail, and pack pages. Automatic opening and a one-pack manual run have been verified on the live game. The manual run updated account-specific statistics and kept its summary after the game's pack counter refreshed from 5 to 4 on reload. The game's price requests can fail temporarily during busy periods, so affected cards display “Price unavailable” and retry after one minute. A supported way to refresh the game's on-page pack counter without reloading was not found, so the extension retains the page reload after opening packs.

## License

MIT. See [LICENSE](LICENSE).
