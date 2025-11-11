# UV Workspace Migration

**Date**: 2025-11-11
**Issue**: [#25 - Implement uv workspaces](https://github.com/yourusername/noodleplanner/issues/25)

## Overview

Successfully migrated the Noodle Planner project from a monolithic structure using pip to a modern workspace-based structure using [uv](https://github.com/astral-sh/uv), a fast Python package manager with built-in workspace support.

## Migration Goals

1. Split monolithic codebase into logical packages
2. Improve dependency management and build reproducibility
3. Enable independent versioning of components
4. Maintain 100% test coverage (119 tests passing)
5. Ensure Docker compatibility

## New Structure

```
noodleplanner/
├── pyproject.toml              # Workspace root configuration
├── uv.lock                     # Unified lockfile for all packages
├── packages/
│   ├── noodle-core/           # Core scheduling engine
│   │   ├── pyproject.toml
│   │   └── src/noodle_core/
│   │       ├── __init__.py
│   │       ├── scheduling_engine.py
│   │       └── format_converter.py
│   ├── noodle-cli/            # Command-line interface
│   │   ├── pyproject.toml
│   │   └── src/noodle_cli/
│   │       ├── __init__.py
│   │       └── cli.py
│   └── noodle-web/            # Web application
│       ├── pyproject.toml
│       └── src/noodle_web/
│           ├── __init__.py
│           ├── app.py
│           ├── database.py
│           ├── middleware.py
│           ├── static/
│           └── templates/
└── tests/                      # Shared test suite
    ├── test_scheduling_engine.py
    ├── test_format_converter.py
    └── test_app.py
```

## Package Descriptions

### noodle-core
Core scheduling engine containing the business logic for:
- Task scheduling algorithms
- Timeline rendering
- Export functionality (Excel, PowerPoint, PDF)
- Format conversion
- Resource management

**Dependencies**: numpy, pandas, pyyaml, python-dateutil, python-pptx, reportlab, openpyxl

### noodle-cli
Command-line interface for rendering project plans and exporting timelines.

**Dependencies**: noodle-core (workspace)

**Entry Point**: `noodle` command installed via `[project.scripts]`

### noodle-web
FastAPI-based web application with user authentication, project management, and visual timeline rendering.

**Dependencies**: noodle-core (workspace), fastapi, uvicorn, jinja2, sqlalchemy, alembic, bcrypt, pyjwt

## Migration Steps Performed

### Phase 1: Research & Baseline
- Verified uv 0.6.14 installed
- Ran baseline tests in Docker: **119/119 passing** ✅
- Documented current structure

### Phase 2: Create Workspace Structure
- Created root `pyproject.toml` with `[tool.uv.workspace]`
- Created `packages/` directory with subdirectories for each package
- Initialized `__init__.py` files

### Phase 3: Extract Core Package
- Created `packages/noodle-core/pyproject.toml` with dependencies
- Copied `scheduling_engine.py` and `format_converter.py` to `src/noodle_core/`
- Created comprehensive `__init__.py` exporting all public functions
- Fixed workspace sources configuration: added `noodle-core = { workspace = true }` to dependent packages
- Successfully synced workspace with `uv sync`

### Phase 4: Extract CLI Package
- Created `packages/noodle-cli/pyproject.toml` with `[project.scripts]` entry point
- Copied `cli.py` to `src/noodle_cli/`
- Updated imports: `from .scheduling_engine` → `from noodle_core`
- Verified CLI works: `uv run noodle --help` ✅

### Phase 5: Extract Web Package
- Created `packages/noodle-web/pyproject.toml` with all dependencies
- Copied `app.py`, `database.py`, `middleware.py` to `src/noodle_web/`
- Copied `static/` and `templates/` directories
- Updated imports: `from projects.scheduling_engine.*` → `from noodle_core.*`
- Fixed static file paths using `Path(__file__).parent`
- Updated middleware to use relative imports

### Phase 6: Update Tests
- Updated `test_scheduling_engine.py`: imports from `noodle_core`
- Updated `test_format_converter.py`: imports from `noodle_core`
- Updated `test_app.py`: removed sys.path hack, import from `noodle_web`
- Added `httpx` to dev-dependencies for TestClient
- Verified: **119/119 tests passing locally** ✅

### Phase 7: Update Docker
- Updated Dockerfile:
  - Install uv via curl script
  - Copy `pyproject.toml` and `uv.lock`
  - Use `uv sync --frozen` for reproducible builds
  - Run app with `uv run uvicorn noodle_web.app:app`
- Generated lockfile with `uv lock`
- Updated docker-compose.yml:
  - Incremented CACHEBUST to 64
  - Changed volume mount: `./projects` → `./packages`
- Verified: **119/119 tests passing in Docker** ✅

### Phase 8: Update Documentation
- Updated README.md with workspace structure and uv commands
- Created this migration documentation
- Updated setup instructions

### Phase 9: Cleanup
- Removed old `projects/scheduling_engine/` directory
- Removed old standalone `noodle` script
- Removed old `requirements.txt` files
- Updated `.gitignore` for uv-specific files

## Key Technical Decisions

### Workspace Sources Configuration
Each package that depends on another workspace package must declare it in `[tool.uv.sources]`:

```toml
[project]
dependencies = ["noodle-core"]

[tool.uv.sources]
noodle-core = { workspace = true }
```

### Root Workspace Configuration
The root `pyproject.toml` only contains workspace configuration and dev dependencies:

```toml
[tool.uv.workspace]
members = [
    "packages/noodle-core",
    "packages/noodle-cli",
    "packages/noodle-web"
]

[tool.uv]
dev-dependencies = [
    "pytest>=8.4.1",
    "pytest-cov>=7.0.0",
    "httpx",
]
```

No `[project]` section is needed in the root - it's not a buildable package.

### Build Backend
All packages use hatchling as build backend:

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### Static Files in Web Package
Used `[tool.hatch.build.targets.wheel.force-include]` to ensure static files and templates are included in wheel:

```toml
[tool.hatch.build.targets.wheel.force-include]
"src/noodle_web/static" = "noodle_web/static"
"src/noodle_web/templates" = "noodle_web/templates"
```

### Path Resolution for Package Resources
Updated static file mounting to use package-relative paths:

```python
from pathlib import Path

package_dir = Path(__file__).parent
app.mount("/static", StaticFiles(directory=str(package_dir / "static")), name="static")
templates = Jinja2Templates(directory=str(package_dir / "templates"))
```

## Import Pattern Changes

### Before (Monolithic)
```python
# Tests
from projects.scheduling_engine.scheduling_engine import schedule_tasks
from projects.scheduling_engine.format_converter import convert_plan_format_to_standard

# Web app
from projects.scheduling_engine.scheduling_engine import text_to_markdown_table
from middleware import ActivityLoggingMiddleware
from database import init_db
```

### After (Workspace)
```python
# Tests
from noodle_core import schedule_tasks
from noodle_core import convert_plan_format_to_standard

# Web app
from noodle_core import text_to_markdown_table
from .middleware import ActivityLoggingMiddleware
from .database import init_db
```

## Commands Reference

### Development
```bash
# Sync all packages and install dependencies
uv sync

# Run web application
uv run uvicorn noodle_web.app:app --reload

# Run CLI
uv run noodle render plan.md
uv run noodle analyze plan.md

# Run tests
uv run pytest tests/ -v
uv run pytest tests/ --cov=packages --cov-report=term-missing
```

### Docker
```bash
# Build and start
docker-compose up -d --build

# Run tests in container
docker exec noodleplanner uv run pytest tests/ -v

# View logs
docker logs noodleplanner -f
```

### Package Management
```bash
# Add dependency to specific package
uv add --package noodle-core numpy

# Update lockfile
uv lock

# Check for outdated packages
uv pip list --outdated
```

## Verification Results

### Local Environment
- Python 3.14
- uv 0.6.14
- **119/119 tests passing** (7.53s)
- CLI functional
- Web app starts successfully

### Docker Environment
- Python 3.11
- uv 0.6.14
- **119/119 tests passing** (3.84s)
- Database connection successful
- Health check responding

## Benefits Achieved

1. **Faster dependency resolution**: uv is significantly faster than pip
2. **Reproducible builds**: Single lockfile ensures consistent installs across environments
3. **Modular architecture**: Clear separation between core engine, CLI, and web app
4. **Type safety**: Better IDE support with explicit package boundaries
5. **Independent versioning**: Each package can be versioned and released independently
6. **Simplified Docker builds**: Single lockfile makes container builds deterministic
7. **Better CI/CD**: Workspace structure enables parallel testing and deployment

## Lessons Learned

1. **Workspace sources are required**: All inter-package dependencies must be declared in `[tool.uv.sources]`
2. **Root workspace is not a package**: Don't add `[project]` section to root pyproject.toml
3. **Static files need explicit inclusion**: Use `force-include` in hatchling config for non-Python files
4. **Path resolution matters**: Use `Path(__file__).parent` for package-relative paths, not relative strings
5. **Lockfile is critical for Docker**: Always copy `uv.lock` to container and use `--frozen` flag
6. **Test dependencies belong in root**: Dev dependencies should be in root workspace, not individual packages

## Migration Checklist for Similar Projects

- [ ] Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- [ ] Create root `pyproject.toml` with workspace members
- [ ] Create package directories: `packages/<package-name>/src/<package_name>/`
- [ ] Add `pyproject.toml` to each package with dependencies
- [ ] Configure workspace sources for inter-package dependencies
- [ ] Move code files to package `src/` directories
- [ ] Update imports across codebase
- [ ] Update test imports
- [ ] Add dev dependencies to root workspace
- [ ] Run `uv sync` to create lockfile
- [ ] Verify all tests pass
- [ ] Update Dockerfile to install uv and use lockfile
- [ ] Update docker-compose.yml volume mounts
- [ ] Update documentation
- [ ] Clean up old structure
- [ ] Update `.gitignore`

## References

- [uv Documentation](https://github.com/astral-sh/uv)
- [uv Workspaces Guide](https://docs.astral.sh/uv/concepts/workspaces/)
- [Hatchling Documentation](https://hatch.pypa.io/latest/)
- [PEP 517 - Build Backend Interface](https://peps.python.org/pep-0517/)

## Conclusion

The migration to uv workspaces was successful with no functionality lost and all 119 tests passing. The new structure provides a solid foundation for future development with improved modularity, faster builds, and better dependency management.
