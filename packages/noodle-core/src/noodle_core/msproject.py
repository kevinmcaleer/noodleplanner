"""Microsoft Project export and import.

Supports MS Project XML format (.xml) and native .mpp files.

XML format can be opened by Microsoft Project, ProjectLibre, and other
tools that support the MS Project XML schema.

Writing MSPDI correctly (issue #753)
------------------------------------
MSPDI models every element as an ``xsd:sequence``, so the *order* of the
elements written below is part of the contract — Microsoft Project refuses a
file whose children are out of schema order even though it is perfectly
well-formed XML.  ``SaveVersion`` and ``CurrencyCode`` are the only elements
the schema marks as required, and ``SaveVersion`` must come first.  Tasks also
need a calendar with real working times, or MS Project cannot reconcile
Start/Finish/Duration and reschedules the whole plan on open.

``tests/test_msproject.py`` validates every export against the schema vendored
at ``tests/schemas/mspdi_pj12.xsd``.  Run it after touching this module.

Note that MS Project's *native* .mpp format cannot be written by any
open-source library (MPXJ, the reference implementation, is read-only for
.mpp), which is why the export target is XML.

Native .mpp import uses a pure-Python binary reader (requires only
``olefile``).  No Java runtime needed.  When olefile is not available
the endpoint returns a clear error asking the user to install it.

Field mapping:
    NoodlePlanner → MS Project XML
    task name     → Name
    dependencies  → PredecessorLink
    resources     → ResourceAssignment (via ResourceUID)
    % complete    → PercentComplete
    comments      → Notes
    duration      → Duration (ISO 8601 format PT__H__M__S)
    start/finish  → Start / Finish (stamped with working-day times; the
                    engine's exclusive finish becomes the last working day)
    nesting level → OutlineLevel (both are 1-based)
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


def _minutes_to_iso8601(minutes: int) -> str:
    """Convert a number of working minutes to an ISO 8601 duration string."""
    minutes = max(0, int(round(minutes)))
    return f"PT{minutes // 60}H{minutes % 60}M0S"


# The Standard calendar written into the export: 08:00-12:00 and 13:00-17:00,
# Monday to Friday.  MS Project reads task Start/Finish against this calendar,
# so the times below and the ones stamped onto tasks have to agree.
WORK_DAY_START = "08:00:00"
WORK_DAY_FINISH = "17:00:00"
MINUTES_PER_DAY = 480
MINUTES_PER_WEEK = 2400


def _at_work_start(dt) -> str:
    """Stamp a date with the start of the working day for MS Project XML."""
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return f"{dt.strftime('%Y-%m-%d')}T{WORK_DAY_START}"
    return f"{dt}T{WORK_DAY_START}"


def _at_work_finish(dt) -> str:
    """Stamp a date with the end of the working day for MS Project XML."""
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return f"{dt.strftime('%Y-%m-%d')}T{WORK_DAY_FINISH}"
    return f"{dt}T{WORK_DAY_FINISH}"


def _inclusive_finish(start, finish):
    """Convert an exclusive finish date to the last working day it covers.

    The scheduling engine stores finish dates exclusively — a 5-day task
    starting Monday finishes on Saturday (see ``date_math.add_working_days``).
    MS Project expects the finish to be the last working day *of* the task, so
    step back a day and then back off any weekend.
    """
    if finish is None:
        return start
    if start is not None and finish <= start:
        return start

    last_day = finish - timedelta(days=1)
    for _ in range(7):
        if last_day.weekday() < 5:
            break
        last_day -= timedelta(days=1)

    if start is not None and last_day < start:
        return start
    return last_day


def _task_display_name(task: dict) -> str:
    """The name written to the XML for a scheduled task."""
    name = task.get("description") or task.get("name", "")
    return name.replace("_", " ")


# MS Project dependency types: 0=FF, 1=FS, 2=SF, 3=SS
_DEP_TYPE_TO_MSP = {"FS": "1", "FF": "0", "SF": "2", "SS": "3"}


def _resolve_predecessor_links(tasks: list, task_name_to_uid: dict):
    """Decide which dependencies can be written as ``PredecessorLink``s.

    MS Project derives the task hierarchy from ``OutlineLevel`` and rolls a
    summary task's dates up from its subtasks, so two kinds of link make it
    refuse the file with a "circular relationship" error:

    * a link between a task and its own summary, in either direction, and
    * any link that closes a loop once every summary-level link is expanded
      to the leaf tasks it actually constrains.

    NoodlePlanner tolerates both.  The scheduler ignores ``[depends]`` on a
    summary line (summary dates come from the children) and its loop check
    only follows task-name to task-name edges, so neither shows up as a
    warning in the app.  Leaf-task links are placed first so that when a
    summary-level link conflicts with the links the schedule was actually
    built from, the summary link is the one dropped.

    Returns ``(links, dropped)`` keyed by task UID.  ``links[uid]`` is a list
    of ``(predecessor_uid, msp_type)`` and ``dropped[uid]`` a list of
    explanations for the task's Notes field.
    """
    levels = [max(1, int(task.get("level") or 1)) for task in tasks]

    # Parent of each UID, derived the way MS Project will: from the sequence
    # of OutlineLevels, not from NoodlePlanner's own parent names.
    parent = {}
    stack = []
    for uid, level in enumerate(levels, start=1):
        while stack and levels[stack[-1] - 1] >= level:
            stack.pop()
        parent[uid] = stack[-1] if stack else None
        stack.append(uid)

    children = {}
    for uid, parent_uid in parent.items():
        if parent_uid is not None:
            children.setdefault(parent_uid, []).append(uid)

    leaf_cache = {}

    def leaves(uid):
        """The leaf tasks whose dates a link to ``uid`` constrains."""
        if uid not in leaf_cache:
            kids = children.get(uid)
            if kids:
                leaf_cache[uid] = frozenset().union(*(leaves(k) for k in kids))
            else:
                leaf_cache[uid] = frozenset([uid])
        return leaf_cache[uid]

    def is_ancestor(candidate, uid):
        node = parent.get(uid)
        while node is not None:
            if node == candidate:
                return True
            node = parent.get(node)
        return False

    # Leaf-level successor graph of the links accepted so far.
    successors = {}

    def reaches(sources, targets):
        seen = set(sources)
        frontier = list(sources)
        while frontier:
            node = frontier.pop()
            if node in targets:
                return True
            for nxt in successors.get(node, ()):
                if nxt not in seen:
                    seen.add(nxt)
                    frontier.append(nxt)
        return False

    links = {}
    dropped = {}

    leaf_uids = [u for u, t in enumerate(tasks, start=1) if not t.get("summary")]
    summary_uids = [u for u, t in enumerate(tasks, start=1) if t.get("summary")]

    for uid in leaf_uids + summary_uids:
        task = tasks[uid - 1]
        dep_type_map = task.get("dependency_types", {})
        written = set()
        for dep_name in task.get("depends") or []:
            pred_uid = task_name_to_uid.get(dep_name.lower())
            if not pred_uid or pred_uid in written:
                continue

            pred_leaves = leaves(pred_uid)
            succ_leaves = leaves(uid)
            if pred_uid == uid:
                reason = "a task cannot depend on itself"
            elif is_ancestor(pred_uid, uid):
                reason = "MS Project cannot link a task to its own summary task"
            elif is_ancestor(uid, pred_uid):
                reason = (
                    "MS Project cannot link a summary task to one of its own "
                    "subtasks"
                )
            elif reaches(succ_leaves, pred_leaves):
                reason = (
                    "together with the other links it would form a circular "
                    "relationship in MS Project"
                )
            else:
                msp_type = _DEP_TYPE_TO_MSP.get(
                    dep_type_map.get(dep_name, "FS"), "1"
                )
                links.setdefault(uid, []).append((pred_uid, msp_type))
                written.add(pred_uid)
                for leaf in pred_leaves:
                    successors.setdefault(leaf, set()).update(succ_leaves)
                continue

            pred_display = _task_display_name(tasks[pred_uid - 1])
            dropped.setdefault(uid, []).append(
                f'Dependency on "{pred_display}" was not exported: {reason}.'
            )
            logger.warning(
                "MS Project export: dropping dependency of '%s' on '%s' (%s)",
                _task_display_name(task), pred_display, reason,
            )

    return links, dropped


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

    # Build XML document.
    #
    # The MSPDI schema models every element as an xsd:sequence, so the order of
    # the children below is load-bearing: MS Project refuses a file whose
    # elements are out of schema order.  Keep additions in schema order and run
    # the schema-validation tests in tests/test_msproject.py after any change.
    root = ET.Element("Project")
    root.set("xmlns", "http://schemas.microsoft.com/project")

    # Project header
    ET.SubElement(root, "SaveVersion").text = "14"
    ET.SubElement(root, "Name").text = project_name
    ET.SubElement(root, "Title").text = project_name
    ET.SubElement(root, "ScheduleFromStart").text = "1"

    project_start = min(
        (t["start"] for t in tasks if t.get("start")), default=None
    )
    project_finish = max(
        (t["finish"] for t in tasks if t.get("finish")), default=None
    )
    if project_start:
        ET.SubElement(root, "StartDate").text = _at_work_start(project_start)
    if project_finish:
        ET.SubElement(root, "FinishDate").text = _at_work_finish(
            _inclusive_finish(project_start, project_finish)
        )

    ET.SubElement(root, "CurrencyDigits").text = "2"
    ET.SubElement(root, "CurrencySymbol").text = "$"
    # CurrencyCode is one of only two elements the schema marks as required.
    ET.SubElement(root, "CurrencyCode").text = "USD"
    ET.SubElement(root, "CalendarUID").text = "1"
    ET.SubElement(root, "DefaultStartTime").text = WORK_DAY_START
    ET.SubElement(root, "DefaultFinishTime").text = WORK_DAY_FINISH
    ET.SubElement(root, "MinutesPerDay").text = str(MINUTES_PER_DAY)
    ET.SubElement(root, "MinutesPerWeek").text = str(MINUTES_PER_WEEK)
    ET.SubElement(root, "DaysPerMonth").text = "20"
    ET.SubElement(root, "CurrentDate").text = _at_work_start(datetime.now())

    # Calendar (standard working calendar)
    calendars = ET.SubElement(root, "Calendars")
    calendar = ET.SubElement(calendars, "Calendar")
    ET.SubElement(calendar, "UID").text = "1"
    ET.SubElement(calendar, "Name").text = "Standard"
    ET.SubElement(calendar, "IsBaseCalendar").text = "1"
    ET.SubElement(calendar, "BaseCalendarUID").text = "-1"

    # DayType 1=Sunday .. 7=Saturday.  Without working times MS Project cannot
    # reconcile a task's Start, Finish and Duration and reschedules everything.
    week_days_el = ET.SubElement(calendar, "WeekDays")
    for day_type in range(1, 8):
        working = 2 <= day_type <= 6  # Monday to Friday
        day_el = ET.SubElement(week_days_el, "WeekDay")
        ET.SubElement(day_el, "DayType").text = str(day_type)
        ET.SubElement(day_el, "DayWorking").text = "1" if working else "0"
        if working:
            times_el = ET.SubElement(day_el, "WorkingTimes")
            for from_time, to_time in (
                (WORK_DAY_START, "12:00:00"),
                ("13:00:00", WORK_DAY_FINISH),
            ):
                time_el = ET.SubElement(times_el, "WorkingTime")
                ET.SubElement(time_el, "FromTime").text = from_time
                ET.SubElement(time_el, "ToTime").text = to_time

    # Collect unique resources.  Lookups are case-insensitive, so fold on the
    # lowercased name and keep one display name per resource — otherwise
    # "@Kev" and "@kev" would be written as two Resources sharing a UID.
    resource_names = {}  # lowercased name → display name
    for task in tasks:
        res = task.get("resources", "")
        if res:
            for r in res.split(","):
                r = r.strip().lstrip("@")
                if r:
                    resource_names.setdefault(r.lower(), r)

    resource_uid_map = {
        key: uid for uid, key in enumerate(sorted(resource_names), start=1)
    }

    # Resource UIDs assigned to each task UID, resolved up front because the
    # task's Work depends on how many resources it has.
    assignments_by_task = {}
    for idx, task in enumerate(tasks, start=1):
        res = task.get("resources", "")
        for r in (res.split(",") if res else []):
            res_uid = resource_uid_map.get(r.strip().lstrip("@").lower())
            if res_uid and res_uid not in assignments_by_task.get(idx, []):
                assignments_by_task.setdefault(idx, []).append(res_uid)

    # Build a name-to-UID map for dependencies
    task_name_to_uid = {}
    for idx, task in enumerate(tasks, start=1):
        name = task.get("name", "")
        task_name_to_uid[name.lower()] = idx

    # Work out which dependencies MS Project will accept before writing any
    # task, so a dropped link can be explained in that task's Notes.
    links, dropped_links = _resolve_predecessor_links(tasks, task_name_to_uid)

    # Write Tasks section (schema order: Calendars, Tasks, Resources,
    # Assignments)
    tasks_el = ET.SubElement(root, "Tasks")

    # Per-task (start, finish, working minutes, percent) as written, so the
    # Assignments section can mirror the task exactly.
    task_schedule = {}

    for idx, task in enumerate(tasks, start=1):
        task_el = ET.SubElement(tasks_el, "Task")
        ET.SubElement(task_el, "UID").text = str(idx)
        ET.SubElement(task_el, "ID").text = str(idx)

        ET.SubElement(task_el, "Name").text = _task_display_name(task)

        # 1 = fixed duration; our durations come from the plan, not from work.
        ET.SubElement(task_el, "Type").text = "1"

        # The scheduling engine already numbers top-level tasks as level 1,
        # which is what MSPDI's OutlineLevel expects.
        ET.SubElement(task_el, "OutlineLevel").text = str(
            max(1, task.get("level", 1))
        )

        start = task.get("start")
        finish = task.get("finish")
        duration = task.get("duration")
        if isinstance(duration, timedelta):
            duration_days = duration.days
        elif start and finish:
            duration_days = (finish - start).days
        else:
            duration_days = 0
        is_summary = bool(task.get("summary"))
        is_milestone = duration_days == 0 and not is_summary

        start_text = _at_work_start(start) if start else ""
        if not finish:
            finish_text = ""
        elif is_milestone:
            # A milestone starts and finishes at the same instant; a
            # zero-duration task spanning a whole day makes MS Project
            # rework the assignment to fit.
            finish_text = _at_work_start(start)
        else:
            finish_text = _at_work_finish(_inclusive_finish(start, finish))
        if start_text:
            ET.SubElement(task_el, "Start").text = start_text
        if finish_text:
            ET.SubElement(task_el, "Finish").text = finish_text

        ET.SubElement(task_el, "Duration").text = _duration_to_iso8601(
            duration_days
        )
        ET.SubElement(task_el, "DurationFormat").text = "7"  # 7 = days

        # Work: every assigned resource works the full duration of a
        # fixed-duration task.
        task_minutes = max(0, duration_days) * MINUTES_PER_DAY
        n_assigned = len(assignments_by_task.get(idx, []))
        ET.SubElement(task_el, "Work").text = _minutes_to_iso8601(
            task_minutes * n_assigned
        )
        ET.SubElement(task_el, "Milestone").text = "1" if is_milestone else "0"
        ET.SubElement(task_el, "Summary").text = "1" if is_summary else "0"

        percent = int(task.get("percent", 0) or 0)
        ET.SubElement(task_el, "PercentComplete").text = str(percent)
        ET.SubElement(task_el, "PercentWorkComplete").text = str(percent)
        if percent > 0 and start_text:
            ET.SubElement(task_el, "ActualStart").text = start_text
        if percent >= 100 and finish_text:
            ET.SubElement(task_el, "ActualFinish").text = finish_text

        # Pin every leaf task to the date NoodlePlanner scheduled it for
        # (Start No Earlier Than).  Without a constraint MS Project
        # recalculates on open and slides any task with no predecessor back
        # to the project start, leaving its assignments "outside the
        # original dates" of the task.
        if not is_summary and start_text:
            ET.SubElement(task_el, "ConstraintType").text = "4"
            ET.SubElement(task_el, "ConstraintDate").text = start_text

        task_schedule[idx] = (start_text, finish_text, task_minutes, percent)

        # Notes carry the plan comment plus an explanation of any dependency
        # that had to be left out (see _resolve_predecessor_links).
        notes = [task.get("comment", "")] + dropped_links.get(idx, [])
        notes = [n for n in notes if n]
        if notes:
            ET.SubElement(task_el, "Notes").text = "\n".join(notes)

        # Dependencies (PredecessorLink)
        for pred_uid, msp_type in links.get(idx, []):
            pred_el = ET.SubElement(task_el, "PredecessorLink")
            ET.SubElement(pred_el, "PredecessorUID").text = str(pred_uid)
            ET.SubElement(pred_el, "Type").text = msp_type

    # Write Resources section (schema order: UID, ID, Name, Type)
    resources_el = ET.SubElement(root, "Resources")
    for key, uid in sorted(resource_uid_map.items(), key=lambda kv: kv[1]):
        res_el = ET.SubElement(resources_el, "Resource")
        ET.SubElement(res_el, "UID").text = str(uid)
        ET.SubElement(res_el, "ID").text = str(uid)
        display_name = resource_map.get(key, resource_names[key])
        ET.SubElement(res_el, "Name").text = display_name
        ET.SubElement(res_el, "Type").text = "1"  # 1 = work resource

    # Write Assignments section.  Each assignment mirrors its task's dates
    # and work; an assignment with no dates of its own is what made MS
    # Project warn that "the resource is assigned outside the original
    # dates" and rework the task's duration.  Schema order: UID, TaskUID,
    # ResourceUID, PercentWorkComplete, ActualFinish, ActualStart,
    # ActualWork, Finish, RemainingWork, Start, Units, Work.
    assignments_el = ET.SubElement(root, "Assignments")
    assignment_uid = 1
    for idx in range(1, len(tasks) + 1):
        start_text, finish_text, task_minutes, percent = task_schedule.get(
            idx, ("", "", 0, 0)
        )
        actual_minutes = task_minutes * percent / 100
        for res_uid in assignments_by_task.get(idx, []):
            assign_el = ET.SubElement(assignments_el, "Assignment")
            ET.SubElement(assign_el, "UID").text = str(assignment_uid)
            ET.SubElement(assign_el, "TaskUID").text = str(idx)
            ET.SubElement(assign_el, "ResourceUID").text = str(res_uid)
            ET.SubElement(assign_el, "PercentWorkComplete").text = str(percent)
            if percent >= 100 and finish_text:
                ET.SubElement(assign_el, "ActualFinish").text = finish_text
            if percent > 0 and start_text:
                ET.SubElement(assign_el, "ActualStart").text = start_text
            ET.SubElement(assign_el, "ActualWork").text = _minutes_to_iso8601(
                actual_minutes
            )
            if finish_text:
                ET.SubElement(assign_el, "Finish").text = finish_text
            ET.SubElement(assign_el, "RemainingWork").text = (
                _minutes_to_iso8601(task_minutes - actual_minutes)
            )
            if start_text:
                ET.SubElement(assign_el, "Start").text = start_text
            ET.SubElement(assign_el, "Units").text = "1"
            ET.SubElement(assign_el, "Work").text = _minutes_to_iso8601(
                task_minutes
            )
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


# ---------------------------------------------------------------------------
# Import: .mpp (native MS Project binary) → NoodlePlanner markdown
# ---------------------------------------------------------------------------


def _check_mpp_available() -> bool:
    """Return True if olefile is importable (needed for .mpp reading)."""
    try:
        import olefile  # noqa: F401
        return True
    except ImportError:
        return False


# Backwards-compatible alias
_check_mpxj_available = _check_mpp_available


def _generate_shortname(full_name: str) -> str:
    """Generate a short resource name from a full name.

    Examples:
        "John Smith"     -> "jsmith"
        "Kevin McAleer"  -> "kmcaleer"
        "Alice"          -> "alice"
        "Bob J. Jones"   -> "bjones"
    """
    if not full_name:
        return ""
    parts = full_name.split()
    if len(parts) == 1:
        return parts[0].lower()
    # First initial + last name, all lowercase
    first_initial = parts[0][0].lower()
    last_name = parts[-1].lower()
    return f"{first_initial}{last_name}"


def import_from_mpp(file_bytes: bytes) -> str:
    """Import a native .mpp file and convert to NoodlePlanner markdown.

    Uses a pure-Python MPP binary reader (requires ``olefile``).
    No Java runtime needed.

    Args:
        file_bytes: The raw bytes of the .mpp file.

    Returns:
        NoodlePlanner plan text in markdown format.

    Raises:
        ImportError: If olefile is not installed.
        RuntimeError: If the file cannot be parsed.
    """
    try:
        from .mpp_reader import MppProject, MppReadError
    except ImportError:
        raise ImportError(
            "The olefile package is required to import .mpp files. "
            "Install it with: pip install olefile"
        )

    import tempfile
    import os

    # MppProject.read() needs a file path, so write bytes to a temp file
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".mpp")
    try:
        os.write(tmp_fd, file_bytes)
        os.close(tmp_fd)

        try:
            # pymppwriter reads each file from its own field maps, so durations
            # and resources survive files written by any Project version; the
            # in-house reader's fixed offsets only match some of them.  Any
            # failure here (not installed, or a vintage it cannot parse) falls
            # back to the in-house reader rather than failing the import.
            from .mpp_adapter import read_with_pymppwriter

            project = read_with_pymppwriter(tmp_path)
        except Exception:
            project = MppProject.read(tmp_path)
    except ImportError:
        raise
    except MppReadError as e:
        raise RuntimeError(f"Failed to read .mpp file: {e}") from e
    except Exception as e:
        raise RuntimeError(f"Failed to read .mpp file: {e}") from e
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # Extract project name
    project_name = project.title or "Project"

    # Build resource UID → name map and generate short names
    resource_name_map: dict[int, str] = {}  # uid → full name
    resource_shortnames: dict[int, str] = {}  # uid → shortname
    used_shortnames: set[str] = set()
    for res in project.real_resources():
        resource_name_map[res.unique_id] = res.name
        shortname = _generate_shortname(res.name)
        # Handle collisions by appending a number
        base = shortname
        counter = 2
        while shortname in used_shortnames:
            shortname = f"{base}{counter}"
            counter += 1
        used_shortnames.add(shortname)
        resource_shortnames[res.unique_id] = shortname

    # Build task UID → assigned resource UIDs
    task_resource_uids: dict[int, list[int]] = {}
    for assign in project.assignments:
        res = project.resource_by_uid(assign.resource_unique_id)
        if res and res.name:
            task_resource_uids.setdefault(assign.task_unique_id, []).append(
                assign.resource_unique_id
            )

    # Build task UID → name map for dependency resolution
    task_id_to_name = {}
    for task in project.tasks:
        if task.name:
            task_id_to_name[task.unique_id] = task.name

    # Build an ordered list of real task UIDs for adjacency checks
    real_tasks = [t for t in project.real_tasks() if t.name]
    real_task_uids = [t.unique_id for t in real_tasks]

    # Build markdown output
    lines = [
        "---",
        f"title: {project_name}",
    ]

    # Add resource header section if there are resources
    if resource_name_map:
        lines.append("Resources:")
        for uid in sorted(resource_name_map.keys()):
            full_name = resource_name_map[uid]
            shortname = resource_shortnames[uid]
            lines.append(f"- @{shortname}: {full_name}")

    lines.append("---")
    lines.append("")

    for idx, task in enumerate(real_tasks):
        indent_level = max(0, task.outline_level - 1)
        indent = "  " * indent_level

        parts = [task.name]

        # Duration
        if not task.summary:
            days = task.duration_days
            if days is not None and days > 0:
                parts.append(f"{max(1, int(days))}d")

        # Resources (using shortnames)
        res_uids = task_resource_uids.get(task.unique_id, [])
        for res_uid in res_uids:
            shortname = resource_shortnames.get(res_uid)
            if shortname:
                parts.append(f"@{shortname}")

        # Percent complete
        if task.percent_complete > 0:
            parts.append(f"{task.percent_complete}%")

        # Dependencies (predecessors)
        dep_uids = []
        for dep in project.dependencies:
            if dep.successor_unique_id == task.unique_id:
                if dep.predecessor_unique_id in task_id_to_name:
                    dep_uids.append(dep.predecessor_unique_id)

        # Dependencies (simple '*' is prepended to the task name with no space)
        dep_prefix = ""
        if dep_uids:
            if len(dep_uids) == 1 and idx > 0:
                prev_uid = real_task_uids[idx - 1]
                if dep_uids[0] == prev_uid:
                    dep_prefix = "*"
                else:
                    pred_name = task_id_to_name[dep_uids[0]]
                    parts.append(f"[depends {pred_name}]")
            elif len(dep_uids) == 1:
                pred_name = task_id_to_name[dep_uids[0]]
                parts.append(f"[depends {pred_name}]")
            else:
                dep_names = [task_id_to_name[uid] for uid in dep_uids]
                deps_str = ", ".join(dep_names)
                parts.append(f"[depends {deps_str}]")

        line = f"{indent}{dep_prefix}{' '.join(parts)}"
        lines.append(line)

    return "\n".join(lines) + "\n"
