---
id: BUG-0001
status: open
type: bug
severity: high
priority: P1
reported: 2025-08-20
reported_by: @kevinmcaleer
area: ui
component: canvas, product tree
version: 0.1.0
regression: false
related: []  # other bug IDs or feature IDs
---

# Reordering of products in the list does not update the canvas

## Summary
When moving existing products around in the treeview, it does not update the canvas with the new order

## Environment
- Browser: Chrome
- OS: macOS
- Backend commit:
- Database schema version (if applicable):

## Steps to Reproduce
1. Open the product tree view.
2. Drag and drop a product to a new position in the list.
3. Observe the canvas for any updates.

## Expected Result
The canvas should reflect the new order of products as they are rearranged in the tree view .

## Actual Result
New order is reflected only in the product list tree view

## Impact
Incorrect display of product order in the canvas, leading to user confusion

## Attachments / Evidence


## Suspected Cause (Optional)
The update to the canvas is not being triggered after reordering the products in the tree view.

## Workaround
None

## Suggested Tests


## Additional Notes

## Fix Details (Fill When Resolved)
- Fixed in commit:
- PR / Merge Request:
- Added / updated tests:
- Schema or migration changes:
- Post-deploy verification steps:
