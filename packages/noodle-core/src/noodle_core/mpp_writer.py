"""Native Microsoft Project .mpp export via pymppwriter.

Maps the same scheduled-task model the MSPDI XML exporter uses onto
pymppwriter's Project/Task/Relation/Resource/Assignment classes, producing a
native MPP14 file that opens in Microsoft Project by double-click — the
advantage over the XML export, which has to be opened from inside Project.

pymppwriter needs a template .mpp saved once from a licensed copy of
Microsoft Project (see its README); point NOODLE_MPP_TEMPLATE at it or place
it at the path passed by the caller.  pymppwriter handles summary rollups,
percent-complete actuals, Start-No-Earlier-Than pinning and work values
natively, so this mapping stays close to the plan model.
"""

import logging
import warnings
from datetime import datetime, time

from .date_math import parse_duration_to_days
from .format_converter import convert_plan_format_to_standard
from .msproject import (
    WORK_DAY_START,
    _inclusive_finish,
    _resolve_predecessor_links,
    _task_display_name,
)
from .scheduling_engine import (
    natural_language_to_yaml,
    parse_resource_mappings,
    schedule_tasks,
)

logger = logging.getLogger(__name__)

# MSPDI numeric link types (what _resolve_predecessor_links yields) → pymppwriter
_LINK_TYPES = {"0": "FF", "1": "FS", "2": "SF", "3": "SS"}

_WORK_START = time.fromisoformat(WORK_DAY_START)
_WORK_FINISH = time(17, 0)

# Breadcrumb for the 99%-on-reopen quirk described in the assignment/date
# consistency note further down: Project reads a 100%-complete task with an
# assignment back as 99%, so the exporter records what the percentage really
# was. The importer restores the 100% and strips the line, so it never reaches
# plan content -- see static/mpp-export.js's isExportNote()/
# hasFullCompleteExportNote(), which own the .mpp -> markdown direction.
#
# This must stay byte-identical to mpp-export.js's FULL_COMPLETE_EXPORT_NOTE.
# The two exporters are required to produce the same model for the same plan,
# and tests/test_mpp_browser_export.mjs compares them field for field.
FULL_COMPLETE_EXPORT_NOTE = "NoodlePlanner export: task was 100% complete"


class MppTemplateError(RuntimeError):
    """The template .mpp needed for native export is missing or unreadable."""


def _has_assigned_resources(text) -> bool:
    """Whether a task's `resources` field names anyone.

    Mirrors splitResources() in static/mpp-export.js: comma-separated, a
    leading `@` optional, blanks ignored.
    """
    return any(r.strip().lstrip("@") for r in str(text or "").split(","))


def _require_pymppwriter():
    try:
        import pymppwriter
        return pymppwriter
    except ImportError as exc:
        raise MppTemplateError(
            "Native .mpp export needs the pymppwriter package: "
            "pip install git+https://github.com/kevinmcaleer/pymppwriter"
        ) from exc


