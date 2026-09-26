"""Plan quality review: find the common problems in a plan and say how to fix them (#782).

``review_plan(plan_text)`` schedules the plan exactly as ``/api/parse`` does
(same converter, same calendars) and runs every check below over the result.
Each finding says what is wrong, where, how to fix it, and links to the page
in the docs that explains the check. Where the fix is unambiguous it also
carries a ``fix_action`` that ``apply_fix()`` can apply in one step.

Severity
--------

``error``
    The schedule is not what the plan says. Something in the plan is
    ignored or contradictory, so the dates shown are wrong: a dependency on
    a task that does not exist, a circular dependency.

``warning``
    The schedule is computed as written, but it is probably not what the
    author meant, or it will mislead whoever reads it: a task with no
    duration (silently one day), work on a non-working day, a person booked
    twice over, a task that should have finished but shows no progress.

``suggestion``
    The plan is sound; this is good practice it does not follow yet: a task
    nobody owns, a very long task, no RAID log on a plan that is under way.

Health score
------------

100, less 15 per error, 5 per warning and 1 per suggestion -- but each kind
of problem costs at most three findings' worth, so one repeated issue (forty
unowned tasks) cannot outweigh everything else. Floored at 0. Bands:
90+ Healthy, 70+ Fair, 50+ Needs attention, below that At risk. The number is
a triage aid, not a measure of the project: it counts how much of the plan
is trustworthy as written, not whether the project will succeed.

Line numbers
------------

Every task is located by position, not by name: the scheduler numbers tasks
in outline order (``_uid``), and ``task_lines()`` walks the plan text with
the converter's own rules for what is and is not a task line. Findings are
therefore attributed to the right line even when two tasks share a name.
"""

from __future__ import annotations

import difflib
import re
from datetime import date, datetime, timedelta

from .date_math import count_working_days, get_next_working_day
from .exporters import (
    parse_resource_mappings,
    parse_stakeholders_from_frontmatter,
)
from .format_converter import (
    convert_plan_format_to_standard,
    extract_benefits,
    parse_benefits_markdown,
)
from .front_matter_parser import FrontMatterParser
from .scheduling_engine import (
    _calendar_or_holidays_for_task,
    natural_language_to_yaml,
    schedule_tasks,
    task_name_lookup,
)

DOCS_BASE = "https://docs.noodleplanner.com/reference/plan-quality-checks.html"

SEVERITIES = ("error", "warning", "suggestion")
SEVERITY_WEIGHT = {"error": 15, "warning": 5, "suggestion": 1}
MAX_COUNTED_PER_CHECK = 3

# A plan is "meaningful" -- big enough that governance artefacts are
# expected -- once it has this many leaf tasks *and* is under way.
GOVERNANCE_MIN_TASKS = 8
# Leaf durations above this many working days are worth breaking down.
LONG_TASK_WORKING_DAYS = 40
# A dependency chain this long with no milestone has no checkpoint.
LONG_CHAIN_TASKS = 8
# Plans smaller than this are not judged on float.
NO_SLACK_MIN_TASKS = 5

# ---------------------------------------------------------------------------
# The checks, their titles, and what to do about each
# ---------------------------------------------------------------------------

