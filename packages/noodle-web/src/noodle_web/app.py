import os
import io
import re
import hashlib
import tempfile
import logging
import zipfile
import yaml
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, File, UploadFile, HTTPException, Request, Form
from fastapi.responses import Response, HTMLResponse, FileResponse
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
)
from noodle_core.planning_room import generate_plan_from_planning_room as generate_plan_core
import json
from .middleware import ActivityLoggingMiddleware
from .database import init_db, test_connection

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

app = FastAPI(
    title="Noodle Planner API",
    description="Project planning and scheduling tool",
    version="1.0.0"
)

# Mount static files and setup templates
package_dir = Path(__file__).parent
app.mount("/static", StaticFiles(directory=str(package_dir / "static")), name="static")
templates = Jinja2Templates(directory=str(package_dir / "templates"))


def _static_version():
    """Generate a cache-busting version string from static file contents."""
    static_dir = package_dir / "static"
    h = hashlib.md5()
    for f in sorted(static_dir.glob("*")):
        if f.is_file():
            h.update(str(f.stat().st_mtime_ns).encode())
    return h.hexdigest()[:8]


STATIC_VERSION = _static_version()

# Add activity logging middleware
app.add_middleware(ActivityLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup"""
    logger.info("Starting up application...")
    if test_connection():
        logger.info("Database connection successful")
        logger.info("Note: Database schema is managed via Alembic migrations")
        logger.info("Run 'alembic upgrade head' to apply pending migrations")
    else:
        logger.warning("Database connection failed - activity logging may not work")


class RenderRequest(BaseModel):
    plan_text: str = Field(..., max_length=MAX_FILE_SIZE)
    project_name: Optional[str] = Field(None, max_length=200)
    export_excel: bool = Field(False)
    export_csv: bool = Field(False)
    export_ppt: bool = Field(False)
    export_pdf: bool = Field(False)



@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main HTML page."""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "v": STATIC_VERSION,
    })


@app.post("/", response_class=HTMLResponse)
async def index_with_template(request: Request, template_content: str = Form(None)):
    """Serve the main HTML page with template content pre-loaded."""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "v": STATIC_VERSION,
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


