#!/usr/bin/env bash
# The fast Python gate: everything except the browser-driven suites.
#
# `-m "not usability"` is the whole reason this job is seconds rather than
# minutes -- the browser tests are ~18 minutes of the suite and ~18 seconds is
# the rest. They are not lost, they run in ci/jobs/browser.sh.
#
# The npm dev dependencies are installed here too, and they are not incidental:
# the browser/Python Excel and MS Project parity tests are ordinary pytest
# tests that shell out to Node and import the npm originals to check they
# agree with the copies vendored into static/vendor.
. "$(dirname "$0")/../lib.sh"

ci_setup_python
ci_setup_node

ci_step "pytest (excluding the browser suites)" \
  ci_pytest -p no:cacheprovider -m "not usability" "$@"
