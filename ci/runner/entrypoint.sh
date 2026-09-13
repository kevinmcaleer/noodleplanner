#!/usr/bin/env bash
# Register this container as an ephemeral self-hosted runner, run one job, exit.
#
# Ephemeral is the point. A long-lived runner accumulates state between jobs --
# a node_modules from another branch, a half-synced .venv, a leftover process on
# a port -- and those produce exactly the failures nobody can reproduce.
# `--ephemeral` makes the runner take one job and deregister, and
# docker-compose's `restart: always` brings up a clean one behind it.
#
# The registration token is short-lived (one hour) and has to be minted per
# registration, so it is fetched here from the PAT rather than baked in.
set -euo pipefail

: "${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY, e.g. kevinmcaleer/noodleplanner}"
: "${RUNNER_TOKEN:?set RUNNER_TOKEN to a PAT that can administer the repository}"

RUNNER_NAME=${RUNNER_NAME:-"noodle-$(hostname)-$$"}
RUNNER_LABELS=${RUNNER_LABELS:-self-hosted,linux,noodle}

api() {
  curl -fsSL -X "$1" \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${RUNNER_TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runners/$2"
}

echo "Requesting a registration token for ${GITHUB_REPOSITORY}..."
reg_token=$(api POST registration-token | jq -r .token)
[ -n "$reg_token" ] && [ "$reg_token" != "null" ] \
  || { echo "Could not mint a registration token -- check RUNNER_TOKEN's scopes" >&2; exit 1; }

./config.sh \
  --unattended \
  --url "https://github.com/${GITHUB_REPOSITORY}" \
  --token "$reg_token" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work _work \
  --ephemeral \
  --replace

# An ephemeral runner deregisters itself after its job, but a container stopped
# mid-job (a deploy, a reboot) would otherwise leave a ghost runner listed on
# the repository until GitHub times it out.
cleanup() {
  echo "Removing runner registration..."
  rm_token=$(api POST remove-token | jq -r .token) || return 0
  ./config.sh remove --token "$rm_token" || true
}
trap cleanup EXIT INT TERM

./run.sh
