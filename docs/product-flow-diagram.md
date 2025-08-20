# Product Flow Diagram Feature

## Overview
The Product Flow Diagram is a new interactive canvas view that visualizes product dependencies as a left-to-right flow, using Bezier ("noodle") connections. Unlike the Product Breakdown Structure (PBS), which is hierarchical, the flow diagram allows products to have multiple parents and children, supporting complex dependency graphs.

## Key Features
- Tabbed interface: Switch between PBS and Product Flow Diagram canvases.
- Interactive left-to-right layout for product flow.
- Products can be connected with Bezier (noodle) lines to represent dependencies.
- Products can have multiple parents and children (many-to-many relationships).
- Dependencies are stored in a new `dependencies` table in the database.
- All products from the product list are available as nodes in the flow diagram.
- Drag-and-drop to create, edit, or remove dependency connections.
- Live update of the flow diagram as dependencies are changed.

## Database Changes
- New `dependencies` table:
  - `id` (PK)
  - `from_product_id` (FK to products)
  - `to_product_id` (FK to products)
  - (Optionally: type, notes, etc.)

## User Stories

### 1. View Product Flow Diagram
- As a user, I can switch to the Product Flow Diagram tab to see all products as nodes, arranged left-to-right, with connections showing dependencies.

### 2. Create Dependency
- As a user, I can drag from one product to another to create a dependency (noodle connection), which is saved in the database.

### 3. Remove Dependency
- As a user, I can click a connection and delete it, removing the dependency from the database and updating the diagram.

### 4. Edit Dependency
- As a user, I can select a connection to edit its properties (if any, e.g., type or notes).

### 5. Sync with Product List
- As a user, any changes to products (add, rename, delete) are reflected in the flow diagram in real time.

### 6. Multiple Parents/Children
- As a user, I can create products with multiple parents and children, and the diagram will display all valid connections.

### 7. Export Flow
- As a user, I can export the flow diagram as an image or data file for documentation or sharing.

---

## Next Steps
- Design the new dependencies table and update the database schema.
- Implement the tabbed UI and new canvas for the flow diagram.
- Build interactive Bezier connection logic for dependencies.
- Add backend endpoints for managing dependencies.
- Ensure real-time sync between product list, PBS, and flow diagram.
