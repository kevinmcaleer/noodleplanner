"""Tests for the #963 WebSocket relay foundation (collab planning sessions).

Covers: session creation shape, the host/joiner handshake protocol, opaque
message relay in both directions, host-disconnect teardown, idle expiry,
and -- the acceptance criterion taken most seriously here -- that no
session or message content ever appears in the application log output.
"""

import asyncio
import json
import logging
import os
import subprocess
import sys
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketDisconnect

from noodle_web import app
from noodle_web import collab_session
from noodle_web import security
from noodle_web.collab_session import SessionManager, collab_sessions


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_collab_sessions():
    """Give every test a clean, empty session registry.

    Also resets the #965 join-attempt rate limit store: TestClient gives
    every WebSocket connection the same fixed client IP ("testclient"), so
    without this reset, join attempts made by earlier tests in this file
    would count against later ones and could trip the limiter spuriously.
    """
    collab_sessions._sessions.clear()
    collab_sessions._codes.clear()
    security.reset_join_rate_limit_store()
    yield
    collab_sessions._sessions.clear()
    collab_sessions._codes.clear()
    security.reset_join_rate_limit_store()


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
        # #964 (post-security-review): holding_url carries the
        # handshake_secret as a URL *fragment* -- never sent to any server
        # in any request, which is precisely what makes it safe to embed
        # here. See collab_session.py's module docstring.
        assert info["handshake_secret"]
        assert info["holding_url"] == f"/join/{info['session_id']}#k={info['handshake_secret']}"

    def test_handshake_secret_is_high_entropy_and_not_the_join_code(self, client):
        """#964 security-review regression guard: the two secrets must
        never be conflated again -- this asserts they're structurally
        distinct (a 6-digit code vs. a long random token), not just
        different by chance."""
        info = _start_session(client)
        assert info["handshake_secret"] != info["join_code"]
        assert len(info["handshake_secret"]) >= 32
        assert not info["handshake_secret"].isdigit()

    def test_handshake_secrets_are_unique_across_sessions(self, client):
        secrets_seen = {_start_session(client)["handshake_secret"] for _ in range(10)}
        assert len(secrets_seen) == 10

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
                host_ws.receive_text()  # #966 presence_join notification

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

                # The host's disconnect should close the joiner's socket too,
                # with a close reason (#965) the joiner's UI can use to
                # explain what happened rather than an unexplained drop --
                # distinct from CLOSE_HOST_ENDED (explicit end_session,
                # tested below), since this path is an unplanned disconnect
                # (crash/closed laptop/network drop, all indistinguishable
                # server-side).
                with pytest.raises(WebSocketDisconnect) as exc_info:
                    joiner_ws.receive_text()
                assert exc_info.value.code == collab_session.CLOSE_HOST_DISCONNECTED
                assert exc_info.value.reason == collab_session.CLOSE_REASON_HOST_DISCONNECTED

        assert collab_sessions.get_session(info["session_id"]) is None
        assert info["session_id"] not in collab_sessions._sessions

    def test_idle_session_expires(self, client, monkeypatch):
        info = _start_session(client)
        assert collab_sessions.get_session(info["session_id"]) is not None

        monkeypatch.setattr(collab_session, "IDLE_TIMEOUT_SECONDS", -1)
        assert collab_sessions.get_session(info["session_id"]) is None

    def test_idle_timeout_is_configurable_via_env_var(self):
        """#965: IDLE_TIMEOUT_SECONDS must be tunable, following this
        codebase's os.getenv-with-default convention (see security.py's
        RATE_LIMIT_REQUESTS/RATE_LIMIT_WINDOW for the same pattern). The
        constant is only computed once, at import time, in the module
        every other test in this file already shares -- so this proves the
        env var actually drives it via a subprocess import, rather than
        reloading (and thereby replacing, out from under the rest of this
        file's already-bound references) the shared `collab_session`/
        `collab_sessions` objects every other test in this module relies on.
        """
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from noodle_web import collab_session; print(collab_session.IDLE_TIMEOUT_SECONDS)",
            ],
            env={**os.environ, "COLLAB_IDLE_TIMEOUT_SECONDS": "5"},
            capture_output=True,
            text=True,
            check=True,
        )
        assert result.stdout.strip() == "5"

    def test_sweep_idle_removes_expired_sessions(self, monkeypatch):
        manager = SessionManager()
        manager.create_session()
        monkeypatch.setattr(collab_session, "IDLE_TIMEOUT_SECONDS", -1)
        asyncio.run(manager.sweep_idle())
        assert manager.active_session_count() == 0

    def test_sweep_idle_closes_sockets_with_timeout_reason(self, client, monkeypatch):
        """The background sweep (distinct from the lazy get_session() check
        above) is what actually closes lingering sockets for a session
        nobody ever touches again -- confirm it uses the idle-timeout close
        reason, not a silent/unexplained close."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                host_ws.receive_text()  # #966 presence_join notification

                monkeypatch.setattr(collab_session, "IDLE_TIMEOUT_SECONDS", -1)
                asyncio.run(collab_sessions.sweep_idle())

                with pytest.raises(WebSocketDisconnect) as exc_info:
                    joiner_ws.receive_text()
                assert exc_info.value.code == collab_session.CLOSE_IDLE_TIMEOUT
                assert exc_info.value.reason == collab_session.CLOSE_REASON_IDLE_TIMEOUT

                with pytest.raises(WebSocketDisconnect):
                    host_ws.receive_text()

    def test_host_can_explicitly_end_session(self, client):
        """#965 acceptance: host can explicitly end a session, closing all
        sockets. Chosen as a WebSocket message (not a new HTTP endpoint)
        since the host already has a live relay connection open -- see
        _is_end_session_message()'s docstring in app.py."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as j1, \
                 client.websocket_connect(f"/ws/session/{info['session_id']}") as j2:
                for j, name in ((j1, "Alice"), (j2, "Bob")):
                    j.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": name}))
                    j.receive_text()  # ack
                    host_ws.receive_text()  # #966 presence_join notification

                host_ws.send_text(json.dumps({"type": "end_session"}))

                for j in (j1, j2):
                    with pytest.raises(WebSocketDisconnect) as exc_info:
                        j.receive_text()
                    assert exc_info.value.code == collab_session.CLOSE_HOST_ENDED
                    assert exc_info.value.reason == collab_session.CLOSE_REASON_HOST_ENDED

                with pytest.raises(WebSocketDisconnect) as exc_info:
                    host_ws.receive_text()
                assert exc_info.value.code == collab_session.CLOSE_HOST_ENDED

        assert collab_sessions.get_session(info["session_id"]) is None
        assert info["session_id"] not in collab_sessions._sessions

    def test_end_session_message_is_not_relayed_to_joiners_as_content(self, client):
        """The {"type": "end_session"} control message is intercepted by
        the relay -- it must never reach a joiner as if it were opaque
        relayed content."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack

                host_ws.send_text(json.dumps({"type": "end_session"}))

                # The only thing the joiner should ever see next is the
                # close frame -- never a relayed copy of the control message.
                with pytest.raises(WebSocketDisconnect):
                    joiner_ws.receive_text()


class TestJoinerRejoin:
    def test_dropped_joiner_socket_is_removed_no_zombie_entry(self, client):
        """#965 acceptance: a joiner whose socket errors/closes is removed
        from SessionState.joiners -- no zombie entries left behind."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}"):
            state = collab_sessions.get_session(info["session_id"])
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                assert len(state.joiners) == 1

            # The joiner's `with` block has exited (socket closed) -- give
            # the server-side handler's finally block a chance to run.
            import time

            for _ in range(50):
                if len(state.joiners) == 0:
                    break
                time.sleep(0.02)
            assert len(state.joiners) == 0

    def test_dropped_joiner_can_immediately_rejoin_same_session(self, client):
        """#965 acceptance: a dropped joiner can rejoin and resync to the
        current (still-live) session -- since #963/#964 only built the
        relay/encryption layer with no plan-editing protocol yet (#967),
        "resync" here means: the rejoin is admitted cleanly and the host's
        cached pubkey announcement (#964) is replayed, same as a fresh
        joiner connecting after the host already broadcast it."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            host_ws.send_text(json.dumps({"type": "host_pubkey", "k": "fake-pubkey-bytes"}))

            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                # First connection drops here (network blip) without an
                # explicit leave -- just exiting the `with` block.

            # Session must still be live -- a joiner dropping must not end
            # the session (only the host can, per #965).
            assert collab_sessions.get_session(info["session_id"]) is not None

            with client.websocket_connect(f"/ws/session/{info['session_id']}") as rejoin_ws:
                rejoin_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                ack = json.loads(rejoin_ws.receive_text())
                assert ack == {"type": "joined", "display_name": "Alice"}

                cached = json.loads(rejoin_ws.receive_text())
                assert cached == {"type": "host_pubkey", "k": "fake-pubkey-bytes"}

                # The relay still works normally after the rejoin.
                host_ws.send_text("hello again")
                assert rejoin_ws.receive_text() == "hello again"


class TestJoinAttemptRateLimiting:
    """#965 acceptance: join attempts are rate limited. Direct unit
    coverage of the underlying algorithm lives in
    tests/test_security.py's TestJoinRateLimiting; this covers the same
    behavior end-to-end through the real WebSocket endpoint (TestClient
    gives every connection the same client IP, "testclient", which is what
    makes this reproducible without any header spoofing)."""

    def test_excessive_join_attempts_from_same_ip_are_rejected(self, client):
        info = _start_session(client)
        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 3):
            for _ in range(3):
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                    ws.send_text(json.dumps({
                        "type": "join", "code": "000000", "display_name": "Eve",
                    }))
                    # Wrong code -> rejected, but the *attempt* still counts
                    # against the budget regardless of outcome.
                    with pytest.raises(WebSocketDisconnect):
                        ws.receive_text()

            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                    ws.receive_text()
            assert exc_info.value.code == 4429

    def test_join_attempts_allowed_again_after_window_passes(self, client):
        info = _start_session(client)
        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 1):
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                ws.receive_text()  # ack -- this one attempt consumes the budget

            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                    ws.receive_text()
            assert exc_info.value.code == 4429

            # Backdate the one recorded attempt to simulate the window
            # having passed, rather than sleeping in the test.
            import time

            security._join_rate_limit_store["testclient"] = [time.time() - 61]

            with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Bob",
                }))
                ack = json.loads(ws.receive_text())
                assert ack == {"type": "joined", "display_name": "Bob"}

    def test_join_rate_limit_does_not_affect_the_host_connection(self, client):
        """The host connects with `?token=...`; that branch never calls
        is_join_rate_limited() -- exhausting the join budget must not lock
        the host out of their own session."""
        info = _start_session(client)
        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 1):
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                ws.send_text(json.dumps({
                    "type": "join", "code": "000000", "display_name": "Eve",
                }))
                with pytest.raises(WebSocketDisconnect):
                    ws.receive_text()

            # Budget is now exhausted for this IP, but the host still
            # connects fine.
            with client.websocket_connect(
                f"/ws/session/{info['session_id']}?token={info['host_token']}"
            ):
                pass


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
                    presence_join_msg = host_ws.receive_text()  # #966 presence_join notification
                    assert display_name in presence_join_msg  # the display name IS meant to reach the host

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

    def test_no_presence_content_in_logs(self, client, caplog):
        """#966's join/leave/heartbeat/kick control messages are new
        surface area added to the relay -- the same log-leak discipline
        the rest of this class holds the original relay to applies here."""
        info = _start_session(client)
        secret_display_name = "Confidential Stakeholder Name"

        with caplog.at_level(logging.DEBUG):
            with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                    joiner_ws.send_text(json.dumps({
                        "type": "join", "code": info["join_code"], "display_name": secret_display_name,
                    }))
                    joiner_ws.receive_text()  # ack
                    joined = json.loads(host_ws.receive_text())

                    joiner_ws.send_text(json.dumps({"type": "heartbeat"}))
                    host_ws.receive_text()  # presence_heartbeat

                    host_ws.send_text(json.dumps({"type": "kick", "joiner_id": joined["joiner_id"]}))
                    with pytest.raises(WebSocketDisconnect):
                        joiner_ws.receive_text()
                    host_ws.receive_text()  # presence_leave

        assert secret_display_name not in caplog.text
        assert joined["joiner_id"] not in caplog.text


class TestPresence:
    """#966: the host presence panel -- join/leave notifications, the
    heartbeat/active-inactive plumbing, and host-initiated kick."""

    def test_host_is_notified_when_a_joiner_joins(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack

                notification = json.loads(host_ws.receive_text())
                assert notification["type"] == "presence_join"
                assert notification["display_name"] == "Alice"
                assert isinstance(notification["joiner_id"], str) and notification["joiner_id"]

    def test_each_joiner_gets_a_distinct_joiner_id(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as j1, \
                 client.websocket_connect(f"/ws/session/{info['session_id']}") as j2:
                for j, name in ((j1, "Alice"), (j2, "Bob")):
                    j.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": name}))
                    j.receive_text()  # ack

                first = json.loads(host_ws.receive_text())
                second = json.loads(host_ws.receive_text())
                assert first["joiner_id"] != second["joiner_id"]

    def test_host_is_notified_when_a_joiner_disconnects(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                joined = json.loads(host_ws.receive_text())

            left = json.loads(host_ws.receive_text())
            assert left == {"type": "presence_leave", "joiner_id": joined["joiner_id"]}

    def test_a_reattaching_host_gets_a_presence_snapshot_of_existing_joiners(self, client):
        """A page reload mid-session attaches a brand-new host socket that
        missed every presence_join fired to the old one -- it must be
        caught up, the same way a late joiner is caught up on host_pubkey."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                host_ws.receive_text()  # presence_join on the original host socket

                # Reattach as host (e.g. a page reload) while the joiner is
                # still connected.
                with client.websocket_connect(
                    f"/ws/session/{info['session_id']}?token={info['host_token']}"
                ) as new_host_ws:
                    snapshot = json.loads(new_host_ws.receive_text())
                    assert snapshot == {"type": "presence_join", "joiner_id": snapshot["joiner_id"], "display_name": "Alice"}

    def test_heartbeat_is_not_relayed_as_content_but_notifies_host(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                joined = json.loads(host_ws.receive_text())

                joiner_ws.send_text(json.dumps({"type": "heartbeat"}))

                notification = json.loads(host_ws.receive_text())
                assert notification == {"type": "presence_heartbeat", "joiner_id": joined["joiner_id"]}

    def test_heartbeat_updates_joiner_active_state(self, client, monkeypatch):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}"):
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack

                state = collab_sessions.get_session(info["session_id"])
                joiner = next(iter(state.joiners.values()))
                assert joiner.is_active()

                # Simulate the active window elapsing with no traffic.
                monkeypatch.setattr(collab_session, "JOINER_ACTIVE_WINDOW_SECONDS", -1)
                assert not joiner.is_active()

                monkeypatch.undo()
                joiner_ws.send_text(json.dumps({"type": "heartbeat"}))
                assert joiner.is_active()

    def test_host_can_kick_a_joiner(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                joined = json.loads(host_ws.receive_text())

                host_ws.send_text(json.dumps({"type": "kick", "joiner_id": joined["joiner_id"]}))

                with pytest.raises(WebSocketDisconnect) as exc_info:
                    joiner_ws.receive_text()
                assert exc_info.value.code == collab_session.CLOSE_KICKED
                assert exc_info.value.reason == collab_session.CLOSE_REASON_KICKED

                # The finally block's own remove_joiner() call must not
                # crash on an already-removed joiner, and the leave
                # notification still fires so the panel updates.
                left = json.loads(host_ws.receive_text())
                assert left == {"type": "presence_leave", "joiner_id": joined["joiner_id"]}

    def test_kicked_joiner_is_actually_removed_from_the_session(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                joined = json.loads(host_ws.receive_text())

                host_ws.send_text(json.dumps({"type": "kick", "joiner_id": joined["joiner_id"]}))
                with pytest.raises(WebSocketDisconnect):
                    joiner_ws.receive_text()
                host_ws.receive_text()  # presence_leave

                state = collab_sessions.get_session(info["session_id"])
                assert state.joiners == {}

    def test_kick_with_unknown_joiner_id_is_a_harmless_no_op(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                host_ws.receive_text()  # presence_join

                host_ws.send_text(json.dumps({"type": "kick", "joiner_id": "not-a-real-id"}))

                # The real joiner is unaffected -- still connected, and the
                # kick control message must never reach them as content.
                host_ws.send_text("still alive")
                assert joiner_ws.receive_text() == "still alive"

    def test_kicking_one_joiner_does_not_affect_another(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as j1, \
                 client.websocket_connect(f"/ws/session/{info['session_id']}") as j2:
                j1.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": "Alice"}))
                j1.receive_text()  # ack
                alice = json.loads(host_ws.receive_text())

                j2.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": "Bob"}))
                j2.receive_text()  # ack
                host_ws.receive_text()  # Bob's presence_join

                host_ws.send_text(json.dumps({"type": "kick", "joiner_id": alice["joiner_id"]}))
                with pytest.raises(WebSocketDisconnect):
                    j1.receive_text()
                host_ws.receive_text()  # Alice's presence_leave

                host_ws.send_text("hello Bob")
                assert j2.receive_text() == "hello Bob"

    def test_presence_and_heartbeat_messages_never_reach_a_joiner(self, client):
        """These are host-only control messages -- a joiner (in particular,
        one other than the one being talked about) must never see any of
        them arrive over their own socket."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as j1, \
                 client.websocket_connect(f"/ws/session/{info['session_id']}") as j2:
                j1.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": "Alice"}))
                j1.receive_text()  # ack
                alice = json.loads(host_ws.receive_text())

                j2.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": "Bob"}))
                j2.receive_text()  # ack
                host_ws.receive_text()  # Bob's presence_join

                j1.send_text(json.dumps({"type": "heartbeat"}))
                host_ws.receive_text()  # presence_heartbeat, consumed by the host only

                host_ws.send_text(json.dumps({"type": "kick", "joiner_id": alice["joiner_id"]}))
                with pytest.raises(WebSocketDisconnect):
                    j1.receive_text()
                host_ws.receive_text()  # presence_leave

                # Bob must have received nothing at all from any of this.
                host_ws.send_text("only for bob")
                assert j2.receive_text() == "only for bob"
