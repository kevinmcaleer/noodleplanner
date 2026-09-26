# Codebase review: duplication, structure, stability and speed

> Review date: 2026-09-26, at `6feed32` (main).
> Scope: the whole repository. That covers the Python core (`noodle-core`) and CLI, the FastAPI backend (`noodle-web`), all first-party browser JS, the whiteboard and collab code, the Obsidian and iOS ports, and CI and tests. Vendored libraries are excluded.

## How this was done

The code was split into six slices, each read end to end: Python core, backend, frontend core, views, whiteboard and collab, and cross-cutting duplication. Every finding below was checked in the code. Bugs were also reproduced, either with a scratch script against the real functions or through `TestClient` or node. Nothing is listed on the strength of a pattern match alone.

The PR that adds this file fixes about forty of these findings. Each fix is its own commit, with a test that fails on `main`; "Fixed here" below means that PR. Test counts before and after:

| Suite | Baseline (`main`) | With the fixes |
|---|---|---|
| fast suite (`uv run pytest`) | 1874 passed | 1952 passed |
| JS suite (`npm run test:js`) | 1145 passed | 1233 passed |
| Playwright suite (`tests/ui`) | 545 passed, 1 failed | see the PR |

The Playwright failure on `main` is a web-font fetch that needs internet.

## The shape of the problem

Most individual defects come from a handful of structural causes. Fixing a cause is what stops the same bug coming back.

### 1. The plan format is implemented at least six times

| Concern | Where it is implemented |
|---|---|
| Task-line tokenising | `noodle_core/metadata.py`, `static/engine/tokeniser.js`, `static/task-tokenizer.js`, `plan-model.js` (fallback grammar), `format_converter.py` (name split), Obsidian `metadata-extractor.ts`, iOS `PlanParser.swift` |
| Working-day maths | `date_math.py` and `calendar_model.py`, `engine/date-math.js` and `engine/calendar.js`, plus private copies in `script.js:2309-2345`, `views-tables.js:1564-1610`, `plan-reports.js:27-46`, `gantt-scale.js:123-153`, Obsidian `working-days.ts` and iOS `SchedulingEngine.swift` |
| Scheduling | `scheduling_engine.py` and `engine/scheduler.js` (held together by the conformance corpus), plus a fifth, legacy scheduler in `script.js:2348` (`calculateTaskDates`, used by the Task Inspector), Obsidian `scheduler.ts` and iOS `SchedulingEngine` |
| Front matter | `front_matter_parser.py`, `plan_service.parse_front_matter`, four walkers in `exporters.py`, `format_converter.py`, `plan_quality.py`, `ai_tools._parse_front_matter`; in the browser, `local-parse.js`, `front-matter-model.js`, and about ten regex helpers in `script.js` and `settings.js` |

The conformance corpus only holds `scheduler.js` and `schedule_tasks` to each other. It compares task fields only, through a calendar parser the test writes itself. So the parser the browser actually ships (`localParse` → `parseCalendar` / `parseFrontMatter`) is never compared with Python, and every other copy can drift silently. Several already have:

- **Dates from 2027 on.** `has_details` looked for the literal substrings `2024-`/`2025-`/`2026-` in all three parsers. From 1 January 2027 a line whose only metadata is a date keeps the date in its name, and every dependency on it stops resolving. **Fixed here.**
- **A bare `---` in the body.** Python (`format_converter.py:149`) toggles "front matter" on every `---` and drops every task after it. The browser keeps those tasks and adds a phantom `---` task.
- **Holidays.** The browser ignores the flat `non-working-days: a, b` form, ends the holiday list at a blank line, and doesn't recognise CRLF front matter. Python honours all three, so the same plan finishes on different days.
- **`settings:`** is never applied in the default local-engine mode. `parseFrontMatter` returns a flat shape, and `settings.js:206` reads a nested one.
- **Task names.** `task-tokenizer.js` strips tokens from anywhere in the line, so `Design @kev review 3d` becomes "Design review". The scheduler gives "Design". The name lookups between the two (`script.js:2518`, `:3586`) then miss.
- **The Obsidian plugin** throws on every `[depends …]` line (a `/g` regex with `[1]`), reads `#label` as a dependency, and has no `y` durations. **iOS** strips lag and never matches `A:SS` dependencies.

