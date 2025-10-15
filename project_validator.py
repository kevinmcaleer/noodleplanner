#!/usr/bin/env python3

"""
project_validator.py — Validate a compact, human-readable YAML/Markdown project plan.

Validates:
- Structure (project/resources/tasks), unique IDs
- ISO 8601/RFC 3339 dates (date-only or datetime, supports 'Z' and offsets)
- ISO 8601 durations (days/hours/minutes/seconds). Months/years are rejected.
- Dependencies: syntax TASKID:REL±DURATION (REL in FS/SS/FF/SF), with optional lag
- Resource references
- Milestones (duration must be PT0S)
- Start/finish/duration consistency and derived values
- Detects dependency cycles (treats any depends_on as edge from predecessor -> task)

Usage:
    python project_validator.py path/to/file.yaml [--json report.json] [--warn-as-error]

Front matter in Markdown:
    If the file starts with '---' and contains YAML front matter, that block is parsed.
"""

from __future__ import annotations
import argparse
import dataclasses
import datetime as dt
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Set, Tuple, Union

try:
    import yaml  # PyYAML
except Exception:
    yaml = None

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

Duration = dt.timedelta

@dataclasses.dataclass
class Issue:
    level: str  # "ERROR" or "WARN"
    code: str
    message: str
    where: str  # e.g., "task BUILD", "resource dev1", "root"
    def to_dict(self): return dataclasses.asdict(self)

@dataclasses.dataclass
class Derived:
    # derived or normalized values we compute (not written back to file)
    task_id: str
    start: Optional[str] = None
    finish: Optional[str] = None
    duration: Optional[str] = None

def iso_to_datetime(s: str) -> dt.datetime:
    """Parse ISO 8601 / RFC 3339 date or datetime string into timezone-aware datetime.
    Accepts 'YYYY-MM-DD' or full timestamp with 'Z' or '+/-HH:MM' tz.
    Date-only becomes midnight (00:00) with no tzinfo.
    """
    if ISO_DATE_RE.match(s):
        # return naive datetime at midnight (no tz)
        y, m, d = map(int, s.split("-"))
        return dt.datetime(y, m, d, 0, 0, 0)
    # Handle trailing Z
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        # Python 3.11: fromisoformat supports offsets like +01:00
        return dt.datetime.fromisoformat(s)
    except Exception as e:
        raise ValueError(f"Invalid ISO datetime '{s}': {e}")

def datetime_to_iso(x: dt.datetime) -> str:
    if x.tzinfo is None:
        return x.strftime("%Y-%m-%dT%H:%M:%S")
    # Use RFC 3339 style offset
    return x.isoformat()

_DURATION_RE = re.compile(
    r"^(?P<sign>[+-])?P(?:(?P<days>\d+(?:\.\d+)?)D)?"
    r"(?:T(?:(?P<hours>\d+(?:\.\d+)?)H)?(?:(?P<minutes>\d+(?:\.\d+)?)M)?(?:(?P<seconds>\d+(?:\.\d+)?)S)?)?$"
)

# Reject years/months to avoid calendar ambiguity
_REJECT_YM = re.compile(r"[YyMm](?=[^T]*$)")  # 'M' in date part or 'Y' anywhere

def parse_duration(s: str) -> Duration:
    if not s or not s.startswith("P") and not s.startswith("+P") and not s.startswith("-P"):
        raise ValueError("Duration must start with 'P', optionally preceded by '+' or '-' (e.g., P3D, PT6H, +P1D).")
    if re.search(r"Y|M(?=[^T])", s):
        raise ValueError("Years/months in durations are not supported (use days/hours/minutes/seconds).")
    m = _DURATION_RE.match(s)
    if not m:
        raise ValueError(f"Invalid ISO 8601 duration '{s}'.")
    sign = -1 if m.group("sign") == "-" else 1
    days = float(m.group("days") or 0)
    hours = float(m.group("hours") or 0)
    minutes = float(m.group("minutes") or 0)
    seconds = float(m.group("seconds") or 0)
    td = dt.timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)
    return sign * td

