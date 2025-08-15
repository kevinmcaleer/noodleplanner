import os
import pytest
from fastapi.testclient import TestClient
import sys
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

def test_planning_room_access_and_product_add():
    username = create_and_login_user()
    project_id = create_project_for_user(username, "Project Alpha")
    # Access planning room
    response = client.get(f"/projects/{project_id}")
    assert response.status_code == 200
    assert b"<title>Planning Room - NoodlePlanner</title>" in response.content
    # Add a product
    response = client.post(f"/projects/{project_id}/products", data={"product_name": "Product X"})
    assert response.status_code == 200
    assert b"Product X" in response.content
    assert b"Product X" in response.content
    # Add empty product (should error)
    response = client.post(f"/projects/{project_id}/products", data={"product_name": "   "})
    assert response.status_code == 200

def test_planning_room_unauthenticated():
    # Try to access planning room without login
    response = client.get("/projects/1", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/login"
    # Try to add product without login
    response = client.post("/projects/1/products", data={"product_name": "Product Y"}, follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/login"
