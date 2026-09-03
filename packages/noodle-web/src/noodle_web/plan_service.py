"""PlanService: Business logic for plan rendering, parsing, and exporting.

Extracted from app.py routes to separate HTTP concerns from domain logic.
Routes become thin HTTP adapters that validate input, call the service, and
return the response.
"""

import io
import os
import re
import logging
import tempfile
import zipfile
from dataclasses import dataclass
from typing import Optional

from noodle_core import (
    export_to_mpp,
    MppTemplateError,
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
    parse_resource_roles,
    parse_stakeholders_from_frontmatter,
    extract_highlights,
    extract_raid_log,
    parse_raid_markdown,
    extract_comms_plan,
    strip_benefits,
    strip_comms,
    parse_comms_markdown,
    extract_baseline,
    parse_baseline_markdown,
    extract_benefits,
    parse_benefits_markdown,
    extract_lessons,
    parse_lessons_markdown,
    strip_highlights,
    strip_raid_log,
    strip_budget,
    export_to_msproject_xml,
    import_from_msproject_xml,
    FrontMatterParser,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes for service results
# ---------------------------------------------------------------------------


@dataclass
class ExportResult:
    """Result of a single-file export operation."""

    content: bytes
    media_type: str
    filename: str


@dataclass
class ParseResult:
    """Result of parsing a plan into structured data."""

    success: bool
    project_name: str
    ascii_output: str
    front_matter: dict
    resource_map: dict
    tasks: list
    updated_plan_text: Optional[str]
    highlights: list
    raid_items: list
    comms_items: list
    baseline_items: list
    dependencies: list
    benefits_items: list
    lessons_items: list = None
    stakeholders: list = None
    resource_roles: dict = None
    error: Optional[str] = None


@dataclass
class RenderResult:
    """Result of rendering a plan (ASCII output only, no exports)."""

    ascii_output: str


# ---------------------------------------------------------------------------
# Helper: temp-file export (BE-1)
# ---------------------------------------------------------------------------


def export_to_file(export_fn, suffix: str, read_mode: str = "rb"):
    """Run an export function that writes to a temp file and return the content.

    This eliminates the repeated try/finally temp-file pattern (BE-1 from
    the refactoring plan).

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
        kwargs = {} if "b" in read_mode else {"encoding": "utf-8"}
        with open(tmp_path, read_mode, **kwargs) as f:
            return f.read()
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# Helper: front-matter parsing
# ---------------------------------------------------------------------------


def parse_front_matter(plan_text: str) -> dict:
    """Extract key-value pairs from YAML front matter.

    Supports a nested ``settings:`` block whose indented key-value children
    are returned as ``front_matter["settings"] = { ... }``.
    """
    front_matter: dict = {}
    lines = plan_text.split("\n")
    in_front_matter = False
    in_settings = False
    settings: dict = {}

    for line in lines:
        if line.strip() == "---":
            if not in_front_matter:
                in_front_matter = True
                continue
            else:
                break

        if not in_front_matter:
            continue

        stripped = line.strip()

        # Detect the settings: section header
        if stripped.lower() == "settings:":
            in_settings = True
            continue

        # Inside the settings block: indented key: value pairs
        if in_settings:
            if line.startswith("  ") and ":" in stripped:
                key, value = stripped.split(":", 1)
                val = value.strip()
                # Convert boolean strings
                if val.lower() == "true":
                    settings[key.strip()] = True
                elif val.lower() == "false":
                    settings[key.strip()] = False
                else:
                    settings[key.strip()] = val
                continue
            else:
                # End of settings block
                in_settings = False

        if ":" in line:
            key, value = line.split(":", 1)
            front_matter[key.strip().lower()] = value.strip()

    if settings:
        front_matter["settings"] = settings

    return front_matter


# ---------------------------------------------------------------------------
# Helper: label collection and front-matter update
# ---------------------------------------------------------------------------


def collect_labels_from_plan(plan_text: str) -> set:
    """Extract all unique labels from task lines in the plan.

    Labels use hashtag syntax like #High #test #Risk.
    """
    # Strip highlights, budget, RAID log, and comms sections so their content
    # is not treated as labels
    plan_text = strip_highlights(plan_text)
    plan_text = strip_budget(plan_text)
    plan_text = strip_raid_log(plan_text)
    plan_text = strip_comms(plan_text)
    plan_text = strip_benefits(plan_text)

    labels = set()
    lines = plan_text.split("\n")
    in_front_matter = False

    for line in lines:
        if line.strip() == "---":
            in_front_matter = not in_front_matter
            continue
        if in_front_matter:
            continue
        if not line.strip():
            continue

        label_pattern = r"#(\w+)"
        matches = re.findall(label_pattern, line)
        for label in matches:
            labels.add(label.lower())

    return labels


def update_front_matter_with_labels(plan_text: str, labels: set) -> str:
    """Update the front matter to include all labels found in the plan.

    If a ``labels:`` line exists, merge with existing labels.
    If no ``labels:`` line, add it.  If no front matter, create it.
    """
    if not labels:
        return plan_text

    lines = plan_text.split("\n")
    has_front_matter = False
    front_matter_end_index = -1
    labels_line_index = -1

    if lines and lines[0].strip() == "---":
        has_front_matter = True
        for i, line in enumerate(lines[1:], start=1):
            if line.strip() == "---":
                front_matter_end_index = i
                break
            if line.strip().lower().startswith("labels:"):
                labels_line_index = i

    sorted_labels = sorted(labels)
    labels_str = ", ".join(sorted_labels)
    labels_line = f"labels: [{labels_str}]"

    if not has_front_matter:
        new_front_matter = f"---\n{labels_line}\n---\n"
        return new_front_matter + plan_text

    if labels_line_index >= 0:
        existing_line = lines[labels_line_index]
        existing_labels: set[str] = set()
        if "[" in existing_line and "]" in existing_line:
            content = existing_line[existing_line.index("[") + 1 : existing_line.rindex("]")]
            existing_labels = set(
                lbl.strip().lower() for lbl in content.split(",") if lbl.strip()
            )
        all_labels = sorted(existing_labels.union(labels))
        lines[labels_line_index] = f"labels: [{', '.join(all_labels)}]"
    else:
        lines.insert(front_matter_end_index, labels_line)

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# PlanService
# ---------------------------------------------------------------------------


class PlanService:
    """Business logic for plan rendering, parsing, and exporting.

    All methods are stateless; the service holds no per-request state.
    """

    # -- Rendering (ASCII output) -------------------------------------------

    def render(self, plan_text: str, project_name: Optional[str] = None) -> RenderResult:
        """Render a plan to ASCII/markdown table output.

        Args:
            plan_text: Raw plan text (may include YAML front matter).
            project_name: Optional override for the project name.

        Returns:
            RenderResult with the ASCII output string.
        """
        resolved_name = self._resolve_project_name(plan_text, project_name)
        converted = convert_plan_format_to_standard(plan_text)
        ascii_output = text_to_markdown_table(
            converted,
            is_yaml=False,
            project_name=resolved_name,
            terminal_width=120,
            original_text=plan_text,
        )
        return RenderResult(ascii_output=ascii_output)

    # -- Parsing (structured JSON for UI) -----------------------------------

    def parse(self, plan_text: str, project_name: Optional[str] = None) -> ParseResult:
        """Parse a plan and return structured data for the frontend.

        This always returns highlights, RAID items, and baseline items even
        when task parsing fails, so the frontend can display partial results.

        Args:
            plan_text: Raw plan text (may include YAML front matter).
            project_name: Optional override for the project name.

        Returns:
            ParseResult with all structured data.
        """
        # Extract supplementary sections first (always available)
        highlights = extract_highlights(plan_text)
        raid_items = self._safe_extract_raid(plan_text)
        comms_items = self._safe_extract_comms(plan_text)
        baseline_items = self._safe_extract_baseline(plan_text)
        benefits_items = self._safe_extract_benefits(plan_text)
        lessons_items = self._safe_extract_lessons(plan_text)
        fm_parser = FrontMatterParser(plan_text)
        dependencies = fm_parser.parse_dependencies()

        # Extract stakeholders (always available)
        stakeholders = []
        try:
            stakeholders = parse_stakeholders_from_frontmatter(plan_text)
        except Exception as e:
            logger.warning(f"Failed to parse stakeholders: {e}")

        try:
            resolved_name = self._resolve_project_name(plan_text, project_name)
            converted = convert_plan_format_to_standard(plan_text)

            ascii_output = text_to_markdown_table(
                converted,
                is_yaml=False,
                project_name=resolved_name,
                terminal_width=120,
                original_text=plan_text,
            )

            resource_map, _ = parse_resource_mappings(plan_text)
            resource_roles = parse_resource_roles(plan_text)
            front_matter = parse_front_matter(plan_text)
            tasks_data = self._schedule_and_build_tasks(
                converted, resolved_name, resource_map
            )

            labels = collect_labels_from_plan(plan_text)
            logger.info(f"Collected labels: {labels}")
            updated_plan_text = update_front_matter_with_labels(plan_text, labels)
            logger.info(
                f"Updated plan text differs from original: "
                f"{updated_plan_text != plan_text}"
            )

            return ParseResult(
                success=True,
                project_name=resolved_name,
                ascii_output=ascii_output,
                front_matter=front_matter,
                resource_map=resource_map,
                tasks=tasks_data,
                updated_plan_text=updated_plan_text if labels else None,
                highlights=highlights,
                raid_items=raid_items,
                comms_items=comms_items,
                baseline_items=baseline_items,
                dependencies=dependencies,
                benefits_items=benefits_items,
                lessons_items=lessons_items,
                stakeholders=stakeholders,
                resource_roles=resource_roles,
            )

        except (ValueError, KeyError, TypeError) as e:
            logger.error(f"Error parsing plan: {e}", exc_info=True)
            return ParseResult(
                success=False,
                project_name=project_name or "Project",
                ascii_output=f"Error parsing plan: {e}",
                front_matter={},
                resource_map={},
                tasks=[],
                updated_plan_text=None,
                highlights=highlights,
                raid_items=raid_items,
                comms_items=comms_items,
                baseline_items=baseline_items,
                dependencies=dependencies,
                benefits_items=benefits_items,
                lessons_items=lessons_items,
                stakeholders=stakeholders,
                resource_roles={},
                error=str(e),
            )

    # -- Exporting ----------------------------------------------------------

    def export_single(
        self,
        plan_text: str,
        fmt: str,
        project_name: Optional[str] = None,
    ) -> ExportResult:
        """Export a plan to a single file format.

        Args:
            plan_text: Raw plan text.
            fmt: One of 'excel', 'csv', 'ppt', 'pdf'.
            project_name: Optional override for the project name.

        Returns:
            ExportResult with content bytes, media type, and filename.

        Raises:
            ValueError: If fmt is not recognised.
        """
        resolved_name = self._resolve_project_name(plan_text, project_name)
        filename_stem = self._resolve_filename_stem(plan_text, project_name)
        converted = convert_plan_format_to_standard(plan_text)

        exporters = {
            "excel": self._export_excel,
            "csv": self._export_csv,
            "ppt": self._export_ppt,
            "pdf": self._export_pdf,
            "msproject": self._export_msproject,
            "mpp": self._export_mpp,
        }

        exporter = exporters.get(fmt)
        if exporter is None:
            raise ValueError(f"Unknown export format: {fmt}")

        return exporter(converted, plan_text, resolved_name, filename_stem)

    def export_zip(
        self,
        plan_text: str,
        project_name: Optional[str] = None,
        *,
        excel: bool = False,
        csv: bool = False,
        ppt: bool = False,
        pdf: bool = False,
    ) -> ExportResult:
        """Export a plan to multiple formats bundled in a ZIP file.

        Args:
            plan_text: Raw plan text.
            project_name: Optional override for the project name.
            excel: Include Excel export.
            csv: Include CSV export.
            ppt: Include PowerPoint timeline export.
            pdf: Include PDF export.

        Returns:
            ExportResult with ZIP bytes.
        """
        resolved_name = self._resolve_project_name(plan_text, project_name)
        filename_stem = self._resolve_filename_stem(plan_text, project_name)
        converted = convert_plan_format_to_standard(plan_text)

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            # Always include ASCII text
            ascii_output = text_to_markdown_table(
                converted,
                is_yaml=False,
                project_name=resolved_name,
                terminal_width=120,
                original_text=plan_text,
            )
            zf.writestr(f"{filename_stem}.txt", ascii_output)

            if excel:
                content = export_to_file(
                    lambda path: export_to_excel(
                        converted, path,
                        is_yaml=False, project_name=resolved_name,
                        original_text=plan_text,
                    ),
                    suffix=".xlsx",
                )
                zf.writestr(f"{filename_stem}.xlsx", content)

            if csv:
                content = export_to_file(
                    lambda path: export_to_csv(
                        converted, path,
                        is_yaml=False, project_name=resolved_name,
                        original_text=plan_text,
                    ),
                    suffix=".csv",
                    read_mode="r",
                )
                zf.writestr(f"{filename_stem}.csv", content)

            if ppt:
                content = export_to_file(
                    lambda path: export_timeline_to_powerpoint(
                        converted, path,
                        is_yaml=False, project_name=resolved_name,
                        original_text=plan_text,
                    ),
                    suffix=".pptx",
                )
                zf.writestr(f"{filename_stem}-timeline.pptx", content)

            if pdf:
                content = export_to_file(
                    lambda path: export_to_pdf(
                        converted, path,
                        is_yaml=False, project_name=resolved_name,
                        original_text=plan_text,
                    ),
                    suffix=".pdf",
                )
                zf.writestr(f"{filename_stem}.pdf", content)

        zip_buffer.seek(0)
        return ExportResult(
            content=zip_buffer.read(),
            media_type="application/zip",
            filename=f"{filename_stem}-exports.zip",
        )

    def export_report_pptx(self, report_data: dict) -> ExportResult:
        """Export a project report to PowerPoint.

        Args:
            report_data: Dictionary with report fields (project_name, manager,
                sponsor, etc.).

        Returns:
            ExportResult with PPTX bytes.
        """
        content = export_to_file(
            lambda path: export_report_to_powerpoint(path, report_data),
            suffix=".pptx",
        )
        project_name = report_data.get("project_name", "Project")
        from datetime import datetime

        date_str = datetime.now().strftime("%d-%m-%Y")
        return ExportResult(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename=f"{project_name} - Report - {date_str}.pptx",
        )

    def export_portfolio_pptx(
        self, portfolio_data: dict, project_reports: list
    ) -> ExportResult:
        """Export a portfolio report to PowerPoint.

        Args:
            portfolio_data: Dictionary with portfolio-level fields.
            project_reports: List of per-project report dictionaries.

        Returns:
            ExportResult with PPTX bytes.
        """
        content = export_to_file(
            lambda path: export_portfolio_to_powerpoint(
                path, portfolio_data, project_reports
            ),
            suffix=".pptx",
        )
        portfolio_name = portfolio_data.get("portfolio_name", "Portfolio")
        return ExportResult(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename=f"{portfolio_name}-report.pptx",
        )

    # -- Private helpers ----------------------------------------------------

    def _resolve_project_name(
        self, plan_text: str, project_name: Optional[str]
    ) -> str:
        """Determine the project name from the request or front matter."""
        title = extract_title_from_frontmatter(plan_text)
        return project_name or title or "Project"

    def _resolve_filename_stem(
        self, plan_text: str, project_name: Optional[str]
    ) -> str:
        """Build a filename stem like 'Project Stitch v7.7'."""
        name = self._resolve_project_name(plan_text, project_name)
        fm = parse_front_matter(plan_text)
        version = fm.get("version")
        if version:
            return f"{name} v{version}"
        return name

    def _safe_extract_raid(self, plan_text: str) -> list:
        """Extract RAID items, returning an empty list on failure."""
        try:
            raid_log_text = extract_raid_log(plan_text)
            if raid_log_text:
                return parse_raid_markdown(raid_log_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse RAID log from plan text: {e}")
        return []

    def _safe_extract_comms(self, plan_text: str) -> list:
        """Extract comms plan items, returning an empty list on failure."""
        try:
            comms_text = extract_comms_plan(plan_text)
            if comms_text:
                return parse_comms_markdown(comms_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse comms plan from plan text: {e}")
        return []

    def _safe_extract_baseline(self, plan_text: str) -> list:
        """Extract baseline items, returning an empty list on failure."""
        try:
            baseline_text = extract_baseline(plan_text)
            if baseline_text:
                return parse_baseline_markdown(baseline_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse baseline from plan text: {e}")
        return []

    def _safe_extract_benefits(self, plan_text: str) -> list:
        """Extract benefits items, returning an empty list on failure."""
        try:
            benefits_text = extract_benefits(plan_text)
            if benefits_text:
                return parse_benefits_markdown(benefits_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse benefits from plan text: {e}")
        return []

    def _safe_extract_lessons(self, plan_text: str) -> list:
        """Extract lessons learned items, returning an empty list on failure."""
        try:
            lessons_text = extract_lessons(plan_text)
            if lessons_text:
                return parse_lessons_markdown(lessons_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse lessons learned from plan text: {e}")
        return []

    def _schedule_and_build_tasks(
        self, converted_content: str, project_name: str, resource_map: dict
    ) -> list:
        """Schedule tasks and build the task data list for the frontend."""
        yaml_data = natural_language_to_yaml(converted_content, project_name)
        phases_raw = yaml_data[project_name]

        if isinstance(phases_raw, list):
            phases = phases_raw
        elif isinstance(phases_raw, dict):
            phases = [phases_raw]
        else:
            phases = []

        tasks = schedule_tasks(phases)
        tasks_data = []

        for idx, task in enumerate(tasks, start=1):
            start = task.get("start")
            finish = task.get("finish")
            duration = task.get("duration")

            resources = task.get("resources", "")
            if resources:
                resources = ", ".join(
                    r.lstrip("@").strip() for r in resources.split(",")
                )
                if resource_map:
                    resource_list = [r.strip() for r in resources.split(",")]
                    mapped = [
                        resource_map.get(r.lower(), r) for r in resource_list
                    ]
                    resources = ", ".join(mapped)

            rag_status = ""
            if not task.get("summary"):
                rag_status = calculate_rag_status(task)

            task_name = task.get("description") or task.get("name", "")
            task_name = re.sub(r"\s*\b\d{1,3}%", "", task_name).strip()

            tasks_data.append(
                {
                    "id": idx,
                    "name": task_name,
                    "start": start.strftime("%Y-%m-%d") if start else "",
                    "finish": finish.strftime("%Y-%m-%d") if finish else "",
                    "duration_days": duration.days if duration else 0,
                    "resources": resources,
                    "percent": task.get("percent", ""),
                    "rag": rag_status,
                    "comment": task.get("comment", ""),
                    "priority": task.get("priority", "Low"),
                    "bucket": task.get("bucket", ""),
                    "level": task.get("level", 0),
                    "is_summary": task.get("summary", False),
                    "phase": task.get("phase", ""),
                    "depends": task.get("depends", []),
                    "lag_lead": task.get("lag_lead", {}),
                    "dependency_types": task.get("dependency_types", {}),
                    "inherited_resource": task.get("inherited_resource", False),
                    "effort_completed": task.get("effort_completed", ""),
                    "effort_completed_unit": task.get(
                        "effort_completed_unit", ""
                    ),
                    "effort_total": task.get("effort_total", ""),
                    "effort_total_unit": task.get("effort_total_unit", ""),
                    "effort_remaining": task.get("effort_remaining", ""),
                    "effort_remaining_unit": task.get(
                        "effort_remaining_unit", ""
                    ),
                    "recurrence": task.get("recurrence", None),
                    "deliverable": task.get("deliverable", ""),
                    "product_type": task.get("product_type", "internal"),
                    "parent": task.get("parent", ""),
                    "quality_roles": task.get("quality_roles", {}),
                    "total_float": task.get("total_float", None),
                    "critical": task.get("critical", False),
                    "loop_warning": task.get("loop_warning", ""),
                    "circular_dependencies": task.get(
                        "circular_dependencies", []
                    ),
                }
            )

        return tasks_data

    # -- Single-format export helpers ---------------------------------------

    def _export_excel(
        self, converted: str, original: str, name: str,
        filename_stem: Optional[str] = None,
    ) -> ExportResult:
        stem = filename_stem or name
        content = export_to_file(
            lambda path: export_to_excel(
                converted, path,
                is_yaml=False, project_name=name, original_text=original,
            ),
            suffix=".xlsx",
        )
        return ExportResult(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=f"{stem}.xlsx",
        )

    def _export_csv(
        self, converted: str, original: str, name: str,
        filename_stem: Optional[str] = None,
    ) -> ExportResult:
        stem = filename_stem or name
        content = export_to_file(
            lambda path: export_to_csv(
                converted, path,
                is_yaml=False, project_name=name, original_text=original,
            ),
            suffix=".csv",
            read_mode="r",
        )
        return ExportResult(
            content=content,
            media_type="text/csv",
            filename=f"{stem}.csv",
        )

    def _export_ppt(
        self, converted: str, original: str, name: str,
        filename_stem: Optional[str] = None,
    ) -> ExportResult:
        stem = filename_stem or name
        content = export_to_file(
            lambda path: export_timeline_to_powerpoint(
                converted, path,
                is_yaml=False, project_name=name, original_text=original,
            ),
            suffix=".pptx",
        )
        return ExportResult(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename=f"{stem}-timeline.pptx",
        )

    def _export_pdf(
        self, converted: str, original: str, name: str,
        filename_stem: Optional[str] = None,
    ) -> ExportResult:
        stem = filename_stem or name
        content = export_to_file(
            lambda path: export_to_pdf(
                converted, path,
                is_yaml=False, project_name=name, original_text=original,
            ),
            suffix=".pdf",
        )
        return ExportResult(
            content=content,
            media_type="application/pdf",
            filename=f"{stem}.pdf",
        )


    def _export_mpp(
        self, converted: str, original: str, name: str,
        filename_stem: Optional[str] = None,
    ) -> ExportResult:
        stem = filename_stem or name
        template = os.environ.get(
            "NOODLE_MPP_TEMPLATE", os.path.join("templates", "mpp-template.mpp")
        )
        if not os.path.exists(template):
            raise ValueError(
                "Native .mpp export needs a template saved from Microsoft "
                f"Project (looked at {template!r}). Save one per the "
                "pymppwriter README and set NOODLE_MPP_TEMPLATE to its path."
            )
        try:
            content = export_to_file(
                lambda path: export_to_mpp(
                    original, path, template, project_name=name,
                ),
                suffix=".mpp",
            )
        except MppTemplateError as exc:
            raise ValueError(str(exc)) from exc
        return ExportResult(
            content=content,
            media_type="application/vnd.ms-project",
            filename=f"{stem}.mpp",
        )

    def _export_msproject(
        self, converted: str, original: str, name: str,
        filename_stem: Optional[str] = None,
    ) -> ExportResult:
        stem = filename_stem or name
        content = export_to_file(
            lambda path: export_to_msproject_xml(
                original, path, project_name=name,
            ),
            suffix=".xml",
        )
        return ExportResult(
            content=content,
            media_type="application/xml",
            filename=f"{stem}.xml",
        )
