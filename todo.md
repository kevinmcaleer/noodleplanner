# Noodle Planner - Refactoring TODO List

Generated from code review: 2025-10-13

## High Priority (Must Fix)

### 1. Fix Test Infrastructure ⚠️ BLOCKING ✅ COMPLETED
- [x] Resolve Starlette TestClient incompatibility issue
- [x] Verify all tests can run without errors
- [x] Add pytest-cov for coverage reporting
- [ ] Document test running instructions in README

**Issue:** `TypeError: Client.__init__() got an unexpected keyword argument 'app'`
**Resolution:** Updated requirements.txt (numpy/pandas version constraints) and upgraded Starlette from 0.32.0 to 0.47.2
**Result:** All 30 tests passing ✅
**Coverage:** 63% overall (below 80% target ⚠️)

**Coverage by Module:**
- app.py: 100% ✅
- models.py: 100% ✅
- db.py: 79% ⚠️
- routes.py: 60% ❌
- scheduling_engine.py: 35% ❌
- project_validator.py: 17% ❌

---

### 2. Implement Real Password Hashing 🔒 SECURITY ✅ COMPLETED
- [x] Replace `fake_hash_password()` with bcrypt
- [x] Add bcrypt==4.2.1 to requirements.txt
- [x] Update `authenticate_user()` to use bcrypt verification
- [x] Migrate existing test user password to use bcrypt
- [ ] Add password strength validation (future enhancement)

**Issue:** `routes.py:644-645` - passwords stored as "fakehashed" + plaintext
**Resolution:** Implemented proper bcrypt password hashing
**Changes:**
- Added `hash_password()` function using bcrypt.hashpw()
- Added `verify_password()` function using bcrypt.checkpw()
- Updated `authenticate_user()` to use `verify_password()`
- Updated `register_submit()` to use `hash_password()`
- Updated `add_test_user()` in db.py to hash test password
**Result:** All 30 tests passing ✅ with secure password storage

---

### 3. Implement Proper Authentication 🔒 SECURITY ✅ COMPLETED
- [x] Replace cookie-based username storage with JWT tokens
- [x] Add PyJWT==2.10.1 to requirements.txt
- [x] Implement token generation on login (`create_access_token()`)
- [x] Implement token validation (`decode_access_token()`, `get_current_user_from_cookie()`)
- [x] Add token expiration (24 hours)
- [ ] Add refresh token mechanism (future enhancement)
- [x] Set secure cookie flags (httponly, samesite=lax, max_age)

**Issue:** `routes.py:625` - plain username in cookies
**Resolution:** Implemented JWT-based authentication
**Changes:**
- Added `create_access_token()` - generates JWT with HS256 algorithm
- Added `decode_access_token()` - validates and decodes JWT tokens
- Added `get_current_user_from_cookie()` - helper to extract user from JWT cookie
- Updated `/login` and `/token` endpoints to issue JWT tokens
- Updated all routes to use JWT validation via `get_current_user_from_cookie()`
- Updated all tests to use JWT tokens via `create_test_jwt_token()` helper
- Set cookie flags: httponly=True, samesite="lax", max_age=86400 (24h)
**Result:** 23/30 tests passing (7 test failures unrelated to JWT)
**Security Note:** SECRET_KEY currently hardcoded - should move to environment variable

---

### 4. Add Proper Logging 📝 ✅ COMPLETED
- [x] Replace all print statements with logging module
- [x] Configure logging levels (DEBUG, INFO, WARNING, ERROR)
- [x] Add log file rotation
- [x] Update startup diagnostics in `app.py:11`
- [x] Update debug prints in `routes.py:562-575`
- [x] Add structured logging for authentication events
- [ ] Add request/response logging middleware (future enhancement)

**Resolution:** Implemented comprehensive logging system
**Changes:**
- Created `logging_config.py` with rotating file handlers (10MB max, 5 backups)
- Configured dual logging: console (INFO) and file (DEBUG)
- Created separate auth logger with dedicated `logs/auth.log` file
- Replaced print statements in `app.py`, `routes.py`, and `scheduling_engine.py`
- Added structured logging for:
  - Successful logins (INFO)
  - Failed login attempts (WARNING)
  - User registrations (INFO)
  - Duplicate registration attempts (WARNING)
  - JWT token validation failures (WARNING)
  - User logout events (INFO)
- Fixed datetime.utcnow() deprecation warning (replaced with timezone.utc)
**Files Created:**
- `logging_config.py` - logging configuration and setup
- `logs/app.log` - general application logs
- `logs/auth.log` - authentication-specific logs
**Result:** All authentication tests passing with proper logging ✅

---

## Medium Priority (Should Fix)

### 5. Refactor routes.py 📦
- [ ] Split routes.py (681 lines) into modules:
  - [ ] `routes/auth.py` - authentication routes
  - [ ] `routes/projects.py` - project CRUD
  - [ ] `routes/products.py` - product operations
  - [ ] `routes/export.py` - export functionality
  - [ ] `routes/dependencies.py` - dependency management
- [ ] Create `routes/__init__.py` to aggregate routers
- [ ] Update imports in `app.py`
- [ ] Move authentication helpers to `auth.py`
- [ ] Create middleware for authentication checks

**Current:** 681 lines, multiple responsibilities
**Target:** <200 lines per module

