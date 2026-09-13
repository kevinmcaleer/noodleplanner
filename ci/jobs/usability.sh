#!/usr/bin/env bash
# The browser-driven suites: every test carrying `pytest.mark.usability`.
#
# Selected by marker rather than by file list or driver name, deliberately.
# These tests are mid-migration from Selenium to Playwright, and a marker-based
# selection means that migration lands without touching CI: a file keeps its
# `pytest.mark.usability` whichever library drives the browser underneath.
#
# Named for the marker rather than for the driver, for the same reason.
#
# This job is reporting, not gating (ci/run.sh keeps it off the default set and
# the workflow marks it continue-on-error). Two reasons: the suite needs a real
# browser, so it skips wherever none is reachable, and a known subset still
# asserts against UI that has been replaced. Make it a gate by moving it into
# CI_BLOCKING_JOBS in ci/run.sh once it is green.
. "$(dirname "$0")/../lib.sh"

ci_setup_python

browser=$(ci_find_browser) || ci_skip "no Chromium/Chrome found (set CHROME_BIN to point at one)"
ci_log "driving $browser"
export CHROME_BIN="$browser"

# Finding a browser is not the same as being able to drive one: each test file
# builds its own WebDriver and calls pytest.skip() when chromedriver cannot
# start it -- version skew between a pinned Chromium and an independently
# packaged chromedriver does exactly that. pytest then exits 0 with every test
# skipped, and a job that reports "pass" for having tested nothing is worse than
# one that reports nothing at all, because it reads as coverage.
#
# So: inspect what actually ran. A run in which nothing passed and everything
# skipped is reported as a skip, not a pass.
log=$(mktemp)
trap 'rm -f "$log"' EXIT

set +e
# `-n auto --dist loadfile`: parallel within this one job, rather than split
# across several. Runner replicas are the concurrency here (ci/runner), and
# with three of them a matrix of shards would compete with the four gating jobs
# for the same slots and make a pull request slower, not faster. Cores inside a
# job are free by comparison.
#
# `--dist loadfile` rather than the default, because each file owns a
# module-scoped Chrome and uvicorn: per-test distribution would stand up a
# second browser for the same file for no benefit.
#
# It used to be load bearing for a second and worse reason -- test_usability.py
# held a test that only passed in file order, so per-test distribution turned
# the file red (1 failed, 49 passed). That file is now ported to tests/ui and
# the dependency went with it: it was Selenium's `get_log("browser")` draining
# one buffer shared by the whole module, and the port reads the console per
# page. The eight files left have not been audited for the same thing, so
# loadfile stays -- it costs nothing here and is the safe default for tests
# that share a browser.
#
# The largest remaining file is 35 of 168 tests, which is what bounds this job.
ci_step "pytest -m usability" \
  ci_pytest -p no:cacheprovider -m usability -n auto --dist loadfile "$@" 2>&1 | tee "$log"
# [0] is pytest, [1] is tee. tee all but always succeeds, so reading [1] here
# would report every failing run as a pass -- which, on the one job in this
# directory that does not gate, nothing downstream would have caught.
rc=${PIPESTATUS[0]}
set -e

if [ "$rc" = 0 ] && ! grep -qE '[0-9]+ (passed|failed)' "$log"; then
  skipped=$(grep -oE '[0-9]+ skipped' "$log" | tail -n 1)
  ci_skip "no browser test actually ran (${skipped:-everything skipped}) -- \
chromedriver could not drive $browser"
fi

exit "$rc"
