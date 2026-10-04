#!/usr/bin/env python3
"""Measure every view on a phone and on tablets, against a baseline (#1379).

Epic #1376 measured the app at phone and tablet sizes with a throwaway script
and found a phone showing 43px of the view the user opened. This is that script
made permanent, and made into a ratchet like ``ci/design-system-baseline.json``:
it records a handful of numbers for every view on every device, and fails only
when one of them gets *worse* than ``ci/mobile-metrics-baseline.json`` says it
was. Each mobile task in the epic lowers a number and then lowers the baseline
so the gain is held.

For each device (touch emulation on: ``has_touch`` and ``is_mobile``) and each
of the 39 project and portfolio views, it records:

``view_share``
    The percentage of the first screen that shows the view's own content, as
    opposed to chrome (ribbon, app bar, status bar) or the markdown editor.
    Higher is better.
``chrome_px``
    The height of the fixed chrome: the ribbon or app bar at the top plus the
    status bar at the bottom. Lower is better.
``targets_44`` / ``targets_24``
    Rendered interactive targets smaller than 44px (the touch size) and 24px
    (WCAG 2.2's minimum) in either dimension. Lower is better.
``small_fields``
    Rendered text fields under 16px, which iOS Safari zooms into on focus.
``hover_only``
    Controls a stylesheet reveals only on ``:hover`` and that are hidden
    without it. Touch has no hover, so these cannot be reached. Found by
    reading the page's own stylesheets for ``:hover`` rules that make
    something visible, then checking which of their targets are hidden right
    now -- so a control that a ``(hover: none)`` rule already shows is not
    counted.

and, once per device, for the task, RAID and resource forms:

``unreachable_actions``
    The form's ``.form-actions`` buttons that ``elementFromPoint`` cannot hit
    once scrolled into view: something fixed is on top of them.
``small_fields``
    The form's text fields under 16px.

Usage::

    uv run python scripts/mobile_metrics.py                  # report against the baseline
    uv run python scripts/mobile_metrics.py --write-baseline # re-record it
    uv run python scripts/mobile_metrics.py --device phone --only tasks,raid

``tests/ui/test_mobile_metrics.py`` runs the same walk in CI's ``ui`` job.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "ci/mobile-metrics-baseline.json"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from capture_screen_audit import SAMPLE_PLAN, _start_server, _views  # noqa: E402

# The three sizes the epic's review measured. `tablet_portrait` is the 768px
# iPad the review calls out; 820x1180 (iPad Air) is exercised by #1388's own
# test rather than walked here, to keep the walk to three passes.
DEVICES = {
    "phone": {"viewport": {"width": 390, "height": 844}},
    "tablet_portrait": {"viewport": {"width": 768, "height": 1024}},
    "tablet_landscape": {"viewport": {"width": 1024, "height": 768}},
}

CONTEXT_DEFAULTS = {"has_touch": True, "is_mobile": True, "device_scale_factor": 1}

# Lower is better for every metric except view_share. A pixel measure is
# allowed a few pixels of wobble (font fallback, sub-pixel rounding); a count
# is not.
HIGHER_IS_BETTER = {"view_share"}
TOLERANCE = {"view_share": 1, "chrome_px": 4}

FORMS = {
    "task": {
        "open": """() => {
            const model = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));
            const task = model.tasks.find(t => !t.children.length);
            openTaskForm(model.lineNumber(task));
        }""",
        "section": "#taskFormSection",
    },
    "raid": {"open": "() => openRaidForm()", "section": "#raidFormSection"},
    "resource": {"open": "() => openResourceForm()", "section": "#resourceFormSection"},
}


MEASURE_VIEW_JS = r"""() => {
    const W = innerWidth, H = innerHeight;
    const shown = (el) => {
        if (!el || !el.isConnected) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1;
    };

    // --- Chrome: what is fixed to the top and bottom of the screen.
    // The phone shell's view chips, not any <np-view-chips>: a view's own
    // switch (the whiteboard's Cards / Canvas, #1384) is the view's.
    const TOP_CHROME = ['#ribbonShell', 'np-app-bar', '#phoneViewChips'];
    const BOTTOM_CHROME = ['.status-bar'];
    let top = 0, bottom = 0;
    for (const sel of TOP_CHROME) {
        for (const el of document.querySelectorAll(sel)) {
            if (!shown(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.top < H / 2) top = Math.max(top, Math.min(H, r.bottom));
        }
    }
    for (const sel of BOTTOM_CHROME) {
        for (const el of document.querySelectorAll(sel)) {
            if (!shown(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.bottom > H / 2) bottom = Math.max(bottom, H - Math.max(0, r.top));
        }
    }

    // --- The view's own container.
    const view = (() => {
        const tab = [...document.querySelectorAll('.tab-content.active')].find(shown);
        if (!tab) return null;
        if (tab.id === 'editor-tab') {
            return [...tab.querySelectorAll('.output-tab-content.active')].find(shown) || null;
        }
        if (tab.id === 'kanban-tab') return tab.querySelector('.kanban-panel') || tab;
        if (tab.id === 'portfolio-tab') {
            return [...tab.querySelectorAll('.portfolio-view, #portfolioProjectsList')].find(shown) || tab;
        }
        return tab;
    })();

    let share = 0, viewTop = null;
    if (view) {
        const r = view.getBoundingClientRect();
        const y0 = Math.max(r.top, top), y1 = Math.min(r.bottom, H - bottom);
        const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, W);
        if (y1 > y0 && x1 > x0) share = ((y1 - y0) * (x1 - x0)) / (W * H);
        viewTop = Math.round(r.top);
    }

    // --- Targets and fields, anywhere on the page.
    const TARGETS = 'button, [role="button"], a.btn, [role="tab"], [role="menuitem"], ' +
        'input:not([type="hidden"]), select, textarea, summary, ' +
        'np-button, np-close-button, np-checkbox';
    const onPage = (r) => r.right > 0 && r.left < W && r.width >= 1 && r.height >= 1;
    let t44 = 0, t24 = 0;
    for (const el of document.querySelectorAll(TARGETS)) {
        if (!shown(el)) continue;
        if (el.closest('np-button, np-close-button, np-checkbox') !== el &&
            el.closest('np-button, np-close-button, np-checkbox')) continue;
        if (parseFloat(getComputedStyle(el).opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (!onPage(r)) continue;
        const side = Math.min(r.width, r.height);
        if (side < 44) t44++;
        if (side < 24) t24++;
    }

    const FIELDS = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], ' +
        'input[type="number"], input[type="date"], input[type="url"], input[type="tel"], ' +
        'input[type="password"], select, textarea, [contenteditable="true"], [contenteditable=""]';
    let small = 0;
    for (const el of document.querySelectorAll(FIELDS)) {
        if (!shown(el) || el.readOnly || el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (!onPage(r)) continue;
        if (parseFloat(getComputedStyle(el).fontSize) < 16) small++;
    }

    // --- Controls revealed only by :hover.
    const hidden = (el) => {
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0;
    };
    const REVEALS = (style) =>
        (style.opacity && parseFloat(style.opacity) > 0) ||
        style.visibility === 'visible' ||
        (style.display && style.display !== 'none');
    const hoverOnly = new Set();
    const visit = (rules) => {
        for (const rule of rules) {
            if (rule.cssRules && rule.media) {
                if (matchMedia(rule.conditionText || rule.media.mediaText).matches) visit(rule.cssRules);
                continue;
            }
            if (rule.cssRules && !rule.selectorText) { visit(rule.cssRules); continue; }
            if (!rule.selectorText || !rule.selectorText.includes(':hover')) continue;
            if (!REVEALS(rule.style)) continue;
            for (const part of rule.selectorText.split(',')) {
                if (!part.includes(':hover')) continue;
                const plain = part.replace(/:hover/g, '').trim();
                let els;
                try { els = document.querySelectorAll(plain); } catch (_) { continue; }
                for (const el of els) {
                    if (!el.matches('button, [role="button"], a, input, select, np-button, np-close-button, .task-drag-handle')) continue;
                    // Only controls whose parent is actually on screen: a
                    // hidden row's hidden button is not a hover problem.
                    const host = el.parentElement;
                    if (!host || !shown(host)) continue;
                    const r = host.getBoundingClientRect();
                    if (!onPage(r)) continue;
                    if (hidden(el)) hoverOnly.add(el);
                }
            }
        }
    };
    for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (_) { continue; }
        if (rules) visit(rules);
    }

    return {
        view_share: Math.round(share * 100),
        chrome_px: Math.round(top + bottom),
        view_top: viewTop,
        targets_44: t44,
        targets_24: t24,
        small_fields: small,
        hover_only: hoverOnly.size,
    };
}"""


MEASURE_FORM_JS = r"""(sectionSel) => {
    const section = document.querySelector(sectionSel);
    if (!section) return null;
    let unreachable = 0;
    const actions = section.querySelectorAll('.form-actions button, .form-actions np-button');
    for (const btn of actions) {
        const cs = getComputedStyle(btn);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (btn.closest('[style*="display: none"], [style*="display:none"]')) continue;
        btn.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = btn.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        const inside = hit && (hit === btn || btn.contains(hit) ||
            (hit.getRootNode && hit.getRootNode().host === btn));
        if (!inside || y > innerHeight || y < 0) unreachable++;
    }
    let small = 0;
    const FIELDS = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea';
    for (const el of section.querySelectorAll(FIELDS)) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.readOnly) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (parseFloat(cs.fontSize) < 16) small++;
    }
    return { unreachable_actions: unreachable, small_fields: small };
}"""


SETTLE_JS = r"""() => new Promise((resolve) => {
    // Resolve once nothing in the document has changed for 200ms, or after
    // 2.5s regardless: some views animate for ever (the whiteboard's noodles).
    let timer = null;
    const done = () => { observer.disconnect(); resolve(); };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 200); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    timer = setTimeout(done, 200);
    setTimeout(done, 2500);
})"""


MEASURE_TIME = datetime(2026, 9, 27, 12, 0, 0)


def new_device_context(browser, device: str, **extra):
    """A browser context that behaves like `device`: its size, with touch."""
    spec = {**CONTEXT_DEFAULTS, **DEVICES[device], **extra}
    context = browser.new_context(**spec)
    # The calendar view draws the current month, so its cell count moves with
    # the real date. Freeze "now" (time still runs) to the month the baseline
    # was recorded in so the ratchet only moves when the code does.
    context.clock.install(time=MEASURE_TIME)
    context.add_init_script("document.cookie = 'tourCompleted=true; path=/; max-age=31536000';")
    return context


def load_plan(page, plan: str = SAMPLE_PLAN) -> None:
    page.wait_for_selector(".ribbon-scope-btn, np-app-bar", state="attached")
    page.evaluate("() => { if (typeof switchTab === 'function') switchTab('project'); }")
    page.wait_for_selector("#planEditor", state="attached")
    page.evaluate(
        """([text]) => {
            const el = document.getElementById('planEditor');
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        [plan],
    )
    page.wait_for_function("() => document.getElementById('planEditor').value.includes('rag:')", timeout=15000)
    page.evaluate(SETTLE_JS)


