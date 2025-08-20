---
id: ENH-0001
status: fixed
type: enhancement
severity: low
priority: P3
reported: 2025-08-20
reported_by: @kevinmcaleer
area: ui
component: product details panel
version: 0.1.0
regression: false
related: []
---

# Product details panel overlapping navigation/logout

## Summary

The product details side panel previously started at the very top of the viewport, covering the navigation/logout area when expanded.

## Enhancement

Offset panel below the navigation bar so it only covers the content area. Converted panel to `position: fixed` with `top: var(--nav-height)` and adjusted height to `calc(100% - var(--nav-height))`.

## Implementation

- Added CSS variable `--nav-height: 64px`.
- Changed panel `top` and `height` to respect nav height.
- Slightly adjusted toggle button vertical alignment.

## Verification

Manual UI check: logout button remains visible; panel scrolls independently.

## References

- Commit: (fill after commit)
- File: `templates/planning_room.html`
