#!/usr/bin/env python3
"""Build preset avatar assets from square source images.

Input images stay square. The frontend owns circular clipping at render time.
This script only normalizes square sources and emits small WebP derivatives for
dense UI lists and avatar pickers.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


def natural_key(path: Path) -> list[int | str]:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", path.name)]


def resolve_path(config_dir: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else config_dir / path


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def checkerboard(width: int, height: int, cell: int = 16) -> Image.Image:
    image = Image.new("RGB", (width, height), (255, 255, 255))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            value = 238 if ((x // cell + y // cell) % 2 == 0) else 210
            pixels[x, y] = (value, value, value)
    return image.convert("RGBA")


def circle_mask(size: int) -> Image.Image:
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def load_square_source(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGB")
    if image.width != image.height:
        raise ValueError(f"{path} is {image.width}x{image.height}; avatar sources must be square")
    return image


def save_preview_square(source_paths: list[Path], preview_path: Path, tile_size: int) -> None:
    columns = min(4, len(source_paths))
    rows = (len(source_paths) + columns - 1) // columns
    preview = Image.new("RGB", (columns * tile_size, rows * tile_size), (250, 246, 238))
    for index, source_path in enumerate(source_paths):
        tile = Image.open(source_path).convert("RGB").resize((tile_size, tile_size), Image.Resampling.LANCZOS)
        preview.paste(tile, ((index % columns) * tile_size, (index // columns) * tile_size))
    preview.save(preview_path, optimize=True)


def save_preview_circle(source_paths: list[Path], preview_path: Path, tile_size: int) -> None:
    columns = min(4, len(source_paths))
    rows = (len(source_paths) + columns - 1) // columns
    preview = checkerboard(columns * tile_size, rows * tile_size)
    mask = circle_mask(tile_size)
    for index, source_path in enumerate(source_paths):
        tile = Image.open(source_path).convert("RGBA").resize((tile_size, tile_size), Image.Resampling.LANCZOS)
        tile.putalpha(mask)
        preview.alpha_composite(tile, ((index % columns) * tile_size, (index // columns) * tile_size))
    preview.save(preview_path)


def build_set(config_dir: Path, output_root: Path, defaults: dict[str, Any], set_config: dict[str, Any]) -> dict[str, Any]:
    raw_dir = resolve_path(config_dir, set_config["rawDir"])
    output_dir = output_root / set_config["outputDir"]
    prefix = set_config["prefix"]
    source_size = int(set_config.get("sourceSize", defaults["sourceSize"]))
    sizes = [int(size) for size in set_config.get("sizes", defaults["sizes"])]
    webp_quality = int(set_config.get("webpQuality", defaults["webpQuality"]))
    preview_tile_size = int(set_config.get("previewTileSize", defaults["previewTileSize"]))

    raw_paths = sorted(raw_dir.glob("*.png"), key=natural_key)
    if not raw_paths:
        raise ValueError(f"No PNG sources found in {raw_dir}")

    ensure_clean_dir(output_dir)
    ensure_clean_dir(output_dir / "source")
    for size in sizes:
        ensure_clean_dir(output_dir / str(size))

    items: list[dict[str, Any]] = []
    normalized_sources: list[Path] = []
    for index, raw_path in enumerate(raw_paths, start=1):
        image = load_square_source(raw_path)
        avatar_id = f"{prefix}-{index:02d}"
        source = image.resize((source_size, source_size), Image.Resampling.LANCZOS)
        source_path = output_dir / "source" / f"{avatar_id}.png"
        source.save(source_path, optimize=True)
        normalized_sources.append(source_path)

        derivative_paths: dict[str, str] = {}
        derivative_bytes: dict[str, int] = {}
        for size in sizes:
            derivative = source.resize((size, size), Image.Resampling.LANCZOS)
            derivative_dir = output_dir / avatar_id
            derivative_dir.mkdir(parents=True, exist_ok=True)
            derivative_path = derivative_dir / f"{size}.webp"
            derivative.save(derivative_path, format="WEBP", quality=webp_quality, method=6)
            derivative_paths[str(size)] = str(derivative_path.relative_to(output_dir))
            derivative_bytes[str(size)] = os.path.getsize(derivative_path)

        items.append(
            {
                "id": avatar_id,
                "raw": str(raw_path.relative_to(config_dir)),
                "source": str(source_path.relative_to(output_dir)),
                "sizes": derivative_paths,
                "byteSize": derivative_bytes,
            }
        )

    square_preview = output_dir / "preview-square-source.png"
    circle_preview = output_dir / "preview-frontend-circle-mask.png"
    save_preview_square(normalized_sources, square_preview, preview_tile_size)
    save_preview_circle(normalized_sources, circle_preview, preview_tile_size)

    manifest = {
        "generatedAt": defaults.get("generatedAt"),
        "assetModel": "square-source-frontend-circle-mask",
        "rawDir": str(raw_dir.relative_to(config_dir)),
        "outputDir": set_config["outputDir"],
        "sourceSize": source_size,
        "sizes": sizes,
        "webpQuality": webp_quality,
        "previews": {
            "squareSource": square_preview.name,
            "frontendCircleMask": circle_preview.name,
        },
        "notes": [
            "Raw and source avatar assets are square and opaque.",
            "Frontend should apply border-radius/overflow circular clipping at display time.",
            "Use 64.webp for dense lists, 128.webp for normal retina avatar display, and 256.webp for avatar picker/profile previews.",
        ],
        "items": items,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return {
        "key": set_config["key"],
        "manifest": str((output_dir / "manifest.json").relative_to(output_root)),
        "count": len(items),
        "outputDir": set_config["outputDir"],
    }


def build(config_path: Path) -> dict[str, Any]:
    config_dir = config_path.parent.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    output_root = resolve_path(config_dir, config.get("outputRoot", "."))
    output_root.mkdir(parents=True, exist_ok=True)
    defaults = {
        "sourceSize": config.get("sourceSize", 512),
        "sizes": config.get("sizes", [64, 128, 256]),
        "webpQuality": config.get("webpQuality", 86),
        "previewTileSize": config.get("previewTileSize", 192),
        "generatedAt": config.get("generatedAt"),
    }

    set_summaries = [build_set(config_dir, output_root, defaults, set_config) for set_config in config["sets"]]
    summary = {
        "generatedAt": defaults["generatedAt"],
        "outputRoot": str(output_root.relative_to(config_dir)) if output_root.is_relative_to(config_dir) else str(output_root),
        "sets": set_summaries,
    }
    (output_root / "manifest.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Build square-source avatar assets and WebP derivatives.")
    parser.add_argument("--config", required=True, type=Path, help="Path to avatar build JSON config.")
    args = parser.parse_args()
    summary = build(args.config.resolve())
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
