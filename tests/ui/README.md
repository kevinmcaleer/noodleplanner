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
gets looked at afterwards, if at all.

**On CI**, where the third-party CDNs resolve normally, these three files cost
135.7s under Selenium and 43.5s here. That figure is by subtraction of two
`pytest (usability)` runs on the same runner class: 1122.6s for 263 tests on
`main`, 986.9s for the 226 that remain once these three are removed. Per test,
Selenium averages 4.27s across the whole suite and 4.37s across what is left of
it, so the arithmetic is stable.

| | CI, 2-core runner |
|---|---:|
| three files, Selenium | 135.7s |
| three files, Playwright, `-n auto` | **43.5s** |
| | **3.1x** |

Per test that is 3.67s → 1.14s wall clock, or → ~2.29s if you take the
parallelism back out. Extrapolated across all thirteen files, a full port
should put the 18m 42s suite somewhere around **6 minutes** on a 2-core CI
runner, and well under two on a developer machine with more cores.

**Locally the gap looks far larger, and that number is not representative.**
On a sandboxed machine that cannot reach `cdn.jsdelivr.net` at all, the same
three files are 9m 54s under Selenium against 1m 08s here (25.1s with `-n 4`) —
an 8.8x that is really measuring a 12.5s connect timeout on every page load.
It is a fair picture of a bad network and a misleading one of a good one. Quote
the CI numbers.

What is unambiguous either way is the edit loop, which is the point of the
exercise: one file, locally, is **6.2s** for `test_settings_panel.py`, 22.0s for
`test_visual_system.py`, 41.0s for `test_task_peek.py`. Their Selenium
equivalents cannot get near that, because each one launches its own Chrome and
its own uvicorn before running anything.

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
every load — which is exactly why the CI speedup (3.1x) is so much smaller than
the local one (8.8x). Either way the fix is the same and the floor is a
local-only page.

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

## Three real bugs this suite found

Porting `test_whiteboard_parking_lot.py` turned up two defects in the app, both
around a reload: `loadProjectIntoEditor()` is async, so between a project
being selected and its text reaching `#planEditor` there is a gap, and on a
loaded machine that gap is wide; and the project store's writes are
asynchronous too.

**Fixed: an empty editor could destroy a stored plan.** Any save landing in
that window stamps `last_saved` into an empty editor and writes the result over
the project — the plan is not failed-to-load, it is gone, and the next save
persists the emptiness. Instrumenting the failing run named the caller:
`portfolio.js`'s `startAutoSave()`, a 30-second interval that checks only that
a project id exists. The stored plan came back as 37 characters of front
matter.

`saveCurrentProjectState()` now refuses to overwrite a project that has content
with an editor that has none. The guard is deliberately narrow — *entirely*
empty, over a project that is not — because a user who selects all and deletes
is doing something real and must still be able to save it.

**Fixed: the last edit before a reload could be lost.** This was first
written up here as "the startup restore sometimes never completes", and the
reload tests were marked `unstable` for it. That diagnosis was wrong. The
restore completed every time; what it restored was a plan with no text in it.

Dumping the store at the moment of the timeout showed the current project
selected, its record present, and its `planText` empty — not the parked plan,
and not even the plan `load_plan()` had typed in. Dumping it just before
`page.reload()` showed why: `NoodleStore.dirtyCount()` was 1. The test waits
for `getCurrentProject()` to carry the parking lot marker, but that reads the
store's in-memory copy; the IndexedDB write behind it is debounced by 250ms,
and the reload landed inside that window. Nothing flushed before it had carried
any plan text.

The store's `pagehide` listener is there for exactly this, and it did start a
transaction. It never committed it. An IndexedDB transaction auto-commits only
once control returns to the event loop with no requests pending, and a
document being torn down may not get there — the browser then aborts the
transaction with the page. The more loaded the machine, the likelier that is,
which is why it showed up as "one run in three with four browsers on four
cores" and passed on its own. `flush()` in `project-store.js` now calls
`tx.commit()` once its puts are queued, so the commit is requested in the same
task as the `pagehide` event. This is a real user-facing loss, not a test
artefact: park a note (or make any edit) and reload or close the tab within a
quarter of a second, and the edit was gone.

Both reload tests are back in the gating run. They deliberately still reload
without waiting for the debounce, because that is the case the fix is for.

The `unstable` marker, which `ci/jobs/ui.sh` deselects with
`-m "not unstable"`, stays for tests that are right about an app defect nobody
has fixed — a gate that is red for one teaches people to ignore it. They stay
in the tree and runnable (`-m unstable` runs exactly those), and nothing joins
the marker without a defect written down beside it. Today no test carries
it: the last one, `test_usability.py`'s `test_render_does_not_show_error`, was
catching NaN coordinates in the EVM chart for any plan inside one calendar
month, which is why it failed on some days and not others. That is fixed and
the test gates again. Before reaching for
it, rule out the test's own setup: this one looked like an app hang for a long
time and was a lost write.

