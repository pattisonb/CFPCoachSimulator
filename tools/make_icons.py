"""Draw the site icon (a football on the navy tile) and write every size the site uses.

Writes web/favicon.svg, web/favicon.ico, web/icons/icon-192.png, icon-512.png,
apple-touch-icon.png and web/icons/og-image.png (the link preview for chats and social
posts). Run from anywhere: python tools/make_icons.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
ICONS = WEB / "icons"

NAVY, NAVY_DEEP, AMBER, WHITE = "#131a2e", "#0b1020", "#f5b942", "#ffffff"
NAME = "CFP Coach Simulator"
TAGLINE = "Sim any game, any season, or follow the real 2026 one"
TILT = -38            # degrees; the ball leans up to the right
BALL_L, BALL_H = 25.0, 14.5   # half length and half height on the 64-unit tile


def ball_outline(n: int = 48) -> list[tuple[float, float]]:
    """A pointed football: y = H * (1 - t^2)^0.8 for t in -1..1, mirrored."""
    top = [(BALL_L * t, -BALL_H * (1 - t * t) ** 0.8) for t in (i / n * 2 - 1 for i in range(n + 1))]
    return top + [(x, -y) for x, y in reversed(top[1:-1])]


def rot(p: tuple[float, float], cx: float = 32, cy: float = 32) -> tuple[float, float]:
    a = math.radians(TILT)
    x, y = p
    return cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)


LACES = [((-7.5, 0), (7.5, 0))] + [((x, -2.6), (x, 2.6)) for x in (-5, -1.7, 1.7, 5)]


def svg() -> str:
    pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in ball_outline())
    stripes = "".join(f'<rect x="{x - 1.6:.2f}" y="-15" width="3.2" height="30" fill="{NAVY}" clip-path="url(#b)"/>' for x in (-17, 17))
    laces = "".join(f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}"/>' for a, b in LACES)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            f'<rect width="64" height="64" rx="14" fill="{NAVY}"/>'
            f'<g transform="translate(32 32) rotate({TILT})">'
            f'<clipPath id="b"><polygon points="{pts}"/></clipPath>'
            f'<polygon points="{pts}" fill="{AMBER}"/>{stripes}'
            f'<g stroke="{WHITE}" stroke-width="2.2" stroke-linecap="round">{laces}</g></g></svg>\n')


def tile(size: int, rounded: bool = True) -> Image.Image:
    """The icon at `size` pixels, drawn at 4x and scaled down for smooth edges."""
    k = size * 4 / 64
    img = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=14 * k, fill=NAVY)
    else:
        d.rectangle((0, 0, size * 4, size * 4), fill=NAVY)

    def s(p: tuple[float, float]) -> tuple[float, float]:   # ball coordinates -> pixels
        x, y = rot(p)
        return x * k, y * k

    d.polygon([s(p) for p in ball_outline()], fill=AMBER)
    # stripes: draw the band, then trim it back to the ball by redrawing outside in navy
    ball = Image.new("L", img.size, 0)
    ImageDraw.Draw(ball).polygon([s(p) for p in ball_outline()], fill=255)
    bands = Image.new("L", img.size, 0)
    for x in (-17, 17):
        ImageDraw.Draw(bands).polygon([s(p) for p in [(x - 1.6, -16), (x + 1.6, -16), (x + 1.6, 16), (x - 1.6, 16)]], fill=255)
    img.paste(Image.new("RGBA", img.size, NAVY), (0, 0), ImageChops.multiply(ball, bands))
    for a, b in LACES:
        d.line([s(a), s(b)], fill=WHITE, width=max(1, round(2.2 * k)))
        for p in (a, b):
            x, y = s(p)
            r = 1.1 * k
            d.ellipse((x - r, y - r, x + r, y + r), fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def og_image() -> Image.Image:
    """1200x630 link preview: the icon, the name and the tagline on the navy field."""
    img = Image.new("RGB", (1200, 630), NAVY_DEEP)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 600, 1200, 630), fill=AMBER)
    icon = tile(260)
    img.paste(icon, (110, 170), icon)
    fonts = Path("C:/Windows/Fonts")
    def font(name: str, size: int):
        try:
            return ImageFont.truetype(str(fonts / name), size)
        except OSError:
            return ImageFont.load_default(size)
    d.text((420, 215), NAME, font=font("segoeuib.ttf", 64), fill=WHITE)
    d.text((422, 305), TAGLINE, font=font("segoeui.ttf", 30), fill="#c9d1e6")
    d.text((422, 360), "138 FBS teams · real schedules · playoff, bowls and polls", font=font("segoeui.ttf", 26), fill=AMBER)
    return img


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    (WEB / "favicon.svg").write_text(svg(), encoding="utf-8")
    tile(64).save(WEB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    for n in (192, 512):
        tile(n).save(ICONS / f"icon-{n}.png")
    tile(180, rounded=False).save(ICONS / "apple-touch-icon.png")   # iOS rounds the corners itself
    og_image().save(ICONS / "og-image.png", optimize=True)
    print("wrote", ", ".join(str(p.relative_to(ROOT)) for p in [WEB / "favicon.svg", WEB / "favicon.ico", *sorted(ICONS.glob("*.png"))]))


if __name__ == "__main__":
    main()
