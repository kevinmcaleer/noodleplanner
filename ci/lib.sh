# ci/lib.sh -- shared plumbing for the job scripts in ci/jobs.
#
# Sourced, never executed. Every job script starts with:
#
#     . "$(dirname "$0")/../lib.sh"
#
# What this file exists to guarantee: a job behaves identically whether it was
# started by a pre-push hook, by `ci/run.sh`, or by a GitHub Actions step on a
# self-hosted runner. That is the whole point of keeping the job bodies here
# rather than in workflow YAML -- the YAML became the only place the steps were
# written down, which meant "reproduce CI locally" was guesswork.

set -euo pipefail

CI_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$CI_DIR/.." && pwd)
cd "$REPO_ROOT"

# The CLAUDE.md worktree trap, applied unconditionally. `noodle_core` and
# `noodle_web` are installed editable against absolute paths into the main
# checkout, so a worktree that inherits that .venv runs `main`'s Python while
# you think you are testing your branch. Putting this checkout's sources first
# on PYTHONPATH makes every run test the tree it was started from, which is
# also what a CI runner wants.
for pkg in noodle-core noodle-cli noodle-web; do
  if [ -d "$REPO_ROOT/packages/$pkg/src" ]; then
    PYTHONPATH="$REPO_ROOT/packages/$pkg/src${PYTHONPATH:+:$PYTHONPATH}"
  fi
done
export PYTHONPATH

# Never write .pyc into a checkout a runner will reuse, and never let a stale
# pytest cache decide what runs.
export PYTHONDONTWRITEBYTECODE=1

_ci_t0=$(date +%s)

_ci_colour() {
  # Colour only when attached to a terminal: runner logs and CI annotations
  # are read as plain text and escape codes make them worse.
  if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then printf '%s' "$1"; fi
}
CI_RED=$(_ci_colour $'\033[31m')
CI_GREEN=$(_ci_colour $'\033[32m')
CI_YELLOW=$(_ci_colour $'\033[33m')
CI_BOLD=$(_ci_colour $'\033[1m')
CI_OFF=$(_ci_colour $'\033[0m')

ci_log()  { printf '%s\n' "${CI_BOLD}==>${CI_OFF} $*"; }
ci_warn() { printf '%s\n' "${CI_YELLOW}warning:${CI_OFF} $*" >&2; }
ci_die()  { printf '%s\n' "${CI_RED}error:${CI_OFF} $*" >&2; exit 1; }

# ci_step <description> <command...>
#
# Runs one command, announcing it first and timing it. Any failure aborts the
# job (set -e), so the last line of a failed job's log is always the step that
# broke rather than a summary that has to be correlated with it.
ci_step() {
  local label=$1; shift
  local started; started=$(date +%s)
  printf '%s\n' "${CI_BOLD}--- ${label}${CI_OFF}"
  "$@"
  local rc=$?
  local took=$(( $(date +%s) - started ))
  # The branch is not redundant. Outside a pipeline set -e aborts before this
  # line, so only the ok case is ever reached -- but a job that pipes ci_step
  # into tee (js.sh, usability.sh) suppresses errexit, and there the
  # unconditional "ok" this used to print labelled a failed step as passing.
  if [ "$rc" = 0 ]; then
    printf '%s\n' "    ${CI_GREEN}ok${CI_OFF} (${label}, ${took}s)"
  else
    printf '%s\n' "    ${CI_RED}failed${CI_OFF} (${label}, ${took}s, exit ${rc})"
  fi
  return $rc
}

# ci_skip <reason> -- leave the job without failing it.
#
# Exit code 77 is the agreed "skipped" signal between a job and ci/run.sh. A
# job that cannot run (no browser on this machine, say) is not the same as a
# job that ran and found a bug, and collapsing the two is how a suite quietly
# stops testing anything.
ci_skip() {
  printf '%s\n' "${CI_YELLOW}skipped:${CI_OFF} $*"
  exit 77
}

ci_have() { command -v "$1" >/dev/null 2>&1; }

# --- dependency setup ------------------------------------------------------
#
# Both setup helpers are idempotent and cheap on a second run, because they
# are called by the pre-push hook on every push as well as by a cold runner.
# Set CI_NO_SETUP=1 to skip them entirely when you know the tree is ready.

ci_setup_python() {
  [ "${CI_NO_SETUP:-}" = "1" ] && return 0
  ci_have uv || ci_die "uv is not installed -- see https://docs.astral.sh/uv/"
  ci_step "uv sync --all-packages" uv sync --all-packages --quiet
}

