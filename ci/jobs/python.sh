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

# `-n auto` is pytest-xdist. These 1726 tests are independent and share no
# browser, so the default per-test distribution is right and the only cost is a
# couple of seconds of worker startup: 15.8s to 6.2s on four cores.
ci_step "pytest (excluding the browser suites)" \
  ci_pytest -p no:cacheprovider -m "not usability and not ui" -n auto "$@"
