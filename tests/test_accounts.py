"""Accounts and server-side plan storage: store, pages and JSON API."""

import logging
import re

import pytest
from fastapi import FastAPI
from fastapi.templating import Jinja2Templates
from fastapi.testclient import TestClient

from noodle_web import accounts_routes
from noodle_web.accounts import AccountError, AccountStore, RevisionConflict, hash_password, verify_password

PASSWORD = "correct horse battery"


@pytest.fixture
def store(tmp_path):
    return AccountStore(str(tmp_path / "sub" / "np.db"))


@pytest.fixture
def client(store):
    from pathlib import Path
    import noodle_web

    templates = Jinja2Templates(directory=str(Path(noodle_web.__file__).parent / "templates"))
    app = FastAPI()
    app.include_router(accounts_routes.build_router(templates, "test", store))
    accounts_routes._failures.clear()
    return TestClient(app, follow_redirects=False)


def register(client, email="kev@example.com", password=PASSWORD):
    return client.post("/account/register", data={"email": email, "password": password, "confirm": password})


class TestStore:
    def test_creates_db_and_parent_dir_lazily(self, tmp_path):
        path = tmp_path / "a" / "b" / "np.db"
        s = AccountStore(str(path))
        assert not path.exists()
        s.create_user("a@example.com", PASSWORD)
        assert path.exists()

    def test_password_hash_roundtrip(self):
        h = hash_password("hunter2hunter2")
        assert "hunter2" not in h
        assert verify_password("hunter2hunter2", h)
        assert not verify_password("nope", h)

    def test_duplicate_email_is_case_insensitive(self, store):
        store.create_user("A@Example.com", PASSWORD)
        with pytest.raises(AccountError) as exc:
            store.create_user("a@example.com", PASSWORD)
        assert exc.value.status == 409

    def test_weak_password_and_bad_email_rejected(self, store):
        with pytest.raises(AccountError):
            store.create_user("a@example.com", "short")
        with pytest.raises(AccountError):
            store.create_user("not-an-email", PASSWORD)

    def test_sessions_hash_tokens_at_rest(self, store):
        user = store.create_user("a@example.com", PASSWORD)
        token = store.create_session(user.id)
        assert store.user_for_session(token).id == user.id
        assert store.user_for_session("bogus") is None
        with store._conn() as conn:
            stored = conn.execute("SELECT token_hash FROM sessions").fetchone()[0]
        assert stored != token

    def test_plan_revisions_and_conflict(self, store):
        user = store.create_user("a@example.com", PASSWORD)
        plan = store.create_plan(user.id, "P", b"one")
        updated = store.update_plan(user.id, plan.id, 1, content=b"two")
        assert updated.revision == 2
        with pytest.raises(RevisionConflict) as exc:
            store.update_plan(user.id, plan.id, 1, content=b"three")
        assert exc.value.current.content == b"two"

    def test_plans_are_private_to_their_owner(self, store):
        a = store.create_user("a@example.com", PASSWORD)
        b = store.create_user("b@example.com", PASSWORD)
        plan = store.create_plan(a.id, "P", b"x")
        assert store.get_plan(b.id, plan.id) is None
        assert store.update_plan(b.id, plan.id, 1, content=b"y") is None
        assert not store.delete_plan(b.id, plan.id)

    def test_delete_user_cascades(self, store):
        user = store.create_user("a@example.com", PASSWORD)
        token = store.create_session(user.id)
        store.create_plan(user.id, "P", b"x")
        store.delete_user(user.id)
        assert store.user_for_session(token) is None
        with store._conn() as conn:
            assert conn.execute("SELECT COUNT(*) FROM plans").fetchone()[0] == 0

    def test_reset_token_single_use_and_signs_out(self, store):
        user = store.create_user("a@example.com", PASSWORD)
        session = store.create_session(user.id)
        token = store.create_reset_token(user.id)
        store.reset_password(token, "a brand new password")
        assert store.user_for_session(session) is None
        assert store.authenticate("a@example.com", "a brand new password")
        with pytest.raises(AccountError):
            store.reset_password(token, "another new password")

    def test_survives_reopen(self, tmp_path):
        path = str(tmp_path / "np.db")
        user = AccountStore(path).create_user("a@example.com", PASSWORD)
        AccountStore(path).create_plan(user.id, "P", b"x")
        assert len(AccountStore(path).list_plans(user.id)) == 1