def build_project_model(plan_text: str, project_name: str = "Project") -> dict:
    """The scheduled plan as plain JSON-ready data.

    Both .mpp paths build from this: the Python writer below, and the browser
    exporter, which fetches it and writes the file client-side with mppwriter.
    Keeping one mapping means the two cannot drift apart.

    Dates are ISO strings with no zone — the format stores wall-clock times.
    """
    converted = convert_plan_format_to_standard(plan_text)
    resource_map, _ = parse_resource_mappings(plan_text)
    yaml_data = natural_language_to_yaml(converted, project_name)
    phases_raw = yaml_data[project_name]
    phases = phases_raw if isinstance(phases_raw, list) else [phases_raw]
    tasks = schedule_tasks(phases)

    # first definition of a duplicated name wins, as it does when scheduling
    task_name_to_uid = {}
    for idx, t in enumerate(tasks, start=1):
        task_name_to_uid.setdefault(t.get("name", "").lower(), idx)
    links, dropped_links = _resolve_predecessor_links(tasks, task_name_to_uid)

    # resources: case-insensitive fold, one display name each (mirrors XML export)
    resource_names = {}
    for t in tasks:
        for r in (t.get("resources", "") or "").split(","):
            r = r.strip().lstrip("@")
            if r:
                resource_names.setdefault(r.lower(), r)
    resource_uid = {key: uid for uid, key in enumerate(sorted(resource_names), start=1)}

    out_tasks, out_rels, out_assns = [], [], []
    parents = []            # (level, uid) stack for parent_uid derivation
    for idx, t in enumerate(tasks, start=1):
        start_d, finish_d = t.get("start"), t.get("finish")
        duration = t.get("duration")
        if hasattr(duration, "days"):
            duration_days = duration.days
        elif start_d and finish_d:
            duration_days = (finish_d - start_d).days
        else:
            duration_days = 0
        is_summary = bool(t.get("summary"))
        is_milestone = duration_days == 0 and not is_summary
        level = max(1, t.get("level", 1))
        start_dt = datetime.combine(start_d, _WORK_START)
        finish_dt = start_dt if is_milestone else datetime.combine(
            _inclusive_finish(start_d, finish_d), _WORK_FINISH)
        while parents and parents[-1][0] >= level:
            parents.pop()
        parent_uid = parents[-1][1] if level > 1 and parents else 0
        notes = [t.get("comment", "")] + dropped_links.get(idx, [])
        percent_complete = int(t.get("percent", 0) or 0)
        # Only a leaf task with real duration and an assignment hits Project's
        # 99%-on-reopen quirk, so only that shape earns the breadcrumb.
        if (
            not is_summary
            and max(0, duration_days) > 0
            and percent_complete >= 100
            and _has_assigned_resources(t.get("resources", ""))
        ):
            notes = notes + [FULL_COMPLETE_EXPORT_NOTE]
        out_tasks.append({
            "uid": idx,
            "name": _task_display_name(t),
            "start": start_dt.isoformat(),
            "finish": finish_dt.isoformat(),
            "durationDays": max(0, duration_days),
            "outlineLevel": level,
            "parentUid": parent_uid,
            "percentComplete": percent_complete,
            "taskType": "fixed_duration",
            "notes": "\n".join(n for n in notes if n),
        })
        parents.append((level, idx))
        for r in (t.get("resources", "") or "").split(","):
            key = r.strip().lstrip("@").lower()
            if key in resource_uid and not any(
                a["taskUid"] == idx and a["resourceUid"] == resource_uid[key] for a in out_assns
            ):
                out_assns.append({"taskUid": idx, "resourceUid": resource_uid[key], "units": 1.0})
        # Lag/lead as the scheduler applies it (date_math.parse_duration_to_days:
        # d=1, w=7, m=30, y=365), keyed by the predecessor it was written on.
        lag_by_pred = {}
        for dep_name, offset in (t.get("lag_lead") or {}).items():
            dep_uid = task_name_to_uid.get(dep_name.strip().lower())
            if dep_uid:
                lag_by_pred[dep_uid] = float(parse_duration_to_days(offset))
        for pred_uid, msp_type in links.get(idx, []):
            out_rels.append({
                "predUid": pred_uid, "succUid": idx,
                "type": _LINK_TYPES.get(str(msp_type), "FS"),
                "lagDays": lag_by_pred.get(pred_uid, 0.0),
            })

    out_resources = [
        {"uid": uid, "name": resource_map.get(key, resource_names[key])}
        for key, uid in sorted(resource_uid.items(), key=lambda kv: kv[1])
    ]
    project_start = min((t["start"] for t in out_tasks),
                        default=datetime.combine(datetime.now().date(), _WORK_START).isoformat())
    model = {
        "title": project_name,
        "start": project_start,
        "tasks": out_tasks,
        "relations": out_rels,
        "resources": out_resources,
        "assignments": out_assns,
        "comments": "Exported by NoodlePlanner",
    }
    model["assignmentDateRisks"] = find_assignment_date_risk_tasks(model)
    return model


