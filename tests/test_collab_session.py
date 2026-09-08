"""Tests for the #963 WebSocket relay foundation (collab planning sessions).

Covers: session creation shape, the host/joiner handshake protocol, opaque
message relay in both directions, host-disconnect teardown, idle expiry,
and -- the acceptance criterion taken most seriously here -- that no
session or message content ever appears in the application log output.
"""

import asyncio
import json
import logging

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketDisconnect

from noodle_web import app
from noodle_web import collab_session
from noodle_web.collab_session import SessionManager, collab_sessions


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_collab_sessions():
    """Give every test a clean, empty session registry."""
    collab_sessions._sessions.clear()
    collab_sessions._codes.clear()
    yield
    collab_sessions._sessions.clear()
    collab_sessions._codes.clear()


def _start_session(client) -> dict:
    response = client.post("/api/collab/start")
    assert response.status_code == 200
    return response.json()


class TestSessionCreation:
    def test_create_session_returns_id_code_and_holding_url(self, client):
        info = _start_session(client)
        assert info["session_id"]
        assert info["host_token"]
        assert info["join_code"]
        assert len(info["join_code"]) == 6
        assert info["join_code"].isdigit()
        assert info["holding_url"] == f"/join/{info['session_id']}"

    def test_session_ids_are_unguessable(self, client):
        """Not a proof of unguessability, but a floor: long, random, and
        distinct across creations -- not sequential or predictable."""
        ids = {_start_session(client)["session_id"] for _ in range(20)}
        assert len(ids) == 20
        for session_id in ids:
            assert len(session_id) >= 32

    def test_join_codes_are_six_digit_numeric_and_unique(self, client):
        codes = {_start_session(client)["join_code"] for _ in range(10)}
        assert len(codes) == 10
        for code in codes:
            assert len(code) == 6 and code.isdigit()

    def test_join_page_is_served(self, client):
        info = _start_session(client)
        response = client.get(info["holding_url"])
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert info["session_id"] in response.text


class TestHostConnection:
    def test_host_connects_with_valid_token(self, client):
        info = _start_session(client)
        with client.websocket_connect(
            f"/ws/session/{info['session_id']}?token={info['host_token']}"
        ):
            pass  # connecting and cleanly exiting is the assertion

    def test_host_connect_with_wrong_token_is_rejected(self, client):
        info = _start_session(client)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                f"/ws/session/{info['session_id']}?token=not-the-real-token"
            ) as ws:
                ws.receive_text()

    def test_host_connect_to_unknown_session_is_rejected(self, client):
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/ws/session/does-not-exist?token=whatever"
            ) as ws:
                ws.receive_text()


class TestJoinerFlow:
    def test_joiner_joins_with_correct_code(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}"):
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                ack = json.loads(joiner_ws.receive_text())
                assert ack == {"type": "joined", "display_name": "Alice"}

    def test_join_with_wrong_code_fails(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}"):
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                    joiner_ws.send_text(json.dumps({
                        "type": "join", "code": "000000", "display_name": "Eve",
                    }))
                    joiner_ws.receive_text()

    def test_join_with_expired_code_fails(self, client, monkeypatch):
        info = _start_session(client)
        monkeypatch.setattr(collab_session, "IDLE_TIMEOUT_SECONDS", -1)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()

    def test_join_with_missing_display_name_fails(self, client):
        info = _start_session(client)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({"type": "join", "code": info["join_code"]}))
                joiner_ws.receive_text()

    def test_join_with_malformed_first_message_fails(self, client):
        info = _start_session(client)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text("not json")
                joiner_ws.receive_text()


class TestRelay:
    def test_message_from_host_reaches_joiner(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack

                host_ws.send_text("hello from host")
                assert joiner_ws.receive_text() == "hello from host"

    def test_message_from_joiner_reaches_host(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack

                joiner_ws.send_text("hello from joiner")
                assert host_ws.receive_text() == "hello from joiner"

    def test_message_is_relayed_to_multiple_joiners(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as j1, \
                 client.websocket_connect(f"/ws/session/{info['session_id']}") as j2:
                for j, name in ((j1, "Alice"), (j2, "Bob")):
                    j.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": name}))
                    j.receive_text()  # ack

                host_ws.send_text("broadcast")
                assert j1.receive_text() == "broadcast"
                assert j2.receive_text() == "broadcast"

    def test_payload_is_treated_as_opaque_blob(self, client):
        """The relay never parses message content -- non-JSON text passes
        through unchanged, same as any other payload."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack

                blob = "not-json-and-not-plan-syntax {{{ ###"
                host_ws.send_text(blob)
                assert joiner_ws.receive_text() == blob


class TestLifecycle:
    def test_host_disconnect_tears_down_session(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack

                host_ws.close()

                # The host's disconnect should close the joiner's socket too.
                with pytest.raises(WebSocketDisconnect):
                    joiner_ws.receive_text()

        assert collab_sessions.get_session(info["session_id"]) is None
        assert info["session_id"] not in collab_sessions._sessions

    def test_idle_session_expires(self, client, monkeypatch):
        info = _start_session(client)
        assert collab_sessions.get_session(info["session_id"]) is not None

        monkeypatch.setattr(collab_session, "IDLE_TIMEOUT_SECONDS", -1)
        assert collab_sessions.get_session(info["session_id"]) is None

    def test_sweep_idle_removes_expired_sessions(self, monkeypatch):
        manager = SessionManager()
        manager.create_session()
        monkeypatch.setattr(collab_session, "IDLE_TIMEOUT_SECONDS", -1)
        asyncio.run(manager.sweep_idle())
        assert manager.active_session_count() == 0


class TestNoContentLeaks:
    """The acceptance criterion this repo takes most seriously: nothing
    session- or message-related ever reaches the application log."""

    def test_no_session_or_message_content_in_logs(self, client, caplog):
        secret_host_message = "CONFIDENTIAL: Q3 milestone slips to March, do not share externally"
        secret_joiner_message = "joiner reply: budget overrun risk is RED, owner is Priya"
        display_name = "Priya Confidential Stakeholder"

        with caplog.at_level(logging.DEBUG):
            info = _start_session(client)

            with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                    joiner_ws.send_text(json.dumps({
                        "type": "join", "code": info["join_code"], "display_name": display_name,
                    }))
                    joiner_ws.receive_text()  # ack

                    host_ws.send_text(secret_host_message)
                    assert joiner_ws.receive_text() == secret_host_message

                    joiner_ws.send_text(secret_joiner_message)
                    assert host_ws.receive_text() == secret_joiner_message

                host_ws.close()

            # Give the sweep/teardown a beat; not strictly required since
            # teardown is awaited inline in the ws handler, but keeps this
            # robust to future timing changes.
            collab_sessions.get_session(info["session_id"])

        log_text = caplog.text
        assert secret_host_message not in log_text
        assert secret_joiner_message not in log_text
        assert display_name not in log_text
        assert info["session_id"] not in log_text
        assert info["join_code"] not in log_text
        assert info["host_token"] not in log_text

    def test_no_content_logged_when_join_fails(self, client, caplog):
        info = _start_session(client)
        secret_display_name = "Secret Name That Should Not Leak"

        with caplog.at_level(logging.DEBUG):
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                    joiner_ws.send_text(json.dumps({
                        "type": "join", "code": "999999", "display_name": secret_display_name,
                    }))
                    joiner_ws.receive_text()

        assert secret_display_name not in caplog.text
