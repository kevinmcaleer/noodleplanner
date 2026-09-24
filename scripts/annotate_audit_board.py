#!/usr/bin/env python3
"""Annotate the screen-audit board with the drift each screen actually carries (#1196).

The board that `capture_screen_audit.py` writes lays 39 views side by side,
which answers "does anything look out of place". #1196's third acceptance
criterion asks for more than that: the drift **annotated** on the board and
**cross-referenced to the audit inventory** from task 1.

So this joins the two, by **measuring which findings actually render on which
screen** rather than inferring it.

The first attempt mapped a view to a stylesheet by name -- `gantt` to
`views/gantt.css` -- which sounds reasonable and is wrong for 34 of the 39
views. There is no `tasks.css`, no `raid.css`, no `calendar.css`; most views
are painted by the shared `components.css`, and a name-based join silently
badged five screens and left the rest blank.

What this does instead: `lint-design-system.mjs --list` reports each finding
with the **selector** it was found on. Load each view in a real browser, ask
`document.querySelector` which of those selectors match something visible on
that screen, and a finding belongs to a view when its rule actually paints
there. A selector matching on twelve screens is counted on all twelve, because
it is drift a designer sees on all twelve.

What the badge is *not*: a score. A dense view has more of everything, and a
selector shared across the app inflates every screen it touches. The number
says where the remaining work is concentrated; the summary panel gives the
inventory totals it is a share of.

    uv run python scripts/annotate_audit_board.py penpot/screen-audit
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
STRUCTURE = ROOT / "docs/design/ui-structure.json"
AUDIT = ROOT / "docs/design/token-audit-data.json"

# A finding rendering on more screens than this is shared chrome, not the
# screen's own drift.
DISTINCTIVE_MAX_SCREENS = 3


def _findings_with_selectors() -> list[dict]:
    """Every finding, with the selector it sits on.

    `--list` prints two lines per finding: `<file>:<line>  <selector>` then an
    indented `<prop>: <value>`.
    """
    findings: list[dict] = []
    for rule in ("raw-colour", "off-scale-spacing"):
        out = subprocess.run(
            ["node", str(ROOT / "scripts/lint-design-system.mjs"), "--list", rule],
            capture_output=True, text=True, cwd=ROOT,
        )
        lines = out.stdout.split("\n")
        for i, line in enumerate(lines):
            head = re.match(r"^(\S+\.css):(\d+)\s+(.*)$", line)
            if not head:
                continue
            body = lines[i + 1] if i + 1 < len(lines) else ""
            if not re.match(r"^\s+\S", body):
                continue
            findings.append({
                "rule": rule,
                "file": head[1].rsplit("/", 1)[-1],
                "selector": head[3].strip(),
                "detail": body.strip(),
            })
    return findings


def _usable(selector: str) -> str | None:
    """The part of a selector safe to hand to querySelector.

    Grouped selectors are split by the caller; what is stripped here is the
    state and theme scoping -- `:hover`, `::before`, `[data-theme="dark"]` --
    because none of it is true of a screen sitting idle in a screenshot, and
    leaving it in would report every hover style as absent.
    """
    sel = selector.split(",")[0].strip()
    sel = re.sub(r'\[data-theme=["\']?dark["\']?\]\s*', "", sel)
    sel = re.sub(r"::?(hover|focus|focus-visible|active|disabled|checked|"
                 r"before|after|placeholder|first-child|last-child|nth-child\([^)]*\)|"
                 r"not\([^)]*\)|is\([^)]*\)|where\([^)]*\))", "", sel)
    sel = sel.strip()
    if not sel or sel.startswith("@") or ":" in sel:
        return None
    return sel


def _attribute(base_url: str, findings: list[dict], npm_mirror: Path | None = None) -> dict[str, dict[str, int]]:
    """{view: {rule: count}} -- a finding counts for a view when its selector
    matches a visible element there."""
    from playwright.sync_api import sync_playwright
    sys.path.insert(0, str(ROOT / "scripts"))
    from capture_screen_audit import SAMPLE_PLAN, _load_plan, _switch, _views, watch_cdn

    candidates: dict[str, list[int]] = {}
    for idx, f in enumerate(findings):
        sel = _usable(f["selector"])
        if sel:
            candidates.setdefault(sel, []).append(idx)
    selectors = sorted(candidates)
    print(f"  {len(findings)} findings on {len(selectors)} distinct testable selectors")

    hits: dict[str, list[int]] = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.environ.get("NOODLE_PW_CHROME") or None,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
        # Bootstrap decides what is visible (.d-none, .collapse), so without it
        # the join counts findings on elements a user never sees.
        failed = watch_cdn(ctx, npm_mirror)
        ctx.add_init_script("document.cookie = 'tourCompleted=true; path=/; max-age=31536000';")
        page = ctx.new_page()
        page.goto(base_url, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        _load_plan(page, SAMPLE_PLAN)

        for group, view in _views():
            if not _switch(page, group, view):
                continue
            matched = page.evaluate(
                """(sels) => sels.filter(s => {
                    let el;
                    try { el = document.querySelector(s); } catch (e) { return false; }
                    if (!el) return false;
                    const cs = getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                })""",
                selectors,
            )
            hits[view] = sorted({i for sel in matched for i in candidates[sel]})
        ctx.close()
        browser.close()
    if failed:
        raise SystemExit(f"{len(set(failed))} CDN request(s) failed (e.g. {failed[0]}); the "
                         "visibility join would be wrong. Pass --npm-mirror.")

    # A raw per-screen count is dominated by the chrome every screen shows --
    # the ribbon, the status bar -- so every view lands between 48 and 82 and
    # the board says nothing useful. The number worth putting on a tile is what
    # is *distinctive*: a finding rendering on a handful of screens is that
    # screen's own drift, and is what someone standing in front of the board
    # can actually act on.
    spread: dict[int, int] = {}
    for idxs in hits.values():
        for i in idxs:
            spread[i] = spread.get(i, 0) + 1

    per_view: dict[str, dict[str, int]] = {}
    for view, idxs in hits.items():
        own = sum(1 for i in idxs if spread[i] <= DISTINCTIVE_MAX_SCREENS)
        per_view[view] = {"total": len(idxs), "own": own}
        print(f"  {view:<20} {len(idxs):>4} render here, {own:>3} on "
              f"\u2264{DISTINCTIVE_MAX_SCREENS} screens")
    return per_view


def _total_findings() -> int:
    out = subprocess.run(
        ["node", str(ROOT / "scripts/lint-design-system.mjs"), "--json"],
        capture_output=True, text=True, cwd=ROOT,
    )
    data = json.loads(out.stdout)
    return sum(sum(sum(f.values()) for f in files.values()) for files in data["counts"].values())


def annotate(board: Path, per_view: dict[str, dict[str, int]]) -> str:
    svg = board.read_text()

    # Every tile the board drew, with its label position -- the board writes
    # the view id as a <text> immediately under each <image>.
    tile = re.compile(
        r'<image x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" href="([^"]+)"[^/]*/>'
    )
    label = re.compile(r'<text x="(\d+)" y="(\d+)"[^>]*>([^<]+)</text>')
    labels = {(int(m[1]), m[3]): m for m in (m for m in label.finditer(svg))}

    badges: list[str] = []
    attributed = 0
    for m in tile.finditer(svg):
        x, y, w, h, href = int(m[1]), int(m[2]), int(m[3]), int(m[4]), m[5]
        view = href.replace(".dark", "").replace(".empty", "").removesuffix(".png")
        if view.startswith("modal-"):
            continue
        found = per_view.get(view)
        if not found:
            continue
        total, own = found["total"], found["own"]
        attributed += own
        # A pill in the tile's top-right corner. Amber rather than red: this is
        # "here is where the remaining work is", not "this screen is broken".
        # Two numbers, because one of them is the answer: `own` is drift this
        # screen carries that few others do. The pill is amber when there is
        # something here to act on and sage when the screen only shows shared
        # chrome, so the board reads at a glance from across a room.
        bw = 150
        fill, stroke, ink = ("#FBEFCE", "#EDB52A", "#8A6205") if own else ("#E7EDE2", "#6B7A5E", "#4E5C43")
        badges.append(
            f'<g>'
            f'<rect x="{x + w - bw - 6}" y="{y + 6}" width="{bw}" height="34" rx="17" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="1"/>'
            f'<text x="{x + w - bw + 8}" y="{y + 28}" font-family="IBM Plex Mono, monospace" '
            f'font-size="13" fill="{ink}">{own} own \u00b7 {total} total</text>'
            f'</g>'
        )

    audit = json.loads(AUDIT.read_text())
    grand = _total_findings()
    rendered = sum(v["total"] for v in per_view.values())
    screens = len(per_view)

    # A legend and the inventory totals, so the per-tile numbers have a
    # denominator on the same board rather than in another document.
    panel_lines = [
        ("Drift on this board", ""),
        ("lint findings in the app's stylesheets", f"{grand}"),
        ("sightings on these screens (a shared rule counts once per screen)", f"{rendered}"),
        ("screens carrying at least one", f"{screens} of 39"),
        ("", ""),
        ("From the audit inventory", ""),
        ("unique colours in use", str(audit["colors"]["totalUnique"])),
        ("colours matching a token already", str(audit["colors"]["duplicateOfTokenCount"])),
        ("canonical tokens declared", str(audit["canonicalTokenCount"])),
        ("spacing declarations", str(audit["spacing"]["declarations"])),
        ("off-grid spacing values still in use", str(audit["spacing"]["offGridUniqueValues"])),
    ]
    ph = 40 + len(panel_lines) * 26
    panel = [
        f'<g transform="translate(40, PANEL_Y)">',
        f'<rect x="0" y="0" width="620" height="{ph}" rx="10" fill="#FFFDF9" '
        f'stroke="#E3DDD3" stroke-width="1"/>',
    ]
    for i, (k, v) in enumerate(panel_lines):
        yy = 34 + i * 26
        weight = "600" if v == "" and k else "400"
        panel.append(
            f'<text x="22" y="{yy}" font-family="Instrument Sans, sans-serif" font-size="15" '
            f'font-weight="{weight}" fill="#23201C">{escape(k)}</text>'
            f'<text x="596" y="{yy}" text-anchor="end" font-family="IBM Plex Mono, monospace" '
            f'font-size="15" fill="#635E55">{escape(v)}</text>'
        )
    panel.append(
        f'<text x="22" y="{ph - 12}" font-family="Instrument Sans, sans-serif" font-size="13" '
        f'fill="#736C60">Badges count findings in the view’s own stylesheet. '
        f'A bigger view has more; this is where the work is, not a score.</text>'
    )
    panel.append("</g>")

    # Grow the canvas for the panel and drop everything in before </svg>.
    m = re.search(r'height="(\d+)" viewBox="0 0 (\d+) (\d+)"', svg)
    old_h = int(m[1])
    new_h = old_h + ph + 60
    svg = svg.replace(f'height="{old_h}" viewBox="0 0 {m[2]} {m[3]}"',
                      f'height="{new_h}" viewBox="0 0 {m[2]} {new_h}"', 1)
    svg = re.sub(r'(<rect width="\d+" height=")\d+(" fill="#[0-9A-Fa-f]{6}"/>)',
                 rf'\g<1>{new_h}\g<2>', svg, count=1)
    body = "\n".join(badges) + "\n" + "\n".join(panel).replace("PANEL_Y", str(old_h + 20))
    return svg.replace("</svg>", body + "\n</svg>")



def inline_images(svg: str, src_dir: Path, tile_w: int, tile_h: int) -> str:
    """Replace every relative <image href> with a data: URI.

    Penpot's import takes a *file*, not a folder, so a board referencing 84
    PNGs by relative name imports as 84 broken-image placeholders. Verified
    rather than assumed: rendering the board with the PNGs moved away gives a
    grid of grey boxes.

    The images are downscaled to the size the board actually draws them at on
    the way in. The sources are 1600x1000 and each tile is 800x500, so this is
    not a quality loss -- it is declining to embed four times the pixels the
    board can show. Done through the browser's own canvas because that is the
    image encoder available here; there is no Pillow in this environment.
    """
    from playwright.sync_api import sync_playwright

    hrefs = sorted(set(re.findall(r'<image[^>]*href="([^"]+)"', svg)))
    hrefs = [h for h in hrefs if not h.startswith("data:")]
    if not hrefs:
        return svg

    missing = [h for h in hrefs if not (src_dir / h).is_file()]
    if missing:
        raise SystemExit(f"cannot inline: {len(missing)} referenced file(s) missing, e.g. {missing[0]}")

    print(f"  inlining {len(hrefs)} image(s) at {tile_w}x{tile_h}")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.environ.get("NOODLE_PW_CHROME") or None,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = browser.new_context(viewport={"width": 200, "height": 200}).new_page()
        page.goto("about:blank")
        for i, href in enumerate(hrefs, 1):
            raw = base64.b64encode((src_dir / href).read_bytes()).decode()
            data_uri = page.evaluate(
                """async ([b64, w, h]) => {
                    const img = new Image();
                    img.src = 'data:image/png;base64,' + b64;
                    await img.decode();
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    c.getContext('2d').drawImage(img, 0, 0, w, h);
                    return c.toDataURL('image/png');
                }""",
                [raw, tile_w, tile_h],
            )
            svg = svg.replace(f'href="{href}"', f'href="{data_uri}"')
            if i % 20 == 0:
                print(f"    {i}/{len(hrefs)}")
        browser.close()
    return svg


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("out_dir", type=Path, help="the capture directory holding board.svg")
    ap.add_argument("--base-url", default="http://127.0.0.1:8007",
                    help="a running NoodlePlanner to measure against")
    ap.add_argument("--standalone", action="store_true",
                    help="also write a board with the PNGs embedded, for tools that "
                         "import a single file (Penpot does)")
    ap.add_argument("--npm-mirror", type=Path, default=os.environ.get("NOODLE_NPM_MIRROR") or None,
                    help="serve cdn.jsdelivr.net/npm/ from unpacked npm packages; "
                         "see capture_screen_audit.py")
    args = ap.parse_args()

    findings = _findings_with_selectors()
    per_view = _attribute(args.base_url, findings, args.npm_mirror)
    written = []
    for board in sorted(args.out_dir.glob("board*.svg")):
        if board.name.endswith(".annotated.svg"):
            continue
        annotated = annotate(board, per_view)
        target = board.with_suffix(".annotated.svg")
        target.write_text(annotated)
        written.append(target)
        if args.standalone:
            solo = board.with_suffix(".standalone.svg")
            solo.write_text(inline_images(annotated, args.out_dir, 800, 500))
            written.append(solo)
        print(f"  {target.relative_to(ROOT) if target.is_relative_to(ROOT) else target}")
    if not written:
        print(f"no board*.svg in {args.out_dir}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
