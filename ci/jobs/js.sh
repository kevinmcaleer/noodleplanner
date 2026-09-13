#!/usr/bin/env bash
# The JavaScript suites -- node --test over the ~45 files listed in
# package.json's test:js script.
#
# The browser libraries are vendored into static/vendor, but these tests import
# the npm originals to check the two agree, so the dev dependencies have to be
# installed even though the app itself has no bundler.
. "$(dirname "$0")/../lib.sh"

ci_setup_node

# The suite is ~840 tests and node's TAP reporter interleaves failures into the
# stream, so on a red run the failing names are buried thousands of lines above
# the end. That is fine in a terminal and useless everywhere else: a CI log
# viewer opens at the tail, GitHub's API returns the tail, and ci/run.sh prints
# the tail. So collect the failures and re-print them last.
log=$(mktemp)
trap 'rm -f "$log"' EXIT

set +e
ci_step "npm run test:js" npm run --silent test:js 2>&1 | tee "$log"
# [0] is npm, [1] is tee -- and tee essentially always succeeds.
rc=${PIPESTATUS[0]}
set -e

if [ "$rc" != 0 ]; then
  printf '\n%s\n' "${CI_BOLD}--- failing tests${CI_OFF}"
  # TAP marks a failure as "not ok <n> - <name>". Subtests and their parent file
  # both report, so the same failure can appear twice at different depths.
  grep -E '^ *not ok [0-9]+ - ' "$log" | sed -E 's/^ */  /' | sort -u
  printf '\n%s\n' "  $(grep -cE '^ *not ok [0-9]+ - ' "$log") not-ok line(s); $(grep -E '^# (fail|tests) ' "$log" | tr '\n' ' ')"
fi

exit "$rc"
