import os
import io
import re
import asyncio
import hashlib
import logging
import tempfile
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
import yaml
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional, List
from urllib.parse import quote

from fastapi import FastAPI, File, UploadFile, HTTPException, Request, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, HTMLResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
import uvicorn
from dotenv import load_dotenv

from noodle_core import (
    text_to_markdown_table,
    export_to_excel,
    export_to_csv,
    export_timeline_to_powerpoint,
    export_report_to_powerpoint,
    export_portfolio_to_powerpoint,
    export_to_pdf,
    convert_plan_format_to_standard,
    extract_title_from_frontmatter,
    natural_language_to_yaml,
    schedule_tasks,
    calculate_rag_status,
    parse_resource_mappings,
    analyze_workbook,
    convert_excel_to_markdown,
    convert_planner_to_markdown,
    extract_highlights,
    extract_raid_log,
    parse_raid_markdown,
    extract_baseline,
    parse_baseline_markdown,
    extract_budget,
    parse_budget_markdown,
    FrontMatterParser,
    import_from_msproject_xml,
)
import json
from .collab_session import (
    CLOSE_HOST_DISCONNECTED,
    CLOSE_HOST_ENDED,
    CLOSE_KICKED,
    CLOSE_REASON_HOST_DISCONNECTED,
    CLOSE_REASON_HOST_ENDED,
    CLOSE_REASON_KICKED,
    SessionState,
    collab_sessions,
    run_idle_sweep_forever,
)
from .plan_service import PlanService, export_to_file
from .ai_service import (
    AIChatRequest,
    AITestRequest,
    proxy_chat_completion,
    proxy_chat_with_tools,
    test_connection,
    list_agents,
    get_agent,
)
from .security import (
    SecurityHeadersMiddleware,
    StaticCacheControlMiddleware,
    RateLimitMiddleware,
    BodySizeLimitMiddleware,
    ErrorSanitizationMiddleware,
    APIKeyAuthMiddleware,
    get_websocket_client_ip,
    forgive_join_attempt,
    is_join_rate_limited,
    is_production,
)

# Load environment variables from .env file
load_dotenv()

log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", 1048576))


def _resolve_templates_dir() -> Path:
    """Resolve the templates directory using multiple strategies."""
    # 1. Explicit environment variable
    env_path = os.getenv("NOODLE_TEMPLATES_DIR")
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p

    # 2. Current working directory (works for Docker WORKDIR and local uv run)
    cwd_path = Path.cwd() / "templates"
    if cwd_path.exists():
        return cwd_path

    # 3. Relative to source file (editable install fallback)
    src_path = Path(__file__).parent.parent.parent.parent.parent / "templates"
    return src_path


TEMPLATES_DIR = _resolve_templates_dir()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run the collab-session idle sweep for the lifetime of the app.

    See collab_session.run_idle_sweep_forever(): a background safety net on
    top of the lazy per-request expiry check, so a session nobody ever
    touches again still gets torn down instead of leaking forever.
    """
    sweep_task = asyncio.create_task(run_idle_sweep_forever())
    try:
        yield
    finally:
        sweep_task.cancel()
        try:
            await sweep_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Noodle Planner API",
    description="Project planning and scheduling tool",
    version="1.0.0",
    lifespan=lifespan,
)

# Mount static files and setup templates
package_dir = Path(__file__).parent
app.mount("/static", StaticFiles(directory=str(package_dir / "static")), name="static")

# Serve built Sphinx documentation at /docs/
_docs_build = Path(__file__).parents[5] / "docs" / "_build" / "html"
if _docs_build.exists():
    app.mount("/docs", StaticFiles(directory=str(_docs_build), html=True), name="docs")
templates = Jinja2Templates(directory=str(package_dir / "templates"))


def _static_version():
    """Generate a deterministic build ID from the web app's served sources."""
    files = list(package_dir.rglob("*.py"))
    for root_name in ("static", "templates"):
        files.extend(
            path for path in (package_dir / root_name).rglob("*")
            if path.is_file()
        )

    h = hashlib.sha256()
    for f in sorted(set(files)):
        h.update(f.relative_to(package_dir).as_posix().encode())
        h.update(b"\0")
        h.update(f.read_bytes())
    return h.hexdigest()[:8]


STATIC_VERSION = _static_version()


def _sanitized_detail(message: str, error: Exception) -> str:
    """Return a user-facing error detail string.

    In production the raw error is hidden to avoid leaking implementation
    details. In development the full message is returned for debugging.
    """
    if is_production():
        return message
    return f"{message}: {error}"


def content_disposition(filename: str, disposition: str = "attachment") -> str:
    """Build a Content-Disposition header value for a download.

    Starlette encodes header values as latin-1, so a project title in
    Cyrillic, or with an em dash, put raw into ``filename="..."`` made the
    download a 500. The header carries an ASCII ``filename`` fallback
    (accents folded, anything else non-ASCII replaced) plus the real name as
    RFC 6266 / 5987 ``filename*``, which browsers prefer when present.
    Quotes, backslashes and control characters (CR/LF above all) never reach
    the header.
    """
    name = "".join(c for c in filename if unicodedata.category(c) != "Cc")
    folded = unicodedata.normalize("NFKD", name)
    fallback = "".join(
        c if c.isascii() else "_"
        for c in folded if not unicodedata.combining(c)
    ).replace('"', "").replace("\\", "")
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


def export_to_file(export_fn, suffix, read_mode='rb'):
    """Run an export function that writes to a temp file and return the content.

    Args:
        export_fn: Callable that accepts a file path and writes to it.
        suffix: File extension for the temp file (e.g. '.xlsx', '.csv').
        read_mode: Mode used to read back the file ('rb' for binary,
            'r' for text).  Defaults to 'rb'.

    Returns:
        The file contents as bytes (read_mode='rb') or str (read_mode='r').
    """
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp_path = tmp.name
        export_fn(tmp_path)
        kwargs = {} if 'b' in read_mode else {'encoding': 'utf-8'}
        with open(tmp_path, read_mode, **kwargs) as f:
            return f.read()
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)



# ---------------------------------------------------------------------------
# Middleware stack (applied in reverse order; last added = outermost)
# ---------------------------------------------------------------------------