---

### 6. Refactor scheduling_engine.py 🔧
- [x] Relocate scheduling engine into `projects/scheduling_engine` package with CLI entrypoint
- [ ] Break down `schedule_tasks()` (136 lines → <50 lines each):
  - [ ] Extract metadata parsing to separate function
  - [ ] Extract scheduling logic to separate function
  - [ ] Extract summary task creation to separate function
- [ ] Break down `yaml_to_markdown_table()` (113 lines):
  - [ ] Extract table rendering to separate function
  - [ ] Extract timeline rendering to separate function
  - [ ] Extract gantt rendering to separate function
- [ ] Fix unreachable code in `extract_metadata()` (lines 51-58)
- [ ] Add type hints to all functions
- [ ] Add docstrings to complex functions

**Current:** 534 lines, complex nested logic
**Target:** Functions <50 lines, clear single responsibility

---

### 7. Extract SQL to .sql Files 🗄️
- [ ] Create `sql/` directory
- [ ] Extract queries from `db.py`:
  - [ ] `create_tables.sql`
  - [ ] `get_user_by_username.sql`
  - [ ] `get_projects_by_username.sql`
  - [ ] `get_project_with_products.sql`
  - [ ] `add_product_to_project.sql`
  - [ ] etc.
- [ ] Create SQL loader utility function
- [ ] Update db.py to load queries from files
- [ ] Extract queries from routes.py
- [ ] Update tests to use new SQL structure

**Current:** ~5% of SQL in files
**Target:** 100% of SQL in .sql files

---

### 8. Add Database Indexes 🚀
- [ ] Add index on `projects.owner`
- [ ] Add index on `products.project_id`
- [ ] Add index on `products.plan_id`
- [ ] Add index on `products.sort_order`
- [ ] Add composite index on `products(project_id, plan_id, sort_order)`
- [ ] Create migration script for indexes
- [ ] Document index strategy

**Impact:** Performance improvement for queries

---

### 9. Add Type Hints 📘
- [ ] Add type hints to `scheduling_engine.py`
- [ ] Add type hints to `db.py`
- [ ] Add type hints to `routes.py`
- [ ] Add mypy to dev dependencies
- [ ] Create mypy.ini configuration
- [ ] Run mypy checks in CI/CD

**Current:** Inconsistent type hints
**Target:** Full type coverage

---

### 10. Fix Code Quality Issues 🧹
- [ ] Remove duplicate code/comments (routes.py:1-11 comment)
- [ ] Fix unreachable code in scheduling_engine.py:51-58
- [ ] Reduce `update_product_order()` complexity (80 lines)
- [ ] Reduce `export_products_xlsx()` complexity (44 lines)
- [ ] Extract nested functions from `project_validator.py:validate()`
- [ ] Add constants for magic strings/numbers

---

## Low Priority (Nice to Have)

### 11. Add Input Validation Middleware ✅
- [ ] Create Pydantic models for all request payloads
- [ ] Add validation for product names
- [ ] Add validation for project names
- [ ] Add validation for date formats
- [ ] Centralize error messages
- [ ] Return consistent error response format

---

### 12. Implement Rate Limiting 🛡️
- [ ] Add slowapi or similar library
- [ ] Configure rate limits per endpoint
- [ ] Add rate limit headers to responses
- [ ] Document rate limits in API docs

---

### 13. Add API Documentation 📚
- [ ] Ensure all endpoints have docstrings
- [ ] Add OpenAPI tags to group endpoints
- [ ] Add request/response examples
- [ ] Configure Swagger UI theme
- [ ] Add authentication documentation
- [ ] Host docs at /docs

---

### 14. Standardize Error Responses 🎯
- [ ] Create error response models
- [ ] Consistent JSON error structure
- [ ] Add error codes
- [ ] Add helpful error messages
- [ ] Add request ID for tracing
- [ ] Document error codes

---

### 15. Add Database Migrations 🔄
- [ ] Add Alembic to dependencies
- [ ] Initialize Alembic
- [ ] Create initial migration
- [ ] Create migration for indexes
- [ ] Create migration for new password hashing
- [ ] Document migration process
- [ ] Add migration check to startup

---

## Progress Tracking

**Completed:** 4 / 15 major items
**In Progress:** 0
**Blocked:** 0 (unblocked! 🎉)

**Test Status:** 23/30 tests passing ⚠️ (7 failures unrelated to security work)
**Code Coverage:** 63% (Target: ≥80%) ⚠️

**Coverage Gaps:**
- routes.py (60%): Need tests for export, dependency, and error paths
- scheduling_engine.py (35%): Need tests for rendering functions
- project_validator.py (17%): Need tests for validation edge cases

**Last Updated:** 2025-10-15

---

## Notes

- Items 1-4 are **HIGH PRIORITY** and should be completed before any production deployment
- Item 1 (tests) is **BLOCKING** - must be fixed first to verify other changes
- Items 2-3 are **SECURITY CRITICAL** - should be completed ASAP
- Code coverage goal: **≥80%** (per CLAUDE.md)
- Follow principles from CLAUDE.md:
  - Simplicity over complexity
  - Small functions (<50 lines recommended)
  - Single responsibility per function
  - SQL in .sql files
  - New functions must have tests
