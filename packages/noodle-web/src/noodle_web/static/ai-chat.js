/**
 * ai-chat.js — AI Chat Panel for NoodlePlanner.
 * Slide-in panel for conversing with AI agents about the current plan.
 */

/* ── State ──────────────────────────────────────────────────── */

let aiAgents = [];
let aiSelectedAgentId = null;
let aiMessages = [];
let aiStreaming = false;

/* ── Panel open/close ───────────────────────────────────────── */

function openAIChat() {
    const overlay = document.getElementById('aiChatOverlay');
    const panel = document.getElementById('aiChatPanel');
    if (!overlay || !panel) return;

    overlay.classList.add('active');
    panel.classList.add('open');
    aiChatOpen = true;

    if (!isAIConfigured()) {
        showAIChatSetup();
        return;
    }

    hideAIChatSetup();
    if (aiAgents.length === 0) {
        loadAgents();
    }

    // Focus the input
    const textarea = document.getElementById('aiChatInput');
    if (textarea) textarea.focus();
}

function closeAIChat() {
    const overlay = document.getElementById('aiChatOverlay');
    const panel = document.getElementById('aiChatPanel');
    if (overlay) overlay.classList.remove('active');
    if (panel) panel.classList.remove('open');
    aiChatOpen = false;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('aiChatCloseBtn')?.addEventListener('close', closeAIChat);
});

function toggleAIChat() {
    if (aiChatOpen) {
        closeAIChat();
    } else {
        openAIChat();
    }
}

/* ── Setup prompt (not configured) ──────────────────────────── */

function showAIChatSetup() {
    const setup = document.getElementById('aiChatSetup');
    const messagesArea = document.getElementById('aiChatMessages');
    const inputArea = document.getElementById('aiChatInputArea');
    const agentBar = document.getElementById('aiAgentSelector');

    if (setup) setup.style.display = 'flex';
    if (messagesArea) messagesArea.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    if (agentBar) agentBar.style.display = 'none';
}

function hideAIChatSetup() {
    const setup = document.getElementById('aiChatSetup');
    const messagesArea = document.getElementById('aiChatMessages');
    const inputArea = document.getElementById('aiChatInputArea');
    const agentBar = document.getElementById('aiAgentSelector');

    if (setup) setup.style.display = 'none';
    if (messagesArea) messagesArea.style.display = 'flex';
    if (inputArea) inputArea.style.display = 'flex';
    if (agentBar) agentBar.style.display = 'flex';
}

/* ── Agent loading and selection ─────────────────────────────── */

async function loadAgents() {
    try {
        const resp = await fetch('/api/ai/agents');
        if (!resp.ok) return;
        aiAgents = await resp.json();
        renderAgentSelector();
        if (aiAgents.length > 0 && !aiSelectedAgentId) {
            selectAgent(aiAgents[0].id);
        }
    } catch (err) {
        console.error('Failed to load AI agents:', err);
    }
}

function renderAgentSelector() {
    const container = document.getElementById('aiAgentSelector');
    if (!container) return;

    container.innerHTML = aiAgents.map(function(agent) {
        const activeClass = agent.id === aiSelectedAgentId ? ' active' : '';
        const icon = agent.icon || 'bi-robot';
        return '<button class="ai-agent-chip' + activeClass + '" ' +
            'onclick="selectAgent(\'' + agent.id + '\')" ' +
            'aria-pressed="' + (agent.id === aiSelectedAgentId) + '" ' +
            'title="' + escapeHtml(agent.description || agent.name) + '">' +
            '<i class="bi ' + escapeHtml(icon) + '" aria-hidden="true"></i> ' +
            escapeHtml(agent.name) +
            '</button>';
    }).join('');
}

function selectAgent(agentId) {
    aiSelectedAgentId = agentId;
    aiMessages = [];
    aiChatHistory = [];
    clearChatMessages();
    renderAgentSelector();
    updateAgentName();

    // Focus input after selecting
    const textarea = document.getElementById('aiChatInput');
    if (textarea) textarea.focus();
}

