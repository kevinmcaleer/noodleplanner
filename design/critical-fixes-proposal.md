# Critical Fixes Proposal

## Overview
This document outlines specific code fixes for the 8 critical issues identified in the code review, along with implementation details and testing requirements.

---

## Fix #1: Infinite Loop Protection in get_next_working_day()

### Current Code
```python
def get_next_working_day(date, holidays=None):
    if holidays is None:
        holidays = set()

    current_date = date
    while True:  # DANGEROUS!
        is_weekend = current_date.weekday() >= 5
        is_holiday = current_date in holidays

        if not is_weekend and not is_holiday:
            return current_date

        current_date += timedelta(days=1)
```

### Proposed Fix
```python
def get_next_working_day(date, holidays=None, max_days=365):
    """Get the next working day from a given date.

    Args:
        date: The date to check
        holidays: Set of holiday dates to skip (optional)
        max_days: Maximum days to search forward (default 365)

    Returns:
        The next working day

    Raises:
        ValueError: If no working day found within max_days
    """
    if holidays is None:
        holidays = set()

    # Validate holidays is a set of dates
    if not isinstance(holidays, (set, frozenset)):
        raise TypeError("holidays must be a set of datetime objects")

    current_date = date
    days_checked = 0

    while days_checked < max_days:
        is_weekend = current_date.weekday() >= 5
        is_holiday = current_date in holidays

        if not is_weekend and not is_holiday:
            return current_date

        current_date += timedelta(days=1)
        days_checked += 1

    # If we get here, no working day found
    raise ValueError(
        f"No working day found within {max_days} days of {date}. "
        f"Check holidays set for errors."
    )
```

### Tests Required
```python
def test_get_next_working_day_max_iteration():
    """Test that function raises error after max iterations."""
    start = datetime(2025, 1, 1)
    # All days are holidays
    holidays = {start + timedelta(days=i) for i in range(400)}

    with pytest.raises(ValueError, match="No working day found"):
        get_next_working_day(start, holidays, max_days=365)

def test_get_next_working_day_invalid_holidays_type():
    """Test that function validates holidays parameter."""
    with pytest.raises(TypeError, match="must be a set"):
        get_next_working_day(datetime.now(), holidays=[datetime.now()])
```

---

## Fix #2: Logging Configuration Conflicts

### Current Issues
- Multiple `logging.basicConfig()` calls in different modules
- Hardcoded DEBUG level in library code
- Configuration happens at import time

### Proposed Fix

**In scheduling_engine.py:**
```python
import logging

# Remove: logging.basicConfig(level=logging.DEBUG)

# Instead, just get a logger
logger = logging.getLogger(__name__)
# Remove the basicConfig call entirely
```

**In app.py (keep only here):**
```python
import logging
import os

def configure_logging():
    """Configure logging for the application."""
    log_level = os.getenv("LOG_LEVEL", "INFO")
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format=log_format,
        handlers=[
            logging.StreamHandler(),
            # Add file handler if needed
        ]
    )

    # Adjust third-party loggers if needed
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

# Call at startup
@app.on_event("startup")
async def startup_event():
    configure_logging()
    logger.info("Starting up application...")
    # ... rest of startup
```

**In cli.py:**
```python
def main():
    args = parse_args()

    # Configure logging based on CLI args
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s - %(levelname)s - %(message)s"
    )

    # ... rest of main
```

### Migration Checklist
- [ ] Remove `logging.basicConfig()` from scheduling_engine.py
- [ ] Remove `logging.basicConfig()` from format_converter.py
- [ ] Remove `logging.basicConfig()` from excel_importer.py
- [ ] Keep `logging.basicConfig()` only in app.py and cli.py
- [ ] Add LOG_LEVEL environment variable support
- [ ] Update documentation
- [ ] Test logging in different modes

---

## Fix #3: Remove Debug Output to stderr

### Current Code
```python
# In multiple places:
sys.stderr.write(f"[SEQUENTIAL] Task '{task_name}' marked as sequential\n")
sys.stderr.flush()
```

### Proposed Fix
```python
# Replace with proper logging
logger.debug(f"Task '{task_name}' marked as sequential (task_str: '{task_str}')")

# For more detailed debugging:
logger.debug(
    "Sequential task detected",
    extra={
        "task_name": task_name,
        "task_str": task_str,
        "sequential": True
    }
)
```

### Find and Replace Strategy
```bash
# Find all sys.stderr.write calls
grep -rn "sys.stderr.write" packages/noodle-core/

# For each occurrence:
# 1. Extract the message
# 2. Convert to logger.debug()
# 3. Remove sys.stderr.flush()
# 4. Adjust log level as appropriate (debug, info, warning)
```

