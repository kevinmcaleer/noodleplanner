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
import re
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketDisconnect

from noodle_web import app
from noodle_web import collab_session
from noodle_web import security
from noodle_web.collab_session import SessionManager, collab_sessions

STATIC_DIR = Path(__file__).resolve().parents[1] / "packages/noodle-web/src/noodle_web/static"


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
        # #876: the joiner gets the real structured session-chat UI rather
        # than the old developer-facing arbitrary relay input.
        assert "Session chat" in response.text
        assert 'id="relayDownload"' in response.text
        assert "JSON.stringify(entry)" in response.text


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
            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                    joiner_ws.send_text(json.dumps({
                        "type": "join", "code": "000000", "display_name": "Eve",
                    }))
                    joiner_ws.receive_text()
            # #1057: collab_join.html surfaces this reason to the joiner
            # instead of always guessing "check the code" -- see that
            # template's close handler.
            assert exc_info.value.code == 4401
            assert exc_info.value.reason == "Incorrect or expired code."

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
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text("not json")
                joiner_ws.receive_text()
        assert exc_info.value.code == 4400
        assert exc_info.value.reason == "Malformed join request."


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
                host_ws.receive_text()  # presence update (#966)

                joiner_ws.send_text("hello from joiner")
                # #967: joiner->host frames arrive tagged with the sender's
                # id so the host can hold one session key per joiner. The
                # frame itself is passed through untouched.
                assert json.loads(host_ws.receive_text())["frame"] == "hello from joiner"

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
                host_ws.receive_text()  # presence update (#966)

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
                    host_ws.receive_text()  # presence update (#966)

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
            # A *failed* attempt is what consumes the budget. #971 changed
            # successful joins to be forgiven (see
            # security.forgive_join_attempt), so a correct code no longer
            # counts and cannot be used to exhaust the limit here.
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                ws.send_text(json.dumps({
                    "type": "join", "code": "000000", "display_name": "Eve",
                }))
                with pytest.raises(WebSocketDisconnect):
                    ws.receive_text()

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

    def test_successful_joins_do_not_exhaust_the_budget(self, client):
        """#971: #766 requires at least 10 concurrent joiners, but a team in
        one office shares a public IP. Counting correct codes against the
        anti-brute-force budget made that impossible -- the eleventh
        colleague was refused. Successful joins are now forgiven."""
        info = _start_session(client)
        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 2):
            for index in range(6):
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                    ws.send_text(json.dumps({
                        "type": "join", "code": info["join_code"], "display_name": f"Joiner {index}",
                    }))
                    ack = json.loads(ws.receive_text())
                    assert ack["type"] == "joined", f"joiner {index} was refused"

    def test_wrong_codes_still_exhaust_the_budget_end_to_end(self, client):
        """The other half of the same change: forgiving successes must not
        have weakened the protection against guessing the code."""
        info = _start_session(client)
        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 2):
            for _ in range(2):
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                    ws.send_text(json.dumps({
                        "type": "join", "code": "000000", "display_name": "Eve",
                    }))
                    with pytest.raises(WebSocketDisconnect):
                        ws.receive_text()

            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as ws:
                    ws.receive_text()
            assert exc_info.value.code == 4429

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