function updateAgentName() {
    const el = document.getElementById('aiChatAgentName');
    if (!el) return;
    const agent = aiAgents.find(function(a) { return a.id === aiSelectedAgentId; });
    el.textContent = agent ? agent.name : '';
}

function clearChatMessages() {
    const container = document.getElementById('aiChatMessages');
    if (container) container.innerHTML = '';
}

/* ── Escape HTML helper ──────────────────────────────────────── */

function escapeHtmlForChat(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* ── Simple Markdown renderer ────────────────────────────────── */

function renderAIChatMarkdown(text) {
    if (!text) return '';

    // Escape HTML first
    let html = escapeHtmlForChat(text);

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
        return '<pre><code>' + code.trim() + '</code></pre>';
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Paragraphs (double newline)
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>(<h[1-3]>)/g, '$1');
    html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');

    return html;
}

/* ── Message display ─────────────────────────────────────────── */

function appendChatMessage(role, content) {
    const container = document.getElementById('aiChatMessages');
    if (!container) return null;

    const bubble = document.createElement('div');
    bubble.className = 'ai-chat-bubble ' + role;
    bubble.setAttribute('role', 'log');

    if (role === 'assistant') {
        bubble.innerHTML = renderAIChatMarkdown(content);
    } else if (role === 'error') {
        bubble.textContent = content;
    } else {
        bubble.textContent = content;
    }

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
}

function showTypingIndicator() {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;

    const existing = container.querySelector('.ai-typing-indicator');
    if (existing) return;

    const indicator = document.createElement('div');
    indicator.className = 'ai-typing-indicator';
    indicator.setAttribute('aria-label', 'AI is typing');
    indicator.innerHTML = '<div class="ai-typing-dot"></div>' +
        '<div class="ai-typing-dot"></div>' +
        '<div class="ai-typing-dot"></div>';
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;
    const indicator = container.querySelector('.ai-typing-indicator');
    if (indicator) indicator.remove();
}

/* ── Send message ─────────────────────────────────────────────── */

async function sendAIChatMessage() {
    if (aiStreaming) return;

    const textarea = document.getElementById('aiChatInput');
    if (!textarea) return;

    const userText = textarea.value.trim();
    if (!userText) return;

    const config = getAIConfig();
    if (!config) {
        appendChatMessage('error', 'AI is not configured. Please set up a provider first.');
        return;
    }

    // Add user message to display and history
    appendChatMessage('user', userText);
    aiMessages.push({ role: 'user', content: userText });
    textarea.value = '';
    autoGrowAIChatInput();

    // Build the system prompt with plan context
    let systemPrompt = '';
    try {
        systemPrompt = await getAgentSystemPrompt();
    } catch (err) {
        appendChatMessage('error', 'Failed to load agent prompt: ' + err.message);
        return;
    }

    // Build messages array for the API
    const apiMessages = [];
    if (systemPrompt) {
        apiMessages.push({ role: 'system', content: systemPrompt });
    }
    for (let i = 0; i < aiMessages.length; i++) {
        apiMessages.push({ role: aiMessages[i].role, content: aiMessages[i].content });
    }

    // Show typing indicator and disable input
    showTypingIndicator();
    aiStreaming = true;
    updateSendButtonState();

    // Include current plan text for tool calling
    const planEditor = document.getElementById('planEditor');
    const planText = planEditor ? planEditor.value : '';

    try {
        const resp = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: config.endpoint,
                api_key: config.apiKey || '',
                model: config.model,
                provider: config.provider,
                messages: apiMessages,
                stream: true,
                plan_text: planText,
            }),
        });

        if (!resp.ok) {
            hideTypingIndicator();
            const errData = await resp.json().catch(function() { return {}; });
            appendChatMessage('error', errData.detail || 'Request failed (status ' + resp.status + ').');
            aiStreaming = false;
            updateSendButtonState();
            return;
        }

        hideTypingIndicator();

        // Create assistant bubble for streaming
        let assistantBubble = null;
        let fullContent = '';
        let pendingPlanUpdate = null;

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line.startsWith('data: ')) continue;

                const jsonStr = line.substring(6);
                let data;
                try {
                    data = JSON.parse(jsonStr);
                } catch (e) {
                    continue;
                }

                if (data.error) {
                    if (!assistantBubble) {
                        assistantBubble = appendChatMessage('assistant', '');
                    }
                    assistantBubble.className = 'ai-chat-bubble error';
                    assistantBubble.textContent = 'Error: ' + data.error;
                    break;
                }

                // Handle tool call events
                if (data.tool_call) {
                    appendToolCallMessage(data.tool_call, data.result);
                }

                // Handle plan update events
                if (data.plan_update) {
                    pendingPlanUpdate = data.plan_update;
                }

                // Handle regular content tokens
                if (data.content) {
                    fullContent += data.content;
                    if (!assistantBubble) {
                        assistantBubble = appendChatMessage('assistant', '');
                    }
                    assistantBubble.innerHTML = renderAIChatMarkdown(fullContent);
                    const messagesContainer = document.getElementById('aiChatMessages');
                    if (messagesContainer) {
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }
                }

                if (data.done) break;
            }
        }

        // Final render
        if (fullContent) {
            if (!assistantBubble) {
                assistantBubble = appendChatMessage('assistant', '');
            }
            assistantBubble.innerHTML = renderAIChatMarkdown(fullContent);
            aiMessages.push({ role: 'assistant', content: fullContent });
        }

        // Apply pending plan update automatically with undo
        if (pendingPlanUpdate) {
            applyPlanUpdateFromTool(pendingPlanUpdate);
        }

    } catch (err) {
        hideTypingIndicator();
        appendChatMessage('error', 'Network error: ' + err.message);
    } finally {
        aiStreaming = false;
        updateSendButtonState();
    }
}