CHECKS = {
    # --- structure ---
    "missing-front-matter": ("warning", "No front matter",
        "Start the plan with a front-matter block: a line of three dashes, "
        "`title: Your project`, any resources, then another line of three dashes."),
    "missing-title": ("suggestion", "No title",
        "Add `title: Your project name` to the front matter."),
    "undeclared-resource": ("warning", "Resource not declared",
        "Declare the resource under `Resources:` in the front matter, e.g. "
        "`- @alex: Alex Chen, Developer`, so reports show a name and role."),
    "no-duration": ("warning", "No duration",
        "Add a duration to the task, e.g. `3d` or `2w`. Without one it is "
        "scheduled as a single day."),
    "empty-summary": ("warning", "Phase with no tasks",
        "Indent the phase's tasks underneath it, or delete the line. A line "
        "with nothing under it is a one-day task, not a phase."),
    "long-duration": ("suggestion", "Very long task",
        "Break the task into smaller pieces of work, each with its own "
        "duration, so progress can be tracked."),
    "no-resource": ("suggestion", "No one assigned",
        "Assign an owner with `@name`, or put `@name` on the phase so every "
        "task in it inherits the owner."),
    "milestone-with-duration": ("warning", "Milestone with a duration",
        "Give the milestone a duration of `0d`. A milestone marks a moment, "
        "not a piece of work."),
    "child-outside-parent": ("warning", "Task outside its phase",
        "Move the task's dates inside its phase, or change the phase's date "
        "or deadline to cover it."),
    # --- dependencies ---
    "dangling-dependency": ("error", "Dependency on a missing task",
        "Correct the task name in `[depends ...]`, or remove the dependency. "
        "The scheduler ignores a dependency it cannot find."),
    "phase-dependency": ("error", "Dependency on a phase",
        "Link tasks, not phases: depend on the phase's last task (or a `0d` "
        "milestone at its end), and put a phase's own dependency on its first "
        "task. The scheduler ignores dependencies to and from phases."),
    "ambiguous-dependency": ("warning", "Dependency on a duplicated name",
        "Rename one of the tasks that share the name, so `[depends ...]` says "
        "which one it means. A duplicated name always resolves to the first "
        "task with that name in the plan."),
    "circular-dependency": ("error", "Circular dependency",
        "Remove one of the dependencies in the loop. Tasks in a loop cannot "
        "be scheduled in dependency order."),
    # --- schedule quality ---
    "long-chain-no-milestone": ("suggestion", "Long chain with no checkpoint",
        "Add a `0d` milestone part-way along the chain, so there is a point "
        "at which progress can be checked."),
    "critical-no-owner": ("warning", "Critical task with no owner",
        "Assign an owner with `@name`. A task on the critical path delays the "
        "whole project if it slips, so someone must be accountable for it."),
    "over-allocation": ("warning", "Resource over-allocated",
        "Stagger the overlapping tasks with dependencies, share the work with "
        "another resource, or level the plan (Resources > Level)."),
    "non-working-day": ("warning", "Start date on a non-working day",
        "Change the start date to a working day. The scheduler already moves "
        "the task to the next working day, so the date in the plan is not the "
        "date shown."),
    "no-slack": ("suggestion", "No float anywhere",
        "Every task is on the critical path, so any slip delays the end date. "
        "Add contingency, or run independent work in parallel."),
    # --- governance ---
    "no-raid": ("suggestion", "No RAID log",
        "Record the plan's risks, assumptions, issues and decisions in a "
        "`---raid log---` section (RAID view > Add)."),
    "no-benefits": ("suggestion", "No benefits",
        "Say what the project is for in a `---benefits---` section "
        "(Benefits view > Add)."),
    "no-stakeholders": ("suggestion", "No stakeholders",
        "List the people affected under `Stakeholders:` in the front matter "
        "(Stakeholders view > Add)."),
    "no-baseline": ("suggestion", "No baseline",
        "Set a baseline (Gantt Tools > Set Baseline) so slippage can be "
        "measured against the agreed plan."),
    "stale-progress": ("warning", "Progress behind the dates",
        "Update the task's percent complete, or move its dates if it has not "
        "actually started."),
}

# ---------------------------------------------------------------------------
# Locating tasks in the text
# ---------------------------------------------------------------------------

_BACK_MATTER = re.compile(r"^---[a-z][a-z -]*---\s*$", re.IGNORECASE)
_HEADING = re.compile(r"^#+\s+\S")
_DURATION = re.compile(r"(?<!~)(?<![~/])\b(\d+)([dwmy])\b")
_DURATION_WORDS = re.compile(r"\b\d+\s*(?:days?|weeks?|months?)\b", re.IGNORECASE)
_STAR_LAG = re.compile(r"^\*\s*[+-]\d+[dwmy]\b")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_DEADLINE = re.compile(r"\bD(\d{4}-\d{2}-\d{2})\b")
_LEVELLED = re.compile(r"\[levelled\s+@?\S+\s+\d{4}-\d{2}-\d{2}\s*\]", re.IGNORECASE)
_DEPENDS = re.compile(r"\[depends\s*:?\s*([^\]]*)\]", re.IGNORECASE)
_MILESTONE_WORD = re.compile(r"\bmilestone\b", re.IGNORECASE)
_EFFORT = re.compile(r"~\d")
_METADATA_HINT = re.compile(
    r"[@%!#\[\"']|\$[A-Za-z_]|\d{4}-\d{2}-\d{2}|\b\d+[dwmy]\b|\b\d+\s*(?:days?|weeks?|months?)\b",
    re.IGNORECASE,
)


def _split_lines(text):
    """The text's lines, each with its own line ending."""
    return str(text or "").splitlines(keepends=True)


def task_lines(plan_text):
    """(line_number, raw_line) for every task line, in outline order.

    Mirrors convert_plan_format_to_standard + natural_language_to_yaml: front
    matter, back-matter sections, blank lines, `//` comments, markdown table
    rows and headings are not tasks; every other line is, in order. Index k
    of the result is the line of the task the scheduler numbers `_uid == k`.
    """
    lines = _split_lines(plan_text)
    out = []
    index = 0
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                index += 1
                break
        else:
            return []
    for number in range(index, len(lines)):
        raw = lines[number].rstrip("\r\n")
        stripped = raw.strip()
        if _BACK_MATTER.match(stripped):
            break
        if not stripped or stripped == "---" or stripped.startswith("//"):
            continue
        if stripped.startswith("|") or _HEADING.match(stripped):
            continue
        out.append((number + 1, raw))
    return out


def _front_matter_bounds(lines):
    """(start, end) indexes of the front matter's `---` lines, or None."""
    if not lines or lines[0].strip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return 0, i
    return None


# ---------------------------------------------------------------------------
# Scheduling, as /api/parse does it
# ---------------------------------------------------------------------------


