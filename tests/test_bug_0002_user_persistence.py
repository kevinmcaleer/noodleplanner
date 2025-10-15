import os
from test_helpers import create_test_jwt_token
import sys
from fastapi.testclient import TestClient
import pytest

# Ensure project root on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import importlib as _importlib

import db as db_module  # noqa: E402
from db import create_tables  # noqa: E402

@pytest.fixture
def clean_db(tmp_path, monkeypatch):
    # Use a temporary db path to avoid interfering with global test runs
    test_db = tmp_path / 'persist.db'
    monkeypatch.setenv('NOODLEPLANNER_DB', str(test_db))
    # Force module reload to pick up env override if implemented later
    create_tables()
    yield str(test_db)
    if test_db.exists():
        os.remove(test_db)


def test_bug_0002_user_persists_across_restart(clean_db, monkeypatch):
    # Reload db to ensure it uses overridden path
    _importlib.reload(db_module)
    # First lifecycle
    import app as app_module
    with TestClient(app_module.app) as client1:
        # Explicitly ensure tables exist (lifespan should handle but defensive)
        create_tables()
        resp = client1.post('/register', data={'username': 'persistme', 'fullname': 'Persist Me', 'password': 'secret'})
        assert resp.status_code in (200, 302)

    # Reload app (simulated restart)
    _importlib.reload(app_module)
    with TestClient(app_module.app) as client2:
        # Do not recreate tables (should already exist with persisted data)
        login_resp = client2.post('/login', data={'username': 'persistme', 'password': 'secret'})
        assert login_resp.status_code in (200, 302), 'User should still be able to login after restart'
    # Restore default DB path for subsequent tests
    if 'NOODLEPLANNER_DB' in os.environ:
        # If test fixture removal didn't clean, ensure deletion
        try:
            os.remove(os.environ['NOODLEPLANNER_DB'])
        except OSError:
            pass
    # Ensure env var cleared and module reloaded to default path
    os.environ.pop('NOODLEPLANNER_DB', None)
    _importlib.reload(db_module)
    create_tables()
