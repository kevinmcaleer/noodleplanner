#!/usr/bin/env bash
# Markdown is the canonical plan format (issue #771). This guard fails if any
# change makes opening and saving an unedited plan alter it beyond the
# front-matter keys the app maintains. See docs/reference/plan-format.rst for
# the guarantee.
. "$(dirname "$0")/../lib.sh"

ci_setup_python
ci_setup_node

ci_step "server side -- parse never rewrites an unedited plan" \
  ci_pytest tests/test_markdown_roundtrip.py -q -p no:cacheprovider

ci_step "browser side -- app-maintained keys are single-line, in-place edits" \
  node --test tests/test_markdown_roundtrip.mjs