def _schedule(plan_text):
    fm = FrontMatterParser(plan_text)
    converted = convert_plan_format_to_standard(plan_text)
    data = natural_language_to_yaml(converted, "Project")
    phases = data["Project"]
    if isinstance(phases, dict):
        phases = [phases]
    elif not isinstance(phases, list):
        phases = []
    holidays = fm.parse_non_working_days()
    resource_nwd = fm.parse_resource_non_working_days()
    calendar = fm.active_calendar()
    resource_calendars = fm.resource_calendars()
    tasks = schedule_tasks(
        phases,
        holidays=holidays,
        resource_non_working_days=resource_nwd,
        calendar=calendar,
        resource_calendars=resource_calendars,
    )
    calendars = (holidays, resource_nwd, calendar, resource_calendars)
    return fm, tasks, calendars


def _as_date(value):
    if isinstance(value, datetime):
        return value.date()
    return value


_ALLOCATION = re.compile(r"^(.*?)\[(\d+(?:\.\d+)?)%\]$")


def _resource_shares(task):
    """(shortname, fraction of a day) for each resource on a task.

    `@dev[50%]` is half of Dev's day; a bare `@dev` is all of it -- the same
    reading the Resource Sheet uses.
    """
    shares = []
    for entry in str(task.get("resources") or "").split(","):
        entry = entry.strip().lstrip("@")
        if not entry:
            continue
        match = _ALLOCATION.match(entry)
        if match:
            shares.append((match.group(1).strip().lower(), float(match.group(2)) / 100.0))
        else:
            shares.append((entry.lower(), 1.0))
    return shares


def _resource_keys(task):
    return [name for name, _ in _resource_shares(task)]


def _is_milestone(task):
    duration = task.get("duration")
    return duration is not None and duration.days == 0 and not task.get("summary")


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


class _Review:
    def __init__(self, plan_text, today):
        self.text = plan_text
        self.today = today
        self.findings = []

    def add(self, check, message, *, task=None, line=None, subject=None, fix_action=None,
            severity=None):
        default_severity, title, fix = CHECKS[check]
        self.findings.append({
            "id": f"{check}:{line or 0}:{subject or (task or '')}",
            "check": check,
            "severity": severity or default_severity,
            "title": title,
            "message": message,
            "fix": fix,
            "docs": f"{DOCS_BASE}#{check}",
            "task": task,
            "line": line,
            "fix_action": fix_action,
        })


def review_plan(plan_text, today=None):
    """Review a plan. Returns {findings, score, grade, counts, checked}.

    `today` (a date) fixes "now" for the checks that depend on it; it
    defaults to the real date.
    """
    plan_text = str(plan_text or "")
    today = _as_date(today) or date.today()
    review = _Review(plan_text, today)

    _check_front_matter(review)

    try:
        fm, tasks, calendars = _schedule(plan_text)
    except Exception as exc:  # the plan cannot be scheduled at all
        review.add("circular-dependency" if "circular" in str(exc).lower() else "dangling-dependency",
                   f"The plan could not be scheduled: {exc}", severity="error")
        return _summarise(review)

    positions = task_lines(plan_text)
    by_uid = {}
    for task in tasks:
        uid = task.get("_uid")
        if uid is not None and uid < len(positions):
            by_uid[uid] = positions[uid]

    def line_of(task):
        pos = by_uid.get(task.get("_uid"))
        return pos[0] if pos else None

    def raw_of(task):
        pos = by_uid.get(task.get("_uid"))
        return pos[1] if pos else ""

    ctx = {
        "fm": fm,
        "tasks": tasks,
        "leaves": [t for t in tasks if not t.get("summary")],
        "calendars": calendars,
        "line_of": line_of,
        "raw_of": raw_of,
    }
    for check in (
        _check_resources, _check_durations, _check_summaries, _check_dependencies,
        _check_critical_owners, _check_over_allocation, _check_non_working_days,
        _check_long_chains, _check_slack, _check_progress, _check_governance,
    ):
        check(review, ctx)
    return _summarise(review)


def _summarise(review):
    counts = {severity: 0 for severity in SEVERITIES}
    per_check = {}
    for finding in review.findings:
        counts[finding["severity"]] += 1
        key = (finding["check"], finding["severity"])
        per_check[key] = per_check.get(key, 0) + 1
    penalty = sum(
        SEVERITY_WEIGHT[severity] * min(count, MAX_COUNTED_PER_CHECK)
        for (_, severity), count in per_check.items()
    )
    score = max(0, 100 - penalty)
    grade = ("Healthy" if score >= 90 else "Fair" if score >= 70
             else "Needs attention" if score >= 50 else "At risk")
    order = {severity: i for i, severity in enumerate(SEVERITIES)}
    findings = sorted(review.findings, key=lambda f: (order[f["severity"]], f["line"] or 0, f["check"]))
    return {
        "findings": findings,
        "score": score,
        "grade": grade,
        "counts": counts,
        "checked": sorted(CHECKS),
    }


# ----- front matter ---------------------------------------------------------


