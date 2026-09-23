#!/usr/bin/env python3
"""Capture every core view and assemble a screen-audit board for Penpot (#1196).

Two outputs, both under ``penpot/screen-audit/``:

* one PNG per view, and
* ``board.svg``, a single scrollable board laying them out side by side with
  their view ids, which Penpot imports as a board to annotate — the same route
  the existing ``penpot/noodleplanner-sitemap-*.svg`` boards took.

The output is **not committed**. A screenshot in a repository is stale the day
after the next UI change, and a board full of stale screenshots is worse than
no board: it invites decisions about a UI that no longer exists. Regenerating
takes under a minute, so the reproducible script is the artefact and the images
are build output.

Which views to capture comes from ``docs/design/ui-structure.json``, which
``scripts/ui-structure-map.mjs`` derives from the router's own constants — so
this cannot silently miss a view someone added. Run that first if the app has
gained views since it was last generated.

Usage::

    python scripts/capture_screen_audit.py                    # starts its own server
    python scripts/capture_screen_audit.py --base-url http://localhost:8007
    python scripts/capture_screen_audit.py --theme dark
    python scripts/capture_screen_audit.py --only gantt,kanban

Requires Playwright (already a dev dependency; ``tests/ui`` uses it).

**Run it somewhere that can reach the CDN.** ``index.html`` pulls Bootstrap,
Bootstrap Icons and three webfonts from ``cdn.jsdelivr.net`` and
``fonts.googleapis.com``. Where those are blocked the app still renders, but in
fallback fonts and without Bootstrap's styling or any icon -- fine for an
A/B comparison, where both captures are equally affected, and misleading as a
board someone makes design decisions from. The run does not detect this; check
that the captures have icons before importing them anywhere.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
STRUCTURE = ROOT / "docs/design/ui-structure.json"
DEFAULT_OUT = ROOT / "penpot/screen-audit"

# Wide enough that a Gantt or a portfolio table is not artificially wrapped,
# which is the whole point of a layout audit.
VIEWPORT = {"width": 1600, "height": 1000}

# Small enough to read as a plan, large enough that every view has something to
# draw. A view rendered against an empty plan shows an empty state, and an
# audit of empty states is not an audit of the app.
SAMPLE_PLAN = """\
---
title: Website Redesign 2026
project manager: Alex Chen
sponsor: Marketing Director
budget: £125,000
status: Amber
start: 2026-01-05
Resources:
- @alex: Alex Chen, Project Manager
- @jamie: Jamie Smith, Developer
- @sam: Sam Lee, Designer
---

# Discovery
- Stakeholder interviews @alex 5d 2026-01-05 100%
- Content audit @sam 8d 100%
- Analytics review @jamie 3d 60%

# Design
- Wireframes @sam 10d 40%
- Visual design @sam 12d
- Design review @alex 2d

# Build
- Component library @jamie 15d
- Page templates @jamie 20d
- CMS integration @jamie 10d

# Launch
- UAT @alex 5d
- Go live @alex 1d

---raid---
- Risk: Third-party CMS licence may slip @alex High
- Issue: Analytics tag missing on checkout @jamie Medium

---highlights---
- Design phase started on schedule

