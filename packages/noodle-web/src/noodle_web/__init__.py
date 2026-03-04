"""Noodle Web - Web application for project planning."""

from .app import app
from .database import init_db, test_connection
from .middleware import ActivityLoggingMiddleware
from .security import (
    SecurityHeadersMiddleware,
    RateLimitMiddleware,
    BodySizeLimitMiddleware,
    ErrorSanitizationMiddleware,
    APIKeyAuthMiddleware,
)

__version__ = "1.0.0"

__all__ = [
    "app",
    "init_db",
    "test_connection",
    "ActivityLoggingMiddleware",
    "SecurityHeadersMiddleware",
    "RateLimitMiddleware",
    "BodySizeLimitMiddleware",
    "ErrorSanitizationMiddleware",
    "APIKeyAuthMiddleware",
]