### Locations to Fix
- `scheduling_engine.py:213-219` - Sequential task markers
- `scheduling_engine.py:479` - Task scheduling debug
- `scheduling_engine.py:492-493` - Sequential logic debug
- `scheduling_engine.py:510-515` - Task scheduling results

---

## Fix #4: Remove Unreachable Code

### Current Code
```python
def extract_metadata(task_str, task_name=None):
    # ... 270 lines of code ...
    return meta  # Line 271

    # UNREACHABLE CODE BELOW:
    # Task number
    num_match = re.match(r"\s*[\*]?\s*([0-9]+)\. ", task_str)
    if num_match:
        meta['number'] = int(num_match.group(1))
    # Description
    desc_match = re.match(r"\s*[\*]?\s*\d+\. ([^,]+)", task_str)
    if desc_match:
        meta['description'] = desc_match.group(1).strip()
    return meta  # Second return!
```

### Proposed Fix

**Option 1: Delete if not needed**
```python
def extract_metadata(task_str, task_name=None):
    # ... existing code ...
    return meta
    # Remove lines 272-280 entirely
```

**Option 2: Move before return if needed**
```python
def extract_metadata(task_str, task_name=None):
    # ... existing code ...

    # Add task number extraction BEFORE the return
    num_match = re.match(r"\s*[\*]?\s*([0-9]+)\. ", task_str)
    if num_match:
        meta['number'] = int(num_match.group(1))

    # Add description extraction if different from current logic
    # (check if this conflicts with existing description logic)

    return meta
```

### Investigation Required
1. Check if any code depends on 'number' field in metadata
2. Check if current description logic covers numbered lists
3. Review git history to see why this code is unreachable
4. Add tests for numbered task lists if keeping this feature

### Tests to Add
```python
def test_extract_metadata_numbered_task():
    """Test task with number prefix."""
    meta = extract_metadata("1. Deploy to production @alice", "Deploy to production")
    assert meta.get('number') == 1
    assert meta.get('description') == "Deploy to production"

def test_extract_metadata_sequential_numbered_task():
    """Test sequential task with number."""
    meta = extract_metadata("*2. Review code @bob", "Review code")
    assert meta.get('sequential') is True
    assert meta.get('number') == 2
```

---

## Fix #5: Tempfile Resource Leak Protection

### Current Code
```python
# Pattern repeated multiple times:
with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
    tmp_path = tmp.name
try:
    export_to_excel(converted_content, tmp_path, ...)
    with open(tmp_path, 'rb') as f:
        file_bytes = f.read()
    return Response(content=file_bytes, ...)
finally:
    if os.path.exists(tmp_path):
        os.unlink(tmp_path)
```

### Proposed Fix

**Option 1: Use delete=True and read within context**
```python
with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=True) as tmp:
    export_to_excel(converted_content, tmp.name, ...)
    # Read before context exits
    tmp.seek(0)
    file_bytes = tmp.read()
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{project_name}.xlsx"'}
    )
```

**Option 2: Use context manager helper**
```python
from contextlib import contextmanager
import tempfile
import os

@contextmanager
def temp_file_cleanup(suffix='', prefix='tmp'):
    """Context manager that ensures temp file cleanup."""
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, prefix=prefix, delete=False)
    tmp_path = tmp.name
    tmp.close()

    try:
        yield tmp_path
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception as e:
            logger.error(f"Failed to cleanup temp file {tmp_path}: {e}")

# Usage:
with temp_file_cleanup(suffix='.xlsx') as tmp_path:
    export_to_excel(converted_content, tmp_path, ...)
    with open(tmp_path, 'rb') as f:
        file_bytes = f.read()
    return Response(content=file_bytes, ...)
```

**Option 3: Use atexit for critical cleanup**
```python
import atexit
import tempfile

# Track temp files for cleanup
_temp_files = set()

def cleanup_temp_files():
    """Cleanup all tracked temp files on exit."""
    for tmp_path in _temp_files:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception as e:
            logger.error(f"Failed to cleanup {tmp_path}: {e}")

atexit.register(cleanup_temp_files)

def create_tracked_temp_file(suffix=''):
    """Create temp file that will be cleaned up on exit."""
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    tmp.close()
    _temp_files.add(tmp_path)
    return tmp_path

# Usage:
tmp_path = create_tracked_temp_file(suffix='.xlsx')
try:
    export_to_excel(converted_content, tmp_path, ...)
    with open(tmp_path, 'rb') as f:
        file_bytes = f.read()
    return Response(content=file_bytes, ...)
finally:
    # Still try to cleanup immediately
    if os.path.exists(tmp_path):
        os.unlink(tmp_path)
        _temp_files.discard(tmp_path)
```

