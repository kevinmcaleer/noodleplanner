"""Tests for #964: end-to-end encryption of collab-session traffic over the
#963 WebSocket relay.

The most important test here (``test_relay_only_ever_sees_ciphertext``)
matches the issue's own acceptance criterion: it drives a full session
lifecycle -- host start, the host's ECDH public-key handshake
announcement, a joiner joining and completing the handshake, then
realistic-looking "plan content" encrypted and sent over the exact same
opaque relay #963 already ships -- and captures every raw frame the relay
actually sends/receives (not the client-side plaintext) to assert the
original plan text's substring never appears in any of it.

Post-security-review update: two HIGH-severity findings came back against
the first cut of this PR --

1. (sev 9) the ECDH handshake was authenticated with `join_code`, which the
   relay legitimately learns (to do #963's admission check), so the relay
   itself could recompute the same MAC and transparently MITM the
   "encrypted" channel. Fixed by introducing `handshake_secret`, a second,
   separate, high-entropy secret generated in `collab_session.py` and
   delivered ONLY via the `holding_url`'s URL fragment (never sent to any
   server on any request) -- see that module's and collab-crypto.js's
   module docstrings. `join_code` is now purely a server-side admission
   gate with zero cryptographic role.
   `TestRelayCannotForgeHandshake` below is the regression test for this
   finding specifically.
2. (sev 8) unrecognized/spoofed frames were displayed as if they were
   genuine peer content. Fixed client-side (collab-crypto.js's
   `classifyFrameType`, exercised in tests/test_collab_crypto.mjs) -- not
   re-tested here since it's pure client-side display logic with no
   server-observable behaviour.

Every `Party.create(...)` call below now uses a `handshake_secret`-shaped
value (never `join_code`), matching what the real host/joiner clients
actually do post-fix.

Both simulated "clients" in this file are driven by
tests/helpers/collab_crypto_stub.py, a Python port (via the `cryptography`
library) of the real browser implementation in
packages/noodle-web/src/noodle_web/static/collab-crypto.js -- see that
module's docstring for the full parameter list (KDF, key exchange, AEAD,
wire format) and tests/test_collab_crypto.mjs for the genuine proof that
the actual JS the browser runs implements the same scheme correctly. This
file is a server-side test: it proves the *relay* never sees anything but
opaque bytes, not that the browser crypto works (that's the .mjs test's
job).
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from noodle_web import app
from noodle_web import security
from noodle_web.collab_session import collab_sessions
from tests.helpers.collab_crypto_stub import Party, decrypt_message, encrypt_message


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_collab_sessions():
    """See test_collab_session.py's identical fixture docstring for why the
    #965 join-attempt rate limit store is reset here too -- TestClient gives
    every WebSocket connection the same client IP."""
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


class TestRelayOnlySeesCiphertext:
    def test_relay_only_ever_sees_ciphertext(self, client):
        """Full session lifecycle with realistic plan content, asserting
        the plaintext substring never appears in any frame the relay
        actually handled."""
        info = _start_session(client)
        session_id, join_code = info["session_id"], info["join_code"]
        handshake_secret = info["handshake_secret"]

        secret_from_host = (
            "Sprint 14: migrate billing to Stripe. Owner: Dana Okafor. "
            "Due 2026-10-03. Budget risk: RED, overrun est. $42,000."
        )
        secret_from_joiner = (
            "Confirmed with legal: the Stripe migration needs a DPA "
            "addendum before go-live, blocking task PROJ-118."
        )

        # Every raw string that actually crosses the WebSocket boundary in
        # either direction -- i.e. exactly what the relay sees/relays.
        relayed_frames: list[str] = []

        def send_and_capture(ws, text):
            relayed_frames.append(text)
            ws.send_text(text)

        def recv_and_capture(ws):
            text = ws.receive_text()
            relayed_frames.append(text)
            return text

        with client.websocket_connect(
            f"/ws/session/{session_id}?token={info['host_token']}"
        ) as host_ws:
            # #964 post-security-review: authenticated with handshake_secret,
            # NOT join_code -- see this file's module docstring.
            host = Party.create(handshake_secret, session_id)
            send_and_capture(host_ws, host.build_announcement("host_pubkey"))

            with client.websocket_connect(f"/ws/session/{session_id}") as joiner_ws:
                joiner = Party.create(handshake_secret, session_id)

                send_and_capture(
                    joiner_ws,
                    json.dumps({"type": "join", "code": join_code, "display_name": "Alice"}),
                )
                ack = recv_and_capture(joiner_ws)
                assert json.loads(ack) == {"type": "joined", "display_name": "Alice"}

                # The cached host_pubkey announcement, forwarded on admission.
                host_pubkey_msg = recv_and_capture(joiner_ws)
                host_pubkey_b64 = joiner.parse_announcement("host_pubkey", host_pubkey_msg)
                assert host_pubkey_b64 is not None, "joiner should verify the host's real announcement"
                joiner_session_key = joiner.derive_session_key(host_pubkey_b64, session_id)

                # #966: admitting this joiner also pushed the host a
                # presence update -- not part of the encrypted content
                # scheme this test is about, so drain it (uncaptured; it's
                # plaintext by design, see collab-crypto.js's
                # KNOWN_FRAME_TYPES comment) before the real joiner_pubkey
                # announcement below.
                host_ws.receive_text()

                send_and_capture(joiner_ws, joiner.build_announcement("joiner_pubkey"))
                joiner_pubkey_msg = recv_and_capture(host_ws)
                joiner_pubkey_b64 = host.parse_announcement("joiner_pubkey", joiner_pubkey_msg)
                assert joiner_pubkey_b64 is not None
                host_session_key = host.derive_session_key(joiner_pubkey_b64, session_id)

                assert host_session_key == joiner_session_key, "both sides must agree on the session key"

                # Host -> joiner: realistic plan content, encrypted.
                envelope = encrypt_message(host_session_key, secret_from_host, session_id)
                send_and_capture(host_ws, envelope)
                received = recv_and_capture(joiner_ws)
                assert received == envelope
                assert decrypt_message(joiner_session_key, received, session_id) == secret_from_host

                # Joiner -> host: realistic plan content, encrypted.
                envelope2 = encrypt_message(joiner_session_key, secret_from_joiner, session_id)
                send_and_capture(joiner_ws, envelope2)
                received2 = recv_and_capture(host_ws)
                assert received2 == envelope2
                assert decrypt_message(host_session_key, received2, session_id) == secret_from_joiner

        # -- the actual acceptance assertion --
        full_capture = "\n".join(relayed_frames)
        assert secret_from_host not in full_capture
        assert secret_from_joiner not in full_capture
        # #964 post-security-review: handshake_secret must never cross the
        # relay on any frame either -- it only ever travels via the
        # holding_url's URL fragment / the /api/collab/start HTTP response,
        # never over this WebSocket.
        assert handshake_secret not in full_capture
        # Spot-check a few distinctive substrings too, in case the whole
        # message happened to get chunked oddly.
        for fragment in ("Dana Okafor", "$42,000", "PROJ-118", "DPA addendum"):
            assert fragment not in full_capture

        # Every content-bearing frame we captured must actually look like
        # our AES-GCM envelope (base64 iv/ct), i.e. genuine ciphertext --
        # not a coincidental absence of the plaintext due to some other bug.
        # Each of the 2 content messages was captured twice (once on send,
        # once on receipt) by send_and_capture/recv_and_capture above.
        enc_frames = [f for f in relayed_frames if '"type": "enc"' in f or '"type":"enc"' in f]
        assert len(enc_frames) == 4
        for frame in enc_frames:
            parsed = json.loads(frame)
            assert parsed["type"] == "enc"
            assert isinstance(parsed["iv"], str) and parsed["iv"]
            assert isinstance(parsed["ct"], str) and parsed["ct"]


class TestPlanOpTrafficNeverLeaks:
    """#967 added a `plan_op`/`plan_snapshot` JSON shape *inside* the
    plaintext this scheme encrypts (see
    static/collab-plan-ops.js's module docstring for the wire format) --
    no new WebSocket frame type, no relay change. This is the thin,
    #967-specific extension of `TestRelayOnlySeesCiphertext` above: same
    "capture every raw frame the relay actually handled and assert the
    plaintext never appears in it" shape, just with a realistic plan_op /
    plan_snapshot payload instead of an arbitrary string, since that's what
    real #967 traffic actually looks like. The relay itself needed zero
    code changes for #967 (it was never taught to parse `enc` payloads
    before this and still isn't) -- this test is here to prove that stays
    true for the new payload shape, not because the relay's own logic
    changed."""

    def test_plan_op_and_plan_snapshot_payloads_never_appear_in_relayed_frames(self, client):
        info = _start_session(client)
        session_id, join_code = info["session_id"], info["join_code"]
        handshake_secret = info["handshake_secret"]

        plan_op = json.dumps({
            "kind": "plan_op",
            "op_id": "abc123",
            "op": "set_progress",
            "actor": "Priya Sharma",
            "task": {"name": "Negotiate the Chennai vendor contract", "level": 2},
            "value": 65,
        })
        plan_snapshot = json.dumps({
            "kind": "plan_snapshot",
            "tasks": [
                {"name": "Negotiate the Chennai vendor contract", "level": 2, "indent": 2, "percent": 65, "is_summary": False},
            ],
            "conflict": {
                "task": {"name": "Negotiate the Chennai vendor contract", "level": 2},
                "previous_actor": "Dev Patel",
                "actor": "Priya Sharma",
                "message": "Priya Sharma also edited this -- showing the latest version.",
            },
        })

        relayed_frames: list[str] = []

        def send_and_capture(ws, text):
            relayed_frames.append(text)
            ws.send_text(text)

        def recv_and_capture(ws):
            text = ws.receive_text()
            relayed_frames.append(text)
            return text

        with client.websocket_connect(f"/ws/session/{session_id}?token={info['host_token']}") as host_ws:
            host = Party.create(handshake_secret, session_id)
            send_and_capture(host_ws, host.build_announcement("host_pubkey"))

            with client.websocket_connect(f"/ws/session/{session_id}") as joiner_ws:
                joiner = Party.create(handshake_secret, session_id)
                send_and_capture(
                    joiner_ws, json.dumps({"type": "join", "code": join_code, "display_name": "Priya"})
                )
                recv_and_capture(joiner_ws)  # joined ack
                host_pubkey_msg = recv_and_capture(joiner_ws)
                host_pubkey_b64 = joiner.parse_announcement("host_pubkey", host_pubkey_msg)
                joiner_session_key = joiner.derive_session_key(host_pubkey_b64, session_id)

                host_ws.receive_text()  # #966 presence push, not this test's concern
                send_and_capture(joiner_ws, joiner.build_announcement("joiner_pubkey"))
                joiner_pubkey_msg = recv_and_capture(host_ws)
                joiner_pubkey_b64 = host.parse_announcement("joiner_pubkey", joiner_pubkey_msg)
                host_session_key = host.derive_session_key(joiner_pubkey_b64, session_id)

                # Joiner -> host: a plan_op edit intent.
                op_envelope = encrypt_message(joiner_session_key, plan_op, session_id)
                send_and_capture(joiner_ws, op_envelope)
                received_op = recv_and_capture(host_ws)
                assert decrypt_message(host_session_key, received_op, session_id) == plan_op

                # Host -> joiner: the resulting plan_snapshot broadcast.
                snapshot_envelope = encrypt_message(host_session_key, plan_snapshot, session_id)
                send_and_capture(host_ws, snapshot_envelope)
                received_snapshot = recv_and_capture(joiner_ws)
                assert decrypt_message(joiner_session_key, received_snapshot, session_id) == plan_snapshot

        full_capture = "\n".join(relayed_frames)
        for fragment in (
            "Negotiate the Chennai vendor contract",
            "Priya Sharma",
            "Dev Patel",
            "also edited this",
            "set_progress",
            "plan_op",
            "plan_snapshot",
        ):
            assert fragment not in full_capture
        assert handshake_secret not in full_capture


class TestWrongSecretCannotEstablishSession:
    def test_wrong_handshake_secret_fails_to_verify_handshake(self, client):
        """An attacker (or a client with a corrupted/incomplete link)
        cannot produce a MAC the honest side will accept, so no session key
        is ever derived with them -- the critical negative test the issue
        calls out."""
        info = _start_session(client)
        session_id, real_secret = info["session_id"], info["handshake_secret"]

        host = Party.create(real_secret, session_id)
        announcement = host.build_announcement("host_pubkey")

        wrong_secret = "totally-different-guess-0000000000"
        attacker = Party.create(wrong_secret, session_id)

        assert attacker.parse_announcement("host_pubkey", announcement) is None

    def test_wrong_secret_produces_undecryptable_traffic(self, client):
        """Even if an attacker somehow obtained a valid-looking session key
        for the wrong parameters, AES-GCM's auth tag rejects it."""
        info = _start_session(client)
        session_id, real_secret = info["session_id"], info["handshake_secret"]

        host = Party.create(real_secret, session_id)
        joiner = Party.create(real_secret, session_id)
        real_key = host.derive_session_key(joiner.public_key_raw_b64(), session_id)

        wrong_key = bytes((b ^ 0xFF) for b in real_key)  # definitely not the real key
        envelope = encrypt_message(real_key, "top secret plan content", session_id)

        with pytest.raises(Exception):
            decrypt_message(wrong_key, envelope, session_id)


class TestRelayCannotForgeHandshake:
    """Regression tests for security-review Finding 1 (severity 9): the
    relay legitimately learns `join_code` and already knows `session_id`
    (it generated it) -- i.e. it has exactly what a party admitted via
    #963's join flow has. If the ECDH handshake were authenticated with
    `join_code` (the original, vulnerable design), the relay could
    recompute the same connect key itself, forge valid-looking MAC'd
    `host_pubkey`/`joiner_pubkey` announcements to both sides, and
    transparently MITM the entire "encrypted" session -- establishing
    separate session keys with the host and the joiner and silently
    decrypting/re-forwarding everything. These tests drive that exact
    attack shape and assert it fails now that `handshake_secret` (never
    sent to any server on any request) is what actually authenticates the
    handshake instead."""

    def test_relay_who_knows_join_code_and_session_id_cannot_forge_handshake(self, client):
        info = _start_session(client)
        session_id = info["session_id"]
        join_code = info["join_code"]  # what the relay legitimately has
        handshake_secret = info["handshake_secret"]  # what the relay never sees

        # The legitimate host authenticates its announcement with the real
        # handshake secret, exactly as static/collab-session.js now does.
        host = Party.create(handshake_secret, session_id)
        host_announcement = host.build_announcement("host_pubkey")

        # "The relay" (or anyone else who only has what the relay has)
        # tries to forge a matching handshake using join_code instead.
        relay_attacker = Party.create(join_code, session_id)

        # It cannot verify the real host's genuine announcement...
        assert relay_attacker.parse_announcement("host_pubkey", host_announcement) is None

        # ...and a real joiner (correctly using handshake_secret) must
        # reject an announcement the relay forged from join_code alone.
        forged_announcement = relay_attacker.build_announcement("host_pubkey")
        real_joiner = Party.create(handshake_secret, session_id)
        assert real_joiner.parse_announcement("host_pubkey", forged_announcement) is None

    def test_relay_cannot_mitm_a_full_session_end_to_end(self, client):
        """The full MITM shape from Finding 1: the relay tries to establish
        SEPARATE session keys with the host and the joiner (as a real MITM
        would need to, to decrypt and re-forward traffic in both
        directions) using only join_code + session_id. Neither leg of that
        MITM attempt can complete."""
        info = _start_session(client)
        session_id = info["session_id"]
        join_code = info["join_code"]
        handshake_secret = info["handshake_secret"]

        host = Party.create(handshake_secret, session_id)
        joiner = Party.create(handshake_secret, session_id)
        relay = Party.create(join_code, session_id)  # the attacker

        host_announcement = host.build_announcement("host_pubkey")
        joiner_announcement = joiner.build_announcement("joiner_pubkey")

        # The relay's MITM leg toward the joiner (impersonating the host):
        # it can't verify the real host's announcement to know what to
        # relay, and if it just forges its own "host_pubkey" instead, the
        # real joiner won't accept it either.
        assert relay.parse_announcement("host_pubkey", host_announcement) is None
        relay_forged_host_announcement = relay.build_announcement("host_pubkey")
        assert joiner.parse_announcement("host_pubkey", relay_forged_host_announcement) is None

        # The relay's MITM leg toward the host (impersonating the joiner):
        # symmetric failure.
        assert relay.parse_announcement("joiner_pubkey", joiner_announcement) is None
        relay_forged_joiner_announcement = relay.build_announcement("joiner_pubkey")
        assert host.parse_announcement("joiner_pubkey", relay_forged_joiner_announcement) is None

        # Meanwhile the real host and joiner, talking directly, succeed --
        # proving the failures above are specifically about the relay's
        # forgery attempt, not a broken handshake in general.
        real_host_pubkey = joiner.parse_announcement("host_pubkey", host_announcement)
        real_joiner_pubkey = host.parse_announcement("joiner_pubkey", joiner_announcement)
        assert real_host_pubkey is not None
        assert real_joiner_pubkey is not None
        assert host.derive_session_key(real_joiner_pubkey, session_id) == joiner.derive_session_key(
            real_host_pubkey, session_id
        )


class TestHostPubkeyCaching:
    def test_late_joiner_still_receives_host_pubkey(self, client):
        """A joiner who connects after the host already broadcast its
        pubkey announcement (with nobody around to receive that broadcast)
        must still get it -- via SessionState.host_public_key_msg, cached
        by app.py's _maybe_cache_host_pubkey and replayed on admission."""
        info = _start_session(client)
        session_id, join_code = info["session_id"], info["join_code"]
        handshake_secret = info["handshake_secret"]

        with client.websocket_connect(
            f"/ws/session/{session_id}?token={info['host_token']}"
        ) as host_ws:
            host = Party.create(handshake_secret, session_id)
            announcement = host.build_announcement("host_pubkey")
            host_ws.send_text(announcement)

            # No joiner was connected to receive that broadcast. A joiner
            # connects only now, well after the fact.
            with client.websocket_connect(f"/ws/session/{session_id}") as joiner_ws:
                joiner_ws.send_text(
                    json.dumps({"type": "join", "code": join_code, "display_name": "Bob"})
                )
                joiner_ws.receive_text()  # joined ack

                cached = joiner_ws.receive_text()
                assert cached == announcement

    def test_relay_does_not_cache_non_pubkey_messages(self, client):
        """Sanity check that _maybe_cache_host_pubkey really only reacts to
        {"type": "host_pubkey"} and ignores everything else (in particular,
        encrypted content envelopes)."""
        info = _start_session(client)
        session_id, join_code = info["session_id"], info["join_code"]

        with client.websocket_connect(
            f"/ws/session/{session_id}?token={info['host_token']}"
        ) as host_ws:
            host_ws.send_text(json.dumps({"type": "enc", "iv": "abc", "ct": "def"}))

            with client.websocket_connect(f"/ws/session/{session_id}") as joiner_ws:
                joiner_ws.send_text(
                    json.dumps({"type": "join", "code": join_code, "display_name": "Carol"})
                )
                ack = json.loads(joiner_ws.receive_text())
                assert ack == {"type": "joined", "display_name": "Carol"}
                # No cached host_pubkey message follows -- the next thing
                # the host sends should be the very next new message, not
                # a replay of the earlier "enc" message (which was never a
                # pubkey announcement, so was never cached).
                host_ws.send_text("next")
                assert joiner_ws.receive_text() == "next"
