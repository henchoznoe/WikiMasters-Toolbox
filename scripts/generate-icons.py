"""Generate the extension's minimal WM icon without external dependencies."""

from math import hypot
from pathlib import Path
from struct import pack
from zlib import compress, crc32

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "icons"
POINTS = [(34, 46), (47, 83), (61, 58), (75, 83), (88, 46)]


def segment_distance(x, y, start, end):
    ax, ay = start
    bx, by = end
    length_squared = (bx - ax) ** 2 + (by - ay) ** 2
    progress = max(0.0, min(1.0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length_squared))
    return hypot(x - (ax + progress * (bx - ax)), y - (ay + progress * (by - ay)))


def color_at(x, y):
    cx = max(38, min(90, x))
    cy = max(38, min(90, y))
    if hypot(x - cx, y - cy) > 22:
        return (0, 0, 0, 0)

    distance = min(segment_distance(x, y, first, second) for first, second in zip(POINTS, POINTS[1:]))
    if distance <= 4.5:
        return (190, 245, 255, 255)

    shade = (x + y - 32) / 192
    return (round(12 + 15 * shade), round(27 + 27 * shade), round(62 + 48 * shade), 255)


def chunk(kind, data):
    return pack(">I", len(data)) + kind + data + pack(">I", crc32(kind + data))


def create_icon(size):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples = [
                color_at((x + (sx + 0.5) / 4) * 128 / size, (y + (sy + 0.5) / 4) * 128 / size)
                for sy in range(4)
                for sx in range(4)
            ]
            alpha = sum(sample[3] for sample in samples) / 16
            if alpha == 0:
                rows.extend((0, 0, 0, 0))
                continue
            for channel in range(3):
                premultiplied = sum(sample[channel] * sample[3] for sample in samples)
                rows.append(round(premultiplied / (16 * alpha)))
            rows.append(round(alpha))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", compress(bytes(rows), level=9))
    png += chunk(b"IEND", b"")
    (OUTPUT / f"icon-{size}.png").write_bytes(png)


if __name__ == "__main__":
    OUTPUT.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        create_icon(size)
