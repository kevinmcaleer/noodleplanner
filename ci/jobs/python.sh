#!/usr/bin/env bash
# The fast Python gate: everything except the browser-driven suites.
#
# `-m "not usability and not ui"` is the whole reason this job is seconds rather
# than minutes -- the browser tests are ~18 minutes of the suite and ~18 seconds
# is the rest. They are not lost: the Playwright ones run in ci/jobs/ui.sh and
# the remaining Selenium ones in ci/jobs/usability.sh.
#
# `not ui` is there so a checkout with no Playwright browser installed reports
# nothing rather than a screenful of skips.
#
# The npm dev dependencies are installed here too, and they are not incidental:
# the browser/Python Excel and MS Project parity tests are ordinary pytest
# tests that shell out to Node and import the npm originals to check they
# agree with the copies vendored into static/vendor.
. "$(dirname "$0")/../lib.sh"

ci_setup_python
ci_setup_node

# `-n auto` is pytest-xdist across every core the runner has. These tests are
# independent and the box is otherwise idle for the length of the job, so the
# only thing serial execution buys is wall clock: 16.6s -> 8.7s on four cores
# here, same 1726 passed and 9 skipped either way. It matters more than the
# absolute numbers suggest, because this is the gate every push waits on.
#
# `--dist load` (xdist's default) rather than `loadfile`, unlike
# ci/jobs/usability.sh: nothing in this selection owns a module-scoped browser
# or server that has to stay on one worker, so per-test distribution balances
# better. If that ever stops being true the symptom is a test that passes
# serially and fails here, and the fix is `--dist loadfile`, not `-n 0`.
#
# Before "$@" so a caller can still override it -- `ci/run.sh -j1 python -- -n 0`
# gets a serial run for debugging, because pytest takes the last -n it is given.
ci_step "pytest (excluding the browser suites)" \
  ci_pytest -p no:cacheprovider -m "not usability and not ui" -n auto "$@"
