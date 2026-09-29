# Privacy policy — WikiMasters Toolbox

Last updated: September 29, 2026.

WikiMasters Toolbox runs only on `https://www.wiki-masters.com/`. It reads card identifiers, titles, and rarity from the game's collection, marketplace, and pack responses to display average sale prices. When automatic opening is enabled, it sends pack-opening requests to WikiMasters using the browser's existing game session. These requests consume available packs.

The extension stores average prices and fetch timestamps in the site's local browser storage. It reuses cached prices for 24 hours and cached price errors for one minute; old entries may remain until the site data is cleared. It also stores the automatic-opening toggle, chosen interval, and next scheduled time. Card and pack data are otherwise kept in memory while the page is open. No analytics, advertising, or developer-operated server is used.

The extension sends requests only to WikiMasters. The browser includes the existing WikiMasters session when requesting prices or opening packs. The developer does not receive these requests or the user's account data. The extension does not request access to other websites or browsing history.

To remove locally stored extension data, clear site data for `www.wiki-masters.com` in Chrome. You can disable automatic opening at any time with the toggle on the game's `/pulls` page.

For questions, open an issue at [github.com/henchoznoe/WikiMasters-Toolbox](https://github.com/henchoznoe/WikiMasters-Toolbox/issues).
