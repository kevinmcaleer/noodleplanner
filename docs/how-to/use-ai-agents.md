# How to Use AI Agents

NoodlePlanner includes nine specialised AI agents that can analyse your project
plan and provide targeted advice. Each agent has a different focus area and
receives your current plan as context.

## Opening the AI Chat Panel

Use any of these methods:

- **Keyboard shortcut**: Press `Ctrl+Shift+A` (or `Cmd+Shift+A` on macOS).
- **Robot icon**: Click the robot icon in the top navigation bar.

The chat panel slides in from the right side of the screen.

If you have not yet configured an AI provider, the panel will prompt you to
set one up. See [Configure an AI Provider](configure-ai-provider.md).

## Selecting an Agent

At the top of the chat panel you will see a row of agent chips. Click one to
switch to that agent. Switching agents clears the current conversation and
starts a fresh session.

The available agents are:

| Agent | Best For |
|-------|----------|
| Planning Agent | Overall plan quality review |
| Risk Manager | RAID log and risk analysis |
| Reporting Analyst | Status reports and summaries |
| Benefits Realisation Manager | Business value tracking |
| Stakeholder Engagement | Communications planning |
| Accountant | Budget and cost analysis |
| Resource Manager | Workload and skill gaps |
| PM Assistant | General PM advice |
| Meeting Actions | Extracting actions from notes |

## How Agents Use Your Plan Context

When you send a message, the selected agent's system prompt is loaded from
the server and your current plan text (from the editor) is automatically
injected into the prompt via the `{{plan_markdown}}` placeholder.

This means the agent can see:

- All tasks, durations, and dependencies
- Resource assignments
- Progress percentages
- Comments and RAID items
- Any other content in your plan editor

Plans larger than 100 KB are automatically truncated with a notice.

## Sending Messages

1. Type your message in the input area at the bottom of the panel.
2. Press **Enter** to send (use **Shift+Enter** for a new line).
3. The agent's response streams in token-by-token.

You can have a multi-turn conversation. Previous messages are included as
context so the agent can refer back to earlier points.

## Tips for Effective Prompts

### Planning Agent
- "Review the critical path and suggest ways to shorten the schedule."
- "Are there any tasks missing dependencies?"

### Risk Manager
- "List the top 5 risks in this plan and suggest mitigations."
- "Are any RAID items missing an owner or review date?"

### Reporting Analyst
- "Write a one-page status report for the steering committee."
- "Summarise progress against milestones."

### Benefits Realisation Manager
- "Map each deliverable to its expected business benefit."
- "Which benefits are at risk of not being realised?"

### Stakeholder Engagement
- "Draft a stakeholder communication plan for the next sprint."
- "Who are the key stakeholders and what are their concerns?"

### Accountant
- "Forecast the remaining spend based on current progress."
- "Highlight any cost variances."

### Resource Manager
- "Which resources are over-allocated next month?"
- "Are there any skill gaps in the team?"

### PM Assistant
- "What should I focus on this week?"
- "Review the overall health of this project."

### Meeting Actions
- Paste meeting notes or a transcript and ask:
  "Extract all action items with owners and due dates."

## Closing the Panel

- Press `Ctrl+Shift+A` again.
- Click the close button (X) at the top of the panel.
- Click outside the panel on the overlay.
