"""In-memory session registry for collaborative planning sessions (#963).

Foundation piece for the epic in #766: a FastAPI-hosted WebSocket relay that
lets a PM "host" a live planning session and have teammates join it, without
ever storing plan content anywhere. This module owns the session lifecycle;
app.py owns the HTTP/WebSocket routes that call into it.

Architecture constraint (non-negotiable, per #766): nothing here ever touches
disk, a database, or the application log. `SessionState` lives only in the
process's memory and is dropped -- registry entry and all -- the moment the
host disconnects or the session goes idle. Be careful adding any logging
here: log session *existence* and counts, never a session id, join code,
display name, or message payload.

Wire protocol (documented here so later sub-issues have a stable contract to
build on -- especially #964 encryption and #965 lifecycle/rate-limiting):

- ``POST /api/collab/start`` calls ``SessionManager.create_session()`` and
  returns ``{session_id, host_token, join_code, holding_url}`` to the host's
  browser. ``host_token`` is a secret -- it must never be shown to joiners.
- The host's browser opens a WebSocket to
  ``/ws/session/{session_id}?token={host_token}``. The endpoint calls
  ``attach_host()``; a missing or wrong token closes the socket immediately
  and nothing is relayed.
- A joiner's browser opens a WebSocket to the *same* endpoint,
  ``/ws/session/{session_id}``, with no token, and its first message must be
  a JSON handshake: ``{"type": "join", "code": "123456", "display_name":
  "Alice"}``. The endpoint calls ``join_session()``; a correct, unexpired
  code for that session admits the joiner, anything else closes the socket.
- After a connection is admitted (host or joiner), every further message is
  relayed opaquely -- host messages go to all joiners, joiner messages go to
  the host. Payloads are never parsed or interpreted at this layer: that is
  deliberate, so #964 can drop in encryption and #967 the real plan-editing
  protocol without this module changing shape.
- Host disconnect tears the session down immediately: the registry entry is
  removed and every joiner socket is closed. Sessions idle for longer than
  ``IDLE_TIMEOUT_SECONDS`` (checked lazily on access, and swept periodically
  by a background task started from app.py) are torn down the same way.
- #964 (end-to-end encryption): every payload described above is, by
  construction, ciphertext produced client-side by static/collab-crypto.js
  before it ever reaches this relay -- this module still never parses
  message content. The one exception is bootstrapping the key exchange
  itself: the host's ephemeral ECDH public-key announcement (``{"type":
  "host_pubkey", ...}``, not secret -- see collab-crypto.js's module
  docstring) is cached on ``SessionState.host_public_key_msg`` by app.py
  (peeking only at the ``type`` discriminator, never at plan content) so a
  joiner who connects *after* the host already broadcast it still receives
  it immediately on admission. See app.py's ``_maybe_cache_host_pubkey`` /
  ``_admit_joiner`` for why the WebSocket-first-message approach was chosen
  over piggybacking the key onto the HTTP start/join responses.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# Idle sessions are torn down after this many seconds of no host/joiner
# activity. A fixed constant for this foundation issue -- #965 (lifecycle
# and rate limiting) is expected to make this tunable (env var, per-session
# override, etc.) without changing this module's shape.
IDLE_TIMEOUT_SECONDS = 45 * 60

# How often the background sweep (see start_idle_sweep() in app.py) checks
# for idle sessions, independent of any lazy check triggered by a request.
SWEEP_INTERVAL_SECONDS = 60

# secrets.token_urlsafe(32) -> 256 bits of entropy in the session id.
# Deliberately `secrets`, not `uuid4()` or `random`: this id is a
# security-relevant credential (whoever has it can attempt to join the
# session's WebSocket), and `secrets` is CSPRNG-backed by design where
# `uuid4()`'s randomness guarantee is incidental to its spec.
_SESSION_ID_BYTES = 32
_HOST_TOKEN_BYTES = 32


@dataclass
class Joiner:
    """A single connected joiner."""

    websocket: WebSocket
    display_name: str


@dataclass
class SessionState:
    """In-memory state for one active collab session. Never persisted."""

    session_id: str
    host_token: str
    join_code: str
    host: WebSocket | None = None
    joiners: dict[int, Joiner] = field(default_factory=dict)
    # #964: the host's most recent ECDH public-key handshake announcement
    # (opaque JSON text -- a public key + MAC tag, never plan content or
    # key material). Cached so a joiner admitted after the host already
    # broadcast it still gets it. See this module's docstring and app.py's
    # `_maybe_cache_host_pubkey` / `_admit_joiner`.
    host_public_key_msg: str | None = None
    created_at: float = field(default_factory=time.monotonic)
    last_activity: float = field(default_factory=time.monotonic)
    # Serializes writes to `host` -- multiple joiners can relay to the host
    # concurrently, and a single WebSocket must not have concurrent sends.
    host_send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def touch(self) -> None:
        self.last_activity = time.monotonic()

    def is_idle(self) -> bool:
        return (time.monotonic() - self.last_activity) > IDLE_TIMEOUT_SECONDS


@dataclass
class SessionInfo:
    """What create_session() hands back to the host's browser."""

    session_id: str
    host_token: str
    join_code: str
    holding_url: str


