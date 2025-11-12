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

from noodle_core.scheduling_engine import (
    text_to_markdown_table,
    export_to_excel,
    export_timeline_to_powerpoint,
    export_to_pdf
)
from noodle_core.format_converter import convert_plan_format_to_standard, extract_title_from_frontmatter
from middleware import ActivityLoggingMiddleware
from database import init_db, test_connection

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
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

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


@app.post("/api/parse")
async def parse_plan(data: RenderRequest):
    """Parse a project plan and return structured JSON data for the enhanced interface."""
    logger.info(f"Parse request received")

    # Extract title from front matter if present
    title_from_frontmatter = extract_title_from_frontmatter(data.plan_text)
    project_name = data.project_name or title_from_frontmatter or "Project"

    try:
        # Import required functions
        from noodle_core.scheduling_engine import schedule_tasks, calculate_rag_status, parse_resource_mappings
        from noodle_core.format_converter import natural_language_to_yaml, extract_frontmatter

        # Extract front matter
        frontmatter = extract_frontmatter(data.plan_text)

        # Convert plan format
        converted_content = convert_plan_format_to_standard(data.plan_text)

        # Parse to YAML structure
        parsed_data = natural_language_to_yaml(converted_content, project_name)

        # Get phases
        phases_raw = parsed_data[project_name]
        if isinstance(phases_raw, list):
            phases = phases_raw
        elif isinstance(phases_raw, dict):
            phases = [phases_raw]
        else:
            phases = []

        # Schedule tasks
        tasks = schedule_tasks(phases)

        # Parse resource mappings
        resource_map = parse_resource_mappings(data.plan_text)

        # Calculate overall project status based on RAG
        red_count = 0
        amber_count = 0
        green_count = 0

        # Enhance tasks with RAG status and format data
        enhanced_tasks = []
        for t in tasks:
            if not t.get('summary'):
                rag = calculate_rag_status(t)
                t['rag'] = rag
                if rag == 'RED':
                    red_count += 1
                elif rag == 'AMBER':
                    amber_count += 1
                elif rag == 'GREEN':
                    green_count += 1
            else:
                t['rag'] = ''

            # Format dates as strings
            if 'start' in t and t['start']:
                t['start'] = t['start'].strftime('%Y-%m-%d')
            if 'finish' in t and t['finish']:
                t['finish'] = t['finish'].strftime('%Y-%m-%d')
            if 'duration' in t and hasattr(t['duration'], 'days'):
                t['duration_days'] = t['duration'].days
                del t['duration']

            enhanced_tasks.append(t)

        # Determine overall status
        if red_count > 0:
            overall_status = 'RED'
        elif amber_count > 0:
            overall_status = 'AMBER'
        else:
            overall_status = 'GREEN'

        # Calculate resource allocations
        resource_hours = {}
        for task in enhanced_tasks:
            if task.get('summary'):
                continue
            resources_str = task.get('resources', '')
            if resources_str:
                task_resources = [r.strip() for r in resources_str.split(',')]
                duration_days = task.get('duration_days', 0)
                hours = duration_days * 8.0 / len(task_resources)

                for resource in task_resources:
                    resource_key = resource.lower()
                    full_name = resource_map.get(resource_key, resource)
                    if full_name not in resource_hours:
                        resource_hours[full_name] = 0
                    resource_hours[full_name] += hours

        # Build response
        response_data = {
            "project": {
                "name": project_name,
                "title": frontmatter.get('title', project_name),
                "manager": frontmatter.get('project manager', frontmatter.get('manager', '')),
                "sponsor": frontmatter.get('sponsor', ''),
                "budget": frontmatter.get('budget', ''),
                "status": overall_status,
                "rag_summary": {
                    "red": red_count,
                    "amber": amber_count,
                    "green": green_count
                }
            },
            "tasks": enhanced_tasks,
            "resources": [
                {
                    "name": name,
                    "hours": round(hours, 1),
                    "days": round(hours / 8, 1)
                }
                for name, hours in resource_hours.items()
            ],
            "resource_map": resource_map,
            "frontmatter": frontmatter
        }

        return response_data

    except Exception as e:
        logger.error(f"Error parsing plan: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to parse plan: {str(e)}")


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


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8007))

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        reload=os.getenv("RELOAD", "false").lower() == "true"
    )
