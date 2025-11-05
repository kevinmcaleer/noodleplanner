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
from datetime import datetime
import json

app, rt = fast_app()

DEFAULT_YAML = """House move:
  - pre-move:
      - find_home: "find a new home @Kevin @Jenni #pack #mortgage !\\"Visit 3 houses\\" p10 2025-08-26 :p14d"
      - pack: "pack belongings @Kevin #find !\\"Pack carefully\\" p100 2025-09-09 :p1d"
      - hire_movers: "hire movers @Jenni #pack !\\"Book van\\" p50 2025-09-10 :p7d"
      - offer: "make an offer @Kevin #find !\\"Offer submitted\\" p100 2025-09-17 :p1d"
      - get_mortgage: "get a mortgage @Jenni #offer !\\"Mortgage approved\\" p0 2025-09-18 :p1d"
      - exchange: "exchange contracts @Kevin #mortgage !\\"Contracts exchanged\\" p0 2025-09-19 :p1d"
  - move:
      - load: "*load belongings onto the moving truck @Kevin #exchange 'Loading day' p0 2025-09-20 :p1d #exchange"
      - drive: "*drive to the new home @Kevin #load !\\"Drive safely\\" p0 2025-09-21 :p1d"
      - unload: "*unload belongings from the moving truck @Jenni #drive !\\"Unloading day\\" p0 2025-09-22 :p1d"
      - unpack: "*unpack belongings @Kevin @Jenni #unload !\\"Unpack essentials\\" p0 2025-09-23 :p1d"
  - post-move:
      - clean: "*clean the old home @Kevin #unpack !\\"Clean up\\" p0 2025-09-24 :p5d #unpack"
      - settle: "*settle into the new home @Kevin @Jenni #clean !\\"Settle in\\" p0 2025-09-25 :p10d"
"""

DEFAULT_NATURAL = """Phase 1: Design
  design @kev @jen 2025-12-01 10d
  mockups @jen 2025-12-01 5d
Phase 2: Build
  *implement @kev #design !"Build the feature" 5d
  *test @jen #implement !"Run all tests" 50% 3d
Phase 3: Deploy
  *deploy @kev @jen #test !"Deploy to production" 1d
  review @jen #deploy !"Final review" 0% 2w"""


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
                    style="flex: 1; padding: 20px; overflow-y: auto; background: #252525;"
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
                        style="flex: 1; margin-bottom: 10px;"
                    ),
                    # Bottom: Resource Allocation
                    Div(
                        H2("Resource Allocation", style="margin-bottom: 10px; font-size: 18px;"),
                        Div(
                            P("Resource allocation will appear here.", style="color: #666; font-style: italic;"),
                            id="resource_area",
                            style="background: white; padding: 15px; border: 1px solid #ddd; border-radius: 5px; overflow-x: auto; overflow-y: auto; max-height: 40vh;"
                        ),
                        style="flex: 1;"
                    ),
                    style="flex: 1; padding: 20px; border-left: 2px solid #ddd; display: flex; flex-direction: column; overflow-y: auto;"
                ),
                style="display: flex; height: 100vh;"
            ),
            style="margin: 0; padding: 0;"
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
        """),
        Style("""
            body { margin: 0; padding: 0; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
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

        # Generate schedule markdown
        markdown_output = text_to_markdown_table(task_input, is_yaml=False, project_name="Project")

        # Convert markdown to HTML
        schedule_html = markdown.markdown(
            markdown_output,
            extensions=['tables', 'fenced_code']
        )

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
