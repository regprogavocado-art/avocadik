"""Create responsive derivatives of approved renders; keep originals unchanged."""
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[2]
for name, widths in [('avocado-cutout', (640, 960)), ('rent-card', (768,))]:
    source = root / 'assets' / 'renders' / f'{name}.png'
    if not source.is_file():
        source = root / 'assets' / 'img' / f'{name}.webp'
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        image = image.convert('RGBA' if 'A' in image.getbands() else 'RGB')
        for width in widths:
            result = image.copy()
            result.thumbnail((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
            target = root / 'assets' / 'img' / f'{name}-{width}.webp'
            result.save(target, 'WEBP', quality=84, method=6)
            print(f'{target.name}: {target.stat().st_size:,} bytes')