function updateSendButtonState() {
    const btn = document.getElementById('aiChatSendBtn');
    if (btn) btn.disabled = aiStreaming;
}

/* ── Agent system prompt with plan injection ──────────────────── */

async function getAgentSystemPrompt() {
    if (!aiSelectedAgentId) return '';

    const resp = await fetch('/api/ai/agents/' + aiSelectedAgentId);
    if (!resp.ok) throw new Error('Agent not found');
    const agent = await resp.json();

    let prompt = agent.system_prompt || '';

    // Inject plan markdown
    const planEditor = document.getElementById('planEditor');
    const planText = planEditor ? planEditor.value : '';

    // Truncate plan to ~100KB if too large
    const maxPlanLength = 100000;
    const truncatedPlan = planText.length > maxPlanLength
        ? planText.substring(0, maxPlanLength) + '\n\n[Plan truncated due to size]'
        : planText;

    prompt = prompt.replace(/\{\{plan_markdown\}\}/g, truncatedPlan);

    // Append plan format reference and update instructions
    prompt += '\n\n## NoodlePlanner Format Reference\n\n' +
        'The plan uses YAML front matter between `---` markers, followed by tasks as indented markdown.\n\n' +
        '### Front matter fields\n' +
        '```\n---\n' +
        'title: Project Name\n' +
        'project manager: Name\n' +
        'start date: YYYY-MM-DD\n' +
        'budget: £amount\n' +
        'stakeholders:\n' +
        '  - @Stakeholder Name {interest} {influence}\n' +
        '  - @Another Person {interest} {influence}\n' +
        'resources:\n' +
        '  - @Resource Name {role}\n' +
        'non-working-days:\n' +
        '  - Holiday Name: YYYY-MM-DD:YYYY-MM-DD\n' +
        '---\n```\n\n' +
        'Stakeholders MUST be in the front matter under `stakeholders:` as a YAML list with `- @Name` entries. ' +
        'They are NOT in a table. Interest/influence use curly braces: `{High}` `{Low}` etc.\n\n' +
        '### Task syntax\n' +
        '- Indentation = hierarchy (2 spaces per level)\n' +
        '- Duration: `5d` (days), `2w` (weeks), `1m` (months)\n' +
        '- Resources: `@Name`\n' +
        '- Dependencies: `[depends TaskName]` or `[depends Task1, Task2:SS +2d]`\n' +
        '- Completion: `%50`\n' +
        '- Sequential tasks: `*` prefix\n' +
        '- Milestones: `0d` duration\n' +
        '- Comments: `!"comment text"`\n' +
        '- Deliverables: `$deliverable_name`\n' +
        '- Labels: `#label`\n\n' +
        '### Sections after tasks\n' +
        '- `---benefits---` — benefits realisation table\n' +
        '- `---budget---` — budget table\n' +
        '- `---raid log---` — risks, assumptions, issues, dependencies table\n' +
        '- `---comms---` — communications plan table\n' +
        '- `---baseline---` — baseline snapshot\n' +
        '- `---whiteboard---` — whiteboard/todo-list note layout (Task, X, Y, Colour, Width, Height, Collapsed); never treat its rows as tasks. ' +
        'Some rows may instead be free-floating text objects (Kind=text, with Id/Text columns instead of Task/Colour/Width/Height/Collapsed) — bare canvas text with no backing task at all; never treat these as tasks either\n\n' +
        '## How to make changes to the plan\n\n' +
        'You have tools available to modify the plan. ALWAYS use the provided tools (like add_stakeholder, add_task, etc.) ' +
        'to make changes. NEVER output plan text directly. Just call the appropriate tool and then explain what you did.';

    return prompt;
}

