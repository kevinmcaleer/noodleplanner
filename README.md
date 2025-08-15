# noodleplanner
Noodle Planner - a project management tool for smart people

## Features
- User registration and login
- Secure session management (cookie-based)
- List projects for the logged-in user
- Create new projects (with validation)
- Logout functionality
- Jinja2 templated UI
- SQLite backend
- Full test coverage with pytest

## Setup
1. Clone the repository and install dependencies:
   ```sh
   git clone <repo-url>
   cd noodleplanner
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
2. Run the app:
   ```sh
   uvicorn app:app --reload
   ```
3. Run tests:
   ```sh
   pytest
   ```

## Documentation
- User stories and features are documented in the `docs/` folder:
  - `story-login-project-list.md`, `feature-login-project-list.md`
  - `story-create-project.md`, `feature-create-project.md`
  - `story-register-account.md`, `feature-logout-account-menu.md`
  - `login.md` (epic template)

## Usage
- Register a new account or log in with an existing one.
- Create and view your projects from the dashboard.
- Log out securely from any page.

---
MIT License
