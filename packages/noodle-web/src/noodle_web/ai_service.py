"""
ai_service.py — AI proxy service for NoodlePlanner.

Proxies chat completion requests to user-configured AI providers.
API keys are received per-request and never stored or logged.
"""

import json
import logging
from pathlib import Path
from typing import AsyncIterator, Optional

import httpx
import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

AI_PROXY_TIMEOUT = 60.0

AGENTS_DIR = Path(__file__).parent / "agents"


# ── Pydantic models ──────────────────────────────────────────

class AIChatMessage(BaseModel):
    role: str = Field(..., pattern=r"^(system|user|assistant)$")
    content: str


class AIChatRequest(BaseModel):
    endpoint: str
    api_key: str = ""
    model: str
    provider: str = "openai"
    messages: list[AIChatMessage]
    stream: bool = True


class AITestRequest(BaseModel):
    endpoint: str
    api_key: str = ""
    model: str
    provider: str = "openai"


# ── Provider format translation ──────────────────────────────

def _build_anthropic_payload(model: str, messages: list[AIChatMessage]) -> dict:
    """Translate OpenAI-style messages to Anthropic API format."""
    system_text = ""
    api_messages = []
    for msg in messages:
        if msg.role == "system":
            system_text += msg.content + "\n"
        else:
            api_messages.append({"role": msg.role, "content": msg.content})

    payload = {
        "model": model,
        "max_tokens": 4096,
        "messages": api_messages,
        "stream": True,
    }
    if system_text.strip():
        payload["system"] = system_text.strip()
    return payload


def _build_openai_payload(model: str, messages: list[AIChatMessage]) -> dict:
    """Build standard OpenAI chat completion payload."""
    return {
        "model": model,
        "messages": [{"role": m.role, "content": m.content} for m in messages],
        "stream": True,
    }


def _get_headers(provider: str, api_key: str) -> dict:
    """Return provider-appropriate headers. Never logs the key."""
    if provider == "anthropic":
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
    else:
        headers = {
            "content-type": "application/json",
        }
        if api_key:
            headers["authorization"] = f"Bearer {api_key}"
    return headers


def _get_chat_url(provider: str, endpoint: str) -> str:
    """Return the full chat completions URL for the provider."""
    endpoint = endpoint.rstrip("/")
    if provider == "anthropic":
        return f"{endpoint}/messages"
    return f"{endpoint}/chat/completions"


# ── SSE streaming ─────────────────────────────────────────────

async def proxy_chat_completion(
    endpoint: str,
    api_key: str,
    model: str,
    messages: list[AIChatMessage],
    provider: str = "openai",
    stream: bool = True,
) -> AsyncIterator[str]:
    """Stream chat completion tokens as SSE events.

    Yields lines in the format: data: {"content": "token", "done": false}
    """
    url = _get_chat_url(provider, endpoint)
    headers = _get_headers(provider, api_key)

    if provider == "anthropic":
        payload = _build_anthropic_payload(model, messages)
    else:
        payload = _build_openai_payload(model, messages)

    logger.info("AI proxy request to %s (provider=%s, model=%s)", url, provider, model)

    async with httpx.AsyncClient(timeout=AI_PROXY_TIMEOUT) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                error_text = body.decode("utf-8", errors="replace")
                logger.warning("AI proxy error %d from %s", resp.status_code, url)
                yield _sse_event({"error": error_text, "status": resp.status_code, "done": True})
                return

            async for line in resp.aiter_lines():
                if not line:
                    continue

                # Handle SSE data lines
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        yield _sse_event({"content": "", "done": True})
                        return

                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    token = _extract_token(data, provider)
                    if token is not None:
                        yield _sse_event({"content": token, "done": False})

                # Anthropic streaming uses event types
                elif provider == "anthropic":
                    if line.startswith("event: "):
                        event_type = line[7:].strip()
                        if event_type == "message_stop":
                            yield _sse_event({"content": "", "done": True})
                            return
                    elif not line.startswith(":"):
                        # Raw JSON lines (some providers)
                        try:
                            data = json.loads(line)
                            token = _extract_token(data, provider)
                            if token is not None:
                                yield _sse_event({"content": token, "done": False})
                        except json.JSONDecodeError:
                            continue

    yield _sse_event({"content": "", "done": True})


def _extract_token(data: dict, provider: str) -> Optional[str]:
    """Extract the text token from a streaming response chunk."""
    if provider == "anthropic":
        # Anthropic content_block_delta
        if data.get("type") == "content_block_delta":
            delta = data.get("delta", {})
            return delta.get("text", "")
        return None
    else:
        # OpenAI-compatible format
        choices = data.get("choices", [])
        if choices:
            delta = choices[0].get("delta", {})
            return delta.get("content")
    return None


def _sse_event(data: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data)}\n\n"


# ── Connection test ───────────────────────────────────────────

async def test_connection(
    endpoint: str,
    api_key: str,
    model: str,
    provider: str = "openai",
) -> dict:
    """Test connectivity to an AI provider. Returns {success, message}."""
    url = _get_chat_url(provider, endpoint)
    headers = _get_headers(provider, api_key)

    test_messages = [AIChatMessage(role="user", content="Say hello in one word.")]
    if provider == "anthropic":
        payload = _build_anthropic_payload(model, test_messages)
        payload["stream"] = False
        payload["max_tokens"] = 10
    else:
        payload = _build_openai_payload(model, test_messages)
        payload["stream"] = False
        payload["max_tokens"] = 10

    logger.info("AI connection test to %s (provider=%s)", url, provider)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)

        if resp.status_code in (401, 403):
            return {"success": False, "message": "Authentication failed. Check your API key."}
        if resp.status_code == 429:
            return {"success": False, "message": "Rate limited. Try again later."}
        if resp.status_code >= 400:
            return {"success": False, "message": f"Provider returned status {resp.status_code}."}

        return {"success": True, "message": "Connection successful."}

    except httpx.ConnectError:
        return {"success": False, "message": "Could not connect to the endpoint."}
    except httpx.TimeoutException:
        return {"success": False, "message": "Connection timed out."}
    except Exception as exc:
        logger.warning("AI test connection error: %s", exc)
        return {"success": False, "message": "Unexpected error testing connection."}


# ── Agent discovery ───────────────────────────────────────────

def list_agents() -> list[dict]:
    """Scan the agents directory and return metadata for all agents."""
    agents = []
    if not AGENTS_DIR.exists():
        return agents

    for agent_dir in sorted(AGENTS_DIR.iterdir()):
        if not agent_dir.is_dir():
            continue
        meta_path = agent_dir / "agent.yml"
        if not meta_path.exists():
            continue
        try:
            meta = yaml.safe_load(meta_path.read_text())
            meta["id"] = agent_dir.name
            agents.append(meta)
        except Exception as exc:
            logger.warning("Failed to load agent %s: %s", agent_dir.name, exc)

    agents.sort(key=lambda a: a.get("order", 999))
    return agents


def get_agent(agent_id: str) -> Optional[dict]:
    """Load a single agent's metadata and system prompt."""
    agent_dir = AGENTS_DIR / agent_id
    meta_path = agent_dir / "agent.yml"
    prompt_path = agent_dir / "system-prompt.md"

    if not meta_path.exists():
        return None

    try:
        meta = yaml.safe_load(meta_path.read_text())
        meta["id"] = agent_id
        if prompt_path.exists():
            meta["system_prompt"] = prompt_path.read_text()
        else:
            meta["system_prompt"] = ""
        return meta
    except Exception as exc:
        logger.warning("Failed to load agent %s: %s", agent_id, exc)
        return None
