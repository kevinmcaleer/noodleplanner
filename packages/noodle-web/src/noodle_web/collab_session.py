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
  returns ``{session_id, host_token, join_code, handshake_secret,
  holding_url}`` to the host's browser. ``host_token`` and
  ``handshake_secret`` are both secrets -- neither must ever be shown to
  joiners directly (``handshake_secret`` does reach joiners, but only via
  the URL fragment described below, never through the server).
- The host's browser opens a WebSocket to
  ``/ws/session/{session_id}?token={host_token}``. The endpoint calls
  ``attach_host()``; a missing or wrong token closes the socket immediately
  and nothing is relayed.
- A joiner's browser opens a WebSocket to the *same* endpoint,
  ``/ws/session/{session_id}``, with no token, and its first message must be
  a JSON handshake: ``{"type": "join", "code": "123456", "display_name":
  "Alice"}``. The endpoint calls ``join_session()``; a correct, unexpired
  code for that session admits the joiner, anything else closes the socket.
  **``join_code`` is a server-side admission gate only** -- it has zero
  cryptographic role (see the ``handshake_secret`` note below and
  collab-crypto.js's module docstring; a security review of #964 found the
  relay could otherwise trivially MITM the encrypted channel precisely
  because the relay legitimately learns this code to do admission).
- After a connection is admitted (host or joiner), every further message is
  relayed opaquely -- host messages go to all joiners, joiner messages go to
  the host. Payloads are never parsed or interpreted at this layer: that is
  deliberate, so #964 could drop in encryption and #967 the real
  plan-editing protocol without this module changing shape.
- #967 (multi-joiner addressing) adds the one piece of routing metadata the
  relay needs to support more than one joiner at a time. Each joiner now has
  its own ECDH session key with the host, so:

  * joiner -> host frames are wrapped by app.py's ``_wrap_from_joiner`` as
    ``{"type": "from_joiner", "joiner_id": N, "frame": "<original>"}``, so
    the host can tell concurrent joiners apart and file each handshake under
    the right key. Without this the host could only ever hold one joiner's
    key, and a second joiner silently displaced the first.
  * host -> joiner frames may be addressed as ``{"type": "to_joiner",
    "joiner_id": N, "frame": "<ciphertext>"}``; app.py delivers ``frame``
    unwrapped to that one socket. Unaddressed host frames still broadcast to
    everyone, which is what the cached ``host_pubkey`` announcement relies
    on.

  ``joiner_id`` is the same opaque id ``presence_snapshot()`` already
  publishes, so presence and crypto agree on identity without a second
  scheme. This is addressing only: ``frame`` is passed through byte for
  byte and is still ciphertext this module never reads. A relay that lied
  about ``joiner_id`` could misroute a frame but could not make one
  decrypt, because the inner frame is still authenticated on its own.
- Host disconnect tears the session down immediately: the registry entry is
  removed and every joiner socket is closed. Sessions idle for longer than
  ``IDLE_TIMEOUT_SECONDS`` (checked lazily on access, and swept periodically
  by a background task started from app.py) are torn down the same way.
