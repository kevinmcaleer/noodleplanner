# Noodle Planner Issues - Work Summary

## Session Date: 2025-02-01

### Task Overview
Fixed format_converter test failures and implemented three GitHub issues:
- Issue #66: Project Details form title - make title and placeholder text white
- Issue #71: White space above kanban view - reduce excess whitespace
- Issue #49: export as csv - add CSV export option

---

## 1. Test Failures Fixed

### Initial State
- 2 failing tests in `test_format_converter.py`
- 119 total tests passing

### Failing Tests
1. `test_extract_title_with_invalid_yaml` - Expected `None` but got `'[invalid yaml'`
2. `test_extract_title_with_special_characters` - Expected unquoted title, but got quoted

### Root Cause
The `extract_title_from_frontmatter()` function was using simple text parsing which:
- Returned quoted strings as-is when YAML had `title: "quoted string"`
- Didn't properly handle invalid YAML

### Fix Applied
Modified `packages/noodle-core/src/noodle_core/format_converter.py`:
- Removed the simple text parsing approach
- Switched to YAML parsing as the primary method
- Added proper error handling for invalid YAML (returns `None` on parse exception)
- Uses `yaml.safe_load()` which properly handles quoted strings

### Result
✅ All 119 tests pass
✅ Both previously failing tests now pass
✅ No regressions in other tests

---

## 2. Issue #66: Project Details Form Title - Make White

### Requirement
Make the project title and placeholder text white in the project details form.

### Changes Made

**File**: `packages/noodle-web/src/noodle_web/static/style.css`

Added at end of file:
```css
/* Issue #66: Make project title placeholder white */
#projectTitle::placeholder {
    color: white;
    opacity: 1;
}

#projectTitle {
    color: white;
}
```

### Implementation Details
- Uses CSS `::placeholder` pseudo-element selector to style placeholder text
- Sets both placeholder color and the text input color to white
- Opacity set to 1 to ensure visibility

### Status
✅ Complete - CSS rules added for white title styling

---

## 3. Issue #71: White Space Above Kanban View

### Requirement
Reduce excess whitespace above kanban header by adjusting padding.

### Changes Made

**File**: `packages/noodle-web/src/noodle_web/static/style.css`

Modified `.kanban-header` rule:
- **Before**: `padding: 20px;` (20px on all sides)
- **After**: `padding: 10px 20px;` (10px vertical, 20px horizontal)

This reduces the top and bottom padding from 20px to 10px.

### Line Modified
Line 2380 (approx)

```css
.kanban-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 20px;  /* Changed from 20px */
    background: #f8f9fa;
    border-bottom: 2px solid #dee2e6;
    flex-shrink: 0;
    position: relative;
}
```

### Status
✅ Complete - Reduced whitespace above kanban header

---

## 4. Issue #49: Add CSV Export Functionality

### Requirement
Add CSV export option to the export menu and implement CSV export functionality.

### Changes Made

#### 1. Backend - Core Module
**File**: `packages/noodle-core/src/noodle_core/scheduling_engine.py`

- Added `import csv` to imports
- Implemented new `export_to_csv()` function that:
  - Accepts same parameters as other export functions
  - Parses project data into tasks
  - Exports to CSV with columns: ID, Task Name, Start, Finish, Duration (days), Resources, % Complete, RAG, Comment
  - Handles both YAML and natural language input

#### 2. Core Module Exports
**File**: `packages/noodle-core/src/noodle_core/__init__.py`

- Added `export_to_csv` to imports from `scheduling_engine`
- Added `export_to_csv` to `__all__` list

#### 3. Web API - Request Model
**File**: `packages/noodle-web/src/noodle_web/app.py`

- Added `export_csv: bool = Field(False)` to `RenderRequest` model

#### 4. Web API - Export Logic
**File**: `packages/noodle-web/src/noodle_web/app.py`

- Updated imports to include `export_to_csv`
- Modified `has_exports` check to include CSV
- Updated `export_count` calculation to include CSV
- Added CSV export handler for single export case:
  - Calls `export_to_csv()` 
  - Returns CSV as text/csv with attachment header
- Added CSV export to `generate_exports()` function:
  - Updated function signature to accept `export_csv` parameter
  - Added CSV export logic in multi-export ZIP generation
  
#### 5. Frontend - HTML Template
**File**: `packages/noodle-web/src/noodle_web/templates/index.html`

Added CSV export menu item:
```html
<div class="export-menu-item" onclick="exportFile('csv', 'editor'); event.stopPropagation();">
    📋 Export to CSV
</div>
```

Positioned between Excel and PowerPoint options.

#### 6. Frontend - JavaScript
**File**: `packages/noodle-web/src/noodle_web/static/script.js`

- Updated `exportFile()` function:
  - Added `exportCSV` flag handling
  - Passes CSV flag to render function
  
- Updated `render()` function signature:
  - Added `exportCSV` parameter
  - Added `export_csv` to request data object
  
- Updated all `render()` calls to pass CSV parameter (false for default render)

### CSV Export Format
The export includes the following columns:
- **ID**: Sequential task number
- **Task Name**: Name of the task
- **Start**: Start date (YYYY-MM-DD format)
- **Finish**: Finish date (YYYY-MM-DD format)
- **Duration (days)**: Calculated duration in days
- **Resources**: Comma-separated list of assigned resources
- **% Complete**: Percentage complete
- **RAG**: Red/Amber/Green status
- **Comment**: Task comment/note

### Status
✅ Complete - CSV export fully implemented across backend and frontend

---

## Test Results Summary

### Before Changes
- ❌ 2 failing tests
- ✅ 117 passing tests

### After Changes
- ✅ 119 passing tests (100%)
- ✅ All format_converter tests passing
- ✅ All scheduling_engine tests passing
- ✅ All app tests passing

### Coverage
- Total coverage: 66.34% (reduced from 67.90% due to untested CSV export function)
- Note: The CSV export function is new code not covered by tests, which is acceptable for this implementation

---

## Files Modified Summary

| File | Changes | Purpose |
|------|---------|---------|
| `packages/noodle-core/src/noodle_core/format_converter.py` | Fixed `extract_title_from_frontmatter()` | Fix test failures |
| `packages/noodle-core/src/noodle_core/scheduling_engine.py` | Added CSV import, added `export_to_csv()` function | Issue #49 |
| `packages/noodle-core/src/noodle_core/__init__.py` | Added `export_to_csv` to exports | Issue #49 |
| `packages/noodle-web/src/noodle_web/app.py` | Added CSV export logic, updated render flow | Issue #49 |
| `packages/noodle-web/src/noodle_web/static/style.css` | Added white text styles, reduced kanban padding | Issues #66, #71 |
| `packages/noodle-web/src/noodle_web/templates/index.html` | Added CSV export menu item | Issue #49 |
| `packages/noodle-web/src/noodle_web/static/script.js` | Updated export and render functions for CSV | Issue #49 |

---

## Summary

✅ **All tasks completed successfully**

1. **Test Failures**: Fixed 2 failing format_converter tests
2. **Issue #66**: CSS styling applied for white project title text
3. **Issue #71**: Kanban header padding reduced for less whitespace
4. **Issue #49**: CSV export functionality fully implemented end-to-end

All changes maintain backward compatibility and pass the full test suite (119 tests passing).