def switch(page, group: str, view_id: str) -> bool:
    """Switch to a view and wait for it to settle. False if it is unreachable."""
    if group == "Portfolio":
        call = f"() => {{ switchToView('portfolio'); switchPortfolioView({view_id.lower()!r}); }}"
    elif view_id == "project-report":
        call = "() => switchPlanSubnavToDashboard()"
    elif view_id == "kanban":
        call = "() => switchPlanSubnavToBoard()"
    else:
        call = f"() => switchToView({view_id!r})"
    try:
        page.evaluate(call)
        page.wait_for_function("() => !NavigationController.isTransitioning()", timeout=8000)
        if group == "Portfolio":
            # switchToView('portfolio') re-opens the last sub-view once its
            # async init lands; select the one asked for again after it.
            page.wait_for_timeout(300)
            page.evaluate(f"() => switchPortfolioView({view_id.lower()!r})")
    except Exception:
        return False
    page.evaluate("() => window.scrollTo(0, 0)")
    page.evaluate(SETTLE_JS)
    return True


def measure_forms(page) -> dict:
    out = {}
    for name, form in FORMS.items():
        page.evaluate("() => { if (typeof closeDetailPane === 'function') closeDetailPane(); }")
        page.wait_for_timeout(350)
        try:
            page.evaluate(form["open"])
            page.wait_for_selector(f"{form['section']}.active", timeout=5000)
        except Exception:
            out[name] = None
            continue
        page.wait_for_timeout(400)  # the pane's slide-in
        out[name] = page.evaluate(MEASURE_FORM_JS, form["section"])
    page.evaluate("() => { if (typeof closeDetailPane === 'function') closeDetailPane(); }")
    return out