def _check_front_matter(review):
    lines = _split_lines(review.text)
    bounds = _front_matter_bounds(lines)
    if bounds is None:
        review.add("missing-front-matter",
                   "The plan has no front matter, so it has no title, resources or calendar.",
                   line=1, fix_action={"kind": "add_front_matter"})
        return
    start, end = bounds
    keys = {ln.split(":", 1)[0].strip().lower() for ln in lines[start + 1:end] if ":" in ln}
    if "title" not in keys:
        review.add("missing-title", "The front matter has no `title:`.", line=start + 1,
                   fix_action={"kind": "add_front_matter_key", "key": "title", "value": "Untitled plan"})


# ----- resources --------------------------------------------------------------


def _check_resources(review, ctx):
    resource_map, _ = parse_resource_mappings(review.text)
    declared = set(resource_map)
    seen = {}
    for task in ctx["tasks"]:
        if task.get("inherited_resource"):
            continue
        for key in _resource_keys(task):
            seen.setdefault(key, task)
    for key, task in sorted(seen.items()):
        if key in declared:
            continue
        raw = ctx["raw_of"](task)
        written = next((m for m in re.findall(r"@([\w.-]+)", raw) if m.lower() == key), key)
        review.add("undeclared-resource",
                   f"@{written} is assigned to tasks but not declared under Resources:.",
                   task=task.get("name"), line=ctx["line_of"](task), subject=key,
                   fix_action={"kind": "declare_resource", "resource": written})

    critical_unowned = set()
    for task in ctx["leaves"]:
        if _is_milestone(task) or _resource_keys(task):
            continue
        if task.get("critical"):
            critical_unowned.add(task.get("_uid"))
            continue
        review.add("no-resource", f"'{task.get('name')}' has no one assigned to it.",
                   task=task.get("name"), line=ctx["line_of"](task))
    ctx["critical_unowned"] = critical_unowned


def _check_critical_owners(review, ctx):
    for task in ctx["leaves"]:
        if task.get("_uid") in ctx.get("critical_unowned", ()):
            review.add("critical-no-owner",
                       f"'{task.get('name')}' is on the critical path and nobody owns it.",
                       task=task.get("name"), line=ctx["line_of"](task))


# ----- durations and structure ------------------------------------------------


def _line_content(raw):
    return raw.strip()


def _has_duration(raw):
    content = _STAR_LAG.sub(lambda m: " " * len(m.group(0)), _line_content(raw))
    return bool(_DURATION.search(content) or _DURATION_WORDS.search(content)
                or re.search(r":p\d+d", content))


def _has_metadata(raw):
    content = _line_content(raw).lstrip("*").strip()
    return bool(_METADATA_HINT.search(content))


def _check_durations(review, ctx):
    tasks = ctx["tasks"]
    for i, task in enumerate(tasks):
        if task.get("summary"):
            continue
        raw = ctx["raw_of"](task)
        line = ctx["line_of"](task)
        name = task.get("name")
        duration = task.get("duration")
        if raw and not _has_duration(raw) and not _EFFORT.search(raw):
            nxt = tasks[i + 1] if i + 1 < len(tasks) else None
            looks_like_phase = (
                task.get("level", 1) <= 1 and not _has_metadata(raw)
                and (nxt is None or nxt.get("level", 1) <= task.get("level", 1))
            )
            if looks_like_phase:
                review.add("empty-summary",
                           f"'{name}' looks like a phase heading, but has no tasks indented under it, "
                           "so it is scheduled as a one-day task.", task=name, line=line)
            else:
                review.add("no-duration", f"'{name}' has no duration, so it is scheduled as one day.",
                           task=name, line=line)
        if duration is not None and duration.days > 0 and _MILESTONE_WORD.search(name or ""):
            review.add("milestone-with-duration",
                       f"'{name}' is named as a milestone but lasts {duration.days} days.",
                       task=name, line=line,
                       fix_action={"kind": "set_duration", "line": line, "days": 0, "task": name})
        if duration is not None and task.get("start") and task.get("finish"):
            working = count_working_days(task["start"], task["finish"], ctx["calendars"][0])
            if working > LONG_TASK_WORKING_DAYS:
                review.add("long-duration",
                           f"'{name}' runs for {working} working days. Tasks this long are hard to track.",
                           task=name, line=line)


def _check_summaries(review, ctx):
    """Children outside an explicit start date or deadline on their phase."""
    tasks = ctx["tasks"]
    for i, parent in enumerate(tasks):
        if not parent.get("summary"):
            continue
        raw = ctx["raw_of"](parent)
        if not raw:
            continue
        masked = _LEVELLED.sub(" ", raw)
        deadline = _DEADLINE.search(masked)
        if deadline:
            masked = masked[:deadline.start()] + " " * len(deadline.group(0)) + masked[deadline.end():]
        start_match = _DATE.search(masked)
        parent_start = datetime.strptime(start_match.group(0), "%Y-%m-%d").date() if start_match else None
        parent_deadline = datetime.strptime(deadline.group(1), "%Y-%m-%d").date() if deadline else None
        if not parent_start and not parent_deadline:
            continue
        level = parent.get("level", 1)
        for child in tasks[i + 1:]:
            if child.get("level", 1) <= level:
                break
            if child.get("summary"):
                continue
            start = _as_date(child.get("start"))
            finish = _as_date(child.get("finish"))
            if parent_start and start and start < parent_start:
                review.add("child-outside-parent",
                           f"'{child.get('name')}' starts on {start}, before its phase "
                           f"'{parent.get('name')}' starts ({parent_start}).",
                           task=child.get("name"), line=ctx["line_of"](child))
            if parent_deadline and finish and finish - timedelta(days=1) > parent_deadline:
                review.add("child-outside-parent",
                           f"'{child.get('name')}' finishes on {finish - timedelta(days=1)}, after its phase "
                           f"'{parent.get('name')}' is due ({parent_deadline}).",
                           task=child.get("name"), line=ctx["line_of"](child))


