/**
 * ai-config.js — AI provider configuration for NoodlePlanner.
 * Manages localStorage-based BYOK (Bring Your Own Key) provider settings.
 */

const AI_CONFIG_KEY = 'noodleplanner_ai_config';

/**
 * Returns provider presets with default endpoint and model values.
 */
function getProviderPresets() {
    return {
        openai: {
            label: 'OpenAI',
            endpoint: 'https://api.openai.com/v1',
            model: 'gpt-4o',
        },
        anthropic: {
            label: 'Anthropic',
            endpoint: 'https://api.anthropic.com/v1',
            model: 'claude-sonnet-4-20250514',
        },
        ollama: {
            label: 'Ollama (Local)',
            endpoint: 'http://localhost:11434/v1',
            model: 'llama3',
        },
        custom: {
            label: 'Custom',
            endpoint: '',
            model: '',
        },
    };
}

/**
 * Reads the current AI configuration from localStorage.
 * Returns null if not configured.
 */
function getAIConfig() {
    try {
        const raw = localStorage.getItem(AI_CONFIG_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Saves AI configuration to localStorage.
 */
function saveAIConfig(config) {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
    updateAIButtonIndicator();
}

/**
 * Returns true if AI is configured with at minimum a provider and endpoint.
 */
function isAIConfigured() {
    const config = getAIConfig();
    return !!(config && config.provider && config.endpoint && config.enabled);
}

/**
 * Clears the AI configuration from localStorage.
 */
function clearAIConfig() {
    localStorage.removeItem(AI_CONFIG_KEY);
    updateAIButtonIndicator();
}

/* ── AI Settings Modal ─────────────────────────────────────── */

function openAISettingsModal() {
    const overlay = document.getElementById('aiSettingsOverlay');
    if (!overlay) return;
    const config = getAIConfig();
    const presets = getProviderPresets();

    // Set provider radio
    const provider = config?.provider || 'openai';
    const radio = document.querySelector(`input[name="aiProvider"][value="${provider}"]`);
    if (radio) radio.checked = true;

    // Fill fields
    const preset = presets[provider] || presets.openai;
    document.getElementById('aiEndpoint').value = config?.endpoint || preset.endpoint;
    document.getElementById('aiApiKey').value = config?.apiKey || '';
    document.getElementById('aiModel').value = config?.model || preset.model;

    // Reset test status
    const status = document.getElementById('aiTestStatus');
    if (status) {
        status.textContent = '';
        status.className = 'ai-test-status';
    }

    overlay.classList.add('active');
    overlay.querySelector('input, button')?.focus();
}

function closeAISettingsModal() {
    const overlay = document.getElementById('aiSettingsOverlay');
    if (overlay) overlay.classList.remove('active');
}

function onAIProviderChange(providerValue) {
    const presets = getProviderPresets();
    const preset = presets[providerValue];
    if (!preset) return;
    document.getElementById('aiEndpoint').value = preset.endpoint;
    document.getElementById('aiModel').value = preset.model;
}

function toggleAIKeyVisibility() {
    const input = document.getElementById('aiApiKey');
    const btn = document.getElementById('aiKeyToggle');
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<i class="bi bi-eye-slash"></i>';
        btn.setAttribute('aria-label', 'Hide API key');
    } else {
        input.type = 'password';
        btn.innerHTML = '<i class="bi bi-eye"></i>';
        btn.setAttribute('aria-label', 'Show API key');
    }
}

async function testAIConnection() {
    const status = document.getElementById('aiTestStatus');
    const btn = document.getElementById('aiTestBtn');
    if (!status || !btn) return;

    const endpoint = document.getElementById('aiEndpoint').value.trim();
    const apiKey = document.getElementById('aiApiKey').value.trim();
    const model = document.getElementById('aiModel').value.trim();
    const provider = document.querySelector('input[name="aiProvider"]:checked')?.value || 'openai';

    if (!endpoint) {
        status.textContent = 'Please enter an endpoint URL.';
        status.className = 'ai-test-status ai-test-error';
        return;
    }

    status.textContent = 'Testing connection...';
    status.className = 'ai-test-status ai-test-pending';
    btn.disabled = true;

    try {
        const resp = await fetch('/api/ai/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint, api_key: apiKey, model, provider }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
            status.textContent = 'Connection successful!';
            status.className = 'ai-test-status ai-test-success';
        } else {
            status.textContent = data.detail || data.error || 'Connection failed.';
            status.className = 'ai-test-status ai-test-error';
        }
    } catch (err) {
        status.textContent = 'Network error: ' + err.message;
        status.className = 'ai-test-status ai-test-error';
    } finally {
        btn.disabled = false;
    }
}

function saveAISettingsFromModal() {
    const provider = document.querySelector('input[name="aiProvider"]:checked')?.value || 'openai';
    const endpoint = document.getElementById('aiEndpoint').value.trim();
    const apiKey = document.getElementById('aiApiKey').value.trim();
    const model = document.getElementById('aiModel').value.trim();

    if (!endpoint) {
        const status = document.getElementById('aiTestStatus');
        if (status) {
            status.textContent = 'Endpoint URL is required.';
            status.className = 'ai-test-status ai-test-error';
        }
        return;
    }

    saveAIConfig({ provider, endpoint, apiKey, model, enabled: true });
    closeAISettingsModal();
}

/* ── Navbar AI button ──────────────────────────────────────── */

function onAIButtonClick() {
    if (isAIConfigured()) {
        aiChatOpen = !aiChatOpen;
        // Chat panel toggle will be implemented in Phase 4
    } else {
        openAISettingsModal();
    }
}

function updateAIButtonIndicator() {
    const dot = document.getElementById('aiConfiguredDot');
    if (dot) {
        dot.style.display = isAIConfigured() ? 'block' : 'none';
    }
}

// Initialise indicator on load
document.addEventListener('DOMContentLoaded', updateAIButtonIndicator);
