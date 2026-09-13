#!/usr/bin/env bash
# ci/run.sh -- run NoodlePlanner's CI jobs.
#
# This is the whole CI system's front door. The same command runs the same
# checks from a terminal, from the pre-push hook, and from a GitHub Actions
# step on a self-hosted runner, so "it passed locally" and "it passed in CI"
# mean the same thing for the first time.
#
#   ci/run.sh                 the gating jobs, in parallel
#   ci/run.sh --all           those plus the non-blocking ones (usability)
#   ci/run.sh python js       only the jobs named
#   ci/run.sh --list          what jobs exist and which ones gate
#   ci/run.sh -j1 python      one at a time, streaming straight to the terminal
#   ci/run.sh --strict usability fail the run even on a non-blocking job
#
# Every job is run under a deadline (see JOB_TIMEOUT below), and that is not
# boilerplate. tests/test_collab_*.py used to deadlock -- pytest stopping dead
# partway through a collab test and never returning, the Starlette TestClient
# portal problem pyproject.toml's `websockets` note describes. That is fixed on
# main in e26843c, whose own message reports it had been killing the pytest job
# on roughly half of all runs.
#
# The deadlines outlive that one bug, because a hang is the single failure a test
# suite cannot report on its own: there is no assertion, no traceback and no exit
# status, just silence. A deadline converts that into a named limit and a log
# that ends where the work stopped.
#
# Exit status is 0 when every blocking job passed. A non-blocking job that
# fails is reported loudly and does not change the exit status -- that is what
# "non-blocking" buys, and it is the only thing it buys. A skipped job always
# passes: a job that could not run has found nothing.
#
# --strict exists for the workflow wrapper. A GitHub Actions step wants one
# job's real exit status, with "non-blocking" expressed as continue-on-error on
# the step, so that a failure is visible on the pull request rather than
# swallowed into a green check.

set -uo pipefail

CI_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$CI_DIR/.." && pwd)
cd "$REPO_ROOT"

# Colour only on a terminal. ci/run.sh's output is read as plain text in runner
# logs and in the tail a pre-push hook prints, where escape codes are noise, so
# they are resolved once here rather than hard-coded into every printf.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_OFF=$'\033[0m'
else
  C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_OFF=""
fi

# The jobs that gate a push. Everything in ci/jobs/ that is not listed here
# still runs under --all or by name, but cannot fail the run.
CI_BLOCKING_JOBS=(python js conformance roundtrip ui design)

