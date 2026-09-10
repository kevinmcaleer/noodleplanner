# CLAUDE.md — Notes for AI-assisted development

## Project overview

NoodlePlanner is a browser-based project planning tool. The main app is a
FastAPI backend (`packages/noodle-web`) serving a single-page HTML/JS frontend.
Documentation is built with Sphinx and lives in `docs/`.

## Key directories

- `packages/noodle-web/src/noodle_web/` — web app (templates, static assets, API)
- `docs/` — Sphinx documentation (tutorials, how-to, reference, explanation)
- `tests/` — pytest test suite including Selenium usability tests

## Working on a goal: always use a worktree

**Never do the work in `/home/kev/noodleplanner` itself.** When you pick up a
goal, an issue, or any change beyond a read, create your own worktree first:

```bash
cd /home/kev/noodleplanner
git fetch origin
git worktree add /home/kev/noodleplanner-worktrees/<name> -b <type>/<issue>-<slug> origin/main
cd /home/kev/noodleplanner-worktrees/<name>
ln -s /home/kev/noodleplanner/node_modules node_modules
```

Two independent reasons, both of which have bitten real sessions:

1. **That checkout is live production.** `docker-compose.yml` bind-mounts
   `./packages` and `./templates` into the running `noodleplanner` container
   with `--reload`. Any edit to a tracked file under those paths — even
   uncommitted, even on a feature branch — is served to real traffic
   immediately. There is no review step between your editor and the site.
2. **`main` moves fast.** Branches cut from a stale `origin/main` drift far
   enough that the work has to be rebuilt. One session branched, built a
   feature, opened a PR, and only discovered at merge time that `main` had
   moved 81 commits and another PR had already rewritten the same file. Always
   `git fetch` immediately before `git worktree add`, and branch from
   `origin/main`, not from a local `main` that may be behind.

Branch naming follows the repo's history: `feat/842-msproject-sync-preserve-sections`,
`fix/minimal-timeline-sub-summary-parent-rows`, `docs/cloudflare-tunnel-credentials`.

### Check for drift before you push

`main` can move underneath you mid-task. Before opening a PR:

```bash
git fetch origin && git rev-list --left-right --count origin/main...HEAD
```

The left number is how far behind you are. If it is not small, merge
`origin/main` in and re-test **before** pushing — a green PR built on a stale
base can still be wrong, because CI only checks the merge, not whether someone
has since rewritten what you touched.

### Traps in a worktree

- **The symlinked `.venv` tests the wrong source.** `noodle_core` and
  `noodle_web` are installed editable against absolute paths pointing back at
  `/home/kev/noodleplanner`, so running pytest from a worktree silently
  exercises `main`'s Python, not yours. When your change touches `.py` files,
  prefix the run:

  ```bash
  PYTHONPATH="$(pwd)/packages/noodle-core/src:$(pwd)/packages/noodle-web/src" pytest
  ```

  Pure-JS changes tested with `node --test` are unaffected.
- **Add `-m "not usability"` for a fast run.** The 238 Selenium tests are the
  whole cost of the suite: ~18 minutes with them, under 20 seconds without.
  They skip anyway wherever no browser is reachable, so deselecting them
  explicitly costs nothing locally and makes the run usable as a quick check.
  CI runs them in their own non-blocking `pytest (usability)` job.
- **`git add -A` stages the `node_modules` symlink.** `.gitignore` has
  `node_modules/` with a trailing slash, which does not match a symlink of that
  name. Check `git status --short` for an `A node_modules` line before
  committing.
- **Run your own server on a non-8007 port.** 8007 is the production
  container. Start uvicorn from the worktree with the `PYTHONPATH` above so it
  serves the worktree's static files rather than `main`'s.
- **Compare test failures against `main` before blaming your change.** The
  suite has pre-existing failures (Selenium tests especially). Run the same
  files on a clean `main` checkout and diff the failure sets.

### When it is merged

```bash
git worktree remove /home/kev/noodleplanner-worktrees/<name>
git branch -d <branch>
```

Leave `/home/kev/noodleplanner` on a clean `main` at all times.

## Session naming for `/goal`

When a session's `/goal` condition names a GitHub issue number (e.g. "complete 777"),
rename the Claude session to that issue's title so it's identifiable in the desktop/web
session manager instead of showing only the issue number or a generic auto-generated name:

1. Look up the issue with `mcp__github__issue_read` (`method: "get"`) to get its title.
2. Get this session's id with `mcp__Claude_Code_Remote__get_session` (omit `session_id` to
   target the current session).
3. Call `mcp__Claude_Code_Remote__set_session_title` with that id and a title of the form
   `#<issue> <issue title>` (e.g. `#777 Multiple named baselines with a management UI`).

Do this once, early — right after picking up the goal, before starting the actual work —
not on every `/goal` tick. These `Claude_Code_Remote` MCP tools are only available when the
session is running through Claude Code on the web/desktop (cloud sessions); skip this step
if they aren't present.

## Documentation screenshots

Screenshots used in the Sphinx docs are stored in `docs/_static/img/` and are
captured automatically by `docs/capture_screenshots.py`.

**When to re-capture:** after any change to the UI layout, navigation, views,
or front-matter handling, run:

```bash
cd docs && make screenshots
```

This requires a running NoodlePlanner instance at `http://localhost:8007`
(or pass `--base-url` to the script).

The screenshot script uses headless Chrome via Selenium — the same setup as
`tests/test_usability.py`.

## Reminders

- **Work in a worktree, never in `/home/kev/noodleplanner`.** See the section
  above — that checkout is bind-mounted into the live production container,
  and `main` moves fast enough that a stale branch means rework.
- **Update screenshots when features change.** If you modify a view, add a
  navigation element, or change the editor, re-run `make screenshots` so the
  docs stay accurate. Check the RST files under `docs/` for `.. figure::`
  directives that reference screenshots.
- **Name the session after the issue when `/goal` targets one.** See
  "Session naming for `/goal`" above — rename the session to `#<issue> <title>`
  so it's easy to find in the session manager.
