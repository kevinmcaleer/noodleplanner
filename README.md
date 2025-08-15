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

- Hierarchical product list with drag-and-drop, powered by jsTree
- Persistent `sort_order` for products, maintained in the database
- All move, indent, and outdent logic handled by backend endpoints
- Product list and canvas order always match, with live updates after any change
- Canvas auto-expands and draws classic vertical tree layout with elbow lines
- All CRUD operations (add, rename, delete) are backend-driven and reflected instantly in the UI
- Product list is fully expanded by default
+- Export product list hierarchy to Excel/CSV via a hamburger menu above the product list
- Hierarchical product list with drag-and-drop, powered by jsTree
- Persistent `sort_order` for products, maintained in the database
- All move, indent, and outdent logic handled by backend endpoints
- Product list and canvas order always match, with live updates after any change
- Canvas auto-expands and draws classic vertical tree layout with elbow lines
- All CRUD operations (add, rename, delete) are backend-driven and reflected instantly in the UI
- Product list is fully expanded by default

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
