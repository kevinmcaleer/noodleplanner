#!/usr/bin/env bash
# The design-system gates (#1195, epic #1187).
#
# Three checks, all fast and none needing a browser:
#
#   scripts/lint-design-system.mjs   hardcoded colours, off-scale spacing,
#                                    unpaired `outline: none`, and --np-* tokens
#                                    declared outside visual-system.css
#   scripts/check-contrast.mjs       every token pairing the app renders, against
#                                    WCAG 2.2 AA
#   scripts/design-tokens.mjs        the Penpot-owned tokens in visual-system.css
#     --check                        match docs/design/tokens/, Penpot's export,
#                                    and nobody has hand-edited one (#1318)
#
# ## Why this can gate a push on day one
#
# The linter is a ratchet, not a threshold. There are ~1,950 pre-existing
# violations recorded in ci/design-system-baseline.json, and it fails only when
# a count goes up or a new finding appears. So a push that changes no CSS
# cannot fail this, a push that pays down debt passes and is told to lower the
# baseline, and a push that adds a hardcoded colour is named and blocked. That
# is the property a plain threshold does not have, and it is the reason this
# job is in CI_BLOCKING_JOBS rather than sitting alongside `usability` as
# reporting-only.
#
# If it turns out noisy in practice, removing `design` from CI_BLOCKING_JOBS in
# ci/run.sh downgrades it to reporting without deleting anything.
#
# The contrast check has no baseline and is absolute: 58 pairings, all passing.
# A token change that puts body text below 4.5:1 or a focus ring below 3:1 is a
# regression with no legitimate version, so there is nothing to ratchet.
. "$(dirname "$0")/../lib.sh"

# Node only. Neither script imports anything from node_modules -- they read the
# CSS directly -- but ci_setup_node is what guarantees a usable node at all.
ci_setup_node

rc=0

ci_step "design-system lint" node scripts/lint-design-system.mjs || rc=1
ci_step "token contrast (WCAG AA)" node scripts/check-contrast.mjs || rc=1
ci_step "Penpot tokens generated" node scripts/design-tokens.mjs --check || rc=1

exit "$rc"