/* ── Tool call display ───────────────────────────────────────── */

function appendToolCallMessage(toolName, result) {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'ai-tool-call';
    el.innerHTML =
        '<span class="ai-tool-call-icon" aria-hidden="true">&#128295;</span>' +
        '<span class="ai-tool-call-name">' + escapeHtmlForChat(toolName) + '</span>' +
        '<span class="ai-tool-call-result">' + escapeHtmlForChat(result || '') + '</span>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
}

/* ── Apply plan update from tool results ─────────────────────── */

function applyPlanUpdateFromTool(newPlanText) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Save previous plan text for undo
    const previousPlanText = editor.value;

    // Apply the new plan text
    if (typeof setEditorValuePreservingCursor === 'function') {
        setEditorValuePreservingCursor(editor, newPlanText);
    } else {
        editor.value = newPlanText;
    }

    // Sync kanban editor if present
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    if (kanbanEditor) kanbanEditor.value = newPlanText;

    // Trigger re-render
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Show plan-applied banner with undo
    showPlanAppliedBanner(previousPlanText);
}

function showPlanAppliedBanner(previousPlanText) {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;

    const banner = document.createElement('div');
    banner.className = 'ai-plan-applied';
    banner.innerHTML =
        '<span>Plan updated</span>' +
        '<span class="ai-plan-applied-undo" role="button" tabindex="0" aria-label="Undo plan update">Undo</span>';

    var undoBtn = banner.querySelector('.ai-plan-applied-undo');

    function handleUndo() {
        var editor = document.getElementById('planEditor');
        if (!editor) return;

        if (typeof setEditorValuePreservingCursor === 'function') {
            setEditorValuePreservingCursor(editor, previousPlanText);
        } else {
            editor.value = previousPlanText;
        }

        var kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) kanbanEditor.value = previousPlanText;

        editor.dispatchEvent(new Event('input', { bubbles: true }));

        banner.innerHTML = '<span>Plan update reverted</span>';
        banner.classList.add('ai-plan-applied-reverted');
    }

    undoBtn.addEventListener('click', handleUndo);
    undoBtn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleUndo();
        }
    });

    container.appendChild(banner);
    container.scrollTop = container.scrollHeight;
}

/* ── Input auto-grow ──────────────────────────────────────────── */

function autoGrowAIChatInput() {
    const textarea = document.getElementById('aiChatInput');
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

/* ── Keyboard handling for input ──────────────────────────────── */

function handleAIChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAIChatMessage();
    }
}

/* ── Initialisation ───────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function() {
    // Auto-grow setup
    const textarea = document.getElementById('aiChatInput');
    if (textarea) {
        textarea.addEventListener('input', autoGrowAIChatInput);
    }
});
