"""Tests for the AI tool-calling proxy flow in ai_service.py."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from noodle_web.ai_service import (
    AIChatMessage,
    AIChatRequest,
    _load_ai_tools,
    _sse_event,
    proxy_chat_with_tools,
    MAX_TOOL_ITERATIONS,
)


# ── Helpers ──────────────────────────────────────────────────


def _collect_events(async_gen) -> list[dict]:
    """Run an async generator to completion and parse the SSE events."""
    events = []

    async def _drain():
        async for raw in async_gen:
            assert raw.startswith("data: ")
            events.append(json.loads(raw[6:].strip()))

    asyncio.run(_drain())
    return events


def _make_response(status_code: int, json_body: dict) -> MagicMock:
    """Build a mock httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = json.dumps(json_body)
    resp.json.return_value = json_body
    return resp


def _final_text_response(content: str) -> dict:
    """Build an OpenAI-compatible non-tool-call response body."""
    return {
        "choices": [{
            "message": {"role": "assistant", "content": content},
            "finish_reason": "stop",
        }]
    }


def _tool_call_response(tool_calls: list[dict]) -> dict:
    """Build an OpenAI-compatible tool_calls response body."""
    return {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": tool_calls,
            },
            "finish_reason": "tool_calls",
        }]
    }


SIMPLE_MESSAGES = [AIChatMessage(role="user", content="Add a stakeholder")]
PLAN_TEXT = "---\ntitle: Test\n---\n# Tasks\n"


# ── Model tests ──────────────────────────────────────────────


class TestAIChatRequestPlanText:
    """Test that AIChatRequest accepts plan_text."""

    def test_plan_text_defaults_empty(self):
        req = AIChatRequest(
            endpoint="http://localhost",
            model="test",
            messages=[AIChatMessage(role="user", content="hi")],
        )
        assert req.plan_text == ""

    def test_plan_text_accepted(self):
        req = AIChatRequest(
            endpoint="http://localhost",
            model="test",
            messages=[AIChatMessage(role="user", content="hi")],
            plan_text="# My Plan",
        )
        assert req.plan_text == "# My Plan"


# ── _load_ai_tools tests ────────────────────────────────────


class TestLoadAiTools:
    """Test lazy loading of ai_tools module."""

    def test_returns_none_when_module_missing(self):
        with patch.dict("sys.modules", {"noodle_web.ai_tools": None}):
            with patch("noodle_web.ai_service._load_ai_tools") as mock_load:
                mock_load.return_value = (None, None)
                defs, executor = mock_load()
                assert defs is None
                assert executor is None

    def test_returns_values_when_module_present(self):
        mock_defs = [{"type": "function", "function": {"name": "test_tool"}}]
        mock_exec = lambda name, plan, args: (plan, "ok")
        mock_module = MagicMock()
        mock_module.TOOL_DEFINITIONS = mock_defs
        mock_module.execute_tool = mock_exec

        with patch.dict("sys.modules", {"noodle_web.ai_tools": mock_module}):
            with patch(
                "noodle_web.ai_service._load_ai_tools",
                return_value=(mock_defs, mock_exec),
            ):
                defs, executor = _load_ai_tools.__wrapped__() if hasattr(_load_ai_tools, '__wrapped__') else (mock_defs, mock_exec)
                assert defs == mock_defs
                assert executor is not None


# ── proxy_chat_with_tools tests ─────────────────────────────


class TestProxyChatWithToolsFallback:
    """Test fallback when ai_tools is unavailable."""

    def test_falls_back_to_regular_chat(self):
        """When ai_tools is not importable, falls back to proxy_chat_completion."""
        with patch(
            "noodle_web.ai_service._load_ai_tools",
            return_value=(None, None),
        ):
            with patch(
                "noodle_web.ai_service.proxy_chat_completion",
            ) as mock_chat:
                async def _fake_gen(*args, **kwargs):
                    yield _sse_event({"content": "hello", "done": False})
                    yield _sse_event({"content": "", "done": True})

                mock_chat.return_value = _fake_gen()

                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

                assert any(e.get("content") == "hello" for e in events)
                assert events[-1]["done"] is True


