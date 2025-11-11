# Testing Guide for Noodle Planner

## Overview

This document describes the testing infrastructure for Noodle Planner. The test suite ensures code quality and meets the 80% coverage requirement specified in CLAUDE.md.

## Test Structure

```
tests/
├── __init__.py
├── test_format_converter.py    # Format conversion and front matter tests
├── test_scheduling_engine.py   # Core scheduling logic tests
└── test_app.py                 # FastAPI endpoint tests
```

## Test Categories

### 1. Format Converter Tests (`test_format_converter.py`)
Tests for the format conversion module including:
- **Front Matter Extraction** (6 tests)
  - Valid YAML front matter title extraction
  - Handling missing front matter
  - Invalid YAML handling
  - Special characters in titles

- **Plan Format Conversion** (15 tests)
  - Duration format conversion (days, weeks, months)
  - Dependency syntax conversion (`[depends Task]` → `#Task`)
  - Front matter stripping
  - Task name preservation
  - Resource, percentage, and comment preservation

- **Edge Cases** (10 tests)
  - Windows line endings
  - Unicode characters
  - Very long task names
  - Mixed indentation
  - Empty input handling

**Total:** 31 test cases

### 2. Scheduling Engine Tests (`test_scheduling_engine.py`)
Tests for core scheduling functionality:
- **Working Day Calculations** (6 tests)
  - Weekend detection and skipping
  - Holiday handling
  - Working day addition logic

- **Duration Parsing** (5 tests)
  - Valid and invalid duration formats
  - Empty/null handling

- **Metadata Extraction** (10 tests)
  - Resource parsing (`@user`)
  - Duration extraction (`3d`, `2w`, `1m`)
  - Dependency parsing (`#Task`)
  - Percentage completion (`50%`)
  - Comments (`!"text"`)
  - Sequential markers (`*`)

- **Task Scheduling** (6 tests)
  - Simple task scheduling
  - Sequential task chains
  - Parallel tasks
  - Dependency-based scheduling
  - Summary task calculations

- **Timeline Rendering** (4 tests)
  - Basic timeline generation
  - **Single-day plan handling** (fixes division by zero bug)
  - Empty phases
  - Multiple milestones

- **RAG Status** (5 tests)
  - Green status (on track)
  - Red status (behind schedule)
  - Amber status (slightly behind)
  - Completed tasks
  - Not-started tasks

- **Resource Mappings** (5 tests)
  - Simple mapping parsing
  - Multiple resources
  - Missing shortnames
  - Invalid YAML handling

- **Dependency Loop Detection** (4 tests)
  - Simple circular dependencies (A → B → A)
  - Three-way loops (A → B → C → A)
  - Self-dependencies
  - Valid dependency chains
  - **Note:** These tests document expected behavior for GitHub issue #22

- **Edge Cases** (6 tests)
  - Very long durations (365+ days)
  - Year boundary transitions
  - Special characters in task names
  - Unicode support
  - Multiple resources per task
  - 100% completion handling

**Total:** 51 test cases

### 3. API Endpoint Tests (`test_app.py`)
Tests for FastAPI HTTP endpoints:
- **Root Endpoint** (2 tests)
  - HTML page serving
  - Required elements present

- **Health Check** (4 tests)
  - Status code validation
  - JSON response format
  - Status field present
  - Timestamp format

- **Render Endpoint** (8 tests)
  - Basic plan rendering
  - Project name handling
  - Front matter title extraction
  - Default project name
  - Empty plan handling
  - Invalid format handling
  - Missing field validation
  - Special characters in names

- **Excel Export** (3 tests)
  - File download
  - Correct filename
  - Valid XLSX format (PK signature)

- **PowerPoint Export** (3 tests)
  - File download
  - Correct filename
  - Valid PPTX format (PK signature)

- **PDF Export** (3 tests)
  - File download
  - Correct filename
  - Valid PDF format (%PDF signature)

- **Multiple Exports** (3 tests)
  - ZIP file creation for multiple exports
  - Correct ZIP filename
  - All formats in one ZIP

- **Static Files** (2 tests)
  - Favicon endpoint
  - Logo endpoint

- **Edge Cases** (8 tests)
  - Very long plans (100+ tasks)
  - Unicode characters (Japanese, Chinese, French)
  - Malformed JSON
  - Invalid HTTP methods
  - OPTIONS request (CORS preflight)

- **Request Validation** (3 tests)
  - File size limits (1MB)
  - Project name length (200 chars)
  - Invalid boolean types

- **CORS** (1 test)
  - CORS headers present

**Total:** 40 test cases

## Running Tests

### Prerequisites

1. Python environment with all dependencies installed:
```bash
pip install -r requirements.txt
```

Required testing packages:
- `pytest==8.4.1`
- `pytest-cov==7.0.0`

### Running All Tests

```bash
# Run all tests with verbose output
pytest tests/ -v

# Run with coverage report
pytest tests/ -v --cov=. --cov-report=term-missing --cov-report=html

# Run specific test file
pytest tests/test_format_converter.py -v

# Run specific test class
pytest tests/test_scheduling_engine.py::TestGetNextWorkingDay -v

# Run specific test
pytest tests/test_app.py::TestRenderEndpoint::test_render_basic_plan -v
```

### Running Tests in Docker

```bash
# Build and start the container
docker-compose up --build -d

# Run tests inside container
docker exec noodleplanner pytest tests/ -v

# Run with coverage
docker exec noodleplanner pytest tests/ -v --cov=. --cov-report=term-missing

# View HTML coverage report
docker exec noodleplanner pytest tests/ -v --cov=. --cov-report=html
# Then copy htmlcov/ directory from container or mount it as volume
```