# ----- dependencies -----------------------------------------------------------


def _dependency_entries(raw):
    """The names written in `[depends ...]` on a line, as written."""
    match = _DEPENDS.search(raw)
    if not match:
        return []
    names = []
    for part in match.group(1).split(","):
        part = part.strip()
        if not part:
            continue
        part = re.sub(r"\s+[+-]\d+[dwmy]$", "", part)
        part = re.sub(r":(?:FS|SS|FF|SF)$", "", part, flags=re.IGNORECASE)
        names.append(part.strip())
    return names


def _check_dependencies(review, ctx):
    tasks = ctx["tasks"]
    names = task_name_lookup(tasks)
    deliverables = {str(t.get("deliverable") or "").lower() for t in tasks if t.get("deliverable")}
    all_names = [t.get("name") for t in tasks if t.get("name")]
    name_counts = {}
    for name in all_names:
        name_counts[name.lower()] = name_counts.get(name.lower(), 0) + 1
    by_uid = {t.get("_uid"): t for t in tasks}

    for task in tasks:
        raw = ctx["raw_of"](task)
        line = ctx["line_of"](task)
        entries = _dependency_entries(raw)
        if task.get("summary") and entries:
            review.add("phase-dependency",
                       f"The phase '{task.get('name')}' has [depends {', '.join(entries)}] on its own "
                       "line. Phases are not scheduled directly, so none of its tasks wait for it.",
                       task=task.get("name"), line=line, subject="own-line")
            continue
        for dep in entries:
            key = dep.lower()
            if key.startswith("$") and key[1:] in deliverables:
                continue
            target = names.get(key)
            if target is not None and name_counts[key] > 1:
                parent = by_uid.get(target.get("_parent_uid"))
                where = f" under '{parent.get('name')}'" if parent and parent.get("name") else ""
                target_line = ctx["line_of"](target)
                at = f" (line {target_line})" if target_line else ""
                review.add("ambiguous-dependency",
                           f"'{task.get('name')}' depends on '{dep}', but {name_counts[key]} tasks "
                           f"have that name. It resolves to the first, "
                           f"{'the phase ' if target.get('summary') else ''}'{target.get('name')}'"
                           f"{where}{at}.",
                           task=task.get("name"), line=line, subject=dep)
            # the scheduler resolves a duplicated name to its first definition,
            # so a phase that comes before a same-named task still takes it
            if target is not None and target.get("summary"):
                review.add("phase-dependency",
                           f"'{task.get('name')}' depends on '{dep}', which is a phase. The scheduler "
                           "ignores dependencies on phases, so this task does not wait for it.",
                           task=task.get("name"), line=line, subject=dep)
                continue
            elif target is not None:
                continue
            # A task whose name contains the dependency as whole words ("Gate"
            # for "$GW1 Gate") is the likeliest meaning; else the nearest spelling
            word = re.compile(rf"(?<![\w$]){re.escape(dep)}(?!\w)", re.IGNORECASE)
            close = [n for n in all_names if word.search(n)][:1] or \
                difflib.get_close_matches(dep, all_names, n=1, cutoff=0.75)
            hint = f" Did you mean '{close[0]}'?" if close else ""
            review.add("dangling-dependency",
                       f"'{task.get('name')}' depends on '{dep}', which is not a task in this plan, "
                       f"so the dependency is ignored.{hint}",
                       task=task.get("name"), line=line, subject=dep,
                       fix_action={"kind": "remove_dependency", "line": line, "dependency": dep,
                                   "task": task.get("name")})

        conflicts = task.get("circular_dependencies") or []
        for conflict in conflicts:
            dep = conflict.get("name") or ""
            action = None
            if conflict.get("fixable") and dep and line:
                action = {"kind": "remove_dependency", "line": line, "dependency": dep,
                          "task": task.get("name")}
            review.add("circular-dependency",
                       conflict.get("message") or f"'{task.get('name')}' is part of a dependency loop.",
                       task=task.get("name"), line=line, subject=dep, fix_action=action)
        if task.get("loop_warning") and not conflicts:
            review.add("circular-dependency", task["loop_warning"], task=task.get("name"), line=line)


# ----- schedule quality -------------------------------------------------------


