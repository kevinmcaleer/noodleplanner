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

```bash
# The CLI is ready to use - just run the noodle script
./noodle --help
```

## Commands

### `render` - Generate Schedule

Render a project file to markdown schedule output.

```bash
# Auto-detect format (natural language or YAML)
./noodle render my_project.txt

# Explicitly specify format
./noodle render my_project.txt --format natural

# Split output into separate files
./noodle render my_project.txt --split-markdown --output-dir output/

# Custom project name
./noodle render tasks.txt --project-name "My Awesome Project"
```

**Options:**
- `--format` - Input format: `auto` (default), `yaml`, or `natural`
- `--project-name` - Project name (defaults to filename)
- `--split-markdown` - Split output into separate .md files
- `--output-dir` - Output directory for split files (default: current dir)

### `init` - Create Sample Project

Create a starter YAML project file.

```bash
./noodle init sample_project.yaml

# Overwrite existing file
./noodle init sample_project.yaml --force
```

### `validate` - Validate Project

Validate a project file.

```bash
./noodle validate my_project.yaml
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
./noodle render my_project.txt --log-level INFO

# Debug mode
./noodle render my_project.txt --log-level DEBUG
```

### Piping Output
```bash
# Save to file
./noodle render my_project.txt > schedule.md

# View with less
./noodle render my_project.txt | less

# Copy to clipboard (macOS)
./noodle render my_project.txt | pbcopy
```

## Requirements

- Python 3.10+
- pyyaml
- python-dateutil

Dependencies are installed in the `cli_venv` virtual environment.

## Architecture

```
noodle (entry point)
├── cli_venv/ (Python virtual environment)
└── projects/scheduling_engine/
    ├── cli.py (CLI interface)
    ├── scheduling_engine.py (Core logic)
    └── __init__.py
```

## Troubleshooting

### Permission denied
```bash
chmod +x noodle
```

### Module not found
```bash
# Recreate the virtual environment
rm -rf cli_venv
python3 -m venv cli_venv
cli_venv/bin/pip install pyyaml python-dateutil
```

### Task dates seem wrong
- Check that dependencies exist
- Verify date formats (YYYY-MM-DD)
- Use `--log-level DEBUG` to see scheduling details

## Examples

See the `test_project.txt` file for a working example, or run:

```bash
./noodle init example.yaml
./noodle render example.yaml
```

## Next Steps

- Add more projects to track
- Use `--split-markdown` to generate separate files
- Integrate with your project management workflow
- Pipe output to your favorite markdown viewer

Enjoy scheduling with Noodle! 🍜
