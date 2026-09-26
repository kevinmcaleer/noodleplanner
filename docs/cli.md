# Noodle Planner CLI

A command-line tool for project scheduling with natural language task input.

## Quick Start

```bash
# Create a test project file
cat > my_project.txt <<EOF
Phase 1: Design
  design @alice @bob 2025-12-01 10d
  mockups @bob 2025-12-01 5d
Phase 2: Build
  *implement @alice #design !"Build the feature" 5d
  *test @bob #implement !"Run all tests" 50% 3d
Phase 3: Deploy
  *deploy @alice @bob #test !"Deploy to production" 1d
  review @bob #deploy !"Final review" 0% 2w
EOF

# Render the schedule
./noodle render my_project.txt
```

## Installation

This project uses [uv](https://github.com/astral-sh/uv) workspaces for dependency management.

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Sync all workspace dependencies
uv sync

# The CLI is now ready to use
uv run noodle --help
```

## Commands

### `render` - Generate Schedule

Render a project file to markdown schedule output.

```bash
# Auto-detect format (natural language or YAML)
uv run noodle render my_project.txt

# Explicitly specify format
uv run noodle render my_project.txt --format natural

# Split output into separate files
uv run noodle render my_project.txt --split-markdown --output-dir output/

# Custom project name
uv run noodle render tasks.txt --project-name "My Awesome Project"
```

**Options:**
- `--format` - Input format: `auto` (default), `yaml`, or `natural`
- `--project-name` - Project name (defaults to filename)
- `--split-markdown` - Split output into separate .md files
- `--output-dir` - Output directory for split files (default: current dir)

### `init` - Create Sample Project

Create a starter project plan (two phases, two resources, a dependency and a
milestone) in the markdown plan format.

```bash
uv run noodle init sample_project.md

# Overwrite existing file
uv run noodle init sample_project.md --force
```

### `validate` - Validate Project

Check a plan for errors and warnings -- the same checks as `analyze`, one line
per issue and without the suggestions. Exits 1 if there are any errors.

```bash
uv run noodle validate my_project.md
```

## Natural Language Format

The natural language format is simple and intuitive:

```
Phase Name or Summary Task
  task_name @resource1 @resource2 YYYY-MM-DD duration
  *sequential_task #dependency !"Comment" percentage%
```

### Syntax Elements

| Element | Format | Example | Description |
|---------|--------|---------|-------------|
| **Task name** | First word(s) | `design` | Task identifier |
| **Resource** | `@name` | `@alice` | Assign person/resource |
| **Dependency** | `#taskname` | `#design` | Wait for another task |
| **Comment** | `!"text"` | `!"Build it"` | Task note/comment |
| **Progress** | `N%` | `50%` | Percent complete (0-100%) |
| **Start date** | `YYYY-MM-DD` | `2025-12-01` | Task start date |
| **Duration** | `Nd`, `Nw`, `Nm` | `5d`, `2w` | Duration (days/weeks/months) |
| **Sequential** | `*` prefix | `*implement` | Wait for previous task |
| **Indentation** | Spaces | `  task` | Creates hierarchy |

### Examples

#### Basic Task
```
design @alice 5d
```
- Task named "design"
- Assigned to alice
- Duration: 5 days

#### Task with Dependencies
```
*test @bob #design !"Run all tests" 50% 3d
```
- Sequential task (waits for previous)
- Depends on "design" task
- Assigned to bob
- Comment: "Run all tests"
- 50% complete
- Duration: 3 days

#### Summary Task (Phase)
```
Phase 1: Planning
  requirements @alice 5d
  design @bob 3d
```
- "Phase 1: Planning" is auto-calculated from children
- Contains two subtasks

## Output Format

The CLI generates three sections:

### 1. Project Schedule Table
- Task ID, name, start/finish dates
- Duration, resources, % complete
- Comments
- Hierarchical indentation

### 2. Project Timeline
- Phase start/end dates
- Major milestones

### 3. Gantt Chart
- ASCII art visualization
- Shows task dependencies
- Sequential vs parallel tasks
- Progress indicators

## Tips

1. **Indentation matters** - Use 2 or 4 spaces to create task hierarchies
2. **Summary tasks** - Lines without metadata become summary tasks
3. **Sequential tasks** - Use `*` prefix to make tasks wait for the previous one
4. **Dependencies** - Use `#taskname` to reference other tasks by name
5. **Auto-dates** - If no start date is given, tasks start ASAP based on dependencies

## Advanced Usage

### Logging
```bash
# Verbose output
uv run noodle render my_project.txt --log-level INFO

# Debug mode
uv run noodle render my_project.txt --log-level DEBUG
```

### Piping Output
```bash
# Save to file
uv run noodle render my_project.txt > schedule.md

# View with less
uv run noodle render my_project.txt | less

# Copy to clipboard (macOS)
uv run noodle render my_project.txt | pbcopy
```

## Requirements

- Python 3.11+
- uv package manager
- All dependencies managed automatically via uv workspace

## Architecture

```
noodleplanner/
├── pyproject.toml                      # Workspace root
├── packages/
│   ├── noodle-cli/                    # CLI package
│   │   └── src/noodle_cli/
│   │       ├── cli.py                 # CLI interface
│   │       └── __init__.py
│   └── noodle-core/                   # Core engine package
│       └── src/noodle_core/
│           ├── scheduling_engine.py   # Core logic
│           ├── format_converter.py    # Format conversion
│           └── __init__.py
└── tests/                             # Shared test suite
```

## Troubleshooting

### Command not found: uv
```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Module not found
```bash
# Resync the workspace
uv sync
```

### Task dates seem wrong
- Check that dependencies exist
- Verify date formats (YYYY-MM-DD)
- Use `--log-level DEBUG` to see scheduling details

## Examples

See the `test_project.txt` file for a working example, or run:

```bash
uv run noodle init example.md
uv run noodle render example.md
```

## Next Steps

- Add more projects to track
- Use `--split-markdown` to generate separate files
- Integrate with your project management workflow
- Pipe output to your favorite markdown viewer

Enjoy scheduling with Noodle! 🍜