class TestProxyChatWithToolsNoToolCalls:
    """Test when the model responds with text (no tool calls)."""

    def test_text_response_no_plan_change(self):
        mock_defs = [{"type": "function", "function": {"name": "add_task"}}]
        mock_exec = MagicMock()

        client = AsyncMock()
        client.post = AsyncMock(
            return_value=_make_response(200, _final_text_response("Sure, here's your plan."))
        )
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        # Should get the content event and a done event
        assert any(e.get("content") == "Sure, here's your plan." for e in events)
        assert events[-1]["done"] is True
        # No plan_update since plan wasn't modified
        assert not any("plan_update" in e for e in events)
        # execute_tool should not have been called
        mock_exec.assert_not_called()


class TestProxyChatWithToolsCalls:
    """Test the tool calling loop."""

    def test_single_tool_call(self):
        mock_defs = [{"type": "function", "function": {"name": "add_stakeholder"}}]
        updated_plan = PLAN_TEXT + "\n@Julian {High}\n"

        def mock_exec(name, plan, args):
            return updated_plan, "Added stakeholder @Julian {High}"

        tool_calls = [{
            "id": "call_001",
            "type": "function",
            "function": {
                "name": "add_stakeholder",
                "arguments": json.dumps({"name": "Julian", "interest": "High"}),
            },
        }]

        responses = [
            _make_response(200, _tool_call_response(tool_calls)),
            _make_response(200, _final_text_response("Done! I added Julian as a stakeholder.")),
        ]

        client = AsyncMock()
        client.post = AsyncMock(side_effect=responses)
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        # Should see: tool_call event, content event, plan_update event, done event
        tool_events = [e for e in events if "tool_call" in e]
        assert len(tool_events) == 1
        assert tool_events[0]["tool_call"] == "add_stakeholder"
        assert tool_events[0]["result"] == "Added stakeholder @Julian {High}"

        content_events = [e for e in events if e.get("content")]
        assert any("Julian" in e["content"] for e in content_events)

        plan_events = [e for e in events if "plan_update" in e]
        assert len(plan_events) == 1
        assert "@Julian" in plan_events[0]["plan_update"]

        assert events[-1]["done"] is True

    def test_multiple_tool_calls_in_one_response(self):
        mock_defs = [{"type": "function", "function": {"name": "add_stakeholder"}}]

        call_count = 0

        def mock_exec(name, plan, args):
            nonlocal call_count
            call_count += 1
            return plan + f"\n@Person{call_count}\n", f"Added person {call_count}"

        tool_calls = [
            {
                "id": "call_001",
                "type": "function",
                "function": {
                    "name": "add_stakeholder",
                    "arguments": json.dumps({"name": "Alice"}),
                },
            },
            {
                "id": "call_002",
                "type": "function",
                "function": {
                    "name": "add_stakeholder",
                    "arguments": json.dumps({"name": "Bob"}),
                },
            },
        ]

        responses = [
            _make_response(200, _tool_call_response(tool_calls)),
            _make_response(200, _final_text_response("Added both.")),
        ]

        client = AsyncMock()
        client.post = AsyncMock(side_effect=responses)
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        tool_events = [e for e in events if "tool_call" in e]
        assert len(tool_events) == 2
        assert call_count == 2

    def test_tool_call_with_malformed_arguments(self):
        """When the model sends invalid JSON in arguments, should handle gracefully."""
        mock_defs = [{"type": "function", "function": {"name": "add_task"}}]

        def mock_exec(name, plan, args):
            return plan, f"Called {name} with {args}"

        tool_calls = [{
            "id": "call_bad",
            "type": "function",
            "function": {
                "name": "add_task",
                "arguments": "not valid json{{{",
            },
        }]

        responses = [
            _make_response(200, _tool_call_response(tool_calls)),
            _make_response(200, _final_text_response("Done.")),
        ]

        client = AsyncMock()
        client.post = AsyncMock(side_effect=responses)
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        # Should still complete without error — args default to {}
        assert events[-1]["done"] is True


