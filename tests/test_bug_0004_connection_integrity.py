import os
import sys
import json
import re
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


def create_and_login_user(username="conn", password="secret"):
    client.post("/register", data={"username": username, "fullname": "Conn User", "password": password})
    client.post("/login", data={"username": username, "password": password})
    client.cookies.set("token", username)
    return username


def create_project_with_hierarchy(username):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute('SELECT id FROM users WHERE username = ?', (username,))
        owner_id = cur.fetchone()[0]
        cur.execute('INSERT INTO projects (name, owner) VALUES (?, ?)', ("Conn Integrity", owner_id))
        conn.commit()
        cur.execute('SELECT id FROM projects WHERE name = ? AND owner = ?', ("Conn Integrity", owner_id))
        project_id = cur.fetchone()[0]
        # parent
        cur.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?,?,NULL,1)', ("Parent", project_id))
        conn.commit()
        cur.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("Parent", project_id))
        parent_id = cur.fetchone()[0]
        # two children
        cur.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?,?,?,1)', ("ChildA", project_id, parent_id))
        cur.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?,?,?,2)', ("ChildB", project_id, parent_id))
        conn.commit()
        cur.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("ChildA", project_id))
        child_a_id = cur.fetchone()[0]
        cur.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("ChildB", project_id))
        child_b_id = cur.fetchone()[0]
    return project_id, parent_id, child_a_id, child_b_id


def extract_products(html_text):
    m = re.search(r'<script id="all-products-json" type="application/json">(.*?)</script>', html_text, re.DOTALL)
    assert m, "all-products-json script tag not found"
    return json.loads(m.group(1))


def get_product(products, pid):
    return next((p for p in products if p['id'] == pid), None)


def test_bug_0004_non_structural_edit_preserves_hierarchy_and_order():
    """Regression test for BUG-0004: Editing description must not change plan_id or sibling ordering."""
    username = create_and_login_user()
    project_id, parent_id, child_a_id, child_b_id = create_project_with_hierarchy(username)

    r1 = client.get(f"/projects/{project_id}")
    assert r1.status_code == 200
    products1 = extract_products(r1.text)
    child_a1 = get_product(products1, child_a_id)
    child_b1 = get_product(products1, child_b_id)
    assert child_a1 and child_b1
    assert child_a1['plan_id'] == parent_id and child_b1['plan_id'] == parent_id
    original_order = {p['id']: p['sort_order'] for p in products1}

    # Edit description only for ChildA
    resp = client.post(f"/projects/update-product-order/{child_a_id}", json={"description": "Updated desc"})
    assert resp.status_code == 200

    r2 = client.get(f"/projects/{project_id}")
    products2 = extract_products(r2.text)
    child_a2 = get_product(products2, child_a_id)
    child_b2 = get_product(products2, child_b_id)
    assert child_a2 is not None and child_b2 is not None, "Children should still exist after non-structural edit"
    assert child_a2['plan_id'] == parent_id
    assert child_b2['plan_id'] == parent_id
    # Sibling ordering unchanged
    assert original_order[child_a_id] == child_a2['sort_order']
    assert original_order[child_b_id] == child_b2['sort_order']


def test_bug_0004_structural_edit_triggers_expected_changes():
    """Changing plan_id should move child to root and resequence former siblings only."""
    username = create_and_login_user("conn2")
    project_id, parent_id, child_a_id, child_b_id = create_project_with_hierarchy(username)
    # Move ChildB to root (plan_id null) using structural update
    resp = client.post(f"/projects/update-product-order/{child_b_id}", json={"plan_id": None})
    assert resp.status_code == 200
    r = client.get(f"/projects/{project_id}")
    products = extract_products(r.text)
    child_a = get_product(products, child_a_id)
    child_b = get_product(products, child_b_id)
    assert child_a is not None and child_b is not None, "Children should exist"
    assert child_b['plan_id'] is None, "ChildB should now be root"
    assert child_a['plan_id'] == parent_id, "ChildA should remain under original parent"
    # Resequencing: ChildA should still have sort_order within its sibling set starting at 1
    assert child_a['sort_order'] == 1, "Remaining single child should have sort_order 1"
