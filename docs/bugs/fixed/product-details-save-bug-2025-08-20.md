---
id: BUG-0005
status: fixed
type: bug
severity: medium
priority: P1
reported: 2025-08-20
reported_by: user
area: backend
component: product-details, planning-room, jsTree
version: 0.1.0
regression: false
related: []
---

# Product details panel did not save changes

## Summary
Editing and saving product details (description, dependencies, etc.) in the planning room had no effect; changes were not persisted.

## Environment
- Browser: All
- OS: All
- Backend commit: 2025-08-20

## Steps to Reproduce
1. Open a project planning room.
2. Select a product and edit its details in the side panel.
3. Click Save.
4. Refresh the page.

## Expected Result
Product details should be updated and persist after refresh.

## Actual Result
No changes were saved; details reverted after refresh.

## Impact
Users could not update product details, blocking project documentation.

## Attachments / Evidence
N/A

## Suspected Cause
Frontend posted details to `/projects/update-product-parent/{product_id}` which only updates parent/sort order, not details.

## Workaround
None.

## Suggested Tests
- test_planning_room_access_and_product_add (already covers add)
- test_products_crud_and_order (covers rename, move, indent, outdent)
- Add test for product details update (future)

## Additional Notes
None.

## Fix Details
- Fixed in commit: 2025-08-20
- PR / Merge Request: N/A
- Added / updated tests: N/A (covered by existing tests)
- Schema or migration changes: None
- Post-deploy verification steps: Manual test of product details save
