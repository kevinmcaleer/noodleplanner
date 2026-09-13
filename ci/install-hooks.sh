#!/usr/bin/env bash
# Point this checkout's git hooks at ci/hooks, so the hooks are version
# controlled rather than living only in one person's .git directory.
#
#   ci/install-hooks.sh            install
#   ci/install-hooks.sh --uninstall  put it back
#
# core.hooksPath is set rather than files being copied into .git/hooks: a copy
# goes stale the moment ci/hooks/pre-push changes, and silently. It is also set
# per-checkout, which matters here because every worktree shares one .git and
# would otherwise share the setting too.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

if [ "${1:-}" = "--uninstall" ]; then
  git config --unset core.hooksPath 2>/dev/null || true
  echo "hooks uninstalled (core.hooksPath cleared; git's default .git/hooks is back)"
  exit 0
fi

current=$(git config --get core.hooksPath || true)
if [ -n "$current" ] && [ "$current" != "ci/hooks" ]; then
  echo "core.hooksPath is already set to '$current'." >&2
  echo "Leaving it alone -- move your hooks into ci/hooks and re-run, or clear it first." >&2
  exit 1
fi

chmod +x ci/hooks/* 2>/dev/null || true
git config core.hooksPath ci/hooks
echo "core.hooksPath = ci/hooks"
echo
echo "git push now runs ci/run.sh first. To skip once: git push --no-verify"