class TestPages:
    def test_pages_render(self, client):
        for path in ("/account/login", "/account/register", "/account/forgot"):
            assert client.get(path).status_code == 200

    def test_register_signs_in_and_sets_secure_cookie_flags(self, client):
        r = register(client)
        assert r.status_code == 303
        cookie = r.headers["set-cookie"]
        assert "HttpOnly" in cookie and "SameSite=lax" in cookie
        assert client.get("/api/v1/me").json()["email"] == "kev@example.com"

    def test_register_mismatched_passwords(self, client):
        r = client.post("/account/register", data={"email": "a@example.com", "password": PASSWORD, "confirm": "x"})
        assert r.status_code == 400

    def test_register_closed(self, client, monkeypatch):
        monkeypatch.setattr(accounts_routes, "REGISTRATION_OPEN", False)
        assert register(client).status_code == 403

    def test_login_wrong_and_right(self, client):
        register(client)
        client.cookies.clear()
        assert client.post("/account/login", data={"email": "kev@example.com", "password": "wrong"}).status_code == 401
        r = client.post("/account/login", data={"email": "KEV@example.com", "password": PASSWORD})
        assert r.status_code == 303
        assert client.get("/api/v1/me").status_code == 200

    def test_login_lockout(self, client, monkeypatch):
        monkeypatch.setattr(accounts_routes, "LOGIN_MAX_FAILURES", 3)
        register(client)
        client.cookies.clear()
        for _ in range(3):
            client.post("/account/login", data={"email": "kev@example.com", "password": "wrong"})
        r = client.post("/account/login", data={"email": "kev@example.com", "password": PASSWORD})
        assert r.status_code == 429

    def test_logout(self, client):
        register(client)
        assert client.post("/account/logout").status_code == 303
        assert client.get("/api/v1/me").status_code == 401

    def test_account_page_needs_sign_in(self, client):
        assert client.get("/account").status_code == 303
        register(client)
        assert "kev@example.com" in client.get("/account").text

    def test_change_password(self, client):
        register(client)
        bad = client.post("/account/password", data={"current": "nope", "password": "new password 123", "confirm": "new password 123"})
        assert bad.status_code == 400
        ok = client.post("/account/password", data={"current": PASSWORD, "password": "new password 123", "confirm": "new password 123"})
        assert ok.status_code == 303
        assert client.get("/api/v1/me").status_code == 401  # signed out everywhere
        r = client.post("/account/login", data={"email": "kev@example.com", "password": "new password 123"})
        assert r.status_code == 303

    def test_forgot_and_reset_flow(self, client, store, caplog):
        register(client)
        client.cookies.clear()
        with caplog.at_level(logging.WARNING):
            r = client.post("/account/forgot", data={"email": "kev@example.com"})
        assert r.headers["location"].endswith("msg=reset-sent")
        token = re.search(r"token=([\w-]+)", caplog.text).group(1)
        assert client.get(f"/account/reset?token={token}").status_code == 200
        r = client.post("/account/reset", data={"token": token, "password": "reset password 1", "confirm": "reset password 1"})
        assert r.status_code == 303
        assert client.get(f"/account/reset?token={token}").status_code == 400  # single use
        assert store.authenticate("kev@example.com", "reset password 1")

    def test_forgot_unknown_email_looks_identical(self, client):
        r = client.post("/account/forgot", data={"email": "nobody@example.com"})
        assert r.status_code == 303 and r.headers["location"].endswith("msg=reset-sent")

    def test_delete_account(self, client, store):
        register(client)
        client.post("/api/v1/plans", json={"name": "P", "content": "x"})
        wrong = client.post("/account/delete", data={"confirm_email": "kev@example.com", "password": "nope"})
        assert wrong.status_code == 400
        ok = client.post("/account/delete", data={"confirm_email": "kev@example.com", "password": PASSWORD})
        assert ok.status_code == 303
        assert store.user_by_email("kev@example.com") is None
        assert client.get("/api/v1/me").status_code == 401

    def test_cross_site_post_refused(self, client):
        r = client.post("/account/register",
                        data={"email": "a@example.com", "password": PASSWORD, "confirm": PASSWORD},
                        headers={"origin": "https://evil.example"})
        assert r.status_code == 403


