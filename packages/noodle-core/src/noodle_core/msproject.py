"""Microsoft Project XML export and import.

Generates and parses MS Project XML format (.xml) that can be opened by
Microsoft Project, ProjectLibre, and other tools that support the
MS Project XML schema.

Field mapping:
    NoodlePlanner → MS Project XML
    task name     → Name
    dependencies  → PredecessorLink
    resources     → ResourceAssignment (via ResourceUID)
    % complete    → PercentComplete
    comments      → Notes
    duration      → Duration (ISO 8601 format PT__H__M__S)
    start/finish  → Start / Finish
"""

import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Optional
from xml.dom import minidom

from .format_converter import convert_plan_format_to_standard
from .scheduling_engine import (
    natural_language_to_yaml,
    parse_resource_mappings,
    schedule_tasks,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Export: NoodlePlanner plan text → MS Project XML
# ---------------------------------------------------------------------------


def _duration_to_iso8601(duration_days: int) -> str:
    """Convert a duration in working days to ISO 8601 duration string.

    MS Project uses PT__H__M__S format where 1 day = 8 hours.
    """
    if duration_days <= 0:
        return "PT0H0M0S"
    hours = duration_days * 8
    return f"PT{hours}H0M0S"


def _date_to_msproject(dt) -> str:
    """Format a date/datetime for MS Project XML."""
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%dT%H:%M:%S")
    return f"{dt}T00:00:00"


def export_to_msproject_xml(
    plan_text: str,
    output_path: str,
    project_name: str = "Project",
) -> None:
    """Export a NoodlePlanner plan to MS Project XML format.

    Args:
        plan_text: Raw plan text (natural language or converted format).
        output_path: File path to write the XML output.
        project_name: Name for the project.
    """
    converted = convert_plan_format_to_standard(plan_text)
    resource_map, _ = parse_resource_mappings(plan_text)

    yaml_data = natural_language_to_yaml(converted, project_name)
    phases_raw = yaml_data[project_name]

    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []

    tasks = schedule_tasks(phases)

    # Build XML document
    root = ET.Element("Project")
    root.set("xmlns", "http://schemas.microsoft.com/project")

    # Project header
    ET.SubElement(root, "Name").text = project_name
    ET.SubElement(root, "Title").text = project_name

    # Calendar (standard working calendar)
    calendars = ET.SubElement(root, "Calendars")
    calendar = ET.SubElement(calendars, "Calendar")
    ET.SubElement(calendar, "UID").text = "1"
    ET.SubElement(calendar, "Name").text = "Standard"
    ET.SubElement(calendar, "IsBaseCalendar").text = "1"

    # Collect unique resources
    resource_set = set()
    for task in tasks:
        res = task.get("resources", "")
        if res:
            for r in res.split(","):
                r = r.strip().lstrip("@")
                if r:
                    resource_set.add(r)

    # Write Resources section
    resources_el = ET.SubElement(root, "Resources")
    resource_uid_map = {}
    for uid, res_name in enumerate(sorted(resource_set), start=1):
        res_el = ET.SubElement(resources_el, "Resource")
        ET.SubElement(res_el, "UID").text = str(uid)
        display_name = resource_map.get(res_name.lower(), res_name)
        ET.SubElement(res_el, "Name").text = display_name
        ET.SubElement(res_el, "ID").text = str(uid)
        resource_uid_map[res_name.lower()] = uid

    # Build a name-to-UID map for dependencies
    task_name_to_uid = {}
    for idx, task in enumerate(tasks, start=1):
        name = task.get("name", "")
        task_name_to_uid[name.lower()] = idx

    # Write Tasks section
    tasks_el = ET.SubElement(root, "Tasks")

    for idx, task in enumerate(tasks, start=1):
        task_el = ET.SubElement(tasks_el, "Task")
        ET.SubElement(task_el, "UID").text = str(idx)
        ET.SubElement(task_el, "ID").text = str(idx)

        task_name = task.get("description") or task.get("name", "")
        task_name = task_name.replace("_", " ")
        ET.SubElement(task_el, "Name").text = task_name

        ET.SubElement(task_el, "OutlineLevel").text = str(
            task.get("level", 0) + 1
        )
        ET.SubElement(task_el, "Summary").text = (
            "1" if task.get("summary") else "0"
        )

        start = task.get("start")
        finish = task.get("finish")
        if start:
            ET.SubElement(task_el, "Start").text = _date_to_msproject(start)
        if finish:
            ET.SubElement(task_el, "Finish").text = _date_to_msproject(finish)

        duration = task.get("duration")
        if isinstance(duration, timedelta):
            duration_days = duration.days
        elif start and finish:
            duration_days = (finish - start).days
        else:
            duration_days = 0
        ET.SubElement(task_el, "Duration").text = _duration_to_iso8601(
            duration_days
        )

        percent = task.get("percent", 0) or 0
        ET.SubElement(task_el, "PercentComplete").text = str(int(percent))

        comment = task.get("comment", "")
        if comment:
            ET.SubElement(task_el, "Notes").text = comment

        # Dependencies (PredecessorLink)
        depends = task.get("depends", [])
        if depends:
            for dep_name in depends:
                dep_uid = task_name_to_uid.get(dep_name.lower())
                if dep_uid:
                    pred_el = ET.SubElement(task_el, "PredecessorLink")
                    ET.SubElement(pred_el, "PredecessorUID").text = str(
                        dep_uid
                    )
                    ET.SubElement(pred_el, "Type").text = "1"  # Finish-to-Start

    # Write Assignments section
    assignments_el = ET.SubElement(root, "Assignments")
    assignment_uid = 1
    for idx, task in enumerate(tasks, start=1):
        res = task.get("resources", "")
        if res:
            for r in res.split(","):
                r = r.strip().lstrip("@")
                res_uid = resource_uid_map.get(r.lower())
                if res_uid:
                    assign_el = ET.SubElement(assignments_el, "Assignment")
                    ET.SubElement(assign_el, "UID").text = str(assignment_uid)
                    ET.SubElement(assign_el, "TaskUID").text = str(idx)
                    ET.SubElement(assign_el, "ResourceUID").text = str(res_uid)
                    assignment_uid += 1

    # Write formatted XML
    xml_str = ET.tostring(root, encoding="unicode", xml_declaration=False)
    dom = minidom.parseString(xml_str)
    pretty_xml = dom.toprettyxml(indent="  ", encoding="UTF-8")

    with open(output_path, "wb") as f:
        f.write(pretty_xml)


# ---------------------------------------------------------------------------
# Import: MS Project XML → NoodlePlanner markdown
# ---------------------------------------------------------------------------


def _parse_iso8601_duration(duration_str: str) -> int:
    """Parse an ISO 8601 duration string and return working days.

    Supports PT__H__M__S format. 8 hours = 1 working day.
    """
    if not duration_str:
        return 0

    # Handle PT format: PT8H0M0S, PT16H0M0S, etc.
    import re

    match = re.match(
        r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration_str
    )
    if match:
        hours = int(match.group(1) or 0)
        # Convert hours to working days (8h = 1d)
        return max(1, hours // 8) if hours > 0 else 1

    return 1


def import_from_msproject_xml(xml_content: str) -> str:
    """Import an MS Project XML file and convert to NoodlePlanner markdown.

    Args:
        xml_content: The XML file content as a string.

    Returns:
        NoodlePlanner plan text in markdown format.
    """
    root = ET.fromstring(xml_content)

    # Handle namespace
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    def find(element, tag):
        """Find a child element, handling namespace."""
        result = element.find(f"{ns}{tag}")
        return result

    def findall(element, tag):
        """Find all child elements, handling namespace."""
        return element.findall(f"{ns}{tag}")

    def find_text(element, tag, default=""):
        """Get text content of a child element."""
        child = find(element, tag)
        return child.text if child is not None and child.text else default

    # Extract project name
    project_name = find_text(root, "Name") or find_text(root, "Title") or "Project"

    # Build resource UID → name map
    resource_map = {}
    resources_el = find(root, "Resources")
    if resources_el is not None:
        for res in findall(resources_el, "Resource"):
            uid = find_text(res, "UID")
            name = find_text(res, "Name")
            if uid and name:
                resource_map[uid] = name

    # Build task UID → assigned resource shortnames map
    task_resources = {}
    assignments_el = find(root, "Assignments")
    if assignments_el is not None:
        for assign in findall(assignments_el, "Assignment"):
            task_uid = find_text(assign, "TaskUID")
            res_uid = find_text(assign, "ResourceUID")
            if task_uid and res_uid and res_uid in resource_map:
                task_resources.setdefault(task_uid, []).append(
                    resource_map[res_uid]
                )

    # Build task UID → name map for dependency resolution
    task_uid_to_name = {}
    tasks_el = find(root, "Tasks")
    if tasks_el is not None:
        for task_el in findall(tasks_el, "Task"):
            uid = find_text(task_el, "UID")
            name = find_text(task_el, "Name")
            if uid and name:
                task_uid_to_name[uid] = name

    # Parse tasks and build markdown
    lines = []
    lines.append(f"---")
    lines.append(f"title: {project_name}")
    lines.append(f"---")
    lines.append("")

    if tasks_el is not None:
        for task_el in findall(tasks_el, "Task"):
            uid = find_text(task_el, "UID")
            name = find_text(task_el, "Name")
            if not name:
                continue

            # Skip the project summary task (UID 0 in some exports)
            outline_level = int(find_text(task_el, "OutlineLevel", "1"))
            if uid == "0" and outline_level == 0:
                continue

            is_summary = find_text(task_el, "Summary") == "1"
            percent = find_text(task_el, "PercentComplete", "0")
            notes = find_text(task_el, "Notes")
            duration_str = find_text(task_el, "Duration")

            # Calculate indent level (OutlineLevel 1 = top level in our format)
            indent_level = max(0, outline_level - 1)
            indent = "  " * indent_level

            # Build task line
            parts = [name]

            # Add duration
            if duration_str and not is_summary:
                days = _parse_iso8601_duration(duration_str)
                if days > 0:
                    parts.append(f"{days}d")

            # Add resources
            resources = task_resources.get(uid, [])
            for res in resources:
                # Use first word as shortname for @mention
                shortname = res.split()[0] if res else res
                parts.append(f"@{shortname}")

            # Add percent complete
            if percent and int(percent) > 0:
                parts.append(f"{percent}%")

            # Add dependencies
            predecessors = []
            for pred_link in findall(task_el, "PredecessorLink"):
                pred_uid = find_text(pred_link, "PredecessorUID")
                if pred_uid and pred_uid in task_uid_to_name:
                    predecessors.append(task_uid_to_name[pred_uid])
            if predecessors:
                deps_str = ", ".join(predecessors)
                parts.append(f"[depends {deps_str}]")

            # Add notes/comments
            if notes:
                parts.append(f'"{notes}"')

            line = f"{indent}{' '.join(parts)}"
            lines.append(line)

    return "\n".join(lines) + "\n"
