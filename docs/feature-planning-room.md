# Feature: Planning Room and Rooms Navigation

## Description
Introduce a navigation bar with the concept of rooms (pages/tabs). When a user selects a project, they enter the planning room for that project, where they can add and view products linked to the project. Products are associated with plans using the existing database model.

## Tasks
- [ ] Add a navigation bar for rooms (Projects, Planning, etc.)
- [ ] Implement backend route to fetch project details and products
- [ ] Implement backend route to add a product to a project
- [ ] Create planning room page to display project and products
- [ ] Add form to planning room to add new products
- [ ] Link products to plans in the database
- [ ] Update tests for navigation, planning room, and product management

## Related User Stories
- docs/story-planning-room.md

## Notes
- Only authenticated users can access rooms and planning features.
- The UI should make it easy to switch between rooms and select projects.
