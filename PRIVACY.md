# Privacy policy — WikiMasters Toolbox

Last updated: October 4, 2026.

WikiMasters Toolbox runs only on `https://www.wiki-masters.com/`. It reads catalogue identifiers, titles, rarity and shiny status from collection, catalogue, marketplace, trade and peer-collection responses to display price references. It observes the game's native fetch/XHR responses without changing their requests or responses. For catalogue pages restored without a network request, it reads public card metadata from the game's tab cache and ignores ownership and friend fields. Card identities stay in memory while the page is open; no full collection index is saved.

The extension sends only GET requests to allowlisted WikiMasters price-summary and page-data endpoints, using the browser's existing game session. Visible-card price reads and page hydration can run automatically; targeted and batch refreshes are also available. Reads share deduplication, a 200-request hourly budget per tab, spacing, timeouts, cancellation and server pauses. The hourly request timestamps and server pauses are stored in tab session storage. No Toolbox request changes game state.

Average prices and fetch timestamps are stored in the site's local browser storage and shared between accounts because these market references are public. A successful summary is reused for 24 hours; failed reads have a one-minute retry delay. Entries are retained for up to 30 days, bounded to 1,000 catalogue IDs and 2 MB. A failed refresh preserves the original successful price and timestamp. Successful reads record one observation per rarity per UTC day for up to 90 days, bounded to 300 catalogue IDs and 8 MB. These observations contain only catalogue ID, rarity, checked time, and average or absence of sales; they are not a market sales history.

The detected account ID scopes concluded-sale samples and price alerts. Account changes cancel relevant work and clear personal in-memory state. Explicitly concluded sales observed in freely available native market history or visited listings store only auction ID, catalogue ID, exact rarity, shiny status, final amount and end time. Samples cover 30 days and at most 1,000 sales per account; sample caches are bounded to ten accounts and 2 MB. Seller and buyer identities are not stored.

Price alerts store up to 50 rules per account: catalogue ID, rarity, threshold in W, crossing direction, previous observed average and observation time. Up to 100 notifications are retained for 30 days. Rules persist until deleted or site data is cleared. Alerts use successful fresh price reads only, with no extra polling requests. Listing comparisons stay in memory and retain only price-related fields, never seller or buyer details. The panel's collapsed state is stored locally.

**Données et caches** displays synchronization times and storage size and lets you clear shared summaries, shared price observations and the current account's concluded-sale sample separately. Price alerts and their notifications can be deleted in **Prix**. Clearing WikiMasters site data removes all locally stored Toolbox data.

The extension does not read or store credentials, authentication headers, cookies, session tokens or challenge tokens. It stores no gameplay settings or action journals and does not access other websites or browsing history. No analytics, advertising or developer-operated backend is used. The developer receives none of the requests or account data.

Toolbox is an independent project, not approved by WikiMasters. Its automated price reads and native response observation must not be presented as officially authorized by the game.

For questions, open an issue in the [project repository](https://github.com/henchoznoe/WikiMasters-Toolbox/issues) without including credentials or account data.
