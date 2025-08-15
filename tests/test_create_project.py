import os
import pytest
from fastapi.testclient import TestClient
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import app
from db import create_tables, DATABASE_URL

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)
    create_tables()
    yield
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)

def test_create_project_success():
    # Register and login as alice
    client.post("/register", data={"username": "alice", "fullname": "Alice Wonderland", "password": "secret"})
    client.post("/login", data={"username": "alice", "password": "secret"})
    client.cookies.set("token", "alice")
    # Create a new project
    response = client.post("/projects/create", data={"project_name": "Project Beta"})
    assert response.status_code == 200
    assert b"Project created successfully" in response.content
    assert b"Project Beta" in response.content

def test_create_project_empty_name():
    client.post("/register", data={"username": "alice", "fullname": "Alice Wonderland", "password": "secret"})
    client.post("/login", data={"username": "alice", "password": "secret"})
    client.cookies.set("token", "alice")
    response = client.post("/projects/create", data={"project_name": "   "})
    assert response.status_code == 200
    assert b"Project name cannot be empty" in response.content

def test_create_project_unauthenticated():
    response = client.post("/projects/create", data={"project_name": "Project Gamma"}, follow_redirects=False)
    # Should redirect to login
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/login"
