# Roadmap

The current Packs Toolbox covers average card prices, manual and automatic pack opening, rarity statistics, and local daily resets. The panel has a shared shell so future pages can provide their own controls and page label.

## Before the next release

- Review the Chrome Web Store listing and privacy disclosures for the new features.
- Merge the feature through `develop`, then release from `main` when ready.

## Completed Packs improvements

1. Store pack and rarity counts separately for each detected WikiMasters account. Earlier shared counts remain in legacy browser storage because they cannot be divided reliably.
2. Offer an optional limit of 1–100 packs for each manual run. Leaving the field empty opens all available packs, up to the safety limit of 100.
3. Keep a compact, expandable run summary in the Toolbox across a page reload, including the number opened and the stop or error reason.
4. Share one automatic next-opening time across tabs. The existing browser lock chooses one tab to open packs; other tabs wait for its new schedule.
5. Reviewed the game's pack counter update path. No supported read endpoint or client refresh event is available to the extension, so a run that opens packs still reloads the page to update the game's own counter.
6. Style the six rarity statistic tiles with card-inspired colors and subtle decorative details while keeping counts readable.
7. Show cards and average sale prices from the last manual or automatic run in a compact, scrollable summary, with known prices sorted highest first.

## Future ideas

- Investigate isolated account profiles and quick switching, including separate sessions, preferences, and caches, while respecting the game's account rules.
- Show the freshness of each cached average price, using its saved calculation time (for example, “<1 min” or “>1 day”).

## Other pages

- Add a page-specific Toolbox section only when it offers a useful action or information. Collection and marketplace price controls are candidates.
- Improve card identification when multiple rarities share the same title.
- Add a manual retry action for failed price requests if temporary game errors remain common.
