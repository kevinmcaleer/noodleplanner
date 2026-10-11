"""HTTP routes for accounts (HTML pages) and server-side plan storage (JSON API).

Pages (no JavaScript needed):
    /account/login, /account/register, /account/forgot, /account/reset,
    /account (change password, sign out, delete account)

API (cookie session, JSON):
    GET    /api/v1/me
    GET    /api/v1/plans
    POST   /api/v1/plans
    GET    /api/v1/plans/{id}
    PUT    /api/v1/plans/{id}       -- needs ``base_revision``; 409 on conflict
    DELETE /api/v1/plans/{id}

See accounts.py for storage and security notes.
"""

from __future__ import annotations

import logging
import os
import smtplib
import time
from collections import defaultdict
from email.message import EmailMessage
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from .accounts import AccountError, AccountStore, Plan, RevisionConflict, User, SESSION_TTL
from .security import _get_client_ip, is_production

logger = logging.getLogger(__name__)

SESSION_COOKIE = "np_session"
MAX_PLAN_BYTES = int(os.getenv("MAX_FILE_SIZE", "1048576"))

# Registration can be switched off once the people who need accounts have them.
REGISTRATION_OPEN = os.getenv("ALLOW_REGISTRATION", "true").lower() not in ("0", "false", "no", "off")

# Sign-in throttle (in memory, per process): too many failures for one email or
# one IP inside the window locks further attempts until it passes.
LOGIN_MAX_FAILURES = int(os.getenv("LOGIN_MAX_FAILURES", "8"))
LOGIN_WINDOW = int(os.getenv("LOGIN_WINDOW_SECONDS", str(15 * 60)))
_failures: dict[str, list[float]] = defaultdict(list)

_MESSAGES = {
    "reset-sent": "If that email has an account, a reset link is on its way.",
    "reset-done": "Password updated. Sign in with the new password.",
    "deleted": "Your account and all its plans have been deleted.",
    "signed-out": "You have been signed out.",
    "password-changed": "Password changed. Other devices have been signed out.",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _throttle_keys(request: Request, email: str) -> list[str]:
    return ["ip:" + _get_client_ip(request), "email:" + (email or "").strip().lower()]


def _is_locked(keys: list[str]) -> bool:
    cutoff = time.time() - LOGIN_WINDOW
    for key in keys:
        _failures[key] = [t for t in _failures[key] if t > cutoff]
        if len(_failures[key]) >= LOGIN_MAX_FAILURES:
            return True
    return False


def _record_failure(keys: list[str]) -> None:
    now = time.time()
    for key in keys:
        _failures[key].append(now)


def _cookie_secure(request: Request) -> bool:
    return (
        is_production()
        or request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto", "").lower() == "https"
    )


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token, max_age=SESSION_TTL, httponly=True,
        samesite="lax", secure=_cookie_secure(request), path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def _send_reset_link(request: Request, email: str, token: str) -> None:
    """Email the reset link if SMTP and PUBLIC_BASE_URL are configured;
    otherwise write it to the server log so a self-hoster can pass it on."""
    base = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
    smtp_host = os.getenv("SMTP_HOST", "")
    if not (smtp_host and base):
        # The request's own Host header is attacker-controlled, so it is only
        # ever used for a link that goes to the operator's log, never an inbox.
        link = f"{base or str(request.base_url).rstrip('/')}/account/reset?token={token}"
        logger.warning("Password reset requested for %s (email not configured): %s", email, link)
        return
    link = f"{base}/account/reset?token={token}"
    msg = EmailMessage()
    msg["Subject"] = "Reset your NoodlePlanner password"
    msg["From"] = os.getenv("SMTP_FROM", "noodleplanner@localhost")
    msg["To"] = email
    msg.set_content(
        "Someone asked to reset the password for this NoodlePlanner account.\n\n"
        f"Choose a new password here (the link works for one hour):\n{link}\n\n"
        "If that wasn't you, ignore this email."
    )
    try:
        with smtplib.SMTP(smtp_host, int(os.getenv("SMTP_PORT", "587")), timeout=10) as smtp:
            if os.getenv("SMTP_STARTTLS", "true").lower() not in ("0", "false", "no"):
                smtp.starttls()
            if os.getenv("SMTP_USER"):
                smtp.login(os.environ["SMTP_USER"], os.getenv("SMTP_PASSWORD", ""))
            smtp.send_message(msg)
    except Exception:  # never reveal delivery problems to the requester
        logger.exception("Could not send password reset email")


# ---------------------------------------------------------------------------
# Request bodies (module level so FastAPI can resolve the annotations)
# ---------------------------------------------------------------------------

class PlanCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    content: str = Field("", max_length=MAX_PLAN_BYTES)

class PlanUpdate(BaseModel):
    base_revision: int = Field(..., ge=1)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, max_length=MAX_PLAN_BYTES)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

