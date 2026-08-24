"""Rebuild derived Firefly UI review assets after motif decisions.

Source cut-outs stay untouched. This script only rebuilds the composite header
ornament and contact sheet; the rejected diamond-mark is intentionally absent.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
THEME = ROOT / "assets" / "ui-theme" / "firefly"
ORNAMENTS = THEME / "ornaments"
PARTICLES = THEME / "particles"
PREVIEW = THEME / "preview"


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    copy = image.copy()
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    return copy


def with_opacity(image: Image.Image, opacity: float) -> Image.Image:
    copy = image.convert("RGBA")
    alpha = copy.getchannel("A").point(lambda value: round(value * opacity))
    copy.putalpha(alpha)
    return copy


def paste_center(canvas: Image.Image, image: Image.Image, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    fitted = contain(image, (x1 - x0, y1 - y0))
    x = x0 + (x1 - x0 - fitted.width) // 2
    y = y0 + (y1 - y0 - fitted.height) // 2
    canvas.alpha_composite(fitted, (x, y))


def build_header() -> Image.Image:
    canvas = Image.new("RGBA", (1024, 160), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Low-contrast energy arcs replace the rejected central badge.
    draw.arc((28, 44, 820, 246), 191, 347, fill=(84, 215, 215, 105), width=2)
    draw.arc((148, 54, 914, 224), 190, 344, fill=(238, 175, 73, 68), width=1)
    draw.line((38, 116, 640, 116), fill=(127, 207, 202, 35), width=1)

    accents = [
        ("firefly-cyan-64.png", (592, 60), 0.50),
        ("firefly-gold-32.png", (708, 40), 0.52),
        ("firefly-pink-32.png", (772, 92), 0.42),
    ]
    for filename, position, opacity in accents:
        particle = with_opacity(Image.open(PARTICLES / filename), opacity)
        canvas.alpha_composite(particle, position)

    wing = contain(Image.open(ORNAMENTS / "wing-ribbon.png").convert("RGBA"), (180, 150))
    canvas.alpha_composite(with_opacity(wing, 0.82), (828, 5))
    return canvas


def build_contact_sheet(header: Image.Image) -> Image.Image:
    sheet = Image.new("RGBA", (1600, 1240), (8, 18, 39, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    draw.text((54, 32), "FIREFLY UI THEME / IMPLEMENTED ASSET SET", fill=(245, 242, 240), font=font)
    draw.text((54, 56), "diamond-mark excluded by design decision", fill=(240, 147, 170), font=font)

    chat = Image.open(THEME / "backgrounds" / "chat-night.png").convert("RGBA")
    config = Image.open(THEME / "backgrounds" / "config-steel.png").convert("RGBA")
    chat = chat.resize((720, 405), Image.Resampling.LANCZOS)
    config = config.resize((720, 405), Image.Resampling.LANCZOS)
    sheet.alpha_composite(chat, (54, 96))
    sheet.alpha_composite(config, (826, 96))
    draw.text((54, 510), "CHAT NIGHT", fill=(84, 215, 215), font=font)
    draw.text((826, 510), "CONFIG STEEL", fill=(238, 175, 73), font=font)

    panels = [(54, 560, 420, 900), (440, 560, 806, 900), (826, 560, 1546, 900)]
    for box in panels:
        draw.rounded_rectangle(box, radius=22, fill=(245, 242, 240, 245), outline=(84, 215, 215, 110), width=2)

    wing = Image.open(ORNAMENTS / "wing-ribbon.png").convert("RGBA")
    chest = Image.open(ORNAMENTS / "chest-crystal.png").convert("RGBA")
    paste_center(sheet, wing, (90, 600, 384, 840))
    paste_center(sheet, chest, (476, 600, 770, 840))
    paste_center(sheet, header, (860, 630, 1512, 820))
    draw.text((72, 862), "WING + RIBBON", fill=(11, 22, 48), font=font)
    draw.text((458, 862), "CHEST CRYSTAL", fill=(11, 22, 48), font=font)
    draw.text((844, 862), "HEADER ORNAMENT", fill=(11, 22, 48), font=font)

    lower = (54, 930, 1546, 1188)
    draw.rounded_rectangle(lower, radius=22, fill=(28, 49, 72, 245), outline=(127, 207, 202, 100), width=2)
    pattern = with_opacity(Image.open(THEME / "patterns" / "diamond-tile.png"), 0.28)
    pattern = pattern.resize((250, 250), Image.Resampling.LANCZOS)
    sheet.alpha_composite(pattern, (86, 934))
    draw.text((86, 1154), "LOW-CONTRAST TILE", fill=(245, 242, 240), font=font)

    particle_files = [
        "firefly-cyan-32.png", "firefly-cyan-64.png",
        "firefly-gold-32.png", "firefly-gold-64.png",
        "firefly-pink-32.png", "firefly-pink-64.png",
    ]
    x = 430
    for filename in particle_files:
        particle = Image.open(PARTICLES / filename).convert("RGBA")
        display = contain(particle, (96, 96))
        sheet.alpha_composite(display, (x, 1008 + (96 - display.height) // 2))
        x += 160
    draw.text((430, 1154), "CYAN / GOLD / PINK FIREFLY PARTICLES", fill=(245, 242, 240), font=font)
    return sheet


def main() -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    header = build_header()
    header.save(ORNAMENTS / "header-ornament.png", optimize=True)
    build_contact_sheet(header).convert("RGB").save(PREVIEW / "contact-sheet.png", optimize=True)


if __name__ == "__main__":
    main()
