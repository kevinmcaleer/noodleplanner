# Scripts

## sync_bugs.py

Automates maintenance of the bug tracking markdown structure.

Behavior:

- Parses front-matter of markdown files under `docs/bugs/open` and `docs/bugs/fixed`.
- Moves files into the correct folder based on `status` (open/in-progress -> `open/`; fixed/closed/wontfix -> `fixed/`).
- Extracts a commit hash (first 8 chars) from lines mentioning a commit and populates the index Fixed column.
- Rewrites `docs/bugs/index.md` with updated table and metrics.

Usage:

```bash
python scripts/sync_bugs.py
```

Add as a pre-commit hook (optional) by creating `.git/hooks/pre-commit`:

```bash
#!/bin/sh
python scripts/sync_bugs.py
git add docs/bugs/index.md docs/bugs/open docs/bugs/fixed
```

Future enhancements (ideas):

- Derive regression rate from reopened bugs log.
- Validate required fields (severity, priority, component).
- Integrate with GitHub issues via API.
