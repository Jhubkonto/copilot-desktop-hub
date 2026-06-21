"""
Generates all Nexy app icons from scratch:
  - resources/icon.png  (1024x1024, Linux / source)
  - resources/icon.ico  (multi-size, Windows)
  - resources/icon.icns (macOS)
  - Android mipmap WebPs for all densities (ic_launcher + ic_launcher_round)
"""

import os
import struct
import zlib
from PIL import Image, ImageDraw

# ── Design constants ──────────────────────────────────────────────────────────
BG_COLOR   = (26, 26, 46, 255)   # #1A1A2E  dark navy
N_COLOR    = (167, 139, 250, 255) # #A78BFA  soft purple

def draw_nexy_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG_COLOR)

    # Rounded-rect background clipping mask
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = size // 5
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    bg = Image.new("RGBA", (size, size), BG_COLOR)
    img = Image.composite(bg, Image.new("RGBA", (size, size), (0, 0, 0, 0)), mask)

    d = ImageDraw.Draw(img)

    # N geometry — proportional to icon size
    pad   = size * 0.19   # outer padding
    thick = size * 0.115  # bar thickness

    lx = pad                    # left bar left x
    rx = size - pad - thick     # right bar left x
    top = pad
    bot = size - pad

    # left vertical bar
    d.rectangle([lx, top, lx + thick, bot], fill=N_COLOR)
    # right vertical bar
    d.rectangle([rx, top, rx + thick, bot], fill=N_COLOR)
    # diagonal: polygon from top-left inner corner to bottom-right inner corner
    diag = [
        lx + thick, top,            # top-left of diagonal (right edge of left bar, top)
        lx + thick * 2, top,        # slightly right
        rx,          bot,            # bottom-left of right bar
        rx - thick,  bot,            # bottom-right offset
    ]
    # Draw diagonal as a filled polygon
    d.polygon(diag, fill=N_COLOR)

    return img


def make_ico(base_img: Image.Image, path: str):
    """Write a proper multi-size .ico (16,32,48,64,128,256)."""
    sizes = [16, 32, 48, 64, 128, 256]
    images = []
    for s in sizes:
        im = base_img.resize((s, s), Image.LANCZOS).convert("RGBA")
        images.append(im)

    # Build ICO manually so we get all sizes including 256
    ico_images = []
    for im in images:
        import io
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        ico_images.append(buf.getvalue())

    # ICO header + directory + image data
    count = len(ico_images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + count * 16
    directory = b""
    for i, data in enumerate(ico_images):
        s = images[i].size[0]
        w = s if s < 256 else 0
        h = s if s < 256 else 0
        directory += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        offset += len(data)

    with open(path, "wb") as f:
        f.write(header + directory)
        for data in ico_images:
            f.write(data)
    print(f"  wrote {path}")


def make_icns(base_img: Image.Image, path: str):
    """Write a minimal .icns with ic08 (256) and ic09 (512) and ic10 (1024)."""
    import io

    def icns_entry(ostype: bytes, im: Image.Image) -> bytes:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        png = buf.getvalue()
        return ostype + struct.pack(">I", len(png) + 8) + png

    entries = b""
    for ostype, size in [(b"ic08", 256), (b"ic09", 512), (b"ic10", 1024)]:
        im = base_img.resize((size, size), Image.LANCZOS)
        entries += icns_entry(ostype, im)

    total = 8 + len(entries)
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", total) + entries)
    print(f"  wrote {path}")


def make_webp(base_img: Image.Image, path: str, size: int):
    im = base_img.resize((size, size), Image.LANCZOS)
    im.save(path, format="WEBP", quality=95)
    print(f"  wrote {path}")


# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES      = os.path.join(ROOT, "resources")
ANDROID  = os.path.join(ROOT, "android", "app", "src", "main", "res")

os.makedirs(RES, exist_ok=True)

# ── Generate master 1024x1024 ─────────────────────────────────────────────────
print("Generating master icon...")
master = draw_nexy_icon(1024)

# ── Desktop icons ─────────────────────────────────────────────────────────────
print("Writing desktop icons...")
master.save(os.path.join(RES, "icon.png"))
print(f"  wrote {os.path.join(RES, 'icon.png')}")

make_ico(master, os.path.join(RES, "icon.ico"))
make_icns(master, os.path.join(RES, "icon.icns"))

# ── Android mipmap WebPs ──────────────────────────────────────────────────────
# Adaptive icon: foreground layer is 108dp with 72dp safe zone; legacy is 48dp
# Standard mipmap sizes for ic_launcher:
DENSITIES = {
    "mipmap-mdpi":    48,
    "mipmap-hdpi":    72,
    "mipmap-xhdpi":   96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
}

print("Writing Android mipmap WebPs...")
for folder, px in DENSITIES.items():
    dirpath = os.path.join(ANDROID, folder)
    os.makedirs(dirpath, exist_ok=True)
    make_webp(master, os.path.join(dirpath, "ic_launcher.webp"), px)
    make_webp(master, os.path.join(dirpath, "ic_launcher_round.webp"), px)

print("\nDone. All icons generated.")