**Recommendation.** Treat `static/engine/*.js` (DOM-free ES modules) and `noodle_core` as the only two implementations, and delete the others:

1. Point `task-tokenizer.js`, the `plan-model.js` fallback and `script.js`'s `calculateTaskDates` at the engine.
2. Build the Obsidian plugin from `engine/*.js` with esbuild.
3. Either run the engine in JavaScriptCore on iOS, or mark the iOS app unmaintained.
4. Make `test_engine_conformance.mjs` call `localParse()` and compare `front_matter` and `resource_map` too.
5. Add corpus plans for each case above.

### 2. Back-matter section lists were hand-copied about 20 times

Plans end with sections such as `---raid log---`, `---whiteboard---`, `---parking lot---` and `---estimates---`. Each reader and writer carried its own list of where its section ends. The lists had drifted, and that was the largest single source of **data loss**:

- `estimating.js` appends `---estimates---` after `---whiteboard---`. The whiteboard parser then read the estimate rows as notes, and the next note drag deleted them.
- The MS Project sync merge deleted a trailing parking lot or estimates section.
- The RAID extractor ran into the estimates table and wrote phantom items back on the next RAID edit.
- In Python, the highlights extractor swallowed a following parking lot, and re-saving the highlights duplicated it.
- The AI tools' list was missing four sections, so `add_task` could insert a task inside "lessons learned".

**Fixed here** for every reader and splicer:

- **Browser:** one canonical list in `static/back-matter-markers.js`, with a helper that ends a section at the next marker line. A test holds the list to Python's `ALL_SECTION_MARKERS`.
- **Python:** the highlights functions and the AI tools now use `ALL_SECTION_MARKERS`.

**Still to do:**

- The writers that rebuild every section in a fixed order (`syncBenefitsToPlanText`, the comms, lessons and budget syncs, `updatePlanBaselineText`) keep a trailing parking lot or estimates section only by accident. `updatePlanBaselineText` can drop estimates when there is no whiteboard section. Replace them with one `splitBackMatter()` / `joinBackMatter()` per language that writes sections in canonical order.
- The same applies to Python's nine `update_plan_*` functions.

### 3. The Python export pipeline is copy-pasted nine times

The sequence convert → `natural_language_to_yaml` → unwrap → `schedule_tasks` appears in:

- `exporters.py:846, 2490, 3387, 3676, 3960`
- `mpp_writer.py:92`
- `msproject.py:442`
- `plan_quality.py:253`
- `plan_service.py:713`

Each copy passes a different subset of holidays and calendars. Take a 3-day task starting Monday, with holidays on Tuesday and Wednesday and a Sun–Thu calendar: it finishes on Friday in MSPDI, on Wednesday in `.mpp`, and on Wednesday (exclusive) in CSV. MSPDI and `.mpp` also hard-code a Mon–Fri week when turning the exclusive finish back into a last working day (`msproject.py:117-138`).

**Recommendation:**

1. Add one `schedule_plan(text, name) -> (tasks, front_matter, calendars)` and make every exporter call it. This changes output only for plans that are exported wrongly today.
2. Split `exporters.py` into `excel`, `pptx` and `text_report` modules. It is 4,279 lines, and `export_to_excel` alone is 896.
3. Stop `scheduling_engine` doing `from .exporters import *`. Because of it, importing the scheduler pays about 0.34 s for openpyxl and python-pptx.

### 4. 85 classic scripts share one global namespace

`index.html` loads 85 classic scripts, about 3.7 MB. When two files declare the same top-level function, whichever loads later silently wins:

- **`startInlineRename`** exists in both `views-tables.js` and `portfolio-projects-table.js`. The portfolio one won, so renaming a resource shortname threw an error. **Fixed here.**
- **`escapeHtml`** had four definitions. None escaped quotes, yet about 50 call sites put the result in attribute values, some inside `onclick`. A RAID title containing `"` could inject attributes, and plans reach other people through collab sessions and shared files. **Fixed here:** one quote-safe helper, plus `escapeJsAttr` for handler strings, and the known unescaped interpolations are escaped.
- **Inside `script.js`,** `handleDependencyInput`, `handleDependencyKeydown` and `selectDependency` were each declared twice. **Fixed here** by deleting the dead first copies.
- **`wbClientToBoard`** is still defined in both `whiteboard-groups.js` and `whiteboard-noodles.js`.

