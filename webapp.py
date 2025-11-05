#!/usr/bin/env python3
"""
FastHTML web application for the project scheduler.
Allows users to input project tasks in YAML format and generates a schedule.
"""

from fasthtml.common import *
from projects.scheduling_engine.scheduling_engine import (
    yaml_to_markdown_table,
    text_to_markdown_table,
    natural_language_to_yaml,
    schedule_tasks,
    calculate_resource_allocation
)
import tempfile
import markdown
from pathlib import Path
from datetime import datetime, timedelta
import json

app, rt = fast_app()

# Load default templates from external files
def load_default_yaml():
    """Load default YAML template from file."""
    template_path = Path(__file__).parent / "templates" / "default_yaml.yaml"
    if template_path.exists():
        return template_path.read_text()
    return ""

def load_default_natural():
    """Load default natural language template from file."""
    template_path = Path(__file__).parent / "templates" / "default_natural.txt"
    if template_path.exists():
        return template_path.read_text()
    return ""

DEFAULT_YAML = load_default_yaml()
DEFAULT_NATURAL = load_default_natural()


def generate_interactive_task_table(tasks, today):
    """Generate an interactive HTML table for tasks with highlighting and reordering."""
    if not tasks:
        return '<p style="color: #666; font-style: italic;">No tasks to display.</p>'

    html = '<div style="margin-bottom: 20px;">'
    html += '<div style="margin-bottom: 10px;">'
    html += '<button id="move-up-btn" onclick="moveTaskUp()" style="padding: 8px 16px; margin-right: 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;" disabled>↑ Move Up</button>'
    html += '<button id="move-down-btn" onclick="moveTaskDown()" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;" disabled>↓ Move Down</button>'
    html += '</div>'
    html += '<table id="task-table" style="width: 100%; border-collapse: collapse; font-size: 14px;">'
    html += '<thead><tr style="background: #f2f2f2;">'
    html += '<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">ID</th>'
    html += '<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Task Name</th>'
    html += '<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Start</th>'
    html += '<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Finish</th>'
    html += '<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Duration</th>'
    html += '<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Resources</th>'
    html += '<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">% Complete</th>'
    html += '<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Comment</th>'
    html += '</tr></thead><tbody>'

    for idx, task in enumerate(tasks, start=1):
        start = task.get('start') or today
        finish = task.get('finish') or (start + (task.get('duration') or timedelta(days=1)))
        resources = task.get('resources', '')
        if resources:
            resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
        percent = task.get('percent', '')
        comment = task.get('comment', '')

        # Use description as task name, fallback to name
        task_name = task.get('description') or task.get('name', '')

        # Make summary task names bold
        is_summary = task.get('summary', False)
        if is_summary:
            task_name = f"<strong>{task_name}</strong>"

        # Indent based on level
        level = task.get('level', 0)
        if level > 0:
            indent = '&nbsp;' * 4 * level
            task_name = f"{indent}{task_name}"

        # Store task data as JSON in data attribute for reordering
        task_data = {
            'name': task.get('name', ''),
            'description': task.get('description', ''),
            'level': level,
            'summary': is_summary,
            'parent': task.get('parent'),
            'phase': task.get('phase', '')
        }

        row_style = "cursor: pointer; transition: background-color 0.2s;"
        if is_summary:
            row_style += " font-weight: 500;"

        html += f'<tr id="task-row-{idx}" class="task-row" onclick="selectRow({idx})" '
        html += f'data-task-index="{idx-1}" data-level="{level}" data-summary="{str(is_summary).lower()}" '
        html += f'style="{row_style}">'
        html += f'<td style="border: 1px solid #ddd; padding: 12px;">{idx}</td>'
        html += f'<td style="border: 1px solid #ddd; padding: 12px;">{task_name}</td>'
        html += f'<td style="border: 1px solid #ddd; padding: 12px;">{start.strftime("%Y-%m-%d")}</td>'
        html += f'<td style="border: 1px solid #ddd; padding: 12px;">{finish.strftime("%Y-%m-%d")}</td>'
        html += f'<td style="border: 1px solid #ddd; padding: 12px;">{task.get("duration", timedelta(days=1)).days}d</td>'
        html += f'<td style="border: 1px solid #ddd; padding: 12px;">{resources}</td>'
        html += f'<td style="border: 1px solid #ddd; padding: 12px;">{percent}</td>'
        html += f'<td style="border: 1px solid #ddd; padding: 12px;">{comment}</td>'
        html += '</tr>'

    html += '</tbody></table></div>'
    return html


