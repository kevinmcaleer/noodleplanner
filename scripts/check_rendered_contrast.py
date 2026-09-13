#!/usr/bin/env python3
"""Check text contrast in the rendered app, not just in the token file (#1194).

`scripts/check-contrast.mjs` scores the token *pairings* — it knows
`--np-ink` on `--np-paper` is 15.29:1. It cannot know whether any element
actually pairs them, and it is blind to the failure mode the colour migration
risks: a literal replaced by a theme-flipping token on an element whose
background does *not* flip, giving light text on a still-light surface in dark
mode.

So this walks the real DOM. For every visible text node it takes the computed
colour, finds the effective background by climbing ancestors until it hits an
opaque one, and scores the pair. Runs every view in both themes.

    uv run python scripts/check_rendered_contrast.py
    uv run python scripts/check_rendered_contrast.py --baseline before.json
    uv run python scripts/check_rendered_contrast.py --theme dark --only kanban

With `--baseline` it exits non-zero only on failures the baseline did not
already have, which is what makes it usable against an app that has
pre-existing ones: the question during a migration is "did I add any", not
"are there any".

Thresholds are WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text (>=24px,
or >=18.66px bold).

Known limits, worth stating so the output is not over-trusted: it cannot see
text over a background image or gradient (those are skipped, not passed), and
it scores what the sample plan happens to render, so a state no view reaches is
not covered.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STRUCTURE = ROOT / "docs/design/ui-structure.json"

sys.path.insert(0, str(ROOT / "scripts"))

VIEWPORT = {"width": 1600, "height": 1000}

# Collected in the page: every visible element with its own text, its computed
# colour, and the first opaque background above it.
COLLECT_JS = r"""
() => {
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c);
        if (!m) return null;
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const chan = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
    const over = (fg, bg) => fg.a >= 1 ? fg : {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
    };
    const ratio = (a, b) => {
        const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
        return (hi + 0.05) / (lo + 0.05);
    };

    // The painted background: climb until something is opaque enough to matter,
    // compositing translucent layers on the way. Returns null where an image or
    // gradient is in the way, because then no colour comparison is honest.
    function background(el) {
        let node = el;
        let acc = null;
        while (node && node !== document.documentElement.parentNode) {
            const cs = getComputedStyle(node);
            if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
            const bg = parse(cs.backgroundColor);
            if (bg && bg.a > 0) {
                acc = acc === null ? bg : over(acc, bg);
                if (acc.a >= 0.999) return acc;
            }
            node = node.parentElement;
        }
        // Nothing opaque all the way up: the canvas is white.
        return acc ? over(acc, { r: 255, g: 255, b: 255, a: 1 }) : { r: 255, g: 255, b: 255, a: 1 };
    }

    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
        // Only elements with their own text, so a wrapper is not scored for
        // the text of a child that has its own colour.
        const own = [...el.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent.trim())
            .join(' ')
            .trim();
        if (!own) continue;

        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;

        const fg = parse(cs.color);
        if (!fg || fg.a < 0.1) continue;
        const bg = background(el);
        if (!bg) continue;

        const size = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const r = ratio(over(fg, bg), bg);
        const need = large ? 3 : 4.5;
        if (r >= need) continue;

        // Identify by selector rather than text, so the key survives the plan
        // content changing.
        const cls = (el.className && typeof el.className === 'string')
            ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
            : '';
        const key = el.tagName.toLowerCase() + cls;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            key,
            ratio: Math.round(r * 100) / 100,
            need,
            color: cs.color,
            background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
            sample: own.slice(0, 40),
        });
    }
    return out;
}
"""


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_server():
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url")
    parser.add_argument("--theme", choices=["light", "dark", "both"], default="both")
    parser.add_argument("--only", help="comma-separated view ids")
    parser.add_argument("--baseline", type=Path, help="only fail on findings this file does not have")
    parser.add_argument("--write-baseline", type=Path)
    args = parser.parse_args()

    # Reuse the capture script's view list, plan and switching logic rather than
    # duplicating them: if the two disagree about what a view is, the audit and
    # this check stop being about the same app.
    from capture_screen_audit import SAMPLE_PLAN, _load_plan, _switch, _views

    only = set(args.only.split(",")) if args.only else None
    themes = ["light", "dark"] if args.theme == "both" else [args.theme]

    server = thread = None
    if args.base_url:
        base_url = args.base_url
    else:
        base_url, server, thread = _start_server()

    from playwright.sync_api import sync_playwright

    findings: dict[str, list[dict]] = {}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                executable_path=os.environ.get("NOODLE_PW_CHROME") or None,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            for theme in themes:
                context = browser.new_context(viewport=VIEWPORT)
                context.add_init_script("document.cookie = 'tourCompleted=true; path=/; max-age=31536000';")
                page = context.new_page()
                page.goto(base_url, wait_until="domcontentloaded")
                page.wait_for_timeout(1500)
                if theme == "dark":
                    page.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
                _load_plan(page, SAMPLE_PLAN)

                for group, view in _views():
                    if only and view not in only:
                        continue
                    if not _switch(page, group, view):
                        continue
                    for hit in page.evaluate(COLLECT_JS):
                        # Key on theme + element, not view: the same component
                        # failing on ten views is one problem, not ten.
                        key = f"{theme}|{hit['key']}"
                        findings.setdefault(key, []).append({**hit, "view": view})
                context.close()
            browser.close()
    finally:
        if server is not None:
            server.should_exit = True
            thread.join(timeout=5)

    worst = {
        k: min(v, key=lambda h: h["ratio"]) | {"views": sorted({h["view"] for h in v})}
        for k, v in findings.items()
    }

    if args.write_baseline:
        args.write_baseline.write_text(json.dumps(sorted(worst), indent=2) + "\n")
        print(f"Baseline written: {len(worst)} element(s) below AA")
        return 0

    baseline = set(json.loads(args.baseline.read_text())) if args.baseline else set()
    new = {k: v for k, v in worst.items() if k not in baseline}
    fixed = sorted(baseline - set(worst))

    print(f"{len(worst)} element(s) below WCAG AA across {len(themes)} theme(s)")
    if baseline:
        print(f"  {len(new)} not in the baseline, {len(fixed)} the baseline had and this run does not")

    for key, hit in sorted(new.items(), key=lambda kv: kv[1]["ratio"])[:40]:
        theme, el = key.split("|", 1)
        print(f"  {theme:<5} {hit['ratio']:>5.2f}:1 (needs {hit['need']}) {el}")
        print(f"        {hit['color']} on {hit['background']}  — {', '.join(hit['views'][:4])}")
        print(f"        “{hit['sample']}”")

    if baseline and not new:
        print("\nNo new contrast failures.")
        return 0
    if not baseline:
        print("\nNo baseline given, so this is a report rather than a gate.")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
