#!/usr/bin/env bash
# Storybook builds, and every story in it renders (#1197, epic #1187).
#
# Two steps, because the build alone proves less than it looks like it does.
# `storybook build` bundles the stories without running them, so a story that
# throws when it renders -- a gallery section that was renamed, a component
# that fails to upgrade -- builds green and shows a red error screen to the
# next person who opens it. scripts/check_storybook.py loads every story from
# the build in Chromium, in both themes, and fails on that screen or on any
# uncaught exception. It also checks that the States story's forced :hover and
# :focus-visible columns actually differ from the default column, which is the
# one thing a clean render does not prove.
#
# Gating, like `ui`: ~5s to build and about a minute and a half to render ~94
# stories twice, and a broken story has no legitimate version.
. "$(dirname "$0")/../lib.sh"

ci_setup_node
ci_setup_python
ci_setup_playwright

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

ci_step "storybook build" npm run --silent build-storybook -- --quiet -o "$out"
ci_step "render every story" uv run python scripts/check_storybook.py "$out"