class SessionManager:
    """In-memory registry of active collab sessions.

    Every method here is safe to call from an async request handler. There
    is exactly one instance of this class per process (see
    `collab_sessions` below) -- state is never shared across processes or
    written anywhere durable, by design.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}
        self._codes: dict[str, str] = {}  # join_code -> session_id

    # -- creation ------------------------------------------------------

    def create_session(self) -> SessionInfo:
        session_id = secrets.token_urlsafe(_SESSION_ID_BYTES)
        host_token = secrets.token_urlsafe(_HOST_TOKEN_BYTES)
        join_code = self._generate_unique_code()

        state = SessionState(
            session_id=session_id,
            host_token=host_token,
            join_code=join_code,
        )
        self._sessions[session_id] = state
        self._codes[join_code] = session_id

        logger.info("Collab session created; %d session(s) active", len(self._sessions))

        return SessionInfo(
            session_id=session_id,
            host_token=host_token,
            join_code=join_code,
            holding_url=f"/join/{session_id}",
        )

    def _generate_unique_code(self) -> str:
        # secrets.randbelow(), not `random`: this is the join secret, so it
        # needs to be CSPRNG-backed even though its keyspace is small.
        while True:
            code = f"{secrets.randbelow(1_000_000):06d}"
            if code not in self._codes:
                return code

    # -- lookups ---------------------------------------------------------

    def get_session(self, session_id: str) -> SessionState | None:
        """Look up a live session by id, expiring it first if idle."""
        state = self._sessions.get(session_id)
        if state is None:
            return None
        if state.is_idle():
            return None
        return state

    def attach_host(self, session_id: str, token: str, websocket: WebSocket) -> SessionState | None:
        """Attach `websocket` as the host of `session_id` if `token` matches."""
        state = self.get_session(session_id)
        if state is None:
            return None
        if not secrets.compare_digest(token, state.host_token):
            return None
        state.host = websocket
        state.touch()
        return state

    def join_session(self, session_id: str, code: str, display_name: str, websocket: WebSocket) -> SessionState | None:
        """Admit `websocket` as a joiner of `session_id` if `code` matches.

        The session id is already known to the joiner's browser (it comes
        from the holding URL / the WebSocket path it connected to); the code
        is the actual proof the joiner was invited to *this* session, so
        both are checked -- neither one alone is treated as sufficient.
        """
        state = self.get_session(session_id)
        if state is None:
            return None
        if not code or not secrets.compare_digest(code, state.join_code):
            return None
        state.joiners[id(websocket)] = Joiner(websocket=websocket, display_name=display_name)
        state.touch()
        return state

    # -- teardown ----------------------------------------------------------

    async def teardown(self, session_id: str) -> None:
        """Remove a session and close every socket still attached to it.

        Removing from the registry first (before any `await`) means no new
        join/relay call can observe the session mid-teardown.
        """
        state = self._sessions.pop(session_id, None)
        if state is None:
            return
        self._codes.pop(state.join_code, None)

        sockets = [state.host] if state.host is not None else []
        sockets.extend(j.websocket for j in state.joiners.values())
        for ws in sockets:
            try:
                await ws.close()
            except Exception:  # pragma: no cover - already-closed socket, etc.
                pass

    def remove_joiner(self, session_id: str, websocket: WebSocket) -> None:
        """Drop a single joiner (their socket disconnected) without ending the session."""
        state = self._sessions.get(session_id)
        if state is None:
            return
        state.joiners.pop(id(websocket), None)

    async def sweep_idle(self) -> None:
        """Tear down every session that has gone idle. Safe to call repeatedly."""
        idle_ids = [sid for sid, state in self._sessions.items() if state.is_idle()]
        for sid in idle_ids:
            await self.teardown(sid)

    def active_session_count(self) -> int:
        """Non-content diagnostic only -- a count, never session details."""
        return len(self._sessions)


# One registry per process. Nothing here is a database -- it is emptied
# implicitly whenever the process restarts, and entries are removed as
# sessions end, which is the whole point.
collab_sessions = SessionManager()


async def run_idle_sweep_forever(manager: SessionManager = collab_sessions) -> None:
    """Background task: periodically sweep idle sessions.

    Started from app.py's lifespan handler. The lazy check in
    `get_session()`/`attach_host()`/`join_session()` already expires a
    session the moment anyone next touches it; this only catches sessions
    nobody ever touches again (e.g. every joiner also walked away).
    """
    while True:
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
        try:
            await manager.sweep_idle()
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover - defensive; sweep must not die
            logger.exception("Idle session sweep failed")
