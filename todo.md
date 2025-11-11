# Project Todo List

## Completed ✅

### Testing Suite (GitHub Issue #26) - ✅ CLOSED
- [x] Create tests directory structure
- [x] Write tests for format_converter.py (31 test cases)
  - Front matter title extraction
  - Duration conversion (days, weeks, months)
  - Dependency syntax conversion
  - Edge cases (unicode, line endings, etc.)
- [x] Write tests for scheduling_engine.py (51 test cases)
  - Working day calculations
  - Duration parsing
  - Metadata extraction
  - Task scheduling algorithms
  - Timeline rendering (including division by zero fix)
  - RAG status calculation
  - Resource mapping parsing
  - Edge cases and boundary conditions
- [x] Write tests for app.py API endpoints (37 test cases)
  - Root and health check endpoints
  - Render endpoint with various inputs
  - Excel, PowerPoint, and PDF exports
  - Multiple export formats (ZIP)
  - Static file serving
  - Request validation
  - CORS headers
  - Edge cases
- [x] Configure pytest with pytest.ini and .coveragerc
- [x] Create comprehensive testing documentation (docs/testing.md)
- [x] Update README.md with test instructions
- [x] Fix all test assertions to match implementation
- [x] Run tests in Docker - 119/119 passing ✅
- [x] Close GitHub issue #26

**Total Test Coverage:** 119 test cases across 3 modules (all passing in Docker)

### Web Application Enhancements
- [x] Separate HTML, CSS, and JavaScript into individual files
- [x] Implement resizable editor/output splitter
- [x] Add direct download export buttons (Excel, PPT, PDF)
- [x] Implement PDF export functionality
- [x] Add front matter title support
- [x] Fix scrolling issues in rendered output
- [x] Add download markdown button
- [x] Fix division by zero bug in timeline rendering
- [x] Fix file upload validation regex
- [x] Document all features in epic-web-application-enhancements.md

## In Progress 🔄

### Dependency Loop Detection (GitHub Issue #22)
- [x] Write test cases for loop detection (4 tests documenting expected behavior)
- [ ] Implement actual loop detection algorithm
- [ ] Flag circular dependencies to user
- [ ] Highlight which tasks have problematic dependencies
- [ ] Add user-friendly error messages

## Pending 📋

### Test Execution
- [x] Install pytest and dependencies in Docker container
- [x] Run tests inside Docker to verify all pass (119/119 ✅)
- [ ] Generate coverage report (requires uncommenting coverage options in pytest.ini)
- [ ] Ensure 80% minimum coverage is achieved
- [ ] Set up CI/CD pipeline to run tests automatically

### Additional Testing
- [ ] Add tests for database operations (activity logging)
- [ ] Add tests for middleware (ActivityLoggingMiddleware)
- [ ] Add tests for migration scripts
- [ ] Add performance tests for large plans (1000+ tasks)
- [ ] Add security tests (input validation, XSS, SQL injection)

### Documentation
- [ ] Update main README.md with new features overview
- [ ] Create user guide for web interface
- [ ] Document export formats and options in detail
- [ ] Create deployment guide
- [ ] Add troubleshooting section

### Code Quality
- [ ] Run linter (flake8, pylint, or black) on codebase
- [ ] Fix any linting issues
- [ ] Add type hints to key functions
- [ ] Review and refactor long functions (if any)

### Future Features
- [ ] Auto-save to browser localStorage
- [ ] Undo/Redo functionality
- [ ] Syntax highlighting in editor
- [ ] Dark mode
- [ ] Keyboard shortcuts
- [ ] Plan templates
- [ ] Version history
- [ ] Real-time collaboration

## Notes

- Per CLAUDE.md: All functions should have tests with 80% code coverage minimum
- Test files are in `/tests/` directory
- Pytest configuration in `pytest.ini` and `.coveragerc`
- Testing guide available in `docs/testing.md`

## GitHub Issues

- #22: Dependency loop detection (tests written, implementation pending) - OPEN
- #26: Testing suite (completed - 119 tests, all passing) - ✅ CLOSED

---

Last Updated: 2025-11-11
