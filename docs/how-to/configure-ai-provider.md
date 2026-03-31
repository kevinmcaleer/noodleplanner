# How to Configure an AI Provider

NoodlePlanner supports AI-powered project management agents that can review your
plans, analyse risks, and provide recommendations. To use these features you need
to configure an AI provider with your own API key (BYOK).

## Supported Providers

| Provider | Endpoint | Default Model | API Key Required |
|----------|----------|---------------|------------------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` | Yes |
| Anthropic | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` | Yes |
| Ollama (Local) | `http://localhost:11434/v1` | `llama3` | No |
| Custom | User-defined | User-defined | Depends |

## Step-by-Step Setup

### 1. Open AI Settings

There are two ways to open the AI settings modal:

- Click the **robot icon** in the top navigation bar (if AI is not yet
  configured, this opens settings automatically).
- Open the **Tools** dropdown menu and select **AI Settings**.

### 2. Select a Provider

Choose one of the four provider radio buttons. The endpoint and model fields
will auto-fill with sensible defaults.

### 3. Enter Your API Key

- **OpenAI**: Get your key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
- **Anthropic**: Get your key from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).
- **Ollama**: No key required. Make sure Ollama is running on the same machine
  as the NoodlePlanner server.
- **Custom**: Enter the key required by your endpoint.

Use the eye icon next to the key field to toggle visibility.

### 4. Test the Connection

Click the **Test Connection** button. The status indicator will show:

- **Green**: Connection successful.
- **Red**: An error message explaining the failure.

### 5. Save

Click **Save**. Your configuration is stored in your browser's `localStorage`
and is never sent to the NoodlePlanner server for storage. The API key is only
included in individual chat requests routed through the backend proxy.

## Changing Provider or Model

Re-open the AI Settings modal, change the provider or model field, test the
connection, and save again.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Authentication failed" | Double-check your API key. Regenerate it if needed. |
| "Could not connect to the endpoint" | Verify the endpoint URL. For Ollama, ensure `ollama serve` is running. |
| "Connection timed out" | The provider may be slow. Try again or check your network. |
| "Rate limited" | Wait a moment and try again. Check your provider's usage limits. |
| AI button missing | AI features are hidden until a provider is configured and enabled. |
| Key field blank after reload | Keys are stored per-browser in `localStorage`. Clear and re-enter if needed. |

## Security Notes

- Your API key is stored only in your browser's `localStorage`.
- The NoodlePlanner server proxies requests but never persists the key to disk
  or logs.
- For production deployments, use HTTPS to protect the key in transit.
