import os
import io
import tempfile
import logging
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

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
    export_timeline_to_powerpoint,
    export_to_pdf,
    convert_plan_format_to_standard,
    extract_title_from_frontmatter,
    natural_language_to_yaml,
    schedule_tasks,
    calculate_rag_status,
    parse_resource_mappings,
)
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
    export_ppt: bool = Field(False)
    export_pdf: bool = Field(False)



@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main HTML page."""
    return templates.TemplateResponse("index.html", {"request": request})


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
        has_exports = data.export_excel or data.export_ppt or data.export_pdf

        if has_exports:
            # Count how many exports are requested
            export_count = sum([data.export_excel, data.export_ppt, data.export_pdf])

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
        }

    except Exception as e:
        logger.error(f"Error parsing plan: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to parse plan: {str(e)}")


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8007))

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        reload=os.getenv("RELOAD", "false").lower() == "true"
    )
