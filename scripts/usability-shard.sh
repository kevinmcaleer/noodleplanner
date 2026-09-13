#!/usr/bin/env bash
#
# Print the Selenium test files belonging to one shard, one per line.
#
#   scripts/usability-shard.sh <shard> <shards>
#
# The `pytest (usability)` job is by far the longest thing CI runs -- 226
# tests, ~16m37s -- because every one of them drives a real browser. Sharding
# it across runners is the only lever that helps while the files are still on
# Selenium; `tests/ui` gets its speed from not going near the network instead
# (see tests/ui/README.md).
#
# Two details matter for the split to be worth anything:
#
#   * The file list is discovered, never hardcoded. Files leave this suite as
#     they are ported to tests/ui, and a stale list would silently stop running
#     something. Asking pytest which files carry the `usability` marker means
#     the shards follow the port automatically.
#   * Files go to whichever shard is lightest so far, heaviest file first.
#     They are wildly uneven -- 50 tests in test_usability.py against 8 in
#     test_whiteboard_parking_lot.py -- so the cheap round-robin lands 87
#     tests on one shard and 38 on another, and the slowest shard is what you
#     wait for. Longest-processing-time-first balances the same ten files to
#     50/57/58/61, turning a 2.6x into a 3.7x for the same runners.
#
# Sharding is by file, not by test, and the job pairs this with
# `--dist loadfile` rather than xdist's default. That is not only about each
# file owning a module-scoped Chrome and uvicorn, though it does: some of these
# tests only pass in file order. `test_usability.py`'s
# `TestPlanRendering::test_render_does_not_show_error` fails when run on its
# own and passes as part of its file, so it is relying on state an earlier test
# leaves behind. Per-test distribution (`--dist load`) reorders exactly that
# and turns the file red -- measured: 1 failed, 49 passed. `--dist loadfile`
# hands a whole file to one worker, in collection order, and the suite stays
# green: 51 tests across four files, four workers, all passing.
#
# The cost is that a shard holding a single file cannot use more than one
# worker. Shard 1 is that shard today, with test_usability.py's 50 tests, and
# it is what bounds this job's wall clock. Fixing the order dependency in that
# file would lift the bound; until then, more shards will not help it.
set -euo pipefail

SHARD="${1:?usage: usability-shard.sh <shard> <shards>}"
SHARDS="${2:?usage: usability-shard.sh <shard> <shards>}"

# `-o addopts=` clears pytest.ini's -v, which would otherwise override -q and
# print the tree view instead of the one-node-per-line list this parses.
mapfile -t FILES < <(
  uv run pytest -p no:cacheprovider -o addopts= -m usability --collect-only -q 2>/dev/null \
    | grep '::' \
    | cut -d':' -f1 \
    | sort | uniq -c | sort -rn \
    | awk '{print $2}'
)

if (( ${#FILES[@]} == 0 )); then
  exit 0
fi

# COUNTS[i] is the test count for FILES[i]; both are already sorted heaviest
# first by the pipeline above.
mapfile -t COUNTS < <(
  uv run pytest -p no:cacheprovider -o addopts= -m usability --collect-only -q 2>/dev/null \
    | grep '::' \
    | cut -d':' -f1 \
    | sort | uniq -c | sort -rn \
    | awk '{print $1}'
)

# Greedy LPT: each file joins the shard with the least work on it so far.
declare -a LOAD
for (( s = 0; s < SHARDS; s++ )); do LOAD[s]=0; done

for i in "${!FILES[@]}"; do
  lightest=0
  for (( s = 1; s < SHARDS; s++ )); do
    if (( LOAD[s] < LOAD[lightest] )); then lightest=$s; fi
  done
  LOAD[lightest]=$(( LOAD[lightest] + COUNTS[i] ))
  if (( lightest == SHARD - 1 )); then
    printf '%s\n' "${FILES[$i]}"
  fi
done
