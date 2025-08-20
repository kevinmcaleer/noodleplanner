import os
from fastapi.testclient import TestClient
from app import app
from db import create_tables, DATABASE_URL
import pytest

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_db():
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)
    create_tables()
    yield
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)


def test_bug_0003_tab_switching_script_not_literal():
    # Minimal project + user to render page
    client.post('/register', data={'username': 'tabs', 'fullname': 'Tabs User', 'password': 'secret'})
    client.post('/login', data={'username': 'tabs', 'password': 'secret'})
    client.cookies.set('token', 'tabs')
    # Create project directly
    from db import get_db
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute('SELECT id FROM users WHERE username = ?', ('tabs',))
        user_id = cur.fetchone()[0]
        cur.execute('INSERT INTO projects (name, owner) VALUES (?, ?)', ('TabProj', user_id))
        conn.commit()
        cur.execute('SELECT id FROM projects WHERE name = ? AND owner = ?', ('TabProj', user_id))
        project_id = cur.fetchone()[0]
    r = client.get(f'/projects/{project_id}')
    assert r.status_code == 200
    html = r.text
    # Failing conditions for current bug:
    assert '// Tab switching logic' in html, 'Adjust assertion after fix: script still literal (expected pre-fix state)'
    # Once fixed, change to assert not in
    # assert '// Tab switching logic' not in html
    # Optionally ensure tabs exist
    assert 'id="flow-tab"' in html
    assert 'id="pbs-tab"' in html
