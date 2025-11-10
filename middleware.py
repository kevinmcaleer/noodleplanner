import os
import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from database import ActivityLog, get_db

ENABLE_ACTIVITY_LOGGING = os.getenv("ENABLE_ACTIVITY_LOGGING", "true").lower() == "true"


def get_client_ip(request: Request) -> str:
    """Extract client IP address from request, handling proxies"""
    # Check X-Forwarded-For header (set by proxies/load balancers)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For can contain multiple IPs, get the first one
        return forwarded_for.split(",")[0].strip()

    # Check X-Real-IP header (set by some proxies)
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    # Fall back to direct client host
    if request.client:
        return request.client.host

    return "unknown"


def get_activity_type(endpoint: str, method: str) -> str:
    """Determine activity type based on endpoint and method"""
    endpoint_lower = endpoint.lower()

    if endpoint_lower == "/" or endpoint_lower.startswith("/health"):
        return "health_check"
    elif endpoint_lower.startswith("/render"):
        return "render_plan"
    elif endpoint_lower.startswith("/analyze"):
        return "analyze_plan"
    elif endpoint_lower.startswith("/export"):
        if "excel" in endpoint_lower:
            return "export_excel"
        elif "ppt" in endpoint_lower or "powerpoint" in endpoint_lower:
            return "export_powerpoint"
        else:
            return "export_file"
    elif endpoint_lower.startswith("/convert"):
        return "convert_format"
    elif method == "POST":
        return "file_upload"
    elif method == "GET":
        return "page_view"
    else:
        return f"{method.lower()}_request"


class ActivityLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to log all user activity to database"""

    async def dispatch(self, request: Request, call_next):
        if not ENABLE_ACTIVITY_LOGGING:
            return await call_next(request)

        # Record start time
        start_time = time.time()

        # Get request details
        ip_address = get_client_ip(request)
        user_agent = request.headers.get("User-Agent", "unknown")
        endpoint = str(request.url.path)
        method = request.method

        # Process the request
        response = await call_next(request)

        # Calculate response time
        response_time_ms = int((time.time() - start_time) * 1000)

        # Determine activity type
        activity_type = get_activity_type(endpoint, method)

        # Log to database (in background to not slow down response)
        try:
            with get_db() as db:
                log_entry = ActivityLog(
                    ip_address=ip_address,
                    user_agent=user_agent[:500],  # Truncate if too long
                    activity_type=activity_type,
                    endpoint=endpoint[:200],  # Truncate if too long
                    method=method,
                    status_code=response.status_code,
                    response_time_ms=response_time_ms
                )
                db.add(log_entry)
        except Exception as e:
            # Don't let logging errors break the application
            print(f"Failed to log activity: {e}")

        return response
