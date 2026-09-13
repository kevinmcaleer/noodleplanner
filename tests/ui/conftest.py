"""Fixtures for the Playwright UI suite.

These replace the per-file Selenium scaffolding in tests/test_usability.py and
its twelve siblings, each of which stood up its own uvicorn server and its own
Chrome for every module. Three things make this one fast:

1.  **One server and one browser for the whole session.** Thirteen module-scoped
    `app_server`/`browser` fixture pairs meant thirteen uvicorn startups and
    thirteen browser launches per run. Here there is one of each, and isolation
    comes from a fresh browser *context* per test -- a few milliseconds, not a
    few seconds.

2.  **No page load reaches the internet.** `templates/index.html` pulls five
    subresources from cdn.jsdelivr.net and fonts.googleapis.com. A browser will
    not report the page loaded until every one of them has resolved or given
    up, so each `browser.get()` in the Selenium suite pays that latency again.
    Measured on a sandboxed runner where those hosts are unreachable, one page
    load is 12.81s unintercepted and 0.49s with the five routes aborted -- the
    single largest cost in the old suite. `page` aborts them.

3.  **Auto-waiting instead of `time.sleep()`.** Playwright's locators retry until
    the element is actionable, so the ~64 seconds of fixed sleeps scattered
    through the Selenium files become waits that end as soon as the UI is ready.

The one test that genuinely needs the network -- "are the approved typefaces
actually fetchable from Google Fonts" -- asks for `online_page` instead, which
is the same thing without the route blocking. Selenium's module-scoped driver
could not make that distinction per test.
"""

import os
import pathlib
import socket
import threading
import time

import pytest

try:
    import uvicorn
    from noodle_web.app import app as fastapi_app

    HAS_APP = True
except ImportError:  # noodle-web not installed for this run
    HAS_APP = False

try:
    from playwright.sync_api import sync_playwright

    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

def pytest_collection_modifyitems(items):
    """Mark everything in this directory `ui`.

    A module-level `pytestmark` in a conftest is not applied to tests, so the
    marker is added here instead -- which also means a newly ported file picks
    it up without having to remember to declare it.
    """
    here = pathlib.Path(__file__).parent
    for item in items:
        if here in pathlib.Path(str(item.fspath)).parents:
            item.add_marker(pytest.mark.ui)


# Everything index.html loads from somewhere that is not this app. Aborting
# them is safe for the suite: nothing under tests/ asserts on Bootstrap's
# classes, dagre, or html2canvas, and a blocked webfont falls back to the next
# family in the stack rather than changing any value a test reads.
EXTERNAL_ORIGINS = (
    "**://cdn.jsdelivr.net/**",
    "**://fonts.googleapis.com/**",
    "**://fonts.gstatic.com/**",
)


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="session")
def app_server():
    """Run the FastAPI app on a random port for the whole test session."""
    if not HAS_APP:
        pytest.skip("noodle_web not importable")

    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(fastapi_app, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.05)
    else:
        pytest.fail("App server did not start in time")

    yield f"http://127.0.0.1:{port}"

    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="session")
def browser():
    """One headless Chromium for the whole session.

    `NOODLE_PW_CHROME` overrides the executable, which is what you want where a
    Chromium is already on disk under a different build number than the one the
    installed Playwright expects -- otherwise Playwright manages its own via
    `playwright install chromium`.
    """
    if not HAS_PLAYWRIGHT:
        pytest.skip("playwright not installed")

    with sync_playwright() as pw:
        try:
            instance = pw.chromium.launch(
                executable_path=os.environ.get("NOODLE_PW_CHROME") or None,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
        except Exception as exc:  # no browser on this machine
            pytest.skip(f"Chromium not available to Playwright: {exc}")
        yield instance
        instance.close()


def _new_page(browser, block_external, timeout_ms):
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    if block_external:
        for pattern in EXTERNAL_ORIGINS:
            context.route(pattern, lambda route: route.abort())
    # Set before any document loads, so the tour never gets a chance to cover
    # the UI -- the Selenium suite hid it after the fact and slept to let the
    # overlay go away.
    context.add_init_script(
        "document.cookie = 'tourCompleted=true; path=/; max-age=31536000';"
    )
    page = context.new_page()
    page.set_default_timeout(timeout_ms)
    page.set_default_navigation_timeout(timeout_ms)
    return context, page


@pytest.fixture
def page(browser):
    """A fresh, isolated page that never touches the network."""
    context, pg = _new_page(browser, block_external=True, timeout_ms=5_000)
    yield pg
    context.close()


@pytest.fixture
def online_page(browser):
    """A fresh page that *is* allowed to reach the CDN and Google Fonts.

    Only for the handful of assertions that are about the third-party assets
    themselves. Everything else should use `page`.
    """
    # Generous, because this one really is waiting on cdn.jsdelivr.net and
    # fonts.googleapis.com. On a machine that cannot reach them it will fail
    # slowly rather than pass wrongly, which is the correct outcome for a test
    # whose whole subject is "can the browser fetch these".
    context, pg = _new_page(browser, block_external=False, timeout_ms=30_000)
    yield pg
    context.close()
