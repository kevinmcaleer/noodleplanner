---
id: BUG-0003
status: open
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
At the bottom of the Planning Room page the tab switching JavaScript appears as literal text (e.g. the line starting with `// Tab switching logic ...`). Clicking the "Product Flow Diagram" tab does nothing; the PBS view remains visible and the flow iframe stays hidden.

## Environment

- Browser: (multiple – reproducible in Chrome)
- OS: macOS
- Backend version: 0.1.0

## Steps to Reproduce

1. Open a project Planning page `/projects/<id>`.
2. Scroll to the bottom of the page.
3. Observe plain text block beginning with `// Tab switching logic`.
4. Click the "Product Flow Diagram" tab.

## Expected Result

- Tab code should be executed (not printed) so clicking the Flow tab hides PBS container and shows flow container.
- No raw JavaScript source should be displayed in page body.

## Actual Result

- Raw JavaScript source is rendered as text.
- Clicking the Flow tab has no effect.

## Impact

Users cannot access the Flow Diagram view; UI looks unpolished due to exposed code.

## Suspected Cause

The tab switching JS snippet is outside a `<script>` tag in `templates/planning_room.html`, so the browser renders it as text instead of executing.

## Workaround

None (manual DOM manipulation via dev tools required).

## Suggested Fix

Wrap the tab switching code in a `<script>` tag (or move into an existing DOMContentLoaded block) and remove the stray comment text. Example:

```html
<script>
document.addEventListener('DOMContentLoaded', function() { /* existing logic */ });
</script>
```

## Suggested Tests

- `test_bug_0003_tab_switching.py`: Fetch planning room HTML; assert no literal "Tab switching logic" text and that the script defines `flowTab.onclick`.

## Additional Notes

Consider consolidating script blocks to reduce duplication and ensure ordering.

## Fix Details (Fill When Resolved)

- Fixed in commit:
- PR / Merge Request:
- Added / updated tests:
- Post-deploy verification: Click Flow tab; iframe becomes visible; PBS container hidden.