def _check_over_allocation(review, ctx):
    """A person with more than a full day of work on any working day.

    Each task claims a whole day of each of its resources (or the stated
    share, `@dev[50%]`) on every working day of the task, by that task's own
    calendar -- so holidays and a resource's non-working days are not counted
    as clashes.
    """
    holidays, resource_nwd, calendar, resource_calendars = ctx["calendars"]
    load = {}
    for task in ctx["leaves"]:
        start, finish = task.get("start"), task.get("finish")
        if not start or not finish or _is_milestone(task):
            continue
        shares = _resource_shares(task)
        if not shares:
            continue
        task_calendar = _calendar_or_holidays_for_task(task, holidays, resource_nwd, calendar,
                                                       resource_calendars)
        day = start
        while day < finish:
            if get_next_working_day(day, task_calendar) == day:
                for name, share in shares:
                    per_day = load.setdefault(name, {})
                    key = _as_date(day)
                    per_day[key] = per_day.get(key, 0.0) + share
            day += timedelta(days=1)

    resource_map, _ = parse_resource_mappings(review.text)
    for name in sorted(load):
        busy = sorted(day for day, total in load[name].items() if total > 1.0001)
        if not busy:
            continue
        peak = max(load[name][day] for day in busy)
        label = resource_map.get(name, name)
        span = f"on {busy[0]}" if busy[0] == busy[-1] else f"between {busy[0]} and {busy[-1]}"
        review.add("over-allocation",
                   f"{label} is booked for {peak:g}x a full day on {len(busy)} working "
                   f"day{'s' if len(busy) != 1 else ''} {span}.",
                   subject=name)


def _check_non_working_days(review, ctx):
    holidays, resource_nwd, calendar, resource_calendars = ctx["calendars"]
    for task in ctx["leaves"]:
        raw = ctx["raw_of"](task)
        if not raw or task.get("levelled"):
            continue
        masked = _DEADLINE.sub(lambda m: " " * len(m.group(0)), raw)
        match = _DATE.search(masked)
        if not match:
            continue
        try:
            written = datetime.strptime(match.group(0), "%Y-%m-%d")
        except ValueError:
            continue
        task_calendar = _calendar_or_holidays_for_task(task, holidays, resource_nwd, calendar,
                                                       resource_calendars)
        moved = get_next_working_day(written, task_calendar)
        if moved.date() != written.date():
            line = ctx["line_of"](task)
            review.add("non-working-day",
                       f"'{task.get('name')}' is dated {written.date()}, a non-working day, so it "
                       f"actually starts on {moved.date()}.",
                       task=task.get("name"), line=line,
                       fix_action={"kind": "set_start_date", "line": line,
                                   "date": moved.strftime("%Y-%m-%d"), "task": task.get("name")})


def _predecessor_graph(tasks):
    """leaf uid -> set of predecessor leaf uids (depends + sequential)."""
    leaves = [t for t in tasks if not t.get("summary")]
    by_name = task_name_lookup(tasks)  # first definition wins, as when scheduling
    children = {}
    for t in tasks:
        children.setdefault(t.get("_parent_uid"), []).append(t)

    def leaf_ends(task):
        if not task.get("summary"):
            return [task]
        out = []
        for child in children.get(task.get("_uid"), []):
            out.extend(leaf_ends(child))
        return out

    preds = {t.get("_uid"): set() for t in leaves}
    previous_leaf = None
    for t in tasks:
        if t.get("summary"):
            continue
        uid = t.get("_uid")
        for dep in t.get("depends") or []:
            target = by_name.get(str(dep).lower())
            if target is not None:
                for leaf in leaf_ends(target):
                    if leaf.get("_uid") != uid:
                        preds[uid].add(leaf.get("_uid"))
        if t.get("sequential") and previous_leaf is not None:
            preds[uid].add(previous_leaf.get("_uid"))
        previous_leaf = t
    return preds


def _check_long_chains(review, ctx):
    leaves = {t.get("_uid"): t for t in ctx["leaves"]}
    preds = _predecessor_graph(ctx["tasks"])
    # longest run of non-milestone leaves ending at each task
    memo = {}

    def run(root):
        # Iterative, with an explicit stack of frames: this used to recurse
        # once per link, so a chain of ~1,000 tasks written dependant-first
        # blew Python's recursion limit.  Predecessors are visited in the
        # same order as the recursive version and memoised at the same
        # points, so every length (loops included) comes out the same.
        on_path = set()  # uids with an open frame: the old `stack` tuple
        frames = []      # [uid, iterator over its predecessors, best so far]

        def enter(uid):
            """uid's length if known without descending; else open a frame."""
            if uid in memo:
                return memo[uid]
            if uid in on_path:  # a loop; reported elsewhere
                return 0
            task = leaves.get(uid)
            if task is None or _is_milestone(task):
                memo[uid] = 0
                return 0
            on_path.add(uid)
            frames.append([uid, iter(preds.get(uid, ())), 0])
            return None

        length = enter(root)
        while frames:
            frame = frames[-1]
            for p in frame[1]:
                length = enter(p)
                if length is None:
                    break  # finish p's frame first, then resume this one
                frame[2] = max(frame[2], length)
            else:
                uid, _, best = frames.pop()
                on_path.discard(uid)
                memo[uid] = length = best + 1
                if frames:
                    frames[-1][2] = max(frames[-1][2], length)
        return length

    lengths = {uid: run(uid) for uid in leaves}
    successors = {uid: set() for uid in leaves}
    for uid, ps in preds.items():
        for p in ps:
            successors.setdefault(p, set()).add(uid)
    for uid, length in sorted(lengths.items()):
        if length < LONG_CHAIN_TASKS:
            continue
        # report once per chain: at its end, where no successor extends it
        if any(lengths.get(s, 0) > length for s in successors.get(uid, ())):
            continue
        task = leaves[uid]
        review.add("long-chain-no-milestone",
                   f"{length} tasks run one after another up to '{task.get('name')}' with no milestone "
                   "between them.", task=task.get("name"), line=ctx["line_of"](task))