def duration_to_iso(td: Duration) -> str:
    total_seconds = int(td.total_seconds())
    sign = "-" if total_seconds < 0 else ""
    total_seconds = abs(total_seconds)
    days, rem = divmod(total_seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, seconds = divmod(rem, 60)
    if days == 0 and hours == 0 and minutes == 0 and seconds == 0:
        return "PT0S"
    s = f"{sign}P"
    if days:
        s += f"{days}D"
    if hours or minutes or seconds:
        s += "T"
        if hours:
            s += f"{hours}H"
        if minutes:
            s += f"{minutes}M"
        if seconds:
            s += f"{seconds}S"
    return s

_DEP_RE = re.compile(r"^(?P<id>[A-Za-z0-9._-]+)(?::(?P<rel>FS|SS|FF|SF)(?P<lag>[+-].+)?)?$")

def parse_dependency(s: str) -> Tuple[str, str, Duration]:
    """Return (task_id, relation, lag) where relation defaults to FS and lag defaults to 0."""
    m = _DEP_RE.match(s.strip())
    if not m:
        raise ValueError(f"Invalid dependency '{s}'. Expected TASKID[:REL[±DURATION]]")
    tid = m.group("id")
    rel = m.group("rel") or "FS"
    lag_s = m.group("lag")
    lag = dt.timedelta(0)
    if lag_s:
        lag = parse_duration(lag_s)
    return tid, rel, lag

def load_yaml_or_front_matter(path: str) -> Dict[str, Any]:
    if yaml is None:
        raise RuntimeError("PyYAML is required. Install with: pip install pyyaml")
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if text.strip().startswith("---"):
        # Extract front matter
        parts = text.split("\n")
        if parts[0].strip() == "---":
            for i in range(1, len(parts)):
                if parts[i].strip() == "---":
                    front = "\n".join(parts[1:i])
                    return yaml.safe_load(front) or {}
    # Else assume pure YAML
    return yaml.safe_load(text) or {}

def ensure_list(x) -> List[Any]:
    if x is None:
        return []
    if isinstance(x, list):
        return x
    return [x]

def validate(data: Dict[str, Any]) -> Tuple[List[Issue], List[Derived]]:
    issues: List[Issue] = []
    derived: List[Derived] = []

    def err(code, msg, where="root"): issues.append(Issue("ERROR", code, msg, where))
    def warn(code, msg, where="root"): issues.append(Issue("WARN", code, msg, where))

    # Root checks
    if not isinstance(data, dict):
        err("ROOT_TYPE", "Top-level document must be a mapping (YAML object).")
        return issues, derived

    project = data.get("project", {})
    resources = ensure_list(data.get("resources"))
    tasks = ensure_list(data.get("tasks"))

    if not tasks:
        err("TASKS_MISSING", "No tasks found at top-level 'tasks'.")
        return issues, derived

    # Project checks
    if project and not isinstance(project, dict):
        err("PROJECT_TYPE", "'project' must be a mapping.")
    else:
        name = project.get("name")
        if name is None:
            warn("PROJECT_NAME_MISSING", "Project name is recommended.", "project")
        start = project.get("start")
        if start is not None:
            try: iso_to_datetime(str(start))
            except Exception as e: err("PROJECT_START_INVALID", str(e), "project")

    # Resource checks
    resource_ids: Set[str] = set()
    for i, r in enumerate(resources):
        where = f"resource[{i}]"
        if not isinstance(r, dict):
            err("RESOURCE_TYPE", "Resource must be a mapping with at least 'id'.", where); continue
        rid = r.get("id")
        if not rid:
            err("RESOURCE_ID", "Resource missing 'id'.", where); continue
        if rid in resource_ids:
            err("RESOURCE_DUP", f"Duplicate resource id '{rid}'.", where); continue
        resource_ids.add(rid)

    # Task checks
    task_ids: Set[str] = set()
    for i, t in enumerate(tasks):
        where = f"task[{i}]"
        if not isinstance(t, dict):
            err("TASK_TYPE", "Task must be a mapping.", where); continue
        tid = t.get("id")
        if not tid:
            err("TASK_ID", "Task missing 'id'.", where); continue
        if tid in task_ids:
            err("TASK_DUP", f"Duplicate task id '{tid}'.", f"task {tid}"); continue
        task_ids.add(tid)

    # Second pass for field-level validation and derived values
    edges: List[Tuple[str, str]] = []
    for t in tasks:
        if not isinstance(t, dict) or "id" not in t: 
            continue
        tid = t["id"]
        where = f"task {tid}"

        # Name recommended
        if "name" not in t:
            warn("TASK_NAME_MISSING", "Task has no 'name'.", where)

        # Start/finish/duration
        start_s = t.get("start")
        finish_s = t.get("finish")
        duration_s = t.get("duration")
        milestone = bool(t.get("milestone", False))

        start_dt = None
        finish_dt = None
        dur_td = None

        # Parse and validate
        if start_s is not None:
            try: start_dt = iso_to_datetime(str(start_s))
            except Exception as e: err("TASK_START_INVALID", str(e), where)
        if finish_s is not None:
            try: finish_dt = iso_to_datetime(str(finish_s))
            except Exception as e: err("TASK_FINISH_INVALID", str(e), where)
        if duration_s is not None:
            try: dur_td = parse_duration(str(duration_s))
            except Exception as e: err("TASK_DURATION_INVALID", str(e), where)

        if milestone:
            if dur_td is None:
                warn("MILESTONE_DURATION", "Milestone without explicit zero duration; assuming PT0S.", where)
                dur_td = dt.timedelta(0)
            if dur_td and dur_td != dt.timedelta(0):
                err("MILESTONE_NONZERO", "Milestone must have zero duration (PT0S).", where)

        # Consistency: need at least 2 of (start, finish, duration) to derive the third.
        present = sum(x is not None for x in (start_dt, finish_dt, dur_td))
        if present >= 2:
            if start_dt is not None and dur_td is not None and finish_dt is None:
                finish_dt = start_dt + dur_td
            elif finish_dt is not None and dur_td is not None and start_dt is None:
                start_dt = finish_dt - dur_td
            elif start_dt is not None and finish_dt is not None and dur_td is None:
                dur_td = finish_dt - start_dt
                if dur_td.total_seconds() < 0:
                    err("NEG_DURATION", "Finish precedes start.", where)
            # Populate derived
            d = Derived(task_id=tid)
            if start_dt is not None: d.start = datetime_to_iso(start_dt)
            if finish_dt is not None: d.finish = datetime_to_iso(finish_dt)
            if dur_td is not None: d.duration = duration_to_iso(dur_td)
            derived.append(d)
        else:
            # It's OK for dependent tasks to omit dates; but warn if all missing.
            if present == 0:
                warn("TASK_DATES_MISSING", "Task has none of start/finish/duration. This is allowed but may be unintended.", where)

        # Resources
        res = ensure_list(t.get("resources"))
        normalized_res_ids: List[str] = []
        for r in res:
            if isinstance(r, str):
                normalized_res_ids.append(r)
            elif isinstance(r, dict) and "id" in r:
                normalized_res_ids.append(r["id"])
            else:
                err("RESOURCE_REF", f"Invalid resource reference '{r}'. Use string id or {{id, units}}.", where)
        for rid in normalized_res_ids:
            if resource_ids and rid not in resource_ids:
                err("RESOURCE_UNKNOWN", f"Task references unknown resource '{rid}'.", where)

        # Dependencies
        deps = ensure_list(t.get("depends_on"))
        for dep in deps:
            try:
                pred_id, rel, lag = parse_dependency(str(dep))
                if pred_id not in task_ids:
                    err("DEP_UNKNOWN", f"Dependency references unknown task '{pred_id}'.", where)
                # We accept any relation, but record graph edge
                edges.append((pred_id, tid))
            except Exception as e:
                err("DEP_INVALID", str(e), where)

    # Cycle detection (simple DFS on edges)
    graph: Dict[str, List[str]] = {tid: [] for tid in task_ids}
    for a, b in edges:
        graph.setdefault(a, []).append(b)
    temp: Set[str] = set()
    visited: Set[str] = set()
    cycle_stack: List[str] = []

    def dfs(u: str) -> bool:
        temp.add(u)
        cycle_stack.append(u)
        for v in graph.get(u, []):
            if v in temp:
                # report cycle
                cyc = cycle_stack + [v]
                err("DEP_CYCLE", f"Cycle detected: {' -> '.join(cyc)}", "dependencies")
                return True
            if v not in visited:
                if dfs(v):
                    return True
        temp.remove(u)
        visited.add(u)
        cycle_stack.pop()
        return False

    for node in list(graph.keys()):
        if node not in visited:
            if dfs(node):
                break  # one cycle is enough

    return issues, derived

def main():
    ap = argparse.ArgumentParser(description="Validate a YAML/Markdown project plan.")
    ap.add_argument("path", help="Path to YAML file or Markdown with YAML front matter")
    ap.add_argument("--json", dest="json_out", help="Write machine-readable report to this JSON file")
    ap.add_argument("--warn-as-error", action="store_true", help="Treat warnings as errors (non-zero exit)")
    args = ap.parse_args()

    try:
        data = load_yaml_or_front_matter(args.path)
    except Exception as e:
        print(f"[FATAL] Could not read '{args.path}': {e}", file=sys.stderr)
        sys.exit(2)

    issues, derived = validate(data)

    # Human-readable output
    if not issues:
        print("✅ No issues found.")
    else:
        for it in issues:
            print(f"[{it.level}] {it.code} @ {it.where}: {it.message}")

    if derived:
        print("\nDerived values:")
        for d in derived:
            parts = [f"task {d.task_id}"]
            if d.start: parts.append(f"start={d.start}")
            if d.finish: parts.append(f"finish={d.finish}")
            if d.duration: parts.append(f"duration={d.duration}")
            print("  - " + " | ".join(parts))

    if args.json_out:
        report = {
            "issues": [i.to_dict() for i in issues],
            "derived": [dataclasses.asdict(d) for d in derived],
            "ok": all(i.level == "WARN" for i in issues)
        }
        try:
            with open(args.json_out, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)
            print(f"\nWrote JSON report to {args.json_out}")
        except Exception as e:
            print(f"[ERROR] Could not write JSON report: {e}", file=sys.stderr)

    # Exit code
    exit_bad = any(i.level == "ERROR" for i in issues) or (args.warn_as_error and any(issues))
    sys.exit(1 if exit_bad else 0)

def validate_project_yaml(data):
    # Accept both old and new schemas
    # New: top-level key is project name, value is list of phases
    # Old: top-level 'tasks' key
    if 'tasks' in data:
        # Old schema
        issues, _ = validate(data)
        if any(i.level == "ERROR" for i in issues):
            raise Exception("Validation failed: " + ", ".join(f"{i.code}: {i.message}" for i in issues))
        return True
    else:
        # New schema: top-level key is project name
        if len(data) != 1:
            raise Exception("Validation failed: Top-level must have exactly one project key.")
        project_name = list(data.keys())[0]
        phases = data[project_name]
        if not isinstance(phases, list):
            raise Exception("Validation failed: Project value must be a list of phases.")
        # Each phase should be a dict with phase name as key and list of tasks (strings or dicts) as value
        for phase in phases:
            if not isinstance(phase, dict):
                raise Exception("Validation failed: Each phase must be a dict.")
            for phase_name, items in phase.items():
                if not isinstance(items, list):
                    raise Exception(f"Validation failed: Phase '{phase_name}' must be a list of tasks.")
                if not items:
                    raise Exception(f"Validation failed: Phase '{phase_name}' must not be empty.")
                for item in items:
                    if not (isinstance(item, str) or isinstance(item, dict)):
                        raise Exception(f"Validation failed: Task in phase '{phase_name}' must be a string or dict.")
        return True

if __name__ == "__main__":
    main()
