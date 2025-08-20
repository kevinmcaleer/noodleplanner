---
id: BUG-0004
status: fixed
type: bug
severity: medium
priority: P2
reported: 2025-08-20
reported_by: @kevinmcaleer
area: ui, backend
component: product ordering / update endpoint
version: 0.1.0
regression: false
related: []
---

# Editing product details broke parent-child canvas connections

## Summary

Editing a product's non-structural fields (e.g. description) previously disrupted or removed its parent-child relationship in the canvas. Now only explicit parent (plan_id) or ordering (sort_order) changes will modify hierarchy; other field edits are safe.

## Root Cause

The `update-product-order` endpoint updated structural fields even when not explicitly provided, causing unintended resequencing or parent changes when saving other metadata.

## Fix Details

- Endpoint now conditionally updates `plan_id` and `sort_order` only if keys are present in payload.
- Added selective update logic for non-structural fields.
- Re-sequencing logic only triggers when `plan_id` or `sort_order` is supplied.

## Verification

Manual tests:

1. Create parent and child product.
2. Edit child description only -> hierarchy unchanged in list & canvas.
3. Change child parent -> hierarchy updates correctly and canvas reflects change.

Automated: regression test `tests/test_bug_0004_connection_integrity.py` verifies non-structural edits preserve hierarchy; structural edits resequence correctly.

## References

- Commit: 2a0dbc7 (fix & regression tests)
- File: `routes.py` (`update_product_order`)
- Doc: `docs/connection-bug-fix.md`
