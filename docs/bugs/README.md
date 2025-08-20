# Bug Tracking

This directory centralizes bug documentation for the NoodlePlanner project.

## Purpose
- Provide a single place to record discovered defects.
- Ensure each bug is reproducible (clear steps, expected vs actual).
- Link each bug to a regression test once fixed.
- Track status and prevent reoccurrence.

## File Structure
- `open/` – Newly discovered or in-progress bugs.
- `fixed/` – Bugs that have been resolved (with commit / PR reference).
- `template.md` – Standard template to file a new bug.
- `index.md` – Catalog / table of all bugs with status.

## Workflow
1. Copy `template.md` into `open/` with the next sequential ID (e.g. `BUG-0005-some-title.md`).
2. Fill out all required sections before starting fix work.
3. When fixed, move the file to `fixed/` and append Fix Details section (commit hash, PR link, test name).
4. Update `index.md` tables.
5. Add / update automated tests under `tests/` matching the provided suggested test names.

## Tagging
All bug markdown files should include a front‑matter block with `type: bug` so they can be filtered or parsed.

## Test Naming Convention
`test_bug_<zero-padded-id>_<short_slug>`

Example: `test_bug_0003_canvas_disconnect.py`

## Automation (Future Ideas)
- Script to auto-update `index.md` from front‑matter.
- Pre-commit hook verifying each fixed bug references a test.
