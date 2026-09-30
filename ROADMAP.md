# Roadmap

The first Chrome Web Store release contains average card prices and automatic pack opening. It has been submitted for review. The next release adds manual bulk opening, rarity statistics, and a cleaner interface.

## Next release

- Verify manual bulk opening with available packs in a signed-in Chrome session.
- Confirm the next release's Chrome Web Store listing and privacy disclosures.
- Merge the feature through `develop` after review, then release from `main`.

## Later improvements

- Improve card identification when multiple rarities share the same title.
- Detect account changes and reset any account-specific automation state.
- Add a clear per-cycle history and a manual retry action for failed price requests.
- Review whether automatic opening should continue when the `/pulls` page is not visible.
