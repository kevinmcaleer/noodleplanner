---
id: BUG-0002
status: fixed
type: bug
severity: medium
priority: P1
reported: 2025-08-20
reported_by: @kevinmcaleer
area: auth, persistence
component: db, app lifecycle
version: 0.1.0
regression: false
related: []
---

# User accounts not persisted across app restart

## Summary

Previously, after restarting the application, registered user accounts appeared unusable for login despite rows existing in the database.

## Root Cause

`DATABASE_URL` was a relative path causing different working directories (tests vs. server) to reference separate or missing files. Lifespan hooks recreated tables masking persistence. Tests also recreated or removed the DB.

## Fix Details

- Introduced absolute DB path with environment override (`NOODLEPLANNER_DB`) in `db.py`.
- Added regression test: `tests/test_bug_0002_user_persistence.py` ensuring user can login after simulated restart.
- Ensured test cleans up and restores default DB state to avoid cross-test interference.

## Verification

- Regression test passes.
- Full suite: 23 tests all passing.

## Post-Deploy Steps

Restart app; confirm previously created users can still login.

## References

- Commit: 102e87f499cb9d09845fb821f9c39830d50b6e01