@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.post("/render")
async def render_plan(data: RenderRequest):
    """Render a project plan and optionally export to Excel/PPT/PDF."""
    logger.info(f"Render request: exports={data.export_excel}, {data.export_ppt}, {data.export_pdf}")

    # Extract title from front matter if present
    title_from_frontmatter = extract_title_from_frontmatter(data.plan_text)
    project_name = data.project_name or title_from_frontmatter or "Project"

    try:
        # Convert plan format (strip front matter)
        converted_content = convert_plan_format_to_standard(data.plan_text)

        # Check if we need exports
        has_exports = data.export_excel or data.export_csv or data.export_ppt or data.export_pdf

        if has_exports:
            # Count how many exports are requested
            export_count = sum([data.export_excel, data.export_csv, data.export_ppt, data.export_pdf])

            # If only one export is requested, return it directly
            if export_count == 1:
                if data.export_excel:
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                            tmp_path = tmp.name
                        export_to_excel(
                            converted_content,
                            tmp_path,
                            is_yaml=False,
                            project_name=project_name,
                            original_text=data.plan_text
                        )
                        with open(tmp_path, 'rb') as f:
                            file_bytes = f.read()
                        return Response(
                            content=file_bytes,
                            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            headers={
                                "Content-Disposition": f'attachment; filename="{project_name}.xlsx"'
                            }
                        )
                    finally:
                        if tmp_path and os.path.exists(tmp_path):
                            os.unlink(tmp_path)

                elif data.export_csv:
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(suffix='.csv', delete=False) as tmp:
                            tmp_path = tmp.name
                        export_to_csv(
                            converted_content,
                            tmp_path,
                            is_yaml=False,
                            project_name=project_name,
                            original_text=data.plan_text
                        )
                        with open(tmp_path, 'r', encoding='utf-8') as f:
                            file_content = f.read()
                        return Response(
                            content=file_content,
                            media_type="text/csv",
                            headers={
                                "Content-Disposition": f'attachment; filename="{project_name}.csv"'
                            }
                        )
                    finally:
                        if tmp_path and os.path.exists(tmp_path):
                            os.unlink(tmp_path)

                elif data.export_ppt:
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as tmp:
                            tmp_path = tmp.name
                        export_timeline_to_powerpoint(
                            converted_content,
                            tmp_path,
                            is_yaml=False,
                            project_name=project_name,
                            original_text=data.plan_text
                        )
                        with open(tmp_path, 'rb') as f:
                            file_bytes = f.read()
                        return Response(
                            content=file_bytes,
                            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                            headers={
                                "Content-Disposition": f'attachment; filename="{project_name}-timeline.pptx"'
                            }
                        )
                    finally:
                        if tmp_path and os.path.exists(tmp_path):
                            os.unlink(tmp_path)

                elif data.export_pdf:
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                            tmp_path = tmp.name
                        export_to_pdf(
                            converted_content,
                            tmp_path,
                            is_yaml=False,
                            project_name=project_name,
                            original_text=data.plan_text
                        )
                        with open(tmp_path, 'rb') as f:
                            file_bytes = f.read()
                        return Response(
                            content=file_bytes,
                            media_type="application/pdf",
                            headers={
                                "Content-Disposition": f'attachment; filename="{project_name}.pdf"'
                            }
                        )
                    finally:
                        if tmp_path and os.path.exists(tmp_path):
                            os.unlink(tmp_path)

            else:
                # Multiple exports requested - return as ZIP
                zip_bytes = generate_exports(
                    data.plan_text,
                    converted_content,
                    project_name,
                    data.export_excel,
                    data.export_csv,
                    data.export_ppt,
                    data.export_pdf
                )

                logger.info(f"Successfully generated exports")

                return Response(
                    content=zip_bytes,
                    media_type="application/zip",
                    headers={
                        "Content-Disposition": f'attachment; filename="{project_name}-exports.zip"'
                    }
                )
        else:
            # Just return ASCII output
            ascii_output = text_to_markdown_table(
                converted_content,
                is_yaml=False,
                project_name=project_name,
                terminal_width=120,
                original_text=data.plan_text
            )

            return {"ascii_output": ascii_output}

    except (ValueError, KeyError, TypeError, OSError) as e:
        logger.error(f"Error rendering plan: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to render plan: {str(e)}")


def generate_exports(
    original_text: str,
    converted_text: str,
    project_name: str,
    export_excel: bool,
    export_csv: bool,
    export_ppt: bool,
    export_pdf: bool = False
) -> bytes:
    """Generate all requested exports and package them in a ZIP file."""

    # Create a ZIP file in memory
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # ASCII text output
        ascii_output = text_to_markdown_table(
            converted_text,
            is_yaml=False,
            project_name=project_name,
            terminal_width=120,
            original_text=original_text
        )
        zip_file.writestr(f"{project_name}.txt", ascii_output)

        # Excel export
        if export_excel:
            tmp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                    tmp_path = tmp.name
                export_to_excel(
                    converted_text,
                    tmp_path,
                    is_yaml=False,
                    project_name=project_name,
                    original_text=original_text
                )
                with open(tmp_path, 'rb') as f:
                    zip_file.writestr(f"{project_name}.xlsx", f.read())
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        # CSV export
        if export_csv:
            tmp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix='.csv', delete=False) as tmp:
                    tmp_path = tmp.name
                export_to_csv(
                    converted_text,
                    tmp_path,
                    is_yaml=False,
                    project_name=project_name,
                    original_text=original_text
                )
                with open(tmp_path, 'r', encoding='utf-8') as f:
                    zip_file.writestr(f"{project_name}.csv", f.read())
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        # PowerPoint timeline export
        if export_ppt:
            tmp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as tmp:
                    tmp_path = tmp.name
                export_timeline_to_powerpoint(
                    converted_text,
                    tmp_path,
                    is_yaml=False,
                    project_name=project_name,
                    original_text=original_text
                )
                with open(tmp_path, 'rb') as f:
                    zip_file.writestr(f"{project_name}-timeline.pptx", f.read())
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        # PDF export
        if export_pdf:
            tmp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                    tmp_path = tmp.name
                export_to_pdf(
                    converted_text,
                    tmp_path,
                    is_yaml=False,
                    project_name=project_name,
                    original_text=original_text
                )
                with open(tmp_path, 'rb') as f:
                    zip_file.writestr(f"{project_name}.pdf", f.read())
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    os.unlink(tmp_path)

    # Get the ZIP file bytes
    zip_buffer.seek(0)
    return zip_buffer.read()