### Recommended Solution
Use Option 2 (context manager helper) as it provides:
- Guaranteed cleanup
- Error logging
- Reusable pattern
- Clear intent

### Locations to Fix
- app.py:164-185 (Excel export)
- app.py:188-209 (CSV export)
- app.py:212-233 (PPT export)
- app.py:236-257 (PDF export)
- app.py:324-338 (Excel in ZIP)
- app.py:342-356 (CSV in ZIP)
- app.py:360-374 (PPT in ZIP)
- app.py:378-392 (PDF in ZIP)
- app.py:700-730 (Excel upload analysis)

---

## Fix #6: Improve Exception Handling

### Current Pattern
```python
try:
    if s.startswith('P') and 'D' in s:
        days = int(s.split('P')[1].split('D')[0])
        return timedelta(days=days)
except Exception:  # Too broad!
    pass
return None
```

### Proposed Fix
```python
def parse_duration(s):
    """Parse duration string in ISO 8601 format.

    Args:
        s: Duration string (e.g., 'P5D' for 5 days)

    Returns:
        timedelta object or None if parsing fails

    Examples:
        >>> parse_duration('P5D')
        timedelta(days=5)
        >>> parse_duration('invalid')
        None
    """
    if not s:
        return None

    try:
        # Only support days for simplicity
        if s.startswith('P') and 'D' in s:
            # Extract number between P and D
            days_str = s.split('P')[1].split('D')[0]
            days = int(days_str)

            # Validate reasonable range
            if days < 0:
                logger.warning(f"Negative duration parsed: {s}")
                return None
            if days > 36500:  # 100 years
                logger.warning(f"Duration too large: {s} ({days} days)")
                return None

            return timedelta(days=days)

        logger.debug(f"Duration format not recognized: {s}")
        return None

    except (ValueError, IndexError, AttributeError) as e:
        logger.debug(f"Failed to parse duration '{s}': {e}")
        return None
    except Exception as e:
        # Catch unexpected errors but log them
        logger.error(f"Unexpected error parsing duration '{s}': {e}", exc_info=True)
        return None
```

### Pattern to Apply Throughout
1. Catch specific exceptions (ValueError, KeyError, etc.)
2. Log at appropriate level (debug for expected failures, error for unexpected)
3. Include context in log messages
4. Only catch `Exception` as last resort and always log
5. Consider re-raising critical exceptions

### Locations to Update
- scheduling_engine.py:135 (parse_duration)
- format_converter.py:42 (YAML parsing)
- database.py:55 (database errors)
- middleware.py:101 (activity logging)
- All other bare `except Exception:` blocks

---

## Fix #7: Database Error Handling

### Current Code
```python
def test_connection():
    """Test database connection"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print(f"Database connection failed: {e}")  # Wrong!
        return False
```

### Proposed Fix
```python
def test_connection():
    """Test database connection and log results.

    Returns:
        dict with 'success' (bool), 'message' (str), and 'error' (Exception or None)
    """
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            row = result.fetchone()
            if row and row[0] == 1:
                logger.info("Database connection successful")
                return {
                    'success': True,
                    'message': 'Connected successfully',
                    'error': None
                }
            else:
                logger.error("Database connection test query returned unexpected result")
                return {
                    'success': False,
                    'message': 'Unexpected query result',
                    'error': None
                }

    except OperationalError as e:
        # Connection/network errors
        logger.error(f"Database connection failed (operational error): {e}")
        return {
            'success': False,
            'message': 'Cannot connect to database',
            'error': e
        }
    except Exception as e:
        # Unexpected errors
        logger.error(f"Database connection test failed (unexpected error): {e}", exc_info=True)
        return {
            'success': False,
            'message': 'Database connection test failed',
            'error': e
        }

# Usage in startup:
@app.on_event("startup")
async def startup_event():
    logger.info("Starting up application...")
    result = test_connection()
    if result['success']:
        logger.info("Database connection successful")
    else:
        logger.warning(f"Database connection failed: {result['message']}")
        logger.warning("Activity logging may not work")
        # In strict mode, could raise exception here
```

---

## Fix #8: Input Validation

### Add Request Validation Middleware

