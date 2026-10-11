"""Accounts and server-side plan storage (SQLite).

One SQLite file holds the user accounts, their sign-in sessions, password-reset
tokens and the plans themselves. Plans are stored as opaque BLOBs (the UTF-8
bytes of the plan's Markdown): the server never parses them, so the browser
stays the only thing that understands a plan.

Where the file lives
--------------------
``NOODLE_DB_PATH`` (default ``data/noodleplanner.db``). In Docker it is
``/data/noodleplanner.db`` and ``/data`` is a bind mount from the host, so the
database survives container restarts and image rebuilds.

Security notes
--------------
* Passwords are hashed with scrypt (stdlib) and a per-user random salt.
* Session and reset tokens are random, and only their SHA-256 is stored, so a
  copy of the database file cannot be used to sign in.
* Every query is parameterised.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

DEFAULT_DB_PATH = "data/noodleplanner.db"

SESSION_TTL = int(os.getenv("SESSION_TTL_SECONDS", str(30 * 24 * 3600)))  # 30 days
RESET_TTL = int(os.getenv("RESET_TTL_SECONDS", str(3600)))  # 1 hour
MAX_PLANS_PER_USER = int(os.getenv("MAX_PLANS_PER_USER", "500"))
MAX_VERSIONS_PER_PLAN = int(os.getenv("MAX_VERSIONS_PER_PLAN", "50"))

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 256

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")

# scrypt cost: ~16 MiB, tens of milliseconds -- strong enough, cheap enough
# for a small self-hosted box.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 14, 8, 1

_SCHEMA_V1 = """
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    REAL NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at REAL NOT NULL
);
CREATE INDEX reset_tokens_user ON reset_tokens(user_id);

CREATE TABLE plans (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    content    BLOB NOT NULL,
    revision   INTEGER NOT NULL DEFAULT 1,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX plans_user ON plans(user_id, updated_at DESC);
"""

# Version history of a plan: one row per version string (the editor keeps one
# snapshot per version too), newest MAX_VERSIONS_PER_PLAN kept. history_rev
# counts changes, so a client can tell from the plan list alone that there is
# something new to fetch.
_SCHEMA_V2 = """
ALTER TABLE plans ADD COLUMN history_rev INTEGER NOT NULL DEFAULT 0;

CREATE TABLE plan_versions (
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    date    TEXT NOT NULL,
    rag     TEXT NOT NULL DEFAULT '',
    content BLOB NOT NULL,
    PRIMARY KEY (plan_id, version)
);
CREATE INDEX plan_versions_date ON plan_versions(plan_id, date DESC);
"""

_MIGRATIONS = {1: _SCHEMA_V1, 2: _SCHEMA_V2}
_SCHEMA_VERSION = max(_MIGRATIONS)


class AccountError(Exception):
    """A user-facing failure (bad input, duplicate email, wrong password...)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class RevisionConflict(Exception):
    """The plan changed on the server since the client last saw it."""

    def __init__(self, current: "Plan"):
        super().__init__("revision conflict")
        self.current = current


@dataclass(frozen=True)
class User:
    id: str
    email: str
    display_name: str
    created_at: float


@dataclass(frozen=True)
class PlanVersion:
    version: str
    date: str
    rag: str
    content: bytes

    @property
    def size(self) -> int:
        return len(self.content)


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    content: bytes
    revision: int
    created_at: float
    updated_at: float
    history_rev: int = 0

    @property
    def size(self) -> int:
        return len(self.content)


# ---------------------------------------------------------------------------
# Hashing helpers
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N, _SCRYPT_R, _SCRYPT_P,
        base64.b64encode(salt).decode(), base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest_b64)
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=base64.b64decode(salt_b64),
            n=int(n), r=int(r), p=int(p), dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


# A real hash to burn time against when the email is unknown, so "no such
# user" and "wrong password" take about as long.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalise_email(email: str) -> str:
    email = (email or "").strip()
    if not _EMAIL_RE.match(email):
        raise AccountError("Enter a valid email address.")
    return email


