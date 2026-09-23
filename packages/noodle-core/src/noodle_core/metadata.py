"""Metadata extraction, recurrence parsing, and dependency analysis.

Depends on: date_math (for parse_duration_to_days used inside extract_metadata).
"""

import re

import logging
from datetime import timedelta
from dateutil.parser import parse as parse_date

from .date_math import parse_duration_to_days

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Task-line patterns, compiled once. extract_metadata runs once per task line
# on every parse, and these used to be recompiled (or at least re-looked-up in
# re's cache) about forty times per task (#789).
# ---------------------------------------------------------------------------
_TOKEN_SPLIT = re.compile(r'(?<!\\)\s+')
_QUALITY_ROLE = re.compile(r'^(.+?):(P|R|A)$', re.IGNORECASE)
_DEPENDS_BLOCK = re.compile(r'\[depends[^\]]*\]', re.IGNORECASE)
_DELIVERABLE = re.compile(r'([/^])?\$([A-Za-z_][A-Za-z0-9_-]*)')
_LABEL = re.compile(r'#([^@%#!\s]+)')
_BRACKET_DEP = re.compile(r'\[depends\s*:?\s*([^\]]*)\]', re.IGNORECASE)
_LAG_LEAD = re.compile(r'^(.+?)\s+([+\-]\d+[dwmy])$')
_DEP_TYPE = re.compile(r'^(.+?):(FS|SS|FF|SF)$', re.IGNORECASE)
_RECURRENCE = re.compile(r'\[repeats\s+([^\]]+)\]', re.IGNORECASE)
_BUCKET = re.compile(r'\{([^}]+)\}')
_PRIORITY = re.compile(r'(?<!\w)(!!!|!!|!)(?!["\'])')
_BANG_COMMENT = re.compile(r'!(?:"([^"]+)"|\'([^\']+)\')')
_DQ_COMMENT = re.compile(r'"([^"]+)"')
_SQ_COMMENT = re.compile(r"'([^']+)'")
_EFFORT = re.compile(r'~(\d+(?:\.\d+)?)(h|d)(?:/(\d+(?:\.\d+)?)(h|d))?')
_PERCENT = re.compile(r'(\d{1,3})%')
_LEGACY_PERCENT = re.compile(r'\bp(\d{1,3})\b')
_LEVELLED = re.compile(r'\[levelled\s+@?(\S+)\s+(\d{4}-\d{2}-\d{2})\s*\]', re.IGNORECASE)
_DEADLINE = re.compile(r'\bD(\d{4}-\d{2}-\d{2})\b')
_DATE = re.compile(r'(\d{4}-\d{2}-\d{2})')
_DURATION = re.compile(r'(?<!~)(?<![~/])\b(\d+)([dwmy])\b')
# A sequential line's own lag, `* +2d Build 3d`: the `+2d` is the gap after the
# previous task finishes, never part of the task's name or duration.
_STAR_LAG_SPLIT = re.compile(r'^\*\s*([+-]\d+[dwmy])\b\s*')


def split_star_lag(text):
    """Split a sequential line's lag off: `* +2d Build 3d` -> ('+2d', '* Build 3d').

    Anything else comes back unchanged with no lag. Every parser takes the lag
    off here first, so it never leaks into a name or reads as a duration, and
    the scheduler applies it as a finish-to-start lag on the previous task.
    """
    text = str(text)
    match = _STAR_LAG_SPLIT.match(text)
    if not match:
        return None, text
    return match.group(1), '* ' + text[match.end():]
_LEGACY_DURATION = re.compile(r':p(\d+)d')
_DESCRIPTION = re.compile(r"\*?(.*?)([/^]?\$[A-Za-z]|@|#|!|\"|{|\[|D\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|:p\d+d|\d+[dwmy]|\d+%|~\d|$)")
_PERCENT_TOKEN = re.compile(r'\s*\b\d{1,3}%')