- #966 (host presence panel): each ``Joiner`` tracks ``joined_at`` and
  ``last_activity`` (distinct from ``SessionState``'s own ``last_activity``
  above, which drives *session* idle expiry -- this is per-*joiner* and
  drives a UX active/inactive heuristic, not a security boundary). app.py's
  ``_relay_as_joiner`` calls ``Joiner.touch()`` for every message received
  from that joiner, including the lightweight ``{"type": "presence_ping"}``
  heartbeat collab_join.html sends periodically so a joiner who is present
  but not actively sending real content still shows as active. Whenever the
  joiner list or an active/inactive status might have changed (a joiner is
  admitted, disconnects, or is kicked, or a ping arrives), app.py pushes a
  ``{"type": "presence", "joiners": [...]}`` snapshot (see
  ``SessionState.presence_snapshot()``) to the host -- there is no separate
  wall-clock timer for this; piggybacking on the heartbeat is what keeps a
  quiet single-joiner session's status from going stale without adding
  another background task. The host can also remove ("kick") a joiner with
  a ``{"type": "kick", "joiner_id": ...}`` message (``joiner_id`` is the
  same stable ``Joiner.joiner_id`` key ``SessionState.joiners`` and the presence
  snapshot already use); ``SessionManager.kick_joiner()`` closes just that
  joiner's socket with the ``CLOSE_KICKED``/``CLOSE_REASON_KICKED`` pair
  below, following #965's close-code convention, without touching the
  session or any other joiner.
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
- ``handshake_secret`` (added after a security review of the first #964
  cut): a second, separate, high-entropy secret -- ``join_code`` cannot
  authenticate the ECDH handshake in collab-crypto.js because the relay
  legitimately learns ``join_code`` (it has to, to admit joiners), so a
  malicious/compromised relay could otherwise recompute the same MAC and
  transparently MITM the "encrypted" channel. ``handshake_secret`` is
  generated once in ``create_session()`` and is **never sent to the server
  on any subsequent request** -- it is embedded only in the URL *fragment*
  of ``holding_url`` (``/join/{session_id}#k=<secret>``), which browsers
  never include in HTTP requests. The host's browser gets it directly from
  the ``/api/collab/start`` JSON response; the joiner's browser reads it
  client-side from ``window.location.hash`` after navigating to that exact
  link. This module generates it and hands it off once -- it is not stored
  on ``SessionState`` and the server never checks or reconstructs it, by
  design: there is nothing for the relay to learn here.
- #965 (lifecycle, rate limiting, teardown): ``IDLE_TIMEOUT_SECONDS`` is now
  read from ``COLLAB_IDLE_TIMEOUT_SECONDS`` (falling back to the original
  45-minute default), matching security.py's existing os.getenv-with-default
  convention for its own tunables. Join attempts are rate limited per
  source IP by ``security.is_join_rate_limited()``, checked in app.py's
  ``collab_session_ws()`` before a joiner's handshake is even read (a
  WebSocket handshake never passes through ``RateLimitMiddleware``, which
  only runs on the HTTP request/response cycle, so this had to be a
  separate, explicit check). The host can now also end a session
  explicitly (a ``{"type": "end_session"}`` WebSocket message -- see
  app.py's ``_is_end_session_message()`` for why a WS message was chosen
  over a new HTTP endpoint), and every teardown path (explicit end, host
  disconnect, idle timeout) now closes sockets with a distinct
  ``CLOSE_*``/``CLOSE_REASON_*`` pair (below) instead of a bare close, so a
  joiner's browser can tell *why* the session ended and show a specific
  explanation rather than a generic one.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import os
import secrets
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# Idle sessions are torn down after this many seconds of no host/joiner
# activity. #965: now tunable via env var, following the same
# os.getenv-with-default convention security.py already uses for its own
# tunables (RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW, etc.) -- 45 minutes
# remains the default, unchanged from the #963 foundation issue.
IDLE_TIMEOUT_SECONDS = int(os.getenv("COLLAB_IDLE_TIMEOUT_SECONDS", str(45 * 60)))

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
# #965: close codes/reasons used when a session's sockets are torn down,
# so the joiner's browser (collab_join.html) can tell these three cases
# apart via the WebSocket CloseEvent's `code`/`reason` and show an
# appropriate explanation instead of one generic "session ended" message.
# 4000-4999 is the reserved-for-application-use range (RFC 6455 7.4.2);
# 4400/4401 below are already in use by app.py for handshake rejection, so
# these start at 4410 to stay clearly out of that range.
CLOSE_HOST_ENDED = 4410
CLOSE_REASON_HOST_ENDED = "Host ended the session."
CLOSE_HOST_DISCONNECTED = 4411
CLOSE_REASON_HOST_DISCONNECTED = "Host disconnected."
CLOSE_IDLE_TIMEOUT = 4412
CLOSE_REASON_IDLE_TIMEOUT = "Session expired after being idle too long."
# #966: the host removed this specific joiner from their presence panel.
CLOSE_KICKED = 4413
CLOSE_REASON_KICKED = "Removed by host."

