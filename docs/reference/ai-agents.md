# AI Agents Reference

NoodlePlanner ships with nine built-in AI agents. Each agent is defined by a
YAML metadata file (`agent.yml`) and a Markdown system prompt
(`system-prompt.md`) stored in the `agents/` directory.

## Agent Summary

| ID | Name | Category | Icon | Description |
|----|------|----------|------|-------------|
| `planning-agent` | Planning Agent | planning | `bi-clipboard-check` | Reviews plan quality, suggests improvements, identifies gaps in scope, schedule and dependencies. |
| `risk-manager` | Risk Manager | tracking | `bi-shield-exclamation` | Reviews RAID items, checks mitigations are adequate, identifies unrecognised risks. |
| `reporting-analyst` | Reporting Analyst | reporting | `bi-bar-chart-line` | Creates status reports, summaries, and analysis from project activity and completion data. |
| `benefits-manager` | Benefits Realisation Manager | tracking | `bi-graph-up-arrow` | Tracks value delivery, reviews benefits against business case, identifies realisation gaps. |
| `stakeholder-engagement` | Stakeholder Engagement | planning | `bi-people` | Reviews stakeholder communication plans, suggests engagement improvements. |
| `accountant` | Accountant | tracking | `bi-currency-pound` | Checks budget health, forecasts spend, identifies cost risks and variances. |
| `resource-manager` | Resource Manager | resources | `bi-person-badge` | Identifies skill gaps, checks resource allocation, flags over-utilisation and load balancing issues. |
| `pm-assistant` | PM Assistant | planning | `bi-person-workspace` | Reviews project metrics, suggests focus areas, provides general project management advice. |
| `meeting-actions` | Meeting Actions | reporting | `bi-chat-square-text` | Extracts action items, decisions, and key points from meeting transcripts or notes. |

## Context Injection

Every agent's system prompt contains the placeholder `{{plan_markdown}}`. When
the user sends a message, the frontend replaces this placeholder with the
current plan text from the editor before sending it to the AI provider.

Plans exceeding 100 KB are truncated with a `[Plan truncated due to size]`
notice appended.

## Agent Categories

Agents are grouped into four categories for organisation:

- **planning** -- Agents focused on plan structure and quality.
- **tracking** -- Agents focused on monitoring risks, benefits, and budgets.
- **reporting** -- Agents focused on generating reports and extracting actions.
- **resources** -- Agents focused on people and resource allocation.

## Agent File Structure

Each agent lives in its own subdirectory under `packages/noodle-web/src/noodle_web/agents/`:

```
agents/
  planning-agent/
    agent.yml          # name, description, icon, category, order
    system-prompt.md   # full system prompt with {{plan_markdown}}
  risk-manager/
    agent.yml
    system-prompt.md
  ...
```

### agent.yml Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name shown in the chat panel. |
| `description` | string | Short description shown as a tooltip. |
| `icon` | string | Bootstrap Icons class (e.g. `bi-clipboard-check`). |
| `category` | string | One of: `planning`, `tracking`, `reporting`, `resources`. |
| `order` | integer | Sort order in the agent selector (lower = first). |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ai/agents` | Returns a list of all agent metadata (no system prompts). |
| `GET` | `/api/ai/agents/{id}` | Returns full metadata including the system prompt. |

## Example Use Cases

### Planning Agent
Review a newly created plan for completeness. Ask it to check whether all
deliverables have acceptance criteria and all dependencies are defined.

### Risk Manager
Paste your RAID log and ask for a gap analysis. The agent will identify risks
without mitigations or issues without owners.

### Reporting Analyst
Ask for a weekly status report formatted for a steering committee, including
RAG status, milestones achieved, and upcoming decisions.

### Benefits Realisation Manager
Map each project deliverable to its business benefit and ask the agent to
identify any benefits that are not being tracked.

### Stakeholder Engagement
Draft a communication plan for a specific project phase, identifying who needs
to be informed, consulted, or kept updated.

### Accountant
Upload budget data in the plan and ask for a cost variance analysis or an
estimate-to-complete forecast.

### Resource Manager
Ask for a workload heatmap for the next four weeks, highlighting anyone
allocated above 100%.

### PM Assistant
Ask "What should I focus on this week?" and the agent will analyse progress,
upcoming milestones, and overdue items to provide a prioritised list.

### Meeting Actions
Paste raw meeting notes and ask the agent to extract action items with owners,
due dates, and any decisions made.
