# GitHub Issues for Canvas Connection Bug

## Bug: Editing Product Details Breaks Canvas Connections
- **Description:** Editing a product's description or other details would break or remove parent-child connections in the canvas.
- **Status:** Fixed
- **Resolution:** Backend now only updates parent/child (plan_id) and order if explicitly provided. Editing other fields is safe.
- **Files:** routes.py, planning_room.html, canvas.js
- **How to Test:** See `docs/connection-bug-fix.md` and `tests/test_connection_bug.py`.
