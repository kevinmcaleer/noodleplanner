"""The streaming AI proxy and connection test, driven through a mock transport.

``proxy_chat_completion`` is the generator behind ``/api/ai/chat``. Its happy
path, every provider's framing, and each failure branch were uncovered: the
existing AI tests stop at payload and header building. Here ``httpx`` is
swapped for a shim whose ``AsyncClient`` is wired to ``httpx.MockTransport``,
so the exact upstream bytes are under test control.
"""

import json

import httpx
import pytest

from noodle_web import ai_service
from noodle_web.ai_service import AIChatMessage, proxy_chat_completion
# Aliased: a module-level name starting with ``test_`` would be collected as a test.
from noodle_web.ai_service import test_connection as check_connection


class _HttpxShim:
    """Stand-in for the ``httpx`` module: same exception classes, mocked client."""

    TimeoutException = httpx.TimeoutException
    ConnectError = httpx.ConnectError

    def __init__(self, handler):
        self._handler = handler
        self.requests = []

    def AsyncClient(self, **kwargs):
        def _handler(request):
            self.requests.append(request)
            return self._handler(request)

        return httpx.AsyncClient(transport=httpx.MockTransport(_handler), **kwargs)


@pytest.fixture
def upstream(monkeypatch):
    """Install a shim; the test sets ``upstream.handler`` before calling."""
    holder = {}

    def handler(request):
        return holder["handler"](request)

    shim = _HttpxShim(handler)
    monkeypatch.setattr(ai_service, "httpx", shim)

    class _Ctl:
        requests = shim.requests

        def respond(self, fn):
            holder["handler"] = fn

    return _Ctl()


def _events(lines):
    """Parse the SSE strings the proxy yields back into dicts."""
    out = []
    for chunk in lines:
        assert chunk.startswith("data: ") and chunk.endswith("\n\n")
        out.append(json.loads(chunk[6:].strip()))
    return out


async def _collect(**kw):
    args = dict(endpoint="https://api.example.test", api_key="k", model="m",
                messages=[AIChatMessage(role="user", content="hi")], provider="openai")
    args.update(kw)
    return _events([e async for e in proxy_chat_completion(**args)])


MESSAGES = [AIChatMessage(role="user", content="hi")]


class TestProxyChatCompletionOpenAI:
    @pytest.mark.anyio
    async def test_streams_tokens_then_done(self, upstream):
        body = (
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n'
            '\n'
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n'
            'data: {"choices":[{"delta":{}}]}\n'
            'data: not json\n'
            ': a comment\n'
            'data: [DONE]\n'
            'data: {"choices":[{"delta":{"content":"ignored"}}]}\n'
        )
        upstream.respond(lambda req: httpx.Response(200, content=body.encode()))

        events = await _collect()
        assert events == [
            {"content": "Hel", "done": False},
            {"content": "lo", "done": False},
            {"content": "", "done": True},
        ]
        req = upstream.requests[0]
        assert req.url == "https://api.example.test/chat/completions"
        assert req.headers["authorization"] == "Bearer k"
        assert json.loads(req.content)["stream"] is True

    @pytest.mark.anyio
    async def test_stream_without_done_marker_still_terminates(self, upstream):
        upstream.respond(lambda req: httpx.Response(
            200, content=b'data: {"choices":[{"delta":{"content":"x"}}]}\n'))
        events = await _collect()
        assert events[-1] == {"content": "", "done": True}
        assert [e["content"] for e in events[:-1]] == ["x"]

    @pytest.mark.anyio
    async def test_upstream_error_status_is_reported_once(self, upstream):
        upstream.respond(lambda req: httpx.Response(429, content=b'{"error":"slow down"}'))
        events = await _collect()
        assert events == [{"error": '{"error":"slow down"}', "status": 429, "done": True}]

    @pytest.mark.anyio
    async def test_timeout(self, upstream):
        def boom(req):
            raise httpx.ReadTimeout("slow", request=req)

        upstream.respond(boom)
        assert await _collect() == [{"error": "Request timed out.", "done": True}]

    @pytest.mark.anyio
    async def test_connect_error(self, upstream):
        def boom(req):
            raise httpx.ConnectError("refused", request=req)

        upstream.respond(boom)
        assert await _collect() == [{"error": "Could not connect to the AI endpoint.", "done": True}]

    @pytest.mark.anyio
    async def test_unexpected_error_is_masked(self, upstream):
        def boom(req):
            raise RuntimeError("internal detail that must not leak")

        upstream.respond(boom)
        events = await _collect()
        assert events == [{"error": "Unexpected error during chat.", "done": True}]


