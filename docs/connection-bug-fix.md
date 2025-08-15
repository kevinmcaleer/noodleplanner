# Canvas Connection Bug Fix

## Summary
Fixed a bug where editing a product's description (or other details) would break or remove parent-child connections in the canvas. Now, only changes to parent/child (plan_id) or order will affect connections; editing other fields is safe.

## Details
- The backend `/projects/update-product-order/{product_id}` endpoint now only updates `plan_id` and `sort_order` if they are explicitly provided in the payload.
- Editing fields like description, dependencies, etc., will not affect the product's parent or its position in the hierarchy.
- Canvas and product list remain in sync after edits.

## How to Test
1. Create a parent and child product in the UI.
2. Edit the child's description and save.
3. The connection in the canvas should remain.
4. The product list should remain in the correct order and hierarchy.

## Related Files
- `routes.py` (backend logic)
- `planning_room.html` (frontend logic)
- `canvas.js` (canvas rendering)

## Issue
This addresses the issue where connections would disappear after editing a product's details.
