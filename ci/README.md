# CI we own

NoodlePlanner's CI is a handful of shell scripts in this directory. The GitHub
Actions workflows are thin wrappers around them, and so is the pre-push hook, so
there is exactly one definition of "the checks" and it lives in the repository.

Two things drove this. The repository is private, so GitHub-hosted Actions
minutes are metered and we ran out of them. And the job bodies only existed as
workflow YAML, duplicated across three files, which meant reproducing a CI
failure locally was a matter of reading the YAML and retyping it by hand.

Self-hosted runners are not billed minutes at all, even on a private repository.
That is the other half of the fix: the same scripts, run on a machine we own.

## Running the checks

```bash
ci/run.sh                  # the four gating jobs, in parallel (~45s)
ci/run.sh --all            # those plus the non-blocking usability job
ci/run.sh python js        # just these
ci/run.sh -j1 python       # one at a time, output streaming live
ci/run.sh --list           # what exists, and which jobs gate
```

Exit status is 0 when every gating job passed. Per-job logs land in `.ci-logs/`,
and the tail of any failed log is printed inline — a summary that only names the
failure and leaves you to go and find the log is a summary you act on twice.

Every job runs under a deadline, set per job in `ci/run.sh` to mirror the
`timeout-minutes` on the matching workflow job. A job killed at its deadline
reports `TIME` and always fails, gating or not: it has told you nothing, and
unlike a failing assertion it leaves nothing in the log's tail to read.

### Why the deadlines are not decoration

`tests/test_collab_*.py` used to deadlock: pytest stopped partway through a
collab test and never returned — the Starlette `TestClient` portal problem
`pyproject.toml`'s `websockets` note describes. **Fixed on `main` in `e26843c`**,
which reports it had been killing the `pytest` job on roughly half of all runs,
`main` included.

The deadlines predate that fix and still earn their place, because a hang is the
one failure a test suite cannot report on its own. If a job reports `TIME`, read
the end of its log before assuming your branch caused it:

```bash
tail -3 .ci-logs/python.log
ci/run.sh python            # then just run it again
```

A wedged suite used to hold `git push` open indefinitely. Now it fails with a
named limit, which is the difference between a diagnosis and a mystery.

## The jobs

