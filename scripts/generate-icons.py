"""Generate Nexy's desktop and Android launcher assets from one pixel-grid mark.

The source artwork is authored on a 32x32 logical grid and is only ever scaled
with nearest-neighbour sampling. This keeps the mark crisp at 16 px while also
making the 1024 px store/source asset deterministic.

Usage:
    python scripts/generate-icons.py
    python scripts/generate-icons.py --check
"""

from __future__ import annotations

import argparse
import io
import json
import struct
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "resources"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
THEME_PATH = ROOT / "design" / "nexy-8bit-theme.json"

GRID_SIZE = 32
DESKTOP_SIZES = (16, 32, 48, 64, 128, 256)
ANDROID_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def rgba(hex_color: str) -> tuple[int, int, int, int]:
    value = hex_color.removeprefix("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4)) + (255,)


def load_palette() -> dict[str, tuple[int, int, int, int]]:
    theme = json.loads(THEME_PATH.read_text(encoding="utf-8"))
    dark = theme["themes"]["dark"]
    return {
        "frame": rgba(dark["outerFrame"]),
        "surface": rgba(dark["surface"]),
        "edge": rgba(dark["highlightEdge"]),
        "accent": rgba(dark["accent"]),
        "ink": rgba(dark["onAccent"]),
    }


def stepped_tile(draw: ImageDraw.ImageDraw, palette: dict[str, tuple[int, int, int, int]], round_icon: bool) -> None:
    if round_icon:
        # A deliberately pixelated circle for launchers that still use legacy round assets.
        outline = [(9, 0), (22, 0), (22, 1), (26, 1), (26, 3), (29, 3), (29, 6),
                   (31, 6), (31, 9), (32, 9), (32, 22), (31, 22), (31, 26),
                   (29, 26), (29, 29), (26, 29), (26, 31), (22, 31), (22, 32),
                   (9, 32), (9, 31), (6, 31), (6, 29), (3, 29), (3, 26),
                   (1, 26), (1, 22), (0, 22), (0, 9), (1, 9), (1, 6),
                   (3, 6), (3, 3), (6, 3), (6, 1), (9, 1)]
        draw.polygon(outline, fill=palette["frame"])
        draw.rectangle((4, 7, 27, 24), fill=palette["surface"])
        draw.rectangle((7, 4, 24, 27), fill=palette["surface"])
        draw.rectangle((5, 5, 26, 26), fill=palette["surface"])
    else:
        outline = [(3, 0), (28, 0), (28, 1), (31, 1), (31, 4), (32, 4),
                   (32, 28), (31, 28), (31, 31), (28, 31), (28, 32),
                   (3, 32), (3, 31), (0, 31), (0, 28), (0, 4), (1, 4),
                   (1, 1), (3, 1)]
        draw.polygon(outline, fill=palette["frame"])
        draw.polygon([(4, 3), (27, 3), (29, 5), (29, 27), (27, 29),
                      (4, 29), (2, 27), (2, 5)], fill=palette["edge"])
        draw.polygon([(5, 4), (26, 4), (28, 6), (28, 26), (26, 28),
                      (5, 28), (3, 26), (3, 6)], fill=palette["surface"])


def draw_mark(draw: ImageDraw.ImageDraw, palette: dict[str, tuple[int, int, int, int]]) -> None:
    # Two block stems and a staircase diagonal: no fractional or antialiased geometry.
    accent = palette["accent"]
    draw.rectangle((7, 7, 10, 24), fill=accent)
    draw.rectangle((21, 7, 24, 24), fill=accent)
    for x, y in ((11, 8), (13, 10), (15, 12), (17, 14), (19, 16)):
        draw.rectangle((x, y, x + 3, y + 7), fill=accent)

    # Two light pixels retain the Command Office hard-highlight language at tiny sizes.
    draw.rectangle((7, 7, 8, 8), fill=palette["ink"])
    draw.rectangle((23, 23, 24, 24), fill=palette["ink"])


def source_icon(palette: dict[str, tuple[int, int, int, int]], round_icon: bool = False) -> Image.Image:
    image = Image.new("RGBA", (GRID_SIZE, GRID_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    stepped_tile(draw, palette, round_icon)
    draw_mark(draw, palette)
    return image


def scaled(source: Image.Image, size: int) -> Image.Image:
    return source.resize((size, size), Image.Resampling.NEAREST)


def png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=False, compress_level=9)
    return output.getvalue()


def ico_bytes(source: Image.Image) -> bytes:
    images = [scaled(source, size) for size in DESKTOP_SIZES]
    payloads = [png_bytes(image) for image in images]
    offset = 6 + len(payloads) * 16
    directory = bytearray()
    for image, payload in zip(images, payloads):
        size = image.width
        directory.extend(struct.pack("<BBBBHHII", size if size < 256 else 0,
                                     size if size < 256 else 0, 0, 0, 1, 32,
                                     len(payload), offset))
        offset += len(payload)
    return struct.pack("<HHH", 0, 1, len(payloads)) + bytes(directory) + b"".join(payloads)


def icns_bytes(source: Image.Image) -> bytes:
    entries = bytearray()
    for kind, size in ((b"ic08", 256), (b"ic09", 512), (b"ic10", 1024)):
        payload = png_bytes(scaled(source, size))
        entries.extend(kind + struct.pack(">I", len(payload) + 8) + payload)
    return b"icns" + struct.pack(">I", len(entries) + 8) + bytes(entries)


def webp_bytes(source: Image.Image, size: int) -> bytes:
    output = io.BytesIO()
    scaled(source, size).save(output, format="WEBP", lossless=True, method=6, exact=True)
    return output.getvalue()


def color_hex(color: tuple[int, int, int, int]) -> str:
    return "#" + "".join(f"{channel:02X}" for channel in color[:3])


def adaptive_background_bytes(palette: dict[str, tuple[int, int, int, int]]) -> bytes:
    return f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="{color_hex(palette["frame"])}"
        android:pathData="M0,0h108v108h-108z" />
</vector>
'''.encode("utf-8")


def adaptive_foreground_bytes(palette: dict[str, tuple[int, int, int, int]]) -> bytes:
    return f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <!-- Grid-authored N kept inside the adaptive-icon 66dp safe zone. The diagonal is a
         staircase of whole-dp blocks so launcher scaling does not soften the 8-bit silhouette. -->
    <path
        android:fillColor="{color_hex(palette["accent"])}"
        android:pathData="M34,32h8v44h-8z M66,32h8v44h-8z
                          M42,32h8v12h-8z M46,40h8v12h-8z M50,48h8v12h-8z
                          M54,56h8v12h-8z M58,64h8v12h-8z" />
</vector>
'''.encode("utf-8")


def expected_outputs() -> dict[Path, bytes]:
    palette = load_palette()
    standard = source_icon(palette)
    round_icon = source_icon(palette, round_icon=True)
    outputs = {
        RESOURCES / "icon.png": png_bytes(scaled(standard, 1024)),
        RESOURCES / "icon.ico": ico_bytes(standard),
        RESOURCES / "icon.icns": icns_bytes(standard),
        ANDROID_RES / "drawable" / "ic_launcher_background.xml": adaptive_background_bytes(palette),
        ANDROID_RES / "drawable" / "ic_launcher_foreground.xml": adaptive_foreground_bytes(palette),
    }
    for folder, size in ANDROID_DENSITIES.items():
        outputs[ANDROID_RES / folder / "ic_launcher.webp"] = webp_bytes(standard, size)
        outputs[ANDROID_RES / folder / "ic_launcher_round.webp"] = webp_bytes(round_icon, size)
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if generated assets are stale")
    args = parser.parse_args()
    outputs = expected_outputs()

    if args.check:
        stale = [path for path, data in outputs.items() if not path.exists() or path.read_bytes() != data]
        if stale:
            print("Stale launcher assets:")
            for path in stale:
                print(f"  {path.relative_to(ROOT)}")
            return 1
        print(f"Launcher assets are current ({len(outputs)} files).")
        return 0

    for path, data in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
            temporary.write(data)
            temporary_path = Path(temporary.name)
        temporary_path.replace(path)
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
