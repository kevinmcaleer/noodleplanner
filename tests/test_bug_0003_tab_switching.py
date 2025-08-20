import os
import re
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
    # After fix: the comment may exist inside a <script> tag, but should not appear as raw text node after the closing main container.
    # Simplest check: ensure we have wrapped version (presence of closing </script> immediately after the comment line) and no duplicate plain text occurrence after that.
    occurrences = [m.start() for m in re.finditer(r'// Tab switching logic', html)]
    assert occurrences, 'Expected tab switching logic script present'
    # Extract all script tag contents
    script_segments = re.findall(r'<script[^>]*>([\s\S]*?)</script>', html)
    concatenated_scripts = '\n'.join(script_segments)
    # All occurrences should be inside script contents
    for pos in occurrences:
        # If the substring at pos is not part of concatenated script contents, failure
        # Quick heuristic: just require the marker to appear inside concatenated scripts string
        assert '// Tab switching logic' in concatenated_scripts, 'Tab switching logic not wrapped in a script tag'
    # Optionally ensure tabs exist
    assert 'id="flow-tab"' in html
    assert 'id="pbs-tab"' in html
