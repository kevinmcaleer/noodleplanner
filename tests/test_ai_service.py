"""Tests for the AI service module."""

import json
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

import pytest

from noodle_web.ai_service import (
    AIChatMessage,
    AIChatRequest,
    AITestRequest,
    _build_anthropic_payload,
    _build_openai_payload,
    _extract_token,
    _get_chat_url,
    _get_headers,
    _sse_event,
    list_agents,
    get_agent,
    AGENTS_DIR,
)


class TestPydanticModels:
    """Test Pydantic model validation."""

    def test_chat_message_valid_roles(self):
        for role in ("system", "user", "assistant"):
            msg = AIChatMessage(role=role, content="hello")
            assert msg.role == role

    def test_chat_message_invalid_role(self):
        with pytest.raises(Exception):
            AIChatMessage(role="invalid", content="hello")

    def test_chat_request_defaults(self):
        req = AIChatRequest(
            endpoint="http://localhost",
            model="test",
            messages=[AIChatMessage(role="user", content="hi")],
        )
        assert req.provider == "openai"
        assert req.stream is True
        assert req.api_key == ""

    def test_test_request_defaults(self):
        req = AITestRequest(endpoint="http://localhost", model="test")
        assert req.provider == "openai"
        assert req.api_key == ""


class TestPayloadBuilders:
    """Test OpenAI and Anthropic payload construction."""

    def test_openai_payload(self):
        messages = [
            AIChatMessage(role="system", content="You are helpful."),
            AIChatMessage(role="user", content="Hello"),
        ]
        payload = _build_openai_payload("gpt-4o", messages)
        assert payload["model"] == "gpt-4o"
        assert payload["stream"] is True
        assert len(payload["messages"]) == 2
        assert payload["messages"][0]["role"] == "system"

    def test_anthropic_payload_separates_system(self):
        messages = [
            AIChatMessage(role="system", content="You are helpful."),
            AIChatMessage(role="user", content="Hello"),
        ]
        payload = _build_anthropic_payload("claude-sonnet-4-20250514", messages)
        assert payload["model"] == "claude-sonnet-4-20250514"
        assert payload["system"] == "You are helpful."
        assert len(payload["messages"]) == 1
        assert payload["messages"][0]["role"] == "user"

    def test_anthropic_payload_no_system(self):
        messages = [AIChatMessage(role="user", content="Hello")]
        payload = _build_anthropic_payload("claude-sonnet-4-20250514", messages)
        assert "system" not in payload or payload.get("system", "").strip() == ""


class TestHeaders:
    """Test header construction for different providers."""

    def test_openai_headers_with_key(self):
        headers = _get_headers("openai", "sk-test123")
        assert headers["authorization"] == "Bearer sk-test123"
        assert "x-api-key" not in headers

    def test_openai_headers_no_key(self):
        headers = _get_headers("openai", "")
        assert "authorization" not in headers

    def test_anthropic_headers(self):
        headers = _get_headers("anthropic", "sk-ant-test")
        assert headers["x-api-key"] == "sk-ant-test"
        assert headers["anthropic-version"] == "2023-06-01"
        assert "authorization" not in headers

    def test_ollama_headers_no_key(self):
        headers = _get_headers("ollama", "")
        assert "authorization" not in headers


class TestChatUrl:
    """Test URL construction for different providers."""

    def test_openai_url(self):
        url = _get_chat_url("openai", "https://api.openai.com/v1")
        assert url == "https://api.openai.com/v1/chat/completions"

    def test_anthropic_url(self):
        url = _get_chat_url("anthropic", "https://api.anthropic.com/v1")
        assert url == "https://api.anthropic.com/v1/messages"

    def test_trailing_slash_stripped(self):
        url = _get_chat_url("openai", "https://api.openai.com/v1/")
        assert url == "https://api.openai.com/v1/chat/completions"

    def test_ollama_url(self):
        url = _get_chat_url("ollama", "http://localhost:11434/v1")
        assert url == "http://localhost:11434/v1/chat/completions"


class TestTokenExtraction:
    """Test token extraction from streaming response chunks."""

    def test_openai_token(self):
        data = {"choices": [{"delta": {"content": "Hello"}}]}
        assert _extract_token(data, "openai") == "Hello"

    def test_openai_no_content(self):
        data = {"choices": [{"delta": {}}]}
        assert _extract_token(data, "openai") is None

    def test_openai_empty_choices(self):
        data = {"choices": []}
        assert _extract_token(data, "openai") is None

    def test_anthropic_content_block_delta(self):
        data = {"type": "content_block_delta", "delta": {"text": "World"}}
        assert _extract_token(data, "anthropic") == "World"

    def test_anthropic_other_event(self):
        data = {"type": "message_start"}
        assert _extract_token(data, "anthropic") is None


class TestSSEEvent:
    """Test SSE event formatting."""

    def test_sse_format(self):
        result = _sse_event({"content": "hi", "done": False})
        assert result.startswith("data: ")
        assert result.endswith("\n\n")
        parsed = json.loads(result[6:].strip())
        assert parsed["content"] == "hi"
        assert parsed["done"] is False


class TestAgentDiscovery:
    """Test agent listing and loading."""

    def test_list_agents_returns_list(self):
        agents = list_agents()
        assert isinstance(agents, list)
        assert len(agents) == 9

    def test_list_agents_have_required_fields(self):
        agents = list_agents()
        for agent in agents:
            assert "id" in agent
            assert "name" in agent
            assert "description" in agent
            assert "icon" in agent

    def test_list_agents_sorted_by_order(self):
        agents = list_agents()
        orders = [a.get("order", 999) for a in agents]
        assert orders == sorted(orders)

    def test_get_agent_existing(self):
        agent = get_agent("planning-agent")
        assert agent is not None
        assert agent["id"] == "planning-agent"
        assert agent["name"] == "Planning Agent"
        assert "system_prompt" in agent
        assert "{{plan_markdown}}" in agent["system_prompt"]

    def test_get_agent_nonexistent(self):
        agent = get_agent("nonexistent-agent")
        assert agent is None

    def test_all_agents_have_system_prompts(self):
        agents = list_agents()
        for agent_meta in agents:
            agent = get_agent(agent_meta["id"])
            assert agent is not None
            assert len(agent["system_prompt"]) > 0

    def test_agent_ids(self):
        agents = list_agents()
        ids = {a["id"] for a in agents}
        expected = {
            "planning-agent",
            "risk-manager",
            "reporting-analyst",
            "benefits-manager",
            "stakeholder-engagement",
            "accountant",
            "resource-manager",
            "pm-assistant",
            "meeting-actions",
        }
        assert ids == expected
