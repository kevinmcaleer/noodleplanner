"""Noodle Web - Web application for project planning."""

from .app import app
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
    "SecurityHeadersMiddleware",
    "RateLimitMiddleware",
    "BodySizeLimitMiddleware",
    "ErrorSanitizationMiddleware",
    "APIKeyAuthMiddleware",
]
