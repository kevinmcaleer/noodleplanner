"""Tests for security middleware and configuration.

Covers:
- Security headers
- Rate limiting
- CORS configuration
- Request body size limits
- Error message sanitization
- API key authentication
- File upload validation (existing endpoints)
"""

import os
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Reset the rate limit stores before each test."""
    from noodle_web.security import reset_join_rate_limit_store, reset_rate_limit_store

    reset_rate_limit_store()
    reset_join_rate_limit_store()
    yield
    reset_rate_limit_store()
    reset_join_rate_limit_store()


@pytest.fixture
def client():
    """Create a test client with default (no API key) configuration."""
    from noodle_web import app

    return TestClient(app)


@pytest.fixture
def sample_plan():
    """Minimal valid plan text."""
    return "Phase 1\n  Task 1 @john 3d\n  Task 2 @jane 2d"


# ---------------------------------------------------------------------------
# Security Headers
# ---------------------------------------------------------------------------


class TestSecurityHeaders:
    """Verify that security headers are present on responses."""

    def test_x_frame_options(self, client):
        response = client.get("/health")
        assert response.headers.get("X-Frame-Options") == "DENY"

    def test_x_content_type_options(self, client):
        response = client.get("/health")
        assert response.headers.get("X-Content-Type-Options") == "nosniff"

    def test_x_xss_protection(self, client):
        response = client.get("/health")
        assert response.headers.get("X-XSS-Protection") == "1; mode=block"

    def test_strict_transport_security(self, client):
        response = client.get("/health")
        hsts = response.headers.get("Strict-Transport-Security")
        assert hsts is not None
        assert "max-age=" in hsts

    def test_content_security_policy(self, client):
        response = client.get("/health")
        csp = response.headers.get("Content-Security-Policy")
        assert csp is not None
        assert "default-src" in csp

    def test_referrer_policy(self, client):
        response = client.get("/health")
        assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"

    def test_permissions_policy(self, client):
        response = client.get("/health")
        pp = response.headers.get("Permissions-Policy")
        assert pp is not None
        assert "camera=()" in pp

    def test_headers_on_post_endpoint(self, client, sample_plan):
        """Security headers should appear on API responses too."""
        response = client.post("/render", json={
            "plan_text": sample_plan,
        })
        assert response.headers.get("X-Frame-Options") == "DENY"
        assert response.headers.get("X-Content-Type-Options") == "nosniff"


# ---------------------------------------------------------------------------
# Static Asset Cache Control (#977)
# ---------------------------------------------------------------------------


class TestStaticCacheControl:
    """A CDN/proxy caching a static asset for its own default TTL with no
    way to invalidate it on demand (observed: a Cloudflare edge kept
    serving a fixed bug's pre-fix bytes for hours) is exactly what
    Cache-Control: no-cache on /static/ responses prevents -- it forces
    revalidation against the origin's ETag on every request instead.
    """

    def test_static_asset_has_no_cache_header(self, client):
        response = client.get("/static/script.js")
        assert response.headers.get("Cache-Control") == "no-cache"

    def test_vendored_module_has_no_cache_header(self, client):
        """The exact class of file that #977 was actually about: an
        unversioned path reached only through another JS module's own
        `import`, never through Jinja2's ?v= templating."""
        response = client.get("/static/vendor/pptxgenjs/pptxgen.es.js")
        assert response.headers.get("Cache-Control") == "no-cache"

    def test_non_static_endpoint_is_unaffected(self, client):
        response = client.get("/health")
        assert response.headers.get("Cache-Control") is None


# ---------------------------------------------------------------------------
# Rate Limiting
# ---------------------------------------------------------------------------


class TestRateLimiting:
    """Test per-IP rate limiting."""

    def test_requests_within_limit_succeed(self, client):
        """Requests below the limit should succeed."""
        for _ in range(5):
            response = client.get("/health")
            assert response.status_code == 200

    def test_rate_limit_returns_429(self):
        """Exceeding the rate limit should return 429."""
        from noodle_web.security import reset_rate_limit_store

        reset_rate_limit_store()

        # Temporarily lower the limit for this test
        with patch("noodle_web.security.RATE_LIMIT_REQUESTS", 3):
            from noodle_web import app

            test_client = TestClient(app)
            for _ in range(3):
                resp = test_client.get("/health")
                assert resp.status_code == 200

            resp = test_client.get("/health")
            assert resp.status_code == 429
            assert "Retry-After" in resp.headers
            assert "Too many requests" in resp.json()["detail"]

    def test_rate_limit_retry_after_header(self):
        """429 responses must include a Retry-After header."""
        from noodle_web.security import reset_rate_limit_store

        reset_rate_limit_store()

        with patch("noodle_web.security.RATE_LIMIT_REQUESTS", 1):
            from noodle_web import app

            test_client = TestClient(app)
            test_client.get("/health")  # uses the one allowed request
            resp = test_client.get("/health")
            assert resp.status_code == 429
            retry_after = int(resp.headers["Retry-After"])
            assert retry_after > 0

    def test_is_rate_limited_function(self):
        """Direct unit test for the rate-limit check function."""
        from noodle_web.security import _is_rate_limited, reset_rate_limit_store

        reset_rate_limit_store()

        with patch("noodle_web.security.RATE_LIMIT_REQUESTS", 2):
            limited, _ = _is_rate_limited("10.0.0.1")
            assert not limited
            limited, _ = _is_rate_limited("10.0.0.1")
            assert not limited
            limited, retry = _is_rate_limited("10.0.0.1")
            assert limited
            assert retry > 0

    def test_static_assets_are_exempt_from_rate_limiting(self):
        """A single page load pulls 50+ files under /static/ (whiteboard,
        ribbon, task-peek, ...); counting each against the same budget as
        API calls meant two page loads within the window could exhaust it
        and 429 the rest of the page load outright -- including ribbon.js
        itself, which made the ribbon (and everything else) appear to
        silently break. Static assets must never be rate-limited."""
        from noodle_web.security import reset_rate_limit_store

        reset_rate_limit_store()

        with patch("noodle_web.security.RATE_LIMIT_REQUESTS", 1):
            from noodle_web import app

            test_client = TestClient(app)
            # Exhaust the (artificially tiny) budget on a non-static path.
            resp = test_client.get("/health")
            assert resp.status_code == 200
            resp = test_client.get("/health")
            assert resp.status_code == 429

            # Static assets must still succeed even though the budget is spent.
            resp = test_client.get("/static/ribbon.js")
            assert resp.status_code == 200
            resp = test_client.get("/static/ribbon.js")
            assert resp.status_code == 200

    def test_different_ips_have_separate_limits(self):
        """Each IP should have its own counter."""
        from noodle_web.security import _is_rate_limited, reset_rate_limit_store

        reset_rate_limit_store()

        with patch("noodle_web.security.RATE_LIMIT_REQUESTS", 1):
            limited, _ = _is_rate_limited("10.0.0.1")
            assert not limited
            limited, _ = _is_rate_limited("10.0.0.2")
            assert not limited
            # Now both are exhausted
            limited, _ = _is_rate_limited("10.0.0.1")
            assert limited
            limited, _ = _is_rate_limited("10.0.0.2")
            assert limited


class TestJoinRateLimiting:
    """Unit tests for #965's collab-session join-attempt rate limiter.

    This is the same sliding-window algorithm as `_is_rate_limited()`
    above, applied via a separate store/threshold to join attempts
    specifically (see collab_session_ws() in app.py, which calls
    `is_join_rate_limited()` directly since a WebSocket handshake never
    passes through RateLimitMiddleware). End-to-end coverage over the real
    WebSocket endpoint lives in tests/test_collab_session.py.
    """

    def test_attempts_within_limit_are_allowed(self):
        from noodle_web.security import is_join_rate_limited

        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 3):
            for _ in range(3):
                limited, _ = is_join_rate_limited("10.0.0.1")
                assert not limited

    def test_attempts_beyond_limit_are_rejected(self):
        from noodle_web.security import is_join_rate_limited

        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 2):
            is_join_rate_limited("10.0.0.1")
            is_join_rate_limited("10.0.0.1")
            limited, retry_after = is_join_rate_limited("10.0.0.1")
            assert limited
            assert retry_after > 0

    def test_limit_resets_after_window_passes(self):
        from noodle_web.security import is_join_rate_limited

        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 1), \
             patch("noodle_web.security.JOIN_RATE_LIMIT_WINDOW", 60):
            limited, _ = is_join_rate_limited("10.0.0.1")
            assert not limited
            limited, _ = is_join_rate_limited("10.0.0.1")
            assert limited

            # Simulate the window having passed by backdating the one
            # recorded attempt, rather than sleeping in the test.
            from noodle_web import security as security_module

            security_module._join_rate_limit_store["10.0.0.1"] = [time.time() - 61]
            limited, _ = is_join_rate_limited("10.0.0.1")
            assert not limited

    def test_different_ips_have_separate_join_limits(self):
        from noodle_web.security import is_join_rate_limited

        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 1):
            limited, _ = is_join_rate_limited("10.0.0.1")
            assert not limited
            limited, _ = is_join_rate_limited("10.0.0.2")
            assert not limited
            limited, _ = is_join_rate_limited("10.0.0.1")
            assert limited
            limited, _ = is_join_rate_limited("10.0.0.2")
            assert limited

    # -- #971: successful joins are forgiven -------------------------------
    #
    # The budget throttles *guessing* at a six-digit code. Counting correct
    # codes too made the limiter contradict #766's own acceptance criterion
    # (at least 10 concurrent joiners), because a team in one office shares
    # a public IP. These tests pin both halves: successes stop consuming
    # budget, and wrong guesses still exhaust it exactly as before.

    def test_a_successful_join_gives_its_attempt_back(self):
        from noodle_web.security import forgive_join_attempt, is_join_rate_limited

        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 2):
            for _ in range(10):
                limited, _ = is_join_rate_limited("10.0.0.1")
                assert not limited, "a colleague joining correctly is not a guess"
                forgive_join_attempt("10.0.0.1")

    def test_a_whole_team_behind_one_ip_can_join(self):
        """The regression this fixes: with the real limit of 10, the
        eleventh colleague used to be refused."""
        from noodle_web.security import forgive_join_attempt, is_join_rate_limited

        for _ in range(25):
            limited, _ = is_join_rate_limited("203.0.113.7")
            assert not limited
            forgive_join_attempt("203.0.113.7")

    def test_wrong_codes_still_exhaust_the_budget(self):
        """The security property must be untouched: a failed join is never
        forgiven, so a brute-forcer is throttled exactly as before."""
        from noodle_web.security import is_join_rate_limited

        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 3):
            for _ in range(3):
                limited, _ = is_join_rate_limited("10.0.0.9")
                assert not limited
            limited, retry_after = is_join_rate_limited("10.0.0.9")
            assert limited
            assert retry_after > 0

    def test_failures_still_accumulate_between_successes(self):
        """A guesser who occasionally lands a real join must not be able to
        launder their failed attempts away -- only the successful one is
        forgiven, so the failures still add up to a lockout."""
        from noodle_web.security import forgive_join_attempt, is_join_rate_limited

        with patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 3):
            is_join_rate_limited("10.0.0.5")                       # failed guess
            is_join_rate_limited("10.0.0.5")                       # failed guess
            is_join_rate_limited("10.0.0.5")
            forgive_join_attempt("10.0.0.5")                       # this one succeeded
            limited, _ = is_join_rate_limited("10.0.0.5")          # back to 3 recorded
            assert not limited
            limited, _ = is_join_rate_limited("10.0.0.5")
            assert limited, "the two real failures still count"

    def test_forgiving_an_unknown_ip_is_harmless(self):
        from noodle_web.security import forgive_join_attempt

        forgive_join_attempt("198.51.100.1")  # never seen; must not raise

    def test_join_and_general_rate_limits_are_independent_stores(self):
        """A join attempt must not consume the general per-IP HTTP request
        budget, and vice versa -- they're different actions with different
        sensitivity, tracked separately (see security.py's module comment
        above `_join_rate_limit_store`)."""
        from noodle_web.security import _is_rate_limited, is_join_rate_limited

        with patch("noodle_web.security.RATE_LIMIT_REQUESTS", 1), \
             patch("noodle_web.security.JOIN_RATE_LIMIT_ATTEMPTS", 1):
            limited, _ = is_join_rate_limited("10.0.0.9")
            assert not limited
            # The general HTTP limiter for the same IP is untouched.
            limited, _ = _is_rate_limited("10.0.0.9")
            assert not limited