# #964: the secret that authenticates the ECDH handshake in
# collab-crypto.js -- deliberately NOT the six-digit join_code (see this
# module's docstring for why: the relay legitimately learns join_code, so
# it can't be what proves the handshake wasn't MITM'd by the relay itself).
# 256 bits, matching this file's existing convention for the other two
# security-relevant tokens above -- well over the "128+ bits" floor.
_HANDSHAKE_SECRET_BYTES = 32

# #966: how recently a joiner must have sent *any* message -- including the
# lightweight presence_ping heartbeat -- for the host's presence panel to
# show them as "active" rather than "inactive". A UX heuristic, not a
# security boundary (unlike IDLE_TIMEOUT_SECONDS above), so it doesn't need
# to match that value: picked to comfortably outlast collab-session.js's
# presence-ping interval with margin for a missed beat or two before
# flipping to "inactive".
PRESENCE_ACTIVE_WINDOW_SECONDS = int(os.getenv("COLLAB_PRESENCE_ACTIVE_WINDOW_SECONDS", "45"))


# Joiner correlation ids. Deliberately NOT `id(websocket)`: CPython reuses
# an object's address once it is garbage collected, so a joiner who left
# could hand their id straight to the next joiner to connect. That made two
# host actions land on the wrong person -- a `kick` aimed at the departed
# joiner (#966) and a `to_joiner` frame addressed to them (#967) would both
# hit whoever inherited the id. A process-wide counter is never reused, so
# a stale id stays stale.
_joiner_id_counter = itertools.count(1)


@dataclass
class Joiner:
    """A single connected joiner."""

    websocket: WebSocket
    display_name: str
    joiner_id: int = field(default_factory=lambda: next(_joiner_id_counter))
    joined_at: float = field(default_factory=time.monotonic)
    last_activity: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.last_activity = time.monotonic()

    def is_active(self) -> bool:
        return (time.monotonic() - self.last_activity) <= PRESENCE_ACTIVE_WINDOW_SECONDS


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

    def joiner_id_for(self, websocket: WebSocket) -> int | None:
        """This socket's stable joiner id, or None if it isn't a joiner in
        this session. Joiner counts are small (a planning session, not a
        broadcast), so a scan is cheaper than maintaining a second index
        that could drift out of sync with `joiners`."""
        for joiner_id, joiner in self.joiners.items():
            if joiner.websocket is websocket:
                return joiner_id
        return None

    def presence_snapshot(self) -> list[dict]:
        """Non-sensitive presence metadata for the host's presence panel
        (#966): each joiner's correlation id (the same ``Joiner.joiner_id``
        key ``joiners`` is keyed by, used only so a host can name a joiner
        in a ``kick`` message), display name (already sent in the clear at
        join time, per #963), and the ``is_active()`` UX heuristic.
        Deliberately excludes timestamps -- ``joined_at``/``last_activity``
        are ``time.monotonic()`` values with no meaning outside this
        process, and the host doesn't need them, just the derived
        active/inactive label.
        """
        return [
            {"id": joiner_id, "display_name": joiner.display_name, "active": joiner.is_active()}
            for joiner_id, joiner in self.joiners.items()
        ]


