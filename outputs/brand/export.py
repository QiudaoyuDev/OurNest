"""Export OurNest brand PNGs. Requires cairosvg and Pillow; no app dependencies."""
from pathlib import Path
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent
SIZES = (24, 40, 64, 128, 256, 512, 1024)
RED = (240, 68, 47)
IVORY = (255, 249, 240)


def main():
    for name in (
        "our-nest-app-icon.svg",
        "our-nest-logo-transparent.svg",
        "our-nest-logo-reversed.svg",
    ):
        ET.parse(ROOT / name)

    for size in SIZES:
        icon_path = ROOT / f"our-nest-app-icon-{size}.png"
        cairosvg.svg2png(
            url=str(ROOT / "our-nest-app-icon.svg"),
            write_to=str(icon_path),
            output_width=size,
            output_height=size,
        )
        with Image.open(icon_path) as source:
            icon = source.convert("RGB")
        icon.save(icon_path)
        # Extract the warm-white mark's coverage from the green channel.
        # This preserves antialiasing and true transparent currency cutouts,
        # without depending on Cairo's unsupported luminance SVG masks.
        alpha = icon.getchannel("G").point(
            [max(0, min(255, round((v - RED[1]) * 255 / (IVORY[1] - RED[1])))) for v in range(256)]
        )
        for suffix, color in (("transparent", RED), ("reversed", IVORY)):
            mark = Image.new("RGBA", (size, size), color + (0,))
            mark.putalpha(alpha)
            mark.save(ROOT / f"our-nest-logo-{size}-{suffix}.png")

    for size in SIZES:
        with Image.open(ROOT / f"our-nest-app-icon-{size}.png") as image:
            assert image.size == (size, size)
            assert image.mode == "RGB"
            assert image.getpixel((0, 0)) == RED
        for suffix in ("transparent", "reversed"):
            with Image.open(ROOT / f"our-nest-logo-{size}-{suffix}.png") as image:
                assert image.size == (size, size)
                assert image.mode == "RGBA"
                assert image.getpixel((0, 0))[3] == 0
                assert image.getchannel("A").getextrema() == (0, 255)
                if size >= 256:
                    # Center of the currency's vertical stem must be cut out.
                    assert image.getpixel((size // 2, round(size * 95 / 256)))[3] == 0
    print("PASS: 3 SVG sources parsed; 21 PNGs exported; sizes, colors, opacity and cutouts verified.")


if __name__ == "__main__":
    main()