def _check_slack(review, ctx):
    working = [t for t in ctx["leaves"] if not _is_milestone(t) and t.get("total_float") is not None]
    if len(working) < NO_SLACK_MIN_TASKS:
        return
    # Parallel work is what creates float; a single straight chain has none by design
    if all(t.get("critical") for t in working):
        starts = {t.get("start") for t in working}
        if len(starts) < len(working):
            review.add("no-slack",
                       f"All {len(working)} tasks are on the critical path: there is no float anywhere "
                       "in the schedule.")


def _started(ctx, today):
    """True once the plan is under way: progress recorded, or work dated in the past."""
    for task in ctx["leaves"]:
        percent = task.get("percent")
        try:
            if percent not in (None, "") and float(percent) > 0:
                return True
        except (TypeError, ValueError):
            pass
        start = _as_date(task.get("start"))
        if start and start < today and ctx["raw_of"](task) and _DATE.search(ctx["raw_of"](task)):
            return True
    return False


def _check_progress(review, ctx):
    today = review.today
    for task in ctx["leaves"]:
        finish = _as_date(task.get("finish"))
        if not finish:
            continue
        percent = task.get("percent")
        try:
            done = float(percent) if percent not in (None, "") else 0.0
        except (TypeError, ValueError):
            done = 0.0
        last_day = finish - timedelta(days=1) if not _is_milestone(task) else finish
        if last_day < today and done < 100:
            review.add("stale-progress",
                       f"'{task.get('name')}' was due to finish on {last_day} but is {done:g}% complete.",
                       task=task.get("name"), line=ctx["line_of"](task))


def _check_governance(review, ctx):
    if len(ctx["leaves"]) < GOVERNANCE_MIN_TASKS or not _started(ctx, review.today):
        return
    fm = ctx["fm"]
    try:
        raid = fm.parse_raid()
    except Exception:
        raid = []
    if not raid:
        review.add("no-raid", "The plan is under way but has no RAID log entries.")
    try:
        benefits = parse_benefits_markdown(extract_benefits(review.text))
    except Exception:
        benefits = []
    if not benefits:
        review.add("no-benefits", "The plan is under way but defines no benefits.")
    try:
        stakeholders = parse_stakeholders_from_frontmatter(review.text)
    except Exception:
        stakeholders = []
    if not stakeholders:
        review.add("no-stakeholders", "The plan is under way but names no stakeholders.")
    try:
        baseline = fm.parse_baseline()
    except Exception:
        baseline = []
    if not baseline:
        review.add("no-baseline",
                   "The plan is under way but has no baseline, so slippage cannot be measured.")


# ---------------------------------------------------------------------------
# One-click fixes
# ---------------------------------------------------------------------------


class FixError(ValueError):
    """The fix cannot be applied to this text (it changed, or never applied)."""


def _line_ending(text):
    return "\r\n" if "\r\n" in text else "\n"


def _edit_line(plan_text, line, task, edit):
    lines = _split_lines(plan_text)
    if not line or line < 1 or line > len(lines):
        raise FixError("That line is no longer in the plan.")
    raw = lines[line - 1]
    body = raw.rstrip("\r\n")
    ending = raw[len(body):]
    if task and task.lower() not in body.lower():
        raise FixError(f"Line {line} no longer holds '{task}'. Re-run the review.")
    new_body = edit(body)
    if new_body == body:
        raise FixError("Nothing to change.")
    lines[line - 1] = new_body + ending
    return "".join(lines)


_DURATION_WORD = re.compile(r"(\d+)(days?|weeks?|months?)")


def _set_duration(body, days):
    """`body` with the duration the scheduler reads set to `days` working days.

    The scheduler sees the line after the converter has turned `5days` into
    `5d`, so the earlier of a short or long-form token is the one to replace.
    """
    indent = body[: len(body) - len(body.lstrip())]
    content = body[len(indent):]
    masked = _STAR_LAG.sub(lambda m: " " * len(m.group(0)), content)
    long_form = _DURATION_WORD.search(masked)
    short = _DURATION.search(_DURATION_WORD.sub(lambda m: " " * len(m.group(0)), masked))
    candidates = [m for m in (long_form, short) if m]
    token = f"{days}d"
    if candidates:
        match = min(candidates, key=lambda m: m.start())
        return indent + content[: match.start()] + token + content[match.end():]
    return indent + content.rstrip() + " " + token


def _set_start(body, iso):
    masked = _DEADLINE.sub(lambda m: " " * len(m.group(0)), body)
    match = _DATE.search(masked)
    if match:
        return body[: match.start()] + iso + body[match.end():]
    return body.rstrip() + " " + iso