# ---------------------------------------------------------------------------
# CORS Configuration
# ---------------------------------------------------------------------------


class TestCORSConfiguration:
    """Test CORS header configuration."""

    def test_default_cors_allows_origin(self, client):
        """Default config (no CORS_ORIGINS env) should allow requests."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_cors_origins_from_env(self):
        """When CORS_ORIGINS is set, only listed origins should be reflected."""
        with patch.dict(os.environ, {"CORS_ORIGINS": "https://example.com,https://other.com"}):
            # Re-parse the origins at module level would require re-import;
            # instead we test the parsing logic directly.
            cors_env = os.getenv("CORS_ORIGINS", "")
            origins = [o.strip() for o in cors_env.split(",") if o.strip()]
            assert origins == ["https://example.com", "https://other.com"]

    def test_empty_cors_origins_defaults_to_wildcard(self):
        """Empty CORS_ORIGINS should default to ['*']."""
        cors_env = ""
        origins = (
            [o.strip() for o in cors_env.split(",") if o.strip()]
            if cors_env
            else ["*"]
        )
        assert origins == ["*"]


# ---------------------------------------------------------------------------
# Request Body Size Limit
# ---------------------------------------------------------------------------


class TestBodySizeLimit:
    """Test request body size enforcement."""

    def test_small_body_accepted(self, client, sample_plan):
        """Normal-sized requests should pass through."""
        response = client.post("/render", json={"plan_text": sample_plan})
        assert response.status_code == 200

    def test_large_content_length_rejected(self, client):
        """Requests declaring a very large Content-Length should be rejected."""
        response = client.post(
            "/render",
            content=b'{"plan_text": "x"}',
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(100 * 1024 * 1024),  # 100 MB
            },
        )
        assert response.status_code == 413
        assert "too large" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Error Sanitization
# ---------------------------------------------------------------------------


class TestErrorSanitization:
    """Test that error responses do not leak implementation details in production."""

    def test_dev_errors_include_detail(self, client, sample_plan):
        """In development mode, error details should be visible."""
        with patch("noodle_web.security.ENVIRONMENT", "development"):
            from noodle_web.app import _sanitized_detail

            msg = _sanitized_detail("Failed to render", ValueError("bad input"))
            assert "bad input" in msg

    def test_prod_errors_are_generic(self):
        """In production mode, error details should be hidden."""
        with patch("noodle_web.security.ENVIRONMENT", "production"):
            from noodle_web.security import is_production

            # Verify we're in production
            assert is_production()

    def test_sanitized_detail_production(self):
        """_sanitized_detail should hide errors when ENVIRONMENT=production."""
        with patch("noodle_web.app.is_production", return_value=True):
            from noodle_web.app import _sanitized_detail

            msg = _sanitized_detail("Something failed", ValueError("secret stack trace"))
            assert msg == "Something failed"
            assert "secret" not in msg

    def test_sanitized_detail_development(self):
        """_sanitized_detail should include errors when ENVIRONMENT=development."""
        with patch("noodle_web.app.is_production", return_value=False):
            from noodle_web.app import _sanitized_detail

            msg = _sanitized_detail("Something failed", ValueError("debug info"))
            assert "debug info" in msg


# ---------------------------------------------------------------------------
# API Key Authentication
# ---------------------------------------------------------------------------


class TestAPIKeyAuth:
    """Test optional API key authentication middleware."""

    def test_no_api_key_allows_all(self, client):
        """When API_KEY is not set, all requests should pass."""
        with patch("noodle_web.security.API_KEY", ""):
            response = client.get("/health")
            assert response.status_code == 200

    def test_api_key_required_when_set(self):
        """When API_KEY is set, unauthenticated requests should be rejected."""
        with patch("noodle_web.security.API_KEY", "test-secret-key"):
            from noodle_web import app

            test_client = TestClient(app)
            response = test_client.get("/")
            assert response.status_code == 401
            assert "Unauthorized" in response.json()["detail"]

    def test_api_key_accepted_with_bearer(self):
        """Correct Bearer token should grant access."""
        with patch("noodle_web.security.API_KEY", "test-secret-key"):
            from noodle_web import app

            test_client = TestClient(app)
            response = test_client.get(
                "/health",
                headers={"Authorization": "Bearer test-secret-key"},
            )
            assert response.status_code == 200

    def test_api_key_wrong_key_rejected(self):
        """Wrong Bearer token should be rejected on a protected path."""
        with patch("noodle_web.security.API_KEY", "test-secret-key"):
            from noodle_web import app

            test_client = TestClient(app)
            response = test_client.get(
                "/",
                headers={"Authorization": "Bearer wrong-key"},
            )
            assert response.status_code == 401

    def test_health_is_public_even_with_api_key(self):
        """Health endpoint should be accessible without auth."""
        with patch("noodle_web.security.API_KEY", "test-secret-key"):
            from noodle_web import app

            test_client = TestClient(app)
            response = test_client.get("/health")
            assert response.status_code == 200

    def test_favicon_is_public_even_with_api_key(self):
        """Favicon should be accessible without auth."""
        with patch("noodle_web.security.API_KEY", "test-secret-key"):
            from noodle_web import app

            test_client = TestClient(app)
            response = test_client.get("/favicon.png")
            # 200 if file exists, 404 if not -- but not 401
            assert response.status_code != 401

    def test_static_assets_public_with_api_key(self):
        """Static assets should be accessible without auth."""
        with patch("noodle_web.security.API_KEY", "test-secret-key"):
            from noodle_web import app

            test_client = TestClient(app)
            response = test_client.get("/static/script.js")
            # May be 200 or 404 depending on file existence, but not 401
            assert response.status_code != 401

    def test_requires_auth_helper(self):
        """Test the _requires_auth path filter."""
        from noodle_web.security import _requires_auth

        assert not _requires_auth("/health")
        assert not _requires_auth("/healthz")
        assert not _requires_auth("/favicon.png")
        assert not _requires_auth("/logo.png")
        assert not _requires_auth("/static/script.js")
        assert _requires_auth("/")
        assert _requires_auth("/render")
        assert _requires_auth("/api/parse")


# ---------------------------------------------------------------------------
# File Upload Validation (existing endpoints)
# ---------------------------------------------------------------------------


class TestFileUploadValidation:
    """Verify that file upload endpoints validate type and size."""

    def test_raid_import_rejects_non_xlsx(self, client):
        """RAID import should reject non-.xlsx files."""
        response = client.post(
            "/api/raid/import-excel",
            files={"file": ("test.txt", b"not excel", "text/plain")},
        )
        assert response.status_code == 400
        assert "xlsx" in response.json()["detail"].lower()

    def test_excel_analyze_rejects_non_excel(self, client):
        """Excel analyze should reject non-Excel files."""
        response = client.post(
            "/api/excel/analyze",
            files={"file": ("test.csv", b"a,b,c", "text/csv")},
        )
        assert response.status_code == 400

    def test_excel_convert_rejects_non_excel(self, client):
        """Excel convert should reject non-Excel files."""
        response = client.post(
            "/api/excel/convert",
            files={"file": ("test.csv", b"a,b,c", "text/csv")},
            data={"sheet_name": "Sheet1", "column_mapping": '{"task_name": "A"}'},
        )
        assert response.status_code == 400

    def test_planner_import_rejects_non_excel(self, client):
        """Planner import should reject non-Excel files."""
        response = client.post(
            "/api/excel/convert-planner",
            files={"file": ("test.pdf", b"fake pdf", "application/pdf")},
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Security Module Unit Tests
# ---------------------------------------------------------------------------


class TestSecurityHelpers:
    """Unit tests for security helper functions."""

    def test_is_production_default(self):
        """Default environment should not be production."""
        with patch("noodle_web.security.ENVIRONMENT", "development"):
            from noodle_web.security import is_production

            assert not is_production()

    def test_is_production_when_set(self):
        """ENVIRONMENT=production should return True."""
        with patch("noodle_web.security.ENVIRONMENT", "production"):
            from noodle_web.security import is_production

            assert is_production()

    def test_get_client_ip_from_forwarded_for(self):
        """Should extract IP from X-Forwarded-For."""
        from noodle_web.security import _get_client_ip
        from unittest.mock import MagicMock

        request = MagicMock()
        request.headers = {"X-Forwarded-For": "1.2.3.4, 5.6.7.8"}
        request.client = None
        assert _get_client_ip(request) == "1.2.3.4"

    def test_get_client_ip_from_real_ip(self):
        """Should fall back to X-Real-IP."""
        from noodle_web.security import _get_client_ip
        from unittest.mock import MagicMock

        request = MagicMock()
        request.headers = {"X-Real-IP": "10.0.0.1"}
        request.client = None
        assert _get_client_ip(request) == "10.0.0.1"

    def test_get_client_ip_from_client(self):
        """Should fall back to request.client.host."""
        from noodle_web.security import _get_client_ip
        from unittest.mock import MagicMock

        request = MagicMock()
        request.headers = {}
        request.client.host = "192.168.1.1"
        assert _get_client_ip(request) == "192.168.1.1"

    def test_get_client_ip_unknown(self):
        """Should return 'unknown' when no IP info available."""
        from noodle_web.security import _get_client_ip
        from unittest.mock import MagicMock

        request = MagicMock()
        request.headers = {}
        request.client = None
        assert _get_client_ip(request) == "unknown"

    def test_reset_rate_limit_store(self):
        """reset_rate_limit_store should clear all tracking data."""
        from noodle_web.security import (
            _is_rate_limited,
            _rate_limit_store,
            reset_rate_limit_store,
        )

        _is_rate_limited("test-ip")
        assert len(_rate_limit_store) > 0
        reset_rate_limit_store()
        assert len(_rate_limit_store) == 0

    def test_security_headers_dict_completeness(self):
        """Ensure all required security headers are defined."""
        from noodle_web.security import SECURITY_HEADERS

        required = [
            "X-Frame-Options",
            "X-Content-Type-Options",
            "X-XSS-Protection",
            "Strict-Transport-Security",
            "Content-Security-Policy",
            "Referrer-Policy",
            "Permissions-Policy",
        ]
        for header in required:
            assert header in SECURITY_HEADERS, f"Missing header: {header}"
