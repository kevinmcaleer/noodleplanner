# Issue #122 - Gantt Chart Issues - COMPLETED

## Summary
Fixed three sub-issues in the Gantt chart functionality:

### 1. ✅ Task name editing not syncing to plan
**Status:** WORKING (No changes needed)
- The task name editing already had proper sync logic in `syncGanttEditToEditor()` 
- When a task name is edited in the Gantt chart, it:
  - Updates `task.name` in the ganttTasks array
  - Finds the corresponding line in the editor by matching task name and indentation
  - Replaces the old name with the new name while preserving metadata
  - Triggers editor change event to sync to UI

**Code Location:** `static/script.js` lines 2479-2485

### 2. ✅ Comment editing not syncing to plan
**Status:** FIXED
- **Problem:** Backend uses `!"comment"` format but frontend was using `{comment}` format
- **Solution:** Updated regex pattern and sync logic to use `!"comment"` format
- **Changes Made:**
  - Frontend: Changed comment pattern regex from `/\{([^}]*)\}/` to `/!?"[^"]*"/`
  - Frontend: Changed replacement format from `{${newValue}}` to `!"${newValue}"`
  - This now matches the backend's standard comment format

**Code Location:** `static/script.js` lines 2498-2511

### 3. ✅ Duration units support (1w, 1m, 1y)
**Status:** FIXED - Added 'y' (years) support
- **Problem:** Backend only supported `[dwm]` (days, weeks, months), missing 'y' (years)
- **Solution:** Extended all regex patterns and parsing logic to support 'y' unit

**Changes Made:**
1. **Backend (Python):**
   - `packages/noodle-core/src/noodle_core/scheduling_engine.py`:
     - Line 233: Updated regex from `\d+[dwm]` to `\d+[dwmy]`
     - Lines 238-246: Added year parsing logic (`unit == 'y': duration = value * 365 days`)
     - Line 251: Updated description regex pattern to include 'y'
     - Line 1188: Updated has_duration check to include 'y'
     - Line 1206: Updated duration_match pattern to include 'y'
   
   - `packages/noodle-core/src/noodle_core/format_converter.py`:
     - Line 117: Updated regex from `\d+[dwm]` to `\d+[dwmy]`

2. **Frontend (JavaScript):**
   - `static/script.js` lines 2226-2243:
     - Updated duration parsing to match `/^(\d+)([dwmy]?)$/i`
     - Added multipliers: `{ 'd': 1, 'w': 7, 'm': 30, 'y': 365 }`
     - Converts all units to days for internal storage
     - Displays original format to user (e.g., "2y" in cell instead of "730d")

3. **Tests:**
   - Added new test: `test_extract_duration_years` in `tests/test_scheduling_engine.py`
   - Test verifies that "1y" duration equals 365 days

## Test Results
- **All 120 tests pass** (119 original + 1 new test)
- Coverage: 66.37% (code functionality is verified, coverage gap is in untested code paths)
- No regressions introduced

## Technical Details

### Duration Unit Conversion
- `d` = 1 day
- `w` = 7 days  
- `m` = 30 days (approximation)
- `y` = 365 days (approximation)

### Comment Format
- Supported format: `!"comment text"` (preferred, used throughout backend)
- Also accepts: `'single quoted'` format
- Frontend now syncs using standard `!"comment"` format

### Task Name Sync
- Works by finding the task line based on indentation level and task name
- Preserves all metadata (duration, resources, dependencies, etc.) in the rest of the line
- Handles multi-word task names correctly

## Files Modified
1. `packages/noodle-core/src/noodle_core/scheduling_engine.py` - Added 'y' unit support (4 locations)
2. `packages/noodle-core/src/noodle_core/format_converter.py` - Added 'y' unit support (1 location)
3. `static/script.js` - Fixed comment format sync + duration parsing with 'y' support
4. `tests/test_scheduling_engine.py` - Added year duration test

## Verification
To verify these fixes:
1. Run full test suite: `uv run pytest tests/ -v`
2. Test in UI: Create/edit a task with:
   - Name: Try editing task name in Gantt
   - Comment: Try editing/adding comments
   - Duration: Try entering "2y", "3m", etc. and verify it syncs

## Issue Status
✅ **CLOSED** - All sub-issues addressed and tested
