# WikiMasters Toolbox

A Chrome extension for [WikiMasters](https://www.wiki-masters.com/) focused on two features:

- Average sale prices on cards in the collection, marketplace detail pages, and pack views.
- Optional automatic opening of available packs at a configurable interval.

The extension is independent of WikiMasters. It uses only the game's own API and stores price cache and automation preferences in the browser. Automatic opening is **off by default** and consumes available packs when enabled.

## Development

Requirements: Node.js 24 and pnpm 12.4.2.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package
```

Load the `dist/` directory in `chrome://extensions/` after enabling Developer mode. Reload the extension and the WikiMasters tab after each build. The ZIP in `artifacts/` is intended for the Chrome Web Store.

The source lives in `src/`. TypeScript compiles to `dist/network.js` and `dist/content.js`. Tailwind CSS uses the `wm:` prefix and omits Preflight. Its output is embedded in `content.js` and applied only inside the extension's shadow roots, leaving the game's styles untouched. The packaged extension contains the two scripts, icons, and `manifest.json`.

## Usage

Average prices appear when supported card data is available on collection, marketplace detail, and pack pages. Prices are cached for 24 hours; temporary errors are cached for one minute. On `/pulls`, the Toolbox panel lets you enable automatic opening and set a minimum and maximum delay in minutes. Keep a WikiMasters tab open for the schedule to run. Only one tab opens packs at a time. Each cycle stops after 100 packs or when the game reports that none remain. Turn the toggle off to stop an active cycle.

## Releases

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`feat:`, `fix:`, `docs:`, etc.). CI checks every PR and pushes to `develop` and `main`. On `main`, semantic-release calculates the next semantic version, updates `package.json` and `manifest.json`, packages the extension, creates a Git tag, and attaches the ZIP to a GitHub Release.

Chrome Web Store publication is prepared through the [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api). Initial setup is required:

1. Create the extension item in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), complete its listing and privacy fields, and upload the first version manually if the API does not yet accept updates to the item.
2. Enable two-step verification on the publishing Google account. Enable the Chrome Web Store API in Google Cloud and obtain OAuth client credentials and a refresh token as described in Google's guide.
3. Add repository or `chrome-web-store` environment secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, and `CWS_EXTENSION_ID`. Add the repository variable `CWS_ENABLED=true` once the item is ready.
4. Each new GitHub Release then dispatches the publication workflow. A failed Chrome submission can be retried with the workflow's manual `tag` input. Store review and final availability remain controlled by Google.

Do not commit credentials. The GitHub repository must be public before using its `PRIVACY.md` URL as the Store privacy policy URL.

## Validation limits

The automated checks validate the build, package, API interception, and mocked pack opening. The extension was also loaded in Chrome and checked on signed-in collection, marketplace detail, and pack pages. The game's price requests can fail temporarily during busy periods, so affected cards display “Price unavailable” and retry after one minute. No packs were available during the browser test; automatic opening still needs a live check before the first public release.

## License

MIT. See [LICENSE](LICENSE).