def collect_labels_from_plan(plan_text: str) -> set:
    """
    Extract all unique labels from task lines in the plan.
    Labels use hashtag syntax like #High #test #Risk
    """
    import re
    from noodle_core import strip_highlights, strip_raid_log
    # Strip highlights and RAID log sections so their content is not treated as labels
    plan_text = strip_highlights(plan_text)
    plan_text = strip_raid_log(plan_text)

    labels = set()
    lines = plan_text.split('\n')
    in_front_matter = False

    for line in lines:
        # Skip front matter
        if line.strip() == '---':
            in_front_matter = not in_front_matter
            continue
        if in_front_matter:
            continue

        # Skip empty lines
        if not line.strip():
            continue

        # Look for labels with hashtag syntax: #labelname
        # Pattern: # followed by word characters (letters, numbers, underscore)
        label_pattern = r'#(\w+)'
        matches = re.findall(label_pattern, line)

        for label in matches:
            # Convert to lowercase for consistency
            labels.add(label.lower())

    return labels


def update_front_matter_with_labels(plan_text: str, labels: set) -> str:
    """
    Update the front matter to include all labels found in the plan.
    If labels: line exists, merge with existing labels.
    If no labels: line, add it.
    If no front matter, create it.
    """
    if not labels:
        return plan_text

    lines = plan_text.split('\n')
    has_front_matter = False
    front_matter_end_index = -1
    labels_line_index = -1

    # Check for existing front matter
    if lines and lines[0].strip() == '---':
        has_front_matter = True
        for i, line in enumerate(lines[1:], start=1):
            if line.strip() == '---':
                front_matter_end_index = i
                break
            if line.strip().lower().startswith('labels:'):
                labels_line_index = i

    # Format labels as comma-separated list
    sorted_labels = sorted(labels)
    labels_str = ', '.join(sorted_labels)
    labels_line = f"labels: [{labels_str}]"

    if not has_front_matter:
        # No front matter - create one with just labels
        new_front_matter = f"---\n{labels_line}\n---\n"
        return new_front_matter + plan_text

    if labels_line_index >= 0:
        # Update existing labels line
        # Parse existing labels and merge
        existing_line = lines[labels_line_index]
        existing_labels = set()
        if '[' in existing_line and ']' in existing_line:
            content = existing_line[existing_line.index('[')+1:existing_line.rindex(']')]
            existing_labels = set(l.strip().lower() for l in content.split(',') if l.strip())

        # Merge labels
        all_labels = sorted(existing_labels.union(labels))
        lines[labels_line_index] = f"labels: [{', '.join(all_labels)}]"
    else:
        # Add labels line before the closing ---
        lines.insert(front_matter_end_index, labels_line)

    return '\n'.join(lines)


