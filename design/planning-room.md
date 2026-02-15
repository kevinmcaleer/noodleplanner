# Planning Room Feature

**Status:** ✅ Complete (All 4 Phases)
**Issue:** #239
**Branch:** issue-239-planning-room

## Overview

The Planning Room is a structured, guided planning workflow that helps users create complex project plans through three collaborative stages:

1. **Outline** - Define project structure using YAML (Work Breakdown Structure)
2. **Flow** - Visualize tasks and map dependencies with an interactive diagram
3. **Schedule** - Generate complete plan.md files with proper dependency syntax

## Architecture

### Multi-File State Management

```javascript
planningRoomState = {
    outline: { content: '', lastModified: null },
    flow: { nodes: [], edges: [], lastModified: null },
    plan: { content: '', isGenerated: true, lastModified: null },
    currentStage: 'outline'
}
```

### Storage Strategy

- **Primary:** localStorage (client-side persistence)
- **Backup:** File download/upload (outline.yaml, flow.json, plan.md)
- **No database:** Follows existing architecture pattern (like RAID log)

### Data Flow

```
Outline (YAML) → Parse → Flow Nodes → Auto-layout
                              ↓
Flow + Dependencies → Generate → Plan.md → Editor
```

## Phase 1: Outline Editor

### Features

- YAML editor with auto-save (1-second debounce)
- Real-time tree preview of project hierarchy
- Download/upload outline.yaml files
- Clear outline with confirmation
- Backend YAML validation

### YAML Format

```yaml
project:
  name: 'Project Name'
  start_date: 2026-03-01
  resources:
    - {id: alice, name: 'Alice Smith', role: 'Developer'}
    - {id: bob, name: 'Bob Jones', role: 'Designer'}

phases:
  - name: 'Phase 1: Planning'
    tasks:
      - name: 'Task 1.1'
        duration: 5d
        resources: ['@alice']
        children:
          - name: 'Subtask 1.1.1'
            duration: 2d
            resources: ['@alice']
      - name: 'Task 1.2'
        duration: 3d
        resources: ['@bob']
```

### Backend API

**POST /api/planning-room/parse-outline**
- Validates YAML syntax
- Returns structured JSON (project, phases, tasks)
- Error handling for malformed YAML

### Key Functions

- `parseOutline()` - Call backend to parse YAML
- `renderOutlineTree()` - Hierarchical tree view
- `renderPhaseNode()` / `renderTaskNode()` - Recursive rendering
- `downloadOutline()` / `uploadOutline()` - File I/O

## Phase 2: Flow Diagram Editor

### Features

- Interactive SVG canvas with zoom/pan
- Node rendering with task metadata (name, duration, resources)
- Drag-and-drop node repositioning
- Edge creation by clicking source → target
- Edge deletion with Ctrl+Click
- Auto-layout algorithm (topological sort)
- Three interaction modes: Pan, Select, Link

### Interaction Modes

1. **Pan** (✋) - Drag canvas to navigate large diagrams
2. **Select** (👆) - Click to select, drag to reposition nodes
3. **Link** (🔗) - Click source node, then target node to create dependency

### Flow Data Structure

```json
{
  "nodes": [
    {
      "id": "node-uuid",
      "name": "Task Name",
      "taskPath": "Phase 1 > Task 1.1",
      "duration": "5d",
      "resources": ["@alice"],
      "position": {"x": 100, "y": 200}
    }
  ],
  "edges": [
    {
      "id": "edge-uuid",
      "source": "node-uuid-1",
      "target": "node-uuid-2",
      "type": "FS",  // Finish-Start
      "lag": "2d"
    }
  ]
}
```

### Auto-Layout Algorithm

```javascript
// 1. Build adjacency map from edges
// 2. Calculate in-degree for each node
// 3. Topological sort with layer assignment
// 4. Position nodes:
//    - Layer spacing: 250px horizontal
//    - Node spacing: 120px vertical
// 5. Handles cyclic graphs and disconnected nodes
```