def walk(browser, base_url: str, device: str, only: set[str] | None = None) -> dict:
    """Every view's metrics on one device, plus the forms'."""
    context = new_device_context(browser, device)
    for pattern in ("**://cdn.jsdelivr.net/**", "**://fonts.googleapis.com/**", "**://fonts.gstatic.com/**"):
        context.route(pattern, lambda route: route.abort())
    page = context.new_page()
    page.set_default_timeout(15000)
    try:
        page.goto(base_url, wait_until="domcontentloaded")
        load_plan(page)
        views: dict[str, dict | None] = {}
        for group, view in _views():
            key = view.lower() if group != "Portfolio" else f"portfolio-{view.lower()}"
            if only and key not in only and view not in only:
                continue
            views[key] = page.evaluate(MEASURE_VIEW_JS) if switch(page, group, view) else None
        page.evaluate("() => switchToView('tasks')")
        page.evaluate(SETTLE_JS)
        forms = measure_forms(page) if not only else {}
    finally:
        context.close()
    return {"views": views, "forms": forms}


def compare(baseline: dict, measured: dict) -> tuple[list[str], list[str]]:
    """(regressions, improvements) as sentences."""
    worse: list[str] = []
    better: list[str] = []
    for device, data in measured.items():
        base_device = baseline.get("devices", {}).get(device, {})
        for section in ("views", "forms"):
            for name, metrics in data.get(section, {}).items():
                base = base_device.get(section, {}).get(name)
                where = f"{device} {section[:-1]} {name}"
                if metrics is None:
                    if base is not None:
                        worse.append(f"{where}: could not be measured (was reachable in the baseline)")
                    continue
                if base is None:
                    worse.append(f"{where}: not in the baseline; run scripts/mobile_metrics.py --write-baseline")
                    continue
                for metric, value in metrics.items():
                    if metric == "view_top" or metric not in base or value is None or base[metric] is None:
                        continue
                    was = base[metric]
                    slack = TOLERANCE.get(metric, 0)
                    if metric in HIGHER_IS_BETTER:
                        if value < was - slack:
                            worse.append(f"{where}: {metric} fell from {was} to {value}")
                        elif value > was + slack:
                            better.append(f"{where}: {metric} rose from {was} to {value}")
                    else:
                        if value > was + slack:
                            worse.append(f"{where}: {metric} rose from {was} to {value}")
                        elif value < was - slack:
                            better.append(f"{where}: {metric} fell from {was} to {value}")
    return worse, better