---benefits---
- Faster page load: 40% improvement in LCP by Q3
"""


# #1196's acceptance criteria ask for "modal and empty states", not just the
# populated views. Both are where drift hides: an empty state is written once
# and rarely looked at again, and a modal is the one surface a designer
# reviewing a board never sees.

# Deliberately not "" -- a plan with front matter and no tasks is the state a
# real user reaches after starting a project, and it exercises the empty
# rendering of every view rather than the "no plan loaded" splash.
EMPTY_PLAN = """\
---
title: Empty Plan
project manager: Alex Chen
---
"""

# (label, global function to call, overlay id to wait for). Every entry was
# checked against the running app rather than read off the template: of ten
# candidates, `excelWizardOverlay` opens nothing visible without an upload in
# progress and three others have no global opener at all, so they are absent.
MODALS = [
    ("keyboard-shortcuts", "openShortcutsModal", "shortcutsOverlay"),
    ("ai-settings", "openAISettingsModal", "aiSettingsOverlay"),
    ("ai-chat", "openAIChat", "aiChatOverlay"),
    ("templates", "openTemplatesModal", "templatesModalOverlay"),
    ("baseline-dialog", "openBaselineDialog", "baselineDialogOverlay"),
    ("task-detail", "openDetailPane", "detailPaneOverlay"),
]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _start_server() -> tuple[str, object, threading.Thread]:
    """Run the app on a random port, so a capture never touches port 8007.

    8007 is the production container (see CLAUDE.md); a capture run should not
    depend on it being up, and must not be mistaken for traffic to it.
    """
    sys.path.insert(0, str(ROOT / "packages/noodle-web/src"))
    import uvicorn
    from noodle_web.app import app

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return f"http://127.0.0.1:{port}", server, thread
        except OSError:
            time.sleep(0.05)
    raise SystemExit("app server did not start")


def _views() -> list[tuple[str, str]]:
    """(group, view-id) for every project and portfolio view, in nav order."""
    data = json.loads(STRUCTURE.read_text())
    out: list[tuple[str, str]] = []
    for group, views in data["viewGroups"].items():
        out.extend((group, v) for v in views)
    out.extend(("Portfolio", v) for v in data.get("portfolioViews", []))
    return out


def _load_plan(page, plan: str) -> None:
    page.evaluate("() => { if (typeof switchTab === 'function') switchTab('project'); }")
    page.wait_for_selector("#planEditor", state="attached")
    page.evaluate(
        """([text]) => {
            const el = document.getElementById('planEditor');
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof renderPlan === 'function') renderPlan();
        }""",
        [plan],
    )
    page.wait_for_timeout(1500)


def _switch(page, group: str, view_id: str) -> bool:
    """Switch to a view. Returns False if the app has no way to reach it.

    The portfolio views are a different shell with a different function, and
    they are keyed lowercase there while ui-structure.json reports them
    capitalised. Calling switchToView('Status') fails silently -- the first run
    of this script captured the previous screen nine times and reported 39/39.
    """
    if group == "Portfolio":
        try:
            page.wait_for_function("() => typeof switchPortfolioView === 'function'", timeout=8000)
        except Exception:
            return False
        page.evaluate("() => { if (typeof switchTab === 'function') switchTab('portfolio'); }")
        page.wait_for_timeout(400)
        try:
            page.evaluate("([v]) => switchPortfolioView(v)", [view_id.lower()])
        except Exception:
            return False
        page.wait_for_timeout(1200)
        return True

    special = {
        "project-report": "switchPlanSubnavToDashboard",
        "kanban": "switchPlanSubnavToBoard",
    }
    fn = special.get(view_id, "switchToView")
    try:
        page.wait_for_function(f"() => typeof {fn} === 'function'", timeout=8000)
    except Exception:
        return False
    page.evaluate("() => { if (typeof switchTab === 'function') switchTab('project'); }")
    page.wait_for_timeout(200)
    call = f"{fn}()" if view_id in special else f"{fn}({view_id!r})"
    try:
        page.evaluate(f"() => {{ {call}; }}")
    except Exception:
        return False
    page.wait_for_timeout(1200)
    return True


def capture(base_url: str, theme: str, only: set[str] | None, out_dir: Path, width: int) -> list[dict]:
    from playwright.sync_api import sync_playwright

    out_dir.mkdir(parents=True, exist_ok=True)
    captured: list[dict] = []
    viewport = {"width": width, "height": VIEWPORT["height"]}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.environ.get("NOODLE_PW_CHROME") or None,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(viewport=viewport, device_scale_factor=1)
        context.add_init_script("document.cookie = 'tourCompleted=true; path=/; max-age=31536000';")
        page = context.new_page()
        page.goto(base_url, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        if theme == "dark":
            page.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")

        _load_plan(page, SAMPLE_PLAN)

        # A switch that fails silently leaves the previous view on screen and
        # the capture looks like a success. Hashing each shot catches that: two
        # views that render byte-identically did not both render.
        seen: dict[str, str] = {}

        for group, view in _views():
            if only and view not in only:
                continue
            if not _switch(page, group, view):
                print(f"  skip {view:<18} (no switch function)")
                captured.append({"group": group, "view": view, "file": None, "note": "no switch function"})
                continue
            name = f"{view}.png" if theme == "light" else f"{view}.{theme}.png"
            path = out_dir / name
            page.screenshot(path=str(path))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            duplicate_of = seen.get(digest)
            seen.setdefault(digest, view)
            size = path.stat().st_size
            flag = f"  == identical to {duplicate_of}" if duplicate_of else ""
            print(f"  {view:<18} {size // 1024:>5} KB{flag}")
            captured.append({
                "group": group, "view": view, "file": name,
                "duplicateOf": duplicate_of,
            })

        # --- Empty states. Same views, a plan with no tasks in it.
        _load_plan(page, EMPTY_PLAN)
        for group, view in _views():
            if only and view not in only:
                continue
            if not _switch(page, group, view):
                continue
            name = f"{view}.empty.png" if theme == "light" else f"{view}.empty.{theme}.png"
            path = out_dir / name
            page.screenshot(path=str(path))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            duplicate_of = seen.get(digest)
            seen.setdefault(digest, f"{view} (empty)")
            flag = f"  == identical to {duplicate_of}" if duplicate_of else ""
            print(f"  {view + ' (empty)':<26} {path.stat().st_size // 1024:>5} KB{flag}")
            captured.append({
                "group": f"{group} — empty state", "view": f"{view} (empty)",
                "file": name, "duplicateOf": duplicate_of,
            })

        # --- Modals. Back to a populated plan: an empty one leaves several of
        # these with nothing to show.
        _load_plan(page, SAMPLE_PLAN)
        if not only:
            for label, fn, overlay_id in MODALS:
                if not page.evaluate("([f]) => typeof window[f] === 'function'", [fn]):
                    print(f"  skip {label:<21} (no {fn}())")
                    captured.append({"group": "Modals", "view": label, "file": None,
                                     "note": f"no {fn}()"})
                    continue
                try:
                    page.evaluate(f"() => {{ {fn}(); }}")
                except Exception:
                    print(f"  skip {label:<21} ({fn}() threw)")
                    captured.append({"group": "Modals", "view": label, "file": None,
                                     "note": f"{fn}() threw"})
                    continue
                page.wait_for_timeout(700)
                shown = page.evaluate(
                    "([id]) => { const e = document.getElementById(id); if (!e) return false;"
                    "  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();"
                    "  return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 50; }",
                    [overlay_id])
                if not shown:
                    print(f"  skip {label:<21} (opened nothing visible)")
                    captured.append({"group": "Modals", "view": label, "file": None,
                                     "note": "opened nothing visible"})
                    continue
                name = f"modal-{label}.png" if theme == "light" else f"modal-{label}.{theme}.png"
                path = out_dir / name
                page.screenshot(path=str(path))
                print(f"  {label + ' (modal)':<26} {path.stat().st_size // 1024:>5} KB")
                captured.append({"group": "Modals", "view": label, "file": name})
                # Close it, both ways, so the next capture starts clean.
                page.keyboard.press("Escape")
                page.wait_for_timeout(250)
                page.evaluate(
                    "([id]) => { const e = document.getElementById(id); if (e) e.style.display = 'none'; }",
                    [overlay_id])
                page.wait_for_timeout(150)

        context.close()
        browser.close()
    return captured


def write_board(captured: list[dict], theme: str, out_dir: Path, width: int) -> Path:
    """Lay the screens out on one SVG board, grouped, labelled, in nav order."""
    cols = 4
    tw, th = width, VIEWPORT["height"]
    scale = 0.5
    cw, ch = int(tw * scale), int(th * scale)
    pad, label_h, group_h = 40, 28, 64

    rows: list[tuple[str, list[dict]]] = []
    for item in captured:
        if not item["file"]:
            continue
        if not rows or rows[-1][0] != item["group"]:
            rows.append((item["group"], []))
        rows[-1][1].append(item)

    parts: list[str] = []
    y = pad
    max_x = pad + cols * (cw + pad)
    for group, items in rows:
        parts.append(
            f'<text x="{pad}" y="{y + 30}" font-family="Instrument Sans, sans-serif" '
            f'font-size="28" font-weight="600" fill="#23201C">{escape(group)}</text>'
        )
        y += group_h
        for i, item in enumerate(items):
            col, row = i % cols, i // cols
            x = pad + col * (cw + pad)
            cy = y + row * (ch + label_h + pad)
            parts.append(
                f'<image x="{x}" y="{cy}" width="{cw}" height="{ch}" '
                f'href="{escape(item["file"])}" preserveAspectRatio="xMidYMin slice"/>'
                f'<rect x="{x}" y="{cy}" width="{cw}" height="{ch}" fill="none" '
                f'stroke="#E3DDD3" stroke-width="1"/>'
                f'<text x="{x}" y="{cy + ch + 19}" font-family="IBM Plex Mono, monospace" '
                f'font-size="14" fill="#635E55">{escape(item["view"])}</text>'
            )
        used_rows = (len(items) + cols - 1) // cols
        y += used_rows * (ch + label_h + pad)

    height = y + pad
    bg = "#FAF8F4" if theme == "light" else "#201E1A"
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{max_x}" height="{height}" viewBox="0 0 {max_x} {height}">\n'
        f'<rect width="{max_x}" height="{height}" fill="{bg}"/>\n'
        + "\n".join(parts)
        + "\n</svg>\n"
    )
    name = "board.svg" if theme == "light" else f"board.{theme}.svg"
    path = out_dir / name
    path.write_text(svg)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", help="an already-running instance; otherwise one is started")
    parser.add_argument("--theme", choices=["light", "dark"], default="light")
    parser.add_argument("--only", help="comma-separated view ids")
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="output directory (default: penpot/screen-audit). Capture to two of "
             "these around a change and compare them with scripts/compare_screens.py.",
    )
    parser.add_argument(
        "--width", type=int, default=VIEWPORT["width"],
        help="viewport width; use 480 to check a change at mobile width",
    )
    args = parser.parse_args()

    only = set(args.only.split(",")) if args.only else None

    server = thread = None
    if args.base_url:
        base_url = args.base_url
    else:
        base_url, server, thread = _start_server()
        print(f"Serving on {base_url}")

    try:
        print(f"Capturing {args.theme} theme at {args.width}px into {args.out}/")
        captured = capture(base_url, args.theme, only, args.out, args.width)
    finally:
        if server is not None:
            server.should_exit = True
            thread.join(timeout=5)

    shot = [c for c in captured if c["file"]]
    dupes = [c for c in shot if c.get("duplicateOf")]
    missing = [c for c in captured if not c["file"]]
    board = write_board(captured, args.theme, args.out, args.width)
    (args.out / "manifest.json").write_text(json.dumps({"theme": args.theme, "screens": captured}, indent=2) + "\n")

    print(f"\n{len(shot)}/{len(captured)} views captured")
    print(f"Board: {board}")
    if missing:
        print(f"\n{len(missing)} view(s) unreachable: {', '.join(c['view'] for c in missing)}")
    if dupes:
        print(f"\n{len(dupes)} view(s) rendered identically to another, which means the")
        print("switch did not take rather than that the views look alike:")
        for c in dupes:
            print(f"  {c['view']} == {c['duplicateOf']}")
    print("\nImport into Penpot: File > Import > the board SVG. Keep the PNGs")
    print("next to it -- the board references them by relative filename.")
    # A run that could not reach a view, or captured the same screen twice, has
    # not produced the audit it claims to.
    return 0 if shot and not dupes and not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
