# Quick Reference - Code Review Issue #226

Fast reference guide for developers working on code review fixes.

---

## Documents Overview

| Document | Purpose | Audience |
|----------|---------|----------|
| `CODE_REVIEW_SUMMARY.md` | High-level overview and next steps | Everyone |
| `code-review-report.md` | Detailed findings (all 67 issues) | Developers, QA |
| `critical-fixes-proposal.md` | Implementation details for critical fixes | Developers |
| `implementation-checklist.md` | Task tracking checklist | Project Manager, Developers |
| `quick-reference.md` | This document - quick lookup | Developers |

---

## Issue Categories

### Critical (8 issues) - Fix Immediately
1. Infinite loop in `get_next_working_day()`
2. Logging configuration conflicts
3. Debug output to stderr
4. Unreachable code in `extract_metadata()`
5. Tempfile resource leaks
6. Broad exception catching
7. Database error handling
8. Missing input validation

### Security (12 issues) - Fix Before Production
- No authentication
- CORS allows all origins
- Potential XSS
- File upload validation
- SQL injection patterns
- No rate limiting
- Error message leaks
- Activity logging PII
- Missing security headers
- No HTTPS enforcement

### Performance (15 issues) - Optimize for Scale
- O(n²) task scheduling
- Synchronous file I/O
- No caching
- No compression
- Large files in memory
- Full DOM rendering
- No pagination

### Edge Cases (19 issues) - Improve Robustness
- Empty task lists
- Circular dependencies
- Invalid dates
- Missing dependencies
- Unicode handling
- Long task names
- Negative durations
- Weekend/holiday edge cases

### Code Quality (13 issues) - Improve Maintainability
- Duplicate code
- Magic numbers
- Long functions
- Missing type hints
- Inconsistent naming
- Poor error handling

---

## Quick Fixes

### Fix 1: Infinite Loop Protection
```python
# Before
while True:
    if not is_weekend and not is_holiday:
        return current_date
    current_date += timedelta(days=1)

# After
MAX_WORKING_DAY_SEARCH = 365
days_checked = 0
while days_checked < MAX_WORKING_DAY_SEARCH:
    if not is_weekend and not is_holiday:
        return current_date
    current_date += timedelta(days=1)
    days_checked += 1
raise ValueError(f"No working day found within {MAX_WORKING_DAY_SEARCH} days")
```

---

### Fix 2: Logging Configuration
```python
# Remove from all library modules
# logging.basicConfig(level=logging.DEBUG)

# Keep only in app.py startup
def configure_logging():
    log_level = os.getenv("LOG_LEVEL", "INFO")
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
```

---

### Fix 3: Debug Output
```python
# Before
sys.stderr.write(f"[SEQUENTIAL] Task '{task_name}' marked\n")
sys.stderr.flush()

# After
logger.debug(f"Task '{task_name}' marked as sequential")
```

---

### Fix 5: Tempfile Cleanup
```python
# Before
with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
    tmp_path = tmp.name
try:
    export_to_excel(converted_content, tmp_path, ...)
    with open(tmp_path, 'rb') as f:
        file_bytes = f.read()
finally:
    if os.path.exists(tmp_path):
        os.unlink(tmp_path)

# After - Use context manager
@contextmanager
def temp_file_cleanup(suffix=''):
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    tmp.close()
    try:
        yield tmp_path
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception as e:
            logger.error(f"Failed to cleanup {tmp_path}: {e}")

# Usage
with temp_file_cleanup(suffix='.xlsx') as tmp_path:
    export_to_excel(converted_content, tmp_path, ...)
    with open(tmp_path, 'rb') as f:
        return Response(content=f.read(), ...)
```

---

### Fix 6: Exception Handling
```python
# Before
try:
    days = int(s.split('P')[1].split('D')[0])
    return timedelta(days=days)
except Exception:
    pass
return None

# After
try:
    days = int(s.split('P')[1].split('D')[0])
    if days < 0 or days > 36500:
        logger.warning(f"Duration out of range: {days}")
        return None
    return timedelta(days=days)
except (ValueError, IndexError, AttributeError) as e:
    logger.debug(f"Failed to parse duration '{s}': {e}")
    return None
except Exception as e:
    logger.error(f"Unexpected error parsing '{s}': {e}", exc_info=True)
    return None
```

---

### Fix 7: Database Errors
```python
# Before
except Exception as e:
    print(f"Database connection failed: {e}")
    return False

# After
except OperationalError as e:
    logger.error(f"Database connection failed: {e}")
    return {'success': False, 'message': str(e), 'error': e}
except Exception as e:
    logger.error(f"Unexpected database error: {e}", exc_info=True)
    return {'success': False, 'message': 'Database error', 'error': e}
```

---

### Fix 8: Input Validation
```python
# Add to app.py
def validate_plan_complexity(plan_text: str, max_tasks: int = 10000):
    lines = plan_text.split('\n')
    task_count = sum(1 for line in lines if line.strip() and not line.startswith('#'))

    if task_count > max_tasks:
        raise HTTPException(
            status_code=400,
            detail=f"Too many tasks: {task_count} (max {max_tasks})"
        )

# Use in endpoint
@app.post("/render")
async def render_plan(data: RenderRequest):
    validate_plan_complexity(data.plan_text)
    # ... continue rendering
```

---

## File Locations

