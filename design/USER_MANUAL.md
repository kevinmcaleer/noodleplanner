# Noodle Planner - User Manual

## Table of Contents
1. [Getting Started](#getting-started)
2. [Web Application Overview](#web-application-overview)
3. [Plan Editor](#plan-editor)
4. [Plan Syntax Guide](#plan-syntax-guide)
5. [Views](#views)
6. [Project Details](#project-details)
7. [Export Options](#export-options)
8. [Keyboard Shortcuts](#keyboard-shortcuts)
9. [Troubleshooting](#troubleshooting)

## Getting Started

### Welcome to Noodle Planner

Noodle Planner is a project planning and scheduling tool that helps you:
- Create and manage project plans using simple markdown syntax
- Visualize your project in multiple formats (Gantt, Kanban, Timeline, Milestones)
- Track resource allocation and project status
- Export plans to Excel, PDF, or PowerPoint

### Quick Start
1. Go to the **Editor** tab
2. Type or paste your project plan (or drag a .md/.txt file)
3. Press **Enter** to render the plan
4. View the plan in different tabs (Gantt, Timeline, Kanban, etc.)
5. Use the **Export** button to download in your preferred format

## Web Application Overview

The Noodle Planner web interface has three main sections:

### Main Tabs
- **Editor** - Write and edit your plan in markdown format
- **Kanban** - View tasks organized in columns (by phase, resource, progress, or label)
- **Syntax Guide** - Reference for the plan syntax

### Editor Layout (in Editor tab)
The editor uses a split-pane design:
- **Left side** - Markdown editor where you write your plan
- **Right side** - Multiple output views showing your plan rendered in different formats

### Output Tabs (right pane)
After rendering a plan, you can view it in multiple formats:
- **Report** - Full project report with all details
- **Project Summary** - High-level overview with RAG status and next tasks
- **Milestones** - List of all milestones with dates
- **Timeline** - Visual timeline with milestone markers
- **Gantt** - Interactive Gantt chart for task scheduling
- **Resources** - Resource allocation view
- **Timesheet** - Resource utilization by date
- **Analysis** - Project health checks and insights

## Plan Editor

### Editor Features

#### Toolbar
- **📋 Project Details** - Open the project details form to set project metadata
- **⇤ Outdent** - Move selected lines one level left (Cmd+[)
- **⇥ Indent** - Move selected lines one level right (Cmd+])
- **📁 Upload** - Switch to upload tab to load a file
- **💾 Download** - Download the current plan as markdown
- **⌨️ Shortcuts** - View keyboard shortcuts

#### Editor Pane
- **Syntax highlighting** - Color-coded highlighting for plan elements
- **Line numbers** - On the left for easy reference
- **Auto-rendering** - Renders on Enter key press
- **Drag and Drop** - Drag .md or .txt files directly onto the editor to load them

#### Quick Tip
Double-click on any task line to edit it in a detailed form

### Project Details Form

The Project Details form lets you set metadata about your project:

**Basic Info**
- **Project Title** - The name of your project
- **Project Owner** - Who's responsible for the project
- **Sponsor** - Executive sponsor or stakeholder
- **Budget** - Total project budget (free-text field)
- **Status** - Open / Closed / On Hold

**Dates**
- **Project Start Date** - When the project begins

**Description & Labels**
- **Description** - Brief description of what the project is about
- **Labels** - Comma-separated tags for categorization (e.g., "DEV", "HIGH", "Q1")

**People**
- **Resources** - Team members who work on the project
- **Stakeholders** - Key stakeholders to involve

### File Upload

You can upload markdown or text files containing your plan:
1. Click the **📁** button or switch to the **Upload** tab
2. Drag and drop a .md or .txt file, or click to browse
3. Click **Render Plan** to process the file
4. The plan content loads into the editor

## Plan Syntax Guide

### Format Overview

A Noodle Planner file contains two main sections:
1. **Front Matter** (optional) - YAML metadata
2. **Plan Body** - Hierarchy of phases and tasks

### Front Matter

At the top of your file (between `---` markers), define project-level information:

```yaml
---
title: My Project
project manager: Kevin
Resources:
- @alice: Alice Smith, Developer
- @bob: Bob Jones, Designer
Holidays:
- 2025-12-25
- 2025-12-26
---
```

**Front Matter Fields**
- `title` - Project name
- `project manager` - Project manager name
- `Resources:` - List of team members with their shortnames and roles
- `Holidays:` - Dates when the team is not working

### Phases and Tasks

After the front matter, organize your plan into phases and tasks:

```
Phase 1
  Task 1 @alice 3days 50% "Initial setup"
  Task 2 @bob 2days [depends Task 1]
  
Phase 2
  Task 3 @alice 5days 100%
```

**Task Format**: `TaskName @resource Duration Percent% "Comment" [depends Task]`

**Hierarchy**
- **No indentation** = Phase (top-level section)
- **2 spaces indentation** = Task
- **4 spaces indentation** = Subtask
- **6+ spaces** = Deeper subtasks

### Task Properties

#### Name
- Simple text description
- Can include spaces and special characters
- Use short, descriptive names

#### Resources (Assignment)
- Format: `@shortname`
- Multiple resources: `@alice @bob`
- Shortname must match a resource in the front matter
- Tasks without assignment: leave blank

#### Duration
- Formats: `3d`, `3days`, `1w`, `1week`, `2m`, `2months`
- Milestones (no duration): `0d`
- Required field

#### Percentage/Progress
- Format: `50%`, `100%`, etc.
- Shows task completion percentage
- Optional (defaults to 0%)

#### Comment/Notes
- Format: `"Your comment here"`
- Enclosed in double quotes
- Optional
- Can span multiple lines

#### Dependencies
- Format: `[depends TaskName]`
- Task will start after the named task completes
- Optional
- Use exact task names

### Advanced Features

#### Sequential Subtasks
Use `*` to mark subtasks that happen in sequence:

```
Testing Phase
  Master Test Task
    * Unit testing @alice 2days
    * Integration testing @bob 1day
    * UAT @charlie 2days
```

#### Milestones
Zero-duration tasks become milestones (shown as diamonds ◆):

```
Project Milestones
  Project Kick-off 0d "Start"
  Design Complete 0d "End of design phase"
  Go Live 0d "Product in production"
```

#### Dates
You can specify exact dates instead of durations:

```
Design Phase
  Detailed Design 2025-01-15 to 2025-01-20
  Design Review @bob 2025-01-21
```

### Example Plan

```yaml
---
title: Website Redesign
project manager: Sarah Chen
Resources:
- @alice: Alice Wong, UX Designer
- @bob: Bob Smith, Developer
- @charlie: Charlie Lee, QA Engineer
Holidays:
- 2025-12-25
---

Discovery & Design
  Stakeholder interviews @alice 3days 100%
  Wireframing @alice 5days 50% "In progress" [depends Stakeholder interviews]
  Design review @alice @bob 1day 0% [depends Wireframing]

Development
  Frontend development @bob 10days 20% [depends Design review]
  Backend development @bob 8days 0% [depends Design review]
  API Integration @bob 3days 0% [depends Frontend development, Backend development]

Testing
  QA Test Plan @charlie 1day
    * Functional testing @charlie 3days [depends API Integration]
    * Performance testing @charlie 2days [depends API Integration]
    * UAT @alice 2days [depends Functional testing]

Deployment
  Deployment Prep @bob 1day [depends UAT]
  Go Live @bob 0.5days [depends Deployment Prep]
  Post-Launch Support @alice @bob 5days [depends Go Live]
```

## Views

### Report View (Default)
Shows a comprehensive view of your project including:
- Project name and metadata
- RAG status (Red/Amber/Green indicators)
- Task summary table with all details
- Comments and dependencies
- Resource assignments

### Project Summary View
High-level overview perfect for dashboards:
- **Project Details** - Title, manager, sponsor, budget, status
- **RAG Status Cards** - Visual indicators of Red/Amber/Green tasks
- **Next Tasks** - Upcoming tasks that need attention

### Milestones View
Table of all milestone tasks showing:
- ID and name
- Start and finish dates
- Progress percentage
- RAG status
- Comments

### Timeline View
Visual representation of your project:
- Horizontal timeline showing project duration
- Diamond markers for milestones
- Option to show phases
- Hover to see task details

### Gantt Chart View
Detailed project schedule with:
- **Task list** (left) - All tasks with durations and dates
- **Timeline** (right) - Visual bars showing task scheduling
- **Drag handles** - Resize or move tasks by dragging the bars
- **Scale options** - View by days, weeks, months, quarters, or years
- **Today marker** - Red line showing current date
- **RAG colors** - Color-coded task health

**Gantt Controls**
- **Scale selector** - Choose zoom level (Days to Years)
- **Today button** - Jump to today's date
- **Drag bars** - Click and drag task bars to adjust schedule
- **Left handle** - Adjust task start date
- **Right handle** - Adjust task end date
- **Middle** - Move entire task

### Kanban View
Organize tasks in columns based on:
- **Phase** - Group by project phase
- **Resource** - Group by assigned resource
- **Progress** - Group by completion status (Not Started / In Progress / Complete)
- **Label** - Group by custom labels

**Kanban Features**
- **Drag tasks** between columns to update their properties
- **Column headers** show task count
- **Drilldown** - Click arrow on summary tasks to see subtasks
- **Breadcrumb** - Navigate task hierarchy

### Resources View
Track resource allocation:
- **Resource Name** - Person or role
- **Tasks Assigned** - Number of tasks
- **Total Days** - Sum of all durations
- **Total Hours** - Total duration in hours

### Timesheet View
Day-by-day resource utilization:
- **Rows** - Each resource
- **Columns** - Each day in the project
- **Cell values** - Hours allocated to project work that day

### Analysis View
Project health checks and insights:
- **Task Distribution** - How many tasks in each phase
- **Resource Utilization** - Is anyone overbooked?
- **Schedule Warnings** - Critical dependencies or long chains
- **Quality Indicators** - Progress vs. schedule
- **Risk Indicators** - Red/Amber tasks and their impact

## Project Details

### Editing Project Details
Click the **📋** button in the toolbar to open the Project Details form.

This is where you define:
- **Metadata** - Project name, owner, sponsor, dates
- **Status** - Open, Closed, or On Hold
- **People** - Resources and stakeholders
- **Labels** - Tags for organization

### Managing Resources

A resource represents a person or role on your team.

**Resource Properties**
- **Shortname** - Used in tasks with @ prefix (e.g., @alice)
- **Full Name** - Display name (e.g., Alice Smith)
- **Role** - Job title or function (e.g., Developer, QA)
- **Email** - Contact email
- **Allocation %** - Percent of time dedicated to this project

### RAG Status Explained

RAG stands for Red / Amber / Green, showing task health:

- 🟢 **Green** - On track
  - Task is complete (100%)
  - OR task hasn't started and isn't overdue yet
  
- 🟡 **Amber** - At Risk
  - Task is behind schedule
  - Progress is less than expected
  
- 🔴 **Red** - Critical Issue
  - Task is overdue with no progress
  - Dependency chain is broken
  - Blocker identified

## Export Options

### Excel Export
Creates a formatted Excel workbook with:
- **Task Details Sheet** - All tasks with columns for every property
- **Resource Sheet** - Team members and their allocation
- **Summary Sheet** - Project overview and RAG status
- **Timeline Sheet** - Gantt data for further analysis
- Color-coded RAG status in cells

### CSV Export
Exports task data as CSV suitable for:
- Import into Excel, Google Sheets, or databases
- Integration with other tools
- Data analysis

### PDF Export
Professional PDF document including:
- Project summary page
- Task table
- Resource allocation
- Notes and comments
- Printable format

### PowerPoint Export
Visual presentation with:
- Title slide
- Project overview
- Timeline slide with milestones
- Gantt chart
- Resource allocation chart
- Notes and comments

## Keyboard Shortcuts

### Editor Shortcuts
| Shortcut | Action |
|----------|--------|
| Cmd+[ | Outdent selected lines |
| Cmd+] | Indent selected lines |
| Enter | Render/update the plan |
| Double-click | Edit task inline |
| ? | Open keyboard shortcuts |

### General Shortcuts
| Shortcut | Action |
|----------|--------|
| Esc | Close dialogs or modals |

### Kanban Shortcuts
| Shortcut | Action |
|----------|--------|
| Drag task | Move between columns |
| Click arrow | Drilldown into subtasks |

### Gantt Shortcuts
| Shortcut | Action |
|----------|--------|
| Drag bar left/right | Adjust task duration |
| Drag bar middle | Move task to new date |
| Double-click | Open task details |

## Troubleshooting

### Common Issues

#### Plan won't render
- **Issue**: Pressed Enter but nothing happens
- **Solution**: 
  - Make sure you have content in the editor
  - Check for syntax errors in your plan
  - Look at the error message in the red banner

#### Kanban view shows "No tasks to display"
- **Issue**: All columns are empty
- **Solution**:
  - Make sure you've rendered your plan (press Enter)
  - Check if you have tasks defined in your editor
  - Try switching view mode (Phase → Resource, etc.)

#### Tasks show unexpected dates
- **Issue**: Task start/end dates don't match what I typed
- **Solution**:
  - Check that dependencies are correctly specified
  - Verify resource availability
  - Look at which tasks are blocking the task
  - Remember: tasks schedule forward from their dependencies

#### Drag and drop not working
- **Issue**: Can't drag tasks on Kanban or Gantt
- **Solution**:
  - Make sure you're dragging from the task bar, not the text
  - Try dragging to a different column first
  - Refresh the page and try again

#### Export creates empty file
- **Issue**: Downloaded file is empty or has formatting issues
- **Solution**:
  - Make sure your plan renders correctly first
  - Check that you have tasks defined
  - Try a different export format
  - Check browser's download folder

#### File upload fails
- **Issue**: "Error reading file" message when uploading
- **Solution**:
  - File must be .md or .txt format
  - File should contain valid Noodle Planner syntax
  - Check file permissions
  - Try uploading a smaller file first

### Performance Tips

- **Large plans** (100+ tasks): Use Year view in Gantt for faster rendering
- **Many resources**: Filter by resource in Kanban view
- **Long projects**: Use Month or Quarter scale in Gantt
- **Better responsiveness**: Close unused tabs/views

### Getting Help

If you're stuck:
1. Check the **Syntax Guide** tab
2. Review this user manual
3. Try the built-in **⌨️ Keyboard Shortcuts** reference
4. Double-check your syntax by looking at the example plan

---

**Version**: 1.0  
**Last Updated**: March 2026  
**For more info**: Visit [noodleplanner.com](https://www.noodleplanner.com)