```python
# New file: packages/noodle-web/src/noodle_web/validation.py

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import logging

logger = logging.getLogger(__name__)

class InputValidationMiddleware(BaseHTTPMiddleware):
    """Middleware to validate request inputs."""

    async def dispatch(self, request: Request, call_next):
        # Validate content length
        content_length = request.headers.get('content-length')
        if content_length:
            length = int(content_length)
            max_size = 10 * 1024 * 1024  # 10 MB
            if length > max_size:
                logger.warning(f"Request too large: {length} bytes from {request.client.host}")
                raise HTTPException(
                    status_code=413,
                    detail=f"Request too large. Maximum size is {max_size} bytes"
                )

        # Continue processing
        response = await call_next(request)
        return response

# In app.py:
app.add_middleware(InputValidationMiddleware)
```

### Add Plan Validation

```python
# New file: packages/noodle-core/src/noodle_core/validation.py

from typing import Dict, List, Any
import logging

logger = logging.getLogger(__name__)

class PlanValidationError(Exception):
    """Raised when plan validation fails."""
    pass

def validate_plan_complexity(plan_text: str, max_tasks: int = 10000, max_depth: int = 20) -> Dict[str, Any]:
    """Validate plan doesn't exceed complexity limits.

    Args:
        plan_text: The plan text to validate
        max_tasks: Maximum number of tasks allowed
        max_depth: Maximum nesting depth allowed

    Returns:
        Dict with validation results

    Raises:
        PlanValidationError: If validation fails in strict mode
    """
    lines = plan_text.split('\n')
    task_count = 0
    max_indent = 0

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or stripped == '---':
            continue

        # Count as potential task
        task_count += 1

        # Check nesting depth
        indent = len(line) - len(line.lstrip())
        max_indent = max(max_indent, indent)

    # Calculate depth from indentation (2 spaces = 1 level)
    max_depth_actual = max_indent // 2

    # Validate limits
    issues = []
    if task_count > max_tasks:
        issues.append(f"Too many tasks: {task_count} (max {max_tasks})")

    if max_depth_actual > max_depth:
        issues.append(f"Nesting too deep: {max_depth_actual} levels (max {max_depth})")

    return {
        'valid': len(issues) == 0,
        'task_count': task_count,
        'max_depth': max_depth_actual,
        'issues': issues
    }

# Usage in endpoint:
@app.post("/render")
async def render_plan(data: RenderRequest):
    # Validate plan complexity
    validation = validate_plan_complexity(data.plan_text)
    if not validation['valid']:
        raise HTTPException(
            status_code=400,
            detail={
                'error': 'Plan validation failed',
                'issues': validation['issues']
            }
        )

    # Continue with rendering
    # ...
```

---

## Implementation Plan

### Phase 1: Critical Fixes (Week 1)
- [ ] Fix #1: Infinite loop protection
- [ ] Fix #2: Logging configuration
- [ ] Fix #3: Remove stderr output
- [ ] Add comprehensive tests for fixes

### Phase 2: Resource Management (Week 2)
- [ ] Fix #4: Remove unreachable code
- [ ] Fix #5: Tempfile leak protection
- [ ] Fix #6: Exception handling
- [ ] Add resource cleanup tests

### Phase 3: Validation (Week 3)
- [ ] Fix #7: Database error handling
- [ ] Fix #8: Input validation
- [ ] Add edge case tests from test_edge_cases.py
- [ ] Performance testing

### Phase 4: Documentation and Deployment
- [ ] Update all documentation
- [ ] Add migration guide
- [ ] Update deployment scripts
- [ ] Release notes

---

## Testing Strategy

### Unit Tests
- All critical fixes must have unit tests
- Tests must cover both success and failure cases
- Tests must verify error messages and logging

### Integration Tests
- Test complete workflows with fixes in place
- Test error recovery scenarios
- Test resource cleanup

### Performance Tests
- Verify no performance regression
- Test with large inputs (edge cases)
- Monitor resource usage

### Regression Tests
- Run full existing test suite
- Verify no broken functionality
- Check for unexpected behavior changes

---

## Rollback Plan

For each fix:
1. Create feature branch
2. Implement fix with tests
3. Code review
4. Merge to develop
5. Test in staging
6. Tag release
7. Deploy to production
8. Monitor for issues

If issues arise:
1. Identify problematic change
2. Revert specific commit
3. Re-test
4. Document issue
5. Plan alternative fix

---

## Success Criteria

- [ ] All 8 critical issues resolved
- [ ] Zero test failures
- [ ] Code coverage maintained or improved
- [ ] No performance regression
- [ ] Documentation updated
- [ ] Deployment successful
- [ ] No production issues in first week
