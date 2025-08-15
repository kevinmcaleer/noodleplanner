
# Feature: Planning Room & Canvas (2025-08-15)

## Overview
The planning room and canvas provide a hierarchical, interactive product breakdown structure for each project. Key features include:

- Hierarchical product list with drag-and-drop, powered by jsTree
- Persistent `sort_order` for products, maintained in the database
- All move, indent, and outdent logic handled by backend endpoints
- Product list and canvas order always match, with live updates after any change
- Canvas auto-expands and draws classic vertical tree layout with elbow lines
- All CRUD operations (add, rename, delete) are backend-driven and reflected instantly in the UI
- Product list is fully expanded by default
- Export product list hierarchy to Excel/CSV via a hamburger menu above the product list

## Endpoints

- `POST /projects/move-product-up/{product_id}`: Move a product up in its sibling order
- `POST /projects/move-product-down/{product_id}`: Move a product down in its sibling order
- `POST /projects/indent-product/{product_id}`: Indent a product (make it a child of its previous sibling)
- `POST /projects/outdent-product/{product_id}`: Outdent a product (move it up a level)
- `POST /rename-product/{product_id}`: Rename a product
- `POST /projects/delete-product/{product_id}`: Delete a product
- `POST /projects/update-product-parent/{product_id}`: Update a product's parent and sort order

## Data Model

- Each product has a `sort_order` (integer, unique within its parent), a `plan_id` (parent product or null), and a `project_id`.
- All ordering and hierarchy changes are persisted in the database and reflected in the UI.

## UI Integration

- The product list uses jsTree for drag-and-drop, inline renaming, and CRUD.
- The canvas reads the product hierarchy and order from the backend and updates live after any change.
- All nodes are rendered in a classic vertical tree layout, with elbow lines connecting parents and children.

## Testing

- Full test coverage for CRUD, move, indent, outdent, and ordering logic.
- See `tests/test_products_crud_and_order.py` for examples.
