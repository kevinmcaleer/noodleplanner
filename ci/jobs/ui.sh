#!/usr/bin/env bash
# The Playwright UI suite -- tests/ui, selected by path rather than by marker
# because that directory is the migration's destination (see tests/ui/README.md).
#
# A gating job, unlike ci/jobs/usability.sh: the three ported files cost ~135.7s
# under Selenium and ~43.5s here, which is fast enough to block a merge on.
#
# Playwright pins the browser build it expects, so there is no
# chromedriver-versus-Chrome skew to keep in step -- the thing every remaining
# Selenium file carries a `_create_chrome_driver()` workaround for, and the thing
# that makes ci/jobs/usability.sh report a skip rather than a pass.
. "$(dirname "$0")/../lib.sh"

ci_setup_python

ci_setup_playwright

# -n auto is pytest-xdist: the UI tests are independent and each drives its own
# browser context, so they parallelise across cores cleanly.
#
# `not unstable` deselects tests that are known to be catching an app defect
# nobody has fixed yet -- today exactly one, the parking lot reload test, where
# the startup restore intermittently never completes under load. This job
# gates, and a gate that goes red one run in three teaches people to ignore it.
# The tests stay in the tree and stay runnable (`-m unstable` runs just them);
# they are deselected here, not deleted, and tests/ui/README.md says why for
# each one. Anything added to this marker needs a defect written down with it.
ci_step "pytest tests/ui" \
  ci_pytest -p no:cacheprovider tests/ui -n auto -m "not unstable" "$@"