class TestProxyChatCompletionAnthropic:
    @pytest.mark.anyio
    async def test_event_framing_and_message_stop(self, upstream):
        body = (
            'event: message_start\n'
            'data: {"type":"message_start"}\n'
            '\n'
            'event: content_block_delta\n'
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n'
            '\n'
            'event: ping\n'
            ': keepalive\n'
            'event: content_block_delta\n'
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n'
            'event: message_stop\n'
            'data: {"type":"message_stop"}\n'
            'data: {"type":"content_block_delta","delta":{"text":"after stop"}}\n'
        )
        upstream.respond(lambda req: httpx.Response(200, content=body.encode()))

        events = await _collect(provider="anthropic")
        assert events == [
            {"content": "Hi", "done": False},
            {"content": " there", "done": False},
            {"content": "", "done": True},
        ]
        req = upstream.requests[0]
        assert req.url == "https://api.example.test/messages"
        assert req.headers["x-api-key"] == "k"
        assert "anthropic-version" in req.headers

    @pytest.mark.anyio
    async def test_raw_json_lines_without_data_prefix(self, upstream):
        body = (
            '{"type":"content_block_delta","delta":{"text":"raw"}}\n'
            '{broken json\n'
            '{"type":"message_delta"}\n'
        )
        upstream.respond(lambda req: httpx.Response(200, content=body.encode()))
        events = await _collect(provider="anthropic")
        assert events == [{"content": "raw", "done": False}, {"content": "", "done": True}]


class TestConnectionCheck:
    @pytest.mark.anyio
    async def test_success_sends_non_streaming_probe(self, upstream):
        upstream.respond(lambda req: httpx.Response(200, json={"ok": True}))
        result = await check_connection("https://api.example.test", "k", "m", provider="openai")
        assert result == {"success": True, "message": "Connection successful."}
        payload = json.loads(upstream.requests[0].content)
        assert payload["stream"] is False
        assert payload["max_tokens"] == 10

    @pytest.mark.anyio
    async def test_anthropic_probe_uses_messages_endpoint(self, upstream):
        upstream.respond(lambda req: httpx.Response(200, json={}))
        result = await check_connection("https://api.example.test/", "k", "m", provider="anthropic")
        assert result["success"] is True
        assert upstream.requests[0].url == "https://api.example.test/messages"
        assert json.loads(upstream.requests[0].content)["stream"] is False

    @pytest.mark.anyio
    @pytest.mark.parametrize("status, message", [
        (401, "Authentication failed. Check your API key."),
        (403, "Authentication failed. Check your API key."),
        (429, "Rate limited. Try again later."),
        (500, "Provider returned status 500."),
        (404, "Provider returned status 404."),
    ])
    async def test_status_mapping(self, upstream, status, message):
        upstream.respond(lambda req: httpx.Response(status))
        assert await check_connection("https://x.test", "k", "m") == {"success": False, "message": message}

    @pytest.mark.anyio
    async def test_connect_timeout_and_unexpected(self, upstream):
        def refused(req):
            raise httpx.ConnectError("refused", request=req)

        upstream.respond(refused)
        assert (await check_connection("https://x.test", "k", "m"))["message"] == "Could not connect to the endpoint."

        def slow(req):
            raise httpx.ConnectTimeout("slow", request=req)

        upstream.respond(slow)
        assert (await check_connection("https://x.test", "k", "m"))["message"] == "Connection timed out."

        def weird(req):
            raise ValueError("nope")

        upstream.respond(weird)
        assert (await check_connection("https://x.test", "k", "m"))["message"] == "Unexpected error testing connection."
