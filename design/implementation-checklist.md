# Implementation Checklist - Code Review Fixes

Track progress on implementing fixes from Issue #226 code review.

---

## Phase 1: Critical Issues (Week 1)

### Issue 1: Infinite Loop Protection
- [ ] Add max_days parameter to `get_next_working_day()`
- [ ] Add iteration counter and check
- [ ] Raise ValueError if limit exceeded
- [ ] Validate holidays parameter type
- [ ] Update all callers to handle ValueError
- [ ] Add unit tests for max iteration
- [ ] Add unit tests for invalid holidays type
- [ ] Update function documentation
- [ ] Code review and merge

**Files:** `packages/noodle-core/src/noodle_core/scheduling_engine.py:39-63`

---

### Issue 2: Logging Configuration
- [ ] Remove `logging.basicConfig()` from scheduling_engine.py
- [ ] Remove `logging.basicConfig()` from format_converter.py
- [ ] Remove `logging.basicConfig()` from excel_importer.py
- [ ] Create `configure_logging()` function in app.py
- [ ] Add LOG_LEVEL environment variable support
- [ ] Configure logging in startup event
- [ ] Keep `basicConfig()` only in cli.py
- [ ] Test logging in different modes (DEBUG, INFO, WARNING)
- [ ] Update .env.example with LOG_LEVEL
- [ ] Update documentation
- [ ] Code review and merge

**Files:**
- `packages/noodle-core/src/noodle_core/scheduling_engine.py:20`
- `packages/noodle-core/src/noodle_core/format_converter.py`
- `packages/noodle-web/src/noodle_web/app.py:43-46`

---

### Issue 3: Debug Output Cleanup
- [ ] Find all `sys.stderr.write()` calls in scheduling_engine.py
- [ ] Replace line 213-219 with `logger.debug()`
- [ ] Replace line 479 with `logger.debug()`
- [ ] Replace line 492-493 with `logger.debug()`
- [ ] Replace line 510-515 with `logger.debug()`
- [ ] Remove all `sys.stderr.flush()` calls
- [ ] Test debug output only shows in DEBUG mode
- [ ] Verify no stderr pollution in INFO mode
- [ ] Code review and merge

**Files:** `packages/noodle-core/src/noodle_core/scheduling_engine.py`

---

### Issue 4: Unreachable Code
- [ ] Investigate why code is unreachable (git history)
- [ ] Determine if 'number' field is used anywhere
- [ ] Search codebase for uses of `meta['number']`
- [ ] Decision: Delete or move before return
- [ ] If keeping: Move before line 271
- [ ] If keeping: Add tests for numbered tasks
- [ ] If deleting: Remove lines 272-280
- [ ] Update extract_metadata() tests
- [ ] Code review and merge

**Files:** `packages/noodle-core/src/noodle_core/scheduling_engine.py:272-280`

---

### Issue 5: Tempfile Resource Leaks
- [ ] Create `temp_file_cleanup()` context manager
- [ ] Update render_plan() Excel export (line 164-185)
- [ ] Update render_plan() CSV export (line 188-209)
- [ ] Update render_plan() PPT export (line 212-233)
- [ ] Update render_plan() PDF export (line 236-257)
- [ ] Update generate_exports() Excel (line 324-338)
- [ ] Update generate_exports() CSV (line 342-356)
- [ ] Update generate_exports() PPT (line 360-374)
- [ ] Update generate_exports() PDF (line 378-392)
- [ ] Update analyze_excel() (line 700-730)
- [ ] Add tests for cleanup on exception
- [ ] Add tests for cleanup on success
- [ ] Monitor temp file cleanup in logs
- [ ] Code review and merge

**Files:** `packages/noodle-web/src/noodle_web/app.py`

---