## Investigated and not reproduced: the row-layout sweep failure (#1288)

`test_whiteboard_row_layout.py::TestTheGutterHoldsItsPosition::test_every_row_reserves_the_same_slots_even_when_empty`
was reported failing only inside the full `tests/ui` sweep, seen three times
during the #1264 work and attributed to order or load. Ten sweeps at CI's own
configuration did not reproduce it, and reading the render path says the
reported symptom cannot happen the way the report assumed. Both halves are
worth having written down, because the next person to see this test go red
should start from better information than "it is flaky".

**It is deliberately not marked `unstable`.** The marker above is for tests
that are right about an app defect nobody has fixed. Nothing here identified a
defect, so there is nothing to write down beside it, and the test is unchanged.

### The counts cannot be transiently wrong

The test asserts, per row, one `.wb-note-row-gutter`, one `-slot-deliv`, one
`-slot-people`, and zero of the retired `-slot-hint` / `-slot-dep`. All four
are structural: `buildChecklistRow()` (`components/note/note-markup.js`) builds
the gutter and both surviving slots unconditionally, and builds neither retired
slot at all. So once a row exists in the DOM those four counts are fixed.

Nor is a half-built note observable. `wbRenderNotes()` appends the note and
fills its body in one synchronous task, and Playwright's waits poll between
tasks, never inside one — so there is no instant at which the note exists with
its rows missing. The only way this test can fail is the `Build` note being
*absent*, and that surfaces as a timeout inside `switch_to_whiteboard()`, not
as a count assertion. The issue's "a count assertion on rendered DOM" was an
inference from what the test asserts, not a recorded observation.

### What each of the three hypotheses came to

- **A missing wait — eliminated.** See above: the counts are structural and no
  partial DOM is observable. Adding `settled()` here, as the geometry tests do,
  would wait for something that is already true.
- **Cross-test state — eliminated.** Every test gets a fresh browser context,
  so localStorage, cookies and the HTTP cache are its own, and the plan reaches
  the app only through this test's `load_plan()`. That call's `rag:` wait is a
  real barrier rather than a guess: in `updateAllViews()` the `whiteboard`
  entry runs *before* the `statusBar` entry that writes `rag:` back, so `rag:`
  being present already implies the whiteboard cache holds this plan's tasks.
- **Parallelism interaction — not eliminated, but not observed** in 286
  executions of the test's exact shape at CI's configuration.

### The numbers

`pytest tests/ui -m "ui and not unstable" -n auto -p no:cacheprovider`, four
workers on four cores, ~4.5–5.2 min per sweep. Amplified sweeps carried a
throwaway file that repeated this test's body 24 or 60 times per sweep, so one
sweep bought many independent samples at the sweep's own load.

| Base | Sweeps | Executions of the test's shape | Times it fired |
|---|---:|---:|---:|
| `b7033d10` (pre-#1290) | 3 plain + 4 amplified | 103 | 0 |
| `00d11012` (post-#1290) | 3 amplified | 183 | 0 |

**Do not "amplify" by oversubscribing workers.** Three sweeps at `-n 8` on four
cores did make this test fail — and the failure was `Page.goto: Timeout 5000ms
exceeded` in `open_app()`, i.e. the machine, not the test. The same three runs
also blew `test_whiteboard_note_perf.py`'s 800ms drag budget every time. That
configuration manufactures its own failures and proves nothing about this one.

Also on the record: the issue lists
`test_usability.py::TestPlanRendering::test_render_does_not_show_error` as a
known sweep failure. It passed in all ten sweeps here, so that part of the
premise is stale. `test_usability.py::TestTabNavigation::test_a_second_scope_click_during_the_fade_still_lands`
failed once in ten — a separate intermittent, not chased here.

## Still on Selenium

`test_whiteboard_notes.py` (35), `test_whiteboard_structure.py` (28),
`test_whiteboard_note_colour.py` (24), `test_whiteboard_board_membership.py`
(24), `test_whiteboard_canvas.py` (16), `test_whiteboard_text_objects.py` (14),
`test_ribbon_simple_view.py` (14), `test_whiteboard_drag_resize.py` (13).

168 tests over eight files, all but one of them whiteboard. The shared
whiteboard helpers in `helpers.py` already cover most of what they need, so
they should go faster than the first four did.

Note that CI's `usability` job is `continue-on-error` because some of those
tests assert against a UI that no longer exists. Port what is still true; do not
carry a stale assertion across just because it is in the file.
