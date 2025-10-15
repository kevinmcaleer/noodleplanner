"""Helper functions for tests."""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from routes import create_access_token


def create_test_jwt_token(username: str) -> str:
    """Create a JWT token for testing purposes."""
    return create_access_token(data={"sub": username})