@app.post("/api/parse")
async def parse_plan(data: RenderRequest):
    """Parse a project plan and return structured JSON data for tabbed views."""
    logger.info(f"Parse request received")

    # Extract highlights and RAID log early so they are always available,
    # even if the task parsing pipeline fails.
    highlights = extract_highlights(data.plan_text)
    raid_items = []
    try:
        raid_log_text = extract_raid_log(data.plan_text)
        if raid_log_text:
            raid_items = parse_raid_markdown(raid_log_text)
    except (ValueError, KeyError) as e:
        logger.warning(f"Failed to parse RAID log from plan text: {e}")

    try:
        # Extract title from front matter if present
        title_from_frontmatter = extract_title_from_frontmatter(data.plan_text)
        project_name = data.project_name or title_from_frontmatter or "Project"

        # Convert plan format (strip front matter)
        converted_content = convert_plan_format_to_standard(data.plan_text)

        # Generate report output (for Report tab)
        ascii_output = text_to_markdown_table(
            converted_content,
            is_yaml=False,
            project_name=project_name,
            terminal_width=120,
            original_text=data.plan_text
        )

        # Parse resource mappings from front matter
        resource_map = parse_resource_mappings(data.plan_text)

        # Extract front matter data for project views
        front_matter = {}
        lines = data.plan_text.split('\n')
        in_front_matter = False

        for i, line in enumerate(lines):
            if line.strip() == '---':
                if not in_front_matter:
                    in_front_matter = True
                    continue
                else:
                    break

            if in_front_matter:
                if ':' in line:
                    key, value = line.split(':', 1)
                    front_matter[key.strip().lower()] = value.strip()

        # Parse and schedule tasks for Milestones Table
        yaml_data = natural_language_to_yaml(converted_content, project_name)
        phases_raw = yaml_data[project_name]

        # Handle both list and dict formats
        if isinstance(phases_raw, list):
            phases = phases_raw
        elif isinstance(phases_raw, dict):
            phases = [phases_raw]
        else:
            phases = []

        # Schedule tasks and prepare for JSON serialization
        tasks = schedule_tasks(phases)
        tasks_data = []

        for idx, task in enumerate(tasks, start=1):
            # Convert datetime objects to ISO strings
            start = task.get('start')
            finish = task.get('finish')
            duration = task.get('duration')

            # Get resources and map to full names
            resources = task.get('resources', '')
            if resources:
                resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
                if resource_map:
                    resource_list = [r.strip() for r in resources.split(',')]
                    mapped_resources = [resource_map.get(r.lower(), r) for r in resource_list]
                    resources = ', '.join(mapped_resources)

            # Calculate RAG status (skip for summary tasks)
            rag_status = ''
            if not task.get('summary'):
                rag_status = calculate_rag_status(task)

            # Get task name (description or name), stripping any percent tokens
            task_name = task.get('description') or task.get('name', '')
            task_name = re.sub(r'\s*\b\d{1,3}%', '', task_name).strip()

            task_data = {
                'id': idx,
                'name': task_name,
                'start': start.strftime('%Y-%m-%d') if start else '',
                'finish': finish.strftime('%Y-%m-%d') if finish else '',
                'duration_days': duration.days if duration else 0,
                'resources': resources,
                'percent': task.get('percent', ''),
                'rag': rag_status,
                'comment': task.get('comment', ''),
                'priority': task.get('priority', 'Low'),
                'bucket': task.get('bucket', ''),
                'level': task.get('level', 0),
                'is_summary': task.get('summary', False),
                'phase': task.get('phase', ''),
                'depends': task.get('depends', []),
                'lag_lead': task.get('lag_lead', {}),
                'inherited_resource': task.get('inherited_resource', False),
                'effort_completed': task.get('effort_completed', ''),
                'effort_completed_unit': task.get('effort_completed_unit', ''),
                'effort_total': task.get('effort_total', ''),
                'effort_total_unit': task.get('effort_total_unit', ''),
                'effort_remaining': task.get('effort_remaining', ''),
                'effort_remaining_unit': task.get('effort_remaining_unit', ''),
            }
            tasks_data.append(task_data)

        # Collect labels from tasks and update front matter
        labels = collect_labels_from_plan(data.plan_text)
        logger.info(f"Collected labels: {labels}")
        updated_plan_text = update_front_matter_with_labels(data.plan_text, labels)
        logger.info(f"Updated plan text differs from original: {updated_plan_text != data.plan_text}")

        # Return structured JSON
        return {
            "success": True,
            "project_name": project_name,
            "ascii_output": ascii_output,
            "front_matter": front_matter,
            "resource_map": resource_map,
            "tasks": tasks_data,
            "updated_plan_text": updated_plan_text if labels else None,
            "highlights": highlights,
            "raid_items": raid_items,
        }

    except (ValueError, KeyError, TypeError) as e:
        logger.error(f"Error parsing plan: {str(e)}", exc_info=True)
        # Return a partial response with highlights so the frontend can
        # still display them even when task parsing fails.
        return {
            "success": False,
            "error": str(e),
            "project_name": data.project_name or "Project",
            "ascii_output": f"Error parsing plan: {str(e)}",
            "front_matter": {},
            "resource_map": {},
            "tasks": [],
            "updated_plan_text": None,
            "highlights": highlights,
            "raid_items": raid_items,
        }


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
    score: int = Field(0)


