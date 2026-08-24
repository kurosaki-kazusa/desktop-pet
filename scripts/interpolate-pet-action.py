"""Create a non-destructive 2x frame-rate test for a pet action.

The interpolator uses premultiplied-alpha blending so transparent edges do not
develop dark halos. Original frames are copied onto one centered canvas, and
the output is written to a sibling directory instead of replacing the source.
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PET_ACTIONS = ROOT / "assets" / "pet-actions"


def centered_canvas(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (size[0] - image.width) // 2
    y = size[1] - image.height
    canvas.alpha_composite(image.convert("RGBA"), (x, y))
    return canvas


def premultiplied_midpoint(first: Image.Image, second: Image.Image) -> Image.Image:
    """Blend RGBA frames without pulling transparent RGB toward black."""
    first = first.convert("RGBA")
    second = second.convert("RGBA")
    output = Image.new("RGBA", first.size, (0, 0, 0, 0))
    first_pixels = first.load()
    second_pixels = second.load()
    output_pixels = output.load()

    for y in range(first.height):
        for x in range(first.width):
            r1, g1, b1, a1 = first_pixels[x, y]
            r2, g2, b2, a2 = second_pixels[x, y]
            alpha = (a1 + a2) / 2
            if alpha <= 0:
                continue
            output_pixels[x, y] = (
                round((r1 * a1 + r2 * a2) / (a1 + a2)),
                round((g1 * a1 + g2 * a2) / (a1 + a2)),
                round((b1 * a1 + b2 * a2) / (a1 + a2)),
                round(alpha),
            )
    return output


def label_frame(frame: Image.Image, label: str, panel_size: tuple[int, int]) -> Image.Image:
    panel = Image.new("RGBA", panel_size, (11, 22, 48, 255))
    draw = ImageDraw.Draw(panel)
    draw.text((12, 10), label, fill=(245, 242, 240, 255), font=ImageFont.load_default())
    x = (panel.width - frame.width) // 2
    y = panel.height - frame.height - 10
    panel.alpha_composite(frame, (x, y))
    return panel


def build_comparison(
    originals: list[Image.Image],
    interpolated: list[Image.Image],
    output_path: Path,
    duration_ms: int,
) -> None:
    panel_size = (230, 226)
    timeline_ms = duration_ms * len(interpolated)
    frames = []
    for tick in range(len(interpolated)):
        elapsed = tick * duration_ms
        original_index = min(len(originals) - 1, elapsed // (timeline_ms // len(originals)))
        left = label_frame(originals[original_index], "ORIGINAL / 4 FRAMES", panel_size)
        right = label_frame(interpolated[tick], "INTERPOLATED / 8 FRAMES", panel_size)
        canvas = Image.new("RGBA", (panel_size[0] * 2, panel_size[1]), (0, 0, 0, 0))
        canvas.alpha_composite(left, (0, 0))
        canvas.alpha_composite(right, (panel_size[0], 0))
        frames.append(canvas)
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        lossless=True,
        method=6,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="action-04")
    parser.add_argument("--output", default="action-04-interpolated")
    parser.add_argument("--frame-ms", type=int, default=130)
    args = parser.parse_args()

    source_dir = PET_ACTIONS / args.source
    output_dir = PET_ACTIONS / args.output
    source_paths = sorted(source_dir.glob("frame-*.png"))
    if len(source_paths) < 2:
        raise SystemExit(f"Need at least two source frames in {source_dir}")

    source_images = [Image.open(path).convert("RGBA") for path in source_paths]
    canvas_size = (
        max(176, *(image.width for image in source_images)),
        max(196, *(image.height for image in source_images)),
    )
    originals = [centered_canvas(image, canvas_size) for image in source_images]

    interpolated: list[Image.Image] = []
    for index in range(len(originals) - 1):
        interpolated.append(originals[index])
        interpolated.append(premultiplied_midpoint(originals[index], originals[index + 1]))
    interpolated.append(originals[-1])
    # Keep the original 260 ms rest at the end while using a fixed 130 ms timer.
    interpolated.append(originals[-1].copy())

    output_dir.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(interpolated, start=1):
        frame.save(output_dir / f"frame-{index:02d}.png", optimize=True)

    interpolated[0].save(
        output_dir / "preview.webp",
        save_all=True,
        append_images=interpolated[1:],
        duration=args.frame_ms,
        loop=0,
        lossless=True,
        method=6,
    )
    build_comparison(originals, interpolated, output_dir / "comparison.webp", args.frame_ms)

    manifest = {
        "source": args.source,
        "method": "premultiplied-alpha midpoint interpolation",
        "sourceFrames": len(originals),
        "outputFrames": len(interpolated),
        "frameMs": args.frame_ms,
        "sourceDurationMs": 1040,
        "outputDurationMs": len(interpolated) * args.frame_ms,
        "canvas": {"width": canvas_size[0], "height": canvas_size[1]},
        "nonDestructive": True,
        "files": [f"frame-{index:02d}.png" for index in range(1, len(interpolated) + 1)],
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
