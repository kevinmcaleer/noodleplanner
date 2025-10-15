import os
import pytest
from fastapi.testclient import TestClient
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import app
from db import create_tables, add_test_user, DATABASE_URL, get_db
from routes import create_access_token
def add_test_project_for_user(username, project_name):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        user_row = cursor.fetchone()
        if user_row:
            owner_id = user_row[0]
            cursor.execute('INSERT INTO projects (name, owner) VALUES (?, ?)', (project_name, owner_id))
            conn.commit()
def test_list_user_projects():
    # Register and login as alice
    client.post("/register", data={"username": "alice", "fullname": "Alice Wonderland", "password": "secret"})
    # Add a test project for alice
    add_test_project_for_user("alice", "Project Alpha")
    # Create JWT token for alice
    token = create_access_token(data={"sub": "alice"})
    client.cookies.set("token", token)
    response = client.get("/projects")
    assert response.status_code == 200
    assert b"Project Alpha" in response.content

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    # Remove the test database if it exists
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)
    create_tables()
    add_test_user()
    yield
    # Clean up after tests
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)

def test_login_success():
    response = client.post("/token", data={"username": "alice", "password": "secret"})
    assert response.status_code == 200
    assert "access_token" in response.json()
    assert response.json()["token_type"] == "bearer"

def test_login_failure():
    response = client.post("/token", data={"username": "alice", "password": "wrongpass"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect username or password"

def test_get_current_user():
    # First, login to get a token
    login_response = client.post("/token", data={"username": "alice", "password": "secret"})
    token = login_response.json()["access_token"]
    response = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["username"] == "alice"

def test_logout():
    # Register and login as alice
    client.post("/register", data={"username": "alice", "fullname": "Alice Wonderland", "password": "secret"})
    # Create JWT token for alice
    token = create_access_token(data={"sub": "alice"})
    client.cookies.set("token", token)
    response = client.post("/logout", follow_redirects=False)
    # Should redirect to /login
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/login"
