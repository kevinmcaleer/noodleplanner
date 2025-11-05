# FastHTML Project Scheduler Webapp

A simple, interactive web application for project scheduling with natural language task input.

## Features

- ✅ **Natural language task input** - Write tasks in plain text with simple syntax
- ✅ **Interactive task table** - Click to highlight rows
- ✅ **Task reordering** - Move tasks up/down with buttons
- ✅ **Real-time scheduling** - Updates automatically as you type (press Enter)
- ✅ **Resource allocation** - Visual calendar showing resource usage
- ✅ **Arbitrary nesting** - Support for unlimited task hierarchy levels
- ✅ **Dependency tracking** - Tasks wait for dependencies to complete

## Installation

```bash
# Install webapp-specific dependencies
pip install -r requirements-webapp.txt

# Or install directly:
pip install python-fasthtml markdown python-dateutil pyyaml uvicorn
```

## Running the Webapp

```bash
# Run on localhost:5081
python webapp.py

# Or specify custom host/port
python -c "import uvicorn; from webapp import app; uvicorn.run(app, host='0.0.0.0', port=8000)"
```

Then open your browser to: http://localhost:5081

## Task Format

### Natural Language Format (Recommended)

```
Phase 1: Design
  design @kev @jen 2025-12-01 10d
  mockups @jen 2025-12-01 5d
Phase 2: Build
  *implement @kev #design !"Build the feature" 5d
  *test @jen #implement !"Run all tests" 50% 3d
Phase 3: Deploy
  *deploy @kev @jen #test !"Deploy to production" 1d
  review @jen #deploy !"Final review" 0% 2w
```

### Syntax Elements

- **Task name** - First word/phrase on the line
- **@resource** - Assign resource (e.g., `@kev`, `@jen`)
- **#dependency** - Wait for another task (e.g., `#design`)
- **!"comment"** - Add a comment/note
- **50%** - Percent complete (0-100%)
- **YYYY-MM-DD** - Start date
- **10d** - Duration: 10 days (also: `2w` = 2 weeks, `3m` = 3 months)
- **\*** - Sequential task (waits for previous task)
- **Indentation** - Creates hierarchy (summary tasks auto-calculated from children)

## Interactive Features

### Row Highlighting
- Click any row in the task table to highlight it
- Selected row shows with blue background

### Task Reordering
1. Click a task row to select it
2. Use "↑ Move Up" or "↓ Move Down" buttons
3. Task order updates in the text input
4. Schedule automatically recalculates

**Notes on Reordering:**
- Moving a task changes its display order
- Dependencies remain intact (#taskname references)
- Moving a task outside its summary parent will reassign it to the new parent
- Summary task dates recalculate based on new children

## Architecture

- **webapp.py** - FastHTML web application
- **projects/scheduling_engine/** - Core scheduling logic with arbitrary nesting support
- **templates/default_natural.txt** - Default natural language template
- **templates/default_yaml.yaml** - Default YAML template

## Differences from Main App

This webapp (`webapp.py`) is separate from the main FastAPI app (`app.py`):

| Feature | webapp.py | app.py |
|---------|-----------|--------|
| Framework | FastHTML | FastAPI |
| Authentication | None | JWT + bcrypt |
| Database | None | SQLite |
| Project saving | No | Yes |
| Multi-user | No | Yes |
| Interactive reordering | Yes | No |
| Port | 5081 | 8000 |

The webapp is designed for quick project scheduling without the overhead of user accounts and persistence.

## Tips

1. **Press Enter** in the textarea to regenerate the schedule
2. **Use indentation** to create task hierarchies
3. **Summary tasks** are auto-calculated - just add indented tasks beneath a parent
4. **Dependencies** are tracked by task name (e.g., `#design` waits for the "design" task)
5. **Resource allocation** shows color-coded hours: green (≤8h), yellow (8-10h), red (>10h)

## Troubleshooting

### Module not found: fasthtml
```bash
pip install python-fasthtml
```

### Module not found: scheduling_engine
Make sure you're running from the project root directory where `projects/` folder exists.

### Port already in use
Change the port in the last line of `webapp.py`:
```python
uvicorn.run(app, host="0.0.0.0", port=5081)  # Change 5081 to another port
```
