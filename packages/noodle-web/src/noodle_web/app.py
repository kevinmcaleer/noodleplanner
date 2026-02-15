import os
import io
import hashlib
import tempfile
import logging
import zipfile
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
    export_to_pdf,
    convert_plan_format_to_standard,
    extract_title_from_frontmatter,
    natural_language_to_yaml,
    schedule_tasks,
    calculate_rag_status,
    parse_resource_mappings,
    analyze_workbook,
    convert_excel_to_markdown,
    extract_highlights,
)
import json
import yaml
from .middleware import ActivityLoggingMiddleware
from .database import init_db, test_connection

# Load environment variables from .env file
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", 1048576))

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
                    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                        tmp_path = tmp.name
                    try:
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
                        if os.path.exists(tmp_path):
                            os.unlink(tmp_path)

                elif data.export_csv:
                    with tempfile.NamedTemporaryFile(suffix='.csv', delete=False) as tmp:
                        tmp_path = tmp.name
                    try:
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
                        if os.path.exists(tmp_path):
                            os.unlink(tmp_path)

                elif data.export_ppt:
                    with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as tmp:
                        tmp_path = tmp.name
                    try:
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
                        if os.path.exists(tmp_path):
                            os.unlink(tmp_path)

                elif data.export_pdf:
                    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                        tmp_path = tmp.name
                    try:
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
                        if os.path.exists(tmp_path):
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

    except Exception as e:
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
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name
            try:
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
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        # CSV export
        if export_csv:
            with tempfile.NamedTemporaryFile(suffix='.csv', delete=False) as tmp:
                tmp_path = tmp.name
            try:
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
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        # PowerPoint timeline export
        if export_ppt:
            with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as tmp:
                tmp_path = tmp.name
            try:
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
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        # PDF export
        if export_pdf:
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                tmp_path = tmp.name
            try:
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
                if os.path.exists(tmp_path):
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

        # Extract front matter data for Project Summary tab
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

            # Get task name (description or name)
            task_name = task.get('description') or task.get('name', '')

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
                'level': task.get('level', 0),
                'is_summary': task.get('summary', False),
                'phase': task.get('phase', '')
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
        }

    except Exception as e:
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
        }


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

    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
        tmp_path = tmp.name
    try:
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
        if os.path.exists(tmp_path):
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

    except Exception as e:
        logger.error(f"Error importing RAID Excel: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=400,
            detail=f"Failed to parse Excel file: {str(e)}"
        )


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
    except Exception as e:
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
    except Exception as e:
        logger.error(f"Error converting Excel file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to convert file: {e}")


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


@app.post("/api/planning-room/parse-outline")
async def parse_outline(data: ParseOutlineRequest):
    """
    Parse YAML outline and return structured data for tree view.

    This endpoint validates and parses a YAML-formatted Work Breakdown Structure (WBS)
    and returns hierarchical project data including phases, tasks, resources, etc.

    Args:
        data: ParseOutlineRequest containing YAML content

    Returns:
        dict: Parsed outline data with project, phases, and tasks

    Raises:
        HTTPException: 400 if YAML is invalid
        HTTPException: 500 if parsing fails unexpectedly
    """
    try:
        # Parse YAML
        parsed = yaml.safe_load(data.yaml)

        if not parsed:
            raise ValueError("Empty YAML content")

        # Validate basic structure
        if not isinstance(parsed, dict):
            raise ValueError("YAML root must be a dictionary")

        # Extract and validate structure
        result = {
            "project": parsed.get("project", {}),
            "phases": parsed.get("phases", [])
        }

        # Ensure phases is a list
        if not isinstance(result["phases"], list):
            raise ValueError("'phases' must be a list")

        logger.info(f"Successfully parsed outline with {len(result['phases'])} phases")
        return result

    except yaml.YAMLError as e:
        logger.error(f"YAML parsing error: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {str(e)}")
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
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
        # Phase 3: Implement full plan generation logic
        # For now, return a basic plan from the outline

        parsed = yaml.safe_load(data.outline)

        if not parsed:
            raise ValueError("Empty outline")

        # Simple plan generation (Phase 3 will implement full logic)
        plan_lines = []

        # Add project info
        if "project" in parsed:
            project = parsed["project"]
            if "name" in project:
                plan_lines.append(f"# {project['name']}\n")

            if "start_date" in project:
                plan_lines.append(f"start: {project['start_date']}\n")

            # Add resources
            if "resources" in project and project["resources"]:
                plan_lines.append("")
                for res in project["resources"]:
                    if isinstance(res, dict):
                        res_id = res.get("id", "")
                        res_name = res.get("name", res_id)
                        res_role = res.get("role", "")
                        plan_lines.append(f"@{res_id}: {res_name}, {res_role}")
                plan_lines.append("")

        # Add phases and tasks (simplified)
        if "phases" in parsed:
            for phase in parsed["phases"]:
                if isinstance(phase, dict) and "name" in phase:
                    plan_lines.append(f"\n## {phase['name']}")

                    if "tasks" in phase:
                        for task in phase["tasks"]:
                            if isinstance(task, dict) and "name" in task:
                                task_line = f"- {task['name']}"

                                if "duration" in task:
                                    task_line += f" {task['duration']}"

                                if "resources" in task and task["resources"]:
                                    resources_str = " ".join(task["resources"])
                                    task_line += f" {resources_str}"

                                plan_lines.append(task_line)

        plan_content = "\n".join(plan_lines)

        logger.info("Generated plan from Planning Room data")
        return {"plan": plan_content}

    except yaml.YAMLError as e:
        logger.error(f"YAML parsing error: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid outline YAML: {str(e)}")
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error generating plan: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate plan: {str(e)}")


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8007))

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        reload=os.getenv("RELOAD", "false").lower() == "true"
    )
