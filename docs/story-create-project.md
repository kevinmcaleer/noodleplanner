# User Story: Create New Project

## Story
As a logged-in user, I want to create a new project by entering a project name, so that I can start planning and managing new work.

## Acceptance Criteria
- There is a textbox and button above the projects list for creating a new project.
- The user can enter a project name and submit to create a new project.
- The new project appears in the user's project list immediately after creation.
- Project names must not be empty.
- Only logged-in users can create projects.

## Notes
- The backend should validate input and associate the project with the current user.
- Show a helpful error if the project name is empty.
