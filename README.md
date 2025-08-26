# noodleplanner

Noodle Planner - a project management tool for smart people



## Features

- Timeline visualization engine for project phases and milestones (YAML to Markdown)
- Proportional, visually aligned ASCII/Markdown timeline output
- Milestone logic: duration=0 or phase end, with correct placement of dates/labels
- Only one 'Start' and 'Finish' label/date above timeline; all other milestones below
- No duplicate labels or stray characters in timeline output
- User registration and login
- Secure session management (cookie-based)
- List projects for the logged-in user
- Create new projects (with validation)
- Logout functionality
- Jinja2 templated UI
- SQLite backend
- Full test coverage with pytest
- Hierarchical product list with drag-and-drop and right-click context menu (rename, delete), powered by jsTree
- Persistent `sort_order` for products, maintained in the database
- All move, indent, outdent, and CRUD logic handled by backend endpoints
- Product list and canvas order always match, with live updates after any change
- Canvas auto-expands and draws classic vertical tree layout with elbow lines
- All CRUD operations (add, rename, delete, edit details) are backend-driven and reflected instantly in the UI and canvas
- Product details panel supports editing and saving all fields, with changes persisted in the backend
- Product list is fully expanded by default
- Export product list hierarchy to Excel/CSV via a hamburger menu above the product list

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

### (Optional) Enable Bug Docs Auto-Sync

The repository includes a pre-commit hook that auto-runs `scripts/sync_bugs.py` to enforce bug doc consistency. It has been configured via `core.hooksPath=.githooks`.

If you reclone the repo and want the hook:

```sh
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
```


## Documentation

- User stories and features are documented in the `docs/` folder:
   - `story-phase-timeline.md`, `feature-phase-timeline.md`
   - `epics/epic-phase-timeline.md`, `epics/epic-project-yaml-schema.md`
   - `story-login-project-list.md`, `feature-login-project-list.md`
   - `story-create-project.md`, `feature-create-project.md`
   - `story-register-account.md`, `feature-logout-account-menu.md`
   - `login.md` (epic template)
- Changelog: `docs/CHANGELOG-2025-08-20.md`
- Bug tracking: `docs/bugs/index.md`, `docs/bugs/fixed/product-details-save-bug-2025-08-20.md`
- Test docs: `docs/test-product-details-save.md`

## Usage

- Register a new account or log in with an existing one.
- Create and view your projects from the dashboard.
- Log out securely from any page.

---
MIT License