A new test, `tests/test_duplicate_globals.mjs`, now fails on any new duplicate top-level function across the classic scripts. `wbClientToBoard` is on its known-duplicates list, and that entry fails the test once the duplicate is removed, so it can't go stale.

Private helper copies remain:

- about 14 HTML escapers
- 27 blob-download "anchor dances"
- six "initials" helpers
- four `dayOf` implementations
- about 55 uses of `new Date('YYYY-MM-DD')`, which parses as UTC and shifts dates back a day west of UTC

**Recommendation:**

1. Add a small `util.js` loaded early (`downloadBlob`, `initials`, `parseLocalDate`/`isoOf`) and route the copies through it.
2. Longer term, load the portfolio, whiteboard, benefits, lessons, trend and mindmap scripts on first navigation with `import()`, as `ribbon.js` and `collab-session.js` already do.

### 5. The render pipeline does far more work than a keystroke needs

What each edit did, after a 1 s debounce:

- **A hidden server round trip.** `render()` POSTed `/render`, which parses, schedules and builds an ASCII table for `#editorOutput`, and that element is `display:none`. Views waited for the response, so offline, or on a 429 or 5xx, edits reached no view. **Fixed here.**
- **Every view re-renders.** `updateAllViews` runs about 45 updaters whether or not their view is visible. Benefits was listed twice. **The duplicate is fixed here.**
- **Some hot paths were super-linear. Fixed here:**
  - Kanban's parse was O(n³): 4.0 s at 1,000 tasks.
  - `parseTaskLine` recursed along every `*` chain, on every keystroke in the dependency field.
  - Gantt rebuilt a name map once per row.
  - PBS stacked new wheel listeners on every update.
- **Double renders.** 13 call sites do `dispatchEvent('input')` and then `setTimeout(renderText, 10)`, which renders twice. There is no sequence guard, so a slow render can overwrite newer views; `collab-join.js` already has a `renderSeq` that could be reused.
- **Whole-editor redraws.** Each keystroke rebuilds the whole editor gutter and syntax overlay, tokenises every line twice, and mirrors the text into the hidden Kanban editor, which then rebuilds too.
- **The whiteboard renders while hidden.** Once opened, it rebuilds every note on every render even when hidden, and parses the plan six or more times per pass.

**Recommendation:**

1. Add a coalescing `requestRender()` with a sequence number.
2. Mark hidden views dirty and render them when they are shown. `views-timeline.js:836` already works this way.
3. Rebuild the editor gutter only when the line count changes.

### 6. The backend blocked its only event loop and kept unbounded state

- **Blocking routes.** Every route was `async def` but called synchronous parse, schedule and export code. One PPT export (1 s here, about 10 s on the Pi) stalled collab relaying, AI streaming and `/health`. **Fixed here.**
- **Rate limiter.** Its stores kept every IP ever seen. **Eviction fixed here.** It also trusts the first `X-Forwarded-For` hop, which a client behind Cloudflare controls. Rotating that header bypasses both the API limit and the 10-per-minute guard on the 6-digit collab join code. This needs a deployment decision: trust `CF-Connecting-IP`, or a configured list of proxies.
- **Collab relay.**
  - It sends to each joiner in turn with no timeout, so one stalled socket stalls the whole session.
  - Sessions are uncapped, and presence pings keep abandoned sessions alive indefinitely.
  - `_generate_unique_code` loops forever once the code space is exhausted.
- **Middleware.** Six stacked `BaseHTTPMiddleware` layers, and the body-size limit trusts `Content-Length` only.

### 7. God modules

| File | Lines | Notes |
|---|---|---|
| `static/script.js` | ~17,500 | About 230 feature functions: RAID (45), budget (36), baseline (27), comms, EVM, highlights and more. It also holds `NavigationController`. `saveTask` is 246 lines and is a third hand-written copy of the task-line grammar. |
| `static/whiteboard-notes.js` | 8,128 | Rendering, six separate drag implementations, text objects, menus and the parking lot. |
| `static/views-products.js` | 4,245 | Four views. `pfRender` is 451 lines; `checkDuplicateDeliverables` (343 lines) runs on every PBS update. |
| `noodle_core/exporters.py` | ~4,050 | See theme 3. |
| `noodle_web/app.py` | 2,428 | Models, xlsx code, programme RAG and a 400-line WebSocket relay in one module. Split it into `APIRouter`s. |
| `noodle_web/ai_tools.py` | 2,476 | Rebuilds the whole front-matter block on every edit, which is the source of H3 below. |

