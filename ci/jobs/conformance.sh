#!/usr/bin/env bash
# Two engines schedule a plan: the Python one in noodle_core (CLI and server)
# and the JavaScript one in static/engine (browser). A shared corpus -- plans
# in, scheduled output out -- keeps them honest, and divergence fails here.
# See issue #793 and tests/fixtures/conformance/.
. "$(dirname "$0")/../lib.sh"

ci_setup_python
ci_setup_node

# The expectations are generated from the Python engine, so a change there
# shows up as a stale corpus rather than as a mismatch blamed on the browser.
ci_step "the corpus is up to date with the Python engine" \
  uv run scripts/build_conformance_corpus.py --check

ci_step "the Python engine still matches the corpus" \
  ci_pytest tests/test_conformance_corpus.py -q -p no:cacheprovider

ci_step "the browser engine matches the corpus" \
  node --test tests/test_engine_conformance.mjs

ci_step "the browser engine matches Python on dates and the task grammar" \
  node --test tests/test_engine_date_math.mjs tests/test_engine_tokeniser.mjs