### Critical Issue Files
```
packages/noodle-core/src/noodle_core/
├── scheduling_engine.py       # Issues 1, 2, 3, 4, 6
├── format_converter.py        # Issue 2, 6
├── excel_importer.py          # Issue 2
└── validation.py              # NEW - Issue 8

packages/noodle-web/src/noodle_web/
├── app.py                     # Issues 2, 5, 8
├── database.py                # Issues 6, 7
├── middleware.py              # Issue 6
└── validation.py              # NEW - Issue 8
```

### Test Files
```
tests/
├── test_edge_cases.py         # NEW - Edge case tests
├── test_scheduling_engine.py  # Update for new tests
├── test_format_converter.py   # Update for new tests
└── test_app.py                # Update for new tests
```

---

## Testing Commands

### Run All Tests
```bash
pytest tests/
```

### Run Edge Case Tests
```bash
pytest tests/test_edge_cases.py -v
```

### Run Specific Test Class
```bash
pytest tests/test_edge_cases.py::TestInfiniteLoopProtection -v
```

### Run with Coverage
```bash
pytest --cov=noodle_core --cov=noodle_web --cov-report=html
```

### Run Performance Tests
```bash
pytest tests/test_edge_cases.py::TestMemoryAndPerformance -v
```

---

## Common Patterns

### Add Logging to Function
```python
import logging

logger = logging.getLogger(__name__)

def my_function(param):
    logger.debug(f"Called with param: {param}")
    try:
        result = process(param)
        logger.info(f"Successfully processed {param}")
        return result
    except ValueError as e:
        logger.warning(f"Invalid parameter: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        raise
```

### Add Validation
```python
def validate_input(value, min_val=0, max_val=100, name="value"):
    """Validate input is within range."""
    if value < min_val or value > max_val:
        raise ValueError(
            f"{name} must be between {min_val} and {max_val}, got {value}"
        )
    return value

# Usage
percent = validate_input(percent, 0, 100, "percentage")
```

### Add Tests
```python
def test_function_with_valid_input():
    """Test function works with valid input."""
    result = my_function("valid")
    assert result is not None

def test_function_with_invalid_input():
    """Test function handles invalid input."""
    result = my_function("invalid")
    assert result is None

def test_function_raises_on_error():
    """Test function raises expected exception."""
    with pytest.raises(ValueError):
        my_function(None)
```

---

## Priority Matrix

| Priority | Issues | Time Estimate | Risk if Not Fixed |
|----------|--------|---------------|-------------------|
| P0 (Critical) | 1, 5, 8 | 3-5 days | High - App crashes, DoS |
| P1 (High) | 2, 3, 4, 6, 7 | 3-5 days | Medium - Poor UX, bugs |
| P2 (Medium) | Security (12) | 1-2 weeks | High - Security breach |
| P3 (Low) | Performance (15) | 2-3 weeks | Low - Slow with scale |
| P4 (Nice-to-have) | Code Quality (13) | Ongoing | Low - Tech debt |

---

## Review Checklist

Before submitting PR:
- [ ] Code follows project style guide
- [ ] Added/updated unit tests
- [ ] All tests pass locally
- [ ] Added logging where appropriate
- [ ] Updated documentation
- [ ] Handled edge cases
- [ ] Added error handling
- [ ] No debug output in production code
- [ ] Resources cleaned up properly
- [ ] Type hints added (if applicable)

---

## Git Workflow

```bash
# Create feature branch
git checkout -b fix/issue-226-infinite-loop

# Make changes
# Add tests
# Update documentation

# Run tests
pytest tests/

# Commit with descriptive message
git add .
git commit -m "fix(scheduling): Add iteration limit to get_next_working_day()

- Add max_days parameter with default 365
- Raise ValueError if no working day found
- Add validation for holidays parameter
- Add tests for edge cases

Fixes part of #226"

# Push and create PR
git push -u origin fix/issue-226-infinite-loop
```

---

## Environment Variables

Add to `.env`:
```bash
# Logging
LOG_LEVEL=INFO  # DEBUG, INFO, WARNING, ERROR

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/db

# Application
MAX_FILE_SIZE=10485760  # 10MB
MAX_TASKS=10000
MAX_NESTING_DEPTH=20

# Security
ALLOWED_ORIGINS=http://localhost:3000,https://myapp.com
ENABLE_ACTIVITY_LOGGING=true
```

---

## Useful Links

- **Main Issue:** #226
- **Code Review Report:** design/code-review-report.md
- **Fix Proposals:** design/critical-fixes-proposal.md
- **Implementation Checklist:** design/implementation-checklist.md
- **Test Suite:** tests/test_edge_cases.py

---

## Getting Help

- Questions about specific issues? Check `code-review-report.md`
- Need implementation details? See `critical-fixes-proposal.md`
- Want to see progress? Check `implementation-checklist.md`
- Stuck on a test? Look at `tests/test_edge_cases.py` for examples

---

## Common Questions

**Q: Do I need to fix all 67 issues at once?**
A: No! Start with the 8 critical issues, then move to security and performance.

**Q: Can I split critical fixes into multiple PRs?**
A: Yes! One PR per fix is ideal for easier review.

**Q: What if a fix breaks existing tests?**
A: Investigate why. Either fix the test or adjust the implementation. Never skip failing tests.

**Q: How do I prioritize?**
A: Follow this order: Critical → Security → Performance → Edge Cases → Code Quality

**Q: What's the test coverage target?**
A: Aim for 80%+ overall, 100% for critical paths.

---

**Last Updated:** 2026-02-15
**Issue:** #226
**Branch:** issue-226-code-review