def _remove_dependency(body, dependency):
    match = _DEPENDS.search(body)
    if not match:
        raise FixError("The dependency is no longer on that line.")
    parts = [p.strip() for p in match.group(1).split(",") if p.strip()]
    kept = [p for p in parts if _dependency_entries(f"[depends {p}]")[0].lower() != dependency.lower()]
    if len(kept) == len(parts):
        raise FixError("The dependency is no longer on that line.")
    if kept:
        replacement = f"[depends {', '.join(kept)}]"
        return body[: match.start()] + replacement + body[match.end():]
    before = body[: match.start()]
    after = body[match.end():]
    if before.endswith(" ") and (not after or after.startswith(" ")):
        before = before[:-1]
    return before + after


def _declare_resource(plan_text, resource):
    short = resource.lstrip("@")
    lines = _split_lines(plan_text)
    eol = _line_ending(plan_text)
    entry = f"- @{short}: {short[:1].upper()}{short[1:]}{eol}"
    bounds = _front_matter_bounds(lines)
    if bounds is None:
        return f"---{eol}Resources:{eol}{entry}---{eol}{eol}" + plan_text
    start, end = bounds
    in_resources = False
    insert_at = None
    for i in range(start + 1, end):
        stripped = lines[i].strip()
        if stripped.lower().startswith("resources:"):
            in_resources = True
            insert_at = i + 1
            continue
        if in_resources:
            if stripped.startswith("-") or lines[i].startswith(" "):
                if re.match(rf"\s*-\s*@{re.escape(short)}\s*:", lines[i], re.IGNORECASE):
                    raise FixError(f"@{short} is already declared.")
                insert_at = i + 1
                continue
            break
    if insert_at is None:
        lines.insert(end, f"Resources:{eol}")
        insert_at = end + 1
    lines.insert(insert_at, entry)
    return "".join(lines)


def apply_fix(plan_text, action):
    """Apply one `fix_action` from a finding and return the new plan text.

    Only the lines the fix is about change; everything else is kept byte for
    byte. Raises FixError if the plan has moved on and the fix no longer
    applies.
    """
    plan_text = str(plan_text or "")
    kind = (action or {}).get("kind")
    if kind == "add_front_matter":
        if _front_matter_bounds(_split_lines(plan_text)) is not None:
            raise FixError("The plan already has front matter.")
        eol = _line_ending(plan_text)
        return f"---{eol}title: Untitled plan{eol}---{eol}{eol}" + plan_text
    if kind == "add_front_matter_key":
        lines = _split_lines(plan_text)
        bounds = _front_matter_bounds(lines)
        if bounds is None:
            raise FixError("The plan has no front matter.")
        key = action["key"]
        if any(ln.split(":", 1)[0].strip().lower() == key.lower() for ln in lines[1:bounds[1]] if ":" in ln):
            raise FixError(f"`{key}:` is already set.")
        lines.insert(1, f"{key}: {action.get('value', '')}{_line_ending(plan_text)}")
        return "".join(lines)
    if kind == "declare_resource":
        return _declare_resource(plan_text, action["resource"])
    if kind == "set_duration":
        return _edit_line(plan_text, action.get("line"), action.get("task"),
                          lambda body: _set_duration(body, int(action["days"])))
    if kind == "set_start_date":
        return _edit_line(plan_text, action.get("line"), action.get("task"),
                          lambda body: _set_start(body, action["date"]))
    if kind == "remove_dependency":
        return _edit_line(plan_text, action.get("line"), action.get("task"),
                          lambda body: _remove_dependency(body, action["dependency"]))
    raise FixError(f"Unknown fix: {kind!r}")


def apply_finding_fix(plan_text, finding_id, today=None):
    """Re-review the plan and apply the fix for the finding with `finding_id`."""
    for finding in review_plan(plan_text, today=today)["findings"]:
        if finding["id"] == finding_id:
            if not finding.get("fix_action"):
                raise FixError("That finding has no one-click fix.")
            return apply_fix(plan_text, finding["fix_action"])
    raise FixError("That finding is no longer present. Re-run the review.")


def format_review(result, limit=None):
    """A plain-text rendering of a review, for the CLI and the AI tools."""
    counts = result["counts"]
    lines = [
        f"Plan health: {result['score']}/100 ({result['grade']}) -- "
        f"{counts['error']} error(s), {counts['warning']} warning(s), "
        f"{counts['suggestion']} suggestion(s)."
    ]
    findings = result["findings"][:limit] if limit else result["findings"]
    for finding in findings:
        where = f" (line {finding['line']})" if finding.get("line") else ""
        fixable = " [one-click fix available]" if finding.get("fix_action") else ""
        lines.append(f"- [{finding['severity']}] {finding['title']}{where}: {finding['message']}")
        lines.append(f"  Fix: {finding['fix']}{fixable} [id: {finding['id']}]")
    if limit and len(result["findings"]) > limit:
        lines.append(f"... and {len(result['findings']) - limit} more.")
    return "\n".join(lines)