@rt("/")
def get():
    """Home page with project input form."""
    return Titled(
        "Project Scheduler",
        Div(
            # Split screen container
            Div(
                # Left panel - Input
                Div(
                    Div(
                        H2("Enter your project tasks", style="margin-bottom: 15px; color: #eee;"),
                    ),
                    Div(
                        # Line numbers
                        Pre(
                            id="line_numbers",
                            style="float: left; width: 40px; height: 60vh; overflow: hidden; background: #1a1a1a; color: #666; text-align: right; padding: 10px 5px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 14px; line-height: 1.5; border: 1px solid #333; border-right: none; border-radius: 5px 0 0 5px; user-select: none; margin: 0; white-space: pre;"
                        ),
                        # Textarea
                        Textarea(
                            DEFAULT_NATURAL,
                            id="task_input",
                            name="task_input",
                            rows="30",
                            style="float: left; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 14px; line-height: 1.5; width: calc(100% - 50px); height: 60vh; padding: 10px; background: #1e1e1e; color: #f0f0f0; border: 1px solid #333; border-left: none; border-radius: 0 5px 5px 0; resize: none; outline: none;"
                        ),
                        style="overflow: hidden; margin-bottom: 20px;"
                    ),
                    Div(
                        H3("Task Format Guide:"),
                        P("Natural Language Format (one task per line):", style="font-weight: bold; margin-bottom: 10px;"),
                        Ul(
                            Li(Code("task_name @resource 10d"), " - Basic task with resource and duration"),
                            Li(Code("*task_name"), " - Sequential task (waits for previous)"),
                            Li(Code("#taskname"), " - Dependency on another task"),
                            Li(Code("!\"comment\""), " - Comment/note"),
                            Li(Code("50%"), " - Percent complete (e.g., 50%)"),
                            Li(Code("YYYY-MM-DD"), " - Start date"),
                            Li(Code("10d"), " - Duration: 10 days (also 2w=2 weeks, 3m=3 months)"),
                            Li(Strong("Summary tasks:"), " Line with no details, indented tasks beneath"),
                        ),
                        style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px; font-size: 14px; max-height: 20vh; overflow-y: auto;"
                    ),
                    style="flex: 1; padding: 20px; overflow-y: auto; background: #252525; min-width: 0;"
                ),
                # Right panel - Output (split into schedule and resources)
                Div(
                    # Top: Schedule Output
                    Div(
                        H2("Schedule Output", style="margin-bottom: 10px; font-size: 18px;"),
                        Div(
                            P("Press Enter in the text area to update the schedule.",
                              style="color: #666; font-style: italic;"),
                            id="output_area",
                            style="background: white; padding: 15px; border: 1px solid #ddd; border-radius: 5px; overflow-x: auto; overflow-y: auto; max-height: 45vh;"
                        ),
                        style="flex: 1; margin-bottom: 10px; min-height: 0;"
                    ),
                    # Bottom: Resource Allocation
                    Div(
                        H2("Resource Allocation", style="margin-bottom: 10px; font-size: 18px;"),
                        Div(
                            P("Resource allocation will appear here.", style="color: #666; font-style: italic;"),
                            id="resource_area",
                            style="background: white; padding: 15px; border: 1px solid #ddd; border-radius: 5px; overflow-x: auto; overflow-y: auto; max-height: 40vh;"
                        ),
                        style="flex: 1; min-height: 0;"
                    ),
                    style="flex: 1; padding: 20px; border-left: 2px solid #ddd; display: flex; flex-direction: column; overflow-y: auto; min-width: 0;"
                ),
                style="display: flex; height: 100vh; width: 100vw;"
            ),
            style="margin: 0; padding: 0; width: 100%; height: 100%;"
        ),
        Script("""
            const textarea = document.getElementById('task_input');
            const outputArea = document.getElementById('output_area');
            const resourceArea = document.getElementById('resource_area');
            const lineNumbers = document.getElementById('line_numbers');

            // Update line numbers
            function updateLineNumbers() {
                const lines = textarea.value.split('\\n').length;
                let lineNumbersText = '';
                for (let i = 1; i <= lines; i++) {
                    lineNumbersText += i + '\\n';
                }
                lineNumbers.textContent = lineNumbersText;
            }

            // Sync scroll between line numbers and textarea
            textarea.addEventListener('scroll', () => {
                lineNumbers.scrollTop = textarea.scrollTop;
            });

            // Update line numbers on input
            textarea.addEventListener('input', updateLineNumbers);

            // Initialize line numbers
            updateLineNumbers();

            async function generateSchedule() {
                // Show loading messages
                outputArea.innerHTML = '<p style="color: #666; font-style: italic;">Generating schedule...</p>';
                resourceArea.innerHTML = '<p style="color: #666; font-style: italic;">Generating resource allocation...</p>';

                try {
                    // Send text to server
                    const response = await fetch('/schedule', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: 'task_input=' + encodeURIComponent(textarea.value)
                    });

                    const data = await response.json();
                    outputArea.innerHTML = data.schedule_html;
                    resourceArea.innerHTML = data.resource_html;
                } catch (error) {
                    outputArea.innerHTML = '<p style="color: #d00;">Error: ' + error.message + '</p>';
                    resourceArea.innerHTML = '<p style="color: #d00;">Error: ' + error.message + '</p>';
                }
            }

            textarea.addEventListener('keydown', async (e) => {
                // Generate schedule on Enter key
                if (e.key === 'Enter') {
                    // Don't prevent default - let the newline be inserted
                    // Wait a bit for the textarea to update, then generate
                    setTimeout(() => generateSchedule(), 50);
                }
            });

            // Auto-generate on page load
            window.addEventListener('load', () => {
                generateSchedule();
            });

            // Task row selection and reordering functions
            let selectedRowId = null;

            function selectRow(rowId) {
                // Remove previous selection
                const allRows = document.querySelectorAll('.task-row');
                allRows.forEach(row => {
                    row.style.backgroundColor = '';
                });

                // Highlight new selection
                const row = document.getElementById('task-row-' + rowId);
                if (row) {
                    row.style.backgroundColor = '#e3f2fd';
                    selectedRowId = rowId;
                    updateMoveButtons();
                }
            }

            function updateMoveButtons() {
                const moveUpBtn = document.getElementById('move-up-btn');
                const moveDownBtn = document.getElementById('move-down-btn');
                const allRows = document.querySelectorAll('.task-row');

                if (selectedRowId === null) {
                    moveUpBtn.disabled = true;
                    moveDownBtn.disabled = true;
                    return;
                }

                // Enable/disable based on position
                moveUpBtn.disabled = (selectedRowId === 1);
                moveDownBtn.disabled = (selectedRowId === allRows.length);
            }

            function moveTaskUp() {
                if (selectedRowId === null || selectedRowId === 1) return;
                moveTask(selectedRowId, selectedRowId - 1);
            }

            function moveTaskDown() {
                const allRows = document.querySelectorAll('.task-row');
                if (selectedRowId === null || selectedRowId === allRows.length) return;
                moveTask(selectedRowId, selectedRowId + 1);
            }

            function moveTask(fromId, toId) {
                const lines = textarea.value.split('\\n');

                // Find the line indices (accounting for 0-based vs 1-based indexing)
                let currentLineIdx = 0;
                let taskLineIndices = [];
                let lineToTaskMap = [];

                // Map each line to a task (considering indentation and summary tasks)
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.trim()) {
                        taskLineIndices.push(i);
                        lineToTaskMap.push(currentLineIdx);
                        currentLineIdx++;
                    }
                }

                // Swap the tasks
                const fromIdx = fromId - 1;
                const toIdx = toId - 1;

                if (fromIdx < taskLineIndices.length && toIdx < taskLineIndices.length) {
                    const fromLineIdx = taskLineIndices[fromIdx];
                    const toLineIdx = taskLineIndices[toIdx];

                    // Swap lines
                    const temp = lines[fromLineIdx];
                    lines[fromLineIdx] = lines[toLineIdx];
                    lines[toLineIdx] = temp;

                    // Update textarea
                    textarea.value = lines.join('\\n');

                    // Regenerate schedule
                    setTimeout(() => {
                        const event = new Event('keydown');
                        event.key = 'Enter';
                        textarea.dispatchEvent(event);

                        // Reselect the moved row
                        setTimeout(() => {
                            selectRow(toId);
                        }, 100);
                    }, 50);
                }
            }
        """),
        Style("""
            * { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
            #app-container { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
            table { border-collapse: collapse; margin: 20px 0; table-layout: auto; width: auto; min-width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 14px; white-space: nowrap; }
            th { background-color: #f2f2f2; font-weight: bold; resize: horizontal; overflow: auto; position: relative; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            /* Allow task name column to wrap if needed */
            th:nth-child(2), td:nth-child(2) { white-space: normal; max-width: 300px; }
            /* Comment column can also wrap */
            th:nth-child(8), td:nth-child(8) { white-space: normal; max-width: 250px; }
            pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; font-size: 12px; }
            code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
            h1 { font-size: 24px; margin-top: 20px; margin-bottom: 10px; }
            h2 { font-size: 20px; margin-top: 20px; margin-bottom: 10px; }
            h3 { font-size: 16px; margin-top: 15px; margin-bottom: 8px; }
        """)
    )