### Issue 6: Exception Handling
- [ ] Update parse_duration() exception handling
- [ ] Add specific exceptions to format_converter.py YAML parsing
- [ ] Update database.py exception handling
- [ ] Update middleware.py exception handling
- [ ] Add logging to all exception handlers
- [ ] Validate exception messages are helpful
- [ ] Add tests for error paths
- [ ] Review all `except Exception:` in codebase
- [ ] Update to specific exceptions where possible
- [ ] Code review and merge

**Files:**
- `packages/noodle-core/src/noodle_core/scheduling_engine.py:135`
- `packages/noodle-core/src/noodle_core/format_converter.py:42`
- `packages/noodle-web/src/noodle_web/database.py:55`
- `packages/noodle-web/src/noodle_web/middleware.py:101`

---

### Issue 7: Database Error Handling
- [ ] Update test_connection() to return dict
- [ ] Add specific exception handling (OperationalError, etc.)
- [ ] Replace print() with logger.error()
- [ ] Update startup_event() to use new return format
- [ ] Add connection retry logic (optional)
- [ ] Add health check endpoint using test_connection()
- [ ] Test with database down
- [ ] Test with database connection issues
- [ ] Update documentation
- [ ] Code review and merge

**Files:** `packages/noodle-web/src/noodle_web/database.py:62-70`

---

### Issue 8: Input Validation
- [ ] Create validation.py module
- [ ] Implement InputValidationMiddleware
- [ ] Add content-length validation
- [ ] Implement validate_plan_complexity()
- [ ] Add task count validation
- [ ] Add nesting depth validation
- [ ] Add middleware to app.py
- [ ] Update render endpoint to use validation
- [ ] Update parse endpoint to use validation
- [ ] Add configuration for limits
- [ ] Add tests for validation
- [ ] Add tests for limits exceeded
- [ ] Update API documentation
- [ ] Code review and merge

**Files:**
- New: `packages/noodle-core/src/noodle_core/validation.py`
- New: `packages/noodle-web/src/noodle_web/validation.py`
- Update: `packages/noodle-web/src/noodle_web/app.py`

---

## Phase 2: Security (Week 2)

### Authentication
- [ ] Research authentication options (JWT, OAuth, API keys)
- [ ] Choose authentication method
- [ ] Implement authentication middleware
- [ ] Add user model and database tables
- [ ] Add login/logout endpoints
- [ ] Add token generation/validation
- [ ] Protect all API endpoints
- [ ] Add authentication tests
- [ ] Update documentation
- [ ] Code review and merge

---

### Rate Limiting
- [ ] Choose rate limiting library (slowapi, etc.)
- [ ] Install and configure
- [ ] Add rate limit middleware
- [ ] Configure per-endpoint limits
- [ ] Add 429 response handling
- [ ] Add Retry-After header
- [ ] Add rate limit tests
- [ ] Monitor rate limit metrics
- [ ] Update documentation
- [ ] Code review and merge

---

### CORS Configuration
- [ ] Create environment variable for ALLOWED_ORIGINS
- [ ] Update CORS middleware configuration
- [ ] Remove allow_origins=["*"]
- [ ] Test with allowed origins
- [ ] Test with disallowed origins
- [ ] Update deployment configuration
- [ ] Update documentation
- [ ] Code review and merge

---

### File Upload Validation
- [ ] Add python-magic dependency
- [ ] Implement file signature validation
- [ ] Validate Excel file headers
- [ ] Add max file size validation
- [ ] Scan for malicious content (optional)
- [ ] Add upload validation tests
- [ ] Update documentation
- [ ] Code review and merge

---

### Security Headers
- [ ] Add secure headers middleware
- [ ] Configure Content-Security-Policy
- [ ] Add HSTS header
- [ ] Add X-Frame-Options header
- [ ] Add X-Content-Type-Options header
- [ ] Test headers in responses
- [ ] Update documentation
- [ ] Code review and merge

---

## Phase 3: Performance (Week 3)

### Task Scheduling Optimization
- [ ] Profile schedule_tasks() function
- [ ] Build parent-child index
- [ ] Optimize dependency lookup
- [ ] Cache task relationships
- [ ] Benchmark before/after
- [ ] Add performance tests
- [ ] Code review and merge

