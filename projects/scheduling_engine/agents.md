# Repository Guidelines

## Project Structure & Module Organization
Core FastAPI setup lives in `app.py` with shared routing in `routes.py` and SQL helpers in `db.py` and `models.py`. HTML templates and front-end assets sit under `templates/` and `static/`. Planning logic is split across `scheduling_engine.py`, `project_validator.py`, and supporting docs in `docs/`. Utility scripts (bug sync, DB reset) are in `scripts/`, while integration and regression suites reside in `tests/`.

## Build, Run, and Test Commands
- `python -m venv venv && source venv/bin/activate` — create and enter the local environment.
- `pip install -r requirements.txt` — install FastAPI, pytest, and other runtime tooling.
- `uvicorn app:app --reload` — launch the development server with autoreload for rapid iteration.
- `pytest` — run the full test suite; use `pytest tests/test_create_project.py` to target a module.
- `python scripts/reset_db.py` — regenerate the SQLite database when you need a clean slate.

## Coding Style & Naming Conventions
Follow PEP 8: four-space indentation, snake_case for functions and variables, PascalCase for classes. Keep modules cohesive (DB helpers in `db.py`, scheduling logic in dedicated engines) and prefer descriptive filenames like `test_bug_0004_connection_integrity.py`. Add docstrings for public functions and guard new logs behind the shared `logging_config.setup_logging()` pipeline. Type hints are encouraged where they clarify FastAPI dependencies or return payloads.

## Testing Guidelines
Pytest discovers any `test_*.py` inside `tests/`; mirror existing pattern by grouping scenario-specific regressions under `test_bug_XXXX_*.py`. Add fixtures when touching DB state and reset `NOODLEPLANNER_DB` overrides during teardown (see `tests/test_bug_0002_user_persistence.py`). Aim to maintain current coverage by pairing feature work with at least one automated test, and confirm fixes with targeted `pytest -k "<keyword>"` runs before pushing.

## Commit & Pull Request Guidelines
Write imperative, concise commit subjects (e.g., `Add Gantt chart output`, `docs: update timeline story`). Reference issue IDs or bug tickets in the body when applicable, and keep related migrations, scripts, and docs together. Pull requests should describe the user-facing impact, list test commands executed, and include screenshots or sample output for UI or report changes. Link to affected docs within `docs/` when you add or update behavior explanations.

## Environment & Data Safety
The app defaults to `test.db`; override with `NOODLEPLANNER_DB` for isolation during tests. Generated logs live in `logs/`; review them when debugging but avoid committing artifacts. When enabling the optional bug-sync hook, run `git config core.hooksPath .githooks && chmod +x .githooks/pre-commit` to keep bug docs aligned.

# Core principles
- simplicity over complexity
- clarity over cleverness
- maintainability over optimization
- self-documenting code over comments
- small functions over large functions
- functions with single responsibility over multi-purpose functions
- sql should be stored in .sql files over inline sql
- new functions should have tests over no tests
- code coverage should be at least 80%
- add the plan of tasks to the todo.md and make sure its alwasys up to date