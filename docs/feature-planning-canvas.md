# Feature: Planning Canvas (Project Breakdown Structure)

## Description
A visual canvas for arranging and connecting products as nodes, allowing users to build a hierarchical breakdown structure for each project. Nodes can be moved, connected, and assigned a type (group or product). The hierarchy flows top to bottom. This is based on the Prince2 concept of a product breakdown structure (PBS).

## Tasks
- [ ] Create a new planning canvas page accessible from the planning room or project view
- [ ] Display all products for the selected project as draggable nodes on the canvas
- [ ] Place the products on the canvas so that they are not overlapping
- [ ] Allow nodes to be moved freely on the canvas (but not overlap)
- [ ] Add handles (top, left-middle, bottom) to each node for creating connections
- [ ] Enable users to connect nodes to form parent-child relationships (breakdown structure)
- [ ] Support two product types: group (can contain other products) and product (leaf node)
- [ ] Persist node positions and connections in the database
- [ ] Ensure only authenticated users can access and modify the canvas
- [ ] Add tests for node movement, connection, and persistence

## Related User Stories
- docs/story-planning-canvas.md

## Notes
- Hierarchy flows top to bottom (breakdown structure)
- Canvas will be extended later for left-to-right dependency flow
- UI should be intuitive and support drag-and-drop and connection creation