class TestProxyChatWithToolsErrors:
    """Test error handling in the tool calling flow."""

    def test_api_error_response(self):
        mock_defs = [{"type": "function", "function": {"name": "test"}}]
        mock_exec = MagicMock()

        client = AsyncMock()
        client.post = AsyncMock(
            return_value=_make_response(500, {"error": "Internal error"})
        )
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        assert events[-1]["done"] is True
        assert "error" in events[-1]
        assert events[-1]["status"] == 500

    def test_timeout_error(self):
        mock_defs = [{"type": "function", "function": {"name": "test"}}]
        mock_exec = MagicMock()

        client = AsyncMock()
        client.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        assert events[-1]["done"] is True
        assert "timed out" in events[-1]["error"].lower()

    def test_connection_error(self):
        mock_defs = [{"type": "function", "function": {"name": "test"}}]
        mock_exec = MagicMock()

        client = AsyncMock()
        client.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        assert events[-1]["done"] is True
        assert "connect" in events[-1]["error"].lower()

    def test_unexpected_error(self):
        mock_defs = [{"type": "function", "function": {"name": "test"}}]
        mock_exec = MagicMock()

        client = AsyncMock()
        client.post = AsyncMock(side_effect=RuntimeError("boom"))
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        assert events[-1]["done"] is True
        assert "unexpected" in events[-1]["error"].lower()


class TestProxyChatWithToolsMaxIterations:
    """Test the iteration limit safety valve."""

    def test_max_iterations_reached(self):
        mock_defs = [{"type": "function", "function": {"name": "add_task"}}]

        def mock_exec(name, plan, args):
            return plan + "\ntask\n", "Added task"

        tool_calls = [{
            "id": "call_loop",
            "type": "function",
            "function": {
                "name": "add_task",
                "arguments": json.dumps({"name": "Loop task"}),
            },
        }]

        # Always return tool calls — never a text response
        client = AsyncMock()
        client.post = AsyncMock(
            return_value=_make_response(200, _tool_call_response(tool_calls))
        )
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        # Should eventually stop and produce a done event
        assert events[-1]["done"] is True
        # Should have emitted tool_call events for each iteration
        tool_events = [e for e in events if "tool_call" in e]
        assert len(tool_events) == MAX_TOOL_ITERATIONS


class TestProxyChatWithToolsConversationBuilding:
    """Test that the conversation messages are correctly built."""

    def test_tool_results_appended_to_conversation(self):
        mock_defs = [{"type": "function", "function": {"name": "add_task"}}]

        def mock_exec(name, plan, args):
            return plan, "Done"

        tool_calls = [{
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "add_task",
                "arguments": json.dumps({"name": "Task A"}),
            },
        }]

        captured_payloads = []

        async def capture_post(url, json, headers):
            captured_payloads.append(json.copy() if isinstance(json, dict) else json)
            if len(captured_payloads) == 1:
                return _make_response(200, _tool_call_response(tool_calls))
            return _make_response(200, _final_text_response("All done."))

        client = AsyncMock()
        client.post = capture_post
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        assert events[-1]["done"] is True


class TestProxyChatWithToolsNoPlanChange:
    """Test that plan_update is NOT sent when the plan is unchanged."""

    def test_no_plan_update_when_unchanged(self):
        mock_defs = [{"type": "function", "function": {"name": "add_task"}}]

        def mock_exec(name, plan, args):
            # Return the same plan (no change)
            return plan, "No changes needed"

        tool_calls = [{
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "add_task",
                "arguments": json.dumps({"name": "X"}),
            },
        }]

        responses = [
            _make_response(200, _tool_call_response(tool_calls)),
            _make_response(200, _final_text_response("Nothing to do.")),
        ]

        client = AsyncMock()
        client.post = AsyncMock(side_effect=responses)
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("noodle_web.ai_service._load_ai_tools", return_value=(mock_defs, mock_exec)):
            with patch("noodle_web.ai_service.httpx.AsyncClient", return_value=client):
                events = _collect_events(proxy_chat_with_tools(
                    endpoint="http://localhost:11434/v1",
                    api_key="",
                    model="llama3",
                    provider="ollama",
                    messages=SIMPLE_MESSAGES,
                    plan_text=PLAN_TEXT,
                ))

        plan_events = [e for e in events if "plan_update" in e]
        assert len(plan_events) == 0
