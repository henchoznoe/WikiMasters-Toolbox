"""Export Chrome icons from the checked-in logo (requires Pillow)."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "icons"


if __name__ == "__main__":
    with Image.open(OUTPUT / "toolbox-logo.png") as source:
        logo = source.convert("RGB")
        for size in (16, 32, 48, 128):
            logo.resize((size, size), Image.Resampling.LANCZOS).save(
                OUTPUT / f"icon-{size}.png"
            )
