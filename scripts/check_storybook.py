"""Render every story in a Storybook static build, in both themes (#1197).

`storybook build` bundles the stories; it does not run them. A story whose
render function throws -- `storyFor('a-section-that-was-removed')`, a web
component that fails to upgrade, a typo in a template literal -- builds green
and shows Storybook's red error screen to whoever opens it next. This loads
each story from the build in Chromium and fails if any of them did that, or
raised an uncaught exception on the way.

It also checks the one thing about the States story a successful render does
not prove: that the Hover and Focus columns are actually forced. They depend
on storybook-addon-pseudo-states rewriting the app's stylesheets, and if that
ever stops happening (the addon dropped, a stylesheet loaded in a way it cannot
rewrite) every column renders identically and the story still "passes".

    uv run python scripts/check_storybook.py [storybook-static]
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import sys
import threading
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

# The preview head links Bootstrap, its icon font and Google Fonts. None of
# them decides whether a story renders, and waiting on them makes every load as
# slow as the slowest CDN -- or, behind restricted egress, as slow as the
# timeout. tests/ui/conftest.py aborts the same hosts for the same reason.
BLOCKED_HOSTS = ("cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com")

SETTLED = """() => {
    const c = document.body.classList;
    return c.contains('sb-show-main') || c.contains('sb-show-errordisplay')
        || c.contains('sb-show-nopreview');
}"""


def serve(directory: Path) -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools.partial(_QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # one line per asset is noise in a CI log
        pass


def story_ids(build: Path) -> list[str]:
    entries = json.loads((build / "index.json").read_text())["entries"]
    return sorted(k for k, v in entries.items() if v.get("type") == "story")


def check_story(page, base: str, story_id: str, theme: str) -> str | None:
    """Render one story; return a description of what went wrong, or None."""
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(f"{base}/iframe.html?id={story_id}&viewMode=story&globals=theme:{theme}")
    page.wait_for_function(SETTLED, timeout=30_000)
    classes = page.evaluate("document.body.className")
    if "sb-show-errordisplay" in classes:
        message = page.locator("#error-message").inner_text().strip()
        return f"error screen: {message.splitlines()[0] if message else '(no message)'}"
    if "sb-show-nopreview" in classes:
        return "Storybook found no story to render"
    if errors:
        return f"uncaught exception: {errors[0]}"
    applied = page.evaluate("document.documentElement.getAttribute('data-theme')")
    if applied != theme:
        return f"theme decorator did not apply: data-theme is {applied!r}, expected {theme!r}"
    return None


def check_forced_states(page, base: str) -> list[str]:
    """The Focus column of States must differ from Default on every row.

    Every row, because each control is one someone reaches by keyboard, so a
    row whose focus column looks like its default is either the addon no
    longer forcing the state or a control that has lost its focus indicator
    -- both worth failing on. Hover only has to show *somewhere*: not every
    control styles it (`<np-checkbox>` deliberately does not), but if no row
    changes on hover, the forcing itself has stopped working.
    """
    page.goto(f"{base}/iframe.html?id=states--interactive&viewMode=story")
    page.wait_for_function(SETTLED, timeout=30_000)
    # The addon tags the targeted controls after the first render, then the
    # shadow hosts a frame later; wait for the last of those to land.
    try:
        page.wait_for_function(
            "() => document.querySelector('.state-hover > .pseudo-hover') && "
            "[...document.querySelectorAll('.state-hover > *')].filter(e => e.shadowRoot)"
            ".every(e => e.classList.contains('pseudo-hover-all'))",
            timeout=10_000,
        )
    except PlaywrightTimeout:
        return [
            "states--interactive: storybook-addon-pseudo-states never tagged the Hover "
            "column -- is it still registered in .storybook/main.mjs?"
        ]
    looks = page.evaluate(
        """() => {
        const look = (cell) => {
            let el = cell.firstElementChild;
            if (el.shadowRoot) el = el.shadowRoot.querySelector('button, input') || el;
            const cs = getComputedStyle(el);
            return [cs.backgroundColor, cs.borderColor, cs.color,
                    cs.outlineStyle, cs.outlineColor, cs.boxShadow].join(' | ');
        };
        const out = {};
        for (const cell of document.querySelectorAll('[data-control]')) {
            const state = cell.className.match(/state-(\\w+)/)[1];
            (out[cell.dataset.control] ??= {})[state] = look(cell);
        }
        return out;
    }"""
    )
    problems = []
    for control, states in looks.items():
        if states["focus"] == states["default"]:
            problems.append(
                f"states--interactive: {control} looks the same focused as at rest "
                f"({states['default']}) -- the focus state is not being forced, or "
                "the control has lost its focus indicator"
            )
    if all(states["hover"] == states["default"] for states in looks.values()):
        problems.append(
            "states--interactive: no control changes on hover, so the pseudo-states "
            "addon is not forcing :hover"
        )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("build", nargs="?", default=str(ROOT / "storybook-static"))
    args = parser.parse_args()

    build = Path(args.build)
    if not (build / "index.json").exists():
        print(f"no Storybook build at {build} -- run `npm run build-storybook` first", file=sys.stderr)
        return 2

    ids = story_ids(build)
    server, base = serve(build)
    failures: list[str] = []
    try:
        with sync_playwright() as p:
            # NOODLE_PW_CHROME: the same override tests/ui/conftest.py honours,
            # for a machine whose provisioned Chromium is not the build this
            # Playwright release pins.
            browser = p.chromium.launch(executable_path=os.environ.get("NOODLE_PW_CHROME") or None)
            context = browser.new_context(viewport={"width": 1280, "height": 900})
            for host in BLOCKED_HOSTS:
                context.route(f"**://{host}/**", lambda route: route.abort())
            for theme in ("light", "dark"):
                for story_id in ids:
                    page = context.new_page()
                    try:
                        problem = check_story(page, base, story_id, theme)
                    except Exception as exc:  # a hang or a crashed page is a failure too
                        problem = f"did not settle: {exc}".splitlines()[0]
                    finally:
                        page.close()
                    if problem:
                        failures.append(f"{story_id} [{theme}]: {problem}")
            page = context.new_page()
            failures.extend(check_forced_states(page, base))
            browser.close()
    finally:
        server.shutdown()

    print(f"rendered {len(ids)} stories x 2 themes")
    if failures:
        print(f"\n{len(failures)} failure(s):", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1
    print("all stories rendered, and the forced hover/focus states differ from default")
    return 0


if __name__ == "__main__":
    sys.exit(main())
