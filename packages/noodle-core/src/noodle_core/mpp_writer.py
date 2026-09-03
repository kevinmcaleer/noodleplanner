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
from datetime import datetime, time

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


class MppTemplateError(RuntimeError):
    """The template .mpp needed for native export is missing or unreadable."""


def _require_pymppwriter():
    try:
        import pymppwriter
        return pymppwriter
    except ImportError as exc:
        raise MppTemplateError(
            "Native .mpp export needs the pymppwriter package: "
            "pip install git+https://github.com/kevinmcaleer/pymppwriter"
        ) from exc


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

    converted = convert_plan_format_to_standard(plan_text)
    resource_map, _ = parse_resource_mappings(plan_text)
    yaml_data = natural_language_to_yaml(converted, project_name)
    phases_raw = yaml_data[project_name]
    phases = phases_raw if isinstance(phases_raw, list) else [phases_raw]
    tasks = schedule_tasks(phases)

    task_name_to_uid = {
        t.get("name", "").lower(): idx for idx, t in enumerate(tasks, start=1)
    }
    links, dropped_links = _resolve_predecessor_links(tasks, task_name_to_uid)

    # resources: case-insensitive fold, one display name each (mirrors XML export)
    resource_names = {}
    for t in tasks:
        for r in (t.get("resources", "") or "").split(","):
            r = r.strip().lstrip("@")
            if r:
                resource_names.setdefault(r.lower(), r)
    resource_uid = {key: uid for uid, key in enumerate(sorted(resource_names), start=1)}

    pw_tasks, pw_rels, pw_assns = [], [], []
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
        if is_milestone:
            finish_dt = start_dt
        else:
            finish_dt = datetime.combine(
                _inclusive_finish(start_d, finish_d), _WORK_FINISH
            )
        while parents and parents[-1][0] >= level:
            parents.pop()
        parent_uid = parents[-1][1] if level > 1 and parents else 0
        notes = [t.get("comment", "")] + dropped_links.get(idx, [])
        pw_tasks.append(pw.Task(
            uid=idx,
            name=_task_display_name(t),
            start=start_dt,
            finish=finish_dt,
            duration_days=max(0, duration_days),
            outline_level=level,
            parent_uid=parent_uid,
            percent_complete=int(t.get("percent", 0) or 0),
            task_type="fixed_duration",
            notes="\n".join(n for n in notes if n),
        ))
        parents.append((level, idx))
        for r in (t.get("resources", "") or "").split(","):
            key = r.strip().lstrip("@").lower()
            if key in resource_uid and not any(
                a.task_uid == idx and a.resource_uid == resource_uid[key]
                for a in pw_assns
            ):
                pw_assns.append(pw.Assignment(idx, resource_uid[key]))
        for pred_uid, msp_type in links.get(idx, []):
            pw_rels.append(pw.Relation(
                pred_uid, idx, type=_LINK_TYPES.get(str(msp_type), "FS")
            ))

    pw_resources = [
        pw.Resource(uid, resource_map.get(key, resource_names[key]))
        for key, uid in sorted(resource_uid.items(), key=lambda kv: kv[1])
    ]

    project_start = min(
        (t.start for t in pw_tasks), default=datetime.combine(datetime.now().date(), _WORK_START)
    )
    project = pw.Project(
        title=project_name,
        start=project_start,
        tasks=pw_tasks,
        relations=pw_rels,
        resources=pw_resources,
        assignments=pw_assns,
        comments="Exported by NoodlePlanner",
    )
    writer.write(project, output_path)
    logger.info("Wrote native .mpp export to %s (%d tasks)", output_path, len(pw_tasks))