class TestSession:
    def test_signed_out_is_a_200_not_a_401(self, client):
        r = client.get("/api/v1/session")
        assert r.status_code == 200 and r.json() == {"user": None}

    def test_signed_in_names_the_user(self, client):
        register(client)
        assert client.get("/api/v1/session").json()["user"]["email"] == "kev@example.com"


class TestPlanApi:
    def test_requires_sign_in(self, client):
        assert client.get("/api/v1/plans").status_code == 401
        assert client.post("/api/v1/plans", json={"name": "P"}).status_code == 401

    def test_crud_and_conflict(self, client):
        register(client)
        created = client.post("/api/v1/plans", json={"name": "Launch", "content": "# Plan\nTask 1 3d"})
        assert created.status_code == 201
        plan = created.json()
        assert plan["revision"] == 1

        listing = client.get("/api/v1/plans").json()["plans"]
        assert [p["name"] for p in listing] == ["Launch"]
        assert "content" not in listing[0]

        assert client.get(f"/api/v1/plans/{plan['id']}").json()["content"] == "# Plan\nTask 1 3d"

        put = client.put(f"/api/v1/plans/{plan['id']}", json={"base_revision": 1, "content": "v2 ✓"})
        assert put.status_code == 200 and put.json()["revision"] == 2

        stale = client.put(f"/api/v1/plans/{plan['id']}", json={"base_revision": 1, "content": "v3"})
        assert stale.status_code == 409
        assert stale.json()["current"]["content"] == "v2 ✓"

        assert client.delete(f"/api/v1/plans/{plan['id']}").status_code == 204
        assert client.get(f"/api/v1/plans/{plan['id']}").status_code == 404

    def test_other_users_cannot_see_plans(self, client):
        register(client, "a@example.com")
        plan = client.post("/api/v1/plans", json={"name": "Mine", "content": "x"}).json()
        client.cookies.clear()
        register(client, "b@example.com")
        assert client.get("/api/v1/plans").json()["plans"] == []
        assert client.get(f"/api/v1/plans/{plan['id']}").status_code == 404
        assert client.put(f"/api/v1/plans/{plan['id']}", json={"base_revision": 1, "content": "y"}).status_code == 404
        assert client.delete(f"/api/v1/plans/{plan['id']}").status_code == 404

    def test_oversize_content_rejected(self, client, monkeypatch):
        register(client)
        big = "x" * (accounts_routes.MAX_PLAN_BYTES + 1)
        assert client.post("/api/v1/plans", json={"name": "P", "content": big}).status_code == 422


def _plan(client):
    register(client)
    return client.post("/api/v1/plans", json={"name": "P", "content": "x"}).json()["id"]


def _put_version(client, plan_id, version="1.0", date="2026-10-11T10:00:00.000Z", content="v1", rag=""):
    return client.put(f"/api/v1/plans/{plan_id}/versions",
                      json={"version": version, "date": date, "rag": rag, "content": content})