# npm ci wipes and reinstalls node_modules, which costs ~30s and is pure waste
# when the lockfile has not moved. Compare the lockfile against the install
# marker and only reinstall when it is genuinely stale.
ci_setup_node() {
  [ "${CI_NO_SETUP:-}" = "1" ] && return 0
  ci_have npm || ci_die "npm is not installed -- Node 24 or newer is expected"

  local marker=node_modules/.package-lock.json
  if [ -f "$marker" ] && [ ! package-lock.json -nt "$marker" ]; then
    printf '%s\n' "    node_modules is up to date with package-lock.json"
    return 0
  fi
  ci_step "npm ci" npm ci --no-audit --no-fund
}

# Make sure Playwright can launch its Chromium, for the jobs that drive it
# (ui, storybook). Skips the job, or fails it on a CI runner, when it cannot.
ci_setup_playwright() {
  # Does Playwright already have the build it wants? Ask Playwright, rather than
  # guessing at a path: executable_path is the exact binary it will launch.
  # NOODLE_PW_CHROME, the override tests/ui/conftest.py and
  # scripts/check_storybook.py honour, counts as having one.
  if [ -n "${NOODLE_PW_CHROME:-}" ] && [ -x "${NOODLE_PW_CHROME}" ]; then
    ci_log "Playwright will launch NOODLE_PW_CHROME=${NOODLE_PW_CHROME}"
    return 0
  fi
  if uv run python - <<'PY' 2>/dev/null
import os, sys
from playwright.sync_api import sync_playwright
try:
    with sync_playwright() as p:
        sys.exit(0 if os.path.exists(p.chromium.executable_path) else 1)
except Exception:
    sys.exit(1)
PY
  then
    ci_log "Playwright already has its Chromium build"
    return 0
  fi

  # Install only when it is actually missing. On a fresh CI runner that
  # downloads ~150MB and is the right thing to do; where a browser is already
  # provisioned (PLAYWRIGHT_BROWSERS_PATH, as some sandboxes and our own runner
  # image set) the download is wasted, and behind restricted egress it simply
  # fails.
  if ci_step "install Chromium for Playwright" \
       uv run playwright install --with-deps chromium; then
    return 0
  fi

  # Which of the two this is matters. On a CI runner an install that cannot
  # complete is a broken runner and must be loud, because `--strict` in the
  # workflow treats a skip as a pass -- so skipping here would quietly turn a
  # gate into nothing. On a developer machine behind a proxy it is an
  # environment limit, and saying so beats a red run nobody can act on.
  if [ -n "${CI:-}" ]; then
    ci_die "Playwright could not install a browser on a CI runner -- this gate cannot run"
  fi
  ci_skip "Playwright has no usable browser and cannot download one \
(restricted egress?); point PLAYWRIGHT_BROWSERS_PATH at a matching build, or \
NOODLE_PW_CHROME at a Chromium, to run this locally"
}

# Resolve a browser for the jobs that drive one. Honours an explicit CHROME_BIN,
# then the usual system names, then the Playwright download cache
# (PLAYWRIGHT_BROWSERS_PATH) -- the same search order
# tests/test_ribbon_simple_view.py and docs/capture_screenshots.py already use.
# Prints the path, or nothing and returns non-zero.
#
# This answers "can the usability job run at all", and nothing more. The test
# files each do their own discovery and do not read CHROME_BIN, so exporting it
# does not redirect them -- it is advisory until the Playwright migration gives
# them one shared launcher. What it is good for is the skip decision: without it
# a machine with no browser runs 238 tests that every one of them skips, and
# reports that as a pass.
ci_find_browser() {
  if [ -n "${CHROME_BIN:-}" ] && [ -x "${CHROME_BIN}" ]; then
    printf '%s' "$CHROME_BIN"; return 0
  fi
  local name
  for name in chromium chromium-browser google-chrome google-chrome-stable chrome; do
    if ci_have "$name"; then command -v "$name"; return 0; fi
  done
  # Playwright's cache holds two builds. Take the full browser, never
  # headless_shell: chromedriver cannot drive the shell, so preferring it makes
  # every Selenium test skip on a machine that does have a usable Chromium.
  local pw=${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}
  if [ -d "$pw" ]; then
    local found
    found=$(find "$pw" -maxdepth 3 -type f \
      \( -name chrome -o -name chromium \) 2>/dev/null | sort | head -n 1)
    [ -n "$found" ] && { printf '%s' "$found"; return 0; }
  fi
  return 1
}

# Jobs run `pytest` through uv so they pick up the workspace's dev
# dependencies, but fall back to a bare pytest where uv is absent.
ci_pytest() {
  if ci_have uv; then uv run pytest "$@"; else pytest "$@"; fi
}
