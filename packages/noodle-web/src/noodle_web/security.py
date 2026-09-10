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

from fastapi import Request, Response, WebSocket
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
# Static Asset Cache Control Middleware
# ---------------------------------------------------------------------------


class StaticCacheControlMiddleware(BaseHTTPMiddleware):
    """Force revalidation on every /static/ response instead of letting an
    intermediary (a CDN edge, a corporate proxy) cache it for an arbitrary
    default TTL with no way to invalidate it on demand.

    Most static assets already carry a per-deploy ?v= hash in their URL
    (see STATIC_VERSION in app.py) and so are safe to cache indefinitely --
    a changed file gets a changed URL. But a handful of files are reached
    through a plain, unversioned path: dynamic `import()` calls inside
    already-served JS modules (e.g. script.js importing '/static/
    pptx-export.js'), and vendored libraries' own internal imports of their
    dependencies (e.g. pptxgen.es.js importing the jszip shim) -- none of
    which go through Jinja2 templating, so they can't pick up ?v=.

    Without this, fixing a bug in one of those files can still appear
    broken for users behind a CDN that cached the old bytes for its own
    default TTL (observed: jszip/#977's fix was correctly deployed and
    served fresh from origin, but a stale Cloudflare edge cache kept
    serving the pre-fix file for hours afterward).

    `no-cache` does not mean "don't cache" -- it means "cache, but always
    revalidate with the origin first" (a conditional GET against the
    ETag/Last-Modified StaticFiles already sends). For unchanged files that
    revalidation is a fast 304; for changed ones it picks up the new bytes
    immediately instead of waiting out a TTL. Applied uniformly rather than
    only to the unversioned paths, since revalidating a ?v=-versioned asset
    is equally cheap and this stays correct if a future asset is added
    without going through the version-hash convention.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/static/") and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "no-cache"
        return response


# ---------------------------------------------------------------------------
# Rate Limiting Middleware
# ---------------------------------------------------------------------------

# Per-IP request tracking: {ip: [(timestamp, ...), ...]}
_rate_limit_store: dict[str, list[float]] = defaultdict(list)

RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))  # seconds


def _extract_client_ip(headers, client) -> str:
    """Shared IP-extraction logic for both HTTP requests and WebSockets --
    `Request.headers`/`.client` and `WebSocket.headers`/`.client` share the
    same shape, so one implementation covers both call sites below."""
    forwarded = headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    if client:
        return client.host
    return "unknown"


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request headers or connection info."""
    return _extract_client_ip(request.headers, request.client)


def get_websocket_client_ip(websocket: WebSocket) -> str:
    """Extract client IP from a WebSocket connection, same X-Forwarded-For /
    X-Real-IP convention as `_get_client_ip()` above. Used by collab_session
    join-attempt rate limiting (#965) -- a WebSocket handshake attempt has
    no per-request middleware pass, so the check has to be made explicitly
    at the point of admission rather than via RateLimitMiddleware."""
    return _extract_client_ip(websocket.headers, websocket.client)


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


# ---------------------------------------------------------------------------
# Collab-session join-attempt rate limiting (#965)
# ---------------------------------------------------------------------------
#
# A join attempt is a WebSocket handshake, not an HTTP request, so
# RateLimitMiddleware above (which only runs on the HTTP request/response
# cycle) never sees it -- collab_session_ws() in app.py calls
# `is_join_rate_limited()` explicitly instead. Kept as a separate
# store/threshold from the general limiter above because a join attempt is
# a more sensitive action than ordinary request volume (each one is
# effectively a guess at a 6-digit join_code, i.e. 1-in-1,000,000 odds per
# guess) -- a tighter budget than RATE_LIMIT_REQUESTS/RATE_LIMIT_WINDOW, but
# still generous enough that a dropped joiner reconnecting a few times in a
# row (network blip, tab backgrounded) never gets caught by it.

_join_rate_limit_store: dict[str, list[float]] = defaultdict(list)

JOIN_RATE_LIMIT_ATTEMPTS = int(os.getenv("COLLAB_JOIN_RATE_LIMIT_ATTEMPTS", "10"))
JOIN_RATE_LIMIT_WINDOW = int(os.getenv("COLLAB_JOIN_RATE_LIMIT_WINDOW", "60"))  # seconds


def is_join_rate_limited(ip: str) -> tuple[bool, int]:
    """Same sliding-window algorithm as `_is_rate_limited()` above, applied
    to join attempts specifically.

    Returns (is_limited, retry_after_seconds).
    """
    now = time.time()
    window_start = now - JOIN_RATE_LIMIT_WINDOW

    _join_rate_limit_store[ip] = [
        ts for ts in _join_rate_limit_store[ip] if ts > window_start
    ]

    if len(_join_rate_limit_store[ip]) >= JOIN_RATE_LIMIT_ATTEMPTS:
        oldest = min(_join_rate_limit_store[ip])
        retry_after = int(oldest + JOIN_RATE_LIMIT_WINDOW - now) + 1
        return True, max(retry_after, 1)

    _join_rate_limit_store[ip].append(now)
    return False, 0


def forgive_join_attempt(ip: str) -> None:
    """Un-count one join attempt from `ip` after it turned out to be a
    legitimate, successful join (#971).

    The budget above exists to throttle *guessing* at a six-digit code. A
    join that presented the correct code is not a guess, and counting it
    made the limiter contradict the epic's own acceptance criterion: #766
    requires at least 10 concurrent joiners, but a team sitting in one
    office shares a single public IP, so the eleventh colleague to join
    within a minute was refused. That was found by the #971 load test,
    which could not get 12 joiners onto one session.

    Forgiving only successes keeps the security property exactly as it was
    -- ten *wrong* codes in a window still locks the source out, and an
    attacker gains nothing, since forgiveness requires already knowing the
    code they are trying to find.

    Removes the most recent timestamp rather than a specific one: under
    concurrent joins the entries are interchangeable, and it is the count
    that the limit is expressed in.
    """
    attempts = _join_rate_limit_store.get(ip)
    if attempts:
        attempts.pop()


def reset_join_rate_limit_store() -> None:
    """Clear the join-attempt rate limit store. Useful for testing."""
    _join_rate_limit_store.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory per-IP rate limiting.

    Static assets are exempt. A single page load now pulls 50+ files under
    /static/ (the app has grown a lot -- whiteboard, ribbon, task-peek, ...),
    so counting each one against the same budget as API calls meant two page
    loads within RATE_LIMIT_WINDOW could exhaust it and 429 the rest of the
    page load outright -- including ribbon.js itself, which is what made the
    ribbon (and everything else) appear to silently break. Static files are
    not a meaningful attack surface for this limiter to protect and serving
    them isn't a resource cost worth rate-limiting the way API/render calls
    are.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.url.path.startswith("/static/"):
            return await call_next(request)

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
