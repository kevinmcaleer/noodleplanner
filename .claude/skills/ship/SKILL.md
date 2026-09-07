---
name: ship
description: Commit, push, open a pull request and merge it, end to end. Use when the user says "/ship", "ship it", "ship this", or asks to get the current work committed, pushed, PR'd and merged.
---

# /ship — get the current work merged

Takes whatever is in the working tree and carries it all the way to `main`:
commit → push → PR → checks → merge → clean up.

## Arguments

| Invocation | Meaning |
|---|---|
| `/ship` | Infer the route from the working tree and branch (see **Choosing the route**) |
| `/ship 838` | This work closes issue #838 — branch, PR and `Fixes #838` |
| `/ship --direct` | Force the straight-to-`main` route, no PR |
| `/ship --pr` | Force the branch + PR route even for feature work |
| `/ship --no-merge` | Stop after the PR is open and green; do not merge |
| `/ship "message"` | Use this as the commit subject instead of writing one |

## Choosing the route

Kevin's standing preference:

- **Feature work → straight to `main`.** Commit and push. No PR, no merge step.
- **Issue fixes → branch + PR.** Branch, commit, push, `gh pr create`, wait for
  checks, merge.

Infer it this way, and say which route you picked before doing anything:

1. `/ship <number>` or the work came from a GitHub issue → **PR route**.
2. Already on a non-`main` branch → **PR route** (the branch exists for a reason).
3. On `main`, changes are a new feature or docs → **direct route**.
4. On `main`, changes fix a bug → **PR route**; find or file the issue.

When it is genuinely ambiguous, ask — one question, then proceed.

## Procedure

### 1. Look before you commit

```bash
git status
git diff            # and git diff --staged if anything is staged
git log --oneline -5
```

- Read the actual diff. Do not commit files you did not intend to change.
- Never commit: secrets, tokens, `.env`, `settings.local.json`, large binaries,
  scratchpad files, `node_modules`.
- If unrelated changes are mixed in, stage only what belongs to this piece of
  work and say what you left behind.

### 2. Run the tests

```bash
uv run pytest          # Python suite
npm run test:js        # browser/engine suite, including the round-trip guard
```

Both must pass before you commit. If something fails, **stop and report it** —
do not commit around a failing test or mark it skipped to get green.

If the change touched UI layout, navigation, views or front-matter handling,
`CLAUDE.md` requires re-captured screenshots:

```bash
cd docs && make screenshots     # needs the app running on http://localhost:8007
```

Check the `.. figure::` directives under `docs/` that reference what changed.

### 3. Branch (PR route only)

```bash
git checkout -b <type>/<issue>-<slug>
```

Repo convention, from the merged PRs:

- `feat/842-msproject-sync-preserve-sections`
- `fix/minimal-timeline-sub-summary-parent-rows`
- `docs/cloudflare-tunnel-credentials`

Issue number included when there is one. Lowercase, hyphenated, descriptive.

### 4. Commit

Conventional-commit subject, matching the repo's history:

```
feat: schedule plans in the browser by default
fix: MS Project import preserves front matter and back-matter sections
docs: document Cloudflare tunnel credentials step in deployment guide
```

Body: why the change exists, not a restatement of the diff. Wrap at ~72 chars.

**Always end the message with the session's attribution trailers** — the
`Co-Authored-By:` and `Claude-Session:` lines given in the current session's
instructions. Use those exact values; do not copy them from an old commit.

Use a heredoc so the formatting survives:

```bash
git commit -m "$(cat <<'EOF'
fix: short subject line

Why this change was needed.

Co-Authored-By: <as given this session>
Claude-Session: <as given this session>
EOF
)"
```

### 5. Push

```bash
git push -u origin <branch>       # PR route
git push                          # direct route, on main
```

**Never** `--force` or `--force-with-lease` without the user explicitly asking
for it in that message.

On the direct route, you are done here. Report the commit and stop.

### 6. Open the PR

```bash
gh pr create --title "<same as commit subject>" --body "$(cat <<'EOF'
## Summary

What changed and why, in two or three sentences.

## Testing

- `uv run pytest` — pass
- `npm run test:js` — pass
- Manual: <what you actually clicked, or "not verified in the app">

Fixes #<issue>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<session URL as given this session>
EOF
)"
```

- `Fixes #N` only when the PR genuinely closes the issue. For partial work use
  `Relates to #N`, or the issue closes early and silently.
- If the work belongs to an epic, link the epic too.

### 7. Wait for checks

```bash
gh pr checks <number> --watch
```

Two checks guard this repo, and both must be green:

- **conformance** (`.github/workflows/engine-conformance.yml`) — the Python and
  browser scheduling engines must still agree.
- **roundtrip** (`.github/workflows/markdown-roundtrip.yml`) — a plan opened and
  saved must be byte-identical. This one catches most plan-format mistakes.

A red check means fix the code and push again. Never merge red.

### 8. Merge

```bash
gh pr merge <number> --merge --delete-branch
git checkout main && git pull
```

Merge commits, not squash or rebase — that is what this repo's history uses
(`Merge pull request #836 from kevinmcaleer/feat/793-default-on`).

**Confirm with the user before merging**, unless they said "merge it", passed
`/ship` on work they already reviewed, or told you to go end to end. Merging is
the one step here that is awkward to undo.

Stop before merging if `--no-merge` was passed.

### 9. Report

One short block: route taken, commit SHA, PR link, check results, merge state,
and anything you deliberately left out of the commit.

## Hard rules

- Never force-push, never rewrite pushed history, never `git reset --hard` on
  work that is not yours to discard.
- Never merge a PR with failing or pending checks.
- Never merge a PR you did not open in this session unless asked by number —
  #834 is Copilot's and #729, #752, #754 are older open PRs; leave them alone.
- Never commit secrets, and never disable or skip a test to get a green run.
- If the push is rejected because `main` moved, `git pull --rebase` and re-run
  the tests before pushing again. Do not force past it.
- If anything is ambiguous enough that guessing could land wrong work on `main`,
  stop and ask.