class TestVersionHistory:
    def test_upsert_list_and_get(self, client):
        pid = _plan(client)
        assert client.get("/api/v1/plans").json()["plans"][0]["history_rev"] == 0
        r = _put_version(client, pid, "1.0", "2026-10-11T10:00:00.000Z", "one", "green")
        assert r.json() == {"applied": True, "history_rev": 1}
        _put_version(client, pid, "1.1", "2026-10-11T11:00:00.000Z", "two")
        listing = client.get(f"/api/v1/plans/{pid}/versions").json()
        assert listing["history_rev"] == 2
        assert [v["version"] for v in listing["versions"]] == ["1.1", "1.0"]       # newest first
        assert "content" not in listing["versions"][0]
        one = client.get(f"/api/v1/plans/{pid}/version", params={"version": "1.0"}).json()
        assert one["content"] == "one" and one["rag"] == "green"
        assert client.get("/api/v1/plans").json()["plans"][0]["history_rev"] == 2

    def test_same_version_newer_date_replaces_older_is_ignored(self, client):
        pid = _plan(client)
        _put_version(client, pid, "1.0", "2026-10-11T10:00:00.000Z", "first")
        assert _put_version(client, pid, "1.0", "2026-10-11T10:05:00.000Z", "second").json()["applied"] is True
        stale = _put_version(client, pid, "1.0", "2026-10-11T09:00:00.000Z", "old")
        assert stale.json() == {"applied": False, "history_rev": 2}
        got = client.get(f"/api/v1/plans/{pid}/version", params={"version": "1.0"}).json()
        assert got["content"] == "second"

    def test_keeps_only_the_newest_fifty(self, client, monkeypatch):
        from noodle_web import accounts
        monkeypatch.setattr(accounts, "MAX_VERSIONS_PER_PLAN", 3)
        pid = _plan(client)
        for i in range(5):
            _put_version(client, pid, f"1.{i}", f"2026-10-11T10:0{i}:00.000Z", f"t{i}")
        versions = client.get(f"/api/v1/plans/{pid}/versions").json()["versions"]
        assert [v["version"] for v in versions] == ["1.4", "1.3", "1.2"]
        # Older than everything kept: not stored.
        r = _put_version(client, pid, "0.9", "2026-10-10T00:00:00.000Z", "ancient")
        assert r.json()["applied"] is False

    def test_validation(self, client):
        pid = _plan(client)
        assert _put_version(client, pid, "", "2026-10-11T10:00:00.000Z").status_code == 422
        assert _put_version(client, pid, "1.0", "yesterday").status_code == 422

    def test_private_to_owner_and_gone_with_the_plan(self, client):
        pid = _plan(client)
        _put_version(client, pid)
        client.cookies.clear()
        register(client, "other@example.com")
        assert client.get(f"/api/v1/plans/{pid}/versions").status_code == 404
        assert client.get(f"/api/v1/plans/{pid}/version", params={"version": "1.0"}).status_code == 404
        assert _put_version(client, pid).status_code == 404
        client.cookies.clear()
        client.post("/account/login", data={"email": "kev@example.com", "password": PASSWORD})
        client.delete(f"/api/v1/plans/{pid}")
        assert client.get(f"/api/v1/plans/{pid}/versions").status_code == 404

    def test_requires_sign_in(self, client):
        assert client.get("/api/v1/plans/x/versions").status_code == 401


class TestMigration:
    def test_a_v1_database_gains_version_history(self, tmp_path):
        import sqlite3
        from noodle_web import accounts
        path = str(tmp_path / "old.db")
        conn = sqlite3.connect(path)
        conn.executescript(accounts._SCHEMA_V1)
        conn.execute("PRAGMA user_version = 1")
        conn.execute("INSERT INTO users VALUES ('u', 'a@example.com', '', 'x', 0)")
        conn.execute("INSERT INTO plans VALUES ('p', 'u', 'Old plan', x'6162', 3, 0, 0)")
        conn.commit()
        conn.close()

        store = AccountStore(path)
        plan = store.get_plan("u", "p")
        assert (plan.name, plan.revision, plan.history_rev) == ("Old plan", 3, 0)
        assert store.put_version("u", "p", "1.0", "2026-10-11T10:00:00.000Z", "", b"snap") == (True, 1)
        with store._conn() as c:
            assert c.execute("PRAGMA user_version").fetchone()[0] == accounts._SCHEMA_VERSION