class ReportTimelineTask(BaseModel):
    """A task for the timeline graphic in the report PPTX."""
    name: str = Field("", max_length=500)
    start: str = Field("", max_length=50)
    finish: str = Field("", max_length=50)
    percent: float = Field(0)
    is_summary: bool = Field(False)
    duration_days: int = Field(0)


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


@app.post("/api/export-report-pptx")
async def export_report_pptx(data: ReportExportRequest):
    """Export the project report as a PowerPoint file."""
    logger.info(f"Report PPTX export request for: {data.project_name}")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as tmp:
            tmp_path = tmp.name

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
        }

        export_report_to_powerpoint(tmp_path, report_data)

        with open(tmp_path, 'rb') as f:
            file_bytes = f.read()

        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={
                "Content-Disposition": f'attachment; filename="{data.project_name}-report.pptx"'
            }
        )
    except (ValueError, KeyError, TypeError, OSError) as e:
        logger.error(f"Error exporting report to PPTX: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to export report: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


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


@app.post("/api/portfolio/export-pptx")
async def export_portfolio_pptx(data: PortfolioReportRequest):
    """Export a portfolio report as a multi-slide PowerPoint file."""
    logger.info(f"Portfolio PPTX export request: {data.portfolio_name} "
                f"({len(data.project_reports)} projects)")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as tmp:
            tmp_path = tmp.name

        portfolio_data = {
            'portfolio_name': data.portfolio_name,
            'date': data.date,
            'projects': [p.model_dump() for p in data.projects],
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
            }
            for r in data.project_reports
        ]

        export_portfolio_to_powerpoint(tmp_path, portfolio_data, project_reports)

        with open(tmp_path, 'rb') as f:
            file_bytes = f.read()

        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={
                "Content-Disposition": f'attachment; filename="{data.portfolio_name}-report.pptx"'
            }
        )
    except (ValueError, KeyError, TypeError, OSError) as e:
        logger.error(f"Error exporting portfolio to PPTX: {str(e)}",
                     exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to export portfolio report: {str(e)}"
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


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

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
            tmp_path = tmp.name
        wb.save(tmp_path)
        with open(tmp_path, 'rb') as f:
            file_bytes = f.read()
        project_name = data.project_name or "Project"
        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{project_name}-raid.xlsx"'
            }
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


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
            detail=f"Failed to parse Excel file: {str(e)}"
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
        raise HTTPException(status_code=500, detail=f"Failed to analyze file: {e}")


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
        raise HTTPException(status_code=500, detail=f"Failed to convert file: {e}")


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
        raise HTTPException(status_code=500, detail=f"Failed to convert Planner file: {e}")


# ==============================================================================
# PLANNING ROOM API ENDPOINTS
# ==============================================================================


class ParseOutlineRequest(BaseModel):
    """Request body for parsing YAML outline."""
    yaml: str = Field(..., max_length=MAX_FILE_SIZE)


class FlowData(BaseModel):
    """Flow diagram data structure."""
    nodes: List[dict] = Field(default_factory=list)
    edges: List[dict] = Field(default_factory=list)


class GeneratePlanRequest(BaseModel):
    """Request body for generating plan.md."""
    outline: str = Field(..., max_length=MAX_FILE_SIZE)
    flow: FlowData


