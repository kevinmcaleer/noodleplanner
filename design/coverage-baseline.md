# Test Coverage Baseline

> Report date: 2026-03-08
> Python version: 3.14.3
> pytest version: 9.0.0
> Total tests: 876 (all passing)
> Test runtime: ~21 minutes

---

## Overall Coverage

**79.47%** (target: 80.00%)

The codebase is 0.53 percentage points below the 80% coverage threshold defined in CLAUDE.md.

---

## Per-File Coverage Breakdown

| File | Statements | Missed | Coverage | Status |
|------|-----------|--------|----------|--------|
| `noodle_core/__init__.py` | 6 | 0 | 100.00% | PASS |
| `noodle_core/excel_importer.py` | 704 | 68 | 90.34% | PASS |
| `noodle_core/format_converter.py` | 466 | 86 | 81.55% | PASS |
| `noodle_core/planning_room.py` | 142 | 56 | **60.56%** | FAIL |
| `noodle_core/scheduling_engine.py` | 2798 | 596 | **78.70%** | FAIL |
| `noodle_web/__init__.py` | 6 | 0 | 100.00% | PASS |
| `noodle_web/app.py` | 848 | 228 | **73.11%** | FAIL |
| `noodle_web/database.py` | 68 | 11 | 83.82% | PASS |
| `noodle_web/middleware.py` | 61 | 14 | **77.05%** | FAIL |
| `noodle_web/security.py` | 89 | 6 | 93.26% | PASS |
| **TOTAL** | **5188** | **1065** | **79.47%** | **FAIL** |

---

## Files Below 80% Threshold

### 1. `noodle_core/planning_room.py` -- 60.56% (worst)

- **Gap:** 19.44 percentage points below threshold
- **Missed lines:** 56 of 142 statements
- **Key uncovered areas:** Lines 64-69, 113-120, 229-237, 262-289, 304-320, 336-338
- **Impact:** Medium -- planning room is a feature module with AI integration
- **Effort to fix:** Low-Medium -- relatively small file (142 statements)

### 2. `noodle_web/app.py` -- 73.11%

- **Gap:** 6.89 percentage points below threshold
- **Missed lines:** 228 of 848 statements
- **Key uncovered areas:** Export endpoints (lines 436-451, 814-853), database/file management routes (1141-1304), several API endpoints
- **Impact:** High -- this is the main web application file with all route handlers
- **Effort to fix:** High -- 228 missed lines across many routes; requires HTTP test client fixtures

### 3. `noodle_web/middleware.py` -- 77.05%

- **Gap:** 2.95 percentage points below threshold
- **Missed lines:** 14 of 61 statements
- **Key uncovered areas:** Error handling paths (lines 43-52), logging configuration (95-104)
- **Impact:** Medium -- middleware handles security headers and request logging
- **Effort to fix:** Low -- only 14 missed lines in a small file

### 4. `noodle_core/scheduling_engine.py` -- 78.70%

- **Gap:** 1.30 percentage points below threshold
- **Missed lines:** 596 of 2798 statements
- **Key uncovered areas:** Advanced scheduling features (lines 1422-1482), export functions (3837-3896), edge cases in date calculations (4348-4721)
- **Impact:** High -- this is the core scheduling engine, the heart of the application
- **Effort to fix:** High -- 596 missed lines, but many are in less-used code paths

---

## Recommendations

### Quick wins to reach 80% (ordered by impact-to-effort ratio)

1. **middleware.py (+2.95pp needed, 14 lines):** Add tests for error handling middleware paths and logging setup. Smallest file, easiest to bring above threshold.

2. **scheduling_engine.py (+1.30pp needed):** Add tests for a few more scheduling edge cases. Only needs ~35 more lines covered to reach 80%. Focus on the date calculation edge cases around lines 2784-2836.

3. **planning_room.py (+19.44pp needed, 56 lines):** Add tests for the AI planning room functions. Despite the large gap, the file is small and self-contained.

### Larger efforts

4. **app.py (+6.89pp needed, 228 lines):** This is the biggest contributor to the overall coverage gap. Priority areas:
   - Export endpoint tests (Excel, CSV, PPT, PDF)
   - File management API tests
   - Database-backed route tests (requires test database fixtures)

### Path to 80%

To reach 80% overall, we need to cover approximately 28 more statements (0.53% of 5188). The most efficient path:

- Add ~14 lines of middleware test coverage (middleware.py -> 80%)
- Add ~35 lines of scheduling engine test coverage (scheduling_engine.py -> 80%)

This alone would push the total above 80%.

---

## How to Reproduce This Report

```bash
uv run pytest --cov=noodle_core --cov=noodle_web --cov-report=term-missing -q
```

For an HTML report:

```bash
uv run pytest --cov=noodle_core --cov=noodle_web --cov-report=term-missing --cov-report=html
```
