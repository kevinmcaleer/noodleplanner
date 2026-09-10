#!/bin/bash
# Installs what the test suites need, so a Claude Code on the web session can
# run them without a manual setup step first.
#
# The Python workspace is usually already synced in the remote image, but the
# npm dev dependencies are not -- and tests/test_pptx_browser_export.mjs and
# friends import the npm originals (jszip, pptxgenjs, docx, exceljs, ...) to
# check they agree with the copies vendored into static/vendor. Without them
# those suites fail on a missing package rather than on anything real.
set -euo pipefail

# Local sessions manage their own checkout.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install, not npm ci: it reuses what is already there, so the cached
# container state after the first run makes later sessions cheap.
if command -v npm >/dev/null 2>&1; then
  echo "Installing npm dev dependencies..."
  npm install --no-audit --no-fund
else
  echo "npm not found; skipping JavaScript dev dependencies." >&2
fi

if command -v uv >/dev/null 2>&1; then
  echo "Syncing the Python workspace..."
  uv sync --all-packages
else
  echo "uv not found; skipping the Python workspace." >&2
fi

echo "Ready: uv run pytest / npm run test:js"
