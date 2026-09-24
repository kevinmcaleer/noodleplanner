"""Load test for the collab relay (#971, closing out the #766 epic).

#766's acceptance list ends with "Load-tested with at least 10 concurrent
joiners", and #967's with "an edit by any participant appears for all others
in under a second on a LAN". Both are claims about a *room full of people*,
so this drives a real uvicorn server over real WebSockets rather than the
in-process TestClient.

That choice is deliberate, not incidental. Starlette's ``TestClient`` runs
each WebSocket through its own blocking portal, and a socket whose only
pending frame is addressed solely to it does not reliably get pumped -- the
read blocks forever even though the server sent successfully. That is a
harness artifact rather than a relay defect (see
tests/test_collab_session.py's ``TestMultiJoinerRouting`` docstring), but it
makes TestClient structurally unable to answer the question this issue asks.
A real server and a real client can.

These tests are slower than the rest of the suite because they bind a port
and start a server. They stay proportionate: one server per test, a fixed
small number of joiners, and no sleeps beyond what the assertions need.
"""

from __future__ import annotations

import asyncio
import contextlib
import functools
import json
import socket
import time

import pytest
import websockets

from noodle_web import app as fastapi_app

# #766 asks for "at least 10"; 12 clears the bar without making the test
# slow enough that people start skipping it.
JOINER_COUNT = 12

# #766: "in under a second on a LAN". Loopback is faster than a LAN, so this
# is a generous ceiling -- it is here to catch an ordering-of-magnitude
# regression (a fan-out that became quadratic, say), not to measure latency.
BROADCAST_DEADLINE_SECONDS = 1.0


def sync(async_test):
    """Run an async test body without pulling in pytest-asyncio.

    Each test gets its own fresh event loop, which also guarantees no state
    leaks between them -- these tests bind real ports and start real
    servers, so isolation matters more here than usual.
    """
    @functools.wraps(async_test)
    def wrapper(*args, **kwargs):
        return asyncio.run(async_test(*args, **kwargs))

    return wrapper


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextlib.asynccontextmanager
async def _running_server():
    """Start the real app on a free port for the duration of one test."""
    import uvicorn

    port = _free_port()
    config = uvicorn.Config(
        fastapi_app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"
    )
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("uvicorn did not start in time")
            await asyncio.sleep(0.02)
        yield f"127.0.0.1:{port}"
    finally:
        server.should_exit = True
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(task, timeout=10)


async def _start_session(base: str) -> dict:
    import httpx

    async with httpx.AsyncClient(base_url=f"http://{base}") as client:
        response = await client.post("/api/collab/start")
        assert response.status_code == 200
        return response.json()


async def _join(base: str, info: dict, name: str):
    """Connect one joiner and complete the #963 admission handshake."""
    socket_ = await websockets.connect(f"ws://{base}/ws/join")
    await socket_.send(json.dumps({
        "type": "join", "code": info["join_code"], "display_name": name,
    }))
    ack = json.loads(await socket_.recv())
    assert ack["type"] == "joined", ack
    return socket_


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    """#965 rate-limits join attempts per IP, and every joiner here shares
    127.0.0.1 -- without this the twelfth joiner is rejected for doing
    exactly what the test exists to prove is fine."""
    from noodle_web import security

    security.reset_join_rate_limit_store()
    yield
    security.reset_join_rate_limit_store()


@sync
async def test_relay_supports_twelve_concurrent_joiners():
    """#766: 'Load-tested with at least 10 concurrent joiners.'"""
    async with _running_server() as base:
        info = await _start_session(base)
        host = await websockets.connect(
            f"ws://{base}/ws/session/{info['session_id']}?token={info['host_token']}"
        )
        joiners = []
        try:
            for index in range(JOINER_COUNT):
                joiners.append(await _join(base, info, f"Joiner {index}"))
                # Each admission pushes the host a presence snapshot (#966).
                snapshot = json.loads(await host.recv())
                assert snapshot["type"] == "presence"

            # All twelve are present at once -- the point of the test.
            assert len(snapshot["joiners"]) == JOINER_COUNT
            assert len({j["id"] for j in snapshot["joiners"]}) == JOINER_COUNT, (
                "every joiner needs a distinct id, or the host cannot hold a "
                "separate session key per joiner (#967)"
            )

            # One broadcast must reach every one of them, promptly.
            started = time.monotonic()
            await host.send("plan-snapshot-for-everyone")
            received = await asyncio.gather(*(j.recv() for j in joiners))
            elapsed = time.monotonic() - started

            assert received == ["plan-snapshot-for-everyone"] * JOINER_COUNT
            assert elapsed < BROADCAST_DEADLINE_SECONDS, (
                f"fan-out to {JOINER_COUNT} joiners took {elapsed:.3f}s"
            )
        finally:
            await asyncio.gather(*(j.close() for j in joiners), return_exceptions=True)
            await host.close()