## Test Markers

Tests are organized using pytest markers:

```bash
# Run only unit tests
pytest -v -m unit

# Run only integration tests
pytest -v -m integration

# Run only API tests
pytest -v -m api

# Skip slow tests
pytest -v -m "not slow"

# Run edge case tests
pytest -v -m edge_case
```

## Coverage Requirements

Per CLAUDE.md guidelines:
- **Target:** 80% code coverage minimum
- **Exclusions:** Tests, migrations, virtual environments, `__main__` blocks

### Checking Coverage

```bash
# Generate coverage report
pytest tests/ --cov=. --cov-report=term-missing --cov-report=html

# Open HTML report
open htmlcov/index.html
```

### Coverage Configuration

Coverage settings are in:
- `pytest.ini` - Test configuration and coverage options
- `.coveragerc` - Detailed coverage rules and exclusions

## Writing New Tests

### Test File Structure

```python
"""Tests for module_name."""

import pytest
from module_name import function_to_test


class TestFeatureName:
    """Test suite for feature."""

    def test_basic_functionality(self):
        """Test basic use case."""
        result = function_to_test(input)
        assert result == expected

    def test_edge_case(self):
        """Test edge case or boundary condition."""
        result = function_to_test(edge_input)
        assert result is not None
```

### Test Naming Conventions

- Test files: `test_*.py`
- Test classes: `Test*`
- Test functions: `test_*`
- Use descriptive names: `test_extract_title_with_valid_frontmatter`

### Fixtures

Use pytest fixtures for reusable test data:

```python
@pytest.fixture
def sample_plan():
    """Sample project plan for testing."""
    return """Phase 1
  Task 1 @john 3d"""

def test_with_fixture(sample_plan):
    result = process_plan(sample_plan)
    assert result is not None
```

## GitHub Issue #22 - Dependency Loop Detection

Tests in `test_scheduling_engine.py::TestDependencyLoopDetection` document expected behavior for circular dependency detection:

1. **Simple Loops:** A → B → A
2. **Multi-way Loops:** A → B → C → A
3. **Self-Dependencies:** Task depends on itself
4. **Valid Chains:** A → B → C (no loop)

**Current Status:** Tests are written but loop detection is not yet implemented. Tests document expected behavior.

**Future Implementation:**
- Should detect loops and raise error or flag tasks
- Should highlight problematic dependencies to user
- Should prevent invalid schedules

## Continuous Integration

### Pre-commit Checks

Before committing:
```bash
# Run all tests
pytest tests/ -v

# Check coverage meets 80% minimum
pytest tests/ --cov=. --cov-report=term | grep "TOTAL"

# Run specific subset if needed
pytest tests/test_format_converter.py tests/test_scheduling_engine.py -v
```

### CI/CD Pipeline (Future)

Recommended setup:
1. Run tests on every push
2. Enforce 80% coverage minimum
3. Run tests in Docker container
4. Generate and archive coverage reports
5. Run tests across Python versions (3.10, 3.11, 3.12, 3.13)

## Troubleshooting

### Import Errors

If you see `ModuleNotFoundError`:
```bash
# Ensure you're in the project root
cd /path/to/noodleplanner

# Ensure dependencies are installed
pip install -r requirements.txt

# Check Python path
python -c "import sys; print(sys.path)"
```

### Test Discovery Issues

```bash
# Clear pytest cache
rm -rf .pytest_cache

# Run with verbose test discovery
pytest tests/ -v --collect-only
```

### Coverage Not Working

```bash
# Install pytest-cov
pip install pytest-cov

# Verify installation
pytest --version
```

## Test Statistics

### Summary

| Category | Test Files | Test Classes | Test Cases | Coverage Target |
|----------|-----------|--------------|------------|----------------|
| Format Converter | 1 | 3 | 31 | 80%+ |
| Scheduling Engine | 1 | 10 | 51 | 80%+ |
| API Endpoints | 1 | 12 | 40 | 80%+ |
| **Total** | **3** | **25** | **122** | **80%+** |

### Test Execution Time

- Format Converter: ~1-2 seconds
- Scheduling Engine: ~2-3 seconds
- API Endpoints: ~3-5 seconds
- **Total:** ~6-10 seconds

## Related Documents

- `CLAUDE.md` - Project coding guidelines (includes testing requirements)
- `docs/epics/epic-web-application-enhancements.md` - Features that need tests
- `docs/epics/epic-phase-timeline.md` - Timeline feature documentation
- `requirements.txt` - Python dependencies including test tools

## Future Enhancements

### Additional Test Coverage

1. **Database Tests**
   - Activity logging
   - Migration scripts
   - Connection handling

2. **Middleware Tests**
   - Activity logging middleware
   - CORS configuration
   - Error handling

3. **Export Format Tests**
   - Excel content validation
   - PowerPoint slide structure
   - PDF formatting

4. **Integration Tests**
   - End-to-end plan processing
   - Multi-user scenarios
   - Large dataset handling

5. **Performance Tests**
   - Load testing for API endpoints
   - Large plan rendering (1000+ tasks)
   - Concurrent request handling

6. **Security Tests**
   - Input validation
   - SQL injection prevention
   - XSS prevention
   - File upload security

## Conclusion

The Noodle Planner test suite provides comprehensive coverage of core functionality including:
- Format conversion and parsing
- Scheduling algorithms and working day calculations
- API endpoints and HTTP responses
- Edge cases and error conditions

All tests are designed to be fast, isolated, and deterministic, ensuring reliable continuous integration and development workflow.