@dataclass
class SessionInfo:
    """What create_session() hands back to the host's browser.

    ``handshake_secret`` is also embedded in ``holding_url``'s URL fragment
    (never sent to the server again by either browser) and is returned here
    too purely so the host's own crypto code can use it directly, without
    round-tripping it through URL-fragment parsing on the same page that
    just received it. See this module's docstring for the full rationale.
    """

    session_id: str
    host_token: str
    join_code: str
    handshake_secret: str
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
        # #964: generated once, handed off in the response below, and never
        # stored on SessionState or anywhere else -- the server has no
        # further use for it (it never verifies it; only the two browsers'
        # crypto code does), so there is nothing to retain.
        handshake_secret = secrets.token_urlsafe(_HANDSHAKE_SECRET_BYTES)

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
            handshake_secret=handshake_secret,
            # The fragment (after '#') is never sent to any server in any
            # HTTP request -- that's what makes it safe to embed here. See
            # this module's docstring for the full "why a fragment" story.
            holding_url=f"/join/{session_id}#k={handshake_secret}",
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

        `code` is purely a server-side admission gate: it plays no role in
        #964's encryption (see this module's docstring and
        collab-crypto.js's) -- the server legitimately sees it right here,
        which is exactly why it must never double as a cryptographic
        secret.
        """
        state = self.get_session(session_id)
        if state is None:
            return None
        if not code or not secrets.compare_digest(code, state.join_code):
            return None
        joiner = Joiner(websocket=websocket, display_name=display_name)
        state.joiners[joiner.joiner_id] = joiner
        state.touch()
        return state

    # -- teardown ----------------------------------------------------------

    async def teardown(
        self,
        session_id: str,
        *,
        code: int = 1000,
        reason: str = "",
        exclude: WebSocket | None = None,
    ) -> None:
        """Remove a session and close every socket still attached to it.

        Removing from the registry first (before any `await`) means no new
        join/relay call can observe the session mid-teardown.

        `code`/`reason` (#965) are passed straight through to each
        WebSocket's close frame -- see the CLOSE_* constants above -- so a
        joiner's browser can distinguish *why* the session ended instead of
        seeing an unexplained close. `exclude` skips closing one socket
        (the caller's own, e.g. the host that just sent `end_session`),
        since that connection is about to close itself and closing it here
        too would just be redundant, not incorrect.
        """
        state = self._sessions.pop(session_id, None)
        if state is None:
            return
        self._codes.pop(state.join_code, None)

        sockets = [state.host] if state.host is not None else []
        sockets.extend(j.websocket for j in state.joiners.values())
        for ws in sockets:
            if ws is exclude:
                continue
            try:
                await ws.close(code=code, reason=reason)
            except Exception:  # pragma: no cover - already-closed socket, etc.
                pass

    def remove_joiner(self, session_id: str, websocket: WebSocket) -> None:
        """Drop a single joiner (their socket disconnected) without ending the session."""
        state = self._sessions.get(session_id)
        if state is None:
            return
        joiner_id = state.joiner_id_for(websocket)
        if joiner_id is not None:
            state.joiners.pop(joiner_id, None)

    async def kick_joiner(self, session_id: str, joiner_id: int, *, code: int, reason: str) -> bool:
        """Host-initiated removal of a single joiner (#966): pops them from
        `joiners` (before the `await`, same "remove first" ordering as
        `teardown()`, so a concurrent relay can't observe a half-removed
        joiner) and closes just their socket with `code`/`reason` -- the
        session and every other joiner are untouched. Returns False if
        `joiner_id` doesn't name a currently connected joiner (already
        disconnected, wrong session, stale panel, etc.) so the caller can
        treat that as a harmless no-op rather than an error.
        """
        state = self._sessions.get(session_id)
        if state is None:
            return False
        joiner = state.joiners.pop(joiner_id, None)
        if joiner is None:
            return False
        try:
            await joiner.websocket.close(code=code, reason=reason)
        except Exception:  # pragma: no cover - already-closed socket, etc.
            pass
        return True

    async def sweep_idle(self) -> None:
        """Tear down every session that has gone idle. Safe to call repeatedly."""
        idle_ids = [sid for sid, state in self._sessions.items() if state.is_idle()]
        for sid in idle_ids:
            await self.teardown(sid, code=CLOSE_IDLE_TIMEOUT, reason=CLOSE_REASON_IDLE_TIMEOUT)

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