ALL_JOBS=()
for f in "$CI_DIR"/jobs/*.sh; do
  [ -e "$f" ] || continue
  ALL_JOBS+=("$(basename "$f" .sh)")
done

is_blocking() {
  [ "${STRICT:-0}" = 1 ] && return 0
  local j
  for j in "${CI_BLOCKING_JOBS[@]}"; do [ "$j" = "$1" ] && return 0; done
  return 1
}

usage() {
  cat <<EOF
usage: ci/run.sh [options] [job ...]

options:
  --all              include the non-blocking jobs as well as the gating ones
  --strict           treat every selected job as gating (a skip still passes)
  --list             list the jobs and exit
  -j, --jobs N       run up to N jobs at once (default: as many as there are;
                     -j1 streams output live instead of buffering it)
  --timeout SECONDS  override every job's deadline (default: per job, see
                     JOB_TIMEOUT in this file)
  --log-dir DIR      where to write per-job logs (default: .ci-logs)
  --no-setup         skip uv sync / npm ci; assume the tree is already ready
  -h, --help         this

jobs:
EOF
  local j
  for j in "${ALL_JOBS[@]}"; do
    if is_blocking "$j"; then printf '  %-14s gating\n' "$j"
    else printf '  %-14s non-blocking\n' "$j"; fi
  done
}

JOBS_ARG=""

# Per-job deadlines in seconds, mirroring the timeout-minutes on the matching
# workflow jobs so a wedged job fails in the same order of time either side.
# Each is several times the job's real runtime -- the gating jobs finish in
# under a minute, `usability` takes ~20 of them -- because this is a backstop
# against a job that has stopped making progress, not a performance budget. One
# shared 30-minute ceiling would mean a deadlocked `python` job holding a push
# open for half an hour, which is the problem, not the fix.
declare -A JOB_TIMEOUT=(
  [python]=600 [js]=600 [conformance]=900 [roundtrip]=900 [ui]=600 [usability]=2100
)
JOB_TIMEOUT_DEFAULT=${CI_JOB_TIMEOUT:-900}
TIMEOUT_OVERRIDE=""

LOG_DIR=".ci-logs"
WANT=()
INCLUDE_NON_BLOCKING=0
STRICT=0

while [ $# -gt 0 ]; do
  case $1 in
    --all)      INCLUDE_NON_BLOCKING=1 ;;
    --strict)   STRICT=1 ;;
    --list)     usage; exit 0 ;;
    -j|--jobs)  JOBS_ARG=${2:?-j needs a number}; shift ;;
    -j*)        JOBS_ARG=${1#-j} ;;
    --log-dir)  LOG_DIR=${2:?--log-dir needs a path}; shift ;;
    --timeout)  TIMEOUT_OVERRIDE=${2:?--timeout needs seconds}; shift ;;
    --no-setup) export CI_NO_SETUP=1 ;;
    -h|--help)  usage; exit 0 ;;
    -*)         echo "ci/run.sh: unknown option $1" >&2; usage >&2; exit 2 ;;
    *)          WANT+=("$1") ;;
  esac
  shift
done

if [ ${#WANT[@]} -eq 0 ]; then
  if [ "$INCLUDE_NON_BLOCKING" = 1 ]; then WANT=("${ALL_JOBS[@]}")
  else WANT=("${CI_BLOCKING_JOBS[@]}"); fi
fi

for j in "${WANT[@]}"; do
  [ -x "$CI_DIR/jobs/$j.sh" ] || { echo "ci/run.sh: no such job: $j" >&2; exit 2; }
done

PARALLEL=${JOBS_ARG:-${#WANT[@]}}
[ "$PARALLEL" -ge 1 ] 2>/dev/null || { echo "ci/run.sh: -j needs a positive number" >&2; exit 2; }

mkdir -p "$LOG_DIR"

started=$(date +%s)
printf "${C_BOLD}==> %d job(s): %s${C_OFF}\n" "${#WANT[@]}" "${WANT[*]}"

declare -A PID_OF RC_OF SECS_OF DEADLINE_OF
running=0

reap_one() {
  # Wait for any one child to finish and record its result. `wait -n` would be
  # neater but reports only the status, not which job owned it, and the summary
  # has to name the job.
  local j pid
  while :; do
    for j in "${!PID_OF[@]}"; do
      pid=${PID_OF[$j]}
      if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid"; RC_OF[$j]=$?
        SECS_OF[$j]=$(( $(date +%s) - SECS_OF[$j] ))
        unset "PID_OF[$j]"
        running=$((running - 1))
        return 0
      fi
    done
    sleep 0.2
  done
}

for j in "${WANT[@]}"; do
  while [ "$running" -ge "$PARALLEL" ]; do reap_one; done
  SECS_OF[$j]=$(date +%s)
  # Deliberately NOT --foreground. That flag sounds like the right one for a
  # command started from a shell prompt, but it also stops timeout putting the
  # job in its own process group -- so the signal reaches only the job script,
  # and the pytest or node it was waiting on survives, keeps the pipe to `tee`
  # open, and the run hangs exactly as it would have with no timeout at all.
  # Tested by pointing a job at a 600-second sleep: with --foreground it ran
  # past the deadline, without it the group dies on schedule. -k follows up with
  # SIGKILL for anything that ignores SIGTERM, which a deadlocked pytest does.
  deadline=${TIMEOUT_OVERRIDE:-${JOB_TIMEOUT[$j]:-$JOB_TIMEOUT_DEFAULT}}
  run_job=(timeout -k 30 "$deadline" "$CI_DIR/jobs/$j.sh")
  DEADLINE_OF[$j]=$deadline
  if [ "$PARALLEL" = 1 ]; then
    # One at a time: let the job write straight to the terminal, and keep a
    # copy, so a long suite shows progress instead of going quiet for minutes.
    set -o pipefail
    "${run_job[@]}" 2>&1 | tee "$LOG_DIR/$j.log" &
  else
    "${run_job[@]}" > "$LOG_DIR/$j.log" 2>&1 &
  fi
  PID_OF[$j]=$!
  running=$((running + 1))
  [ "$PARALLEL" = 1 ] || printf '    started %s (log: %s/%s.log)\n' "$j" "$LOG_DIR" "$j"
done

while [ "$running" -gt 0 ]; do reap_one; done

# --- summary ---------------------------------------------------------------

failed=() skipped=() passed=() soft_failed=() timed_out=()
for j in "${WANT[@]}"; do
  case ${RC_OF[$j]} in
    0)  passed+=("$j") ;;
    77) skipped+=("$j") ;;
    # 124 is `timeout` reporting that it had to kill the job. Always a failure,
    # gating or not: a job that stopped making progress has told you nothing,
    # and unlike a failing assertion it will not show up in the log's tail.
    124|137) timed_out+=("$j"); failed+=("$j") ;;
    *)  if is_blocking "$j"; then failed+=("$j"); else soft_failed+=("$j"); fi ;;
  esac
done

printf "\n${C_BOLD}==> summary (%ds)${C_OFF}\n" "$(( $(date +%s) - started ))"
for j in "${WANT[@]}"; do
  case ${RC_OF[$j]} in
    0)  printf "  ${C_GREEN}pass${C_OFF}    %-14s %4ds\n" "$j" "${SECS_OF[$j]}" ;;
    77) printf "  ${C_YELLOW}skip${C_OFF}    %-14s %4ds\n" "$j" "${SECS_OF[$j]}" ;;
    124|137)
        printf "  ${C_RED}TIME${C_OFF}    %-14s %4ds  (killed at its %ss deadline -- %s/%s.log ends where it stopped)\n" \
          "$j" "${SECS_OF[$j]}" "${DEADLINE_OF[$j]}" "$LOG_DIR" "$j" ;;
    *)  if is_blocking "$j"; then
          printf "  ${C_RED}FAIL${C_OFF}    %-14s %4ds  (exit %s)\n" "$j" "${SECS_OF[$j]}" "${RC_OF[$j]}"
        else
          printf "  ${C_YELLOW}fail${C_OFF}    %-14s %4ds  (exit %s, non-blocking)\n" "$j" "${SECS_OF[$j]}" "${RC_OF[$j]}"
        fi ;;
  esac
done

# The tail of each failed log, inline. A summary that only names the failure
# and leaves you to go and find the log is a summary you have to act on twice.
for j in "${failed[@]}" "${soft_failed[@]}"; do
  [ "$PARALLEL" = 1 ] && break
  printf "\n${C_BOLD}--- last 40 lines of %s${C_OFF}\n" "$LOG_DIR/$j.log"
  tail -n 40 "$LOG_DIR/$j.log"
done

if [ ${#soft_failed[@]} -gt 0 ]; then
  printf "\n${C_YELLOW}non-blocking failures:${C_OFF} %s (not failing the run)\n" "${soft_failed[*]}"
fi

if [ ${#failed[@]} -gt 0 ]; then
  printf "\n${C_RED}==> %d gating job(s) failed:${C_OFF} %s\n" "${#failed[@]}" "${failed[*]}"
  exit 1
fi
if [ ${#soft_failed[@]} -gt 0 ]; then
  # Not "green". Every gating job passed, which is what the exit status says,
  # but something did fail and a one-word all-clear would bury it.
  printf "${C_YELLOW}==> gating jobs passed; %s failed without gating${C_OFF}\n" "${soft_failed[*]}"
else
  printf "\n${C_GREEN}==> green${C_OFF}\n"
fi
