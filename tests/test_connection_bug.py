import os
from test_helpers import create_test_jwt_token
import sys
import re
import json
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


def create_and_login_user(username="bob", password="secret"):
    client.post("/register", data={"username": username, "fullname": "Bob Builder", "password": password})
    client.post("/login", data={"username": username, "password": password})
    client.cookies.set("token", username)
    return username


def create_project_with_parent_child(username):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        owner_id = cursor.fetchone()[0]
        cursor.execute('INSERT INTO projects (name, owner) VALUES (?, ?)', ("Conn Test", owner_id))
        conn.commit()
        cursor.execute('SELECT id FROM projects WHERE name = ? AND owner = ?', ("Conn Test", owner_id))
        project_id = cursor.fetchone()[0]
        # parent product
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?,?,NULL,1)', ("Parent", project_id))
        conn.commit()
        cursor.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("Parent", project_id))
        parent_id = cursor.fetchone()[0]
        # child product
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?,?,?,1)', ("Child", project_id, parent_id))
        conn.commit()
        cursor.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("Child", project_id))
        child_id = cursor.fetchone()[0]
        return project_id, parent_id, child_id


def extract_products_from_html(html_text):
    m = re.search(r'<script id="all-products-json" type="application/json">(.*?)</script>', html_text, re.DOTALL)
    assert m, "all-products-json script tag not found"
    return json.loads(m.group(1))


def test_edit_description_does_not_break_connection():
    username = create_and_login_user()
    project_id, parent_id, child_id = create_project_with_parent_child(username)

    # 1. Fetch products (HTML) and extract JSON
    r = client.get(f"/projects/{project_id}")
    assert r.status_code == 200
    products = extract_products_from_html(r.text)
    parent = next((p for p in products if p['id'] == parent_id), None)
    child = next((p for p in products if p['id'] == child_id), None)
    assert parent and child and child['plan_id'] == parent['id']

    # 2. Edit child's description
    payload = {"description": "Updated description"}
    r2 = client.post(f"/projects/update-product-order/{child_id}", json=payload)
    assert r2.status_code == 200

    # 3. Fetch products again and ensure relationship intact
    r3 = client.get(f"/projects/{project_id}")
    assert r3.status_code == 200
    products2 = extract_products_from_html(r3.text)
    child2 = next((p for p in products2 if p['id'] == child_id), None)
    assert child2 and child2['plan_id'] == parent_id
    # Optional: ensure description updated (if included in template JSON)
    # If description not part of JSON, this assertion is skipped safely.
    if 'description' in child2:
        assert child2['description'] == 'Updated description'

