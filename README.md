# WikiMasters Toolbox

A Chrome extension for [WikiMasters](https://www.wiki-masters.com/) focused on card prices and packs:

- Average sale prices on cards in the collection, marketplace detail pages, and pack views.
- Optional automatic opening of available packs at a configurable interval.
- A manual action to open all available packs and local statistics by card rarity.

The extension is independent of WikiMasters. It uses only the game's own API and stores the price cache, automation preferences, and pack statistics in the browser. Automatic opening is **off by default** and consumes available packs when enabled.

## Development

Requirements: Node.js 24 and pnpm 12.4.2.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package
```

Load the `dist/` directory in `chrome://extensions/` after enabling Developer mode. Reload the extension and the WikiMasters tab after each build. The ZIP in `artifacts/` is intended for the Chrome Web Store.

The source lives in `src/`. TypeScript compiles to `dist/network.js` and `dist/content.js`. The small stylesheet in `src/toolbox.css` is embedded in `content.js` and applied only inside the extension's shadow roots, leaving the game's styles untouched. The packaged extension contains the two scripts, icons, and `manifest.json`.

## Usage

Average prices appear when supported card data is available on collection, marketplace detail, and pack pages. Prices are cached for 24 hours; temporary errors are cached for one minute.

On `/pulls`, **Open all available packs** asks for confirmation, then opens packs one at a time without the game's animations. Use the same button to stop a manual run. The panel also lets you enable automatic opening and set a minimum and maximum delay in minutes. Keep a WikiMasters tab open for the schedule to run. Only one tab opens packs at a time. Each cycle stops after 100 packs or when the game reports that none remain. Run the manual action again if the 100-pack limit is reached with packs still available. Turn the automation toggle off to stop an automatic cycle.

Pack statistics count cards by rarity and packs opened through the game's normal button, the manual Toolbox button, and automatic opening. Counts are stored locally in this browser and start when this version is installed. **Reset counts** clears the counts after confirmation. **Daily reset** is off by default; when enabled, counts reset at the next local midnight, or on the next visit if Chrome was closed. Statistics are shared by WikiMasters accounts using the same browser profile.

## Releases

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`feat:`, `fix:`, `docs:`, etc.). CI checks every PR and pushes to `develop` and `main`. On `main`, semantic-release calculates the next semantic version, updates `package.json` and `manifest.json`, packages the extension, creates a Git tag, and attaches the ZIP to a GitHub Release.

Chrome Web Store publication is prepared through the [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api). Initial setup is required:

1. Create the extension item in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), complete its listing and privacy fields, and upload the first version manually if the API does not yet accept updates to the item.
2. Enable two-step verification on the publishing Google account. Enable the Chrome Web Store API in Google Cloud and obtain OAuth client credentials and a refresh token as described in Google's guide.
3. Add repository or `chrome-web-store` environment secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, and `CWS_EXTENSION_ID`. Add the repository variable `CWS_ENABLED=true` once the item is ready.
4. Each new GitHub Release then dispatches the publication workflow. A failed Chrome submission can be retried with the workflow's manual `tag` input. Store review and final availability remain controlled by Google.

Do not commit credentials. The GitHub repository must be public before using its `PRIVACY.md` URL as the Store privacy policy URL.

## Validation limits

The automated checks validate the build, package, API interception, mocked pack opening, and daily statistics reset. The extension was also loaded in Chrome and checked on signed-in collection, marketplace detail, and pack pages. Automatic pack opening has been verified on the live game. The game's price requests can fail temporarily during busy periods, so affected cards display “Price unavailable” and retry after one minute.

## License

MIT. See [LICENSE](LICENSE).
