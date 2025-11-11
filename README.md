# noodleplanner

Noodle Planner - a project management tool for smart people



## Features

### Core Planning Engine
- Timeline visualization engine for project phases and milestones (YAML to Markdown)
- Proportional, visually aligned ASCII/Markdown timeline output
- Milestone logic: duration=0 or phase end, with correct placement of dates/labels
- Only one 'Start' and 'Finish' label/date above timeline; all other milestones below
- No duplicate labels or stray characters in timeline output
- Full test coverage with pytest (119 tests passing)

### Web Application
- **Interactive Kanban Board** 🆕
  - 3 view modes: Phase, Resource, Progress
  - Drag-and-drop tasks between columns
  - Drag-and-drop to reorder tasks within columns
  - Drag-and-drop entire phase columns to reorder
  - Add new tasks and phases directly from Kanban
  - Auto-sync with text editor (bi-directional)
  - Full accessibility (ARIA, keyboard navigation)
  - Mobile responsive design
  - Resource normalization (case-insensitive)

- **Plan Editor**
  - Live Markdown editor with syntax highlighting
  - Line numbers and syntax hints
  - Double-click any line to edit task details
  - Auto-render on Enter key
  - Upload and Download plan files
  - Export to Excel, PowerPoint, and PDF

- **User Management**
  - User registration and login
  - Secure session management (cookie-based)
  - List projects for the logged-in user
  - Create new projects (with validation)

- **Product Management**
  - Hierarchical product list with drag-and-drop
  - Right-click context menu (rename, delete)
  - Canvas with classic vertical tree layout
  - Export to Excel/CSV

## Project Structure (UV Workspace)

This project uses [uv](https://github.com/astral-sh/uv) workspaces for managing multiple packages:

```
noodleplanner/
├── pyproject.toml              # Workspace root configuration
├── packages/
│   ├── noodle-core/           # Core scheduling engine
│   ├── noodle-cli/            # Command-line interface
│   └── noodle-web/            # Web application
└── tests/                      # Shared test suite (119 tests)
```

## Setup

### Prerequisites

Install uv (fast Python package manager):
```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Installation

1. Clone and setup workspace:

   ```sh
   git clone <repo-url>
   cd noodleplanner
   uv sync
   ```

2. Run the web app:

   ```sh
   uv run uvicorn noodle_web.app:app --reload
   ```

3. Run the CLI:

   ```sh
   uv run noodle --help
   uv run noodle render plan.md
   ```

4. Run tests (all 119 tests):

   ```sh
   uv run pytest tests/ -v

   # Run with coverage report
   uv run pytest tests/ -v --cov=packages --cov-report=term-missing

   # See docs/testing.md for detailed testing guide
   ```

### Docker Setup

Run with Docker Compose:

```sh
docker-compose up -d
```

**Run Tests in Docker:**

```sh
# Run all tests (119 tests, all passing)
docker exec noodleplanner uv run pytest tests/ -v

# Run with coverage
docker exec noodleplanner uv run pytest tests/ --cov=packages --cov-report=term-missing
```

**Quick Rebuild with Cache-Busting:**

When you've updated `app.py` or other application files and want to rebuild quickly without clearing all Docker cache:

1. Edit `docker-compose.yml` and increment the `CACHEBUST` value:
   ```yaml
   args:
     CACHEBUST: 2  # Change from 1 to 2, then 3, etc.
   ```

2. Rebuild and restart:
   ```sh
   docker-compose up -d --build
   ```

This approach preserves the cached layers for system dependencies and Python packages, but forces Docker to rebuild from the application code copy step onwards.

Alternatively, you can set it via command line without editing the file:
```sh
docker-compose build --build-arg CACHEBUST=$(date +%s) && docker-compose up -d
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
   - `epics/epic-web-application-enhancements.md` - Web UI features
   - `story-login-project-list.md`, `feature-login-project-list.md`
   - `story-create-project.md`, `feature-create-project.md`
   - `story-register-account.md`, `feature-logout-account-menu.md`
   - `login.md` (epic template)
- Testing: `docs/testing.md` - **Comprehensive testing guide with 122 test cases**
- Changelog: `docs/CHANGELOG-2025-08-20.md`
- Bug tracking: `docs/bugs/index.md`, `docs/bugs/fixed/product-details-save-bug-2025-08-20.md`
- Test docs: `docs/test-product-details-save.md`

## Usage

- Register a new account or log in with an existing one.
- Create and view your projects from the dashboard.
- Log out securely from any page.

---
MIT License
