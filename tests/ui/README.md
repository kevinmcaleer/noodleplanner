# `tests/ui` — the Playwright UI suite

This directory is replacing the Selenium browser tests (`tests/test_*.py`
carrying `pytest.mark.usability`) file by file. Three are ported so far; ten
remain.

```bash
uv run playwright install chromium     # once
uv run pytest tests/ui -q              # the suite
uv run pytest tests/ui -q -n auto      # ~2x faster again on 4 cores
```

## Why

The Selenium suite takes about 18 minutes, which is long enough that nobody
runs it while developing — it lives in its own `continue-on-error` CI job and
gets looked at afterwards, if at all. The ported files run in about a minute,
or 25 seconds in parallel. Measured on the same machine, same assertions:

| File | Selenium | Playwright | |
|---|---:|---:|---:|
| `test_settings_panel.py` (9 tests) | 119.6s | 6.2s | 19x |
| `test_visual_system.py` (8 tests) | 115.0s | 22.0s | 5.2x |
| `test_task_peek.py` (20/21 tests) | 359.8s | 41.0s | 8.8x |
| **total** | **9m 54s** | **1m 08s** | **8.8x** |
| **total, `-n 4`** | | **25.1s** | **24x** |

## Where the time actually went

Not in Selenium. `index.html` loads five subresources from `cdn.jsdelivr.net`
and `fonts.googleapis.com`, and a browser does not consider a page loaded until
every one of them has resolved or given up. Every test in the Selenium suite
reloads the page, so every test pays that wait again.

Timed on a sandboxed runner that cannot reach those hosts, one page load is:

```
no interception:              12.81s
five routes aborted:           0.49s
```

The same page, under Playwright, with no interception: **12.83s**. Swapping the
driver on its own buys nothing. What Playwright buys is that `context.route()`
makes the interception a five-line fixture, which is why `conftest.py`'s `page`
never touches the network.

That 12.5s figure is specific to a machine where the CDN is unreachable; a CI
runner with working DNS pays real latency instead, less per load but still on
every load. Either way the fix is the same and the floor is a local-only page.

The other three wins, in rough order of size:

- **One server and one browser per session, not per file.** Thirteen Selenium
  files each stood up their own uvicorn and their own Chrome. Isolation here is
  a fresh browser *context* per test — milliseconds — which is also what makes
  `-n auto` safe.
- **Waits on state, not on the clock.** The Selenium files carry about 64
  seconds of literal `time.sleep()` across roughly 200 call sites, plus
  `implicitly_wait(3)` charged in full to every "assert this element is
  absent". `tests/ui` waits for the condition the test is about.
- **No chromedriver to match.** Selenium needs a chromedriver whose major
  version matches the installed Chrome, and `_create_chrome_driver()` is
  duplicated in all thirteen files to work around that. Playwright pins its own.

## Porting a file

Mechanical, in this order:

1. Delete the file's `app_server` / `browser` / `_create_chrome_driver`
   scaffolding — `tests/ui/conftest.py` has all of it. Take `page` and
   `app_server` as fixtures.
2. `browser.get(url)` + `dismiss_tour` + `sleep` → `helpers.open_app(page, app_server)`.
3. `find_element(By.ID, "x")` → `page.locator("#x")`; `By.CSS_SELECTOR` likewise.
4. `execute_script("return …")` → `page.evaluate("() => …")`. Arguments become
   real parameters rather than `arguments[0]`.
5. Delete every `time.sleep()` and replace it with the thing it was waiting
   for: `wait_for_selector`, `wait_for_function`, or an assertion on a locator,
   which retries on its own.
6. Run the Selenium original and the port side by side and check the pass/fail
   sets match before deleting the original. `test_visual_system.py` and its port
   both come back 7 passed / 1 failed here, which is how the port was accepted.

Two things that are *not* mechanical, both of which bit during the first three:

- **Sleeps that were load-bearing.** `test_task_peek.py`'s `load_plan()` waited
  for the editor text to hold still for 1.5s. Most of that was dead time, but it
  also happened to guarantee the 600ms debounced undo snapshot had landed before
  the test ticked a checkbox — without which "one undo reverses the tick" passes
  for the wrong reason. Replacing a sleep means finding out what it was
  really waiting for.
- **Clicks the driver won't make.** The whiteboard is a pan/zoom canvas and its
  notes routinely sit outside the window; neither driver will mouse-click what
  it cannot see. Selenium's files route those through
  `execute_script("arguments[0].click()")`; the equivalent here is
  `locator.dispatch_event("click")`. Playwright does not lift that constraint.

## The network, deliberately

`page` blocks all external origins. One test — "are the approved typefaces
fetchable from Google Fonts" — is genuinely *about* the third-party assets, so
it takes `online_page` instead and pays the latency. Selenium's module-scoped
driver could not make that distinction per test.

Nothing under `tests/` asserts on Bootstrap's classes, dagre, or html2canvas, so
blocking them changes no assertion. If that ever stops being true, serve the
library from a local copy in the fixture (`route.fulfill`) rather than opening
the origin up for the whole suite.

## Still on Selenium

`test_usability.py`, `test_ribbon_simple_view.py`, `test_whiteboard_notes.py`,
`test_whiteboard_structure.py`, `test_whiteboard_board_membership.py`,
`test_whiteboard_note_colour.py`, `test_whiteboard_drag_resize.py`,
`test_whiteboard_canvas.py`, `test_whiteboard_text_objects.py`,
`test_whiteboard_parking_lot.py`.

Note that CI's `usability` job is `continue-on-error` because some of those
tests assert against a UI that no longer exists. Port what is still true; do not
carry a stale assertion across just because it is in the file.
