
# User Story: Planning Room, Hierarchical Product List, and Canvas

## Story
As a user, I want to visually manage a hierarchical list of products for my project using drag-and-drop, inline renaming, and CRUD, so I can organize my project breakdown structure efficiently. I want all changes to be instantly reflected in a visual canvas and persisted in the backend.

## Acceptance Criteria
- The planning room displays a hierarchical product list using jsTree, with drag-and-drop, inline renaming, and CRUD.
- The order and hierarchy of products are persisted in the database using a `sort_order` field and parent references.
- All move, indent, and outdent actions are handled by backend endpoints and update the UI live.
- The canvas always matches the product list order and hierarchy, updating instantly after any change.
- The product list is fully expanded by default.
- All CRUD operations (add, rename, delete) are backend-driven and reflected instantly in the UI and canvas.
- Only authenticated users can access the planning room and modify products.

## Notes
- The backend provides endpoints for all product operations, including move, indent, outdent, and rename.
- The UI uses jsTree for the product list and a custom canvas for visualizing the hierarchy.
- See also: `feature-planning-room.md` and `feature-planning-canvas.md` for technical details.
