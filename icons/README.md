# Logo assets

`toolbox-logo.png` is the source artwork for the card-price logo. The four
`icon-*.png` files are checked-in RGB PNG exports used by the Chrome manifest,
the README and the Chrome Web Store (128 px).

To regenerate the exports, run `python3 scripts/generate-icons.py` with Pillow
installed in your Python environment. Icon generation is a manual asset task;
the normal Node build and release workflows use the checked-in exports.
