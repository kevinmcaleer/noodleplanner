# Feature: Timeline Visualization Engine

## Description
Implements a Python scheduling engine that parses a minimal YAML schema and outputs a Markdown table and a visually aligned, proportionally scaled horizontal timeline. The timeline shows project phases, milestones, and key dates, with only one 'Start' and 'Finish' label/date above the timeline and all other milestone labels/dates below.

## Acceptance Criteria
- Parses YAML project data and outputs Markdown table and timeline.
- Timeline width is configurable (default: 80 chars).
- Milestones (duration=0 or phase end) are detected and rendered.
- Start/Finish milestone dates appear only above the timeline; all other milestone dates below.
- Timeline is ASCII/Markdown, visually aligned, and compact.
- No duplicate labels or stray characters in output.
- Fully documented in README and epics.

## Notes
- Complements the Markdown table of tasks.
- See story-phase-timeline.md and epic-phase-timeline.md for requirements.

# Feature: Gantt Chart Visualization

## Description
Implements a Gantt chart output in the Python scheduling engine. The chart displays each task as a horizontal bar, includes a Task ID column, and a heading row with week start dates. A horizontal line separates the heading from the chart rows for clarity.

## Acceptance Criteria
- Gantt chart output is included after the timeline in the Markdown output.
- Each row shows Task ID, name, and a proportional horizontal bar for the scheduled duration.
- Week start dates are shown in the heading row.
- A horizontal line separates the heading from the chart rows.
- Fully documented in README and epics.

## Notes
- Complements the timeline visualization feature.
- See story-phase-timeline.md and epic-phase-timeline.md for requirements.
