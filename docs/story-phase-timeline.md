# User Story: Timeline Visualization for Project Phases

## Story
As a project manager, I want to see a visual timeline of all project phases and milestones, so that I can quickly understand the flow, duration, and key dates of my project.

## Acceptance Criteria
- Timeline is generated from YAML input and shows all phases with start/end dates.
- Milestones (duration=0 or phase end) are shown with labels and dates.
- Only one 'Start' and 'Finish' label/date appear above the timeline; all other milestones are below.
- Timeline is rendered in Markdown and is visually aligned and scaled.
- Works for any valid project YAML.

## Notes
- Complements the Markdown table of tasks.
- Output is human-readable and compact.
- See epic-phase-timeline.md for requirements.
