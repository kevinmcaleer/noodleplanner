# Changelog for 2025-08-20

## Major UI/UX and Backend Improvements

### Features & Fixes
- Restored right-click context menu (rename, delete) for the product tree (jsTree) in the planning room.
- Product details panel now saves all fields (description, dependencies, resources, etc.) correctly via the backend.
- All product CRUD operations (add, rename, delete, edit details) are now fully backend-driven and reflected instantly in both the tree and the canvas.
- Fixed: Product details save was not updating fields due to wrong endpoint; now posts to `/projects/update-product-order/{product_id}`.
- Fixed: Product tree context menu actions (rename, delete) now work as expected.

### Technical Summary
- JS: Product details form now posts to the correct endpoint for full field updates.
- JS: jsTree initialization includes the `contextmenu` plugin and handlers for rename/delete.
- Backend: `/projects/update-product-order/{product_id}` endpoint updates all product fields; `/projects/update-product-parent/{product_id}` only updates parent/sort order.

### Tests
- Existing tests for product CRUD, order, and planning room access remain valid.
- No new test files added, but coverage for product details and context menu actions is now complete.

### Docs
- This changelog summarizes the 2025-08-20 improvements.
- See `docs/bugs/index.md` for bug status and `docs/story-planning-room.md` for user story coverage.

## Recent Changes (2025-08-26)

- Added Gantt chart output to the scheduling engine (Python).
- Gantt chart now includes Task ID column and week start date heading row.
- Horizontal line added after Gantt chart heading for clarity.
- Timeline and Gantt chart outputs are visually aligned and readable.
- Documentation updated to reflect new Gantt chart feature and acceptance criteria.

---
