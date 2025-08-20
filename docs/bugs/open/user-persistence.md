---
id: BUG-0002
status: open
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

When the application restarts, previously registered user accounts are not usable for login even though rows exist in the `users` table. A test user is re‑added, but custom users appear missing logically.

## Environment

- OS: macOS
- Backend version: 0.1.0
- DB: SQLite file `test.db`

## Steps to Reproduce

1. Start app
2. Register a new user (e.g. `bob`).
3. Stop the app process.
4. Restart the app.
5. Attempt to login as `bob`.

## Expected Result

Login succeeds using existing persisted credentials.

## Actual Result

Login fails (or appears reset) despite user row present in database.

## Impact

Users may believe data is lost after restarts.

## Suspected Cause

`DATABASE_URL` was a relative path; running the server from different working directories or test isolation removed file. Additionally automatic test DB recreation on lifespan may mask existing users.

## Workaround

None (must re-register user each restart).

## Suggested Tests

- `test_bug_0002_user_persistence.py`: Register a user, simulate app restart (re-import app / call lifespan), assert login still works.

## Additional Notes

Ensure DB path stability and avoid wiping user rows on normal restart.

## Fix Details (Fill When Resolved)

- Fixed in commit:
- PR / Merge Request:
- Added / updated tests:
- Schema or migration changes: none
- Post-deploy verification steps: restart app and login with pre-existing user.
