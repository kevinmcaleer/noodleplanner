# Epic: Timeline Visualization for Project Phases

## Goal
Enable the scheduling engine to generate a simple timeline visualization of the major phases in a project, based on the YAML input. The timeline should show the start and end dates for each phase, making it easy to see the overall flow and duration of the project at a glance.

## Motivation
- Project managers and stakeholders need a quick overview of phase durations and sequencing.
- Visual timelines help with planning, communication, and identifying bottlenecks.
- Complements the existing Markdown table of tasks.

## Requirements
- Parse YAML to identify major phases and their start/end dates.
- Output a timeline in Markdown (e.g., table or text-based Gantt chart).
- Timeline should be human-readable and compact.
- Support for custom phase names and multiple phases per project.
- Integrate with the existing scheduling engine.

## Acceptance Criteria
- Timeline output shows each phase, its start date, and end date.
- Timeline is generated automatically from the YAML input.
- Works for any valid project YAML with phases.
- Documented in the scheduling engine README or docstring.

## Out of Scope
- Graphical (image-based) timelines.
- Task-level timelines (focus is on phases).

## Example Output
```
# Project Timeline
| Phase      | Start       | End         |
|------------|------------|-------------|
| pre-move   | 2025-08-26 | 2025-09-20  |
| move       | 2025-09-20 | 2025-09-24  |
```

## Next Steps
- Update scheduling engine to compute phase start/end dates.
- Add timeline output to engine.
- Test with sample YAML.
