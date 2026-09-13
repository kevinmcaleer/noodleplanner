#!/usr/bin/env bash
# The JavaScript suites -- node --test over the ~45 files listed in
# package.json's test:js script.
#
# The browser libraries are vendored into static/vendor, but these tests import
# the npm originals to check the two agree, so the dev dependencies have to be
# installed even though the app itself has no bundler.
. "$(dirname "$0")/../lib.sh"

ci_setup_node

ci_step "npm run test:js" npm run --silent test:js