def build_router(templates: Jinja2Templates, static_version: str, store: Optional[AccountStore] = None) -> APIRouter:
    router = APIRouter()
    db = store or AccountStore()
    router.account_store = db  # type: ignore[attr-defined]  # tests use it

    # -- dependencies ------------------------------------------------------

    def current_user(request: Request) -> Optional[User]:
        return db.user_for_session(request.cookies.get(SESSION_COOKIE, ""))

    def require_user(user: Optional[User] = Depends(current_user)) -> User:
        if user is None:
            raise HTTPException(status_code=401, detail="Sign in required.")
        return user

    def same_origin(request: Request) -> None:
        """Reject cross-site state changes. SameSite=Lax already stops the
        cookie travelling on cross-site POSTs; this is the second lock."""
        origin = request.headers.get("origin")
        if not origin:
            return
        host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
        if urlparse(origin).netloc != host:
            raise HTTPException(status_code=403, detail="Cross-site request refused.")

    def page(request: Request, name: str, status: int = 200, **ctx) -> HTMLResponse:
        ctx.update(v=static_version, page=name, registration_open=REGISTRATION_OPEN)
        return templates.TemplateResponse(request, "account.html", ctx, status_code=status)

    def flash(request: Request) -> str:
        return _MESSAGES.get(request.query_params.get("msg", ""), "")

    # -- pages -------------------------------------------------------------

    @router.get("/account/login", response_class=HTMLResponse)
    def login_page(request: Request, user: Optional[User] = Depends(current_user)):
        if user:
            return RedirectResponse("/account", status_code=303)
        return page(request, "login", notice=flash(request))

    @router.post("/account/login", dependencies=[Depends(same_origin)])
    def login(request: Request, email: str = Form(""), password: str = Form("")):
        keys = _throttle_keys(request, email)
        if _is_locked(keys):
            return page(request, "login", 429, error="Too many failed attempts. Try again later.", email=email)
        user = db.authenticate(email, password)
        if user is None:
            _record_failure(keys)
            return page(request, "login", 401, error="Wrong email or password.", email=email)
        response = RedirectResponse("/", status_code=303)
        _set_session_cookie(response, request, db.create_session(user.id))
        return response

    @router.get("/account/register", response_class=HTMLResponse)
    def register_page(request: Request, user: Optional[User] = Depends(current_user)):
        if user:
            return RedirectResponse("/account", status_code=303)
        return page(request, "register")

    @router.post("/account/register", dependencies=[Depends(same_origin)])
    def register(
        request: Request,
        email: str = Form(""),
        password: str = Form(""),
        confirm: str = Form(""),
        display_name: str = Form(""),
    ):
        if not REGISTRATION_OPEN:
            return page(request, "register", 403, error="Registration is closed on this server.")
        keys = _throttle_keys(request, "register")
        if _is_locked(keys):
            return page(request, "register", 429, error="Too many attempts. Try again later.")
        ctx = {"email": email, "display_name": display_name}
        if password != confirm:
            return page(request, "register", 400, error="The two passwords don't match.", **ctx)
        try:
            user = db.create_user(email, password, display_name)
        except AccountError as exc:
            _record_failure(keys)
            return page(request, "register", exc.status, error=exc.message, **ctx)
        response = RedirectResponse("/", status_code=303)
        _set_session_cookie(response, request, db.create_session(user.id))
        return response

    @router.get("/account/forgot", response_class=HTMLResponse)
    def forgot_page(request: Request):
        return page(request, "forgot")

    @router.post("/account/forgot", dependencies=[Depends(same_origin)])
    def forgot(request: Request, email: str = Form("")):
        keys = _throttle_keys(request, "forgot")
        if not _is_locked(keys):
            _record_failure(keys)  # every request counts, so this can't be used to spam
            user = db.user_by_email(email)
            if user is not None:
                _send_reset_link(request, user.email, db.create_reset_token(user.id))
        # Same answer whether or not the account exists.
        return RedirectResponse("/account/login?msg=reset-sent", status_code=303)

    @router.get("/account/reset", response_class=HTMLResponse)
    def reset_page(request: Request, token: str = ""):
        if not db.reset_token_valid(token):
            return page(request, "forgot", 400, error="This reset link is invalid or has expired. Request a new one.")
        return page(request, "reset", token=token)

    @router.post("/account/reset", dependencies=[Depends(same_origin)])
    def reset(request: Request, token: str = Form(""), password: str = Form(""), confirm: str = Form("")):
        if password != confirm:
            return page(request, "reset", 400, error="The two passwords don't match.", token=token)
        try:
            db.reset_password(token, password)
        except AccountError as exc:
            return page(request, "reset", exc.status, error=exc.message, token=token)
        return RedirectResponse("/account/login?msg=reset-done", status_code=303)

    @router.get("/account", response_class=HTMLResponse)
    def account_page(request: Request, user: Optional[User] = Depends(current_user)):
        if user is None:
            return RedirectResponse("/account/login", status_code=303)
        return page(request, "account", user=user, plan_count=len(db.list_plans(user.id)), notice=flash(request))

    @router.post("/account/logout", dependencies=[Depends(same_origin)])
    def logout(request: Request):
        db.delete_session(request.cookies.get(SESSION_COOKIE, ""))
        response = RedirectResponse("/account/login?msg=signed-out", status_code=303)
        _clear_session_cookie(response)
        return response

    @router.post("/account/profile", dependencies=[Depends(same_origin)])
    def update_profile(request: Request, display_name: str = Form(""), user: Optional[User] = Depends(current_user)):
        if user is None:
            return RedirectResponse("/account/login", status_code=303)
        db.update_display_name(user.id, display_name)
        return RedirectResponse("/account", status_code=303)

    @router.post("/account/password", dependencies=[Depends(same_origin)])
    def change_password(
        request: Request,
        current: str = Form(""),
        password: str = Form(""),
        confirm: str = Form(""),
        user: Optional[User] = Depends(current_user),
    ):
        if user is None:
            return RedirectResponse("/account/login", status_code=303)

        def again(message: str, status: int = 400):
            return page(request, "account", status, user=user, plan_count=len(db.list_plans(user.id)), error=message)

        keys = _throttle_keys(request, user.email)
        if _is_locked(keys):
            return again("Too many failed attempts. Try again later.", 429)
        if not db.verify_user_password(user.id, current):
            _record_failure(keys)
            return again("Current password is wrong.")
        if password != confirm:
            return again("The two new passwords don't match.")
        try:
            db.set_password(user.id, password)
        except AccountError as exc:
            return again(exc.message, exc.status)
        # set_password signed every device out, this one included.
        response = RedirectResponse("/account/login?msg=password-changed", status_code=303)
        _clear_session_cookie(response)
        return response

    @router.post("/account/delete", dependencies=[Depends(same_origin)])
    def delete_account(
        request: Request,
        password: str = Form(""),
        confirm_email: str = Form(""),
        user: Optional[User] = Depends(current_user),
    ):
        if user is None:
            return RedirectResponse("/account/login", status_code=303)
        keys = _throttle_keys(request, user.email)
        error = ""
        if _is_locked(keys):
            error = "Too many failed attempts. Try again later."
        elif confirm_email.strip().lower() != user.email.lower():
            error = "Type your email address exactly to confirm."
        elif not db.verify_user_password(user.id, password):
            _record_failure(keys)
            error = "Password is wrong."
        if error:
            return page(request, "account", 400, user=user, plan_count=len(db.list_plans(user.id)), error=error)
        db.delete_user(user.id)
        response = RedirectResponse("/account/login?msg=deleted", status_code=303)
        _clear_session_cookie(response)
        return response

    # -- plan API ----------------------------------------------------------

    def summary(plan: Plan) -> dict:
        return {
            "id": plan.id, "name": plan.name, "revision": plan.revision,
            "size": plan.size, "created_at": plan.created_at, "updated_at": plan.updated_at,
        }

    def full(plan: Plan) -> dict:
        return {**summary(plan), "content": plan.content.decode("utf-8")}

    def encode(text: str) -> bytes:
        data = text.encode("utf-8")
        if len(data) > MAX_PLAN_BYTES:
            raise HTTPException(status_code=413, detail="Plan is too large.")
        return data

    @router.get("/api/v1/me")
    def me(user: User = Depends(require_user)):
        return {"id": user.id, "email": user.email, "display_name": user.display_name}

    @router.get("/api/v1/plans")
    def list_plans(user: User = Depends(require_user)):
        return {"plans": [summary(p) for p in db.list_plans(user.id)]}

    @router.post("/api/v1/plans", status_code=201, dependencies=[Depends(same_origin)])
    def create_plan(body: PlanCreate, user: User = Depends(require_user)):
        try:
            return full(db.create_plan(user.id, body.name.strip(), encode(body.content)))
        except AccountError as exc:
            raise HTTPException(status_code=exc.status, detail=exc.message)

    @router.get("/api/v1/plans/{plan_id}")
    def get_plan(plan_id: str, user: User = Depends(require_user)):
        plan = db.get_plan(user.id, plan_id)
        if plan is None:
            raise HTTPException(status_code=404, detail="Plan not found.")
        return full(plan)

    @router.put("/api/v1/plans/{plan_id}", dependencies=[Depends(same_origin)])
    def update_plan(plan_id: str, body: PlanUpdate, user: User = Depends(require_user)):
        try:
            plan = db.update_plan(
                user.id, plan_id, body.base_revision,
                name=body.name.strip() if body.name else None,
                content=encode(body.content) if body.content is not None else None,
            )
        except RevisionConflict as conflict:
            return JSONResponse(
                status_code=409,
                content={"detail": "The plan changed on the server.", "current": full(conflict.current)},
            )
        if plan is None:
            raise HTTPException(status_code=404, detail="Plan not found.")
        return full(plan)

    @router.delete("/api/v1/plans/{plan_id}", status_code=204, dependencies=[Depends(same_origin)])
    def delete_plan(plan_id: str, user: User = Depends(require_user)):
        if not db.delete_plan(user.id, plan_id):
            raise HTTPException(status_code=404, detail="Plan not found.")
        return Response(status_code=204)

    return router