def parse_markdown_outline(text: str) -> dict:
    """Parse simple markdown-style outline into structured data."""
    import re

    if not text or not text.strip():
        raise ValueError("Empty outline")

    lines = text.strip().split('\n')

    # First non-empty line is project name
    project_name = lines[0].strip() if lines else "Untitled Project"
    if not project_name:
        raise ValueError("Empty outline")

    phases = []
    current_phase = None
    task_stack = []  # Stack to track nesting level

    for line in lines[1:]:
        if not line.strip():
            continue

        # Calculate indentation level (number of spaces / 2)
        stripped = line.lstrip()
        indent_level = (len(line) - len(stripped)) // 2

        # Remove leading dash and spaces
        content = stripped.lstrip('- ').strip()
        if not content:
            continue

        # Extract duration and resources using regex
        # Pattern: "Task name 5d @alice @bob" or "Task name @alice" or just "Task name"
        duration_match = re.search(r'\b(\d+[dwmy])\b', content)
        duration = duration_match.group(1) if duration_match else ''

        resources = re.findall(r'@\w+', content)

        # Remove duration and resources from task name
        task_name = content
        if duration:
            task_name = task_name.replace(duration, '').strip()
        for res in resources:
            task_name = task_name.replace(res, '').strip()

        # Create task object
        task = {
            "name": task_name,
            "duration": duration,
            "resources": resources,
            "children": []
        }

        # Level 0 = phase
        if indent_level == 0:
            current_phase = {
                "name": task_name,
                "tasks": []
            }
            phases.append(current_phase)
            task_stack = []
        # Level 1 = top-level task in phase
        elif indent_level == 1 and current_phase:
            current_phase["tasks"].append(task)
            task_stack = [task]
        # Level 2+ = nested subtask
        elif indent_level > 1 and task_stack:
            # Pop stack until we're at the right parent level
            while len(task_stack) >= indent_level:
                task_stack.pop()

            if task_stack:
                task_stack[-1]["children"].append(task)
                task_stack.append(task)

    return {
        "project": {"name": project_name},
        "phases": phases
    }


@app.post("/api/planning-room/parse-outline")
async def parse_outline(data: ParseOutlineRequest):
    """
    Parse markdown outline and return structured data for tree view.

    This endpoint validates and parses a markdown-formatted Work Breakdown Structure (WBS)
    and returns hierarchical project data including phases and tasks.

    Args:
        data: ParseOutlineRequest containing markdown content

    Returns:
        dict: Parsed outline data with project, phases, and tasks

    Raises:
        HTTPException: 400 if outline is invalid
        HTTPException: 500 if parsing fails unexpectedly
    """
    try:
        result = parse_markdown_outline(data.yaml)
        logger.info(f"Successfully parsed outline with {len(result['phases'])} phases")
        return result

    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except (KeyError, TypeError, IndexError) as e:
        logger.error(f"Unexpected error parsing outline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to parse outline: {str(e)}")


@app.post("/api/planning-room/generate-plan")
async def generate_plan_from_planning_room(data: GeneratePlanRequest):
    """
    Generate plan.md from outline YAML and flow diagram.

    This endpoint takes the structured outline and dependency flow data
    and generates a complete plan.md file in Noodle format.

    This is a Phase 3 placeholder - full implementation to come.

    Args:
        data: GeneratePlanRequest containing outline YAML and flow JSON

    Returns:
        dict: Generated plan markdown content

    Raises:
        HTTPException: 400 if outline is invalid
        HTTPException: 500 if generation fails
    """
    try:
        # Use planning_room module for full plan generation with dependencies
        flow_data = {
            'nodes': data.flow.nodes,
            'edges': data.flow.edges
        }

        plan_content = generate_plan_core(data.outline, flow_data)

        logger.info("Generated plan from Planning Room with dependencies")
        return {"plan": plan_content}

    except yaml.YAMLError as e:
        logger.error(f"YAML parsing error: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid outline YAML: {str(e)}")
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except (KeyError, TypeError, IndexError, OSError) as e:
        logger.error(f"Error generating plan: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate plan: {str(e)}")


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
    return templates.TemplateResponse("templates.html", {
        "request": request,
        "v": STATIC_VERSION,
    })


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8007))

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        reload=os.getenv("RELOAD", "false").lower() == "true"
    )
