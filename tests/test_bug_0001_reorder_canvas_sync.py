import os
from test_helpers import create_test_jwt_token
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import app  # noqa: E402
from db import create_tables, get_db, DATABASE_URL  # noqa: E402

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)
    create_tables()
    yield
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)

def create_and_login_user(username="alice", password="secret"):
    client.post("/register", data={"username": username, "fullname": "Alice Wonderland", "password": password})
    client.post("/login", data={"username": username, "password": password})
    client.cookies.set("token", username)
    return username

def create_project_for_user(username, project_name):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        user_row = cursor.fetchone()
        assert user_row
        owner_id = user_row[0]
        cursor.execute('INSERT INTO projects (name, owner) VALUES (?, ?)', (project_name, owner_id))
        conn.commit()
        cursor.execute('SELECT id FROM projects WHERE name = ? AND owner = ?', (project_name, owner_id))
        return cursor.fetchone()[0]

def test_bug_0001_reorder_canvas_sync():
    """Regression test for BUG-0001: After reordering products, the returned planning_room HTML should list products in updated sort order."""
    username = create_and_login_user()
    project_id = create_project_for_user(username, "Project Reorder")
    # Insert three products with initial order 1,2,3
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?,?,NULL,1)', ("A", project_id))
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?,?,NULL,2)', ("B", project_id))
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?,?,NULL,3)', ("C", project_id))
        conn.commit()
        cursor.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("C", project_id))
        c_id = cursor.fetchone()[0]
    # Move C up twice so expected order becomes C, A, B (depending on business rules for move up)
    client.post(f"/projects/move-product-up/{c_id}")
    client.post(f"/projects/move-product-up/{c_id}")
    # Fetch planning room HTML and extract JSON blob
    resp = client.get(f"/projects/{project_id}")
    assert resp.status_code == 200
    text = resp.text
    # Extract all-products-json content
    import re, json
    m = re.search(r'<script id="all-products-json" type="application/json">(.*?)</script>', text, re.DOTALL)
    assert m, "all-products-json script tag not found"
    products = json.loads(m.group(1))
    # Sort by sort_order then id as backend does
    backend_order = [p['name'] for p in sorted(products, key=lambda p: (p['sort_order'], p['id']))]
    # Ensure C is now earlier than B (indicating reorder took effect)
    assert backend_order.index('C') < backend_order.index('B'), "Product C should appear before B after moving up twice"