@sync
async def test_every_joiner_can_edit_at_once_and_none_is_lost():
    """#766: 'an edit by any participant appears for all others'. Twelve
    joiners send simultaneously; the host must receive all twelve, each
    correctly attributed, with nothing dropped or merged."""
    async with _running_server() as base:
        info = await _start_session(base)
        host = await websockets.connect(
            f"ws://{base}/ws/session/{info['session_id']}?token={info['host_token']}"
        )
        joiners = []
        try:
            ids = []
            for index in range(JOINER_COUNT):
                joiners.append(await _join(base, info, f"Joiner {index}"))
                snapshot = json.loads(await host.recv())
            ids = [j["id"] for j in snapshot["joiners"]]

            started = time.monotonic()
            await asyncio.gather(*(
                joiner.send(f"edit-from-{index}") for index, joiner in enumerate(joiners)
            ))
            frames = [json.loads(await host.recv()) for _ in range(JOINER_COUNT)]
            elapsed = time.monotonic() - started

            assert elapsed < BROADCAST_DEADLINE_SECONDS

            # Nothing lost: every joiner's edit arrived exactly once.
            assert sorted(f["frame"] for f in frames) == sorted(
                f"edit-from-{i}" for i in range(JOINER_COUNT)
            )
            # And each is attributed to a real, distinct sender (#967's
            # from_joiner tagging is what lets the host keep per-joiner keys).
            senders = [f["joiner_id"] for f in frames]
            assert len(set(senders)) == JOINER_COUNT
            assert set(senders) <= set(ids)
        finally:
            await asyncio.gather(*(j.close() for j in joiners), return_exceptions=True)
            await host.close()


@sync
async def test_host_addressed_frames_reach_only_their_target_under_load():
    """#967's per-joiner encryption relies on addressed delivery. With a
    dozen sockets open, a frame for one joiner must not leak to the other
    eleven -- otherwise the host would be handing ciphertext to people whose
    key cannot read it, and leaking who is talking to whom."""
    async with _running_server() as base:
        info = await _start_session(base)
        host = await websockets.connect(
            f"ws://{base}/ws/session/{info['session_id']}?token={info['host_token']}"
        )
        joiners = []
        try:
            for index in range(JOINER_COUNT):
                joiners.append(await _join(base, info, f"Joiner {index}"))
                snapshot = json.loads(await host.recv())
            ids = [j["id"] for j in snapshot["joiners"]]

            target_index = 7
            await host.send(json.dumps({
                "type": "to_joiner", "joiner_id": ids[target_index], "frame": "for-one-only",
            }))
            assert await joiners[target_index].recv() == "for-one-only"

            # A broadcast afterwards proves the others were live and simply
            # skipped: without it, an addressed frame going nowhere at all
            # would pass this test too.
            await host.send("broadcast")
            others = [j for i, j in enumerate(joiners) if i != target_index]
            assert await asyncio.gather(*(j.recv() for j in others)) == ["broadcast"] * (JOINER_COUNT - 1)
        finally:
            await asyncio.gather(*(j.close() for j in joiners), return_exceptions=True)
            await host.close()


@sync
async def test_session_holds_no_plan_content_after_it_ends():
    """#766: 'Server holds no plan content after the session ends -- verified
    by a test that inspects process state.' Checked here under load, with
    twelve joiners' traffic having passed through the relay."""
    from noodle_web.collab_session import collab_sessions

    secret = "Migrate billing to Stripe, owner Dana, budget 42000"
    async with _running_server() as base:
        info = await _start_session(base)
        session_id = info["session_id"]
        host = await websockets.connect(
            f"ws://{base}/ws/session/{session_id}?token={info['host_token']}"
        )
        joiners = []
        for index in range(JOINER_COUNT):
            joiners.append(await _join(base, info, f"Joiner {index}"))
            await host.recv()

        await asyncio.gather(*(j.send(secret) for j in joiners))
        for _ in range(JOINER_COUNT):
            await host.recv()

        # The host leaving tears the whole session down (#965).
        await host.close()
        deadline = time.monotonic() + 5
        while collab_sessions.get_session(session_id) is not None:
            if time.monotonic() > deadline:
                break
            await asyncio.sleep(0.05)

        assert collab_sessions.get_session(session_id) is None, "session must be dropped"
        # Nothing anywhere in the registry still refers to this session.
        assert session_id not in collab_sessions._sessions
        assert info["join_code"] not in collab_sessions._codes
        # And no message content was retained on any surviving state.
        assert secret not in json.dumps(
            {k: str(v) for k, v in collab_sessions._sessions.items()}
        )

        await asyncio.gather(*(j.close() for j in joiners), return_exceptions=True)
