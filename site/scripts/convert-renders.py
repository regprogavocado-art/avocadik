"""Prepare owner-generated category originals for the site. Never enlarge originals."""
from pathlib import Path
import argparse
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
NAMES = ["category-domains", "category-vps", "category-dedicated", "category-bulletproof", "category-proxies"]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("names", nargs="*", choices=NAMES)
args = parser.parse_args()
for name in args.names or NAMES:
    source = ROOT / "assets" / "renders" / (name + ".png")
    if not source.is_file():
        print(f"Waiting for {source.name}")
        continue
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        for suffix, width, quality in [("", 1600, 86), ("-640", 640, 82)]:
            output = ROOT / "assets" / "img" / (name + suffix + ".webp")
            copy = image.copy()
            if copy.width > width:
                copy.resize((width, round(copy.height * width / copy.width)), Image.Resampling.LANCZOS).save(output, "WEBP", quality=quality, method=6)
            else:
                copy.save(output, "WEBP", quality=quality, method=6)
            print(f"Saved {output.name} ({output.stat().st_size:,} bytes)")

