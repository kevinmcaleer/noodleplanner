# Noodle Planner - Quick Reference

## Plan Syntax Cheat Sheet

### File Structure
```yaml
---
title: My Project
project manager: Your Name
Resources:
- @alice: Alice Smith, Developer
- @bob: Bob Jones, Designer
---

Phase Name
  Task Name @alice 3days 50% "Comment" [depends Other Task]
```

## Duration Formats
- `3d` or `3days` - 3 calendar days
- `1w` or `1week` - 1 week
- `2m` or `2months` - 2 months
- `0d` - Milestone (no duration)

## Task Examples

### Simple Task
```
Development Phase
  Build backend @alice 5days
```

### Task with All Details
```
Development Phase
  Build API @alice 5days 75% "Using REST" [depends Design Phase]
```

### Subtasks
```
Testing Phase
  Main Test Task
    * Unit tests @bob 2days
    * Integration tests @bob 1day
    * UAT @charlie 2days
```

### Milestone
```
Project Milestones
  Go Live 0d "Product released"
```

## Common Patterns

### Sequential Dependencies
```
Phase 1
  Design @alice 3days
  Review @bob 1day [depends Design]
  Development @alice 5days [depends Review]
```

### Parallel Work
```
Phase 2
  Frontend @bob 5days [depends Review]
  Backend @alice 5days [depends Review]
  Integration @bob 2days [depends Frontend, Backend]
```

### Team Collaboration
```
Implementation
  Work Item 1 @alice @bob 3days "Both working together"
  Handoff @bob @charlie 1day [depends Work Item 1]
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Cmd+[ | Outdent |
| Cmd+] | Indent |
| Enter | Render |
| Esc | Close dialog |
| ? | Help |

## View Quick Switch

| Tab | Best For |
|-----|----------|
| Report | Detailed project info |
| Summary | Dashboard/overview |
| Milestones | Key dates |
| Gantt | Schedule visualization |
| Kanban | Team board view |
| Timeline | Project duration |
| Resources | Team allocation |
| Timesheet | Resource utilization |

## Troubleshooting Checklist

- [ ] Syntax looks correct
- [ ] Resources defined in front matter
- [ ] Indentation is exactly right (2 spaces per level)
- [ ] Plan renders after pressing Enter
- [ ] Export format is supported

## Export Formats

- **Excel** - Best for detailed analysis and sharing
- **CSV** - For importing to other tools
- **PDF** - For printing and archiving
- **PowerPoint** - For presentations

---

**Tip**: Press `?` in the web app to see all keyboard shortcuts