# CORS -- configurable via CORS_ORIGINS env var (comma-separated).
# Defaults to ["*"] in development for convenience.
_cors_env = os.getenv("CORS_ORIGINS", "")
_cors_origins: list[str] = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env
    else ["*"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security headers (CSP, HSTS, X-Frame-Options, etc.)
app.add_middleware(SecurityHeadersMiddleware)

# Force revalidation of /static/ assets instead of a CDN/proxy caching them
# for an unbounded default TTL with no way to invalidate on demand (#977).
app.add_middleware(StaticCacheControlMiddleware)

# Request body size limit
app.add_middleware(BodySizeLimitMiddleware)

# Rate limiting (per-IP)
app.add_middleware(RateLimitMiddleware)

# Error sanitization (generic messages in production)
app.add_middleware(ErrorSanitizationMiddleware)

# API key auth (outermost -- checked first)
app.add_middleware(APIKeyAuthMiddleware)

# ---------------------------------------------------------------------------
# Service layer
# ---------------------------------------------------------------------------
plan_service = PlanService()


class RenderRequest(BaseModel):
    plan_text: str = Field(..., max_length=MAX_FILE_SIZE)
    project_name: Optional[str] = Field(None, max_length=200)
    export_excel: bool = Field(False)
    export_csv: bool = Field(False)
    export_ppt: bool = Field(False)
    export_pdf: bool = Field(False)
    export_msproject: bool = Field(False)
    # /api/parse only: also build the ASCII table. Off by default because no
    # frontend caller reads it and it schedules the plan a second time (#789).
    include_ascii: bool = Field(False)



@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main HTML page."""
    return templates.TemplateResponse(request, "index.html", {
        "v": STATIC_VERSION,
        "app_version": app.version,
    })


@app.post("/", response_class=HTMLResponse)
async def index_with_template(request: Request, template_content: str = Form(None)):
    """Serve the main HTML page with template content pre-loaded."""
    return templates.TemplateResponse(request, "index.html", {
        "v": STATIC_VERSION,
        "app_version": app.version,
        "template_content": template_content,
    })


@app.get("/favicon.png")
async def favicon():
    """Serve the favicon."""
    favicon_path = Path(__file__).parent / "favicon.png"
    if favicon_path.exists():
        return FileResponse(favicon_path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Favicon not found")


@app.get("/logo.png")
async def logo():
    """Serve the logo."""
    logo_path = Path(__file__).parent / "logo.png"
    if logo_path.exists():
        return FileResponse(logo_path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Logo not found")


# ---------------------------------------------------------------------------
# Progressive Web App (issue #809): the manifest makes the app installable and
# the service worker, served from the site root so its scope covers the whole
# app, lets it open in its own window and start offline.
# ---------------------------------------------------------------------------


@app.get("/manifest.webmanifest")
async def web_app_manifest():
    """The web app manifest, with the media type browsers expect."""
    return FileResponse(
        package_dir / "static" / "manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/sw.js")
async def service_worker():
    """The service worker, stamped with the deploy's static version.

    Served at the root rather than under /static/ so it can control "/",
    and never cached by the browser so a new deployment takes effect on the
    next load. The version stamp is what makes the worker's cache turn over.
    """
    source = (package_dir / "static" / "sw.js").read_text(encoding="utf-8")
    return Response(
        source.replace("__STATIC_VERSION__", STATIC_VERSION),
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache",
            "Service-Worker-Allowed": "/",
        },
    )


@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.post("/render")
async def render_plan(data: RenderRequest):
    """Render a project plan and optionally export to Excel/PPT/PDF/MS Project."""
    logger.info(f"Render request: exports={data.export_excel}, {data.export_ppt}, {data.export_pdf}, {data.export_msproject}")

    try:
        has_exports = data.export_excel or data.export_csv or data.export_ppt or data.export_pdf or data.export_msproject

        if has_exports:
            export_count = sum([data.export_excel, data.export_csv, data.export_ppt, data.export_pdf, data.export_msproject])

            if export_count == 1:
                # Determine the requested format
                fmt = next(
                    f for f, flag in [
                        ("excel", data.export_excel),
                        ("csv", data.export_csv),
                        ("ppt", data.export_ppt),
                        ("pdf", data.export_pdf),
                        ("msproject", data.export_msproject),
                    ] if flag
                )
                result = plan_service.export_single(
                    data.plan_text, fmt, project_name=data.project_name
                )
                return Response(
                    content=result.content,
                    media_type=result.media_type,
                    headers={
                        "Content-Disposition": content_disposition(result.filename)
                    },
                )
            else:
                result = plan_service.export_zip(
                    data.plan_text,
                    project_name=data.project_name,
                    excel=data.export_excel,
                    csv=data.export_csv,
                    ppt=data.export_ppt,
                    pdf=data.export_pdf,
                    msproject=data.export_msproject,
                )
                logger.info("Successfully generated exports")
                return Response(
                    content=result.content,
                    media_type=result.media_type,
                    headers={
                        "Content-Disposition": content_disposition(result.filename)
                    },
                )
        else:
            result = plan_service.render(data.plan_text, project_name=data.project_name)
            return {"ascii_output": result.ascii_output}

    except (ValueError, KeyError, TypeError, OSError) as e:
        logger.error(f"Error rendering plan: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=_sanitized_detail("Failed to render plan", e))


# collect_labels_from_plan and update_front_matter_with_labels have been
# moved to plan_service.py.  Keep module-level aliases so that any code
# importing them from app.py still works.
from .plan_service import collect_labels_from_plan, update_front_matter_with_labels  # noqa: E402


class SearchRequest(BaseModel):
    """Search request body. Search is project-scoped to the supplied plan_text."""
    plan_text: str = Field("", max_length=MAX_FILE_SIZE)
    query: str = Field("", max_length=500)
    project_name: Optional[str] = Field(None, max_length=200)


def _truncate_snippet(text: str, query: str, max_len: int = 160) -> str:
    """Return a short snippet centred on the first occurrence of ``query``."""
    if not text:
        return ""
    text = " ".join(text.split())  # collapse whitespace
    if not query:
        return text[:max_len]
    lo = text.lower().find(query.lower())
    if lo < 0:
        return text[:max_len]
    start = max(0, lo - 40)
    end = min(len(text), start + max_len)
    snippet = text[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet = snippet + "…"
    return snippet


def _matches(query_l: str, *fields) -> bool:
    """Case-insensitive substring match across ``fields``."""
    for f in fields:
        if f and query_l in str(f).lower():
            return True
    return False


@app.post("/api/search")
async def search_plan(data: SearchRequest):
    """Search the supplied plan text for matching items across all item types.

    Returns a flat list of result objects, each shaped as:
        {type, label, title, snippet, ref}
    where ``ref`` is the argument the corresponding ``openXxxForm()`` global
    expects (id, index, shortname, deliverable, name, etc.).

    Search is project-scoped: only ``plan_text`` is searched. Matching is
    case-insensitive substring matching.
    """
    query = (data.query or "").strip()
    results: list[dict] = []

    if not query or not data.plan_text:
        return {"query": query, "results": results}

    q_l = query.lower()

    parse_result = plan_service.parse(data.plan_text, project_name=data.project_name)

    # --- Tasks (and Products) ------------------------------------------------
    for task in parse_result.tasks or []:
        name = task.get("name", "") or ""
        comment = task.get("comment", "") or ""
        resources = task.get("resources", "") or ""
        deliverable = task.get("deliverable", "") or ""
        phase = task.get("phase", "") or ""

        if _matches(q_l, name, comment, resources, deliverable, phase):
            snippet_src = comment or (
                f"{phase + ' • ' if phase else ''}"
                f"{resources + ' • ' if resources else ''}"
                f"{task.get('start','')} → {task.get('finish','')}"
            )
            # Tasks
            results.append({
                "type": "task",
                "label": "Task",
                "title": name,
                "snippet": _truncate_snippet(snippet_src, query),
                "ref": {"name": name},
            })
            # Products: tasks with a deliverable produce a product entry too
            if deliverable:
                results.append({
                    "type": "product",
                    "label": "Product",
                    "title": name or deliverable,
                    "snippet": _truncate_snippet(
                        f"${deliverable} — {comment}" if comment else f"${deliverable}",
                        query,
                    ),
                    "ref": {
                        "name": name,
                        "deliverable": deliverable,
                    },
                })

    # --- RAID (Risks/Actions/Issues/Decisions/Dependencies) ------------------
    for item in parse_result.raid_items or []:
        title = item.get("title", "") or ""
        description = item.get("description", "") or ""
        owner = item.get("owner", "") or ""
        raised_by = item.get("raised_by", "") or ""
        mitigation = item.get("mitigation_actions", "") or ""
        item_type = (item.get("type") or "risk").lower()
        if _matches(q_l, title, description, owner, raised_by, mitigation):
            results.append({
                "type": "risk",
                "label": item_type.capitalize() or "RAID",
                "title": title or f"#{item.get('id', '')}",
                "snippet": _truncate_snippet(description or mitigation, query),
                "ref": {"id": item.get("id")},
            })

    # --- Comms ---------------------------------------------------------------
    for item in parse_result.comms_items or []:
        title = item.get("title", "") or ""
        audience = item.get("audience", "") or ""
        channel = item.get("channel", "") or ""
        owner = item.get("owner", "") or ""
        purpose = item.get("purpose", "") or ""
        frequency = item.get("frequency", "") or ""
        if _matches(q_l, title, audience, channel, owner, purpose, frequency):
            # Join what is there: this used .strip(" via"), which strips
            # those characters from both ends, not the word ("all staff via
            # Wiki" came out as "ll staff via Wik").
            snippet_src = purpose or " via ".join(p for p in (audience, channel) if p)
            results.append({
                "type": "comms",
                "label": "Comms",
                "title": title or f"#{item.get('id', '')}",
                "snippet": _truncate_snippet(snippet_src, query),
                "ref": {"id": item.get("id")},
            })

    # --- Budget items (separate extraction; not on parse_result) -------------
    try:
        budget_text = extract_budget(data.plan_text) or ""
        budget_items = parse_budget_markdown(budget_text) if budget_text else []
    except Exception as e:  # pragma: no cover - defensive
        logger.warning(f"Budget extraction failed during search: {e}")
        budget_items = []
    for item in budget_items:
        description = item.get("description", "") or ""
        supplier = item.get("supplier", "") or ""
        category = item.get("category", "") or ""
        type_ = item.get("type", "") or ""
        po = item.get("po", "") or ""
        invoice = item.get("invoice", "") or ""
        if _matches(q_l, description, supplier, category, type_, po, invoice):
            extras = " • ".join(p for p in [supplier, category, type_] if p)
            results.append({
                "type": "budget",
                "label": "Budget",
                "title": description or f"#{item.get('id', '')}",
                "snippet": _truncate_snippet(extras, query),
                "ref": {"id": item.get("id")},
            })

    # --- Highlights ----------------------------------------------------------
    for idx, h in enumerate(parse_result.highlights or []):
        date = (h.get("date") if isinstance(h, dict) else "") or ""
        author = (h.get("author") if isinstance(h, dict) else "") or ""
        content = (h.get("content") if isinstance(h, dict) else "") or ""
        if _matches(q_l, date, author, content):
            title = " — ".join(p for p in [date, author] if p) or f"Highlight #{idx + 1}"
            results.append({
                "type": "highlight",
                "label": "Highlight",
                "title": title,
                "snippet": _truncate_snippet(content, query),
                "ref": {"index": idx},
            })

    # --- Resources -----------------------------------------------------------
    resource_map = parse_result.resource_map or {}
    resource_roles = parse_result.resource_roles or {}
    for shortname, fullname in resource_map.items():
        role = resource_roles.get(shortname, "")
        if _matches(q_l, shortname, fullname, role):
            extras = " • ".join(p for p in [fullname, role] if p)
            results.append({
                "type": "resource",
                "label": "Resource",
                "title": f"@{shortname}",
                "snippet": _truncate_snippet(extras or fullname, query),
                "ref": {"shortname": shortname},
            })

    # --- Benefits ------------------------------------------------------------
    for item in parse_result.benefits_items or []:
        title = item.get("title", "") or ""
        description = item.get("description", "") or ""
        type_ = item.get("type", "") or ""
        target_value = item.get("target_value", "") or ""
        if _matches(q_l, title, description, type_, target_value):
            results.append({
                "type": "benefit",
                "label": "Benefit",
                "title": title or f"#{item.get('id', '')}",
                "snippet": _truncate_snippet(description or target_value, query),
                "ref": {"id": item.get("id")},
            })

    return {"query": query, "results": results}


@app.post("/api/parse")
async def parse_plan(data: RenderRequest):
    """Parse a project plan and return structured JSON data for tabbed views."""
    logger.info("Parse request received")

    result = plan_service.parse(
        data.plan_text, project_name=data.project_name, include_ascii=data.include_ascii
    )

    response = {
        "success": result.success,
        "project_name": result.project_name,
        "ascii_output": result.ascii_output,
        "front_matter": result.front_matter,
        "resource_map": result.resource_map,
        "tasks": result.tasks,
        "updated_plan_text": result.updated_plan_text,
        "highlights": result.highlights,
        "raid_items": result.raid_items,
        "comms_items": result.comms_items,
        "baseline_items": result.baseline_items,
        "dependencies": result.dependencies,
        "stakeholders": result.stakeholders or [],
        "benefits_items": result.benefits_items,
        "lessons_items": result.lessons_items or [],
        "resource_roles": result.resource_roles or {},
    }
    if result.error:
        response["error"] = result.error

    return response


class AnalyseRequest(BaseModel):
    plan_text: str = Field(..., max_length=MAX_FILE_SIZE)
    # "Today" for the date-dependent checks; the server's date when omitted.
    today: Optional[str] = Field(None, max_length=10)


class AnalyseFixRequest(BaseModel):
    plan_text: str = Field(..., max_length=MAX_FILE_SIZE)
    # The fix_action from a finding, applied as-is ...
    action: Optional[dict] = None
    # ... or a finding id, re-found in this text and its fix applied.
    finding_id: Optional[str] = Field(None, max_length=1000)
    today: Optional[str] = Field(None, max_length=10)


def _parse_today(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="today must be YYYY-MM-DD")


@app.post("/api/analyse")
async def analyse_plan_endpoint(data: AnalyseRequest):
    """Review a plan for common problems (#782): findings, fixes, health score.

    Stateless like /api/parse: the plan is reviewed and forgotten.
    """
    from noodle_core.plan_quality import review_plan

    return review_plan(data.plan_text, today=_parse_today(data.today))


@app.post("/api/analyse/fix")
async def analyse_fix_endpoint(data: AnalyseFixRequest):
    """Apply one finding's one-click fix and return the new plan text."""
    from noodle_core.plan_quality import FixError, apply_finding_fix, apply_fix

    if not data.action and not data.finding_id:
        raise HTTPException(status_code=422, detail="Give an action or a finding_id")
    try:
        if data.action:
            plan_text = apply_fix(data.plan_text, data.action)
        else:
            plan_text = apply_finding_fix(data.plan_text, data.finding_id,
                                          today=_parse_today(data.today))
    except FixError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid fix: {exc}")
    return {"plan_text": plan_text}


class PlanReportExportRequest(BaseModel):
    report: str = Field(..., pattern="^(assignments|slippage)$")
    format: str = Field(..., pattern="^(xlsx|pptx)$")
    project_name: Optional[str] = Field(None, max_length=200)
    # The report's rows as the browser computed them (static/plan-reports.js)
    data: dict


_REPORT_MEDIA_TYPES = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


@app.post("/api/reports/export")
async def export_plan_report(data: PlanReportExportRequest):
    """Export the Tasks by Assignment or Slippage report (#776) to Excel or PowerPoint.

    The browser sends the rows it is showing; the exporter only lays them
    out, so the file always matches the view (filters included).
    """
    from noodle_core.exporters import (
        export_assignment_report_to_excel,
        export_assignment_report_to_powerpoint,
        export_slippage_report_to_excel,
        export_slippage_report_to_powerpoint,
    )

    exporters = {
        ("assignments", "xlsx"): export_assignment_report_to_excel,
        ("assignments", "pptx"): export_assignment_report_to_powerpoint,
        ("slippage", "xlsx"): export_slippage_report_to_excel,
        ("slippage", "pptx"): export_slippage_report_to_powerpoint,
    }
    exporter = exporters[(data.report, data.format)]
    project_name = data.project_name or "Project"
    try:
        file_bytes = export_to_file(
            lambda path: exporter(path, data.data, project_name=project_name),
            suffix=f".{data.format}",
        )
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid report data: {exc}")
    stem = re.sub(r"[^\w.-]+", "_", project_name).strip("_") or "plan"
    suffix = "tasks_by_assignment" if data.report == "assignments" else "slippage"
    return Response(
        content=file_bytes,
        media_type=_REPORT_MEDIA_TYPES[data.format],
        headers={"Content-Disposition": content_disposition(f"{stem}_{suffix}.{data.format}")},
    )


class ReportMilestone(BaseModel):
    name: str = Field("", max_length=500)
    date: str = Field("", max_length=50)
    rag: str = Field("", max_length=20)


class ReportUpNextItem(BaseModel):
    name: str = Field("", max_length=500)
    start: str = Field("", max_length=50)
    finish: str = Field("", max_length=50)
    rag: str = Field("", max_length=50)


class ReportHighlight(BaseModel):
    date: Optional[str] = Field(None, max_length=50)
    author: Optional[str] = Field(None, max_length=200)
    content: Optional[str] = Field(None, max_length=10000)


class ReportRiskIssue(BaseModel):
    type: str = Field("", max_length=20)
    title: str = Field("", max_length=500)
    description: str = Field("", max_length=5000)
    mitigation: str = Field("", max_length=5000)
    score: int = Field(0)


class ReportTimelineTask(BaseModel):
    """A task for the timeline graphic in the report PPTX."""
    name: str = Field("", max_length=500)
    start: str = Field("", max_length=50)
    finish: str = Field("", max_length=50)
    percent: float = Field(0)
    is_summary: bool = Field(False)
    duration_days: int = Field(0)


class DeliverableItem(BaseModel):
    """A single deliverable row for the deliverables matrix."""
    name: str = Field("", max_length=500)
    start: str = Field("", max_length=50)
    finish: str = Field("", max_length=50)
    status: str = Field("", max_length=30)
    roles: dict = Field(default_factory=dict, description="Mapping of shortname -> role letter (P/R/A)")


class DeliverablesData(BaseModel):
    """Deliverables matrix data for a project."""
    items: List[DeliverableItem] = Field(default_factory=list)
    people: List[str] = Field(default_factory=list, description="Ordered list of shortnames")
    role_map: dict = Field(default_factory=dict, description="Mapping of shortname -> role title for column headers")


class ReportExportRequest(BaseModel):
    """Request body for weekly report PowerPoint export."""
    project_name: str = Field("Project", max_length=500)
    manager: str = Field("", max_length=200)
    sponsor: str = Field("", max_length=200)
    budget: str = Field("", max_length=200)
    date: str = Field("", max_length=50)
    status: str = Field("", max_length=20)
    milestones: List[ReportMilestone] = Field(default_factory=list)
    up_next: List[ReportUpNextItem] = Field(default_factory=list)
    highlight: Optional[ReportHighlight] = None
    risks_issues: List[ReportRiskIssue] = Field(default_factory=list)
    timeline_tasks: List[ReportTimelineTask] = Field(default_factory=list, description="Phase and milestone tasks for server-side timeline rendering")
    timeline_image: Optional[str] = Field(None, description="Base64-encoded PNG of timeline captured from browser")
    deliverables: Optional[DeliverablesData] = Field(None, description="Deliverables matrix data for appendix slides")


@app.post("/api/export-report-pptx")
async def export_report_pptx_route(data: ReportExportRequest):
    """Export the project report as a PowerPoint file."""
    logger.info(f"Report PPTX export request for: {data.project_name}")

    report_data = {
        'project_name': data.project_name,
        'manager': data.manager,
        'sponsor': data.sponsor,
        'budget': data.budget,
        'date': data.date,
        'status': data.status,
        'milestones': [m.model_dump() for m in data.milestones],
        'up_next': [u.model_dump() for u in data.up_next],
        'highlight': data.highlight.model_dump() if data.highlight else None,
        'risks_issues': [r.model_dump() for r in data.risks_issues],
        'timeline_tasks': [t.model_dump() for t in data.timeline_tasks],
        'timeline_image': data.timeline_image,
    }

    try:
        result = plan_service.export_report_pptx(report_data)
        return Response(
            content=result.content,
            media_type=result.media_type,
            headers={
                "Content-Disposition": content_disposition(result.filename)
            }
        )
    except (ValueError, KeyError, TypeError, OSError) as e:
        logger.error(f"Error exporting report to PPTX: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=_sanitized_detail("Failed to export report", e))


class PortfolioProjectSummary(BaseModel):
    """Summary info for a project in the portfolio overview slide."""
    name: str = Field("", max_length=500)
    status: str = Field("", max_length=100)
    rag: str = Field("", max_length=20)
    completion: int = Field(0, ge=0, le=100)
    risk_count: int = Field(0, ge=0)
    budget: str = Field("", max_length=200)
    start_date: Optional[str] = Field(None, max_length=50)
    end_date: Optional[str] = Field(None, max_length=50)


class PortfolioReportRequest(BaseModel):
    """Request body for portfolio report PowerPoint export."""
    portfolio_name: str = Field("Portfolio", max_length=500)
    date: str = Field("", max_length=50)
    projects: List[PortfolioProjectSummary] = Field(default_factory=list)
    project_reports: List[ReportExportRequest] = Field(default_factory=list)
    timeline_image: Optional[str] = Field(None, description="Base64-encoded PNG of portfolio timeline")


@app.post("/api/portfolio/export-pptx")
async def export_portfolio_pptx_route(data: PortfolioReportRequest):
    """Export a portfolio report as a multi-slide PowerPoint file."""
    logger.info(f"Portfolio PPTX export request: {data.portfolio_name} "
                f"({len(data.project_reports)} projects)")

    portfolio_data = {
        'portfolio_name': data.portfolio_name,
        'date': data.date,
        'projects': [p.model_dump() for p in data.projects],
        'timeline_image': data.timeline_image,
    }

    project_reports = [
        {
            'project_name': r.project_name,
            'manager': r.manager,
            'sponsor': r.sponsor,
            'budget': r.budget,
            'date': r.date,
            'status': r.status,
            'milestones': [m.model_dump() for m in r.milestones],
            'up_next': [u.model_dump() for u in r.up_next],
            'highlight': r.highlight.model_dump() if r.highlight else None,
            'risks_issues': [ri.model_dump() for ri in r.risks_issues],
            'timeline_tasks': [t.model_dump() for t in r.timeline_tasks],
            'timeline_image': r.timeline_image,
            'deliverables': r.deliverables.model_dump() if r.deliverables else None,
        }
        for r in data.project_reports
    ]

    try:
        result = plan_service.export_portfolio_pptx(portfolio_data, project_reports)
        return Response(
            content=result.content,
            media_type=result.media_type,
            headers={
                "Content-Disposition": content_disposition(result.filename)
            }
        )
    except (ValueError, KeyError, TypeError, OSError) as e:
        logger.error(f"Error exporting portfolio to PPTX: {str(e)}",
                     exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=_sanitized_detail("Failed to export portfolio report", e)
        )


class RaidItem(BaseModel):
    """A single RAID log item."""
    id: int
    type: str = Field(..., pattern=r'^(risk|action|issue|decision|dependency)$')
    title: str = Field(..., max_length=500)
    description: str = Field("", max_length=5000)
    raised_by: str = Field("", max_length=200)
    owner: str = Field("", max_length=200)
    mitigation_actions: str = Field("", max_length=5000)
    impact: int = Field(3, ge=1, le=5)
    likelihood: int = Field(3, ge=1, le=5)
    score: int = Field(9, ge=1, le=25)
    status: str = Field("open", pattern=r'^(open|closed|transferred)$')


class RaidExportRequest(BaseModel):
    """Request body for RAID Excel export."""
    items: List[RaidItem]
    project_name: Optional[str] = Field("Project", max_length=200)


class BenefitItem(BaseModel):
    """Single benefit item for Excel export."""
    id: int
    type: str = Field("benefit", pattern=r'^(benefit|disbenefit|enabler|change|objective)$')
    title: str = Field("", max_length=500)
    description: str = Field("", max_length=5000)
    objectiveType: str = Field("", max_length=200)
    targetValue: str = Field("", max_length=500)
    currentValue: str = Field("", max_length=500)
    targetDate: str = Field("", max_length=50)
    measurementMethod: str = Field("", max_length=1000)
    linkedTo: List[int] = Field(default_factory=list)
    contributionPercent: int = Field(0, ge=0, le=100)
    status: str = Field("", max_length=100)
    lastUpdated: str = Field("", max_length=50)
    score: int = Field(0)


class BenefitsExportRequest(BaseModel):
    """Request body for Benefits Excel export."""
    items: List[BenefitItem]
    project_name: Optional[str] = Field("Benefits", max_length=200)


@app.post("/api/benefits/export-excel")
async def export_benefits_excel(data: BenefitsExportRequest):
    """Export benefit items to an Excel file with two sheets."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()

    # Sheet 1: Benefits Map (all items)
    ws_map = wb.active
    ws_map.title = "Benefits Map"

    map_headers = [
        'ID', 'Type', 'Title', 'Description', 'Objective Type',
        'Target Value', 'Current Value', 'Target Date', 'Measurement',
        'Linked To', 'Contribution %', 'Status', 'Last Updated', 'Score'
    ]

    header_fill = PatternFill(start_color="3B82F6", end_color="3B82F6", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)

    for col, header in enumerate(map_headers, 1):
        cell = ws_map.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')

    for row_idx, item in enumerate(data.items, 2):
        ws_map.cell(row=row_idx, column=1, value=item.id)
        ws_map.cell(row=row_idx, column=2, value=item.type.capitalize())
        ws_map.cell(row=row_idx, column=3, value=item.title)
        ws_map.cell(row=row_idx, column=4, value=item.description)
        ws_map.cell(row=row_idx, column=5, value=item.objectiveType)
        ws_map.cell(row=row_idx, column=6, value=item.targetValue)
        ws_map.cell(row=row_idx, column=7, value=item.currentValue)
        ws_map.cell(row=row_idx, column=8, value=item.targetDate)
        ws_map.cell(row=row_idx, column=9, value=item.measurementMethod)
        ws_map.cell(row=row_idx, column=10, value=', '.join(str(lid) for lid in item.linkedTo))
        ws_map.cell(row=row_idx, column=11, value=item.contributionPercent)
        ws_map.cell(row=row_idx, column=12, value=item.status)
        ws_map.cell(row=row_idx, column=13, value=item.lastUpdated)
        ws_map.cell(row=row_idx, column=14, value=item.score)

    map_widths = [6, 14, 25, 35, 16, 14, 14, 14, 20, 12, 14, 16, 14, 10]
    for col, width in enumerate(map_widths, 1):
        ws_map.column_dimensions[get_column_letter(col)].width = width

    # Sheet 2: Tracking (benefits and disbenefits only)
    ws_track = wb.create_sheet("Tracking")

    track_headers = [
        'ID', 'Type', 'Title', 'Target Value', 'Current Value',
        'Target Date', 'Measurement', 'Status', 'Last Updated'
    ]

    for col, header in enumerate(track_headers, 1):
        cell = ws_track.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')

    track_row = 2
    for item in data.items:
        if item.type not in ('benefit', 'disbenefit'):
            continue
        ws_track.cell(row=track_row, column=1, value=item.id)
        ws_track.cell(row=track_row, column=2, value=item.type.capitalize())
        ws_track.cell(row=track_row, column=3, value=item.title)
        ws_track.cell(row=track_row, column=4, value=item.targetValue)
        ws_track.cell(row=track_row, column=5, value=item.currentValue)
        ws_track.cell(row=track_row, column=6, value=item.targetDate)
        ws_track.cell(row=track_row, column=7, value=item.measurementMethod)
        ws_track.cell(row=track_row, column=8, value=item.status)
        ws_track.cell(row=track_row, column=9, value=item.lastUpdated)
        track_row += 1

    track_widths = [6, 14, 25, 16, 16, 14, 20, 16, 14]
    for col, width in enumerate(track_widths, 1):
        ws_track.column_dimensions[get_column_letter(col)].width = width

    project_name = data.project_name or "Benefits"
    file_bytes = export_to_file(wb.save, suffix='.xlsx')
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": content_disposition(f"{project_name}-benefits.xlsx")
        }
    )


@app.post("/api/raid/export-excel")
async def export_raid_excel(data: RaidExportRequest):
    """Export RAID log items to an Excel file."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "RAID Log"

    headers = [
        'ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner',
        'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status'
    ]

    header_fill = PatternFill(start_color="667eea", end_color="667eea", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')

    for row_idx, item in enumerate(data.items, 2):
        ws.cell(row=row_idx, column=1, value=item.id)
        ws.cell(row=row_idx, column=2, value=item.type.capitalize())
        ws.cell(row=row_idx, column=3, value=item.title)
        ws.cell(row=row_idx, column=4, value=item.description)
        ws.cell(row=row_idx, column=5, value=item.raised_by)
        ws.cell(row=row_idx, column=6, value=item.owner)
        ws.cell(row=row_idx, column=7, value=item.mitigation_actions)
        ws.cell(row=row_idx, column=8, value=item.impact)
        ws.cell(row=row_idx, column=9, value=item.likelihood)

        score_cell = ws.cell(row=row_idx, column=10, value=item.score)
        if item.score >= 16:
            score_cell.fill = PatternFill(start_color="FFE0E0", end_color="FFE0E0", fill_type="solid")
        elif item.score >= 6:
            score_cell.fill = PatternFill(start_color="FFF3BF", end_color="FFF3BF", fill_type="solid")
        else:
            score_cell.fill = PatternFill(start_color="D3F9D8", end_color="D3F9D8", fill_type="solid")

        ws.cell(row=row_idx, column=11, value=item.status.capitalize())

    column_widths = [6, 14, 25, 35, 15, 15, 35, 10, 12, 8, 14]
    for col, width in enumerate(column_widths, 1):
        ws.column_dimensions[get_column_letter(col)].width = width

    project_name = data.project_name or "Project"
    file_bytes = export_to_file(wb.save, suffix='.xlsx')
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": content_disposition(f"{project_name}-raid.xlsx")
        }
    )


@app.post("/api/raid/import-excel")
async def import_raid_excel(file: UploadFile = File(...)):
    """Import RAID log items from an Excel file."""
    from openpyxl import load_workbook

    if not file.filename.endswith('.xlsx'):
        raise HTTPException(status_code=400, detail="File must be .xlsx format")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large")

    try:
        wb = load_workbook(filename=io.BytesIO(content))
        ws = wb.active

        headers = [
            str(cell.value).lower().strip() if cell.value else ''
            for cell in ws[1]
        ]

        field_names = {
            'id': 'id', 'type': 'type', 'title': 'title',
            'description': 'description', 'raised by': 'raised_by',
            'owner': 'owner', 'mitigation actions': 'mitigation_actions',
            'impact': 'impact', 'likelihood': 'likelihood',
            'score': 'score', 'status': 'status'
        }

        col_map = {}
        for idx, header in enumerate(headers):
            if header in field_names:
                col_map[field_names[header]] = idx

        valid_types = {'risk', 'action', 'issue', 'decision', 'dependency'}
        valid_statuses = {'open', 'closed', 'transferred'}

        items = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not any(row):
                continue

            def get_cell(field, default=''):
                idx = col_map.get(field)
                if idx is not None and idx < len(row) and row[idx] is not None:
                    return row[idx]
                return default

            item_type = str(get_cell('type', 'risk')).lower().strip()
            item_status = str(get_cell('status', 'open')).lower().strip()
            if item_status == 'transferred to issue':
                item_status = 'transferred'

            impact = int(get_cell('impact', 3))
            likelihood = int(get_cell('likelihood', 3))
            impact = max(1, min(5, impact))
            likelihood = max(1, min(5, likelihood))

            item = {
                'id': int(get_cell('id', len(items) + 1)),
                'type': item_type if item_type in valid_types else 'risk',
                'title': str(get_cell('title', '')),
                'description': str(get_cell('description', '')),
                'raised_by': str(get_cell('raised_by', '')),
                'owner': str(get_cell('owner', '')),
                'mitigation_actions': str(get_cell('mitigation_actions', '')),
                'impact': impact,
                'likelihood': likelihood,
                'score': impact * likelihood,
                'status': item_status if item_status in valid_statuses else 'open',
            }
            items.append(item)

        return {"items": items}

    except (ValueError, KeyError, TypeError, IndexError) as e:
        logger.error(f"Error importing RAID Excel: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=400,
            detail=_sanitized_detail("Failed to parse Excel file", e)
        )


# ==============================================================================
# BUDGET API ENDPOINTS
# ==============================================================================


class BudgetItem(BaseModel):
    """A single budget item."""
    id: int
    description: str = Field("", max_length=500)
    estimate: float = Field(0, ge=0)
    forecast: float = Field(0, ge=0)
    type: str = Field("Capex", max_length=50)
    invoice: str = Field("", max_length=200)
    po: str = Field("", max_length=200)
    supplier: str = Field("", max_length=200)
    total: float = Field(0, ge=0)
    date_ordered: str = Field("", max_length=20)
    date_received: str = Field("", max_length=20)
    category: str = Field("Consultancy", max_length=50)


class BudgetExportRequest(BaseModel):
    """Request body for budget Excel export."""
    items: List[BudgetItem]
    project_name: Optional[str] = Field("Project", max_length=200)


class CommsExportRequest(BaseModel):
    items: list = []
    project_name: str = "Project"


@app.post("/api/comms/export-docx")
async def export_comms_docx(data: CommsExportRequest):
    """Export comms plan to a Word document."""
    from noodle_core import export_comms_to_docx

    docx_bytes = export_comms_to_docx(
        [item.dict() if hasattr(item, 'dict') else item for item in data.items],
        data.project_name
    )

    safe_name = "".join(c for c in data.project_name if c.isalnum() or c in " -_").strip()
    filename = f"{safe_name} - Communications Plan.docx"

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": content_disposition(filename)}
    )


@app.post("/api/budget/export-excel")
async def export_budget_excel(data: BudgetExportRequest):
    """Export budget items to an Excel file."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Budget"

    headers = [
        'ID', 'Description', 'Estimate', 'Forecast', 'Type',
        'Invoice', 'PO', 'Supplier', 'Total', 'Ordered',
        'Received', 'Category'
    ]

    header_fill = PatternFill(start_color="667eea", end_color="667eea", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')

    currency_cols = {3, 4, 9}  # Estimate, Forecast, Total

    for row_idx, item in enumerate(data.items, 2):
        ws.cell(row=row_idx, column=1, value=item.id)
        ws.cell(row=row_idx, column=2, value=item.description)

        for col_num, field in [(3, 'estimate'), (4, 'forecast'), (9, 'total')]:
            val = getattr(item, field, 0)
            cell = ws.cell(row=row_idx, column=col_num, value=val)
            cell.number_format = '#,##0.00'

        ws.cell(row=row_idx, column=5, value=item.type)
        ws.cell(row=row_idx, column=6, value=item.invoice)
        ws.cell(row=row_idx, column=7, value=item.po)
        ws.cell(row=row_idx, column=8, value=item.supplier)
        ws.cell(row=row_idx, column=10, value=item.date_ordered)
        ws.cell(row=row_idx, column=11, value=item.date_received)
        ws.cell(row=row_idx, column=12, value=item.category)

    # Summary row
    if data.items:
        last_row = len(data.items) + 2
        ws.cell(row=last_row, column=2, value='TOTALS').font = Font(bold=True)
        for col_num, field in [(3, 'estimate'), (4, 'forecast'), (9, 'total')]:
            total_val = sum(getattr(item, field, 0) for item in data.items)
            cell = ws.cell(row=last_row, column=col_num, value=total_val)
            cell.font = Font(bold=True)
            cell.number_format = '#,##0.00'

    column_widths = [6, 30, 12, 12, 10, 15, 12, 20, 12, 12, 12, 18]
    for col, width in enumerate(column_widths, 1):
        ws.column_dimensions[get_column_letter(col)].width = width

    project_name = data.project_name or "Project"
    file_bytes = export_to_file(wb.save, suffix='.xlsx')
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": content_disposition(f"{project_name}-budget.xlsx")
        }
    )


@app.post("/api/budget/import-excel")
async def import_budget_excel(file: UploadFile = File(...)):
    """Import budget items from an Excel file."""
    from openpyxl import load_workbook

    if not file.filename.endswith('.xlsx'):
        raise HTTPException(status_code=400, detail="File must be .xlsx format")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large")

    try:
        wb = load_workbook(filename=io.BytesIO(content))
        ws = wb.active

        headers = [
            str(cell.value).lower().strip() if cell.value else ''
            for cell in ws[1]
        ]

        field_names = {
            'id': 'id', 'description': 'description', 'estimate': 'estimate',
            'forecast': 'forecast', 'type': 'type', 'invoice': 'invoice',
            'po': 'po', 'supplier': 'supplier', 'total': 'total',
            'ordered': 'date_ordered', 'received': 'date_received',
            'category': 'category'
        }

        col_map = {}
        for idx, header in enumerate(headers):
            for key, field in field_names.items():
                if key in header:
                    col_map[field] = idx
                    break

        valid_types = {'Capex', 'Opex', 'One-off'}
        valid_categories = {
            'Consultancy', 'Resource', 'Travel',
            'Infrastructure', 'Hardware', 'Software'
        }

        items = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not any(row):
                continue

            def get_cell(field, default=''):
                idx = col_map.get(field)
                if idx is not None and idx < len(row) and row[idx] is not None:
                    return row[idx]
                return default

            def safe_float(val, default=0):
                try:
                    return float(val) if val else default
                except (ValueError, TypeError):
                    return default

            description = str(get_cell('description', ''))
            # Skip summary/totals rows
            if description.upper() in ('TOTALS', 'TOTAL', ''):
                continue

            item_type = str(get_cell('type', 'Capex'))
            item_category = str(get_cell('category', 'Consultancy'))

            item = {
                'id': int(get_cell('id', len(items) + 1)),
                'description': description,
                'estimate': safe_float(get_cell('estimate', 0)),
                'forecast': safe_float(get_cell('forecast', 0)),
                'type': item_type if item_type in valid_types else 'Capex',
                'invoice': str(get_cell('invoice', '')),
                'po': str(get_cell('po', '')),
                'supplier': str(get_cell('supplier', '')),
                'total': safe_float(get_cell('total', 0)),
                'date_ordered': str(get_cell('date_ordered', '')),
                'date_received': str(get_cell('date_received', '')),
                'category': item_category if item_category in valid_categories else 'Consultancy',
            }
            items.append(item)

        return {"items": items}

    except (ValueError, KeyError, TypeError, IndexError) as e:
        logger.error(f"Error importing budget Excel: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=400,
            detail=_sanitized_detail("Failed to parse Excel file", e)
        )


# ==============================================================================
# ACTIONS API ENDPOINTS
# ==============================================================================


@app.post("/api/excel/analyze")
async def excel_analyze(file: UploadFile = File(...)):
    """Analyze an uploaded Excel file and return sheet/column metadata."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    extension = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if extension not in ("xlsx", "xls"):
        raise HTTPException(status_code=400, detail="File must be .xlsx or .xls")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds maximum allowed")

    try:
        result = analyze_workbook(file_bytes, file.filename)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (KeyError, TypeError, IndexError, OSError) as e:
        logger.error(f"Error analyzing Excel file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=_sanitized_detail("Failed to analyze file", e))


@app.post("/api/excel/convert")
async def excel_convert(
    file: UploadFile = File(...),
    sheet_name: str = Form(...),
    column_mapping: str = Form(...),
):
    """Convert an Excel worksheet to NoodlePlanner markdown format."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    extension = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if extension not in ("xlsx", "xls"):
        raise HTTPException(status_code=400, detail="File must be .xlsx or .xls")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds maximum allowed")

    try:
        mapping = json.loads(column_mapping)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid column_mapping JSON")

    if "task_name" not in mapping or not mapping["task_name"]:
        raise HTTPException(status_code=400, detail="task_name mapping is required")

    try:
        result = convert_excel_to_markdown(file_bytes, file.filename, sheet_name, mapping)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (KeyError, TypeError, IndexError, OSError) as e:
        logger.error(f"Error converting Excel file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=_sanitized_detail("Failed to convert file", e))


@app.post("/api/excel/convert-planner")
async def excel_convert_planner(file: UploadFile = File(...)):
    """Convert a Microsoft Planner export to NoodlePlanner markdown format."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    extension = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if extension not in ("xlsx", "xls"):
        raise HTTPException(status_code=400, detail="File must be .xlsx or .xls")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds maximum allowed")

    try:
        result = convert_planner_to_markdown(file_bytes, file.filename)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (KeyError, TypeError, IndexError, OSError) as e:
        logger.error(f"Error converting Planner file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=_sanitized_detail("Failed to convert Planner file", e))


@app.post("/api/msproject/import")
async def import_msproject(file: UploadFile = File(...)):
    """Import a Microsoft Project XML file and convert to NoodlePlanner markdown."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    extension = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if extension == "mpp":
        # Native .mpp files are read in the browser with mppwriter and never
        # uploaded (issue #770); the page routes them before reaching here.
        raise HTTPException(
            status_code=400,
            detail="Native .mpp files are imported in the browser; this endpoint accepts MS Project XML only",
        )
    if extension != "xml":
        raise HTTPException(status_code=400, detail="File must be .xml format")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds maximum allowed")

    try:
        xml_content = file_bytes.decode("utf-8")
        markdown = import_from_msproject_xml(xml_content)

        return {"markdown": markdown, "filename": file.filename}
    except HTTPException:
        raise
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be a valid UTF-8 XML file")
    except ET.ParseError as e:
        raise HTTPException(status_code=400, detail=f"Invalid XML file: {str(e)}")
    except ImportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Error reading .mpp file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=_sanitized_detail("Failed to read .mpp file", e))
    except (ValueError, KeyError, TypeError) as e:
        logger.error(f"Error importing MS Project file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=_sanitized_detail("Failed to import MS Project file", e))



# ==============================================================================
# TEMPLATES API ENDPOINTS
# ==============================================================================


@app.get("/api/templates")
async def get_templates():
    """Get all available templates with metadata."""
    templates_dir = TEMPLATES_DIR

    if not templates_dir.exists():
        return {"templates": [], "categories": []}

    templates = []
    categories = set()

    for template_path in templates_dir.iterdir():
        if template_path.is_dir():
            template_yml = template_path / "template.yml"
            plan_md = template_path / "plan.md"

            if template_yml.exists() and plan_md.exists():
                try:
                    with open(template_yml, 'r', encoding='utf-8') as f:
                        metadata = yaml.safe_load(f)

                    # Find hero image
                    hero_image = None
                    for ext in ['.jpg', '.jpeg', '.png', '.gif']:
                        hero_path = template_path / f"hero{ext}"
                        if hero_path.exists():
                            hero_image = f"/api/templates/{template_path.name}/hero{ext}"
                            break

                    template_data = {
                        "id": template_path.name,
                        "title": metadata.get("title", template_path.name),
                        "description": metadata.get("description", ""),
                        "author": metadata.get("author", ""),
                        "category": metadata.get("category", "General"),
                        "hero_image": hero_image,
                        "popular": metadata.get("popular", False)
                    }

                    templates.append(template_data)
                    categories.add(metadata.get("category", "General"))

                except (yaml.YAMLError, OSError, KeyError, TypeError) as e:
                    logger.error(f"Error loading template {template_path.name}: {e}")

    return {
        "templates": sorted(templates, key=lambda x: x["title"]),
        "categories": sorted(list(categories))
    }


@app.get("/api/templates/{template_id}")
async def get_template(template_id: str):
    """Get a specific template's content and metadata."""
    templates_dir = TEMPLATES_DIR
    template_path = (templates_dir / template_id).resolve()
    if not str(template_path).startswith(str(templates_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid template ID")

    if not template_path.exists() or not template_path.is_dir():
        raise HTTPException(status_code=404, detail="Template not found")

    template_yml = template_path / "template.yml"
    plan_md = template_path / "plan.md"

    if not template_yml.exists() or not plan_md.exists():
        raise HTTPException(status_code=404, detail="Template files not found")

    try:
        with open(template_yml, 'r', encoding='utf-8') as f:
            metadata = yaml.safe_load(f)

        with open(plan_md, 'r', encoding='utf-8') as f:
            content = f.read()

        # Find hero image
        hero_image = None
        for ext in ['.jpg', '.jpeg', '.png', '.gif']:
            hero_path = template_path / f"hero{ext}"
            if hero_path.exists():
                hero_image = f"/api/templates/{template_id}/hero{ext}"
                break

        return {
            "id": template_id,
            "title": metadata.get("title", template_id),
            "description": metadata.get("description", ""),
            "author": metadata.get("author", ""),
            "category": metadata.get("category", "General"),
            "hero_image": hero_image,
            "content": content,
            "popular": metadata.get("popular", False)
        }

    except (yaml.YAMLError, OSError, KeyError, TypeError) as e:
        logger.error(f"Error loading template {template_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to load template")


@app.get("/api/templates/{template_id}/hero.{ext}")
async def get_template_hero(template_id: str, ext: str):
    """Serve template hero images."""
    if ext.lower() not in ['jpg', 'jpeg', 'png', 'gif']:
        raise HTTPException(status_code=400, detail="Invalid image format")

    templates_dir = TEMPLATES_DIR
    hero_path = (templates_dir / template_id / f"hero.{ext}").resolve()
    if not str(hero_path).startswith(str(templates_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid template ID")

    if not hero_path.exists():
        raise HTTPException(status_code=404, detail="Hero image not found")

    # Determine media type
    media_types = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif'
    }

    return FileResponse(hero_path, media_type=media_types[ext.lower()])


@app.get("/templates", response_class=HTMLResponse)
async def templates_page(request: Request):
    """Serve the templates page."""
    return templates.TemplateResponse(request, "templates.html", {
        "v": STATIC_VERSION,
    })


def _app_stylesheets() -> list[str]:
    """The /static stylesheets index.html links, in load order.

    Read out of the template rather than listed here so the component gallery
    cannot drift from the app: a gallery styled by a stale copy of the
    stylesheet list is worse than no gallery at all.
    """
    index = (package_dir / "templates" / "index.html").read_text()
    return re.findall(r'href="/static/([^"?]+\.css)', index)


@app.get("/components", response_class=HTMLResponse)
async def component_gallery(request: Request):
    """Serve the component gallery (#1193).

    Every canonical component rendered against the app's real stylesheets, in
    both themes, so drift is visible in one place.
    """
    return templates.TemplateResponse(request, "components.html", {
        "v": STATIC_VERSION,
        "stylesheets": _app_stylesheets(),
    })


# ==============================================================================
# PROGRAMME DEPENDENCIES API ENDPOINTS
# ==============================================================================


class ProgrammeDependency(BaseModel):
    """A dependency link between a task in one project and a task in another."""
    id: str = Field(..., max_length=100)
    from_project_id: str = Field(..., max_length=200)
    from_task_name: str = Field(..., max_length=500)
    to_project_id: str = Field(..., max_length=200)
    to_task_name: str = Field(..., max_length=500)
    lag_days: int = Field(0)
    notes: str = Field("", max_length=1000)


class ParsedTask(BaseModel):
    """A parsed task from a project plan."""
    name: str = Field("", max_length=500)
    start: Optional[str] = Field(None, max_length=50)
    finish: Optional[str] = Field(None, max_length=50)
    duration_days: int = Field(0)
    percent: float = Field(0)
    is_summary: bool = Field(False)


class ParsedProjectData(BaseModel):
    """Parsed data for a single project."""
    project_id: str = Field(..., max_length=200)
    project_name: str = Field(..., max_length=500)
    tasks: List[ParsedTask] = Field(default_factory=list)


class DependencyPropagateRequest(BaseModel):
    """Request to calculate propagated dates and RAG for programme dependencies."""
    dependencies: List[ProgrammeDependency] = Field(default_factory=list)
    projects: List[ParsedProjectData] = Field(default_factory=list)


def _find_task_in_project(tasks: List[dict], task_name: str) -> Optional[dict]:
    """Find a task by name (case-insensitive partial match) in a task list."""
    task_name_lower = task_name.lower().strip()
    for task in tasks:
        if task.get("name", "").lower().strip() == task_name_lower:
            return task
    # Fallback: partial match
    for task in tasks:
        if task_name_lower in task.get("name", "").lower():
            return task
    return None


def _calculate_dependency_rag(
    from_task: dict,
    to_task: dict,
    lag_days: int,
) -> dict:
    """Calculate RAG status for a single dependency link.

    Returns a dict with:
      - rag: 'red', 'amber', or 'green'
      - reason: human-readable explanation
      - propagated_start: ISO date string or None
    """
    from datetime import date, timedelta

    from_finish = from_task.get("finish")
    to_start = to_task.get("start")
    to_finish = to_task.get("finish")
    to_percent = float(to_task.get("percent") or 0)

    if not from_finish:
        return {"rag": "grey", "reason": "Source task has no finish date", "propagated_start": None}

    try:
        from_finish_date = date.fromisoformat(str(from_finish)[:10])
    except ValueError:
        return {"rag": "grey", "reason": "Invalid source task finish date", "propagated_start": None}

    # The dependent task should start no earlier than from_finish + lag_days
    required_start = from_finish_date + timedelta(days=lag_days)
    propagated_start = required_start.isoformat()

    if not to_start:
        return {
            "rag": "amber",
            "reason": f"Dependent task has no start date; should start on {propagated_start}",
            "propagated_start": propagated_start,
        }

    try:
        to_start_date = date.fromisoformat(str(to_start)[:10])
    except ValueError:
        return {"rag": "grey", "reason": "Invalid dependent task start date", "propagated_start": propagated_start}

    today = date.today()

    # Red: dependent task starts before source finishes (dependency violated)
    if to_start_date < required_start:
        return {
            "rag": "red",
            "reason": (
                f"Dependency violated: task starts {to_start_date} "
                f"but must start on or after {required_start}"
            ),
            "propagated_start": propagated_start,
        }

    # Check if finish is overdue
    if to_finish:
        try:
            to_finish_date = date.fromisoformat(str(to_finish)[:10])
            if to_finish_date < today and to_percent < 100:
                return {
                    "rag": "red",
                    "reason": f"Dependent task overdue (finish {to_finish_date}, {to_percent:.0f}% complete)",
                    "propagated_start": propagated_start,
                }
        except ValueError:
            pass

    # Amber: dependent task hasn't started yet but source finished in the past
    if from_finish_date < today and to_start_date > today and to_percent == 0:
        return {
            "rag": "amber",
            "reason": (
                f"Source finished {from_finish_date} but dependent task not yet started"
            ),
            "propagated_start": propagated_start,
        }

    return {
        "rag": "green",
        "reason": f"Dependency satisfied; task starts {to_start_date}",
        "propagated_start": propagated_start,
    }


@app.post("/api/programme-dependencies/propagate")
async def propagate_programme_dependencies(data: DependencyPropagateRequest):
    """Calculate RAG status and propagated dates for inter-project dependencies.

    For each dependency link, finds the source and target tasks, calculates
    whether the dependency constraint is satisfied, and returns RAG colour
    with reasoning for display in the portfolio timeline view.
    """
    logger.info(
        "Programme dependency propagation request: %d dependencies, %d projects",
        len(data.dependencies),
        len(data.projects),
    )

    # Build lookup: project_id -> {task_name_lower -> task_dict}
    project_task_map: dict[str, list] = {}
    for proj in data.projects:
        project_task_map[proj.project_id] = [t.model_dump() for t in proj.tasks]

    results = []
    for dep in data.dependencies:
        from_tasks = project_task_map.get(dep.from_project_id, [])
        to_tasks = project_task_map.get(dep.to_project_id, [])

        from_task = _find_task_in_project(from_tasks, dep.from_task_name)
        to_task = _find_task_in_project(to_tasks, dep.to_task_name)

        if from_task is None:
            result = {
                "dependency_id": dep.id,
                "rag": "grey",
                "reason": f"Source task '{dep.from_task_name}' not found in project",
                "propagated_start": None,
                "from_task": None,
                "to_task": None,
            }
        elif to_task is None:
            result = {
                "dependency_id": dep.id,
                "rag": "grey",
                "reason": f"Dependent task '{dep.to_task_name}' not found in project",
                "propagated_start": None,
                "from_task": from_task,
                "to_task": None,
            }
        else:
            rag_info = _calculate_dependency_rag(from_task, to_task, dep.lag_days)
            result = {
                "dependency_id": dep.id,
                "rag": rag_info["rag"],
                "reason": rag_info["reason"],
                "propagated_start": rag_info["propagated_start"],
                "from_task": from_task,
                "to_task": to_task,
            }

        results.append(result)

    # Overall programme RAG: worst of all dependency RAGs
    rag_priority = {"red": 3, "amber": 2, "green": 1, "grey": 0}
    overall_rag = "green"
    if results:
        worst = max(results, key=lambda r: rag_priority.get(r["rag"], 0))
        overall_rag = worst["rag"]
    elif not data.dependencies:
        overall_rag = "grey"

    return {
        "results": results,
        "overall_rag": overall_rag,
        "dependency_count": len(results),
    }


# ── AI Routes ─────────────────────────────────────────────────


@app.post("/api/ai/chat")
async def ai_chat(request: AIChatRequest):
    """Proxy a chat completion request to the configured AI provider.

    Streams the response as Server-Sent Events.
    When plan_text is provided, uses tool-calling flow so the model can
    modify the plan via deterministic tool functions.
    """
    logger.info("AI chat: plan_text length=%d, using %s",
                len(request.plan_text) if request.plan_text else 0,
                "tools" if request.plan_text else "regular")
    if request.plan_text:
        generator = proxy_chat_with_tools(
            endpoint=request.endpoint,
            api_key=request.api_key,
            model=request.model,
            provider=request.provider,
            messages=request.messages,
            plan_text=request.plan_text,
        )
    else:
        generator = proxy_chat_completion(
            endpoint=request.endpoint,
            api_key=request.api_key,
            model=request.model,
            messages=request.messages,
            provider=request.provider,
            stream=request.stream,
        )

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/ai/test")
async def ai_test(request: AITestRequest):
    """Test connectivity to an AI provider."""
    result = await test_connection(
        endpoint=request.endpoint,
        api_key=request.api_key,
        model=request.model,
        provider=request.provider,
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.get("/api/ai/agents")
async def ai_agents_list():
    """List all available AI agent templates."""
    return list_agents()


@app.get("/api/ai/agents/{agent_id}")
async def ai_agent_detail(agent_id: str):
    """Get a single agent's metadata and system prompt."""
    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


# ==============================================================================
# COLLAB SESSION ROUTES (#963) -- WebSocket relay foundation for #766.
#
# See collab_session.py's module docstring for the full wire protocol. In
# short: POST /api/collab/start creates a session; the host's browser then
# opens /ws/session/{session_id}?token=... and joiners, who only know the
# six-digit code, open /ws/join and send a {"type": "join", ...} handshake
# as their first message. Everything after that is an opaque relay -- no
# plan content is parsed, stored, or logged here.
#
# #964 (end-to-end encryption): every payload relayed here is, by
# construction, AES-GCM ciphertext produced client-side by
# static/collab-crypto.js -- this relay still never decrypts or interprets
# it. The one bit of bootstrapping plumbing added for #964 is
# `_maybe_cache_host_pubkey`: it peeks only at a message's `type`
# discriminator (never plan content) to cache the host's ephemeral ECDH
# public-key announcement, so a joiner who connects after the host already
# broadcast it still receives it on admission. See collab_session.py's
# docstring and collab-crypto.js's module docstring for the full design,
# including why the join code now also authenticates that handshake.
# ==============================================================================


@app.post("/api/collab/start")
async def start_collab_session():
    """Start a new collab session and return its id, host token, join code,
    and the join page's path.

    Deliberately takes no request body -- there is nothing project- or
    plan-related for the relay to know about, by design (see #766's
    architecture constraint).
    """
    info = collab_sessions.create_session()
    return {
        "session_id": info.session_id,
        "host_token": info.host_token,
        "join_code": info.join_code,
        "holding_url": info.holding_url,
    }


@app.get("/join", response_class=HTMLResponse)
async def collab_join_page(request: Request):
    """Serve the minimal joiner page: enter the code and a display name.

    The same page for every session -- the code the joiner types is what
    picks the session (see `collab_join_ws`).
    """
    return templates.TemplateResponse(request, "collab_join.html", {"v": STATIC_VERSION})


async def _admit_joiner(websocket: WebSocket) -> tuple[Optional[SessionState], str]:
    """Read the joiner's handshake message and admit or reject them.

    On rejection the socket is closed here and (None, "") is returned.
    """
    try:
        raw = await websocket.receive_text()
    except WebSocketDisconnect:
        return None, ""

    try:
        handshake = json.loads(raw)
    except (TypeError, ValueError):
        handshake = None

    code = handshake.get("code") if isinstance(handshake, dict) else None
    display_name = handshake.get("display_name") if isinstance(handshake, dict) else None

    if (
        not isinstance(handshake, dict)
        or handshake.get("type") != "join"
        or not isinstance(code, str)
        or not isinstance(display_name, str)
        or not display_name.strip()
    ):
        await websocket.close(code=4400, reason="Malformed join request.")
        return None, ""

    display_name = display_name.strip()[:100]
    state = collab_sessions.join_by_code(code, display_name, websocket)
    if state is None:
        # #1057: distinct from the malformed-handshake case above -- the
        # request was well-formed but the code didn't match a live session
        # (wrong code, or a code for a session that already ended/expired).
        # collab_join.html surfaces this `reason` directly to the joiner
        # instead of always guessing "check the code", which was misleading
        # when the real cause was something else entirely (e.g. #1057's
        # report: a corporate network's proxy interfering with the
        # WebSocket, which closes with no reason at all -- see that
        # module's close handler for how it tells the two apart).
        await websocket.close(code=4401, reason="Incorrect or expired code.")
        return None, ""

    # The joiner only knew the code; its crypto needs the session id (KDF
    # salt and AEAD associated data), so hand it over with the admission.
    await websocket.send_text(json.dumps({
        "type": "joined",
        "display_name": display_name,
        "session_id": state.session_id,
    }))
    # #964: if the host already broadcast its ECDH public-key handshake
    # announcement before this joiner connected, that broadcast is long
    # gone -- hand the joiner the cached copy now so it can still complete
    # the key exchange. Not secret content (see collab-crypto.js), so no
    # architecture constraint is bent by caching/replaying it here.
    if state.host_public_key_msg is not None:
        await websocket.send_text(state.host_public_key_msg)
    # #966: the host's presence panel needs to know about this joiner right
    # away, not just the next time something else happens to trigger a
    # broadcast.
    await _broadcast_presence(state)
    return state, display_name


def _maybe_cache_host_pubkey(state: SessionState, message: str) -> None:
    """Cache the host's ECDH public-key handshake announcement (#964).

    Peeks only at the message's ``type`` discriminator -- never at plan
    content -- so a joiner admitted after the host already broadcast this
    still gets it (see ``_admit_joiner``). Anything that isn't a
    recognizable ``host_pubkey`` announcement (in particular, every
    encrypted plan-content envelope) is a silent no-op: this relay still
    has no opinion about ordinary traffic.
    """
    try:
        parsed = json.loads(message)
    except (TypeError, ValueError):
        return
    if isinstance(parsed, dict) and parsed.get("type") == "host_pubkey":
        state.host_public_key_msg = message


def _is_end_session_message(message: str) -> bool:
    """True if `message` is the host's explicit "end session" control
    message (#965): ``{"type": "end_session"}``, sent over the same
    WebSocket that's already carrying the relay -- chosen over a separate
    HTTP endpoint because ending a session is a live action on an
    already-open connection (like every other relay message), not a fresh
    resource request the way `POST /api/collab/start` is.

    Peeks only at the `type` discriminator, same as
    `_maybe_cache_host_pubkey` above: never interprets anything else about
    message content.
    """
    try:
        parsed = json.loads(message)
    except (TypeError, ValueError):
        return False
    return isinstance(parsed, dict) and parsed.get("type") == "end_session"


def _parse_kick_message(message: str) -> Optional[int]:
    """Return the `joiner_id` from the host's `{"type": "kick", "joiner_id":
    ...}` control message (#966), or None if `message` isn't one.
    `joiner_id` is the same opaque `Joiner.joiner_id` key `SessionState.joiners`
    is keyed by, which is exactly what `SessionState.presence_snapshot()`
    hands the host in each presence update -- so the host never has to
    invent or track its own identifier for a joiner.

    Same type-discriminator-only peek as `_is_end_session_message` above:
    never interprets anything else about message content.
    """
    try:
        parsed = json.loads(message)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict) or parsed.get("type") != "kick":
        return None
    joiner_id = parsed.get("joiner_id")
    return joiner_id if isinstance(joiner_id, int) else None


def _parse_to_joiner_envelope(message: str) -> Optional[tuple[int, str]]:
    """Return `(joiner_id, inner_frame)` from the host's ``{"type":
    "to_joiner", "joiner_id": N, "frame": "..."}`` envelope (#967), or None
    if `message` isn't one.

    #963 gave the host a single broadcast channel, which was enough while
    every joiner shared one session key. #967 gives each joiner its own
    ECDH session key with the host, so the same logical update has to be
    encrypted separately per joiner -- meaning the host needs to address a
    frame at one joiner rather than broadcast it.

    Only the envelope is read. `frame` is passed through untouched, still
    the opaque AES-GCM ciphertext collab-crypto.js produced: this relay
    learns who a frame is for, which is ordinary routing metadata it
    already holds (it assigned the id and reports it in every presence
    snapshot), and never what the frame says.
    """
    try:
        parsed = json.loads(message)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict) or parsed.get("type") != "to_joiner":
        return None
    joiner_id = parsed.get("joiner_id")
    frame = parsed.get("frame")
    if not isinstance(joiner_id, int) or not isinstance(frame, str):
        return None
    return joiner_id, frame


def _wrap_from_joiner(joiner_id: int, frame: str) -> str:
    """Tag a joiner's frame with its sender id before relaying it to the
    host (#967).

    Without this the host cannot tell two joiners apart on the inbound
    side, so it could only ever hold one joiner's session key at a time
    (see collab-session.js's `collabSessionKeys`). `frame` is embedded
    verbatim -- this adds an addressing header around ciphertext, it does
    not inspect or alter it.
    """
    return json.dumps({"type": "from_joiner", "joiner_id": joiner_id, "frame": frame})


def _is_presence_ping_message(message: str) -> bool:
    """True if `message` is a joiner's lightweight `{"type":
    "presence_ping"}` heartbeat (#966), sent periodically by
    collab_join.html purely so the host's presence panel can show this
    joiner as active even when they haven't sent any real content --
    see collab_session.py's `PRESENCE_ACTIVE_WINDOW_SECONDS`. Intercepted
    here, same as `_is_end_session_message` above, so it is never relayed
    to the host as if it were opaque content.
    """
    try:
        parsed = json.loads(message)
    except (TypeError, ValueError):
        return False
    return isinstance(parsed, dict) and parsed.get("type") == "presence_ping"


async def _broadcast_presence(state: SessionState) -> None:
    """Push a full presence snapshot to the host (#966).

    Called whenever the joiner list or an active/inactive status might have
    changed: a joiner is admitted, disconnects, or is kicked, or a joiner's
    heartbeat ping arrives (see `_is_presence_ping_message`) -- that last
    one is this feature's substitute for a wall-clock periodic refresh,
    piggybacking on traffic that already exists instead of adding another
    background task, so a quiet single-joiner session's status doesn't go
    stale. A no-op if no host is currently attached (e.g. between a page
    refresh and reconnect).
    """
    if state.host is None:
        return
    message = json.dumps({"type": "presence", "joiners": state.presence_snapshot()})
    async with state.host_send_lock:
        try:
            await state.host.send_text(message)
        except Exception:
            pass


async def _relay_as_host(state: SessionState, websocket: WebSocket, session_id: str) -> None:
    ended_explicitly = False
    try:
        while True:
            message = await websocket.receive_text()
            state.touch()

            if _is_end_session_message(message):
                # #965: explicit host-initiated end. Tear down every joiner
                # socket with a close reason the joiner's UI can display
                # (see CLOSE_REASON_HOST_ENDED / collab_join.html), then
                # close the host's own socket the same way. `exclude`
                # avoids teardown() redundantly trying to close this same
                # socket a second time.
                ended_explicitly = True
                await collab_sessions.teardown(
                    session_id, code=CLOSE_HOST_ENDED, reason=CLOSE_REASON_HOST_ENDED, exclude=websocket
                )
                await websocket.close(code=CLOSE_HOST_ENDED, reason=CLOSE_REASON_HOST_ENDED)
                return

            kick_joiner_id = _parse_kick_message(message)
            if kick_joiner_id is not None:
                # #966: host removed one participant from the presence
                # panel. Only that joiner's socket is closed -- the session
                # and every other joiner are unaffected -- then the host
                # gets an updated presence snapshot reflecting the removal,
                # same as any other presence-changing event.
                await collab_sessions.kick_joiner(session_id, kick_joiner_id, code=CLOSE_KICKED, reason=CLOSE_REASON_KICKED)
                await _broadcast_presence(state)
                continue

            addressed = _parse_to_joiner_envelope(message)
            if addressed is not None:
                # #967: a frame encrypted for one specific joiner. Deliver
                # the inner frame to just that socket -- unwrapped, so the
                # joiner's own handling is unchanged from #963/#964 and it
                # never has to know this addressing layer exists. Silently
                # dropped if that joiner has since left, exactly as a
                # broadcast to a departed joiner would be.
                target_id, inner_frame = addressed
                target = state.joiners.get(target_id)
                if target is not None:
                    try:
                        await target.websocket.send_text(inner_frame)
                    except Exception:
                        pass
                continue

            _maybe_cache_host_pubkey(state, message)
            for joiner in list(state.joiners.values()):
                try:
                    await joiner.websocket.send_text(message)
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    finally:
        # Only tear down if this socket is still the attached host -- a
        # stale connection from a page refresh mustn't kill the live one.
        # Skipped when `ended_explicitly`: that branch above already tore
        # the session down with a more specific close reason.
        if not ended_explicitly and state.host is websocket:
            # #965: host disconnected without an explicit end_session
            # message -- closed laptop, crash, network drop are all
            # indistinguishable from here, so all of them get the same
            # "host disconnected" reason (as opposed to CLOSE_HOST_ENDED,
            # which only the explicit action above uses).
            await collab_sessions.teardown(
                session_id, code=CLOSE_HOST_DISCONNECTED, reason=CLOSE_REASON_HOST_DISCONNECTED, exclude=websocket
            )


async def _relay_as_joiner(state: SessionState, websocket: WebSocket, session_id: str) -> None:
    try:
        while True:
            message = await websocket.receive_text()
            state.touch()
            # Re-resolved per message rather than captured once: a joiner
            # kicked mid-loop is removed from `joiners`, and this must then
            # stop attributing traffic (or a sender id) to them.
            joiner_id = state.joiner_id_for(websocket)
            joiner = state.joiners.get(joiner_id) if joiner_id is not None else None
            if joiner is not None:
                # #966: per-joiner activity, distinct from `state.touch()`
                # above -- drives this one joiner's active/inactive status
                # in the host's presence panel, not session-level idle
                # expiry.
                joiner.touch()

            if _is_presence_ping_message(message):
                # #966: a heartbeat, not content -- never relay it to the
                # host, just let it refresh this joiner's activity (above)
                # and push the host an updated presence snapshot.
                await _broadcast_presence(state)
                continue

            host = state.host
            if host is not None and joiner_id is not None:
                # #967: tag the frame with this joiner's id so the host can
                # tell concurrent joiners apart and keep a separate session
                # key per joiner. The ciphertext itself is untouched.
                tagged = _wrap_from_joiner(joiner_id, message)
                async with state.host_send_lock:
                    try:
                        await host.send_text(tagged)
                    except Exception:
                        pass
    except WebSocketDisconnect:
        pass
    finally:
        collab_sessions.remove_joiner(session_id, websocket)
        # #966: the presence panel must reflect this departure right away,
        # not just the next time some other event happens to broadcast it.
        await _broadcast_presence(state)


@app.websocket("/ws/session/{session_id}")
async def collab_session_ws(websocket: WebSocket, session_id: str):
    """Host relay endpoint. See this module's header comment and
    collab_session.py for the full handshake protocol."""
    await websocket.accept()
    token = websocket.query_params.get("token")
    state = collab_sessions.attach_host(session_id, token, websocket) if token else None
    if state is None:
        await websocket.close(code=4401)
        return
    await _relay_as_host(state, websocket, session_id)


@app.websocket("/ws/join")
async def collab_join_ws(websocket: WebSocket):
    """Joiner relay endpoint. The joiner knows only the six-digit code,
    which its first message carries; that picks the session."""
    await websocket.accept()

    # #965: rate limit join attempts per source IP. Each WebSocket
    # connection reaching this point is one attempt -- checked before
    # `_admit_joiner` reads the handshake message, since a flood of
    # connection attempts is itself the thing being rate limited, whether
    # or not each one gets as far as sending a (possibly wrong) code.
    ip = get_websocket_client_ip(websocket)
    limited, retry_after = is_join_rate_limited(ip)
    if limited:
        await websocket.close(code=4429, reason=f"Too many join attempts. Retry in {retry_after}s.")
        return

    state, _display_name = await _admit_joiner(websocket)
    if state is None:
        return
    # #971: this one presented the correct code, so it was a colleague
    # arriving rather than an attempt at the 6-digit space. Give the budget
    # back, or a team behind one office IP cannot get past its tenth member
    # -- see forgive_join_attempt's docstring.
    forgive_join_attempt(ip)
    await _relay_as_joiner(state, websocket, state.session_id)


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8007))

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        reload=os.getenv("RELOAD", "false").lower() == "true"
    )
