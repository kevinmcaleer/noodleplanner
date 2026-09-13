#!/usr/bin/env python3
"""Compare two screen captures, so a CSS migration can be proved safe (#1194).

The epic's remaining work is replacing raw values with tokens across 30 views.
Some of those substitutions are exactly equivalent and must not change a single
pixel; others are deliberate and should change only what was intended. Reading
a diff of `#e0e0e0` becoming `var(--np-border)` tells you nothing about which
kind you have.

So: capture before, make the change, capture after, and compare.

    uv run python scripts/capture_screen_audit.py --out .screens/before
    # ... edit CSS ...
    uv run python scripts/capture_screen_audit.py --out .screens/after
    uv run python scripts/compare_screens.py .screens/before .screens/after

Exits non-zero if any view changed by more than ``--tolerance`` percent of its
pixels, so it can gate a migration commit. Writes a diff image per changed view
into ``<after>/diff/`` with the changed pixels highlighted.

Anti-aliasing makes a handful of pixels differ between runs even with no code
change, which is why the threshold is a proportion rather than "any pixel at
all", and why ``--tolerance 0`` is available but not the default.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops
except ImportError:  # pragma: no cover
    raise SystemExit("Pillow is required: uv sync")


def _pngs(directory: Path) -> dict[str, Path]:
    return {p.name: p for p in sorted(directory.glob("*.png"))}


def compare(before: Path, after: Path, tolerance: float, threshold: int) -> int:
    left, right = _pngs(before), _pngs(after)

    only_before = sorted(set(left) - set(right))
    only_after = sorted(set(right) - set(left))
    common = sorted(set(left) & set(right))

    if not common:
        print(f"No screens in common between {before} and {after}")
        return 2

    diff_dir = after / "diff"
    changed: list[tuple[str, float]] = []
    resized: list[str] = []

    for name in common:
        a = Image.open(left[name]).convert("RGB")
        b = Image.open(right[name]).convert("RGB")
        if a.size != b.size:
            resized.append(f"{name}: {a.size} -> {b.size}")
            continue

        # Per-pixel max channel difference. `threshold` ignores the 1-2 level
        # wobble that subpixel text rendering produces between runs; anything
        # a person could see is far above it.
        delta = ImageChops.difference(a, b).convert("L")
        mask = delta.point(lambda v: 255 if v > threshold else 0)
        differing = sum(mask.histogram()[1:])
        total = a.size[0] * a.size[1]
        pct = 100.0 * differing / total
        if pct > tolerance:
            changed.append((name, pct))
            diff_dir.mkdir(parents=True, exist_ok=True)
            # The after-shot with changed pixels painted magenta: much easier to
            # act on than a black-on-black difference image.
            highlighted = b.copy()
            highlighted.paste(Image.new("RGB", b.size, (255, 0, 255)), mask=mask)
            highlighted.save(diff_dir / name)

    print(f"{len(common)} screen(s) compared, {len(changed)} changed "
          f"beyond {tolerance}% of pixels")
    for name, pct in sorted(changed, key=lambda x: -x[1]):
        print(f"  {name:<28} {pct:6.2f}%  ->  {diff_dir / name}")
    if resized:
        print(f"\n{len(resized)} screen(s) changed size, which no pixel comparison covers:")
        for line in resized:
            print(f"  {line}")
    if only_before:
        print(f"\nGone from the after capture: {', '.join(only_before)}")
    if only_after:
        print(f"\nNew in the after capture: {', '.join(only_after)}")

    if changed or resized or only_before:
        print("\nA change here is not automatically wrong -- it is the thing to look at.")
        print("Open the diff images; magenta is what moved.")
        return 1
    print("\nNo visible change.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument(
        "--tolerance", type=float, default=0.05,
        help="percent of pixels that may differ before a screen counts as changed "
             "(default: 0.05, roughly a few hundred pixels at 1600x1000)",
    )
    parser.add_argument(
        "--threshold", type=int, default=8,
        help="per-channel difference below which a pixel counts as unchanged, "
             "absorbing anti-aliasing wobble (default: 8 of 255)",
    )
    args = parser.parse_args()

    for path in (args.before, args.after):
        if not path.is_dir():
            print(f"not a directory: {path}", file=sys.stderr)
            return 2

    return compare(args.before, args.after, args.tolerance, args.threshold)


if __name__ == "__main__":
    raise SystemExit(main())
