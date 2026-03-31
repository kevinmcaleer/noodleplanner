# Agentic AI Capabilities - Implementation Plan (Issue #679)

## Architecture Decisions

- **BYOK (Bring Your Own Key)** — users configure their own API provider via browser UI, key stored in `localStorage`
- **OpenAI-compatible API interface** — supports OpenAI, Anthropic, Ollama (free/local), Custom endpoints
- **FastAPI proxy** — backend proxies AI requests; receives key per-request, never stores it
- **Server-side agent templates** — static `.md` prompt files, served via API
- **Separate JS/CSS modules** — `ai-config.js`, `ai-chat.js`, `ai-chat.css`
- **SSE streaming** — real-time token display via Server-Sent Events
- **No database changes** — config in localStorage, chat in-memory, prompts as files

## localStorage Schema

```json
{
  "provider": "openai | anthropic | ollama | custom",
  "endpoint": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4o",
  "enabled": true
}
```

Provider presets:
- OpenAI: `https://api.openai.com/v1`, model `gpt-4o`
- Anthropic: `https://api.anthropic.com/v1`, model `claude-sonnet-4-20250514`
- Ollama: `http://localhost:11434/v1`, model `llama3`
- Custom: all fields blank

## API Endpoints

```
POST /api/ai/chat     — proxy chat completion (SSE streaming)
POST /api/ai/test     — test connection
GET  /api/ai/agents   — list available agents
GET  /api/ai/agents/{id} — get agent system prompt
```

## Agent Templates

| ID | Name | Description |
|----|------|-------------|
| planning-agent | Planning Agent | Reviews plan quality, suggests improvements, identifies gaps |
| risk-manager | Risk Manager | Reviews RAID items, checks mitigations |
| reporting-analyst | Reporting Analyst | Creates reports from activity/completions |
| benefits-manager | Benefits Realisation Manager | Tracks value delivery |
| stakeholder-engagement | Stakeholder Engagement | Reviews stakeholder comms plans |
| accountant | Accountant | Checks budget, forecasts spend |
| resource-manager | Resource Manager | Identifies skill gaps, load balancing |
| pm-assistant | PM Assistant | Reviews metrics, suggests focus areas |
| meeting-actions | Meeting Actions | Extracts actions from meeting transcripts |

## Phases

### Phase 1: Provider Configuration UI
- [ ] Create `ai-config.js` — getAIConfig(), saveAIConfig(), isAIConfigured(), provider presets
- [ ] Add AI settings modal in `index.html` (provider radio buttons, endpoint, API key, model, test button)
- [ ] Add AI toggle button to navbar (robot icon)
- [ ] Add "AI Settings" to Tools dropdown
- [ ] Add AI state variables to `state.js`
- [ ] Style the settings modal

### Phase 2: Backend Proxy Endpoint
- [ ] Create `ai_service.py` — proxy_chat_completion() using httpx
- [ ] Add POST /api/ai/chat route with SSE streaming
- [ ] Add POST /api/ai/test route for connection testing
- [ ] Add Pydantic models (AIChatRequest, AIChatMessage)
- [ ] Add httpx dependency to pyproject.toml
- [ ] Handle provider-specific differences (Anthropic format translation)

### Phase 3: Agent Prompt Templates
- [ ] Create `agents/` directory structure with 9 agents
- [ ] Each agent: `agent.yml` (metadata) + `system-prompt.md` (with {{plan_markdown}} placeholder)
- [ ] Add agent discovery/loading logic to ai_service.py
- [ ] Add GET /api/ai/agents and GET /api/ai/agents/{id} routes

### Phase 4: AI Chat Panel (Frontend)
- [ ] Create `ai-chat.js` — panel open/close, agent selection, message sending, streaming display
- [ ] Create `ai-chat.css` — chat panel, message bubbles, agent selector, input area
- [ ] Add chat panel HTML to `index.html` (slide-in from right, z-index above detail pane)
- [ ] Plan context injection (current plan markdown into system prompt)
- [ ] Streaming response display via fetch + ReadableStream
- [ ] Simple markdown rendering for assistant messages
- [ ] Agent-specific context injection (Risk Manager gets RAID, Accountant gets budget, etc.)
- [ ] Keyboard shortcut (Ctrl+Shift+A) to toggle panel
- [ ] Visibility gating (hide AI features when not configured)

### Phase 5: Testing
- [ ] Create `tests/test_ai_service.py` — proxy, streaming, error handling, agent API
- [ ] Test API key is never logged or stored
- [ ] Test request validation
- [ ] Manual frontend testing checklist

### Phase 6: Documentation and Polish
- [ ] Update `design/epic.md`
- [ ] Create `docs/how-to/configure-ai-provider.md`
- [ ] Create `docs/how-to/use-ai-agents.md`
- [ ] Create `docs/reference/ai-agents.md`
- [ ] Update interface tour
- [ ] Update keyboard shortcuts modal
- [ ] Dark mode support

## Phase Dependencies

```
Phase 1 (Config UI) ──┐
Phase 2 (Proxy)     ──┼──> Phase 4 (Chat Panel) ──> Phase 5 (Tests) ──> Phase 6 (Docs)
Phase 3 (Templates) ──┘
```

Phases 1, 2, 3 can be developed in parallel.

## Key Files

- `packages/noodle-web/src/noodle_web/static/ai-config.js` — NEW
- `packages/noodle-web/src/noodle_web/static/ai-chat.js` — NEW
- `packages/noodle-web/src/noodle_web/static/ai-chat.css` — NEW
- `packages/noodle-web/src/noodle_web/ai_service.py` — NEW
- `packages/noodle-web/src/noodle_web/app.py` — add AI routes
- `packages/noodle-web/src/noodle_web/templates/index.html` — chat panel + settings modal
- `packages/noodle-web/src/noodle_web/static/state.js` — AI state vars
- `agents/` — NEW directory with 9 agent subdirectories

## Notes

- Ollama must run on the same machine as NoodlePlanner server (proxy connects to localhost)
- HTTPS recommended for production (API key in request body)
- Plan text truncated to ~100KB if too large for context window
- Anthropic needs format translation in proxy (different message format from OpenAI)
