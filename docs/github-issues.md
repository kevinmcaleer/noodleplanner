# GitHub Issues for Canvas Connection Bug

## Bug: Editing Product Details Breaks Canvas Connections
- **Description:** Editing a product's description or other details would break or remove parent-child connections in the canvas.
- **Status:** Fixed
- **Resolution:** Backend now only updates parent/child (plan_id) and order if explicitly provided. Editing other fields is safe.
- **Files:** routes.py, planning_room.html, canvas.js
- **How to Test:** See `docs/connection-bug-fix.md` and `tests/test_connection_bug.py`.

## Issue: Gantt Chart Output and Timeline Improvements (2025-08-26)
- **Description:** Enhancements made to the Gantt chart output and timeline features in the scheduling engine.
- **Status:** Resolved
- **Resolution:** 
  - Implemented Gantt chart output in the scheduling engine.
  - Added Task ID column and week start date heading row to the Gantt chart.
  - Inserted a horizontal line after the Gantt chart heading for clarity.
  - Updated documentation and changelog for the new feature.
  - Ensured all outputs are visually aligned and readable.