@rt("/schedule", methods=["post"])
async def post(task_input: str):
    """Process the task input and generate schedule and resource allocation."""
    try:
        today = datetime.today()

        # Parse natural language to get tasks
        data = natural_language_to_yaml(task_input, "Project")
        phases_raw = data["Project"]

        if isinstance(phases_raw, list):
            phases = phases_raw
        elif isinstance(phases_raw, dict):
            phases = [phases_raw]
        else:
            phases = []

        tasks = schedule_tasks(phases)

        # Generate interactive HTML table instead of markdown
        schedule_html = generate_interactive_task_table(tasks, today)

        # Generate resource allocation
        if tasks:
            start_date = min([t.get('start', today) for t in tasks if t.get('start')])
            finish_date = max([t.get('finish', today) for t in tasks if t.get('finish')])
        else:
            start_date = today
            finish_date = today

        resource_data = calculate_resource_allocation(tasks, start_date, finish_date)

        # Generate resource allocation HTML table
        resource_html = generate_resource_html(resource_data)

        # Return JSON with both HTML outputs
        return JSONResponse({
            'schedule_html': schedule_html,
            'resource_html': resource_html
        })

    except Exception as e:
        import traceback
        error_html = f"""
            <div style="background: #fee; padding: 20px; border: 1px solid #fcc; border-radius: 5px;">
                <h2 style="color: #d00;">Error processing project:</h2>
                <p style="color: #666; white-space: pre-wrap; font-family: monospace;">{str(e)}</p>
                <pre style="font-size: 12px;">{traceback.format_exc()}</pre>
            </div>
        """
        return JSONResponse({
            'schedule_html': error_html,
            'resource_html': error_html
        })