### Key Functions

- `syncOutlineToFlow()` - Parse outline, create/update nodes
- `renderFlowDiagram()` - SVG rendering of nodes and edges
- `renderNode()` / `renderEdge()` - Individual element rendering
- `autoLayoutFlow()` - Layered graph layout
- `onNodeMouseDown()` / `onNodeClick()` - Event handlers
- `setupFlowCanvasListeners()` - Pan, zoom, click handlers

## Phase 3: Plan Generation

### Features

- Complete plan.md generation from outline + flow
- Smart dependency syntax selection
- Recursive task tree walking
- Resource and duration preservation
- Download/copy to Editor functionality

### Dependency Formatting

**Simple Syntax** (single FS dependency, no lag):
```markdown
- Task 5d @alice #Task1
```

**Complex Syntax** (multiple dependencies, type/lag):
```markdown
- Task 5d @alice [depends Task1(SS)+2d, Task2]
```

### Core Module (noodle-core)

**planning_room.py** (~270 lines):

```python
def generate_plan_from_planning_room(outline_yaml, flow_json):
    # 1. Parse YAML outline
    # 2. Build dependency map from flow edges
    # 3. Build node metadata map
    # 4. Walk task tree recursively
    # 5. Format dependencies
    # 6. Return complete plan.md
```

**Key Functions:**

- `build_dependency_map()` - Convert edges to lookup table
- `walk_task_tree()` - Recursive traversal with dependency injection
- `get_task_dependencies()` - Resolve dependencies by task path
- `format_dependencies()` - Smart syntax selection
- `sanitize_task_name()` - Clean names for dependency refs

### Backend API

**POST /api/planning-room/generate-plan**
- Input: outline YAML + flow JSON
- Output: Generated plan.md content
- Uses core module for generation

## Phase 4: Polish & Integration

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd+S` | Save to localStorage |
| `Ctrl/Cmd+L` | Auto-layout flow diagram |
| `Ctrl/Cmd+G` | Generate plan |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |
| `Ctrl/Cmd+Y` | Redo (alternative) |
| `Esc` | Cancel edge creation |

### Undo/Redo System

```javascript
undoHistory = {
    actions: [],  // State snapshots
    currentIndex: -1,
    maxSize: 20   // Circular buffer
}
```

- Deep cloning of state snapshots
- Preserves outline, flow, and plan content
- Restoration triggers re-render of all stages

### Help Modal

- Complete keyboard shortcuts reference
- Workflow overview
- Flow diagram mode explanations
- YAML format examples
- Tips for optimal usage
- Accessible with `❓ Help` button

### Export Functionality

- **Export All:** Downloads outline.yaml, flow.json, plan.md
- Staggered downloads (300ms intervals)
- Individual export buttons also available per stage
- Fallback for browsers without zip support

### Notifications

- Brief toast messages (2-second auto-dismiss)
- Success, error, info message types
- Non-intrusive positioning (top-right)
- Visual feedback for user actions

## Integration with Existing Features

### Planning Room → Editor

- "Copy to Editor" button in Schedule stage
- Automatically switches to Editor tab
- Triggers render of Timeline/Gantt/Kanban
- Generated plan ready for refinement

### Editor → Planning Room

- Future enhancement: Import existing plan
- Reverse-engineer into outline + flow
- Preserve task structure and dependencies

## File Structure

```
packages/
├── noodle-core/
│   └── src/noodle_core/
│       ├── planning_room.py        # Plan generation logic
│       └── __init__.py              # Export planning_room module
└── noodle-web/
    └── src/noodle_web/
        ├── static/
        │   ├── planning-room.js     # 1372 lines - Complete workflow
        │   └── style.css            # Planning Room styles (~450 lines)
        ├── templates/
        │   └── index.html           # Planning tab + help modal
        └── app.py                   # 2 API endpoints
