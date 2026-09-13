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

# Does Playwright already have the build it wants? Ask Playwright, rather than
# guessing at a path: executable_path is the exact binary it will launch.
playwright_has_browser() {
  uv run python - <<'PY' 2>/dev/null
import os, sys
from playwright.sync_api import sync_playwright
try:
    with sync_playwright() as p:
        sys.exit(0 if os.path.exists(p.chromium.executable_path) else 1)
except Exception:
    sys.exit(1)
PY
}

# Install only when it is actually missing. On a fresh CI runner that downloads
# ~150MB and is the right thing to do; where a browser is already provisioned
# (PLAYWRIGHT_BROWSERS_PATH, as some sandboxes and our own runner image set) the
# download is wasted, and behind restricted egress it simply fails.
if playwright_has_browser; then
  ci_log "Playwright already has its Chromium build"
elif ci_step "install Chromium for Playwright" \
       uv run playwright install --with-deps chromium; then
  :
else
  # Which of the two this is matters. On a CI runner an install that cannot
  # complete is a broken runner and must be loud, because `--strict` in the
  # workflow treats a skip as a pass -- so skipping here would quietly turn a
  # gate into nothing. On a developer machine behind a proxy it is an
  # environment limit, and saying so beats a red run nobody can act on.
  if [ -n "${CI:-}" ]; then
    ci_die "Playwright could not install a browser on a CI runner -- this gate cannot run"
  fi
  ci_skip "Playwright has no usable browser and cannot download one \
(restricted egress?); point PLAYWRIGHT_BROWSERS_PATH at a matching build to run this locally"
fi

# -n auto is pytest-xdist: the UI tests are independent and each drives its own
# browser context, so they parallelise across cores cleanly.
ci_step "pytest tests/ui" \
  ci_pytest -p no:cacheprovider tests/ui -n auto "$@"
