"""Security middleware and helpers for NoodlePlanner web application.

Provides:
- Security headers (CSP, HSTS, X-Frame-Options, etc.)
- Rate limiting (per-IP, in-memory)
- Request body size limiting
- Error message sanitization
- Optional API key authentication
"""

import logging
import os
import time
from collections import defaultdict
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()


def is_production() -> bool:
    return ENVIRONMENT == "production"


# ---------------------------------------------------------------------------
# Security Headers Middleware
# ---------------------------------------------------------------------------

SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; "
        "img-src 'self' data: blob:; "
        "connect-src 'self'"
    ),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every response."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers[header] = value
        return response


# ---------------------------------------------------------------------------
# Rate Limiting Middleware
# ---------------------------------------------------------------------------

# Per-IP request tracking: {ip: [(timestamp, ...), ...]}
_rate_limit_store: dict[str, list[float]] = defaultdict(list)

RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))  # seconds


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request headers or connection info."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    if request.client:
        return request.client.host
    return "unknown"


def _is_rate_limited(ip: str) -> tuple[bool, int]:
    """Check if an IP has exceeded the rate limit.

    Returns (is_limited, retry_after_seconds).
    """
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW

    # Prune old entries
    _rate_limit_store[ip] = [
        ts for ts in _rate_limit_store[ip] if ts > window_start
    ]

    if len(_rate_limit_store[ip]) >= RATE_LIMIT_REQUESTS:
        oldest = min(_rate_limit_store[ip])
        retry_after = int(oldest + RATE_LIMIT_WINDOW - now) + 1
        return True, max(retry_after, 1)

    _rate_limit_store[ip].append(now)
    return False, 0


def reset_rate_limit_store() -> None:
    """Clear the rate limit store. Useful for testing."""
    _rate_limit_store.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory per-IP rate limiting."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        ip = _get_client_ip(request)
        limited, retry_after = _is_rate_limited(ip)

        if limited:
            logger.warning("Rate limit exceeded for IP %s", ip)
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
                headers={"Retry-After": str(retry_after)},
            )

        return await call_next(request)


# ---------------------------------------------------------------------------
# Request Body Size Limit Middleware
# ---------------------------------------------------------------------------

MAX_BODY_SIZE = int(os.getenv("MAX_BODY_SIZE", str(10 * 1024 * 1024)))  # 10 MB


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length exceeds the configured maximum."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_BODY_SIZE:
            logger.warning(
                "Request body too large: %s bytes from %s",
                content_length,
                _get_client_ip(request),
            )
            return JSONResponse(
                status_code=413,
                content={"detail": "Request body too large."},
            )
        return await call_next(request)


# ---------------------------------------------------------------------------
# Error Sanitization Middleware
# ---------------------------------------------------------------------------


class ErrorSanitizationMiddleware(BaseHTTPMiddleware):
    """Catch unhandled exceptions and return generic messages in production."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        try:
            response = await call_next(request)
            return response
        except Exception as exc:
            logger.error(
                "Unhandled exception on %s %s: %s",
                request.method,
                request.url.path,
                exc,
                exc_info=True,
            )
            if is_production():
                return JSONResponse(
                    status_code=500,
                    content={"detail": "An internal error occurred."},
                )
            # In development, re-raise so FastAPI shows the full traceback
            raise


# ---------------------------------------------------------------------------
# API Key Authentication Middleware
# ---------------------------------------------------------------------------

API_KEY = os.getenv("API_KEY", "")

# Paths that never require authentication
_PUBLIC_PATHS = frozenset({"/health", "/healthz", "/health/", "/favicon.png", "/logo.png"})


def _requires_auth(path: str) -> bool:
    """Determine whether a request path requires authentication."""
    if path in _PUBLIC_PATHS:
        return False
    # Static assets are always public
    if path.startswith("/static/"):
        return False
    return True


class APIKeyAuthMiddleware(BaseHTTPMiddleware):
    """Optional API key authentication.

    When the API_KEY environment variable is set, every request (except
    health checks and static assets) must include a valid
    ``Authorization: Bearer <key>`` header.

    When API_KEY is empty or unset, all requests are allowed through.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not API_KEY:
            return await call_next(request)

        if not _requires_auth(request.url.path):
            return await call_next(request)

        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer ") and auth_header[7:] == API_KEY:
            return await call_next(request)

        logger.warning(
            "Unauthorized request to %s from %s",
            request.url.path,
            _get_client_ip(request),
        )
        return JSONResponse(
            status_code=401,
            content={"detail": "Unauthorized. Provide a valid API key."},
        )
