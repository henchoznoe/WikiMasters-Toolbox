# Roadmap

The first public release is limited to average card prices and automatic pack opening. The earlier multi-feature extension was intentionally replaced with a smaller TypeScript codebase.

## Before publication

- Test collection cards, marketplace details, pack views, and automatic opening in a signed-in Chrome session.
- Confirm the game's current API response shapes and rate-limit behavior.
- Review the extension's controls on desktop and narrow screens.
- Create the Store listing, screenshots, privacy disclosures, and publisher credentials.
- Make the repository public and expose the privacy policy URL before Store submission.

## Later improvements

- Improve card identification when multiple rarities share the same title.
- Detect account changes and reset any account-specific automation state.
- Add a clear per-cycle history and a manual retry action for failed price requests.
- Review whether automatic opening should continue when the `/pulls` page is not visible.