def parse_recurrence(recurrence_str):
    """Parse a recurrence string from [repeats ...] syntax.

    Supported formats:
      daily
      weekly mon,wed,fri
      monthly 3rd thu
      yearly

    Returns a dict with keys:
      frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
      days: list of lowercase 3-letter day abbreviations (weekly only)
      week_of_month: int 1-5 (monthly only)
      day_of_week: lowercase 3-letter day abbreviation (monthly only)
      raw: the original string
    """
    s = recurrence_str.strip().lower()
    result = {'raw': s}

    if s == 'daily':
        result['frequency'] = 'daily'
    elif s == 'yearly':
        result['frequency'] = 'yearly'
    elif s.startswith('weekly'):
        result['frequency'] = 'weekly'
        days_part = s[len('weekly'):].strip()
        if days_part:
            result['days'] = [d.strip() for d in days_part.split(',') if d.strip()]
        else:
            result['days'] = []
    elif s.startswith('monthly'):
        result['frequency'] = 'monthly'
        monthly_part = s[len('monthly'):].strip()
        ordinal_map = {'1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5}
        match = re.match(r'(\d+(?:st|nd|rd|th))\s+(\w+)', monthly_part)
        if match:
            ordinal_str = match.group(1)
            day_str = match.group(2)
            result['week_of_month'] = ordinal_map.get(ordinal_str, 1)
            result['day_of_week'] = day_str
    else:
        result['frequency'] = s

    return result


def generate_recurrence_occurrences(task, window_start, window_end):
    """Generate occurrence dates for a recurring task within a date window.

    Args:
        task: Task dict with 'recurrence' key (parsed recurrence dict)
        window_start: datetime.date start of window (inclusive)
        window_end: datetime.date end of window (inclusive)

    Returns:
        List of datetime.date objects for each occurrence in the window
    """
    recurrence = task.get('recurrence')
    if not recurrence:
        return []

    frequency = recurrence.get('frequency')
    occurrences = []

    day_name_to_weekday = {
        'mon': 0, 'tue': 1, 'wed': 2, 'thu': 3, 'fri': 4, 'sat': 5, 'sun': 6,
        'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
        'friday': 4, 'saturday': 5, 'sunday': 6
    }

    if frequency == 'daily':
        current = window_start
        while current <= window_end:
            occurrences.append(current)
            current = current + timedelta(days=1)

    elif frequency == 'weekly':
        target_days = recurrence.get('days', [])
        target_weekdays = {day_name_to_weekday[d] for d in target_days if d in day_name_to_weekday}
        if not target_weekdays:
            # No specific days: recur every day of the week
            current = window_start
            while current <= window_end:
                occurrences.append(current)
                current = current + timedelta(days=1)
        else:
            current = window_start
            while current <= window_end:
                if current.weekday() in target_weekdays:
                    occurrences.append(current)
                current = current + timedelta(days=1)

    elif frequency == 'monthly':
        week_of_month = recurrence.get('week_of_month', 1)
        day_of_week_str = recurrence.get('day_of_week', '')
        target_weekday = day_name_to_weekday.get(day_of_week_str)

        if target_weekday is not None:
            # Iterate through each month in the window
            import calendar
            current_year = window_start.year
            current_month = window_start.month
            end_year = window_end.year
            end_month = window_end.month

            while (current_year, current_month) <= (end_year, end_month):
                # Find all occurrences of target_weekday in the month
                cal = calendar.monthcalendar(current_year, current_month)
                matching_days = []
                for week in cal:
                    day = week[target_weekday]
                    if day != 0:
                        matching_days.append(day)

                if len(matching_days) >= week_of_month:
                    day_num = matching_days[week_of_month - 1]
                    from datetime import date as date_type
                    occurrence = date_type(current_year, current_month, day_num)
                    if window_start <= occurrence <= window_end:
                        occurrences.append(occurrence)

                # Advance to next month
                if current_month == 12:
                    current_month = 1
                    current_year += 1
                else:
                    current_month += 1

    elif frequency == 'yearly':
        # Recur on the same month/day each year
        task_start = task.get('start')
        if task_start:
            if isinstance(task_start, str):
                from dateutil.parser import parse as parse_date_local
                task_start = parse_date_local(task_start).date()
            elif hasattr(task_start, 'date'):
                task_start = task_start.date()
            from datetime import date as date_type
            for year in range(window_start.year, window_end.year + 1):
                try:
                    occurrence = date_type(year, task_start.month, task_start.day)
                    if window_start <= occurrence <= window_end:
                        occurrences.append(occurrence)
                except ValueError:
                    pass  # Skip Feb 29 in non-leap years

    return occurrences


def extract_metadata(task_str, task_name=None):
    meta = {}
    lag, task_str = split_star_lag(task_str)
    if lag:
        meta['sequential_lag'] = lag
    tokens = _TOKEN_SPLIT.split(task_str)
    resources = [t for t in tokens if t.startswith('@')]

    # Separate quality-role assignments (@resource:P/R/A) from regular resources
    quality_roles = {}  # {resource_shortname: role_letter}
    regular_resources = []
    for r in resources:
        name = r.lstrip('@')
        # Check for :P, :R, or :A suffix (case-insensitive)
        qr_match = _QUALITY_ROLE.match(name)
        if qr_match:
            res_name = qr_match.group(1)
            role_letter = qr_match.group(2).upper()
            quality_roles[res_name] = role_letter
        else:
            regular_resources.append(name)

    if regular_resources:
        meta['resources'] = ', '.join(regular_resources)
    if quality_roles:
        meta['quality_roles'] = quality_roles

    # Extract deliverable/product marker using $ prefix (e.g. $fuselage, $avionics)
    # Supports product type prefixes: /$name (group), ^$name (external), $name (internal)
    # A $token inside [depends ...] is a reference to another product, not
    # this task's own deliverable, so search the line with that block removed.
    # Otherwise "Build [depends $GW2]" registers Build as $GW2 and the
    # dependency resolves to Build itself.
    outside_depends = _DEPENDS_BLOCK.sub('', task_str)
    deliverable_match = _DELIVERABLE.search(outside_depends)
    if deliverable_match:
        meta['deliverable'] = deliverable_match.group(2)
        prefix = deliverable_match.group(1)
        if prefix == '/':
            meta['product_type'] = 'group'
        elif prefix == '^':
            meta['product_type'] = 'external'
        else:
            meta['product_type'] = 'internal'

    # Extract labels/tags using # prefix (e.g. #urgent, #DEV)
    label_matches = _LABEL.findall(task_str)
    if label_matches:
        meta['labels'] = [l.strip() for l in label_matches]

    # Extract dependencies using [depends task1, task2, ...] syntax
    # Supports lag/lead time: [depends task1 +2d, task2 -1w]
    # Supports dependency types: [depends task1:SS, task2:FF +2d]
    # Valid types: FS (default), SS, FF, SF
    # A colon after the keyword ([depends: task1]) is accepted too — the .mpp
    # importer writes that form, and users type it.
    bracket_dep_match = _BRACKET_DEP.search(task_str)
    if bracket_dep_match:
        # Split by comma and parse each dependency with optional lag/lead
        raw_deps = bracket_dep_match.group(1).strip()
        dep_list = []
        lag_lead_map = {}  # Maps dependency name to lag/lead offset
        dep_type_map = {}  # Maps dependency name to type (FS, SS, FF, SF)

        if raw_deps:
            dep_specs = raw_deps.split(',')
            for dep_spec in dep_specs:
                dep_spec = dep_spec.strip()
                if not dep_spec:
                    continue
                # Check for lag/lead time: "TaskName +2d" or "TaskName:SS +2d"
                lag_lead_match = _LAG_LEAD.search(dep_spec)
                if lag_lead_match:
                    dep_task_name = lag_lead_match.group(1).strip()
                    lag_lead_str = lag_lead_match.group(2)
                    # Check for dependency type suffix on the task name
                    type_match = _DEP_TYPE.search(dep_task_name)
                    if type_match:
                        dep_task_name = type_match.group(1).strip()
                        dep_type = type_match.group(2).upper()
                        if dep_type != 'FS':
                            dep_type_map[dep_task_name] = dep_type
                    dep_list.append(dep_task_name)
                    lag_lead_map[dep_task_name] = lag_lead_str
                else:
                    # Check for dependency type suffix: "TaskName:SS"
                    type_match = _DEP_TYPE.search(dep_spec)
                    if type_match:
                        dep_task_name = type_match.group(1).strip()
                        dep_type = type_match.group(2).upper()
                        if dep_type != 'FS':
                            dep_type_map[dep_task_name] = dep_type
                        dep_list.append(dep_task_name)
                    else:
                        dep_list.append(dep_spec)

        # Store lag/lead map if any were found
        if lag_lead_map:
            meta['lag_lead'] = lag_lead_map

        # Store dependency type map if any non-default types were found
        if dep_type_map:
            meta['dependency_types'] = dep_type_map

        meta['depends'] = dep_list

    # Extract recurrence using [repeats ...] syntax
    recurrence_match = _RECURRENCE.search(task_str)
    if recurrence_match:
        meta['recurrence'] = parse_recurrence(recurrence_match.group(1))

    if task_name:
        meta['name'] = task_name
    if str(task_str).startswith('*'):
        meta['sequential'] = True
        logger.debug("[SEQUENTIAL] Task '%s' marked as sequential (task_str: '%s')", task_name, task_str)
    else:
        logger.debug("[NOT SEQUENTIAL] Task '%s' not sequential (task_str: '%s')", task_name, task_str)
    # Extract bucket name from {BucketName} syntax
    bucket_match = _BUCKET.search(task_str)
    if bucket_match:
        meta['bucket'] = bucket_match.group(1).strip()

    # Extract priority from ! markers (!!!=Urgent, !!=Important, !=Medium, none=Low)
    # Must check for !!! before !! before ! to match greedily
    # Only match standalone ! markers, not !"comment" patterns
    priority_match = _PRIORITY.search(task_str)
    if priority_match:
        marker = priority_match.group(1)
        if marker == '!!!':
            meta['priority'] = 'Urgent'
        elif marker == '!!':
            meta['priority'] = 'Important'
        elif marker == '!':
            meta['priority'] = 'Medium'
    else:
        meta['priority'] = 'Low'

    # Support both !"comment" and "comment" formats
    comment_match = _BANG_COMMENT.search(task_str)
    if comment_match:
        meta['comment'] = comment_match.group(1) if comment_match.group(1) is not None else comment_match.group(2)
    else:
        # Also support plain quoted text as comments
        comment_match = _DQ_COMMENT.search(task_str)
        if comment_match:
            meta['comment'] = comment_match.group(1)
        else:
            comment_match = _SQ_COMMENT.search(task_str)
            if comment_match:
                meta['comment'] = comment_match.group(1)

    # Extract effort using ~ prefix: ~8h, ~3d, ~8h/16h, ~2d/5d
    # Format: ~completed/total or ~total (if no slash, it's the total with 0 completed)
    effort_match = _EFFORT.search(task_str)
    if effort_match:
        completed_val = float(effort_match.group(1))
        completed_unit = effort_match.group(2)
        if effort_match.group(3) is not None:
            # Format: ~completed/total (e.g., ~8h/16h)
            total_val = float(effort_match.group(3))
            total_unit = effort_match.group(4)
            meta['effort_completed'] = completed_val
            meta['effort_completed_unit'] = completed_unit
            meta['effort_total'] = total_val
            meta['effort_total_unit'] = total_unit
            meta['effort_remaining'] = total_val - completed_val
            meta['effort_remaining_unit'] = total_unit
        else:
            # Format: ~total (e.g., ~16h) - total only, no completed
            meta['effort_completed'] = 0
            meta['effort_completed_unit'] = completed_unit
            meta['effort_total'] = completed_val
            meta['effort_total_unit'] = completed_unit
            meta['effort_remaining'] = completed_val
            meta['effort_remaining_unit'] = completed_unit

    # Support both new format (10%) and old format (p10)
    percent_match = _PERCENT.search(task_str)
    if percent_match:
        meta['percent'] = max(0, min(100, int(percent_match.group(1))))
    else:
        # Fall back to old format
        percent_match = _LEGACY_PERCENT.search(task_str)
        if percent_match:
            meta['percent'] = max(0, min(100, int(percent_match.group(1))))

    # Auto-calculate percent from effort if both completed and total are present
    if 'effort_completed' in meta and 'effort_total' in meta and meta['effort_total'] > 0:
        completed = meta['effort_completed']
        total = meta['effort_total']
        completed_unit = meta.get('effort_completed_unit', 'h')
        total_unit = meta.get('effort_total_unit', 'h')
        # Convert to hours if units differ (1d = 8h)
        if completed_unit != total_unit:
            completed_hours = completed * 8 if completed_unit == 'd' else completed
            total_hours = total * 8 if total_unit == 'd' else total
        else:
            completed_hours = completed
            total_hours = total
        if total_hours > 0:
            meta['percent'] = max(0, min(100, round(completed_hours / total_hours * 100)))

    # Extract deadline marker using D prefix: D2026-09-10. Unlike the plain
    # start-date token below, a deadline never drives scheduling -- it's a
    # fixed marker compared against the computed finish date later (see
    # exporters.calculate_rag_status). The token is stripped from the string
    # used for start-date/description extraction so its embedded YYYY-MM-DD
    # isn't picked up twice and the leading "D" doesn't leak into the
    # description.
    task_str_for_dates = task_str
    deadline_match = _DEADLINE.search(task_str)
    if deadline_match:
        meta['deadline'] = deadline_match.group(1)
        task_str_for_dates = _DEADLINE.sub('', task_str_for_dates)

    # Extract resource levelling flag: [levelled @shortname YYYY-MM-DD]
    # The date inside the flag overrides any other start so the scheduler
    # honours the levelled start. The flag is stripped from the string
    # used for other date matching so the embedded YYYY-MM-DD isn't picked
    # up twice.
    levelled_match = _LEVELLED.search(task_str_for_dates)
    if levelled_match:
        meta['levelled'] = {
            'resource': levelled_match.group(1).lstrip('@'),
            'start': levelled_match.group(2),
        }
        task_str_for_dates = (
            task_str_for_dates[:levelled_match.start()] + task_str_for_dates[levelled_match.end():]
        )
        meta['start'] = parse_date(levelled_match.group(2))
        meta['due'] = levelled_match.group(2)
    else:
        date_match = _DATE.search(task_str_for_dates)
        if date_match:
            meta['due'] = date_match.group(1)
            meta['start'] = parse_date(date_match.group(1))

    # Support new simple format: 10d, 2w, 3m, 1y
    # Use negative lookbehind to avoid matching effort tokens (prefixed with ~)
    duration_match = _DURATION.search(task_str)
    if duration_match:
        value = int(duration_match.group(1))
        unit = duration_match.group(2)
        if unit == 'd':
            meta['duration'] = timedelta(days=value)
        elif unit == 'w':
            meta['duration'] = timedelta(weeks=value)
        elif unit == 'm':
            meta['duration'] = timedelta(days=value * 30)  # Approximate month as 30 days
        elif unit == 'y':
            meta['duration'] = timedelta(days=value * 365)  # Approximate year as 365 days
    else:
        # Fall back to old format :p10d
        duration_match = _LEGACY_DURATION.search(task_str)
        if duration_match:
            meta['duration'] = timedelta(days=int(duration_match.group(1)))

    desc_match = _DESCRIPTION.match(task_str)
    if desc_match:
        desc = desc_match.group(1).strip()
        # Safety: strip any percent tokens that slipped into the description
        desc = _PERCENT_TOKEN.sub('', desc).strip()
        meta['description'] = desc
    return meta


def detect_dependency_loops(tasks):
    """Detect circular dependencies in tasks.

    Uses depth-first search (DFS) to find cycles in the dependency graph.
    Returns a list of loop detection results with warnings for affected tasks.

    Args:
        tasks: List of tasks with 'name' and 'depends' fields

    Returns:
        dict with 'has_loops' (bool), 'loops' (list of cycle descriptions),
        and 'affected_tasks' (list of task names involved in loops)
    """
    result = {
        'has_loops': False,
        'loops': [],
        'affected_tasks': set(),
        'task_warnings': {}  # Maps task name to warning message
    }

    # Build a lookup map for tasks by name (case-insensitive)
    task_map = {}
    for task in tasks:
        if 'name' in task:
            task_map[task['name'].lower()] = task

    # Build adjacency list from dependencies
    # deps_graph[A] = [B, C] means A depends on B and C
    deps_graph = {}
    for task in tasks:
        task_name = task.get('name', '').lower()
        if task_name:
            deps_graph[task_name] = set()
            if 'depends' in task and task['depends']:
                for dep in task['depends']:
                    dep_name = dep.strip().lower()
                    # Only add if the dependency task exists
                    if dep_name in task_map:
                        deps_graph[task_name].add(dep_name)

    # DFS to detect cycles
    visited = set()
    rec_stack = set()  # Recursion stack to detect back edges

    def dfs(node, path):
        """Perform DFS to find cycles."""
        visited.add(node)
        rec_stack.add(node)
        path.append(node)

        if node in deps_graph:
            for neighbor in deps_graph[node]:
                if neighbor not in visited:
                    dfs(neighbor, path[:])  # Continue search
                elif neighbor in rec_stack:
                    # Found a cycle
                    cycle_start_idx = path.index(neighbor)
                    cycle = path[cycle_start_idx:] + [neighbor]
                    cycle_str = ' -> '.join(cycle)
                    result['loops'].append(cycle_str)
                    result['has_loops'] = True

                    # Mark all tasks in the cycle as affected
                    for task_in_cycle in cycle[:-1]:  # Exclude the repeated node
                        result['affected_tasks'].add(task_in_cycle)

        rec_stack.remove(node)

    # Run DFS from each unvisited node
    for task_name in deps_graph:
        if task_name not in visited:
            dfs(task_name, [])

    # Convert affected_tasks set to list and create warning messages
    result['affected_tasks'] = list(result['affected_tasks'])

    for task in tasks:
        task_name = task.get('name', '').lower()
        if task_name in result['affected_tasks']:
            # Find the task in the loops
            involved_in = [loop for loop in result['loops'] if task_name in loop.lower()]
            result['task_warnings'][task.get('name', task_name)] = (
                f"Circular dependency detected. Part of cycle: {involved_in[0]}"
                if involved_in else "Circular dependency detected"
            )

    return result


def detect_hierarchy_dependency_conflicts(tasks):
    """Find dependencies between a task and its own phase (or itself).

    ``detect_dependency_loops`` only follows task-name to task-name edges, so
    a subtask that lists its own phase as a dependency (easy to do with a
    ``$deliverable`` reference, e.g. ``*GW2 Approval [depends $definition]``
    inside the ``Definition $definition`` phase) never registers as a loop.
    The scheduler ignores the link, but it is circular to anything that rolls
    phase dates up from subtasks, and Microsoft Project refuses to open such a
    plan.

    The hierarchy is derived from the ``level`` sequence of the ordered task
    list, the same way MS Project derives it from ``OutlineLevel``.

    Args:
        tasks: Ordered task list (summaries before their children) with
            ``name``, ``level``, ``summary`` and ``depends``.

    Returns:
        dict mapping task index to a list of conflict dicts, each with
        ``name`` and ``deliverable`` of the offending predecessor, a
        ``reason`` code (``own_phase``, ``own_subtask`` or ``self``), a
        human-readable ``message`` and ``fixable`` (always True here: the
        fix is to remove that entry from the ``[depends ...]`` list).
    """
    levels = [max(1, int(task.get('level') or 1)) for task in tasks]

    parent = {}
    stack = []
    for idx, level in enumerate(levels):
        while stack and levels[stack[-1]] >= level:
            stack.pop()
        parent[idx] = stack[-1] if stack else None
        stack.append(idx)

    def is_ancestor(candidate, idx):
        node = parent.get(idx)
        while node is not None:
            if node == candidate:
                return True
            node = parent.get(node)
        return False

    # Last occurrence wins, matching name_lookup in schedule_tasks.
    index_by_name = {}
    for idx, task in enumerate(tasks):
        if task.get('name'):
            index_by_name[task['name'].lower()] = idx

    def display_name(task):
        return task.get('description') or task.get('name', '')

    conflicts = {}
    for idx, task in enumerate(tasks):
        for dep_name in task.get('depends') or []:
            pred_idx = index_by_name.get(dep_name.strip().lower())
            if pred_idx is None:
                continue
            pred = tasks[pred_idx]
            if pred_idx == idx:
                reason = 'self'
                message = f'"{display_name(task)}" depends on itself'
            elif is_ancestor(pred_idx, idx):
                reason = 'own_phase'
                message = (
                    f'"{display_name(task)}" depends on its own phase '
                    f'"{display_name(pred)}"'
                )
            elif is_ancestor(idx, pred_idx):
                reason = 'own_subtask'
                message = (
                    f'Phase "{display_name(task)}" depends on its own subtask '
                    f'"{display_name(pred)}"'
                )
            else:
                continue
            conflicts.setdefault(idx, []).append({
                'name': pred.get('name', ''),
                'deliverable': pred.get('deliverable', ''),
                'reason': reason,
                'message': message,
                'fixable': True,
            })
    return conflicts


def inherit_summary_resources(tasks):
    """Propagate resources from summary tasks to their unassigned children.

    When a summary task has a resource assigned (e.g. @kev), all child tasks
    that don't have their own resource will inherit it for calculation purposes.
    The inherited resource is marked so the markdown is not modified.
    """
    for task in tasks:
        if not task.get('summary'):
            continue
        summary_resource = task.get('resources', '')
        if not summary_resource:
            continue
        # schedule_tasks tags every task with a '_uid' identity, distinct
        # from its (possibly duplicated) display name; use that to match
        # children when present so that two summary tasks sharing a name
        # (#838) don't leak resources into each other's children. Callers
        # that pass hand-built task dicts without '_uid' (e.g. tests
        # exercising this function directly) fall back to matching by name,
        # exactly as before.
        if '_uid' in task:
            _propagate_resource_to_children(tasks, task['_uid'], summary_resource, by_uid=True)
        else:
            _propagate_resource_to_children(tasks, task.get('name'), summary_resource, by_uid=False)


def _propagate_resource_to_children(tasks, parent_key, resource, by_uid=False):
    """Recursively assign inherited resource to unassigned children.

    ``parent_key`` is a task '_uid' when ``by_uid`` is True, otherwise a
    parent display name (the pre-#838 behaviour, kept for callers that don't
    supply '_uid').
    """
    for task in tasks:
        task_parent_key = task.get('_parent_uid') if by_uid else task.get('parent')
        if task_parent_key != parent_key:
            continue
        if task.get('summary'):
            # If child summary has no resource, inherit from parent
            if not task.get('resources'):
                task['resources'] = resource
                task['inherited_resource'] = True
            # Recurse into child summary's children
            child_key = task.get('_uid') if by_uid else task.get('name')
            _propagate_resource_to_children(tasks, child_key, task.get('resources', ''), by_uid=by_uid)
        else:
            # Leaf task: only assign if no resource already set
            if not task.get('resources'):
                task['resources'] = resource
                task['inherited_resource'] = True
