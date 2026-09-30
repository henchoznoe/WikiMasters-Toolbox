# Roadmap

The current Packs Toolbox covers average card prices, manual and automatic pack opening, rarity statistics, and local daily resets. The panel has a shared shell so future pages can provide their own controls and page label.

## Before the next release

- Verify manual bulk opening and the remaining-pack refresh with a signed-in account that has an authorized number of packs available.
- Review the Chrome Web Store listing and privacy disclosures for the new features.
- Merge the feature through `develop`, then release from `main` when ready.

## Packs improvements

1. Keep statistics separate for each WikiMasters account in the same browser profile. Switching accounts currently combines their counts.
2. Let a manual run stop after a user-selected number of packs. This gives users more control when many packs are available.
3. Preserve a short result summary after the page reloads, including the number of packs opened and any error or stop reason.
4. Coordinate automatic schedules across open tabs, in addition to the existing opening lock, so only one tab owns the next scheduled attempt.
5. Review whether the game's remaining-pack counter can be refreshed without a full page reload, using a supported game update path if one becomes available.
6. Style the six rarity statistic tiles with the corresponding card colors and subtle decorative details, while keeping counts readable and accessible.

## Other pages

- Add a page-specific Toolbox section only when it offers a useful action or information. Collection and marketplace price controls are candidates.
- Improve card identification when multiple rarities share the same title.
- Add a manual retry action for failed price requests if temporary game errors remain common.
