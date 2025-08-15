import os
import pytest
from fastapi.testclient import TestClient
from app import app
from db import create_tables, DATABASE_URL, get_db

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    # Remove the test database if it exists
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)
    create_tables()
    yield
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)

def test_register_success():
    response = client.post("/register", data={"username": "bob", "fullname": "Bob Builder", "password": "secret"})
    assert response.status_code == 200
    assert b"Registration successful" in response.content
    # Try to login with the new user
    login_response = client.post("/login", data={"username": "bob", "password": "secret"})
    assert login_response.status_code == 200 or login_response.status_code == 302

def test_register_duplicate_username():
    # Register once
    client.post("/register", data={"username": "bob", "fullname": "Bob Builder", "password": "secret"})
    # Register again with same username
    response = client.post("/register", data={"username": "bob", "fullname": "Another Bob", "password": "other"})
    assert response.status_code == 200
    assert b"Username already taken" in response.content

def test_login_success():
    # Register first
    client.post("/register", data={"username": "alice", "fullname": "Alice Wonderland", "password": "secret"})
    # Login
    response = client.post("/login", data={"username": "alice", "password": "secret"})
    assert response.status_code == 200 or response.status_code == 302

def test_login_failure():
    # Register first
    client.post("/register", data={"username": "alice", "fullname": "Alice Wonderland", "password": "secret"})
    # Wrong password
    response = client.post("/login", data={"username": "alice", "password": "wrongpass"})
    assert response.status_code == 200
    assert b"Invalid username or password" in response.content