Split these by feature along the seams listed. Several tests slice functions out of `script.js` by name, so each move has to take its tests with it.

## Fixed in the accompanying PR

Each row is one commit, with a test that fails on `main`.

**Plan format and scheduling (Python and browser)**

| Fix | Kind | Test |
|---|---|---|
| All three parsers treat any `YYYY-MM-DD` as task metadata, not only 2024–2026. From 2027 a dated task kept its date in its name and dependencies on it stopped resolving. | bug (date-bound) | corpus plan `future-year-dates.md`, checked by both engines |
| Highlights end at every other section marker. A following parking lot or estimates section was swallowed into the highlights, then duplicated on re-save. | data loss | `test_format_converter.py` |
| Dependency-loop detection and the long-chain check walk the graph iteratively. A 1,200-task chain raised `RecursionError`. | crash | `test_edge_cases.py`, `test_plan_quality.py` |
| The holiday set is normalised once per schedule, not per date calculation (2,000 tasks × 3,000 holidays: 4.2 s → 0.8 s). There is a public `is_working_day()`, and the search cap scales with the calendar, so a shutdown longer than a year no longer raises. | perf, crash | `test_edge_cases.py`, `test_plan_quality.py` |
| Excel and Planner imports write the sequential `*` before the name. Imported chains had become parallel tasks named "B *". | bug | `test_excel_importer.py`, `test_planner_import.py` |
| The rendered resource sheet shades holidays. It compared `datetime` to `date`, so never did. | bug | `test_scheduling_engine.py` |
| `yaml_to_markdown_table` delegates to `text_to_markdown_table`. It was a 240-line copy. | duplication | `test_plan_scenarios.py` |
| CLI `validate` works (it imported a module that doesn't exist), and `init` writes a plan that renders. The dead `__main__` block is removed. | bug | `test_noodle_cli.py` |

**Backend**

| Fix | Kind | Test |
|---|---|---|
| CPU- and disk-bound routes (render, parse, analyse, search, every export and import) run in the threadpool; AI tool execution runs in `to_thread`. One export no longer freezes collab relaying, AI streaming and `/health`. | perf, stability | `test_app.py`, `test_ai_tools_proxy.py` |
| One `content_disposition()` with an ASCII fallback plus `filename*`. Non-Latin-1 titles made every download a 500. The browser now reads `filename*`. | bug | `test_app.py`, `test_editor_render_offline.mjs` |
| Five AI tools that could never succeed now work: add/remove label, set/remove recurrence, update non-working day. Milestone dates are no longer dropped. | bug | `test_ai_tools.py` |
| AI `update_task` edits tokens in place. It dropped extra resources, labels, allocations, dates and progress, and wrote `%80`, which nothing reads. | data loss | `test_ai_tools.py` |
| The AI tools' task area ends at every back-matter section. `add_task` could insert a task inside "lessons learned", where it was never scheduled. | bug | `test_ai_tools.py` |
| The plain AI chat stream always ends with an `error` or `done` event. Transport failures cut the stream off. | reliability | `test_ai_service.py` |
| The rate-limit stores evict idle IPs. Every IP ever seen was kept forever. | memory | `test_security.py` |
| A multi-format ZIP includes MS Project when asked for. | bug | `test_app.py` |
| The search snippet no longer eats letters: `.strip(" via")` stripped characters, not the word. | bug | `test_app.py` |
| 20 unused imports are removed from `app.py`. | hygiene | — |

**Browser**

| Fix | Kind | Test |
|---|---|---|
| An editor render with no export no longer POSTs `/render`. That call computed a hidden ASCII table, and views waited on it, so edits did not update views offline or on a 429 or 5xx. | perf, reliability | `test_editor_render_offline.mjs` |
| One global `escapeHtml` in `state.js` that escapes quotes, plus `escapeJsAttr` for `onclick` strings. Three duplicate globals are deleted, and unescaped plan text in the RAID, Kanban breadcrumb and deliverables-matrix markup is escaped. | security | `test_escape_html.mjs` |
| The Resources-table rename is `startResourceShortnameRename`. The portfolio function of the same name overrode it, so renaming a shortname threw. A test now fails on any duplicate top-level function across the classic scripts. | bug, guard | `test_duplicate_globals.mjs` |
| Assigning a resource writes `@name` tokens. It overwrote `[depends …]` with `[name]`. | data loss | `test_assign_resource_line.mjs` |
| `PlanModel.lineIndex()` / `taskAtLine()`: Kanban's parse on a 1,000-task plan went from 4.0 s to 27 ms. | perf | `test_plan_model.mjs`, `test_kanban_board_mutations.mjs` |
| A `*` task's predecessor is named without re-parsing the chain above it. 401 lines went from 81,002 tokenizer calls to about 800. | perf | `test_previous_task_name.mjs` |
| Gantt builds its name→id map once per render, not once per row, and the duplicate `appendChild` is removed. | perf | `test_gantt_rows_render.mjs` |
| The Benefits updater runs once per `updateAllViews()`. It was listed twice. | perf | `test_update_all_views.mjs` |
| PBS attaches pan/zoom listeners once and zoom-fits only on first render. After N edits one wheel notch zoomed 1.1^N and every edit reset the view. | bug | `test_pbs_pan_zoom.mjs` |
| The portfolio risk register renders green items, so the RAG filter can show them. | bug | `test_portfolio_risks_filter.mjs` |
| About 540 lines of dead code are deleted from `script.js`: `class Task`, shadowed autocomplete handlers, and a commented-out legacy parser. | dead code | — |
| `test:js` runs every `tests/test_*.mjs`. Four test files had never run. | tests | — |
| One canonical back-matter marker list, `static/back-matter-markers.js`, held to Python's `ALL_SECTION_MARKERS` by a test. The whiteboard, parking lot, RAID, comms, highlights and baseline readers, MS Project sync, collab back-matter ops, estimating, trend report, forecasts, benefits, programme, lessons and mind map all use it. Estimates rows no longer become whiteboard notes or RAID items, and a note drag or an MS Project merge no longer deletes them. | data loss | `test_back_matter_markers.mjs` |
| Collab host and joiner handle messages one at a time. The revision moves with the editor write, a no-op replacement is still answered, and the joiner ignores stale snapshots. Two same-revision edits used to lose one and leave its joiner stuck. | reliability | `test_collab_message_order.mjs` |
| A planning session over plain HTTP says why it cannot start (no `crypto.subtle`), and a key-setup failure resets the UI instead of showing a dead join code. | reliability | `test_collab_secure_context.mjs` |
| Whiteboard group drag, pan and zoom do their DOM work once per animation frame, not once per event. Group drag used to re-parse the whole plan on every mousemove. | perf | `test_whiteboard_frame_batching.mjs` |
| Escape closes the parking lot after a quick reopen. | bug | `test_whiteboard_parking_lot_escape.mjs` |
| Raw NUL bytes in three scripts are written as `\u0000`, so git diffs them as text rather than binary. | hygiene | `test_script_text_integrity.mjs` |

## Remaining findings, by priority

All of these were verified by reading the code; the ones marked **bug** were also reproduced. Line numbers are at `6feed32`.

### High

| # | Area | Finding | Where | Suggested fix | Risk |
|---|---|---|---|---|---|
| H1 | core | **Bug.** Export formats give different dates for the same plan (theme 3), and MSPDI and `.mpp` assume Mon–Fri for the finish. | `exporters.py` ×5, `mpp_writer.py:92`, `msproject.py:117-138, 442`, `plan_quality.py:253`, `plan_service.py:713` | One `schedule_plan()` for every exporter. Finish is `finish - 1 day`, clamped to start. | medium |
| H2 | web | **Bug.** Mind-map edits rebuild the whole outline from the tree. They drop dependencies, labels, comments and milestone dates: `Design @alice 3d [depends: Kickoff] !urgent #ux` comes back as `Design @alice 3days 0%`. | `mindmap.js:1823-1908` | Edit only the affected line through `NoodlePlanModel`, as `estimating.js` does. | medium |
| H3 | web | **Bug.** The AI front-matter tools rebuild the whole block. That flattens nested maps (`dependencies:`, `settings:`) and writes a second, differently-cased `resources:` key. | `ai_tools.py:66-172` | Edit only the target list's lines, in place. | medium |
| H4 | web | **Bug.** Anthropic as the provider fails whenever a plan is open. The tool path sends an OpenAI-shaped body (no `max_tokens`, OpenAI tool schema) to `/messages` and reads `choices` back. | `ai_service.py:240-336` | A provider adapter: payload, tool schema, response parser. | medium |
| H5 | web | The rate limiter trusts the client-controlled first `X-Forwarded-For` hop, so the limit and the collab join-code guard can be bypassed. | `security.py:119-131` | Trust `CF-Connecting-IP`, or the rightmost untrusted hop from a `TRUSTED_PROXIES` setting. | low–medium |
| H6 | web | **Bug.** Browser and server read the plan format differently: a bare `---`, flat holidays, blank lines, CRLF, `settings:`, headings and tables (theme 1). | `local-parse.js:60-170`, `format_converter.py:149` | Shared rules, and a conformance test that calls `localParse()`. | medium |
| H7 | core | **Bug.** Forward dependencies are silently ignored. `A [depends B]` written above B starts today, before B. | `scheduling_engine.py:549`, `scheduler.js` | Schedule in topological order, warn on cycles, regenerate the corpus. | medium–high |
| H8 | core | Holidays and calendars are expanded one day at a time. One `0001-01-01:9999-12-30` line makes 3.65M dates (3.5 s and 327 MB per parse), and `…:9999-12-31` raises an uncaught `OverflowError`. | `front_matter_parser.py:230`, `exporters.py:200-228`, `calendar_model.py:161`, `msproject.py:825`, `excel_importer.py:160` | Store sorted intervals and look them up with bisect; cap the span. | medium |
| H9 | web | The collab joiner has no reconnect. Any disconnect discards unconfirmed edits, and the code must be retyped. | `collab-join.js:205, 672` | Reconnect with backoff, and rebase pending edits on the first snapshot. | medium |
| H10 | web | **Bug.** The back-matter writers that rebuild every section keep a trailing parking lot or estimates section only by accident, and `updatePlanBaselineText` can drop estimates (theme 2). | `script.js` `updatePlanBaselineText`, `syncBenefitsToPlanText`, the comms, lessons and budget syncs | One `splitBackMatter()` / `joinBackMatter()`. | medium |

### Medium

| # | Area | Finding | Where | Suggested fix |
|---|---|---|---|---|
| M1 | core | **Bug.** MSPDI import breaks on multi-line notes and creates a phantom task. Four "tasks → markdown" writers each have their own shortname rules. | `msproject.py:1015`; `excel_importer.py:673, 1450` | One escaping `emit_task_line()`. |
| M2 | core | **Bug.** Resource load is calculated four ways. The Excel sheet spreads effort over calendar days, including weekends and the exclusive finish. | `exporters.py:711, 2758-2783`, `renderers.py:136`, `plan_quality._check_over_allocation` | One `daily_load(tasks, calendar_for)` built on `date_math`. |
| M3 | core | Front matter is parsed 8+ times per request, each copy with different rules. | `front_matter_parser.py`, `exporters.py:350-523`, `format_converter.py:84, 149`, `plan_service.py:139, 357-399` | One cached, section-aware `FrontMatterParser`. |
| M4 | web | **Bug.** PBS matches children with `startsWith(task.parent)`, so the children of "Design" count towards "Design Review". That feeds rollup, RAG, the deliverables matrix and roles. | `views-products.js:115-155` | An exact parent→children index. |
| M5 | web | **Bug.** The deliverables matrix differs between screen and Excel: one uses rolled-up percent, the other the task's own. | `views-products.js:1083-1231` vs `browser-excel.js:767-846` | One matrix model in `plan-reports.js`. |
| M6 | web | **Bug.** `settings:` swallows keys appended after it. Changing a setting resets `version` and moves `last_saved` into settings. | `settings.js:24-72, 116-151`; `script.js:30, 52` | Use `NoodleFrontMatter`, which already round-trips safely. |
| M7 | web | **Bug.** The legacy Task Inspector scheduler turns `2w` into 2 days, strips lag, ignores holidays, and depends on the timezone. | `script.js:2308-2345, 2348` | Read `lastRenderedTasks` by key. |
| M8 | web | **Bug.** The undo manager stringifies up to 100 full-plan snapshots per pause, overflowing sessionStorage silently. A pending snapshot can also land in the next project's stack. | `editor-undo.js:39-46, 99, 110` | Persist on `pagehide`, cap by bytes, bind the project id when the snapshot is scheduled. |
| M9 | web | Linked-file saves drop the link on any error, and writes aren't serialised. | `local-file-access.js:340-384` | Route through `writeLinkedFile` with a per-handle queue. |
| M10 | web | `projectCache` mirrors NoodleStore but refreshes only every 5 minutes, and two callers write back from it. | `multi-plan-loader.js:7, 567`; `portfolio-projects-table.js:908`; `portfolio-leveling.js:334` | Thin wrappers over `NoodleStore`. |
| M11 | web | `parseAllProjects` re-POSTs every project on every portfolio tab switch. With 15 projects the rate limit is hit after about 7 switches, and projects silently drop out. | `multi-plan-loader.js:412` | Memoise by id and text hash; add an LRU on `PlanService.parse` keyed on text and today's date. |
| M12 | web | "Open in project" is implemented five ways, some racy: a fixed 300 ms wait, polling. | `portfolio-lookahead.js:553`, `portfolio-actions.js:346`, `portfolio-risks.js:399-530`, `portfolio.js:193-268` | One `async openInProject()` that awaits the load. |
| M13 | web | The collab relay has no per-joiner timeout, sessions are uncapped, pings keep dead sessions alive, and the code generator can loop forever. | `app.py:2305-2338`, `collab_session.py:289-400` | A bounded queue per joiner, a session cap, and no `touch()` on ping. |
| M14 | web | If the host types while applying a joiner's edit, the snapshot sent back may not match that joiner's text, and the joiner waits for an answer that never comes. | `collab-session.js`, `collab-join.js` | Ack by revision, not by text equality. |
| M15 | web | The old collab op protocol (`plan_op`, `backmatter_op`, RAID and back-matter snapshots) is still encrypted and sent to every joiner on every edit. No client reads it. | `collab-session.js:950-986, 1175-1188`; `collab-backmatter-ops.js` | Stop sending it, then delete the accept paths. |
| M16 | web | Pan/zoom is implemented five times with different clamps and steps, and whiteboard drag six times. | `views-products.js`, `mindmap.js`, `benefits.js`, `portfolio-benefits.js`; `whiteboard-notes.js`, `-groups`, `-noodles`, `-dep-noodles`, `-row-drag` | `createPanZoom()`, and `wbGesture()` on Pointer Events. |
| M17 | web | The whiteboard rebuilds every note on every render even when hidden, and parses the plan 6+ times per pass. The object-toolbar rAF loop runs whenever anything is selected. | `script.js:1823`, `whiteboard-notes.js:1988-2401`, `whiteboard-object-toolbar.js:149` | Skip while hidden, diff notes, parse once. |
| M18 | web | Non-passive window-level `touchmove`/`mousemove` listeners are registered at load, on every page. | `whiteboard-notes.js:3049-3301`, `whiteboard-row-drag.js:483`, `whiteboard-groups.js:904` | Attach on gesture start. |
| M19 | web | Gantt info rows and the Tasks table are about 170 near-identical lines that have drifted apart: only Gantt has keyboard and touch editing. | `views-gantt.js:674-850`, `views-tables.js:1883-2075` | One `buildTaskInfoRow()` and a delegated listener. |
| M20 | web | Six stacked `BaseHTTPMiddleware` layers. The body-size limit trusts `Content-Length`, and a non-numeric value returns 500. | `app.py:228-253`, `security.py:293` | One pure ASGI middleware. |
| M21 | ops | Production runs `--reload` with bind mounts and without `ENVIRONMENT=production`. Error responses leak detail, and touching any file drops every collab session. The image also installs dev dependencies. | `docker-compose.yml`, `Dockerfile:50,60` | A compose override for dev; `uv sync --no-dev`. This is a deployment decision, so it is not in the PR. |
| M22 | ci | `engine-conformance.yml` and `markdown-roundtrip.yml` re-run tests the main jobs already run, at a full runner each. | `.github/workflows` | Drop them, or keep only `--check`. |
| M23 | tests | The 8 legacy Selenium files each start their own uvicorn and Chrome, and between them contain 152 `time.sleep` calls (44 s by literal sum). | `tests/test_*usability*`, `tests/test_whiteboard_*` | Port them to `tests/ui` using `expect` auto-waits. |

### Low

- **Search:** comms results read `title` and `purpose`, but comms items have `activity` and `content`. Every comms hit is titled `#id`, and its text is never searched (`app.py` `search_plan`).
- **Resource parsing:** `@alice, @bob` parses to the resources string `"alice,, bob"`.
- **Date maths:** a negative `add_working_days` on a calendar with no working days loops forever.
- **CLI:** `noodle render` uses the file name as the project title instead of the front-matter title.
- **Dead Python code:**
  - `scheduling_engine.RAID_COLUMN_WIDTHS` shadows the one in `exporters`.
  - `date_math.parse_duration`, `calculate_resource_allocation` and `parse_named_non_working_days` are used only by tests.
  - `create_database.py` imports psycopg2, which is not a dependency.
  - `bcrypt` and `pyjwt` are declared but never imported.
- **Dead JS code:**
  - Functions: `pbsRenderDependencyArrows`, `showKanbanMessage`, `benRenderColumnLabels`, `addBenefitItem`, `benStatusClass`, `resolveResourceName`, `generateChangeLog`, `getWeekNumber`, `browserExcelEnabled`, plus the `pfCollapsedGroups` variable.
  - The regex fallback in `editor-sync.js`, which only runs without `NoodlePlanModel` and so never runs in the app.
  - The inline block at `index.html:4115-4139`, which calls a nonexistent `updateLineNumbers()`.
- **Repository clutter:**
  - `requirements-webapp.txt` is stale: it lists fasthtml, has no fastapi, and nothing references it.
  - `todo.md` (120 KB, mode 755), `plan.md`, `CODE_REVIEW_SUMMARY.md`, `UI_CODE_REVIEW.md`, `noodleplanner-icons.*` and `archive/` sit at the root.
  - `pytest.ini`'s `[coverage:*]` sections are ignored by coverage.py.
  - CLAUDE.md cites `tests/test_usability.py`, which has moved to `tests/ui/`.
- **Duration docs:** `plan-syntax.rst:80-88` says `Nd` means calendar days and `Nw` weeks, and lists `2years`. Both engines treat `d` as working days, make `1w` seven working days, and don't recognise `years`. Decide which is intended.
- **Silent exception handlers:** `msproject.py:1103` and `plan_quality.py:343, 842-860`. The last reports any scheduling exception as a circular dependency.
- **Quadratic lookups:**
  - `_propagate_resource_to_children` (`metadata.py:706`)
  - the assignment dedupe (`mpp_writer.py:156`)
  - `msproject.py:1195`
  - the linear `resource_by_uid`
- **Collab chat** re-renders all 500 entries per message, and "Host updated the plan" entries flood out real chat (`collab-chat.js:111`, `collab-session.js:1138`).
- **`diffHunks`** has no size cap and allocates an n×m `Uint32Array` (`collab-merge.js:49`).
- **Page weight:** 85 synchronous scripts, and no response compression.

## Suggested order for what remains

1. **Stop the remaining data loss:** H2 (mind map), H3 (front-matter tools), H10 (back-matter writers), M6 (`settings:`), M1 (MSPDI notes).
2. **One pipeline per language:** H1 (`schedule_plan()`), then M3 and a back-matter splitter.
3. **Conformance:** H6. Extend the corpus to front matter and `localParse`, then retire the tokenizer, legacy scheduler, Obsidian and iOS copies (theme 1).
4. **Render pipeline:** `requestRender()` with a sequence guard, and hidden views marked dirty (theme 5).
5. **Backend robustness:** H5, M13, M20, M21. The deployment items need a decision from the owner.
6. **Split the god modules** along the seams in theme 7, one feature per PR, moving tests with them.