---

### Async I/O for Exports
- [ ] Add aiofiles dependency
- [ ] Convert file I/O to async
- [ ] Update export functions to async
- [ ] Update ZIP creation to async
- [ ] Add async tests
- [ ] Benchmark before/after
- [ ] Code review and merge

---

### Response Compression
- [ ] Add GZipMiddleware
- [ ] Configure compression level
- [ ] Test compression with different clients
- [ ] Measure bandwidth savings
- [ ] Code review and merge

---

### Caching
- [ ] Add caching for static files
- [ ] Configure Cache-Control headers
- [ ] Add ETags for conditional requests
- [ ] Test cache behavior
- [ ] Code review and merge

---

## Phase 4: Edge Cases (Week 4)

### Test Suite
- [ ] Run tests/test_edge_cases.py
- [ ] Fix any failures
- [ ] Add missing edge case handlers
- [ ] Achieve >80% code coverage
- [ ] Code review and merge

---

### Edge Case Fixes
- [ ] Handle empty task lists
- [ ] Handle single-day projects
- [ ] Prevent circular dependencies
- [ ] Validate date ranges
- [ ] Handle missing dependencies
- [ ] Truncate long task names properly
- [ ] Support unicode characters
- [ ] Validate durations and percentages
- [ ] Handle weekend/holiday edge cases
- [ ] Fix resource name collisions
- [ ] Sanitize export filenames
- [ ] Code review and merge

---

## Phase 5: Code Quality (Ongoing)

### Documentation
- [ ] Add type hints to all public functions
- [ ] Document all edge cases
- [ ] Update API documentation
- [ ] Add examples to docstrings
- [ ] Update README

---

### Refactoring
- [ ] Extract long functions (>100 lines)
- [ ] Remove code duplication
- [ ] Define named constants for magic numbers
- [ ] Improve naming consistency
- [ ] Add validation helper functions

---

### Testing
- [ ] Achieve 80%+ code coverage
- [ ] Add integration tests
- [ ] Add performance tests
- [ ] Add security tests

---

## Testing Checklist

### Before Each Merge
- [ ] Run full test suite: `pytest tests/`
- [ ] Run new edge case tests: `pytest tests/test_edge_cases.py`
- [ ] Check code coverage: `pytest --cov=noodle_core --cov=noodle_web`
- [ ] Run linter: `pylint packages/`
- [ ] Run type checker: `mypy packages/`
- [ ] Manual testing of affected features
- [ ] Code review completed
- [ ] Documentation updated

---

## Deployment Checklist

### Staging Deployment
- [ ] Deploy to staging environment
- [ ] Run smoke tests
- [ ] Test all critical paths
- [ ] Load testing
- [ ] Security testing
- [ ] Monitor logs for errors
- [ ] Performance monitoring
- [ ] Rollback plan ready

---

### Production Deployment
- [ ] All critical fixes deployed
- [ ] Authentication enabled
- [ ] Rate limiting configured
- [ ] Security headers active
- [ ] Monitoring configured
- [ ] Alerts configured
- [ ] Backup strategy verified
- [ ] Rollback plan tested
- [ ] Deploy to production
- [ ] Monitor for 24 hours
- [ ] Post-deployment review

---

## Success Metrics

### Code Quality
- [ ] Test coverage >80%
- [ ] Zero critical bugs
- [ ] <5% error rate
- [ ] All code reviewed

---

### Performance
- [ ] p95 response time <2s
- [ ] Can handle 1000+ tasks
- [ ] Can handle 100+ concurrent users
- [ ] Memory usage stable

---

### Security
- [ ] All endpoints authenticated
- [ ] Rate limiting effective
- [ ] No security vulnerabilities
- [ ] Security headers configured

---

## Notes

Use this format to track progress:
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Completed
- `[!]` - Blocked
- `[?]` - Needs discussion

Update this document as work progresses and link to related PRs and issues.