```

## Testing

**Backend Tests:** 20 passing
- YAML parsing and validation
- Plan generation with dependencies
- Error handling (invalid YAML, empty content)
- Large outline performance (100+ tasks)
- Flow data structure validation

**Frontend Testing:**
- Manual testing for keyboard shortcuts
- Drag-and-drop validation
- Undo/redo verification
- Auto-layout visual inspection

## Performance Considerations

- **100+ tasks:** Parse and render < 1 second
- **500+ nodes:** Auto-layout < 2 seconds
- **localStorage:** ~5MB limit (sufficient for large plans)
- **Debounced auto-save:** Prevents excessive writes

## Design Decisions

### Why No External Libraries?

- **Consistency:** Matches existing codebase (no D3, Mermaid, etc.)
- **Bundle Size:** Keeps application lightweight
- **Control:** Full control over rendering and interactions
- **Simplicity:** Easier maintenance and debugging

### Why localStorage vs Database?

- **Follows existing pattern:** RAID log uses same approach
- **User control:** Data stays in browser
- **No backend complexity:** No migrations or sync issues
- **Export/import:** Users can backup and share files

### Why Three Stages?

- **Separation of concerns:** Each stage has single responsibility
- **Progressive complexity:** Start simple (outline), add detail (flow), generate (schedule)
- **Non-linear workflow:** Users can jump between stages as needed
- **Flexibility:** Each stage can be used independently

## User Workflow

### Recommended Flow

1. **Start with Outline:** Define project structure in YAML
   - Add project info (name, start date, resources)
   - Create phases and tasks
   - Set durations and resource assignments
   - Nest subtasks for detailed breakdown

2. **Switch to Flow:** Visualize and add dependencies
   - Review auto-generated nodes
   - Use Auto-layout for organization
   - Switch to Link mode
   - Click source → target to create dependencies
   - Drag nodes to preferred positions

3. **Generate Plan:** Create plan.md
   - Click "Generate Plan" button
   - Review dependency syntax
   - Copy to Editor for rendering
   - Download for backup

### Advanced Usage

- **Iterative refinement:** Switch between stages to adjust structure
- **Collaboration:** Export files to share with team
- **Templates:** Save common project structures (future enhancement)
- **Integration:** Use generated plans in Timeline/Gantt/Kanban views

## Future Enhancements (Post-Launch)

- **Templates:** Pre-built project structures (Agile, Waterfall, etc.)
- **Import from Editor:** Reverse-engineer existing plans
- **Collaborative editing:** Real-time multi-user support
- **Advanced dependency types:** SS, SF, FF with visual indicators
- **Milestone support:** Special node types for project milestones
- **Resource leveling:** Optimize resource allocation
- **Critical path:** Highlight critical path in flow diagram
- **Export to MS Project:** Integration with traditional tools

## Accessibility

- Keyboard navigation for all interactions
- ARIA labels on interactive elements
- High contrast for visual elements
- Screen reader compatible help documentation
- Focus management for modals and forms

## Browser Compatibility

- **Modern browsers:** Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **localStorage:** Required (all modern browsers)
- **SVG support:** Required for flow diagram
- **File download API:** Required for export functionality

## Known Limitations

- **localStorage size:** ~5MB limit per domain
- **No real-time collaboration:** Single-user editing only
- **No server-side storage:** Data stays in browser (by design)
- **Manual export:** No automatic cloud backup
- **Browser-specific:** Data doesn't sync across browsers/devices

## Deployment Notes

- No database migrations required
- No new dependencies (PyYAML already used elsewhere)
- No configuration changes needed
- Static files served via existing mechanism
- Works immediately after deployment

## Conclusion

The Planning Room provides a powerful, guided workflow for creating complex project plans without requiring users to learn Noodle's markdown syntax. The three-stage approach (Outline → Flow → Schedule) breaks down the planning process into manageable steps while maintaining flexibility for non-linear workflows.

All four phases are complete, tested, and ready for production use.