class TestPresence:
    """#966 acceptance: the host's presence panel shows who has joined and
    whether they're active, and the host can remove ("kick") a joiner."""

    def test_host_receives_presence_update_when_joiner_connects(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack

                presence = json.loads(host_ws.receive_text())
                assert presence["type"] == "presence"
                assert len(presence["joiners"]) == 1
                joiner = presence["joiners"][0]
                assert joiner["display_name"] == "Alice"
                assert joiner["active"] is True
                assert isinstance(joiner["id"], int)

    def test_host_receives_presence_update_for_each_joiner(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as j1, \
                 client.websocket_connect(f"/ws/session/{info['session_id']}") as j2:
                j1.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": "Alice"}))
                j1.receive_text()  # ack
                first = json.loads(host_ws.receive_text())
                assert [j["display_name"] for j in first["joiners"]] == ["Alice"]

                j2.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": "Bob"}))
                j2.receive_text()  # ack
                second = json.loads(host_ws.receive_text())
                assert sorted(j["display_name"] for j in second["joiners"]) == ["Alice", "Bob"]

    def test_host_receives_presence_update_when_joiner_disconnects(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                host_ws.receive_text()  # presence: Alice joined
                # Joiner drops here (network blip / tab closed).

            presence = json.loads(host_ws.receive_text())
            assert presence == {"type": "presence", "joiners": []}

    def test_joiner_is_active_after_activity_and_inactive_past_the_threshold(self, client, monkeypatch):
        """Active/inactive is a UX heuristic (collab_session.py's
        PRESENCE_ACTIVE_WINDOW_SECONDS), not a security boundary -- tested
        here with a threshold monkeypatched to a negative value so "past
        the threshold" is deterministic and instantaneous rather than a
        real wait."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                presence = json.loads(host_ws.receive_text())
                assert presence["joiners"][0]["active"] is True

                # The lightweight heartbeat (#966) counts as activity too,
                # not just real relayed content.
                joiner_ws.send_text(json.dumps({"type": "presence_ping"}))
                presence = json.loads(host_ws.receive_text())
                assert presence["joiners"][0]["active"] is True

                monkeypatch.setattr(collab_session, "PRESENCE_ACTIVE_WINDOW_SECONDS", -1)
                joiner_ws.send_text(json.dumps({"type": "presence_ping"}))
                presence = json.loads(host_ws.receive_text())
                assert presence["joiners"][0]["active"] is False

    def test_presence_ping_is_not_relayed_to_host_as_content(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                host_ws.receive_text()  # presence: Alice joined

                joiner_ws.send_text(json.dumps({"type": "presence_ping"}))
                # The only thing the host should see next is another
                # presence snapshot -- never the ping itself relayed as if
                # it were opaque joiner content.
                message = json.loads(host_ws.receive_text())
                assert message["type"] == "presence"

    def test_host_can_kick_a_joiner(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                joiner_ws.send_text(json.dumps({
                    "type": "join", "code": info["join_code"], "display_name": "Alice",
                }))
                joiner_ws.receive_text()  # ack
                presence = json.loads(host_ws.receive_text())
                joiner_id = presence["joiners"][0]["id"]

                host_ws.send_text(json.dumps({"type": "kick", "joiner_id": joiner_id}))

                with pytest.raises(WebSocketDisconnect) as exc_info:
                    joiner_ws.receive_text()
                assert exc_info.value.code == collab_session.CLOSE_KICKED
                assert exc_info.value.reason == collab_session.CLOSE_REASON_KICKED

                after_kick = json.loads(host_ws.receive_text())
                assert after_kick == {"type": "presence", "joiners": []}

            # The session itself survives -- only the kicked joiner's
            # connection was closed.
            assert collab_sessions.get_session(info["session_id"]) is not None

    def test_kicking_one_joiner_does_not_affect_others(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            with client.websocket_connect(f"/ws/session/{info['session_id']}") as j1, \
                 client.websocket_connect(f"/ws/session/{info['session_id']}") as j2:
                j1.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": "Alice"}))
                j1.receive_text()  # ack
                host_ws.receive_text()  # presence: Alice joined

                j2.send_text(json.dumps({"type": "join", "code": info["join_code"], "display_name": "Bob"}))
                j2.receive_text()  # ack
                presence = json.loads(host_ws.receive_text())  # presence: Alice + Bob
                alice_id = next(j["id"] for j in presence["joiners"] if j["display_name"] == "Alice")

                host_ws.send_text(json.dumps({"type": "kick", "joiner_id": alice_id}))

                with pytest.raises(WebSocketDisconnect) as exc_info:
                    j1.receive_text()
                assert exc_info.value.code == collab_session.CLOSE_KICKED

                after_kick = json.loads(host_ws.receive_text())
                assert [j["display_name"] for j in after_kick["joiners"]] == ["Bob"]

                # Bob's connection is completely unaffected by Alice's kick.
                host_ws.send_text("still here")
                assert j2.receive_text() == "still here"

    def test_kicking_an_already_gone_joiner_is_a_harmless_no_op(self, client):
        """A stale presence panel (the host clicks Remove on someone who
        already left) must not error or affect the session."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            host_ws.send_text(json.dumps({"type": "kick", "joiner_id": 999999}))
            # The session and host connection are unaffected.
            host_ws.send_text("still alive")
            assert collab_sessions.get_session(info["session_id"]) is not None


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
                    host_ws.receive_text()  # presence update (#966)

                    host_ws.send_text(secret_host_message)
                    assert joiner_ws.receive_text() == secret_host_message

                    joiner_ws.send_text(secret_joiner_message)
                    assert json.loads(host_ws.receive_text())["frame"] == secret_joiner_message

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

    def test_no_presence_or_kick_content_logged(self, client, caplog):
        """#966 extension of this class's acceptance criterion: presence
        broadcasts and kicks carry a display name and a joiner id over the
        wire (by design -- see SessionState.presence_snapshot()), but
        neither app.py's kick/presence plumbing nor
        SessionManager.kick_joiner() calls logger.* with any of it."""
        secret_display_name = "Presence Confidential Participant"

        with caplog.at_level(logging.DEBUG):
            info = _start_session(client)
            with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                    joiner_ws.send_text(json.dumps({
                        "type": "join", "code": info["join_code"], "display_name": secret_display_name,
                    }))
                    joiner_ws.receive_text()  # ack
                    presence = json.loads(host_ws.receive_text())
                    joiner_id = presence["joiners"][0]["id"]

                    joiner_ws.send_text(json.dumps({"type": "presence_ping"}))
                    host_ws.receive_text()  # presence update from the ping

                    host_ws.send_text(json.dumps({"type": "kick", "joiner_id": joiner_id}))
                    with pytest.raises(WebSocketDisconnect):
                        joiner_ws.receive_text()
                    host_ws.receive_text()  # presence update after the kick

        assert secret_display_name not in caplog.text
        assert info["session_id"] not in caplog.text


class TestPresenceStylesAreReachable:
    """#966's presence panel is styled by classes that collab-session.js sets
    at runtime. `static/style.css` is dead -- no template links it -- so rules
    parked there never reach the browser and the panel renders unstyled."""

    @staticmethod
    def _linked_stylesheets() -> set[str]:
        index = (STATIC_DIR.parent / "templates" / "index.html").read_text()
        return set(re.findall(r'href="/static/([^"?]+\.css)', index))

    def test_index_does_not_link_style_css(self):
        assert "style.css" not in self._linked_stylesheets()

    def test_presence_classes_are_defined_in_a_linked_stylesheet(self):
        js = (STATIC_DIR / "collab-session.js").read_text()
        used = set(re.findall(r"collab-presence-[a-z-]+", js))
        assert used, "expected collab-session.js to set presence classes"

        defined = set()
        for sheet in self._linked_stylesheets():
            path = STATIC_DIR / sheet
            if path.exists():
                defined |= set(re.findall(r"collab-presence-[a-z-]+", path.read_text()))

        assert not (used - defined), (
            f"presence classes used by collab-session.js but not defined in any "
            f"stylesheet index.html links: {sorted(used - defined)}"
        )

    def test_chat_panel_is_in_the_status_bar_and_its_styles_are_reachable(self):
        index = (STATIC_DIR.parent / "templates" / "index.html").read_text()
        chat_pos = index.index('id="collabChatWrap"')
        notification_pos = index.index('id="statusBarHistoryBtn"')
        assert chat_pos < notification_pos, "chat must appear left of the notification icon"

        js = (STATIC_DIR / "collab-session.js").read_text()
        used = set(re.findall(r"collab-chat-[a-z-]+", js + index))
        defined = set()
        for sheet in self._linked_stylesheets():
            path = STATIC_DIR / sheet
            if path.exists():
                defined |= set(re.findall(r"collab-chat-[a-z-]+", path.read_text()))
        assert not (used - defined), f"unreachable chat styles: {sorted(used - defined)}"


class TestMultiJoinerRouting:
    """#967: the relay tags joiner->host frames with a sender id and routes
    host->joiner frames at one joiner, so the host can hold a separate
    session key per joiner. It still never reads the frames themselves.

    Every test here drains the presence snapshot each join *and* each
    disconnect pushes to the host (see #966). Leaving one queued
    desynchronises every later `host_ws.receive_text()` on that socket,
    which surfaces as a hang rather than a failure.
    """

    @staticmethod
    def _join(client, info, host_ws, display_name):
        """Connect a joiner, drain its ack and the host's presence snapshot,
        and return `(socket, joiner_id)` -- the id the host addresses it by."""
        joiner_ws = client.websocket_connect(f"/ws/session/{info['session_id']}").__enter__()
        joiner_ws.send_text(json.dumps({
            "type": "join", "code": info["join_code"], "display_name": display_name,
        }))
        joiner_ws.receive_text()  # ack
        snapshot = json.loads(host_ws.receive_text())["joiners"]
        joiner_id = next(j["id"] for j in snapshot if j["display_name"] == display_name)
        return joiner_ws, joiner_id

    @staticmethod
    def _leave(joiner_ws, host_ws):
        """Close a joiner and drain the presence snapshot its departure pushes."""
        joiner_ws.__exit__(None, None, None)
        host_ws.receive_text()  # presence after the disconnect

    def test_joiner_frame_reaches_host_tagged_with_sender_id(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            joiner_ws, joiner_id = self._join(client, info, host_ws, "Alice")

            joiner_ws.send_text("opaque-ciphertext")
            wrapper = json.loads(host_ws.receive_text())

            assert wrapper["type"] == "from_joiner"
            assert wrapper["joiner_id"] == joiner_id
            assert wrapper["frame"] == "opaque-ciphertext"
            self._leave(joiner_ws, host_ws)

    def test_two_joiners_are_distinguishable_to_the_host(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            alice_ws, alice_id = self._join(client, info, host_ws, "Alice")
            bob_ws, bob_id = self._join(client, info, host_ws, "Bob")

            alice_ws.send_text("from-alice")
            first = json.loads(host_ws.receive_text())
            bob_ws.send_text("from-bob")
            second = json.loads(host_ws.receive_text())

            assert first["frame"] == "from-alice"
            assert second["frame"] == "from-bob"
            assert first["joiner_id"] == alice_id
            assert second["joiner_id"] == bob_id
            assert alice_id != bob_id, "each joiner needs its own key slot"

            self._leave(bob_ws, host_ws)
            self._leave(alice_ws, host_ws)

    def test_addressed_frame_reaches_only_its_target(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            alice_ws, _alice_id = self._join(client, info, host_ws, "Alice")
            bob_ws, bob_id = self._join(client, info, host_ws, "Bob")

            host_ws.send_text(json.dumps({
                "type": "to_joiner", "joiner_id": bob_id, "frame": "for-bob-only",
            }))
            assert bob_ws.receive_text() == "for-bob-only"

            # Alice must not have received it. Sending a broadcast next and
            # asserting it is the *first* thing Alice reads proves her socket
            # was live and simply skipped -- if the addressed frame had leaked
            # to her, this read would return it instead. Without this second
            # send, an addressed frame going nowhere at all would pass too.
            host_ws.send_text("broadcast-to-everyone")
            assert alice_ws.receive_text() == "broadcast-to-everyone"
            assert bob_ws.receive_text() == "broadcast-to-everyone"

            self._leave(bob_ws, host_ws)
            self._leave(alice_ws, host_ws)

    def test_addressed_frame_to_a_departed_joiner_is_dropped(self, client):
        """A joiner id must never be recycled onto a later joiner, or a frame
        addressed to someone who left lands on whoever inherited their id."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            alice_ws, alice_id = self._join(client, info, host_ws, "Alice")
            self._leave(alice_ws, host_ws)

            bob_ws, bob_id = self._join(client, info, host_ws, "Bob")
            assert bob_id != alice_id, "a departed joiner's id must not be reused"

            host_ws.send_text(json.dumps({
                "type": "to_joiner", "joiner_id": alice_id, "frame": "for-a-ghost",
            }))
            # Must not be misdelivered to whoever is still connected.
            host_ws.send_text("broadcast-to-everyone")
            assert bob_ws.receive_text() == "broadcast-to-everyone"

            self._leave(bob_ws, host_ws)

    def test_host_broadcast_still_reaches_every_joiner(self, client):
        """The pubkey announcement relies on the untagged broadcast path, so
        adding addressed delivery must not have replaced it."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            alice_ws, _alice_id = self._join(client, info, host_ws, "Alice")
            bob_ws, _bob_id = self._join(client, info, host_ws, "Bob")

            host_ws.send_text("everyone-gets-this")
            assert alice_ws.receive_text() == "everyone-gets-this"
            assert bob_ws.receive_text() == "everyone-gets-this"

            self._leave(bob_ws, host_ws)
            self._leave(alice_ws, host_ws)

    def test_routing_does_not_log_frame_contents(self, client, caplog):
        secret = "Routed Confidential Payload"
        with caplog.at_level(logging.DEBUG):
            info = _start_session(client)
            with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
                with client.websocket_connect(f"/ws/session/{info['session_id']}") as joiner_ws:
                    joiner_ws.send_text(json.dumps({
                        "type": "join", "code": info["join_code"], "display_name": "Alice",
                    }))
                    joiner_ws.receive_text()
                    joiner_id = json.loads(host_ws.receive_text())["joiners"][0]["id"]

                    joiner_ws.send_text(secret)
                    host_ws.receive_text()

                    host_ws.send_text(json.dumps({
                        "type": "to_joiner", "joiner_id": joiner_id, "frame": secret,
                    }))
                    joiner_ws.receive_text()

        assert secret not in caplog.text
        assert info["session_id"] not in caplog.text


class TestJoinerPrivilegeBoundary:
    """#971 security review: the host-only control messages must be exactly
    that.

    `end_session` (#965), `kick` (#966) and the `to_joiner` addressing
    envelope (#967) are all interpreted in `_relay_as_host`, which only runs
    on the host's socket -- a joiner's frames go through `_relay_as_joiner`,
    which relays them opaquely. These tests prove that boundary holds rather
    than inferring it from where the code happens to sit, because a joiner
    is an untrusted remote party who knows only a six-digit code, and the
    cost of getting this wrong is one of them ending everyone's session or
    removing a colleague.
    """

    @staticmethod
    def _join(client, info, host_ws, display_name):
        joiner_ws = client.websocket_connect(f"/ws/session/{info['session_id']}").__enter__()
        joiner_ws.send_text(json.dumps({
            "type": "join", "code": info["join_code"], "display_name": display_name,
        }))
        joiner_ws.receive_text()  # ack
        snapshot = json.loads(host_ws.receive_text())["joiners"]
        return joiner_ws, next(j["id"] for j in snapshot if j["display_name"] == display_name)

    def test_a_joiner_cannot_end_the_session(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            joiner_ws, _ = self._join(client, info, host_ws, "Mallory")

            joiner_ws.send_text(json.dumps({"type": "end_session"}))

            # Relayed to the host as ordinary opaque content, not acted on.
            wrapper = json.loads(host_ws.receive_text())
            assert wrapper["type"] == "from_joiner"
            assert json.loads(wrapper["frame"])["type"] == "end_session"

            # The session is still live and still relaying.
            assert collab_sessions.get_session(info["session_id"]) is not None
            host_ws.send_text("still-here")
            assert joiner_ws.receive_text() == "still-here"

            joiner_ws.__exit__(None, None, None)
            host_ws.receive_text()  # presence after the disconnect

    def test_a_joiner_cannot_kick_another_joiner(self, client):
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            alice_ws, alice_id = self._join(client, info, host_ws, "Alice")
            mallory_ws, _ = self._join(client, info, host_ws, "Mallory")

            mallory_ws.send_text(json.dumps({"type": "kick", "joiner_id": alice_id}))
            host_ws.receive_text()  # relayed as opaque content only

            # Alice is untouched: still in the session and still receiving.
            assert len(collab_sessions.get_session(info["session_id"]).joiners) == 2
            host_ws.send_text("alice-is-still-here")
            assert alice_ws.receive_text() == "alice-is-still-here"
            assert mallory_ws.receive_text() == "alice-is-still-here"

            mallory_ws.__exit__(None, None, None)
            host_ws.receive_text()
            alice_ws.__exit__(None, None, None)
            host_ws.receive_text()

    def test_a_joiner_cannot_address_a_frame_at_another_joiner(self, client):
        """#967's `to_joiner` envelope is a host privilege. A joiner sending
        one must not become a way to speak to another joiner directly --
        that would bypass the host entirely, and the host is the only party
        the security model gives that reach."""
        info = _start_session(client)
        with client.websocket_connect(f"/ws/session/{info['session_id']}?token={info['host_token']}") as host_ws:
            alice_ws, alice_id = self._join(client, info, host_ws, "Alice")
            mallory_ws, _ = self._join(client, info, host_ws, "Mallory")

            mallory_ws.send_text(json.dumps({
                "type": "to_joiner", "joiner_id": alice_id, "frame": "direct-to-alice",
            }))
            # It reached the host as content, wrapped like anything else.
            wrapper = json.loads(host_ws.receive_text())
            assert wrapper["type"] == "from_joiner"
            assert "direct-to-alice" in wrapper["frame"]

            # Alice never got it: a host broadcast is the first thing she
            # reads, which it could not be if the forged frame had arrived.
            host_ws.send_text("from-the-host")
            assert alice_ws.receive_text() == "from-the-host"
            assert mallory_ws.receive_text() == "from-the-host"

            mallory_ws.__exit__(None, None, None)
            host_ws.receive_text()
            alice_ws.__exit__(None, None, None)
            host_ws.receive_text()
