---
id: BUG-0003
status: fixed
type: bug
severity: medium
priority: P2
reported: 2025-08-20
reported_by: @kevinmcaleer
area: ui
component: planning_room template
version: 0.1.0
regression: false
related: []
---

# Flow Diagram tab does not activate & raw tab logic text displayed

## Summary

Flow tab JavaScript was rendered as literal text at the bottom of the Planning Room; clicking the Product Flow Diagram tab did nothing.

## Root Cause

Tab switching code block was outside a `<script>` tag so browser treated it as plain text; event handlers never registered.

## Fix Details

- Wrapped tab switching code in `<script>` tag and refactored into functions (`activatePBS`, `activateFlow`).
- Updated regression test `tests/test_bug_0003_tab_switching.py` to assert the logic is inside script tags (no raw comment text rendered).

## Verification

- Manual: Clicking Flow tab hides PBS container and shows flow iframe.
- Automated: Test suite passes (24 tests).

## Post-Deploy Steps

None.

## References

- Commit: 934b9fb4a614da24a7de3abd18c87089eff8e707
