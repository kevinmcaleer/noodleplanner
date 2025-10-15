import pytest
from fastapi.testclient import TestClient
import sys
import os
from test_helpers import create_test_jwt_token
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import app
from db import create_tables, DATABASE_URL, get_db

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
    client.cookies.set("token", create_test_jwt_token(username))
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

def test_rename_product():
    username = create_and_login_user()
    project_id = create_project_for_user(username, "Project Beta")
    # Add a product
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?, ?, NULL, 1)', ("Old Name", project_id))
        conn.commit()
        cursor.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("Old Name", project_id))
        product_id = cursor.fetchone()[0]
    # Rename the product
    response = client.post(f"/rename-product/{product_id}", json={"name": "New Name"})
    assert response.status_code == 200
    assert response.json().get("success")
    # Check DB
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT name FROM products WHERE id = ?', (product_id,))
        assert cursor.fetchone()[0] == "New Name"

def test_move_product_updates_sort_order():
    username = create_and_login_user()
    project_id = create_project_for_user(username, "Project Gamma")
    # Add two products
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?, ?, NULL, 1)', ("A", project_id))
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?, ?, NULL, 2)', ("B", project_id))
        conn.commit()
        cursor.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("A", project_id))
        a_id = cursor.fetchone()[0]
        cursor.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("B", project_id))
        b_id = cursor.fetchone()[0]
    # Move B above A (simulate move up)
    response = client.post(f"/projects/move-product-up/{b_id}")
    assert response.status_code == 200
    # Check sort_order
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT name, sort_order FROM products WHERE id IN (?, ?)', (a_id, b_id))
        results = {row[0]: row[1] for row in cursor.fetchall()}
        assert results["B"] == 1
        assert results["A"] == 2

def test_indent_outdent_product():
    username = create_and_login_user()
    project_id = create_project_for_user(username, "Project Delta")
    # Add three products
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?, ?, NULL, 1)', ("A", project_id))
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?, ?, NULL, 2)', ("B", project_id))
        cursor.execute('INSERT INTO products (name, project_id, plan_id, sort_order) VALUES (?, ?, NULL, 3)', ("C", project_id))
        conn.commit()
        cursor.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("B", project_id))
        b_id = cursor.fetchone()[0]
        cursor.execute('SELECT id FROM products WHERE name = ? AND project_id = ?', ("A", project_id))
        a_id = cursor.fetchone()[0]
    # Indent B under A
    response = client.post(f"/projects/indent-product/{b_id}")
    assert response.status_code == 200
    # Check parent
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT plan_id FROM products WHERE id = ?', (b_id,))
        assert cursor.fetchone()[0] == a_id
    # Outdent B
    response = client.post(f"/projects/outdent-product/{b_id}")
    assert response.status_code == 200
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT plan_id FROM products WHERE id = ?', (b_id,))
        assert cursor.fetchone()[0] is None
