"""Crop transparent padding from sticker PNGs in place, keeping a 4px margin."""
from pathlib import Path
from PIL import Image

STICKERS_DIR = Path(__file__).resolve().parent.parent / "public" / "stickers"
MARGIN = 4


def main():
    results = []
    for png_path in sorted(STICKERS_DIR.rglob("*.png")):
        img = Image.open(png_path).convert("RGBA")
        orig_size = img.size
        bbox = img.getbbox()

        if bbox is None:
            results.append((png_path, orig_size, orig_size, "skipped (fully transparent)"))
            continue

        left, top, right, bottom = bbox
        if (left, top, right, bottom) == (0, 0, orig_size[0], orig_size[1]):
            results.append((png_path, orig_size, orig_size, "skipped (no padding to trim)"))
            continue

        left = max(0, left - MARGIN)
        top = max(0, top - MARGIN)
        right = min(orig_size[0], right + MARGIN)
        bottom = min(orig_size[1], bottom + MARGIN)

        cropped = img.crop((left, top, right, bottom))
        cropped.save(png_path, format="PNG")
        results.append((png_path, orig_size, cropped.size, "cropped"))

    rel = lambda p: p.relative_to(STICKERS_DIR)
    name_w = max((len(str(rel(p))) for p, *_ in results), default=20)

    print(f"{'file':{name_w}}  {'orig':>11}  {'new':>11}  status")
    for path, orig, new, status in results:
        print(f"{str(rel(path)):{name_w}}  {orig[0]:>4}x{orig[1]:<5}  {new[0]:>4}x{new[1]:<5}  {status}")

    cropped_count = sum(1 for *_, status in results if status == "cropped")
    print(f"\n{cropped_count}/{len(results)} files cropped")


if __name__ == "__main__":
    main()