| Job | What it runs | Gates? |
|---|---|---|
| `python` | `pytest -m "not usability"` — the suite minus the browser tests | yes |
| `js` | `npm run test:js` — ~45 `node --test` files | yes |
| `conformance` | the Python and JavaScript scheduling engines agree (#793) | yes |
| `roundtrip` | opening and saving an unedited plan does not alter it (#771) | yes |
| `ui` | `pytest tests/ui -n auto` — the Playwright browser suite | yes |
| `usability` | `pytest -m usability` — the remaining Selenium suites | no, reports only |

`usability` is reporting-only for two reasons: it needs a real browser, so it
skips wherever none is reachable, and a known subset still asserts against UI
that has been replaced. To promote it, add it to `CI_BLOCKING_JOBS` in
`ci/run.sh` and drop `continue-on-error` from the job in
`.github/workflows/tests.yml`.

**In the workflow it runs only on runners we own** (`if: vars.CI_RUNS_ON != ''`).
It takes ~19 minutes where the four gating jobs together take ~2, so on metered
runners it is 89% of what a push costs — roughly 93 pushes a month against the
free allowance, against ~875 without it. Paying that for a job that cannot block
a merge is what exhausted the allowance, and it did so mid-run: this repository's
`tests.yml` run on `68b9c1d` never got a runner at all, and the `Engine
conformance` run created in the same second was refused at startup, right after a
19-minute usability job drained what was left. Minutes are not billed on
self-hosted runners, so once `CI_RUNS_ON` points at ours it runs on every push
again, free.

Locally it is unaffected: `ci/run.sh --all` still runs it.

It selects tests by the `usability` marker rather than by filename or by driver,
which is what lets the Selenium → Playwright migration land without touching CI:
a file keeps its `pytest.mark.usability` whichever library drives the browser.

### Adding a job

Drop a script in `ci/jobs/`. `ci/run.sh` discovers it by filename, so there is
no list to update — unless it should gate, in which case add its name to
`CI_BLOCKING_JOBS`. The shape:

```bash
#!/usr/bin/env bash
# What this guards, and why it is worth a job of its own.
. "$(dirname "$0")/../lib.sh"

ci_setup_python          # uv sync, skipped when already current
ci_step "a description" some-command --flags
```

`ci/lib.sh` gives you `ci_step` (announce, time, abort on failure), `ci_skip`
(leave without failing — exit 77, which `ci/run.sh` reports as a skip),
`ci_log`/`ci_warn`/`ci_die`, `ci_pytest`, and `ci_find_browser`. It also sets
`PYTHONPATH` to this checkout's package sources, which is the
[worktree trap from CLAUDE.md](../CLAUDE.md): the shared editable `.venv` points
at absolute paths in the main checkout, so without it a worktree silently tests
`main`'s Python instead of your branch.

## The pre-push hook

Not installed by default — a hook that appears without being asked for is a hook
people learn to bypass.

```bash
ci/install-hooks.sh              # git push now runs ci/run.sh first
ci/install-hooks.sh --uninstall
```

It sets `core.hooksPath` rather than copying files into `.git/hooks`, so the hook
cannot go stale against this directory. That setting is per-checkout, which
matters here because every worktree shares one `.git`.

Escape hatches: `git push --no-verify`, `NOODLE_SKIP_CI=1 git push`, or
`NOODLE_CI_JOBS="python js" git push` to narrow it.

## The self-hosted runners

In `ci/runner/`. Each container registers as an **ephemeral** runner, takes one
job, and exits; `restart: always` brings up a clean one behind it. A long-lived
runner accumulates state between jobs — a `node_modules` from another branch, a
half-synced `.venv`, a process still holding a port — and that produces exactly
the failures nobody can reproduce.

```bash
cd ci/runner
cp .env.example .env        # RUNNER_TOKEN=<PAT that can administer the repo>
docker compose up -d --build --scale runner=3
```

The PAT wants either fine-grained **Administration: read and write** on
`kevinmcaleer/noodleplanner` (preferred — it can do nothing else) or the classic
`repo` scope.

It is used only to mint two short-lived tokens at start-up — one to register, one
to deregister — and `entrypoint.sh` then **unsets it before starting the runner**.
That matters: everything after that point is job code, and job code can read its
own environment, so a PAT left there would hand every workflow step the ability to
administer this repository's runners.

If a job ever needs to fail because the runner could not be set up, it fails at
start-up rather than mid-suite. A bad PAT pauses 60s before exiting, so
`restart: always` retries slowly instead of hammering the API.

Replicas are the concurrency: one job each, so `--scale runner=3` means three CI
jobs at once. Three keeps a pull request's critical path at roughly the slowest
two jobs.

Deliberately a separate compose project from the repository root one. That file
is production — bringing CI up and down must not be able to restart the live
site, and a `docker compose down` in the wrong directory must not be able to take
the site with it. The containers are capped at 2 CPUs and 4 GB for the same
reason: CI and production share the host, and a test run should never be why the
site got slow.

### Switching the workflows onto them

Where the workflow jobs run is one repository variable, not a property of any
file. Once the runners are up, set `CI_RUNS_ON` to
`["self-hosted","linux","noodle"]` (Settings → Secrets and variables → Actions →
Variables). Unset it and everything goes back to `ubuntu-latest`.

**GitHub-hosted is the fallback rather than the goal, deliberately**, because the
failure modes are not symmetric. A job with no matching runner does not fail — it
queues forever. Defaulting to self-hosted would mean that from the moment this
merged, every pull request and every push to `main` stopped being testable until
the runner host happened to be up. Defaulting to `ubuntu-latest` costs metered
minutes while the variable is unset, and nothing else.

So the order is: stand the runners up, then set the variable. Unset it while the
host is down or being rebuilt, rather than waiting on a queue.

`.github/actions/setup` is what lets one workflow serve both. Our image already
carries uv, Python 3.12, Node 24 and a Chromium; a GitHub-hosted runner has Node
and Chrome but no uv at all, and without that step every job would die on
`ci/lib.sh`'s "uv is not installed" before running a test. It provisions the
machine; `ci/jobs/` defines the checks, and neither knows about the other.

### Dropping GitHub Actions entirely

Nothing in `ci/jobs/` knows it is running under Actions. If the workflows go
away, `ci/run.sh` still works from a terminal, from the pre-push hook, or from
anything that can clone and run a script — a cron job, a git `post-receive` hook
on a mirror, a small poller posting commit statuses back through the API. The
workflows are the replaceable part, on purpose.
