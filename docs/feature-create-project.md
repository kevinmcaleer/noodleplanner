# Feature: Create New Project

## Description
Allow users to create new projects from the projects page. A textbox and button will be provided above the project list. The backend will validate and store the new project, associating it with the logged-in user.

## Tasks
- [ ] Add a textbox and button to the projects page for new project creation
- [ ] Implement backend route to create a new project for the current user
- [ ] Validate that the project name is not empty
- [ ] Update the project list after creation

## Related User Stories
- docs/story-create-project.md

## Notes
- Only authenticated users can create projects.
- Provide user feedback for errors (e.g., empty name).
