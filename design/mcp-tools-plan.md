# AI Tool Calling for Plan Manipulation — Implementation Plan

## Architecture

Instead of asking the LLM to output modified plan text, we define **tool/function calling** definitions.
The AI decides *what* to change; deterministic Python code handles *how*.

### Flow
1. User sends message in chat
2. Frontend sends: `{ messages, plan_text }` to `/api/ai/chat`
3. Proxy forwards to AI model with tool definitions
4. Model responds with `tool_calls` (e.g., `add_stakeholder(name="Julian", interest="High")`)
5. Proxy executes the tool on `plan_text` using Python functions
6. Proxy sends tool results back to model for a final natural language response
7. Proxy returns: `{ response, updated_plan_text }` (if plan was modified)
8. Frontend applies `updated_plan_text` to editor (with confirmation)

## Tool List (~35 tools)

### Plan Structure
- `create_plan(title, project_manager, start_date, budget)` — new plan from scratch
- `update_front_matter(field, value)` — update any front matter field

### Tasks
- `add_task(name, parent, duration, resource, depends_on, sequential, comment)`
- `update_task(name, new_name, duration, resource, completion, comment)`
- `remove_task(name)`
- `move_task(name, new_parent)`
- `set_dependency(task_name, depends_on, dep_type, lag)`

### Resources
- `add_resource(name, full_name, role, email)`
- `update_resource(name, full_name, role, email)`
- `remove_resource(name)`
- `assign_resource(task_name, resource_name)`

### Stakeholders
- `add_stakeholder(name, interest, influence)`
- `update_stakeholder(name, interest, influence)`
- `remove_stakeholder(name)`

### RAID
- `add_raid_item(type, title, description, owner, impact, likelihood, status, mitigation)`
- `update_raid_item(id, title, status, owner, impact, likelihood, mitigation)`
- `remove_raid_item(id)`

### Budget
- `add_budget_item(description, estimate, forecast, type, supplier, category)`
- `update_budget_item(id, description, estimate, forecast, type, supplier)`
- `remove_budget_item(id)`

### Benefits
- `add_benefit(type, title, description, target_value, contribution_percent)`
- `update_benefit(id, title, description, target_value, contribution_percent)`
- `remove_benefit(id)`
- `link_benefit(from_id, to_id)`

### Comms
- `add_comms_activity(audience, message, channel, frequency, owner)`
- `update_comms_activity(id, audience, message, channel, frequency, owner)`
- `remove_comms_activity(id)`

### Deliverables
- `add_deliverable(name, type)`
- `update_deliverable(name, new_name, type)`
- `remove_deliverable(name)`

### Baseline
- `create_baseline()`

### Non-working days
- `add_non_working_day(name, start_date, end_date)`
- `remove_non_working_day(name)`

## Files

### New
- `packages/noodle-web/src/noodle_web/ai_tools.py` — tool definitions + executors

### Modified
- `packages/noodle-web/src/noodle_web/ai_service.py` — tool calling loop in proxy
- `packages/noodle-web/src/noodle_web/app.py` — pass plan_text in chat request
- `packages/noodle-web/src/noodle_web/static/ai-chat.js` — send plan_text, handle updated plan
- `packages/noodle-web/src/noodle_web/static/ai-chat.css` — tool call display styling
