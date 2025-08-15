# User Story: Hierarchical Product List and Canvas Sync

## Story
As a user, I want to visually arrange and manage products for my project using a hierarchical list and a live-updating canvas, so I can intuitively organize my project breakdown structure.

## Acceptance Criteria
- I can drag and drop products in a tree to reorder or nest them (jsTree integration)
- I can rename, add, and delete products inline, with all changes persisted to the backend
- The order and hierarchy are always saved and reflected in the database (persistent `sort_order` and parent)
- All move, indent, and outdent actions are handled by backend endpoints and update the UI instantly
- The canvas always matches the product list order and hierarchy, updating live after any change
- The product list is fully expanded by default
- Only authenticated users can access and modify the planning room

## Notes
- See also: `feature-planning-room.md` and `feature-planning-canvas.md` for technical details
- All CRUD and move operations are backend-driven and reflected instantly in the UI and canvas