def load_baseline(path: Path = BASELINE) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


def write_baseline(measured: dict, path: Path = BASELINE) -> None:
    doc = {
        "note": (
            "Mobile metrics ratchet (#1379): tests/ui/test_mobile_metrics.py fails when a "
            "number gets worse than this. Lower it when a change improves one: "
            "uv run python scripts/mobile_metrics.py --write-baseline"
        ),
        "devices": measured,
    }
    path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url")
    parser.add_argument("--device", choices=sorted(DEVICES), action="append")
    parser.add_argument("--only", help="comma-separated view ids (portfolio views as portfolio-<name>)")
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--json", action="store_true", help="print the measurements")
    args = parser.parse_args()

    devices = args.device or list(DEVICES)
    only = set(args.only.split(",")) if args.only else None
    if args.write_baseline and (only or args.device):
        parser.error("--write-baseline records every view on every device; drop --only/--device")

    server = thread = None
    if args.base_url:
        base_url = args.base_url
    else:
        base_url, server, thread = _start_server()

    from playwright.sync_api import sync_playwright

    measured = {}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                executable_path=os.environ.get("NOODLE_PW_CHROME") or None,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            for device in devices:
                measured[device] = walk(browser, base_url, device, only)
            browser.close()
    finally:
        if server is not None:
            server.should_exit = True
            thread.join(timeout=5)

    if args.json:
        print(json.dumps(measured, indent=2, sort_keys=True))

    if args.write_baseline:
        write_baseline(measured)
        print(f"Baseline written to {BASELINE.relative_to(ROOT)}")
        return 0

    worse, better = compare(load_baseline(), measured)
    for line in better:
        print(f"  better: {line}")
    for line in worse:
        print(f"  WORSE:  {line}")
    if better and not worse:
        print("\nLower the baseline so the gain is held: uv run python scripts/mobile_metrics.py --write-baseline")
    return 1 if worse else 0


if __name__ == "__main__":
    sys.exit(main())