def generate_resource_html(resource_data):
    """Generate HTML table for resource allocation."""
    resources = resource_data['resources']
    days = resource_data['days']
    allocation = resource_data['allocation']

    if not resources:
        return '<p style="color: #666; font-style: italic;">No resources assigned to tasks.</p>'

    # Build HTML table
    html = '<div style="overflow-x: auto;"><table style="font-size: 11px; min-width: 100%;">'

    # Header row with dates
    html += '<thead><tr><th style="position: sticky; left: 0; background: #f2f2f2; z-index: 10;">Resource</th>'
    for day in days:
        day_name = day.strftime('%a')  # Mon, Tue, etc.
        date_str = day.strftime('%m/%d')
        is_weekend = day.weekday() >= 5
        bg_color = '#e0e0e0' if is_weekend else '#f2f2f2'
        html += f'<th style="background: {bg_color}; min-width: 50px; text-align: center;">{day_name}<br/>{date_str}</th>'
    html += '</tr></thead>'

    # Body rows - one per resource
    html += '<tbody>'
    for resource in resources:
        html += '<tr>'
        html += f'<td style="position: sticky; left: 0; background: white; font-weight: bold; z-index: 5;">{resource}</td>'
        for day in days:
            hours = allocation[resource].get(day, 0)
            is_weekend = day.weekday() >= 5

            if is_weekend:
                bg_color = '#f0f0f0'
                text_color = '#999'
            elif hours > 0:
                # Color code based on hours: green for normal, yellow for high, red for overallocated
                if hours <= 8:
                    bg_color = '#d4edda'
                    text_color = '#155724'
                elif hours <= 10:
                    bg_color = '#fff3cd'
                    text_color = '#856404'
                else:
                    bg_color = '#f8d7da'
                    text_color = '#721c24'
            else:
                bg_color = 'white'
                text_color = '#ccc'

            display_hours = f'{hours:.1f}' if hours > 0 else '-'
            html += f'<td style="background: {bg_color}; color: {text_color}; text-align: center; padding: 4px;">{display_hours}</td>'
        html += '</tr>'
    html += '</tbody></table></div>'

    # Legend
    html += '<div style="margin-top: 15px; font-size: 12px;">'
    html += '<strong>Legend:</strong> '
    html += '<span style="background: #d4edda; padding: 2px 8px; margin: 0 5px; border-radius: 3px;">≤8h (Normal)</span> '
    html += '<span style="background: #fff3cd; padding: 2px 8px; margin: 0 5px; border-radius: 3px;">8-10h (High)</span> '
    html += '<span style="background: #f8d7da; padding: 2px 8px; margin: 0 5px; border-radius: 3px;">>10h (Over)</span> '
    html += '<span style="background: #f0f0f0; padding: 2px 8px; margin: 0 5px; border-radius: 3px;">Weekend</span>'
    html += '</div>'

    return html


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5081)