# --- assignment/date consistency (Snakie#975) -------------------------------
#
# pymppwriter/mppwriter write an assignment's Work as a single aggregate
# value (assignment var entry 49) rather than a true timephased actual/
# remaining contour. Per the library's own docs/FORMAT_NOTES.md ("Progress
# on assigned tasks"), that is verified safe at 0% complete (no actual-work
# data is written at all) and at 100% (a separately tested, already-flagged
# ScheduleWarning: the task's dates hold, only the percentage reads back at
# 99% on reopen) -- but a task with an assignment and a percent strictly
# between 1 and 99 has only been checked against the library's own reader,
# never against Microsoft Project's real scheduler. That gap is what lets
# Project's own reconciliation between a task's declared percent-complete and
# its assignment's incomplete progress data decide the resource's work no
# longer fits the task's stated dates, and offer to change the duration:
# "The resource is assigned outside dates for task ... The duration of this
# fixed duration task will change to accommodate the resource assignment."
# Task 81 ("Bradford optimisation 15d @Jack 53% 2026-08-24") is exactly this
# shape.


def find_assignment_date_risk_tasks(model: dict) -> list:
    """Non-summary, non-milestone tasks in `model` with a resource assignment
    and a percent complete strictly between 0 and 100 -- the shape that risks
    Microsoft Project's "resource is assigned outside dates" warning on open.

    Pure: only reads the model build_project_model already produced, so this
    runs ahead of (or entirely without) writing the actual .mpp file.
    """
    assigned_uids = {a["taskUid"] for a in model.get("assignments", [])}
    risky = []
    for t in model.get("tasks", []):
        if t["uid"] not in assigned_uids:
            continue
        if t.get("durationDays", 0) <= 0:
            continue  # milestones carry no assignment work
        percent = int(t.get("percentComplete", 0) or 0)
        if 0 < percent < 100:
            risky.append({"name": t["name"], "percent": percent})
    return risky


def assignment_date_risk_message(task: dict) -> str:
    """The warning-log message for one task {"name", "percent"}."""
    return (
        f'"{task["name"]}" is {task["percent"]}% complete with an assigned '
        "resource; Microsoft Project may report the resource as assigned "
        "outside the task's dates and change its duration to fit when the "
        "exported .mpp is opened."
    )


def export_to_mpp(
    plan_text: str,
    output_path: str,
    template_path: str,
    project_name: str = "Project",
) -> None:
    """Export a NoodlePlanner plan to a native MS Project .mpp file.

    Args:
        plan_text: Raw plan text (natural language or converted format).
        output_path: File path for the .mpp output.
        template_path: A template .mpp saved by Microsoft Project (see the
            pymppwriter README for the one-time recipe).
        project_name: Name/title for the project.

    Raises:
        MppTemplateError: pymppwriter or the template file is unavailable.
    """
    pw = _require_pymppwriter()
    try:
        writer = pw.MppWriter(template_path)
    except (OSError, ValueError) as exc:
        raise MppTemplateError(
            f"Could not open the .mpp template at {template_path!r}: {exc}. "
            "Save a template from Microsoft Project (File > New > Blank "
            "Project, add the three recipe tasks, Save As) and set "
            "NOODLE_MPP_TEMPLATE to its path."
        ) from exc

    model = build_project_model(plan_text, project_name)
    parse = datetime.fromisoformat
    project = pw.Project(
        title=model["title"],
        start=parse(model["start"]),
        tasks=[pw.Task(
            uid=t["uid"], name=t["name"], start=parse(t["start"]), finish=parse(t["finish"]),
            duration_days=t["durationDays"], outline_level=t["outlineLevel"],
            parent_uid=t["parentUid"], percent_complete=t["percentComplete"],
            task_type=t["taskType"], notes=t["notes"],
        ) for t in model["tasks"]],
        relations=[pw.Relation(r["predUid"], r["succUid"], type=r["type"], lag_days=r["lagDays"])
                   for r in model["relations"]],
        resources=[pw.Resource(r["uid"], r["name"]) for r in model["resources"]],
        assignments=[pw.Assignment(a["taskUid"], a["resourceUid"], units=a["units"])
                     for a in model["assignments"]],
        comments=model["comments"],
    )
    # pymppwriter raises ScheduleWarning for plans Microsoft Project will not
    # reproduce exactly (a task at 100% with resources assigned is the common
    # one). Log them rather than let them vanish into the warnings filter.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        writer.write(project, output_path)
    for w in caught:
        logger.warning("Native .mpp export: %s", w.message)
    for risk in model["assignmentDateRisks"]:
        logger.warning("Native .mpp export: %s", assignment_date_risk_message(risk))
    logger.info("Wrote native .mpp export to %s (%d tasks)", output_path, len(model["tasks"]))
