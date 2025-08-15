import pytest
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

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
    response = client.post("/logout")
    assert response.status_code == 200
    assert response.json()["message"] == "Logged out successfully"
