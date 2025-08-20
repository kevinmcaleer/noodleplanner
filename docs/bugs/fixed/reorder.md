---
id: BUG-0001
status: fixed
type: bug
severity: high
priority: P1
reported: 2025-08-20
reported_by: @kevinmcaleer
area: ui
component: canvas, product tree
version: 0.1.0
regression: false
related: []
---

# Reordering of products in the list does not update the canvas

## Summary

When moving existing products around in the treeview, it did not update the canvas with the new order.

## Fix Details

- Fixed in commit: (fill with commit hash after commit)
- PR / Merge Request: (if applicable)
- Added / updated tests: `tests/test_bug_0001_reorder_canvas_sync.py`
- Code changes: Enhanced ordering logic in `routes.py` (`update_product_parent`, `update_product_order`) ensuring sibling resequencing and canvas data reflects updated order.
- Post-deploy verification: Manual drag & drop reorder reflected immediately in canvas; regression test passes.

## Notes

Canvas now listens to updated JSON ordering; backend ensures deterministic sibling sort_order after moves.
