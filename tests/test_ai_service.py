"""Tests for the AI service module."""

import asyncio
import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

import httpx
import pytest

from noodle_web.ai_service import (
    AI_PROXY_TIMEOUT,
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
    proxy_chat_completion,
    test_connection as ai_test_connection,
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


# -- Phase 5: Additional tests -----------------------------------------------


class TestAnthropicFormatTranslation:
    """Test Anthropic format translation in the proxy layer."""

    def test_anthropic_multiple_system_messages_concatenated(self):
        messages = [
            AIChatMessage(role="system", content="You are helpful."),
            AIChatMessage(role="system", content="Be concise."),
            AIChatMessage(role="user", content="Hello"),
        ]
        payload = _build_anthropic_payload("claude-sonnet-4-20250514", messages)
        assert "You are helpful." in payload["system"]
        assert "Be concise." in payload["system"]
        assert len(payload["messages"]) == 1

    def test_anthropic_preserves_message_order(self):
        messages = [
            AIChatMessage(role="system", content="System"),
            AIChatMessage(role="user", content="First"),
            AIChatMessage(role="assistant", content="Reply"),
            AIChatMessage(role="user", content="Second"),
        ]
        payload = _build_anthropic_payload("test-model", messages)
        assert payload["messages"][0]["content"] == "First"
        assert payload["messages"][1]["content"] == "Reply"
        assert payload["messages"][2]["content"] == "Second"

    def test_anthropic_payload_has_max_tokens(self):
        messages = [AIChatMessage(role="user", content="Hi")]
        payload = _build_anthropic_payload("test-model", messages)
        assert payload["max_tokens"] == 4096

    def test_anthropic_payload_has_stream_true(self):
        messages = [AIChatMessage(role="user", content="Hi")]
        payload = _build_anthropic_payload("test-model", messages)
        assert payload["stream"] is True

    def test_openai_payload_includes_system_messages_inline(self):
        messages = [
            AIChatMessage(role="system", content="System text"),
            AIChatMessage(role="user", content="Hello"),
        ]
        payload = _build_openai_payload("gpt-4o", messages)
        assert payload["messages"][0]["role"] == "system"
        assert payload["messages"][0]["content"] == "System text"
        assert "system" not in payload  # no top-level system field


class TestAgentPromptTemplateSubstitution:
    """Test agent prompt loading with {{plan_markdown}} substitution."""

    def test_all_agents_contain_plan_markdown_placeholder(self):
        agents = list_agents()
        for agent_meta in agents:
            agent = get_agent(agent_meta["id"])
            assert agent is not None
            assert "{{plan_markdown}}" in agent["system_prompt"], (
                f"Agent {agent_meta['id']} missing {{{{plan_markdown}}}} placeholder"
            )

    def test_agent_prompt_is_nonempty_string(self):
        agent = get_agent("planning-agent")
        assert isinstance(agent["system_prompt"], str)
        assert len(agent["system_prompt"]) > 50  # prompts are substantive

    def test_agent_metadata_has_all_fields(self):
        for agent_meta in list_agents():
            agent = get_agent(agent_meta["id"])
            assert "name" in agent
            assert "description" in agent
            assert "icon" in agent
            assert "category" in agent
            assert "order" in agent
            assert "system_prompt" in agent
            assert "id" in agent


class TestStreamingSSEOutput:
    """Test SSE event formatting and token extraction."""

    def test_sse_event_is_valid_json_after_prefix(self):
        event = _sse_event({"content": "test", "done": False})
        assert event.startswith("data: ")
        assert event.endswith("\n\n")
        parsed = json.loads(event[6:].strip())
        assert parsed["content"] == "test"
        assert parsed["done"] is False

    def test_sse_event_done_true(self):
        event = _sse_event({"content": "", "done": True})
        parsed = json.loads(event[6:].strip())
        assert parsed["done"] is True

    def test_sse_event_with_error(self):
        event = _sse_event({"error": "something broke", "done": True})
        parsed = json.loads(event[6:].strip())
        assert parsed["error"] == "something broke"

    def test_extract_token_openai_with_finish_reason(self):
        data = {"choices": [{"delta": {}, "finish_reason": "stop"}]}
        assert _extract_token(data, "openai") is None

    def test_extract_token_anthropic_message_delta(self):
        data = {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}
        assert _extract_token(data, "anthropic") is None

    def test_extract_token_anthropic_content_block_start(self):
        data = {"type": "content_block_start", "content_block": {"type": "text"}}
        assert _extract_token(data, "anthropic") is None

    def test_extract_token_ollama_same_as_openai(self):
        data = {"choices": [{"delta": {"content": "from ollama"}}]}
        assert _extract_token(data, "ollama") == "from ollama"

    def test_extract_token_custom_same_as_openai(self):
        data = {"choices": [{"delta": {"content": "custom"}}]}
        assert _extract_token(data, "custom") == "custom"


class TestConnectionTestEndpoint:
    """Test the test_connection function."""

    @staticmethod
    def _mock_client_with_response(status_code):
        """Create a patched httpx.AsyncClient returning a response with given status."""
        mock_response = MagicMock()
        mock_response.status_code = status_code
        client = AsyncMock()
        client.post = AsyncMock(return_value=mock_response)
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        return client

    @staticmethod
    def _mock_client_with_error(error):
        """Create a patched httpx.AsyncClient raising an error."""
        client = AsyncMock()
        client.post = AsyncMock(side_effect=error)
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        return client

    def test_connection_success(self):
        client = self._mock_client_with_response(200)
        with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
            result = asyncio.run(ai_test_connection(
                endpoint="http://localhost:11434/v1",
                api_key="",
                model="llama3",
                provider="ollama",
            ))
            assert result["success"] is True
            assert "successful" in result["message"].lower()

    def test_connection_auth_failure(self):
        client = self._mock_client_with_response(401)
        with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
            result = asyncio.run(ai_test_connection(
                endpoint="https://api.openai.com/v1",
                api_key="bad-key",
                model="gpt-4o",
            ))
            assert result["success"] is False
            assert "authentication" in result["message"].lower()

    def test_connection_forbidden(self):
        client = self._mock_client_with_response(403)
        with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
            result = asyncio.run(ai_test_connection(
                endpoint="https://api.openai.com/v1",
                api_key="bad-key",
                model="gpt-4o",
            ))
            assert result["success"] is False

    def test_connection_rate_limited(self):
        client = self._mock_client_with_response(429)
        with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
            result = asyncio.run(ai_test_connection(
                endpoint="https://api.openai.com/v1",
                api_key="key",
                model="gpt-4o",
            ))
            assert result["success"] is False
            assert "rate" in result["message"].lower()

    def test_connection_timeout(self):
        client = self._mock_client_with_error(httpx.TimeoutException("timeout"))
        with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
            result = asyncio.run(ai_test_connection(
                endpoint="https://api.openai.com/v1",
                api_key="key",
                model="gpt-4o",
            ))
            assert result["success"] is False
            assert "timed out" in result["message"].lower()

    def test_connection_network_error(self):
        client = self._mock_client_with_error(httpx.ConnectError("refused"))
        with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
            result = asyncio.run(ai_test_connection(
                endpoint="http://badhost:1234/v1",
                api_key="",
                model="test",
            ))
            assert result["success"] is False
            assert "connect" in result["message"].lower()

    def test_connection_unexpected_error(self):
        client = self._mock_client_with_error(RuntimeError("boom"))
        with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
            result = asyncio.run(ai_test_connection(
                endpoint="http://localhost/v1",
                api_key="",
                model="test",
            ))
            assert result["success"] is False
            assert "unexpected" in result["message"].lower()

    def test_connection_server_error(self):
        client = self._mock_client_with_response(500)
        with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
            result = asyncio.run(ai_test_connection(
                endpoint="https://api.openai.com/v1",
                api_key="key",
                model="gpt-4o",
            ))
            assert result["success"] is False
            assert "500" in result["message"]


class TestAPIKeyNeverLogged:
    """Ensure the API key never appears in log output."""

    def test_proxy_does_not_log_api_key(self, caplog):
        api_key = "sk-SUPERSECRET12345"
        client = AsyncMock()
        client.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with caplog.at_level(logging.DEBUG, logger="noodle_web.ai_service"):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                asyncio.run(ai_test_connection(
                    endpoint="http://localhost/v1",
                    api_key=api_key,
                    model="test",
                    provider="openai",
                ))

        for record in caplog.records:
            assert api_key not in record.getMessage(), (
                f"API key found in log message: {record.getMessage()}"
            )

    def test_headers_do_not_appear_in_info_log(self, caplog):
        """Ensure _get_headers does not log the key value."""
        with caplog.at_level(logging.DEBUG, logger="noodle_web.ai_service"):
            _get_headers("openai", "sk-VERYSECRET999")
        for record in caplog.records:
            assert "sk-VERYSECRET999" not in record.getMessage()


class TestRequestValidationEdgeCases:
    """Test edge cases in request validation."""

    def test_empty_content_message(self):
        msg = AIChatMessage(role="user", content="")
        assert msg.content == ""

    def test_very_long_content_message(self):
        long_text = "x" * 200_000
        msg = AIChatMessage(role="user", content=long_text)
        assert len(msg.content) == 200_000

    def test_chat_request_without_messages_field_raises(self):
        with pytest.raises(Exception):
            AIChatRequest(
                endpoint="http://localhost",
                model="test",
            )

    def test_chat_request_with_empty_messages_list(self):
        req = AIChatRequest(
            endpoint="http://localhost",
            model="test",
            messages=[],
        )
        assert req.messages == []

    def test_chat_request_missing_endpoint_raises(self):
        with pytest.raises(Exception):
            AIChatRequest(
                model="test",
                messages=[AIChatMessage(role="user", content="hi")],
            )

    def test_chat_request_missing_model_raises(self):
        with pytest.raises(Exception):
            AIChatRequest(
                endpoint="http://localhost",
                messages=[AIChatMessage(role="user", content="hi")],
            )

    def test_test_request_missing_endpoint_raises(self):
        with pytest.raises(Exception):
            AITestRequest(model="test")

    def test_test_request_missing_model_raises(self):
        with pytest.raises(Exception):
            AITestRequest(endpoint="http://localhost")

    def test_chat_request_provider_defaults_to_openai(self):
        req = AIChatRequest(
            endpoint="http://localhost",
            model="test",
            messages=[AIChatMessage(role="user", content="hi")],
        )
        assert req.provider == "openai"

    def test_chat_request_accepts_all_providers(self):
        for provider in ("openai", "anthropic", "ollama", "custom"):
            req = AIChatRequest(
                endpoint="http://localhost",
                model="test",
                provider=provider,
                messages=[AIChatMessage(role="user", content="hi")],
            )
            assert req.provider == provider

    def test_very_long_plan_in_openai_payload(self):
        long_plan = "Task " * 50_000
        messages = [
            AIChatMessage(role="system", content=long_plan),
            AIChatMessage(role="user", content="Analyse"),
        ]
        payload = _build_openai_payload("gpt-4o", messages)
        assert len(payload["messages"][0]["content"]) == len(long_plan)

    def test_very_long_plan_in_anthropic_payload(self):
        long_plan = "Task " * 50_000
        messages = [
            AIChatMessage(role="system", content=long_plan),
            AIChatMessage(role="user", content="Analyse"),
        ]
        payload = _build_anthropic_payload("claude-sonnet-4-20250514", messages)
        # _build_anthropic_payload strips the system text
        assert len(payload["system"]) == len(long_plan.strip())


class TestChatUrlEdgeCases:
    """Test URL construction edge cases."""

    def test_custom_provider_url(self):
        url = _get_chat_url("custom", "https://my-proxy.example.com/v1")
        assert url == "https://my-proxy.example.com/v1/chat/completions"

    def test_endpoint_with_multiple_trailing_slashes(self):
        url = _get_chat_url("openai", "https://api.openai.com/v1///")
        assert "///" not in url


class TestHeadersEdgeCases:
    """Test header construction edge cases."""

    def test_anthropic_headers_always_include_version(self):
        headers = _get_headers("anthropic", "")
        assert "anthropic-version" in headers

    def test_ollama_with_api_key(self):
        headers = _get_headers("ollama", "some-key")
        assert headers["authorization"] == "Bearer some-key"

    def test_custom_provider_with_key(self):
        headers = _get_headers("custom", "custom-key")
        assert headers["authorization"] == "Bearer custom-key"

    def test_all_providers_include_content_type(self):
        for provider in ("openai", "anthropic", "ollama", "custom"):
            headers = _get_headers(provider, "key")
            assert headers["content-type"] == "application/json"


class TestAgentEdgeCases:
    """Test agent loading edge cases."""

    def test_get_agent_with_empty_string(self):
        agent = get_agent("")
        assert agent is None

    def test_get_agent_with_path_traversal(self):
        agent = get_agent("../../../etc/passwd")
        assert agent is None

    def test_list_agents_returns_consistent_count(self):
        """Calling list_agents multiple times returns the same result."""
        first = list_agents()
        second = list_agents()
        assert len(first) == len(second)
        assert [a["id"] for a in first] == [a["id"] for a in second]

    def test_all_agents_have_category(self):
        for agent_meta in list_agents():
            assert "category" in agent_meta
            assert agent_meta["category"] in ("planning", "tracking", "reporting", "resources")