def check_password_strength(password: str) -> None:
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise AccountError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise AccountError(f"Password must be at most {MAX_PASSWORD_LENGTH} characters.")


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class AccountStore:
    """All database access. Safe to share across threads: each call opens its
    own short-lived connection (SQLite handles the locking)."""

    def __init__(self, path: Optional[str] = None):
        # Nothing touches the disk until first use, so importing the app (as
        # every test does) never creates a database file as a side effect.
        self.path = Path(path or os.getenv("NOODLE_DB_PATH", DEFAULT_DB_PATH))
        self._ready = False
        self._ready_lock = threading.Lock()

    def _ensure(self) -> None:
        if self._ready:
            return
        with self._ready_lock:
            if self._ready:
                return
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise RuntimeError(
                    f"Cannot create the database directory {self.path.parent}: {exc}. "
                    "In Docker, make sure the mounted data directory is writable by uid 1000."
                ) from exc
            self._migrate()
            self._ready = True

    @contextmanager
    def _raw_conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:  # commit / rollback
                yield conn
        finally:
            conn.close()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        self._ensure()
        with self._raw_conn() as conn:
            yield conn

    def _migrate(self) -> None:
        with self._raw_conn() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > _SCHEMA_VERSION:
                raise RuntimeError(
                    f"{self.path} was written by a newer NoodlePlanner "
                    f"(schema {version}, this build understands {_SCHEMA_VERSION})."
                )
            for step in range(version + 1, _SCHEMA_VERSION + 1):
                conn.executescript(_MIGRATIONS[step])
                conn.execute(f"PRAGMA user_version = {step}")

    # -- users -------------------------------------------------------------

    @staticmethod
    def _user(row: sqlite3.Row) -> User:
        return User(row["id"], row["email"], row["display_name"], row["created_at"])

    def create_user(self, email: str, password: str, display_name: str = "") -> User:
        email = normalise_email(email)
        check_password_strength(password)
        user_id = str(uuid.uuid4())
        now = time.time()
        try:
            with self._conn() as conn:
                conn.execute(
                    "INSERT INTO users (id, email, display_name, password_hash, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (user_id, email, (display_name or "").strip()[:100], hash_password(password), now),
                )
        except sqlite3.IntegrityError:
            raise AccountError("An account with that email already exists.", 409)
        return User(user_id, email, (display_name or "").strip()[:100], now)

    def authenticate(self, email: str, password: str) -> Optional[User]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE email = ?", ((email or "").strip(),)).fetchone()
        if row is None:
            verify_password(password or "", _DUMMY_HASH)
            return None
        if not verify_password(password or "", row["password_hash"]):
            return None
        return self._user(row)

    def get_user(self, user_id: str) -> Optional[User]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return self._user(row) if row else None

    def user_by_email(self, email: str) -> Optional[User]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE email = ?", ((email or "").strip(),)).fetchone()
        return self._user(row) if row else None

    def verify_user_password(self, user_id: str, password: str) -> bool:
        with self._conn() as conn:
            row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        return bool(row) and verify_password(password or "", row["password_hash"])

    def set_password(self, user_id: str, new_password: str) -> None:
        """Change the password and sign every device out."""
        check_password_strength(new_password)
        with self._conn() as conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user_id))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM reset_tokens WHERE user_id = ?", (user_id,))

    def update_display_name(self, user_id: str, display_name: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE users SET display_name = ? WHERE id = ?", ((display_name or "").strip()[:100], user_id))

    def delete_user(self, user_id: str) -> None:
        """Delete the account and, by cascade, its sessions, tokens and plans."""
        with self._conn() as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    # -- sessions ----------------------------------------------------------

    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._conn() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (_token_hash(token), user_id, now, now + SESSION_TTL),
            )
        return token

    def user_for_session(self, token: str) -> Optional[User]:
        if not token:
            return None
        with self._conn() as conn:
            row = conn.execute(
                "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token_hash = ? AND s.expires_at > ?",
                (_token_hash(token), time.time()),
            ).fetchone()
        return self._user(row) if row else None

    def delete_session(self, token: str) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))

    # -- password reset ----------------------------------------------------

    def create_reset_token(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._conn() as conn:
            conn.execute("DELETE FROM reset_tokens WHERE user_id = ? OR expires_at < ?", (user_id, now))
            conn.execute(
                "INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (_token_hash(token), user_id, now + RESET_TTL),
            )
        return token

    def reset_token_valid(self, token: str) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM reset_tokens WHERE token_hash = ? AND expires_at > ?",
                (_token_hash(token or ""), time.time()),
            ).fetchone()
        return row is not None

    def reset_password(self, token: str, new_password: str) -> User:
        """Spend a reset token: set the new password and sign everything out."""
        check_password_strength(new_password)
        with self._conn() as conn:
            row = conn.execute(
                "SELECT user_id FROM reset_tokens WHERE token_hash = ? AND expires_at > ?",
                (_token_hash(token or ""), time.time()),
            ).fetchone()
            if row is None:
                raise AccountError("This reset link is invalid or has expired.", 400)
            user_id = row["user_id"]
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user_id))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM reset_tokens WHERE user_id = ?", (user_id,))
        user = self.get_user(user_id)
        assert user is not None
        return user

    # -- plans -------------------------------------------------------------

    @staticmethod
    def _plan(row: sqlite3.Row) -> Plan:
        return Plan(row["id"], row["name"], bytes(row["content"]), row["revision"],
                    row["created_at"], row["updated_at"], row["history_rev"])

    def list_plans(self, user_id: str) -> list[Plan]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM plans WHERE user_id = ? ORDER BY updated_at DESC", (user_id,)
            ).fetchall()
        return [self._plan(r) for r in rows]

    def get_plan(self, user_id: str, plan_id: str) -> Optional[Plan]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM plans WHERE id = ? AND user_id = ?", (plan_id, user_id)
            ).fetchone()
        return self._plan(row) if row else None

    def create_plan(self, user_id: str, name: str, content: bytes) -> Plan:
        now = time.time()
        plan_id = str(uuid.uuid4())
        with self._conn() as conn:
            count = conn.execute("SELECT COUNT(*) FROM plans WHERE user_id = ?", (user_id,)).fetchone()[0]
            if count >= MAX_PLANS_PER_USER:
                raise AccountError(f"Plan limit reached ({MAX_PLANS_PER_USER}).", 409)
            conn.execute(
                "INSERT INTO plans (id, user_id, name, content, revision, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 1, ?, ?)",
                (plan_id, user_id, name, content, now, now),
            )
        return Plan(plan_id, name, content, 1, now, now)

    def update_plan(
        self,
        user_id: str,
        plan_id: str,
        base_revision: int,
        name: Optional[str] = None,
        content: Optional[bytes] = None,
    ) -> Optional[Plan]:
        """Optimistic update. Returns None if the plan does not exist; raises
        RevisionConflict (carrying the server's copy) if ``base_revision`` is
        not the current revision."""
        now = time.time()
        with self._conn() as conn:
            # Take the write lock up front so check-and-update is atomic.
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM plans WHERE id = ? AND user_id = ?", (plan_id, user_id)
            ).fetchone()
            if row is None:
                return None
            if row["revision"] != base_revision:
                raise RevisionConflict(self._plan(row))
            new_name = row["name"] if name is None else name
            new_content = row["content"] if content is None else content
            conn.execute(
                "UPDATE plans SET name = ?, content = ?, revision = revision + 1, updated_at = ? "
                "WHERE id = ?",
                (new_name, new_content, now, plan_id),
            )
            return Plan(plan_id, new_name, bytes(new_content), base_revision + 1, row["created_at"], now)

    def delete_plan(self, user_id: str, plan_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM plans WHERE id = ? AND user_id = ?", (plan_id, user_id))
        return cur.rowcount > 0

    # -- plan version history ----------------------------------------------

    def _owns(self, conn: sqlite3.Connection, user_id: str, plan_id: str) -> Optional[sqlite3.Row]:
        return conn.execute(
            "SELECT id, history_rev FROM plans WHERE id = ? AND user_id = ?", (plan_id, user_id)
        ).fetchone()

    def list_versions(self, user_id: str, plan_id: str) -> Optional[tuple[int, list[dict]]]:
        """(history_rev, [{version, date, rag, size}] newest first), without the
        text; None if the plan is not this user's."""
        with self._conn() as conn:
            plan = self._owns(conn, user_id, plan_id)
            if plan is None:
                return None
            rows = conn.execute(
                "SELECT version, date, rag, length(content) AS size FROM plan_versions "
                "WHERE plan_id = ? ORDER BY date DESC, version DESC", (plan_id,)
            ).fetchall()
        return plan["history_rev"], [dict(r) for r in rows]

    def get_version(self, user_id: str, plan_id: str, version: str) -> Optional[PlanVersion]:
        with self._conn() as conn:
            if self._owns(conn, user_id, plan_id) is None:
                return None
            r = conn.execute(
                "SELECT version, date, rag, content FROM plan_versions WHERE plan_id = ? AND version = ?",
                (plan_id, version),
            ).fetchone()
        return PlanVersion(r["version"], r["date"], r["rag"], bytes(r["content"])) if r else None

    def put_version(
        self, user_id: str, plan_id: str, version: str, date: str, rag: str, content: bytes
    ) -> Optional[tuple[bool, int]]:
        """Upsert one version. A version already stored with a newer date is
        left alone, and so is one that is older than all MAX_VERSIONS_PER_PLAN
        kept. Returns (applied, history_rev), or None if the plan is not this
        user's."""
        with self._conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            plan = self._owns(conn, user_id, plan_id)
            if plan is None:
                return None
            existing = conn.execute(
                "SELECT date FROM plan_versions WHERE plan_id = ? AND version = ?", (plan_id, version)
            ).fetchone()
            if existing is not None and existing["date"] > date:
                return False, plan["history_rev"]
            conn.execute(
                "INSERT INTO plan_versions (plan_id, version, date, rag, content) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(plan_id, version) DO UPDATE SET date = excluded.date, "
                "rag = excluded.rag, content = excluded.content",
                (plan_id, version, date, rag, content),
            )
            conn.execute(
                "DELETE FROM plan_versions WHERE plan_id = ? AND version NOT IN ("
                "SELECT version FROM plan_versions WHERE plan_id = ? ORDER BY date DESC, version DESC LIMIT ?)",
                (plan_id, plan_id, MAX_VERSIONS_PER_PLAN),
            )
            kept = conn.execute(
                "SELECT 1 FROM plan_versions WHERE plan_id = ? AND version = ?", (plan_id, version)
            ).fetchone()
            if kept is None:                      # older than everything kept
                return False, plan["history_rev"]
            conn.execute("UPDATE plans SET history_rev = history_rev + 1 WHERE id = ?", (plan_id,))
            return True, plan["history_rev"] + 1
