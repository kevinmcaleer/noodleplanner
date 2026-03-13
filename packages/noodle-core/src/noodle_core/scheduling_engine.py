import os
import yaml
import re
import csv
from datetime import datetime, timedelta
from dateutil.parser import parse as parse_date
import logging
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

from .format_converter import extract_raid_log, parse_raid_markdown, extract_baseline, parse_baseline_markdown, extract_budget, parse_budget_markdown

logger = logging.getLogger(__name__)

# Configurable task limits (override via environment variables)
MAX_TASK_COUNT = int(os.environ.get("NOODLE_MAX_TASK_COUNT", 10000))
MAX_NESTING_DEPTH = int(os.environ.get("NOODLE_MAX_NESTING_DEPTH", 20))
MAX_TASK_NAME_LENGTH = int(os.environ.get("NOODLE_MAX_TASK_NAME_LENGTH", 500))

DURATION_REGEX = re.compile(r"P(?:\d+D)?(?:\d+H)?(?:\d+M)?(?:\d+S)?")

# RAID Log Excel column widths (in characters)
RAID_COLUMN_WIDTHS = {
    'ID': 6,
    'Type': 14,
    'Title': 25,
    'Description': 35,
    'Raised By': 15,
    'Owner': 15,
    'Mitigation Actions': 35,
    'Impact': 10,
    'Likelihood': 12,
    'Score': 8,
    'Status': 14,
    'Priority': 12,
    'Target Date': 14,
}

def get_next_working_day(date, holidays=None):
    """Get the next working day from a given date.

    If the given date is already a working day, return it.
    Otherwise, find the next working day (skipping weekends and holidays).

    Args:
        date: The date to check
        holidays: Set of holiday dates to skip (optional)

    Returns:
        The next working day (could be the same date if it's already a working day)
    """
    if holidays is None:
        holidays = set()

    current_date = date
    max_iterations = 366
    for _ in range(max_iterations):
        is_weekend = current_date.weekday() >= 5  # Saturday=5, Sunday=6
        is_holiday = current_date in holidays

        if not is_weekend and not is_holiday:
            return current_date

        current_date += timedelta(days=1)

    raise ValueError(
        f"Could not find a working day within {max_iterations} days of {date}"
    )

def add_working_days(start_date, num_days, holidays=None):
    """Add working days to a start date, skipping weekends and holidays.

    The finish date is exclusive (one day after the last working day).
    For example, a 1-day task starting Monday will have finish = Tuesday.
    A 5-day task starting Monday will have finish = Saturday (Mon-Fri are the 5 working days).

    This convention allows Gantt bar widths to be calculated as (finish - start) in
    calendar days without needing to add 1.

    Args:
        start_date: The starting date
        num_days: Number of working days to add (can be negative)
        holidays: Set of holiday dates to skip (optional)

    Returns:
        The finish date after adding working days (exclusive)
    """
    if holidays is None:
        holidays = set()

    if num_days == 0:
        # Zero-duration tasks (milestones) finish on the same day
        return start_date

    max_working_days = 5000  # ~20 years of working days
    if abs(num_days) > max_working_days:
        raise ValueError(
            f"Number of working days ({num_days}) exceeds maximum allowed ({max_working_days})"
        )

    # Handle negative days (going backwards)
    if num_days < 0:
        current_date = start_date
        days_subtracted = 0
        direction = -1
        target_days = abs(num_days)

        while days_subtracted < target_days:
            current_date += timedelta(days=direction)

            # Check if current date is a working day
            is_weekend = current_date.weekday() >= 5  # Saturday=5, Sunday=6
            is_holiday = current_date in holidays

            if not is_weekend and not is_holiday:
                days_subtracted += 1

        return current_date

    # Handle positive days (going forward)
    # Ensure we start from a working day
    current_date = get_next_working_day(start_date, holidays)
    days_added = 1  # Start day counts as day 1

    # Add remaining days
    while days_added < num_days:
        current_date += timedelta(days=1)

        # Check if current date is a working day
        is_weekend = current_date.weekday() >= 5  # Saturday=5, Sunday=6
        is_holiday = current_date in holidays

        if not is_weekend and not is_holiday:
            days_added += 1

    # Return the day AFTER the last working day (finish date is exclusive for rendering)
    # This allows Gantt charts to render bars with proper width
    return current_date + timedelta(days=1)

def parse_duration(s):
    if not s:
        return None
    try:
        # Only support days for simplicity
        if s.startswith('P') and 'D' in s:
            days = int(s.split('P')[1].split('D')[0])
            return timedelta(days=days)
        # Could add more parsing for H/M/S
    except (ValueError, IndexError):
        pass
    return None

def parse_duration_to_days(duration_str):
    """
    Parse duration string like '+2d', '-1w', '+3m' to number of days.
    Supports: d (days), w (weeks), m (months - 30 days), y (years - 365 days)
    Returns positive for lag (wait after), negative for lead (start before).
    """
    if not duration_str:
        return 0

    # Extract sign, number, and unit
    match = re.match(r'([+\-])(\d+)([dwmy])', duration_str)
    if not match:
        return 0

    sign = match.group(1)
    number = int(match.group(2))
    unit = match.group(3)

    # Convert to days
    multipliers = {'d': 1, 'w': 7, 'm': 30, 'y': 365}
    days = number * multipliers.get(unit, 1)

    # Apply sign
    return days if sign == '+' else -days
def extract_metadata(task_str, task_name=None):
    meta = {}
    tokens = re.split(r'(?<!\\)\s+', task_str)
    resources = [t for t in tokens if t.startswith('@')]
    if resources:
        meta['resources'] = ', '.join([r.lstrip('@') for r in resources])

    # Extract labels/tags using # prefix (e.g. #urgent, #DEV)
    label_pattern = r'#([^@%#!\s]+)'
    label_matches = re.findall(label_pattern, task_str)
    if label_matches:
        meta['labels'] = [l.strip() for l in label_matches]

    # Extract dependencies using [depends task1, task2, ...] syntax
    # Now also supports lag/lead time: [depends task1 +2d, task2 -1w]
    bracket_dep_pattern = r'\[depends\s*([^\]]*)\]'
    bracket_dep_match = re.search(bracket_dep_pattern, task_str, re.IGNORECASE)
    if bracket_dep_match:
        # Split by comma and parse each dependency with optional lag/lead
        raw_deps = bracket_dep_match.group(1).strip()
        dep_list = []
        lag_lead_map = {}  # Maps dependency name to lag/lead offset

        if raw_deps:
            dep_specs = raw_deps.split(',')
            for dep_spec in dep_specs:
                dep_spec = dep_spec.strip()
                if not dep_spec:
                    continue
                # Check for lag/lead time: "TaskName +2d" or "TaskName -1w"
                lag_lead_match = re.search(r'^(.+?)\s+([+\-]\d+[dwmy])$', dep_spec)
                if lag_lead_match:
                    dep_task_name = lag_lead_match.group(1).strip()
                    lag_lead_str = lag_lead_match.group(2)
                    dep_list.append(dep_task_name)
                    lag_lead_map[dep_task_name] = lag_lead_str
                else:
                    dep_list.append(dep_spec)

        # Store lag/lead map if any were found
        if lag_lead_map:
            meta['lag_lead'] = lag_lead_map

        meta['depends'] = dep_list
    if task_name:
        meta['name'] = task_name
    if str(task_str).startswith('*'):
        meta['sequential'] = True
        logger.debug("[SEQUENTIAL] Task '%s' marked as sequential (task_str: '%s')", task_name, task_str)
    else:
        logger.debug("[NOT SEQUENTIAL] Task '%s' not sequential (task_str: '%s')", task_name, task_str)
    # Extract bucket name from {BucketName} syntax
    bucket_match = re.search(r'\{([^}]+)\}', task_str)
    if bucket_match:
        meta['bucket'] = bucket_match.group(1).strip()

    # Extract priority from ! markers (!!!=Urgent, !!=Important, !=Medium, none=Low)
    # Must check for !!! before !! before ! to match greedily
    # Only match standalone ! markers, not !"comment" patterns
    priority_match = re.search(r'(?<!\w)(!!!|!!|!)(?!["\'])', task_str)
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
    comment_match = re.search(r'!(?:"([^"]+)"|\'([^\']+)\')', task_str)
    if comment_match:
        meta['comment'] = comment_match.group(1) if comment_match.group(1) is not None else comment_match.group(2)
    else:
        # Also support plain quoted text as comments
        comment_match = re.search(r'"([^"]+)"', task_str)
        if comment_match:
            meta['comment'] = comment_match.group(1)
        else:
            comment_match = re.search(r"'([^']+)'", task_str)
            if comment_match:
                meta['comment'] = comment_match.group(1)

    # Extract effort using ~ prefix: ~8h, ~3d, ~8h/16h, ~2d/5d
    # Format: ~completed/total or ~total (if no slash, it's the total with 0 completed)
    effort_match = re.search(r'~(\d+(?:\.\d+)?)(h|d)(?:/(\d+(?:\.\d+)?)(h|d))?', task_str)
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
    percent_match = re.search(r'(\d{1,3})%', task_str)
    if percent_match:
        meta['percent'] = max(0, min(100, int(percent_match.group(1))))
    else:
        # Fall back to old format
        percent_match = re.search(r'\bp(\d{1,3})\b', task_str)
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

    date_match = re.search(r'(\d{4}-\d{2}-\d{2})', task_str)
    if date_match:
        meta['due'] = date_match.group(1)
        meta['start'] = parse_date(date_match.group(1))

    # Support new simple format: 10d, 2w, 3m, 1y
    # Use negative lookbehind to avoid matching effort tokens (prefixed with ~)
    duration_match = re.search(r'(?<!~)(?<![~/])\b(\d+)([dwmy])\b', task_str)
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
        duration_match = re.search(r':p(\d+)d', task_str)
        if duration_match:
            meta['duration'] = timedelta(days=int(duration_match.group(1)))

    desc_match = re.match(r"\*?(.*?)(@|#|!|\"|{|\d{4}-\d{2}-\d{2}|:p\d+d|\d+[dwmy]|\d+%|~\d|$)", task_str)
    if desc_match:
        desc = desc_match.group(1).strip()
        # Safety: strip any percent tokens that slipped into the description
        desc = re.sub(r'\s*\b\d{1,3}%', '', desc).strip()
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
        parent_name = task.get('name')
        _propagate_resource_to_children(tasks, parent_name, summary_resource)


def _propagate_resource_to_children(tasks, parent_name, resource):
    """Recursively assign inherited resource to unassigned children."""
    for task in tasks:
        if task.get('parent') != parent_name:
            continue
        if task.get('summary'):
            # If child summary has no resource, inherit from parent
            if not task.get('resources'):
                task['resources'] = resource
                task['inherited_resource'] = True
            # Recurse into child summary's children
            _propagate_resource_to_children(tasks, task['name'], task.get('resources', ''))
        else:
            # Leaf task: only assign if no resource already set
            if not task.get('resources'):
                task['resources'] = resource
                task['inherited_resource'] = True


def schedule_tasks(phases, holidays=None, resource_non_working_days=None):
    """Schedule tasks from arbitrarily nested structure.

    Args:
        phases: Nested dict structure from natural_language_to_yaml or YAML.
                Leaf tasks have {'_text': str, '_level': int}
                Summary tasks have nested dicts with '_level' and '_is_summary' markers
        holidays: Set of project-wide holiday dates to skip when scheduling.
        resource_non_working_days: Dict mapping lowercase resource shortnames to
                sets of datetime.date for resource-specific non-working days.

    Returns:
        List of tasks, each with: name, description, level, resources, start, finish,
        duration, percent, comment, summary (bool), parent, phase
    """
    all_tasks = []

    def traverse_nested_dict(node, parent_name=None, parent_level=-1, depth=0):
        """Recursively traverse nested dict and extract tasks."""
        if depth > MAX_NESTING_DEPTH:
            raise ValueError(
                f"Task nesting depth exceeds maximum of {MAX_NESTING_DEPTH}. "
                f"Reduce nesting or set NOODLE_MAX_NESTING_DEPTH environment variable."
            )

        if isinstance(node, list):
            # Handle list of dicts at top level
            for item in node:
                traverse_nested_dict(item, parent_name, parent_level, depth)
            return

        if not isinstance(node, dict):
            return

        # Check if this is a leaf task
        if '_text' in node:
            # Leaf task - extract metadata
            task_name = None
            for key in node.keys():
                if key not in ('_text', '_level'):
                    task_name = key
                    break

            text = node['_text']
            level = node.get('_level', parent_level + 1)

            # Extract task name from text if not already set
            if not task_name:
                parts = text.split()
                if parts:
                    task_name = parts[0].lstrip('*')
                else:
                    task_name = text

            if len(task_name) > MAX_TASK_NAME_LENGTH:
                raise ValueError(
                    f"Task name '{task_name[:50]}...' exceeds maximum length of "
                    f"{MAX_TASK_NAME_LENGTH} characters. "
                    f"Set NOODLE_MAX_TASK_NAME_LENGTH environment variable to increase."
                )

            meta = extract_metadata(text, task_name)
            meta['level'] = level
            meta['parent'] = parent_name
            meta['phase'] = parent_name or ''
            meta['summary'] = False

            if len(all_tasks) >= MAX_TASK_COUNT:
                raise ValueError(
                    f"Task count exceeds maximum of {MAX_TASK_COUNT}. "
                    f"Reduce tasks or set NOODLE_MAX_TASK_COUNT environment variable."
                )
            all_tasks.append(meta)
            return

        # This is a summary task with children
        is_summary = node.get('_is_summary', False)
        level = node.get('_level', parent_level + 1)

        # Process each child
        for key, value in node.items():
            if key.startswith('_'):
                continue

            # Check if child is a leaf or summary
            if isinstance(value, dict):
                if '_text' in value:
                    # Leaf task
                    if len(key) > MAX_TASK_NAME_LENGTH:
                        raise ValueError(
                            f"Task name '{key[:50]}...' exceeds maximum length of "
                            f"{MAX_TASK_NAME_LENGTH} characters. "
                            f"Set NOODLE_MAX_TASK_NAME_LENGTH environment variable to increase."
                        )
                    meta = extract_metadata(value['_text'], key)
                    meta['level'] = value.get('_level', level + 1)
                    meta['parent'] = parent_name
                    meta['phase'] = parent_name or ''
                    meta['summary'] = False
                    if len(all_tasks) >= MAX_TASK_COUNT:
                        raise ValueError(
                            f"Task count exceeds maximum of {MAX_TASK_COUNT}. "
                            f"Reduce tasks or set NOODLE_MAX_TASK_COUNT environment variable."
                        )
                    all_tasks.append(meta)
                elif '_is_summary' in value or any(isinstance(v, dict) for v in value.values()):
                    # Summary task with children
                    if len(key) > MAX_TASK_NAME_LENGTH:
                        raise ValueError(
                            f"Task name '{key[:50]}...' exceeds maximum length of "
                            f"{MAX_TASK_NAME_LENGTH} characters. "
                            f"Set NOODLE_MAX_TASK_NAME_LENGTH environment variable to increase."
                        )
                    # Extract resources from summary text if present
                    summary_resources = ''
                    summary_text = value.get('_summary_text', '')
                    if summary_text:
                        summary_meta_data = extract_metadata(summary_text, key)
                        summary_resources = summary_meta_data.get('resources', '')
                    summary_meta = {
                        'name': key,
                        'description': key,
                        'level': value.get('_level', level + 1),
                        'parent': parent_name,
                        'phase': parent_name or '',
                        'summary': True,
                        'resources': summary_resources,
                        'percent': 0,
                        'comment': ''
                    }
                    if len(all_tasks) >= MAX_TASK_COUNT:
                        raise ValueError(
                            f"Task count exceeds maximum of {MAX_TASK_COUNT}. "
                            f"Reduce tasks or set NOODLE_MAX_TASK_COUNT environment variable."
                        )
                    all_tasks.append(summary_meta)
                    # Recursively process children
                    traverse_nested_dict(value, parent_name=key, parent_level=value.get('_level', level + 1), depth=depth + 1)
                else:
                    # Single key-value that might be a simple dict
                    traverse_nested_dict(value, parent_name=key, parent_level=level + 1, depth=depth + 1)

    # Start traversal
    if isinstance(phases, list):
        traverse_nested_dict(phases)
    else:
        traverse_nested_dict(phases)

    # Schedule leaf tasks (non-summary tasks)
    # Use lowercase keys for case-insensitive task name lookup
    name_lookup = {t['name'].lower(): t for t in all_tasks if 'name' in t}

    # Prepare holiday sets
    if holidays is None:
        holidays = set()
    if resource_non_working_days is None:
        resource_non_working_days = {}

    for idx, t in enumerate(all_tasks):
        # Skip summary tasks - their dates will be calculated from children
        if t.get('summary'):
            continue

        # Build per-task holiday set: project-wide + assigned resource's non-working days
        task_holidays = set(holidays)
        task_resources = t.get('resources', '')
        if task_resources and resource_non_working_days:
            for res in task_resources.split(','):
                res_key = res.strip().lstrip('@').lower()
                if res_key in resource_non_working_days:
                    task_holidays |= resource_non_working_days[res_key]

        logger.debug("[SCHEDULE] Task %d: %s (sequential: %s, depends: %s, start: %s)", idx, t.get('name'), t.get('sequential'), t.get('depends'), t.get('start'))

        # Apply scheduling logic
        # Priority order: sequential > dependencies > explicit start > default parallel
        if t.get('sequential'):
            # Find previous non-summary task (skip summary tasks, work across parents)
            prev = None
            for j in range(idx - 1, -1, -1):
                if not all_tasks[j].get('summary'):
                    prev = all_tasks[j]
                    break

            logger.debug("[SEQ-LOGIC] Task '%s' looking for previous task. Found: %s, has finish: %s", t.get('name'), prev.get('name') if prev else 'None', 'finish' in prev if prev else 'N/A')

            duration = t.get('duration') if 'duration' in t else timedelta(days=1)
            is_milestone = isinstance(duration, timedelta) and duration.days == 0

            if prev and 'finish' in prev:
                # Record the resolved sequential dependency so the frontend
                # can draw dependency lines for '*' tasks.
                prev_name = prev.get('name', '')
                if prev_name:
                    if 'depends' not in t or not t['depends']:
                        t['depends'] = []
                    if prev_name not in t['depends']:
                        t['depends'].append(prev_name)

                if is_milestone:
                    # Milestones (0-duration) align with the end of the predecessor.
                    # Predecessor finish is exclusive (day after last working day),
                    # so use it directly so the milestone lines up with the task end.
                    t['start'] = prev['finish']
                    t['finish'] = prev['finish']
                else:
                    # Sequential tasks start the next working day after predecessor finishes
                    # Predecessor's finish date is exclusive (day after last working day)
                    # So we can use it directly as the start of the next working day
                    t['start'] = get_next_working_day(prev['finish'], task_holidays)
                logger.debug("[SEQ-LOGIC] Task '%s' scheduled after '%s' finish=%s, new start=%s", t.get('name'), prev.get('name'), prev['finish'], t['start'])
            else:
                t['start'] = get_next_working_day(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0), task_holidays)
                logger.debug("[SEQ-LOGIC] Task '%s' no predecessor, starting from today: %s", t.get('name'), t['start'])

            # Calculate finish date using working days (skip for milestones already set above)
            if not is_milestone or 'finish' not in t:
                if isinstance(duration, timedelta):
                    t['finish'] = add_working_days(t['start'], duration.days, task_holidays)
                else:
                    t['finish'] = t['start'] + timedelta(days=1)

        elif 'depends' in t and t['depends']:
            # Has dependencies (case-insensitive lookup)
            # Apply lag/lead time if specified
            lag_lead_map = t.get('lag_lead', {})

            dep_finishes_with_offset = []
            for dep_name in t['depends']:
                dep_name_lower = dep_name.lower()
                if dep_name_lower in name_lookup and 'finish' in name_lookup[dep_name_lower]:
                    dep_finish = name_lookup[dep_name_lower]['finish']

                    # Apply lag/lead time if specified for this dependency
                    if dep_name in lag_lead_map:
                        offset_str = lag_lead_map[dep_name]
                        offset_days = parse_duration_to_days(offset_str)
                        # Positive offset = lag (wait after), negative = lead (start before)
                        dep_finish = add_working_days(dep_finish, offset_days, task_holidays)

                    dep_finishes_with_offset.append(dep_finish)

            duration = t.get('duration') if 'duration' in t else timedelta(days=1)
            is_milestone = isinstance(duration, timedelta) and duration.days == 0

            if dep_finishes_with_offset:
                latest_dep_finish = max(dep_finishes_with_offset)
                if is_milestone:
                    # Milestones (0-duration) align with the end of the dependency.
                    # Dependency finish is exclusive (day after last working day),
                    # so use it directly so the milestone lines up with the task end.
                    dep_start = latest_dep_finish
                else:
                    # Regular tasks start the next working day after dependency finishes
                    # Dependency finish dates are exclusive (day after last working day)
                    dep_start = get_next_working_day(latest_dep_finish, task_holidays)

                # If the task also has an explicit start date, use the later of
                # the two -- the explicit date acts as a "not before" constraint.
                explicit_start = t.get('start')
                if explicit_start and explicit_start > dep_start:
                    t['start'] = explicit_start
                else:
                    t['start'] = dep_start

                if is_milestone:
                    t['finish'] = t['start']
            else:
                if 'start' in t and t['start']:
                    pass  # Keep the explicit start date
                else:
                    t['start'] = get_next_working_day(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0), task_holidays)

            # Calculate finish date using working days (skip for milestones already set above)
            if not is_milestone or 'finish' not in t:
                if isinstance(duration, timedelta):
                    t['finish'] = add_working_days(t['start'], duration.days, task_holidays)
                else:
                    t['finish'] = t['start'] + timedelta(days=1)

        elif 'start' in t:
            # Has explicit start date (manual scheduling)
            # Use the explicit start date provided
            duration = t.get('duration') if 'duration' in t else timedelta(days=1)
            # Calculate finish date using working days
            if isinstance(duration, timedelta):
                t['finish'] = add_working_days(t['start'], duration.days, task_holidays)
            else:
                t['finish'] = t['start'] + timedelta(days=1)

        else:
            # Default: start in parallel (at parent's start or now)
            # Look for parent task or first sibling to determine start
            parent_name = t.get('parent')
            if parent_name:
                # Find first sibling (non-summary task with same parent)
                first_sibling = None
                for j in range(len(all_tasks)):
                    if (all_tasks[j].get('parent') == parent_name and
                        not all_tasks[j].get('summary') and
                        'start' in all_tasks[j]):
                        first_sibling = all_tasks[j]
                        break

                if first_sibling:
                    t['start'] = first_sibling['start']
                else:
                    t['start'] = get_next_working_day(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0), task_holidays)
            else:
                t['start'] = get_next_working_day(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0), task_holidays)

            duration = t.get('duration') if 'duration' in t else timedelta(days=1)
            # Calculate finish date using working days
            if isinstance(duration, timedelta):
                t['finish'] = add_working_days(t['start'], duration.days, task_holidays)
            else:
                t['finish'] = t['start'] + timedelta(days=1)

        # Ensure duration is set (but allow 0 duration for milestones)
        if 'duration' not in t or t['duration'] is None:
            t['duration'] = timedelta(days=1)

    # Calculate summary task dates from children
    def calculate_summary_dates(task_name):
        """Calculate start/finish for a summary task from its children."""
        children = [t for t in all_tasks if t.get('parent') == task_name]
        if not children:
            return

        # Recursively calculate for any summary children first
        for child in children:
            if child.get('summary'):
                calculate_summary_dates(child['name'])

        # Get the summary task
        summary_task = next((t for t in all_tasks if t.get('name') == task_name and t.get('summary')), None)
        if not summary_task:
            return

        # Calculate from children's dates
        starts = [c['start'] for c in children if 'start' in c]
        finishes = [c['finish'] for c in children if 'finish' in c]

        if starts and finishes:
            summary_task['start'] = min(starts)
            summary_task['finish'] = max(finishes)
            summary_task['duration'] = summary_task['finish'] - summary_task['start']

            # Calculate average percent complete
            percents = [c.get('percent', 0) for c in children]
            if percents:
                summary_task['percent'] = int(sum(percents) / len(percents))

    # Calculate dates for all summary tasks
    for t in all_tasks:
        if t.get('summary'):
            calculate_summary_dates(t['name'])

    # Re-order tasks so summary tasks appear immediately before their children
    def build_ordered_list():
        """Build properly ordered list with summary tasks before children."""
        ordered = []
        processed = set()

        def add_task_and_children(task):
            """Recursively add task and its children in order."""
            # Ensure task has a name
            if 'name' not in task:
                return
            if task['name'] in processed:
                return
            processed.add(task['name'])

            # Add the task itself
            ordered.append(task)

            # If it's a summary task, add its children
            if task.get('summary'):
                children = [t for t in all_tasks if t.get('parent') == task['name']]
                # Sort children to maintain original order
                for child in children:
                    add_task_and_children(child)

        # Start with top-level tasks (no parent)
        top_level = [t for t in all_tasks if not t.get('parent')]
        for task in top_level:
            add_task_and_children(task)

        return ordered

    ordered_tasks = build_ordered_list()

    # Inherit resources from summary tasks to unassigned children
    inherit_summary_resources(ordered_tasks)

    # Check for dependency loops and add warnings to affected tasks
    loop_analysis = detect_dependency_loops(ordered_tasks)
    if loop_analysis['has_loops']:
        logger.warning(f"Circular dependencies detected: {', '.join(loop_analysis['loops'])}")
        for task in ordered_tasks:
            task_name = task.get('name', '').lower()
            if task_name in loop_analysis['affected_tasks']:
                task['loop_warning'] = loop_analysis['task_warnings'].get(
                    task.get('name', task_name),
                    "Circular dependency detected"
                )

    return ordered_tasks

# --- Gantt chart rendering ---
def render_gantt_chart(tasks, start_date, finish_date, terminal_width=80):
    chart = "# Gantt Chart\n\n"
    total_days = (finish_date - start_date).days or 1
    # Determine max ID width - use numeric IDs
    max_id_width = max(len(str(len(tasks))), 2)

    # Determine max task name width - use full length of longest task name
    max_name_width = max([len(t.get('description', '')) for t in tasks] + [20])

    # Calculate available width for the chart portion
    # Format: "ID  Task Name |chart|"
    # Components: max_id_width + 2 spaces + max_name_width + " |" + chart + "|"
    overhead = max_id_width + 2 + max_name_width + 3  # ID + spaces + name + " |" + "|"
    chart_width = max(20, terminal_width - overhead)  # Ensure minimum chart width of 20

    # If task names are too long, truncate them
    available_for_name = terminal_width - max_id_width - 2 - 3 - 20  # Leave at least 20 for chart
    if max_name_width > available_for_name and available_for_name > 10:
        max_name_width = available_for_name

    # Date heading row with smart spacing
    # Try to show all dates, then every other date, then week starts
    def try_place_dates(chart_width, start_date, finish_date, total_days, interval_days):
        """Try to place dates at given interval without overlapping"""
        date_row = [' '] * chart_width
        current = start_date
        placed_dates = []

        while current <= finish_date:
            pos = int((current - start_date).days / total_days * (chart_width-1))
            # Use format "DD mmm " (e.g., "13 nov ") for display
            date_str = current.strftime('%d %b ').lower()

            # Check if we have enough space (7 chars for "DD mmm ")
            if pos + len(date_str) <= chart_width:
                # Check if this overlaps with previously placed dates
                overlaps = False
                for prev_pos, prev_len in placed_dates:
                    if pos < prev_pos + prev_len and pos + len(date_str) > prev_pos:
                        overlaps = True
                        break

                if not overlaps:
                    # Place the date
                    for i, c in enumerate(date_str):
                        if pos + i < chart_width:
                            date_row[pos + i] = c
                    placed_dates.append((pos, len(date_str)))

            current += timedelta(days=interval_days)

        # Return True if we placed at least some dates
        return date_row, len(placed_dates) > 0

    # Try daily, then every other day, then weekly
    date_row = None
    for interval in [1, 2, 7]:
        date_row, success = try_place_dates(chart_width, start_date, finish_date, total_days, interval)
        if success:
            break

    if date_row is None:
        date_row = [' '] * chart_width

    chart += f"{'ID':<{max_id_width}}  {'Task Name':<{max_name_width}} |" + ''.join(date_row) + '|\n'
    chart += '-' * (max_id_width + 2 + max_name_width + 1 + chart_width + 2) + '\n'  # Adjust horizontal line
    for idx, t in enumerate(tasks, start=1):
        # Skip tasks without start or finish dates
        if 'start' not in t or 'finish' not in t:
            continue
        bar_start = int((t['start'] - start_date).days / total_days * (chart_width-1))
        bar_end = int((t['finish'] - start_date).days / total_days * (chart_width-1))
        line = [' '] * chart_width
        percent = t.get('percent', 0)

        # Calculate indentation based on level (0=no indent, 1=4 spaces, 2=8 spaces, etc.)
        level = t.get('level', 0)
        indent = '    ' * (level - 1) if level > 0 else ''

        # Check if this is a milestone (0 duration)
        duration = t.get('duration', timedelta(days=1))
        is_milestone = isinstance(duration, timedelta) and duration.days == 0

        if is_milestone:
            # Milestone: display diamond marker (ASCII output)
            if bar_start < chart_width:
                line[bar_start] = '◆'
        elif t.get('summary'):
            # Summary task: use [ and ] for boundaries, show progress
            if bar_start < chart_width:
                line[bar_start] = '['
            if bar_end < chart_width:
                line[bar_end] = ']'
            # Calculate progress: use < instead of <= to handle 0% correctly
            progress_end = bar_start + int((bar_end - bar_start + 1) * percent / 100)
            for i in range(bar_start + 1, bar_end):
                if i < progress_end:
                    line[i] = '═'  # U+2550 - Box drawing double horizontal
                else:
                    line[i] = '─'  # U+2500 - Box drawing light horizontal
        else:
            # Regular task: show progress with '=' and '-' based on percent
            # Calculate progress: use < instead of <= to handle 0% correctly
            progress_end = bar_start + int((bar_end - bar_start + 1) * percent / 100)
            for i in range(bar_start, bar_end+1):
                if i < chart_width:
                    if i < progress_end:
                        line[i] = '═'  # U+2550 - Box drawing double horizontal
                    else:
                        line[i] = '─'  # U+2500 - Box drawing light horizontal
        # Use numeric ID
        task_id = str(idx)
        label = f"{indent}{t.get('description','')}"

        # Make summary tasks stand out visually
        if t.get('summary'):
            # Use uppercase for summary task labels
            label = label.upper()

        # Truncate label if too long
        if len(label) > max_name_width:
            label = label[:max_name_width-1] + '.'

        line_str = ''.join(line)
        chart += f"{task_id:<{max_id_width}}  {label:<{max_name_width}} |{line_str}|\n"
    return chart

def render_resource_sheet(tasks, start_date, finish_date, holidays=None, terminal_width=80, resource_map=None):
    """
    Render a resource allocation sheet showing workload per resource over time.
    Non-working days (weekends and holidays) are marked with ░ character.

    Args:
        tasks: List of tasks
        start_date: Project start date
        finish_date: Project finish date
        holidays: Set of holiday dates
        terminal_width: Width of terminal for formatting
        resource_map: Dict mapping short names to full names (e.g., {'kev': 'Kevin McAleer'})
    """
    if holidays is None:
        holidays = set()
    if resource_map is None:
        resource_map = {}

    sheet = "# Resource Sheet\n\n"

    # Extract all resources from tasks
    resource_workload = {}  # {resource_name_lower: [(start_date, finish_date, duration_days)]}
    resource_hours = {}  # {resource_name_lower: total_hours}
    resource_display_names = {}  # {resource_name_lower: original_case_name}

    for t in tasks:
        resources = t.get('resources', '')
        if not resources or t.get('summary'):  # Skip summary tasks
            continue

        # Parse resources (can be comma-separated)
        resource_list = [r.strip().lstrip('@') for r in resources.split(',') if r.strip()]

        task_start = t.get('start')
        task_finish = t.get('finish')
        duration = t.get('duration', timedelta(days=1))

        if task_start and task_finish:
            # Calculate hours based on task duration (8 hours per day)
            # Use the duration from the task, which is the planned duration
            if isinstance(duration, timedelta):
                task_hours = duration.days * 8
            else:
                # If duration is not set, calculate from dates
                task_hours = (task_finish - task_start).days * 8

            for resource in resource_list:
                # Normalize to lowercase for case-insensitive comparison
                resource_key = resource.lower()
                # Keep first occurrence's case for display
                if resource_key not in resource_display_names:
                    resource_display_names[resource_key] = resource
                if resource_key not in resource_workload:
                    resource_workload[resource_key] = []
                    resource_hours[resource_key] = 0
                resource_workload[resource_key].append((task_start, task_finish, duration.days))
                resource_hours[resource_key] += task_hours

    if not resource_workload:
        return ""  # No resources to display

    # Calculate appropriate time scale based on project duration and terminal width
    total_days = (finish_date - start_date).days or 1
    # Calculate max width considering both display names and full names from resource_map
    max_name_width = max([len(resource_map.get(key, resource_display_names.get(key, key))) for key in resource_workload.keys()] + [8])
    hours_width = 5  # Width for hours column (e.g., "999h")
    overhead = max_name_width + hours_width + 5  # Name + Hours + " | " + " |" + "|"
    chart_width = max(20, terminal_width - overhead)

    # Determine time scale: day, week, month, or quarter
    if total_days <= chart_width:
        scale = 'day'
        num_periods = total_days
    elif total_days <= chart_width * 7:
        scale = 'week'
        num_periods = (total_days + 6) // 7
    elif total_days <= chart_width * 30:
        scale = 'month'
        num_periods = (total_days + 29) // 30
    else:
        scale = 'quarter'
        num_periods = (total_days + 89) // 90

    chart_width = min(chart_width, num_periods)

    # Build time period headers
    header_row = [' '] * chart_width
    current = start_date

    if scale == 'day':
        # For daily scale, show date numbers at appropriate intervals
        # Build a list of positions where we want to place dates
        date_positions = []
        for i in range(chart_width):
            day = start_date + timedelta(days=i)
            # Show dates at: start, first of month, or every week
            if i == 0 or day.day == 1 or (day.weekday() == 0 and i > 0):
                date_positions.append(i)

        # Place dates with minimum spacing to avoid overlap
        last_end = -7  # Track where last date ended (7 chars for "DD mmm ")
        for pos in date_positions:
            day = start_date + timedelta(days=pos)
            date_str = day.strftime('%d %b ').lower()  # e.g., "13 nov "
            # Only place if it doesn't overlap with previous date (need at least 1 space)
            if pos > last_end:
                for j, c in enumerate(date_str):
                    if pos + j < chart_width:
                        header_row[pos + j] = c
                last_end = pos + len(date_str) - 1
    else:
        # For week/month/quarter scale
        for i in range(chart_width):
            if scale == 'week':
                date_str = current.strftime('%d %b ').lower()  # e.g., "13 nov "
                period_days = 7
            elif scale == 'month':
                date_str = current.strftime('%b')
                period_days = 30
            else:  # quarter
                quarter = (current.month - 1) // 3 + 1
                date_str = f"Q{quarter}"
                period_days = 90

            for j, c in enumerate(date_str):
                if i + j < chart_width:
                    header_row[i + j] = c

            current += timedelta(days=period_days)

    sheet += f"{'Resource':<{max_name_width}} | {'Hours':>{hours_width}} |" + ''.join(header_row) + "|\n"
    sheet += '-' * (max_name_width + 1 + hours_width + 2 + chart_width + 2) + '\n'

    # Render each resource's allocation
    for resource_name in sorted(resource_workload.keys()):
        line = [' '] * chart_width
        allocations = resource_workload[resource_name]

        # Fill in working days
        for task_start, task_finish, duration_days in allocations:
            if scale == 'day':
                # Iterate through all calendar days from start to finish
                current_day = task_start
                while current_day < task_finish:
                    if current_day > finish_date:
                        break
                    pos = (current_day - start_date).days
                    if 0 <= pos < chart_width:
                        # Check if it's a working day
                        is_weekend = current_day.weekday() >= 5
                        is_holiday = current_day in holidays

                        if is_weekend or is_holiday:
                            line[pos] = '░'  # Non-working day
                        else:
                            line[pos] = '█'  # Working day
                    current_day += timedelta(days=1)
            else:
                # For week/month/quarter scale, show allocation as blocks
                start_period = int((task_start - start_date).days * chart_width / total_days)
                end_period = int((task_finish - start_date).days * chart_width / total_days)

                for pos in range(start_period, min(end_period + 1, chart_width)):
                    if line[pos] == ' ':
                        line[pos] = '█'

        # For daily scale, mark non-working days that aren't already marked
        if scale == 'day':
            for pos in range(chart_width):
                day = start_date + timedelta(days=pos)
                if line[pos] == ' ':
                    is_weekend = day.weekday() >= 5
                    is_holiday = day in holidays
                    if is_weekend or is_holiday:
                        line[pos] = '░'

        line_str = ''.join(line)
        hours = resource_hours.get(resource_name, 0)
        # First get the display name from task resources, then check resource_map for full name
        display_name = resource_display_names.get(resource_name, resource_name)
        # Use full name from resource_map if available (case-insensitive lookup)
        display_name = resource_map.get(resource_name, display_name)
        sheet += f"{display_name:<{max_name_width}} | {hours:>{hours_width-1}}h |{line_str}|\n"

    return sheet

def render_custom_timeline(phases, milestones, start_date, finish_date, timeline_width=80):
    # Timeline line using box drawing character
    timeline = ['─'] * timeline_width  # U+2500 - Box drawing light horizontal
    milestone_positions = []
    milestone_data = []
    all_items = []
    # Add start milestone
    all_items.append({'type': 'milestone', 'name': 'Start', 'date': start_date})
    # Add phases
    for phase in phases:
        all_items.append({'type': 'phase', 'name': phase['name'], 'date': phase['start']})
    # Add milestones
    for milestone in milestones:
        all_items.append({
            'type': 'milestone',
            'name': milestone['name'],
            'date': milestone['date'],
            'percent': milestone.get('percent', 0)  # Include percent for rendering
        })
    # Add finish milestone
    all_items.append({'type': 'milestone', 'name': 'Finish', 'date': finish_date})
    # Sort by date
    all_items.sort(key=lambda x: x['date'])

    # Process milestones and calculate positions
    # Handle case where start_date equals finish_date (single day plan)
    duration_days = (finish_date - start_date).days
    if duration_days == 0:
        duration_days = 1  # Treat as single day, all items at same position

    for item in all_items:
        pos = int((item['date'] - start_date).days / duration_days * (timeline_width - 1))
        if item['type'] == 'milestone':
            # Use diamond for milestones in ASCII timeline
            symbol = '◆'
            timeline[pos] = symbol
            milestone_positions.append(pos)

            # Format date string
            if item['date'].year == start_date.year and item['date'].year == finish_date.year:
                date_str = item['date'].strftime('%-d %b')
            else:
                date_str = item['date'].strftime('%-d %b %Y')

            milestone_data.append({
                'name': item['name'],
                'pos': pos,
                'date': date_str
            })

    # Create title lines above the timeline (right-aligned, with text wrapping to avoid overlap)
    # Exclude Start and Finish as they're shown in the header
    # Strategy: Reserve vertical columns above milestones based on longest word width
    # This prevents overlapping when titles wrap across multiple lines

    max_lines = 10  # Maximum number of lines above timeline
    lines = [[' '] * timeline_width for _ in range(max_lines)]

    # First pass: identify which titles need wrapping and reserve columns
    titles_to_place = []
    reserved_columns = []  # List of (start, end) tuples representing reserved vertical columns

    for m in milestone_data:
        title = m['name']
        pos = m['pos']
        if title not in ('Start', 'Finish'):
            titles_to_place.append({'title': title, 'pos': pos, 'start': max(0, pos - len(title) + 1), 'end': pos})

    # Sort by position to process left to right
    titles_to_place.sort(key=lambda x: x['pos'])

    # Determine which titles need wrapping and reserve their columns
    for item in titles_to_place:
        title = item['title']
        pos = item['pos']
        start_pos = item['start']
        end_pos = item['end']

        # Check if full title would fit on one line without overlapping reserved columns
        overlaps = False
        buffer = 2  # Minimum space between columns
        for col_start, col_end in reserved_columns:
            # Check if this title would overlap with a reserved column (with buffer)
            if not (end_pos + buffer < col_start or start_pos > col_end + buffer):
                overlaps = True
                break

        # Also check if title would be significantly truncated at the left edge
        title_length = len(title)
        available_space = end_pos - start_pos + 1
        if available_space < title_length * 0.7:
            overlaps = True

        # If title needs wrapping, reserve a column based on its longest word
        if overlaps:
            words = title.split()
            longest_word = max(words, key=len) if words else title
            longest_word_len = len(longest_word)

            # Calculate ideal column reservation
            ideal_col_start = max(0, pos - longest_word_len + 1)
            ideal_col_end = pos

            # Check if this ideal column would overlap with existing reservations
            # If so, truncate the column start to avoid overlap
            actual_col_start = ideal_col_start
            for col_start, col_end in reserved_columns:
                # If our ideal column would overlap, adjust start position
                if not (ideal_col_end + buffer < col_start or ideal_col_start > col_end + buffer):
                    # Move our column start to after the existing column (with buffer)
                    actual_col_start = max(actual_col_start, col_end + buffer + 1)

            # Clamp to not exceed the milestone position
            actual_col_start = min(actual_col_start, pos)

            reserved_columns.append((actual_col_start, pos))
            item['needs_wrap'] = True
            item['column'] = (actual_col_start, pos)
        else:
            item['needs_wrap'] = False
            # Reserve the space this title will use on line 0
            reserved_columns.append((start_pos, end_pos))

    # Second pass: place the titles
    # Track what's been placed on each line to enforce spacing
    line_usage = [[] for _ in range(max_lines)]  # List of (start, end) for each line

    for item in titles_to_place:
        title = item['title']
        pos = item['pos']

        if not item['needs_wrap']:
            # Place full title on line 0
            start_pos = item['start']
            for i, c in enumerate(title):
                char_pos = start_pos + i
                if 0 <= char_pos <= pos and char_pos < timeline_width:
                    lines[0][char_pos] = c
            line_usage[0].append((start_pos, pos))
        else:
            # Wrap title across multiple lines within its reserved column
            words = title.split()
            col_start, col_end = item['column']
            col_width = col_end - col_start + 1

            # Place words vertically, bottom to top
            for word_idx, word in enumerate(reversed(words)):
                line_idx = word_idx

                # Try to find a line where this word fits with spacing
                placed = False
                while line_idx < max_lines and not placed:
                    # Truncate word if it's too long for the column
                    display_word = word
                    if len(word) > col_width:
                        # If column is too narrow (less than 3 chars), skip this word
                        if col_width < 3:
                            break
                        # Truncate and add period
                        display_word = word[:max(3, col_width - 1)] + '.'

                    # Right-align word within the reserved column (ending at pos)
                    word_len = len(display_word)
                    word_start = max(col_start, pos - word_len + 1)
                    word_end = word_start + word_len - 1

                    # Check if this word would conflict with other words on this line (need 1 space buffer)
                    conflicts = False
                    for used_start, used_end in line_usage[line_idx]:
                        if not (word_end + 1 < used_start or word_start > used_end + 1):
                            conflicts = True
                            break

                    if not conflicts:
                        # Place the word on this line
                        for i, c in enumerate(display_word):
                            char_pos = word_start + i
                            if col_start <= char_pos <= pos and char_pos < timeline_width:
                                lines[line_idx][char_pos] = c
                        line_usage[line_idx].append((word_start, word_end))
                        placed = True
                    else:
                        # Try the next line up
                        line_idx += 1

                if not placed and line_idx >= max_lines:
                    # Ran out of lines, skip this word
                    pass

    # Convert lines to strings, only include non-empty lines
    title_lines = []
    for line in lines:
        line_str = ''.join(line)
        if line_str.strip():
            title_lines.append(line_str)

    # Remove trailing empty lines
    while title_lines and not title_lines[-1].strip():
        title_lines.pop()

    # Create date line below the timeline (right-aligned, exclude Start and Finish)
    # Check for overlaps and only place non-overlapping dates
    date_line = [' '] * timeline_width
    date_used_ranges = []

    for m in milestone_data:
        # Skip Start and Finish - they're in the header
        if m['name'] in ('Start', 'Finish'):
            continue

        date_str = m['date']
        pos = m['pos']
        # Right-align date to end at position
        start_pos = max(0, pos - len(date_str) + 1)
        end_pos = pos

        # Check if this date would overlap with previous dates (with 1 space buffer)
        overlaps = False
        for used_start, used_end in date_used_ranges:
            if not (end_pos + 1 < used_start or start_pos > used_end + 1):
                overlaps = True
                break

        # Only place if no overlap
        if not overlaps:
            for i, c in enumerate(date_str):
                char_pos = start_pos + i
                if 0 <= char_pos < timeline_width:
                    date_line[char_pos] = c
            date_used_ranges.append((start_pos, end_pos))

    # Prepare return values for compatibility
    milestone_labels = title_lines
    milestone_full_dates = [m['date'] for m in milestone_data]

    return ''.join(timeline), milestone_labels, ''.join(date_line), milestone_full_dates, milestone_positions

def render_timeline(phases, milestones, start_date, finish_date, timeline_width=80):
    # Calculate timeline positions
    timeline = [' '] * timeline_width
    label_line = [' '] * timeline_width
    date_line = [' '] * timeline_width
    date_titles = [' '] * timeline_width
    all_items = []
    # Add start milestone
    all_items.append({'type': 'milestone', 'name': 'Start', 'date': start_date})
    # Add phases
    for phase in phases:
        all_items.append({'type': 'phase', 'name': phase['name'], 'date': phase['start']})
    # Add milestones
    for milestone in milestones:
        all_items.append({
            'type': 'milestone',
            'name': milestone['name'],
            'date': milestone['date'],
            'percent': milestone.get('percent', 0)  # Include percent for rendering
        })
    # Add finish milestone
    all_items.append({'type': 'milestone', 'name': 'Finish', 'date': finish_date})
    # Sort by date
    all_items.sort(key=lambda x: x['date'])
    # Timeline line
    # Place symbols, labels, and dates
    for item in all_items:
        pos = int((item['date'] - start_date).days / (finish_date - start_date).days * (timeline_width - 1))
        if item['type'] == 'milestone':
            # Use diamond for milestones in ASCII timeline
            symbol = '◆'
        else:
            symbol = '■'
        timeline[pos] = symbol
        # Place label
        label = item['name']
        for i, c in enumerate(label):
            if pos + i < timeline_width:
                label_line[pos + i] = c
        # Place date (simplified if same year)
        if item['date'].year == start_date.year and item['date'].year == finish_date.year:
            date_str = item['date'].strftime('%-d %b')
        else:
            date_str = item['date'].strftime('%-d %b %Y')
        for i, c in enumerate(date_str):
            if pos + i < timeline_width:
                date_line[pos + i] = c
        # Place title above date
        title = 'Date'
        for i, c in enumerate(title):
            if pos + i < timeline_width:
                date_titles[pos + i] = c
    symbol_line = ''.join(timeline)
    timeline_line = '-' * timeline_width
    # Build timeline output
    timeline_output = (
        f"{timeline_line}\n"
        f"{symbol_line}\n"
        f"{''.join(label_line)}\n"
        f"{''.join(date_titles)}\n"
        f"{''.join(date_line)}\n"
    )
    return timeline_output

def natural_language_to_yaml(text, project_name="Project"):
    """Convert natural language task text to hierarchical structure.

    Supports arbitrary nesting levels via indentation.
    A task without details and with indented tasks below it is a summary task.
    """
    lines = text.split('\n')

    # Build tree structure using a stack
    root = {'children': [], 'indent': -1, 'text': '', 'name': project_name, 'level': 0}
    stack = [root]

    for line in lines:
        if not line.strip():
            continue

        indent_level = len(line) - len(line.lstrip())
        stripped = line.strip()

        # Check if has task details
        has_duration = re.search(r'\b\d+[dwmy]\b', stripped) is not None
        has_quotes = '"' in stripped or "'" in stripped
        has_details = '@' in stripped or '%' in stripped or '!' in stripped or '#' in stripped or '2025-' in stripped or '2024-' in stripped or '2026-' in stripped or has_duration or has_quotes

        # Extract task name (everything before metadata)
        if has_details:
            # Find where metadata starts
            metadata_start = len(stripped)
            for char in ['@', '#', '!']:
                pos = stripped.find(char)
                if pos > 0:
                    metadata_start = min(metadata_start, pos)

            # Check for percent token (digits followed by %) - use start of digits, not %
            percent_match = re.search(r'\b(\d{1,3})%', stripped)
            if percent_match and percent_match.start() > 0:
                metadata_start = min(metadata_start, percent_match.start())

            # Also check for dates and durations
            date_match = re.search(r'\d{4}-\d{2}-\d{2}', stripped)
            if date_match and date_match.start() > 0:
                metadata_start = min(metadata_start, date_match.start())

            duration_match = re.search(r'\d+[dwmy]', stripped)
            if duration_match and duration_match.start() > 0:
                metadata_start = min(metadata_start, duration_match.start())

            task_name = stripped[:metadata_start].strip().lstrip('*')
            # Safety: strip any percent tokens that slipped into the name
            task_name = re.sub(r'\s*\b\d{1,3}%', '', task_name).strip()
        else:
            # No metadata, entire line is the task name
            task_name = stripped.lstrip('*')

        full_name = task_name

        # Create node
        node = {
            'indent': indent_level,
            'text': stripped,  # Keep original text with * marker
            'name': task_name,  # Task name without *
            'full_name': full_name,
            'has_details': has_details,
            'children': [],
            'level': 0
        }

        logger.debug(f"Parsed line: '{line}' -> name: '{task_name}', text: '{stripped}', has *: {stripped.startswith('*')}")

        # Find parent (pop stack until we find item with lower indent)
        while len(stack) > 1 and stack[-1]['indent'] >= indent_level:
            stack.pop()

        parent = stack[-1]
        max_nesting_depth = 20
        node['level'] = min(parent['level'] + 1, max_nesting_depth)
        parent['children'].append(node)
        stack.append(node)

    # Convert tree to nested dict structure
    def tree_to_nested_dict(node):
        """Recursively convert tree to nested dicts."""
        if not node['children']:
            # Leaf node - return text with level marker
            return {'_text': node['text'], '_level': node['level']}

        # Has children - create nested dict
        result = {}
        for child in node['children']:
            child_result = tree_to_nested_dict(child)
            if '_text' in child_result:
                # Leaf task
                result[child['name']] = child_result
            else:
                # Summary task with children
                result[child['full_name']] = child_result

        # Mark as summary with level
        result['_level'] = node['level']
        result['_is_summary'] = True
        # Preserve summary task text for resource extraction
        if node.get('has_details') and node.get('text'):
            result['_summary_text'] = node['text']
        return result

    result_dict = tree_to_nested_dict(root)
    # Remove root markers
    if '_level' in result_dict:
        del result_dict['_level']
    if '_is_summary' in result_dict:
        del result_dict['_is_summary']

    return {project_name: [result_dict] if result_dict else []}

def calculate_resource_allocation(tasks, start_date, finish_date):
    """Calculate daily resource allocation in hours per day.

    Returns a dict with:
    - resources: list of resource names (display names)
    - days: list of dates from start to finish
    - allocation: dict[resource][date] = hours
    """
    from collections import defaultdict

    # Collect all resources (case-insensitive)
    resources_lower = set()
    resource_display_names = {}
    for t in tasks:
        res = t.get('resources', '')
        if res:
            for r in res.split(','):
                r_stripped = r.strip()
                r_key = r_stripped.lower()
                resources_lower.add(r_key)
                # Keep first occurrence's case for display
                if r_key not in resource_display_names:
                    resource_display_names[r_key] = r_stripped

    resources = sorted([resource_display_names[r] for r in resources_lower])

    # Generate all days from start to finish
    days = []
    current = start_date
    while current <= finish_date:
        days.append(current)
        current += timedelta(days=1)

    # Calculate allocation for each resource on each day
    allocation = defaultdict(lambda: defaultdict(float))

    for t in tasks:
        # Skip summary tasks - their children carry the resource allocations
        if t.get('summary'):
            continue

        task_start = t.get('start')
        task_finish = t.get('finish')
        if not task_start or not task_finish:
            continue

        # Get resources for this task
        res = t.get('resources', '')
        if not res:
            continue

        task_resources = [r.strip() for r in res.split(',')]
        if not task_resources:
            continue

        # Calculate working days for this task (exclude weekends)
        task_days = []
        current = task_start
        while current < task_finish:
            # 0 = Monday, 6 = Sunday
            if current.weekday() < 5:  # Monday-Friday
                task_days.append(current)
            current += timedelta(days=1)

        if not task_days:
            task_days = [task_start]

        # Assume 8 hours per working day, split among resources
        hours_per_day = 8.0 / len(task_resources)

        for resource in task_resources:
            # Use display name for allocation key
            resource_key = resource.lower()
            display_name = resource_display_names.get(resource_key, resource)
            for day in task_days:
                allocation[display_name][day] += hours_per_day

    return {
        'resources': resources,
        'days': days,
        'allocation': allocation
    }

def calculate_rag_status(task, current_date=None):
    """Calculate RAG status for a task with descriptive text.

    Args:
        task: Task dictionary with start, finish, percent, duration
        current_date: Current date for comparison (defaults to today)

    Returns:
        String: 'Complete', 'Not Started', 'Ahead of Schedule', 'On Track',
                'Behind Schedule', or 'Task Overdue'
    """
    if current_date is None:
        current_date = datetime.now().date()
    else:
        current_date = current_date.date() if hasattr(current_date, 'date') else current_date

    # Get task details
    start_date = task.get('start')
    finish_date = task.get('finish')
    percent_complete = task.get('percent')

    # Blue: Task is 100% complete (check first, regardless of dates)
    if percent_complete == 100:
        return 'Complete'

    if not start_date or not finish_date:
        # Fallback when dates are missing: use percentage thresholds
        if percent_complete is None or percent_complete == 0:
            return 'Task Overdue'
        elif percent_complete < 50:
            return 'Task Overdue'
        elif percent_complete < 80:
            return 'Behind Schedule'
        else:
            return 'On Track'

    # Convert to date objects
    start_date = start_date.date() if hasattr(start_date, 'date') else start_date
    finish_date = finish_date.date() if hasattr(finish_date, 'date') else finish_date

    # Green: Task hasn't started yet (start date is in the future)
    if start_date > current_date:
        if percent_complete is not None and percent_complete > 0:
            return 'Ahead of Schedule'
        return 'Not Started'

    # Red: Start date is in the past and no progress or 0%
    if start_date <= current_date and (percent_complete is None or percent_complete == 0):
        return 'Task Overdue'

    # Calculate expected progress
    total_duration = (finish_date - start_date).days
    if total_duration <= 0:
        total_duration = 1  # Avoid division by zero

    elapsed_days = (current_date - start_date).days
    if elapsed_days < 0:
        elapsed_days = 0

    expected_percent = min(100, (elapsed_days / total_duration) * 100)

    # Amber: Actual progress is less than expected
    if percent_complete < expected_percent:
        return 'Behind Schedule'

    # Green: On track or ahead
    return 'On Track'


def rag_status_to_colour(rag_status):
    """Map a descriptive RAG status to its colour category.

    Args:
        rag_status: Descriptive status string from calculate_rag_status

    Returns:
        String: 'green', 'amber', 'red', 'blue', or 'grey'
    """
    mapping = {
        'not started': 'green',
        'on track': 'green',
        'ahead of schedule': 'green',
        'complete': 'blue',
        'behind schedule': 'amber',
        'task overdue': 'red',
        # Legacy values for backwards compatibility
        'green': 'green',
        'amber': 'amber',
        'red': 'red',
    }
    return mapping.get((rag_status or '').lower(), 'grey')

def _parse_non_working_suffix(suffix_str):
    """Parse a non-working [...] suffix into a set of datetime.date objects.

    Supports multiple formats:
    - Individual dates: ``2026-12-31``
    - Date ranges: ``2026-03-01:2026-04-01``
    - Named entries: ``Annual Leave: 2026-03-01:2026-03-14``
    - Named single dates: ``Doctor: 2026-04-01``

    Named entries have the format ``Name: date`` or ``Name: date:date``.
    The name is for display only; only dates are extracted.

    Args:
        suffix_str: The content inside the brackets,
            e.g. "Annual Leave: 2026-03-01:2026-03-14, Doctor: 2026-04-01"

    Returns:
        A set of datetime.date objects.
    """
    from datetime import datetime as _dt, timedelta as _td

    dates = set()
    if not suffix_str:
        return dates

    for part in suffix_str.split(','):
        part = part.strip()
        if not part:
            continue

        # Check for named entry: "Name: date" or "Name: date:date"
        named_match = re.match(
            r'([^:]+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$',
            part
        )
        if named_match:
            # Named entry — the first group may be a name or a date
            # If group(1) looks like a date, treat as range (legacy format)
            if re.match(r'\d{4}-\d{2}-\d{2}$', named_match.group(1).strip()):
                # Legacy range format: "2026-03-01:2026-03-14"
                try:
                    start = _dt.strptime(named_match.group(1).strip(), '%Y-%m-%d').date()
                    end = _dt.strptime(named_match.group(2), '%Y-%m-%d').date()
                    current = start
                    while current <= end:
                        dates.add(current)
                        current += _td(days=1)
                except ValueError:
                    logger.warning("Invalid date range in non-working suffix: %s", part)
            else:
                # Named entry: "Name: start_date" or "Name: start_date:end_date"
                try:
                    start = _dt.strptime(named_match.group(2), '%Y-%m-%d').date()
                    if named_match.group(3):
                        end = _dt.strptime(named_match.group(3), '%Y-%m-%d').date()
                        current = start
                        while current <= end:
                            dates.add(current)
                            current += _td(days=1)
                    else:
                        dates.add(start)
                except ValueError:
                    logger.warning("Invalid date in named non-working entry: %s", part)
            continue

        # Legacy range: start:end (both are dates)
        if ':' in part:
            range_parts = part.split(':', 1)
            try:
                start = _dt.strptime(range_parts[0].strip(), '%Y-%m-%d').date()
                end = _dt.strptime(range_parts[1].strip(), '%Y-%m-%d').date()
                current = start
                while current <= end:
                    dates.add(current)
                    current += _td(days=1)
            except ValueError:
                logger.warning("Invalid date range in non-working suffix: %s", part)
        else:
            # Single date
            try:
                dates.add(_dt.strptime(part, '%Y-%m-%d').date())
            except ValueError:
                logger.warning("Invalid date in non-working suffix: %s", part)

    return dates


def _parse_named_non_working_suffix(suffix_str):
    """Parse a non-working [...] suffix preserving names and ranges.

    Returns a list of dicts with 'name', 'start', and optional 'finish' keys.
    """
    entries = []
    if not suffix_str:
        return entries

    for part in suffix_str.split(','):
        part = part.strip()
        if not part:
            continue

        named_match = re.match(
            r'([^:]+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$',
            part
        )
        if named_match:
            if re.match(r'\d{4}-\d{2}-\d{2}$', named_match.group(1).strip()):
                # Legacy range without name
                entries.append({
                    'name': '',
                    'start': named_match.group(1).strip(),
                    'finish': named_match.group(2),
                })
            else:
                entries.append({
                    'name': named_match.group(1).strip(),
                    'start': named_match.group(2),
                    'finish': named_match.group(3) or '',
                })
        else:
            # Single date without name
            date_match = re.match(r'(\d{4}-\d{2}-\d{2})\s*$', part)
            if date_match:
                entries.append({
                    'name': '',
                    'start': date_match.group(1),
                    'finish': '',
                })

    return entries


def parse_resource_mappings(original_text):
    """Parse resource mappings from YAML front matter.

    Returns a tuple of (resource_map, resource_non_working_days).
    - resource_map: dict mapping short names (lowercase) to full names.
    - resource_non_working_days: dict mapping short names (lowercase) to sets of datetime.date.

    Example resource_map: {'andy': 'Andy McCarthy', 'bob': 'Bob Smith'}

    Resource lines may have an optional non-working days suffix:
        - @Jack: Jack Lloyd, Network Arch, non-working [2026-03-01:2026-04-01, 2026-12-31]
    """
    resource_map = {}
    resource_nwd = {}

    # Extract YAML front matter
    lines = original_text.split('\n')
    in_frontmatter = False
    in_resources = False

    for line in lines:
        if line.strip() == '---':
            if not in_frontmatter:
                in_frontmatter = True
            else:
                break  # End of front matter
            continue

        if not in_frontmatter:
            continue

        # Check if we're in the Resources section
        if line.strip().startswith('Resources:'):
            in_resources = True
            continue

        # Check if we've left the Resources section
        if in_resources and line and not line.startswith(' ') and not line.startswith('-'):
            in_resources = False

        # Parse resource line
        if in_resources and line.strip().startswith('-'):
            # Format: - @Andy: Andy McCarthy, Lead Developer, non-working [2026-03-01:2026-04-01]
            match = re.match(r'\s*-\s*@(\w+):\s*(.+)', line)
            if match:
                short_name = match.group(1)
                full_info = match.group(2).strip()

                # Extract non-working days suffix if present
                nwd_match = re.search(r',?\s*non-working\s*\[([^\]]*)\]\s*$', full_info)
                if nwd_match:
                    nwd_dates = _parse_non_working_suffix(nwd_match.group(1))
                    if nwd_dates:
                        resource_nwd[short_name.lower()] = nwd_dates
                    # Remove the non-working suffix from full_info
                    full_info = full_info[:nwd_match.start()].strip().rstrip(',').strip()

                # Extract just the name (before the first comma)
                name_only = full_info.split(',')[0].strip()
                # Store with lowercase key for case-insensitive lookup
                resource_map[short_name.lower()] = name_only

    return resource_map, resource_nwd


def parse_stakeholders_from_frontmatter(original_text):
    """Parse stakeholder entries from YAML front matter.

    Stakeholders are stored in the front matter under a ``Stakeholders:`` or
    ``Key Stakeholders:`` header using the format::

        Stakeholders:
        - @Name: Role, interest:high, influence:low

    Returns a list of dicts with keys: name, role, interest, influence.
    """
    stakeholders = []
    if not original_text:
        return stakeholders

    lines = original_text.split('\n')
    in_frontmatter = False
    in_stakeholders = False

    for line in lines:
        if line.strip() == '---':
            if not in_frontmatter:
                in_frontmatter = True
            else:
                break  # End of front matter
            continue

        if not in_frontmatter:
            continue

        trimmed = line.strip()

        if trimmed.lower() in ('stakeholders:', 'key stakeholders:'):
            in_stakeholders = True
            continue

        # Check if we've left the Stakeholders section
        if in_stakeholders and trimmed and not trimmed.startswith('-') and re.match(r'^[a-zA-Z\s]+:', trimmed):
            in_stakeholders = False

        if in_stakeholders and trimmed.startswith('- @'):
            entry = trimmed[2:].strip()  # Remove "- "
            item = _parse_stakeholder_entry(entry)
            if item:
                stakeholders.append(item)

    return stakeholders


def _parse_stakeholder_entry(entry):
    """Parse a single stakeholder entry string.

    Format: ``@Name: Role, interest:high, influence:low``

    Returns a dict with keys: name, role, interest, influence.
    """
    if not entry or not entry.startswith('@'):
        return None

    colon_idx = entry.find(':')
    if colon_idx == -1:
        return {'name': entry.strip(), 'role': '', 'interest': 'low', 'influence': 'low'}

    name = entry[:colon_idx].strip()
    rest = entry[colon_idx + 1:].strip()

    parts = [p.strip() for p in rest.split(',')]

    role_parts = []
    interest = 'low'
    influence = 'low'

    for part in parts:
        kv_match = re.match(r'^(interest|influence):\s*(high|low)$', part, re.IGNORECASE)
        if kv_match:
            key = kv_match.group(1).lower()
            val = kv_match.group(2).lower()
            if key == 'interest':
                interest = val
            elif key == 'influence':
                influence = val
        else:
            if part:
                role_parts.append(part)

    role = ', '.join(role_parts)

    return {'name': name, 'role': role, 'interest': interest, 'influence': influence}


def calculate_evm(tasks, budget_items=None):
    """Calculate Earned Value Management metrics from task and budget data.

    This mirrors the JavaScript ``calculateEVM`` function in the frontend.

    Args:
        tasks: List of scheduled task dicts from ``schedule_tasks()``.
        budget_items: Optional list of budget item dicts (with ``forecast``,
            ``estimate``, ``total`` keys).

    Returns:
        A dict with EVM metrics, or ``None`` if insufficient data.
    """
    if not tasks:
        return None

    # Get non-summary, non-milestone tasks with dates
    work_tasks = [
        t for t in tasks
        if not t.get('summary')
        and t.get('start') and t.get('finish')
        and t.get('duration') and (
            isinstance(t['duration'], timedelta) and t['duration'].days > 0
            or isinstance(t['duration'], (int, float)) and t['duration'] > 0
        )
    ]

    if not work_tasks:
        return None

    # Calculate overall % complete (weighted by duration)
    total_duration_days = 0
    weighted_complete = 0
    for t in work_tasks:
        dur = t.get('duration', timedelta(days=0))
        if isinstance(dur, timedelta):
            dur_days = dur.days
        else:
            dur_days = int(dur)
        pct = float(t.get('percent', 0) or 0)
        total_duration_days += dur_days
        weighted_complete += dur_days * pct

    overall_percent_complete = weighted_complete / total_duration_days if total_duration_days > 0 else 0

    # Project date range
    starts = [t['start'] for t in work_tasks if t.get('start')]
    finishes = [t['finish'] for t in work_tasks if t.get('finish')]
    if not starts or not finishes:
        return None

    project_start = min(starts)
    project_end = max(finishes)
    total_project_days = (project_end - project_start).days
    if total_project_days <= 0:
        return None

    today = datetime.today().replace(hour=0, minute=0, second=0, microsecond=0)

    # Time elapsed fraction (clamped 0-1)
    elapsed_days = max(0, (today - project_start).days)
    time_elapsed_fraction = min(1.0, elapsed_days / total_project_days)

    # BAC = total forecast from budget items, or fall back to task duration
    bac = 0.0
    ac = 0.0
    has_budget_data = False

    if budget_items:
        for item in budget_items:
            bac += float(item.get('forecast', 0) or item.get('estimate', 0) or 0)
            ac += float(item.get('total', 0) or 0)

    has_budget_data = bac > 0
    if not has_budget_data:
        bac = float(total_duration_days)
        ac = float(total_duration_days) * (overall_percent_complete / 100.0)

    # Core EVM calculations
    pv = bac * time_elapsed_fraction
    ev = bac * (overall_percent_complete / 100.0)

    # Variances
    cv = ev - ac  # Cost Variance
    sv = ev - pv  # Schedule Variance

    # Indices (guard against division by zero)
    cpi = ev / ac if ac != 0 else 0
    spi = ev / pv if pv != 0 else 0

    # Forecasts
    eac = bac / cpi if cpi != 0 else bac  # Estimate at Completion
    etc = eac - ac  # Estimate to Complete
    vac = bac - eac  # Variance at Completion

    return {
        'BAC': bac,
        'PV': pv,
        'EV': ev,
        'AC': ac,
        'CV': cv,
        'SV': sv,
        'CPI': cpi,
        'SPI': spi,
        'EAC': eac,
        'ETC': etc,
        'VAC': vac,
        'overall_percent_complete': overall_percent_complete,
        'time_elapsed_fraction': time_elapsed_fraction,
        'project_start': project_start,
        'project_end': project_end,
        'has_budget_data': has_budget_data,
    }


def analyze_plan(text, original_text=None):
    """Analyze a project plan and provide suggestions for improvement.

    Args:
        text: Converted text (without front matter)
        original_text: Original text with front matter

    Returns:
        List of suggestion dictionaries with 'type', 'severity', and 'message'
    """
    suggestions = []

    # Parse the plan
    data = natural_language_to_yaml(text, "Project")
    phases_raw = data["Project"]

    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []

    tasks = schedule_tasks(phases)

    # Parse resource mappings from original text
    resource_map = {}
    has_frontmatter = False
    if original_text:
        resource_map, _ = parse_resource_mappings(original_text)
        # Check if front matter exists
        if '---' in original_text:
            has_frontmatter = True

    # Check 1: Missing front matter
    if not has_frontmatter and original_text:
        suggestions.append({
            'type': 'Front Matter',
            'severity': 'Warning',
            'message': 'Plan is missing YAML front matter. Consider adding project metadata, resources, and holidays.'
        })

    # Collect all resources used in tasks
    resources_used = set()
    for task in tasks:
        res = task.get('resources', '')
        if res:
            for r in res.split(','):
                resources_used.add(r.strip())

    # Check 2: Resources without full names/roles in front matter
    if resource_map and resources_used:
        # Compare resources case-insensitively
        resources_used_lower = {r.lower() for r in resources_used}
        missing_resource_details_lower = resources_used_lower - set(resource_map.keys())
        # Find original case versions of missing resources
        missing_resource_details = {r for r in resources_used if r.lower() in missing_resource_details_lower}
        if missing_resource_details:
            for res in sorted(missing_resource_details):
                suggestions.append({
                    'type': 'Resource Definition',
                    'severity': 'Warning',
                    'message': f'Resource "{res}" is used in tasks but not defined in front matter. Add full name and role.'
                })
    elif resources_used and not resource_map:
        suggestions.append({
            'type': 'Resource Definition',
            'severity': 'Warning',
            'message': f'Resources are used ({", ".join(sorted(resources_used))}) but none are defined in front matter with full names and roles.'
        })

    # Track first non-summary task for dependency checking
    first_task_found = False

    # Analyze each task
    for idx, task in enumerate(tasks):
        task_name = task.get('description', task.get('name', f'Task {idx+1}'))
        is_summary = task.get('summary', False)

        # Skip summary tasks for most checks
        if is_summary:
            continue

        # Check 3: Tasks longer than 20 days
        duration = task.get('duration')
        if isinstance(duration, timedelta) and duration.days > 20:
            suggestions.append({
                'type': 'Task Duration',
                'severity': 'High',
                'message': f'Task "{task_name}" has duration of {duration.days} days. Consider breaking it down into smaller, more manageable tasks (< 20 days).'
            })

        # Check 4: Missing resources
        if not task.get('resources'):
            suggestions.append({
                'type': 'Missing Resource',
                'severity': 'Medium',
                'message': f'Task "{task_name}" has no assigned resource. Assign a team member to this task.'
            })

        # Check 5: Missing percentage complete
        if task.get('percent') is None or task.get('percent') == '':
            suggestions.append({
                'type': 'Missing Progress',
                'severity': 'Low',
                'message': f'Task "{task_name}" has no completion percentage. Add progress tracking (e.g., 0%, 50%, 100%).'
            })

        # Check 6: Missing dependencies (except first task)
        if not first_task_found:
            first_task_found = True
        else:
            has_dependency = task.get('depends') or task.get('sequential')
            if not has_dependency:
                suggestions.append({
                    'type': 'Missing Dependency',
                    'severity': 'Medium',
                    'message': f'Task "{task_name}" has no dependencies. Link it to prerequisite tasks using [depends taskname] or use * for sequential ordering.'
                })

    return suggestions

def export_timeline_to_powerpoint(text, output_path, is_yaml=True, project_name="Project", original_text=None):
    """Export project timeline to PowerPoint format.

    Args:
        text: Input text (YAML or natural language)
        output_path: Path to save the PowerPoint file
        is_yaml: If True, parse as YAML; if False, parse as natural language
        project_name: Project name to use
        original_text: Original text before conversion (for extracting resource mappings)
    """
    # Parse the text to get tasks and project info
    if is_yaml:
        data = yaml.safe_load(text)
        project_name = list(data.keys())[0]
        phases_raw = data[project_name]
    else:
        # Parse natural language
        data = natural_language_to_yaml(text, project_name)
        phases_raw = data[project_name]

    # If phases_raw is a list, pass as-is; if dict, wrap in a list
    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []

    # Schedule tasks
    tasks = schedule_tasks(phases)

    if not tasks:
        logger.warning("No tasks found to export")
        return

    # Calculate project dates
    today = datetime.today()
    start_date = min([t.get('start', today) for t in tasks if 'start' in t])
    finish_date = max([t.get('finish', today) for t in tasks if 'finish' in t])
    total_days = (finish_date - start_date).days or 1

    # Compute phase timelines
    phase_dates = {}
    for t in tasks:
        phase = t.get('phase')
        start = t.get('start') or today
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': start, 'end': finish}
            else:
                if start < phase_dates[phase]['start']:
                    phase_dates[phase]['start'] = start
                if finish > phase_dates[phase]['end']:
                    phase_dates[phase]['end'] = finish

    # Collect milestones
    milestones = []
    for t in tasks:
        duration = t.get('duration', timedelta(days=1))
        if isinstance(duration, timedelta) and duration.days == 0:
            milestone_name = t.get('description', t.get('name', ''))
            display_name = milestone_name.replace('_', ' ')
            milestones.append({'name': display_name, 'date': t.get('start')})

    # Create presentation
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)

    # Add blank slide
    blank_slide_layout = prs.slide_layouts[6]  # Blank layout
    slide = prs.slides.add_slide(blank_slide_layout)

    # Add title
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(9), Inches(0.6))
    title_frame = title_box.text_frame
    title_frame.text = f"{project_name} Timeline"
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(32)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(54, 96, 146)

    # Timeline dimensions
    timeline_left = Inches(1)
    timeline_top = Inches(2.5)
    timeline_width = Inches(8)
    timeline_height = Inches(0.15)

    # Draw timeline base line
    timeline_line = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        timeline_left,
        timeline_top,
        timeline_width,
        timeline_height
    )
    timeline_line.fill.solid()
    timeline_line.fill.fore_color.rgb = RGBColor(54, 96, 146)
    timeline_line.line.color.rgb = RGBColor(54, 96, 146)

    # Add start and end dates
    start_text = slide.shapes.add_textbox(timeline_left, timeline_top - Inches(0.5), Inches(1.5), Inches(0.3))
    start_frame = start_text.text_frame
    start_frame.text = f"Start\n{start_date.strftime('%d %b %Y')}"
    start_frame.paragraphs[0].font.size = Pt(10)
    start_frame.paragraphs[0].font.bold = True

    end_text = slide.shapes.add_textbox(timeline_left + timeline_width - Inches(1.5), timeline_top - Inches(0.5), Inches(1.5), Inches(0.3))
    end_frame = end_text.text_frame
    end_frame.text = f"Finish\n{finish_date.strftime('%d %b %Y')}"
    end_frame.paragraphs[0].font.size = Pt(10)
    end_frame.paragraphs[0].font.bold = True
    end_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT

    # Add phase boxes
    for phase, dates in phase_dates.items():
        phase_start_pos = (dates['start'] - start_date).days / total_days
        phase_end_pos = (dates['end'] - start_date).days / total_days
        phase_width = (phase_end_pos - phase_start_pos) * timeline_width.inches

        if phase_width < 0.1:
            phase_width = 0.1

        phase_box = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE,
            timeline_left + Inches(phase_start_pos * timeline_width.inches),
            timeline_top + Inches(0.4),
            Inches(phase_width),
            Inches(0.5)
        )
        phase_box.fill.solid()
        phase_box.fill.fore_color.rgb = RGBColor(180, 198, 231)
        phase_box.line.color.rgb = RGBColor(54, 96, 146)

        # Add phase name
        phase_frame = phase_box.text_frame
        phase_frame.text = phase.replace('_', ' ')
        phase_frame.paragraphs[0].font.size = Pt(9)
        phase_frame.paragraphs[0].font.bold = True
        phase_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
        phase_frame.vertical_anchor = 1  # Middle

    # Add milestones
    for milestone in milestones:
        m_pos = (milestone['date'] - start_date).days / total_days
        m_left = timeline_left + Inches(m_pos * timeline_width.inches)

        # Add diamond marker
        diamond = slide.shapes.add_shape(
            MSO_SHAPE.DIAMOND,
            m_left - Inches(0.15),
            timeline_top - Inches(0.075),
            Inches(0.3),
            Inches(0.3)
        )
        diamond.fill.solid()
        diamond.fill.fore_color.rgb = RGBColor(192, 0, 0)
        diamond.line.color.rgb = RGBColor(128, 0, 0)

        # Add milestone label above
        m_label = slide.shapes.add_textbox(
            m_left - Inches(0.75),
            timeline_top - Inches(1.2),
            Inches(1.5),
            Inches(0.4)
        )
        m_frame = m_label.text_frame
        m_frame.text = milestone['name']
        m_frame.paragraphs[0].font.size = Pt(9)
        m_frame.paragraphs[0].alignment = PP_ALIGN.CENTER

        # Add milestone date below
        m_date = slide.shapes.add_textbox(
            m_left - Inches(0.5),
            timeline_top + timeline_height + Inches(0.2),
            Inches(1),
            Inches(0.3)
        )
        m_date_frame = m_date.text_frame
        m_date_frame.text = milestone['date'].strftime('%d %b')
        m_date_frame.paragraphs[0].font.size = Pt(8)
        m_date_frame.paragraphs[0].alignment = PP_ALIGN.CENTER

    # Add legend
    legend_top = Inches(6)
    legend_left = Inches(1)

    # Phase legend
    phase_legend_box = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        legend_left,
        legend_top,
        Inches(0.3),
        Inches(0.2)
    )
    phase_legend_box.fill.solid()
    phase_legend_box.fill.fore_color.rgb = RGBColor(180, 198, 231)
    phase_legend_box.line.color.rgb = RGBColor(54, 96, 146)

    phase_legend_text = slide.shapes.add_textbox(legend_left + Inches(0.4), legend_top, Inches(1), Inches(0.2))
    phase_legend_text.text_frame.text = "Phase"
    phase_legend_text.text_frame.paragraphs[0].font.size = Pt(10)

    # Milestone legend
    milestone_legend = slide.shapes.add_shape(
        MSO_SHAPE.DIAMOND,
        legend_left + Inches(2),
        legend_top - Inches(0.05),
        Inches(0.3),
        Inches(0.3)
    )
    milestone_legend.fill.solid()
    milestone_legend.fill.fore_color.rgb = RGBColor(192, 0, 0)
    milestone_legend.line.color.rgb = RGBColor(128, 0, 0)

    milestone_legend_text = slide.shapes.add_textbox(legend_left + Inches(2.4), legend_top, Inches(1), Inches(0.2))
    milestone_legend_text.text_frame.text = "Milestone"
    milestone_legend_text.text_frame.paragraphs[0].font.size = Pt(10)

    # Save presentation
    prs.save(output_path)
    logger.info(f"Exported timeline to PowerPoint: {output_path}")


def _draw_timeline_graphic(slide, timeline_tasks, left, top, width):
    """Draw a minimal timeline graphic on the slide using native shapes.

    Renders phase bars (summary tasks) and milestone diamonds, plus a date
    scale and a today marker.  Returns the total height consumed (EMU) so the
    caller can position subsequent content below.

    Args:
        slide: The python-pptx slide object.
        timeline_tasks: list of dicts with keys name, start, finish, percent,
            is_summary, duration_days.
        left: Left position (EMU).
        top: Top position (EMU).
        width: Available width (EMU).

    Returns:
        Total height used by the timeline graphic (EMU), including spacing.
    """
    from pptx.util import Emu
    from pptx.oxml.ns import qn

    # Separate phases and milestones
    phases = [t for t in timeline_tasks
              if t.get('is_summary') and t.get('start') and t.get('finish')]
    milestones = [t for t in timeline_tasks
                  if t.get('duration_days', 0) == 0 and not t.get('is_summary')
                  and t.get('finish')]

    if not phases and not milestones:
        return Inches(0)

    # Parse all dates to find the range
    def _parse(d):
        return datetime.strptime(d, '%Y-%m-%d')

    all_dates = []
    for t in phases + milestones:
        if t.get('start'):
            all_dates.append(_parse(t['start']))
        if t.get('finish'):
            all_dates.append(_parse(t['finish']))

    if not all_dates:
        return Inches(0)

    min_date = min(all_dates) - timedelta(days=7)
    max_date = max(all_dates) + timedelta(days=7)
    total_days = (max_date - min_date).days + 1

    if total_days <= 0:
        return Inches(0)

    # Colour palette
    BLUE_SHADES = [
        RGBColor(21, 101, 192),   # #1565c0
        RGBColor(25, 118, 210),   # #1976d2
        RGBColor(30, 136, 229),   # #1e88e5
        RGBColor(33, 150, 243),   # #2196f3
        RGBColor(66, 165, 245),   # #42a5f5
        RGBColor(100, 181, 246),  # #64b5f6
        RGBColor(144, 202, 249),  # #90caf9
    ]
    GREEN = RGBColor(76, 175, 80)       # #4caf50
    MILESTONE_BLUE = RGBColor(25, 118, 210)
    GREY_LINE = RGBColor(204, 204, 204)
    DARK_TEXT = RGBColor(100, 100, 100)
    TODAY_RED = RGBColor(220, 53, 69)

    # Layout constants (reduced to ~50% of original height)
    bar_height = Inches(0.07)
    row_gap = Inches(0.008)
    width_emu = int(width)

    # Assign rows to phases (greedy, no overlap)
    sorted_phases = sorted(phases, key=lambda p: _parse(p['start']))
    row_ends = []  # tracks the end-day of each row
    phase_rows = []
    for phase in sorted_phases:
        start_day = (_parse(phase['start']) - min_date).days
        end_day = (_parse(phase['finish']) - min_date).days
        assigned = -1
        for r_idx, r_end in enumerate(row_ends):
            if start_day >= r_end:
                assigned = r_idx
                break
        if assigned == -1:
            assigned = len(row_ends)
            row_ends.append(0)
        row_ends[assigned] = end_day
        phase_rows.append((phase, assigned))

    num_rows = max(len(row_ends), 1) if phases else 0
    phase_area_height = int(num_rows * (bar_height + row_gap))

    # Draw phase bars
    for idx, (phase, row) in enumerate(phase_rows):
        start_day = (_parse(phase['start']) - min_date).days
        end_day = (_parse(phase['finish']) - min_date).days
        x_start = int(left + (start_day / total_days) * width_emu)
        x_end = int(left + (end_day / total_days) * width_emu)
        bar_w = max(Inches(0.05), x_end - x_start)
        y = int(top + row * (bar_height + row_gap))

        percent = float(phase.get('percent', 0))
        is_complete = percent >= 100
        bg_color = GREEN if is_complete else BLUE_SHADES[idx % len(BLUE_SHADES)]

        # Background bar
        bar = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE, x_start, y, bar_w, bar_height
        )
        bar.fill.solid()
        bar.fill.fore_color.rgb = bg_color
        bar.line.fill.background()
        # Adjust corner rounding
        bar.adjustments[0] = 0.15

        # Progress overlay for partially complete phases
        if 0 < percent < 100:
            progress_w = int(bar_w * (percent / 100))
            if progress_w > 0:
                prog = slide.shapes.add_shape(
                    MSO_SHAPE.ROUNDED_RECTANGLE, x_start, y,
                    progress_w, bar_height
                )
                prog.fill.solid()
                # Light green (50% blend of GREEN with white) so phase
                # name text beneath remains readable.
                prog.fill.fore_color.rgb = RGBColor(166, 215, 168)
                prog.line.fill.background()
                prog.adjustments[0] = 0.15

        # Phase name label inside the bar
        if bar_w > Inches(0.5):
            tf = bar.text_frame
            tf.word_wrap = False
            tf.margin_left = Inches(0.02)
            tf.margin_right = Inches(0.02)
            tf.margin_top = Inches(0)
            tf.margin_bottom = Inches(0)
            p = tf.paragraphs[0]
            label = phase.get('name', '')
            if is_complete:
                label = '\u2713 ' + label
            p.text = label
            p.font.size = Pt(5)
            p.font.color.rgb = RGBColor(255, 255, 255)
            p.font.bold = False

    # Backbone line (thin grey line across full width)
    backbone_thickness = Inches(0.01)
    line_y = int(top + phase_area_height + Inches(0.01))
    backbone = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, int(left), line_y, width_emu, backbone_thickness
    )
    backbone.fill.solid()
    backbone.fill.fore_color.rgb = GREY_LINE
    backbone.line.fill.background()

    # Draw milestone diamonds centred on the backbone line
    diamond_size = Inches(0.07)
    backbone_centre = int(line_y + backbone_thickness // 2)
    milestone_y = int(backbone_centre - diamond_size // 2)
    for ms in milestones:
        ms_date = _parse(ms['finish'])
        day_offset = (ms_date - min_date).days
        x_pos = int(left + (day_offset / total_days) * width_emu
                     - diamond_size // 2)
        percent = float(ms.get('percent', 0))
        ms_color = GREEN if percent >= 100 else MILESTONE_BLUE

        diamond = slide.shapes.add_shape(
            MSO_SHAPE.DIAMOND, x_pos, milestone_y,
            diamond_size, diamond_size
        )
        diamond.fill.solid()
        diamond.fill.fore_color.rgb = ms_color
        diamond.line.fill.background()

    # Date scale labels beneath the backbone line
    date_label_y = int(line_y + backbone_thickness + Inches(0.01))

    if total_days <= 60:
        interval_days = max(2, total_days // 7)
    elif total_days <= 365:
        interval_days = max(7, total_days // 12)
    elif total_days <= 730:
        interval_days = 30
    else:
        interval_days = 90

    d = min_date
    while d <= max_date:
        day_offset = (d - min_date).days
        x_pos = int(left + (day_offset / total_days) * width_emu)
        if total_days <= 365:
            label = d.strftime('%b %Y').lower()
        else:
            label = d.strftime("%b '%y").lower()

        tb = slide.shapes.add_textbox(x_pos, date_label_y,
                                      Inches(0.5), Inches(0.10))
        tf = tb.text_frame
        tf.word_wrap = False
        tf.margin_left = 0
        tf.margin_top = 0
        tf.margin_bottom = 0
        tf.margin_right = 0
        p = tf.paragraphs[0]
        p.text = label
        p.font.size = Pt(4)
        p.font.color.rgb = DARK_TEXT
        d += timedelta(days=interval_days)

    # Today marker (red vertical line)
    today = datetime.now()
    if min_date <= today <= max_date:
        today_offset = (today - min_date).days
        today_x = int(left + (today_offset / total_days) * width_emu)
        marker_top = int(top)
        marker_height = int(date_label_y - top)
        today_line = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, today_x, marker_top,
            Inches(0.01), marker_height
        )
        today_line.fill.solid()
        today_line.fill.fore_color.rgb = TODAY_RED
        today_line.line.fill.background()
        # Small "Today" label
        today_tb = slide.shapes.add_textbox(
            today_x - Inches(0.12), marker_top - Inches(0.09),
            Inches(0.3), Inches(0.09)
        )
        tp = today_tb.text_frame.paragraphs[0]
        tp.text = "Today"
        tp.font.size = Pt(4)
        tp.font.color.rgb = TODAY_RED
        tp.font.bold = True
        tp.alignment = PP_ALIGN.CENTER

    total_height = int(date_label_y + Inches(0.10) - top)
    return total_height


def export_report_to_powerpoint(output_path, report_data):
    """Export the weekly project report to a single PowerPoint slide.

    Delegates to _add_report_slide for the actual slide content, then saves
    the presentation.

    Args:
        output_path: Path to save the PowerPoint file.
        report_data: dict with keys:
            project_name, manager, sponsor, budget, date, status,
            milestones (list of dicts with name, date, rag),
            up_next (list of dicts with name, start, finish, rag),
            highlight (dict with date, author, content or None),
            risks_issues (list of dicts with type, title, score),
            timeline_tasks (list of dicts with name, start, finish, percent,
                is_summary, duration_days; optional).
    """
    prs = Presentation()
    prs.slide_width = Inches(13.333)   # Widescreen 16:9
    prs.slide_height = Inches(7.5)

    _add_report_slide(prs, report_data)

    prs.save(output_path)
    logger.info(f"Exported weekly report to PowerPoint: {output_path}")


def _add_report_slide(prs, report_data, include_footer=True):
    """Add a single project report slide to an existing Presentation.

    This is the shared logic used by both single-project and portfolio exports.

    Args:
        prs: A python-pptx Presentation object (slide dimensions must be set).
        report_data: dict matching the export_report_to_powerpoint schema.
        include_footer: Whether to add a footer with generation info (default True).
    """
    # -- Colour palette -------------------------------------------------------
    DARK_BLUE = RGBColor(33, 60, 114)
    MID_BLUE = RGBColor(54, 96, 146)
    LIGHT_BLUE = RGBColor(180, 198, 231)
    WHITE = RGBColor(255, 255, 255)
    BLACK = RGBColor(0, 0, 0)
    LIGHT_GREY = RGBColor(242, 242, 242)
    RED = RGBColor(192, 0, 0)
    AMBER = RGBColor(218, 165, 32)
    GREEN = RGBColor(0, 128, 0)
    COMPLETE_BLUE = RGBColor(25, 118, 210)

    def _rag_colour(rag_str):
        colour = rag_status_to_colour(rag_str)
        if colour == 'red':
            return RED
        if colour == 'amber':
            return AMBER
        if colour == 'green':
            return GREEN
        if colour == 'blue':
            return COMPLETE_BLUE
        return BLACK

    def _sanitise_text(text):
        import re
        return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(text))

    def _set_cell_text(cell, text, font_size=8, bold=False, colour=None,
                       alignment=PP_ALIGN.LEFT):
        cell.text = _sanitise_text(text)
        for para in cell.text_frame.paragraphs:
            para.font.size = Pt(font_size)
            para.font.bold = bold
            if colour:
                para.font.color.rgb = colour
            para.alignment = alignment
        cell.text_frame.word_wrap = True
        cell.text_frame.margin_top = Inches(0.02)
        cell.text_frame.margin_bottom = Inches(0.02)
        cell.text_frame.margin_left = Inches(0.04)
        cell.text_frame.margin_right = Inches(0.04)

    def _shade_header_row(table, col_count):
        for c in range(col_count):
            cell = table.cell(0, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = DARK_BLUE

    slide = prs.slides.add_slide(prs.slide_layouts[6])  # Blank layout

    project_name = report_data.get('project_name', 'Project')
    manager = report_data.get('manager', '')
    sponsor = report_data.get('sponsor', '')
    budget = report_data.get('budget', '')
    report_date = report_data.get('date', '')
    status = report_data.get('status', '')
    percent_complete = report_data.get('percent_complete', None)

    # -- Title bar ------------------------------------------------------------
    title_bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0), Inches(0),
        Inches(13.333), Inches(0.85)
    )
    title_bar.fill.solid()
    title_bar.fill.fore_color.rgb = DARK_BLUE
    title_bar.line.fill.background()

    tb = slide.shapes.add_textbox(Inches(0.4), Inches(0.08),
                                  Inches(6), Inches(0.45))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = _sanitise_text(project_name)
    p.font.size = Pt(22)
    p.font.bold = True
    p.font.color.rgb = WHITE

    details_parts = []
    if manager:
        details_parts.append(f"PM: {manager}")
    if sponsor:
        details_parts.append(f"Sponsor: {sponsor}")
    if budget:
        details_parts.append(f"Budget: {budget}")
    if report_date:
        details_parts.append(f"Date: {report_date}")
    if percent_complete is not None:
        details_parts.append(f"{percent_complete}% complete")
    detail_text = "   |   ".join(details_parts) if details_parts else ""

    if detail_text:
        dtb = slide.shapes.add_textbox(Inches(0.4), Inches(0.50),
                                       Inches(10), Inches(0.30))
        dtf = dtb.text_frame
        dtf.word_wrap = True
        dp = dtf.paragraphs[0]
        dp.text = _sanitise_text(detail_text)
        dp.font.size = Pt(10)
        dp.font.color.rgb = WHITE

    if status:
        # White background pill behind the RAG status badge
        status_bg = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(11.5), Inches(0.15), Inches(1.6), Inches(0.55)
        )
        status_bg.fill.solid()
        status_bg.fill.fore_color.rgb = WHITE
        status_bg.line.fill.background()

        stb = slide.shapes.add_textbox(Inches(11.5), Inches(0.15),
                                       Inches(1.6), Inches(0.55))
        stf = stb.text_frame
        stf.word_wrap = True
        sp = stf.paragraphs[0]
        sp.text = _sanitise_text(status.upper())
        sp.font.size = Pt(16)
        sp.font.bold = True
        sp.font.color.rgb = _rag_colour(status)
        sp.alignment = PP_ALIGN.CENTER

    # -- Timeline graphic (image-only, captured from browser swimlane SVG) ----
    timeline_height_used = Inches(0)
    timeline_image_b64 = report_data.get('timeline_image')
    if timeline_image_b64:
        import base64
        import io
        try:
            img_data = base64.b64decode(timeline_image_b64)
            img_stream = io.BytesIO(img_data)
            tl_width = Inches(12.533)
            max_tl_height = Inches(0.9)
            pic = slide.shapes.add_picture(
                img_stream, Inches(0.4), Inches(1.05), width=tl_width
            )
            if pic.height > max_tl_height:
                pic.height = max_tl_height
                pic.width = tl_width
            timeline_height_used = pic.height + Inches(0.15)
        except Exception:
            logger.warning("Failed to embed timeline image in PPTX report",
                           exc_info=True)
            timeline_height_used = Inches(0)

    # -- Quad grid layout -----------------------------------------------------
    left_margin = Inches(0.4)
    right_margin = Inches(0.4)
    quad_gap = Inches(0.3)
    total_width = Inches(13.333) - left_margin - right_margin
    col_width = (total_width - quad_gap) // 2

    top_row_top = Inches(1.05) + timeline_height_used
    row_height = Inches(3.0)
    bottom_row_top = top_row_top + row_height + quad_gap
    right_col_left = left_margin + col_width + quad_gap

    def _add_section_heading(text, left, top, width):
        hbox = slide.shapes.add_textbox(left, top, width, Inches(0.30))
        hf = hbox.text_frame
        hf.word_wrap = True
        hp = hf.paragraphs[0]
        hp.text = text
        hp.font.size = Pt(13)
        hp.font.bold = True
        hp.font.color.rgb = MID_BLUE

    # -- TOP-LEFT: Milestones -------------------------------------------------
    _add_section_heading("Milestones", left_margin, top_row_top, col_width)
    milestones = report_data.get('milestones', [])
    ms_table_top = top_row_top + Inches(0.35)

    if milestones:
        ms_rows = min(len(milestones), 10) + 1
        ms_table = slide.shapes.add_table(
            ms_rows, 3, left_margin, ms_table_top,
            col_width, Inches(0.26 * ms_rows)
        ).table
        w0 = int(col_width * 55 // 100)
        w1 = int(col_width * 30 // 100)
        w2 = int(col_width) - w0 - w1
        ms_table.columns[0].width = w0
        ms_table.columns[1].width = w1
        ms_table.columns[2].width = w2
        _shade_header_row(ms_table, 3)
        _set_cell_text(ms_table.cell(0, 0), "Milestone", 9, True, WHITE)
        _set_cell_text(ms_table.cell(0, 1), "Date", 9, True, WHITE, PP_ALIGN.CENTER)
        _set_cell_text(ms_table.cell(0, 2), "RAG", 9, True, WHITE, PP_ALIGN.CENTER)
        for i, ms in enumerate(milestones[:10]):
            row_idx = i + 1
            _set_cell_text(ms_table.cell(row_idx, 0), ms.get('name', ''))
            _set_cell_text(ms_table.cell(row_idx, 1), ms.get('date', ''),
                           8, False, None, PP_ALIGN.CENTER)
            rag = ms.get('rag', '')
            _set_cell_text(ms_table.cell(row_idx, 2), rag, 8, True,
                           _rag_colour(rag), PP_ALIGN.CENTER)
            if row_idx % 2 == 0:
                for c in range(3):
                    ms_table.cell(row_idx, c).fill.solid()
                    ms_table.cell(row_idx, c).fill.fore_color.rgb = LIGHT_GREY
    else:
        nb = slide.shapes.add_textbox(left_margin, ms_table_top, col_width, Inches(0.3))
        nb.text_frame.text = "No upcoming milestones."
        nb.text_frame.paragraphs[0].font.size = Pt(9)
        nb.text_frame.paragraphs[0].font.color.rgb = RGBColor(128, 128, 128)

    # -- TOP-RIGHT: Up Next ---------------------------------------------------
    _add_section_heading("Up Next", right_col_left, top_row_top, col_width)
    up_next = report_data.get('up_next', [])
    un_table_top = top_row_top + Inches(0.35)

    if up_next:
        un_rows = min(len(up_next), 10) + 1
        un_table = slide.shapes.add_table(
            un_rows, 4, right_col_left, un_table_top,
            col_width, Inches(0.26 * un_rows)
        ).table
        w0 = int(col_width * 40 // 100)
        w1 = int(col_width * 18 // 100)
        w2 = int(col_width * 18 // 100)
        w3 = int(col_width) - w0 - w1 - w2
        un_table.columns[0].width = w0
        un_table.columns[1].width = w1
        un_table.columns[2].width = w2
        un_table.columns[3].width = w3
        _shade_header_row(un_table, 4)
        _set_cell_text(un_table.cell(0, 0), "Task", 9, True, WHITE)
        _set_cell_text(un_table.cell(0, 1), "Start", 9, True, WHITE, PP_ALIGN.CENTER)
        _set_cell_text(un_table.cell(0, 2), "Finish", 9, True, WHITE, PP_ALIGN.CENTER)
        _set_cell_text(un_table.cell(0, 3), "RAG", 9, True, WHITE, PP_ALIGN.CENTER)
        for i, item in enumerate(up_next[:10]):
            row_idx = i + 1
            _set_cell_text(un_table.cell(row_idx, 0), item.get('name', ''))
            _set_cell_text(un_table.cell(row_idx, 1), item.get('start', ''),
                           8, False, None, PP_ALIGN.CENTER)
            _set_cell_text(un_table.cell(row_idx, 2), item.get('finish', ''),
                           8, False, None, PP_ALIGN.CENTER)
            rag_text = item.get('rag', '')
            _set_cell_text(un_table.cell(row_idx, 3), rag_text, 8, True,
                           _rag_colour(rag_text), PP_ALIGN.CENTER)
            if row_idx % 2 == 0:
                for c in range(4):
                    un_table.cell(row_idx, c).fill.solid()
                    un_table.cell(row_idx, c).fill.fore_color.rgb = LIGHT_GREY
    else:
        nb = slide.shapes.add_textbox(right_col_left, un_table_top, col_width, Inches(0.3))
        nb.text_frame.text = "No upcoming tasks in the next 2 weeks."
        nb.text_frame.paragraphs[0].font.size = Pt(9)
        nb.text_frame.paragraphs[0].font.color.rgb = RGBColor(128, 128, 128)

    # -- BOTTOM-LEFT: Latest Highlight ----------------------------------------
    _add_section_heading("Latest Highlight", left_margin, bottom_row_top, col_width)
    highlight = report_data.get('highlight')
    hl_top = bottom_row_top + Inches(0.35)

    if highlight and highlight.get('content'):
        meta_parts = []
        if highlight.get('date'):
            meta_parts.append(highlight['date'])
        if highlight.get('author'):
            meta_parts.append(f"@{highlight['author']}")
        meta_text = "  ".join(meta_parts)
        if meta_text:
            mb = slide.shapes.add_textbox(left_margin, hl_top, col_width, Inches(0.25))
            mf = mb.text_frame
            mf.word_wrap = True
            mp = mf.paragraphs[0]
            mp.text = _sanitise_text(meta_text)
            mp.font.size = Pt(8)
            mp.font.color.rgb = RGBColor(100, 100, 100)
            mp.font.italic = True
            hl_top += Inches(0.25)
        cb = slide.shapes.add_textbox(left_margin, hl_top, col_width, Inches(2.3))
        cf = cb.text_frame
        cf.word_wrap = True
        content = highlight.get('content', '')
        lines = content.split('\n')
        for idx, line in enumerate(lines):
            if idx == 0:
                cp = cf.paragraphs[0]
            else:
                cp = cf.add_paragraph()
            clean = line.strip()
            if clean.startswith('- '):
                clean = '\u2022 ' + clean[2:]
            cp.text = _sanitise_text(clean)
            cp.font.size = Pt(9)
            cp.font.color.rgb = BLACK
    else:
        nb = slide.shapes.add_textbox(left_margin, hl_top, col_width, Inches(0.3))
        nb.text_frame.text = "No highlights recorded yet."
        nb.text_frame.paragraphs[0].font.size = Pt(9)
        nb.text_frame.paragraphs[0].font.color.rgb = RGBColor(128, 128, 128)

    # -- BOTTOM-RIGHT: Risks & Issues -----------------------------------------
    _add_section_heading("Risks & Issues", right_col_left, bottom_row_top, col_width)
    risks_issues = report_data.get('risks_issues', [])
    ri_table_top = bottom_row_top + Inches(0.35)

    if risks_issues:
        ri_cols = 5  # Type, Title, Description, Mitigation, Score
        ri_rows = min(len(risks_issues), 10) + 1
        ri_table = slide.shapes.add_table(
            ri_rows, ri_cols, right_col_left, ri_table_top,
            col_width, Inches(0.26 * ri_rows)
        ).table
        w0 = int(col_width * 10 // 100)   # Type
        w1 = int(col_width * 20 // 100)   # Title
        w2 = int(col_width * 28 // 100)   # Description
        w3 = int(col_width * 28 // 100)   # Mitigation
        w4 = int(col_width) - w0 - w1 - w2 - w3  # Score
        ri_table.columns[0].width = w0
        ri_table.columns[1].width = w1
        ri_table.columns[2].width = w2
        ri_table.columns[3].width = w3
        ri_table.columns[4].width = w4
        _shade_header_row(ri_table, ri_cols)
        _set_cell_text(ri_table.cell(0, 0), "Type", 9, True, WHITE, PP_ALIGN.CENTER)
        _set_cell_text(ri_table.cell(0, 1), "Title", 9, True, WHITE)
        _set_cell_text(ri_table.cell(0, 2), "Description", 9, True, WHITE)
        _set_cell_text(ri_table.cell(0, 3), "Mitigation", 9, True, WHITE)
        _set_cell_text(ri_table.cell(0, 4), "Score", 9, True, WHITE, PP_ALIGN.CENTER)
        for i, item in enumerate(risks_issues[:10]):
            row_idx = i + 1
            item_type = item.get('type', '')
            _set_cell_text(ri_table.cell(row_idx, 0), item_type.capitalize(),
                           8, True, None, PP_ALIGN.CENTER)
            _set_cell_text(ri_table.cell(row_idx, 1), item.get('title', ''))
            _set_cell_text(ri_table.cell(row_idx, 2),
                           item.get('description', ''))
            _set_cell_text(ri_table.cell(row_idx, 3),
                           item.get('mitigation', ''))
            score = item.get('score', 0)
            score_colour = RED if score >= 16 else (AMBER if score >= 6 else GREEN)
            _set_cell_text(ri_table.cell(row_idx, 4), str(score), 8,
                           True, score_colour, PP_ALIGN.CENTER)
            if row_idx % 2 == 0:
                for c in range(ri_cols):
                    ri_table.cell(row_idx, c).fill.solid()
                    ri_table.cell(row_idx, c).fill.fore_color.rgb = LIGHT_GREY
    else:
        nb = slide.shapes.add_textbox(right_col_left, ri_table_top, col_width, Inches(0.3))
        nb.text_frame.text = "No open risks or issues."
        nb.text_frame.paragraphs[0].font.size = Pt(9)
        nb.text_frame.paragraphs[0].font.color.rgb = RGBColor(128, 128, 128)

    # -- Footer ---------------------------------------------------------------
    if include_footer:
        fb = slide.shapes.add_textbox(Inches(0.4), Inches(7.1),
                                      Inches(4), Inches(0.25))
        ff = fb.text_frame
        fp = ff.paragraphs[0]
        fp.text = f"Generated by Noodle Planner  |  {report_date}"
        fp.font.size = Pt(7)
        fp.font.color.rgb = RGBColor(160, 160, 160)

    return slide


def _parse_budget_value(budget_str):
    """Parse a budget string into a numeric value.

    Handles formats like: "$50,000", "50000", "50k", "$1.5m", "1,500,000",
    "100K", "$2M", "2.5M", etc.

    Args:
        budget_str: A string representing a budget amount.

    Returns:
        A float representing the parsed value, or None if unparsable.
    """
    import re as _re
    if not budget_str:
        return None
    text = str(budget_str).strip()
    # Remove currency symbols and whitespace
    text = _re.sub(r'[£$€¥\s,]', '', text)
    if not text:
        return None
    # Check for k/m/b suffixes
    multiplier = 1
    if text[-1].lower() == 'k':
        multiplier = 1_000
        text = text[:-1]
    elif text[-1].lower() == 'm':
        multiplier = 1_000_000
        text = text[:-1]
    elif text[-1].lower() == 'b':
        multiplier = 1_000_000_000
        text = text[:-1]
    try:
        return float(text) * multiplier
    except ValueError:
        return None


def _format_budget_total(total):
    """Format a numeric budget total as a human-readable string.

    Args:
        total: A numeric budget total.

    Returns:
        A formatted string like "$1,500,000" or "$50,000".
    """
    if total >= 1_000_000_000:
        formatted = f"${total / 1_000_000_000:,.1f}B"
    elif total >= 1_000_000:
        formatted = f"${total / 1_000_000:,.1f}M"
    elif total >= 1_000:
        formatted = f"${total:,.0f}"
    else:
        formatted = f"${total:,.0f}"
    return formatted


def _calculate_total_portfolio_budget(projects):
    """Calculate the total budget across all projects.

    Args:
        projects: List of project dicts, each with an optional 'budget' key.

    Returns:
        Total budget as a float, or None if no projects have parseable budgets.
    """
    total = 0
    has_any = False
    for proj in projects:
        value = _parse_budget_value(proj.get('budget', ''))
        if value is not None:
            total += value
            has_any = True
    return total if has_any else None


def _add_portfolio_overview_slide(prs, portfolio_data):
    """Add a portfolio overview slide with status dashboard and timeline.

    Args:
        prs: A python-pptx Presentation object.
        portfolio_data: dict with keys:
            portfolio_name (str), date (str),
            projects (list of dicts with name, status, rag, completion,
                      risk_count, start_date, end_date).
    """
    DARK_BLUE = RGBColor(33, 60, 114)
    MID_BLUE = RGBColor(54, 96, 146)
    WHITE = RGBColor(255, 255, 255)
    BLACK = RGBColor(0, 0, 0)
    LIGHT_GREY = RGBColor(242, 242, 242)
    RED = RGBColor(192, 0, 0)
    AMBER = RGBColor(218, 165, 32)
    GREEN = RGBColor(0, 128, 0)
    COMPLETE_BLUE = RGBColor(25, 118, 210)

    import re as _re

    def _sanitise_text(text):
        return _re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(text))

    def _rag_rgb(rag_str):
        val = str(rag_str).lower().strip()
        if val in ('red', 'r'):
            return RED
        if val in ('amber', 'a', 'yellow'):
            return AMBER
        if val in ('green', 'g'):
            return GREEN
        if val in ('blue', 'complete'):
            return COMPLETE_BLUE
        return BLACK

    def _set_cell_text(cell, text, font_size=8, bold=False, colour=None,
                       alignment=PP_ALIGN.LEFT):
        cell.text = _sanitise_text(text)
        for para in cell.text_frame.paragraphs:
            para.font.size = Pt(font_size)
            para.font.bold = bold
            if colour:
                para.font.color.rgb = colour
            para.alignment = alignment
        cell.text_frame.word_wrap = True
        cell.text_frame.margin_top = Inches(0.02)
        cell.text_frame.margin_bottom = Inches(0.02)
        cell.text_frame.margin_left = Inches(0.04)
        cell.text_frame.margin_right = Inches(0.04)

    def _shade_header_row(table, col_count):
        for c in range(col_count):
            cell = table.cell(0, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = DARK_BLUE

    slide = prs.slides.add_slide(prs.slide_layouts[6])  # Blank

    portfolio_name = portfolio_data.get('portfolio_name', 'Portfolio')
    report_date = portfolio_data.get('date', '')
    projects = portfolio_data.get('projects', [])

    # -- Title bar (dark blue strip) ------------------------------------------
    title_bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0), Inches(0),
        Inches(13.333), Inches(0.85)
    )
    title_bar.fill.solid()
    title_bar.fill.fore_color.rgb = DARK_BLUE
    title_bar.line.fill.background()

    tb = slide.shapes.add_textbox(Inches(0.4), Inches(0.08),
                                  Inches(8), Inches(0.45))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = _sanitise_text(f"{portfolio_name} Overview")
    p.font.size = Pt(22)
    p.font.bold = True
    p.font.color.rgb = WHITE

    # Compute total portfolio budget
    total_budget = _calculate_total_portfolio_budget(projects)

    if report_date:
        date_text = f"Date: {report_date}"
        if total_budget is not None:
            date_text += f"    |    Total Budget: {_format_budget_total(total_budget)}"
        dtb = slide.shapes.add_textbox(Inches(0.4), Inches(0.50),
                                       Inches(8), Inches(0.30))
        dtf = dtb.text_frame
        dtf.word_wrap = True
        dp = dtf.paragraphs[0]
        dp.text = _sanitise_text(date_text)
        dp.font.size = Pt(10)
        dp.font.color.rgb = WHITE
    elif total_budget is not None:
        dtb = slide.shapes.add_textbox(Inches(0.4), Inches(0.50),
                                       Inches(8), Inches(0.30))
        dtf = dtb.text_frame
        dtf.word_wrap = True
        dp = dtf.paragraphs[0]
        dp.text = _sanitise_text(f"Total Budget: {_format_budget_total(total_budget)}")
        dp.font.size = Pt(10)
        dp.font.color.rgb = WHITE

    # -- Summary badges (right side of title bar) -----------------------------
    rag_counts = {'red': 0, 'amber': 0, 'green': 0}
    for proj in projects:
        rag = str(proj.get('rag', '')).lower()
        if rag in rag_counts:
            rag_counts[rag] += 1

    # White rounded rectangle behind RAG summary for readability
    badge_bg = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(8.8), Inches(0.15),
        Inches(4.3), Inches(0.55)
    )
    badge_bg.fill.solid()
    badge_bg.fill.fore_color.rgb = WHITE
    badge_bg.line.fill.background()

    # Project count in dark text, then coloured RAG counts
    stb = slide.shapes.add_textbox(Inches(8.9), Inches(0.25),
                                   Inches(4.1), Inches(0.40))
    stf = stb.text_frame
    stf.word_wrap = True
    sp = stf.paragraphs[0]
    sp.alignment = PP_ALIGN.RIGHT

    run_proj = sp.add_run()
    run_proj.text = _sanitise_text(f"{len(projects)} Projects   ")
    run_proj.font.size = Pt(11)
    run_proj.font.bold = True
    run_proj.font.color.rgb = DARK_BLUE

    run_green = sp.add_run()
    run_green.text = _sanitise_text(f"Green: {rag_counts['green']}  ")
    run_green.font.size = Pt(11)
    run_green.font.bold = True
    run_green.font.color.rgb = GREEN

    run_amber = sp.add_run()
    run_amber.text = _sanitise_text(f"Amber: {rag_counts['amber']}  ")
    run_amber.font.size = Pt(11)
    run_amber.font.bold = True
    run_amber.font.color.rgb = AMBER

    run_red = sp.add_run()
    run_red.text = _sanitise_text(f"Red: {rag_counts['red']}")
    run_red.font.size = Pt(11)
    run_red.font.bold = True
    run_red.font.color.rgb = RED

    # -- Project Status Dashboard table ---------------------------------------
    dashboard_heading = slide.shapes.add_textbox(
        Inches(0.4), Inches(1.05), Inches(6), Inches(0.30))
    dhf = dashboard_heading.text_frame
    dhf.word_wrap = True
    dhp = dhf.paragraphs[0]
    dhp.text = "Project Status Dashboard"
    dhp.font.size = Pt(14)
    dhp.font.bold = True
    dhp.font.color.rgb = MID_BLUE

    if projects:
        table_top = Inches(1.45)
        num_rows = min(len(projects), 20) + 1  # +1 header, cap at 20
        num_cols = 6  # Name, Budget, Status, Progress, RAG, Risks
        table_width = Inches(12.533)
        table_height = Inches(0.28 * num_rows)

        tbl = slide.shapes.add_table(
            num_rows, num_cols, Inches(0.4), table_top,
            table_width, table_height
        ).table

        # Column widths
        tbl.columns[0].width = int(table_width * 28 // 100)
        tbl.columns[1].width = int(table_width * 12 // 100)
        tbl.columns[2].width = int(table_width * 18 // 100)
        tbl.columns[3].width = int(table_width * 18 // 100)
        tbl.columns[4].width = int(table_width * 10 // 100)
        tbl.columns[5].width = (int(table_width)
                                - tbl.columns[0].width
                                - tbl.columns[1].width
                                - tbl.columns[2].width
                                - tbl.columns[3].width
                                - tbl.columns[4].width)

        _shade_header_row(tbl, num_cols)
        _set_cell_text(tbl.cell(0, 0), "Project", 9, True, WHITE)
        _set_cell_text(tbl.cell(0, 1), "Budget", 9, True, WHITE, PP_ALIGN.CENTER)
        _set_cell_text(tbl.cell(0, 2), "Status", 9, True, WHITE, PP_ALIGN.CENTER)
        _set_cell_text(tbl.cell(0, 3), "Progress", 9, True, WHITE, PP_ALIGN.CENTER)
        _set_cell_text(tbl.cell(0, 4), "RAG", 9, True, WHITE, PP_ALIGN.CENTER)
        _set_cell_text(tbl.cell(0, 5), "Open Risks", 9, True, WHITE, PP_ALIGN.CENTER)

        for i, proj in enumerate(projects[:20]):
            row_idx = i + 1
            _set_cell_text(tbl.cell(row_idx, 0), proj.get('name', ''), 9)
            _set_cell_text(tbl.cell(row_idx, 1), proj.get('budget', ''),
                           8, False, None, PP_ALIGN.CENTER)
            _set_cell_text(tbl.cell(row_idx, 2), proj.get('status', ''),
                           8, False, None, PP_ALIGN.CENTER)
            completion = proj.get('completion', 0)
            _set_cell_text(tbl.cell(row_idx, 3), f"{completion}%",
                           8, False, None, PP_ALIGN.CENTER)
            rag = proj.get('rag', '')
            _set_cell_text(tbl.cell(row_idx, 4), rag.upper() if rag else '',
                           8, True, _rag_rgb(rag), PP_ALIGN.CENTER)
            _set_cell_text(tbl.cell(row_idx, 5),
                           str(proj.get('risk_count', 0)),
                           8, False, None, PP_ALIGN.CENTER)
            if row_idx % 2 == 0:
                for c in range(num_cols):
                    tbl.cell(row_idx, c).fill.solid()
                    tbl.cell(row_idx, c).fill.fore_color.rgb = LIGHT_GREY
            # White background on RAG cell so coloured text is readable
            tbl.cell(row_idx, 4).fill.solid()
            tbl.cell(row_idx, 4).fill.fore_color.rgb = WHITE

        timeline_top = table_top + table_height + Inches(0.3)
    else:
        nb = slide.shapes.add_textbox(Inches(0.4), Inches(1.45),
                                      Inches(6), Inches(0.3))
        nb.text_frame.text = "No projects in portfolio."
        nb.text_frame.paragraphs[0].font.size = Pt(9)
        nb.text_frame.paragraphs[0].font.color.rgb = RGBColor(128, 128, 128)
        timeline_top = Inches(2.0)

    # -- Portfolio Timeline ---------------------------------------------------
    timeline_image_b64 = portfolio_data.get('timeline_image')
    if timeline_image_b64:
        # Use the PNG image captured from the browser's SVG-based timeline
        import base64
        import io
        try:
            img_data = base64.b64decode(timeline_image_b64)
            img_stream = io.BytesIO(img_data)
            tl_left = Inches(0.4)
            tl_top = timeline_top
            tl_width = Inches(12.533)  # 13.333 - 0.4 - 0.4
            max_tl_height = Inches(1.8)  # Cap height to match native graphic
            pic = slide.shapes.add_picture(
                img_stream, tl_left, tl_top, width=tl_width
            )
            if pic.height > max_tl_height:
                pic.height = max_tl_height
                pic.width = tl_width
        except Exception:
            logger.warning("Failed to embed portfolio timeline image",
                           exc_info=True)

    # -- Footer ---------------------------------------------------------------
    fb = slide.shapes.add_textbox(Inches(0.4), Inches(7.1),
                                  Inches(4), Inches(0.25))
    ff = fb.text_frame
    fp = ff.paragraphs[0]
    fp.text = f"Generated by Noodle Planner  |  {report_date}"
    fp.font.size = Pt(7)
    fp.font.color.rgb = RGBColor(160, 160, 160)

    return slide


def _collect_portfolio_risks(project_reports):
    """Collect Medium and High open risks/issues across all projects.

    Aggregates risks_issues from each project report, filters to only
    Medium (score 6-15) and High (score >= 16), and sorts from high to low.

    Args:
        project_reports: list of dicts, each with 'project_name' and
            'risks_issues' (list of dicts with type, title, description,
            mitigation, score).

    Returns:
        list of dicts with project_name, type, title, description,
        mitigation, score, rag.
    """
    risks = []
    for report in project_reports:
        project_name = report.get('project_name', '')
        for item in report.get('risks_issues', []):
            score = item.get('score', 0)
            if score < 6:
                continue
            rag = 'red' if score >= 16 else 'amber'
            risks.append({
                'project_name': project_name,
                'type': item.get('type', ''),
                'title': item.get('title', ''),
                'description': item.get('description', ''),
                'mitigation': item.get('mitigation', ''),
                'score': score,
                'rag': rag,
            })
    risks.sort(key=lambda r: r['score'], reverse=True)
    return risks


def _add_portfolio_risk_slides(prs, portfolio_data, risks):
    """Add one or more portfolio risk slides showing Medium and High risks.

    Renders a table of risks with project name, type, title, description,
    mitigation, score, and RAG level. Spills over to additional slides if
    there are too many items to fit on a single slide.

    Args:
        prs: A python-pptx Presentation object.
        portfolio_data: dict with portfolio_name and date.
        risks: list of risk dicts (from _collect_portfolio_risks).

    Returns:
        list of slides added.
    """
    DARK_BLUE = RGBColor(33, 60, 114)
    MID_BLUE = RGBColor(54, 96, 146)
    WHITE = RGBColor(255, 255, 255)
    BLACK = RGBColor(0, 0, 0)
    LIGHT_GREY = RGBColor(242, 242, 242)
    RED = RGBColor(192, 0, 0)
    AMBER = RGBColor(218, 165, 32)
    GREEN = RGBColor(0, 128, 0)

    import re as _re

    def _sanitise_text(text):
        return _re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(text))

    def _set_cell_text(cell, text, font_size=8, bold=False, colour=None,
                       alignment=PP_ALIGN.LEFT):
        cell.text = _sanitise_text(text)
        for para in cell.text_frame.paragraphs:
            para.font.size = Pt(font_size)
            para.font.bold = bold
            if colour:
                para.font.color.rgb = colour
            para.alignment = alignment
        cell.text_frame.word_wrap = True
        cell.text_frame.margin_top = Inches(0.02)
        cell.text_frame.margin_bottom = Inches(0.02)
        cell.text_frame.margin_left = Inches(0.04)
        cell.text_frame.margin_right = Inches(0.04)

    def _shade_header_row(table, col_count):
        for c in range(col_count):
            cell = table.cell(0, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = DARK_BLUE

    def _score_colour(score):
        if score >= 16:
            return RED
        if score >= 6:
            return AMBER
        return GREEN

    portfolio_name = portfolio_data.get('portfolio_name', 'Portfolio')
    report_date = portfolio_data.get('date', '')

    max_rows_per_slide = 18
    slides = []
    total_pages = max(1, (len(risks) + max_rows_per_slide - 1) // max_rows_per_slide)

    for page_idx in range(total_pages):
        page_risks = risks[page_idx * max_rows_per_slide:(page_idx + 1) * max_rows_per_slide]

        slide = prs.slides.add_slide(prs.slide_layouts[6])  # Blank
        slides.append(slide)

        # -- Title bar --
        title_bar = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, Inches(0), Inches(0),
            Inches(13.333), Inches(0.85)
        )
        title_bar.fill.solid()
        title_bar.fill.fore_color.rgb = DARK_BLUE
        title_bar.line.fill.background()

        title_text = f"{portfolio_name} Risk Register"
        if total_pages > 1:
            title_text += f" ({page_idx + 1}/{total_pages})"

        tb = slide.shapes.add_textbox(Inches(0.4), Inches(0.08),
                                      Inches(8), Inches(0.45))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = _sanitise_text(title_text)
        p.font.size = Pt(22)
        p.font.bold = True
        p.font.color.rgb = WHITE

        if report_date:
            dtb = slide.shapes.add_textbox(Inches(0.4), Inches(0.50),
                                           Inches(6), Inches(0.30))
            dtf = dtb.text_frame
            dtf.word_wrap = True
            dp = dtf.paragraphs[0]
            dp.text = _sanitise_text(f"Date: {report_date}")
            dp.font.size = Pt(10)
            dp.font.color.rgb = WHITE

        # -- Summary badges (first page only) --
        if page_idx == 0:
            high_count = sum(1 for r in risks if r['rag'] == 'red')
            medium_count = sum(1 for r in risks if r['rag'] == 'amber')
            summary_text = (f"{len(risks)} Risks/Issues  |  "
                            f"High: {high_count}  Medium: {medium_count}")
            stb = slide.shapes.add_textbox(Inches(9), Inches(0.25),
                                           Inches(4), Inches(0.40))
            stf = stb.text_frame
            stf.word_wrap = True
            sp = stf.paragraphs[0]
            sp.text = _sanitise_text(summary_text)
            sp.font.size = Pt(11)
            sp.font.bold = True
            sp.font.color.rgb = WHITE
            sp.alignment = PP_ALIGN.RIGHT

        # -- Section heading --
        heading_text = "Open Risks & Issues (Medium and High)"
        heading_box = slide.shapes.add_textbox(
            Inches(0.4), Inches(1.05), Inches(6), Inches(0.30))
        hf = heading_box.text_frame
        hf.word_wrap = True
        hp = hf.paragraphs[0]
        hp.text = heading_text
        hp.font.size = Pt(14)
        hp.font.bold = True
        hp.font.color.rgb = MID_BLUE

        # -- Risk table --
        if page_risks:
            table_top = Inches(1.45)
            num_rows = len(page_risks) + 1  # +1 header
            num_cols = 7  # Project, Type, Title, Description, Mitigation, Score, RAG
            table_width = Inches(12.533)
            table_height = Inches(0.28 * num_rows)

            tbl = slide.shapes.add_table(
                num_rows, num_cols, Inches(0.4), table_top,
                table_width, table_height
            ).table

            tbl.columns[0].width = int(table_width * 12 // 100)  # Project
            tbl.columns[1].width = int(table_width * 7 // 100)   # Type
            tbl.columns[2].width = int(table_width * 18 // 100)  # Title
            tbl.columns[3].width = int(table_width * 24 // 100)  # Description
            tbl.columns[4].width = int(table_width * 24 // 100)  # Mitigation
            tbl.columns[5].width = int(table_width * 7 // 100)   # Score
            tbl.columns[6].width = (int(table_width) - tbl.columns[0].width
                                    - tbl.columns[1].width - tbl.columns[2].width
                                    - tbl.columns[3].width - tbl.columns[4].width
                                    - tbl.columns[5].width)      # RAG

            _shade_header_row(tbl, num_cols)
            _set_cell_text(tbl.cell(0, 0), "Project", 9, True, WHITE)
            _set_cell_text(tbl.cell(0, 1), "Type", 9, True, WHITE, PP_ALIGN.CENTER)
            _set_cell_text(tbl.cell(0, 2), "Title", 9, True, WHITE)
            _set_cell_text(tbl.cell(0, 3), "Description", 9, True, WHITE)
            _set_cell_text(tbl.cell(0, 4), "Mitigation", 9, True, WHITE)
            _set_cell_text(tbl.cell(0, 5), "Score", 9, True, WHITE, PP_ALIGN.CENTER)
            _set_cell_text(tbl.cell(0, 6), "RAG", 9, True, WHITE, PP_ALIGN.CENTER)

            for i, risk in enumerate(page_risks):
                row_idx = i + 1
                _set_cell_text(tbl.cell(row_idx, 0),
                               risk.get('project_name', ''), 8)
                _set_cell_text(tbl.cell(row_idx, 1),
                               risk.get('type', '').capitalize(),
                               8, True, None, PP_ALIGN.CENTER)
                _set_cell_text(tbl.cell(row_idx, 2),
                               risk.get('title', ''), 8)
                _set_cell_text(tbl.cell(row_idx, 3),
                               risk.get('description', ''), 8)
                _set_cell_text(tbl.cell(row_idx, 4),
                               risk.get('mitigation', ''), 8)
                score = risk.get('score', 0)
                _set_cell_text(tbl.cell(row_idx, 5), str(score),
                               8, True, _score_colour(score), PP_ALIGN.CENTER)
                rag = risk.get('rag', '')
                rag_label = 'HIGH' if rag == 'red' else 'MEDIUM'
                rag_colour = RED if rag == 'red' else AMBER
                _set_cell_text(tbl.cell(row_idx, 6), rag_label,
                               8, True, rag_colour, PP_ALIGN.CENTER)
                if row_idx % 2 == 0:
                    for c in range(num_cols):
                        tbl.cell(row_idx, c).fill.solid()
                        tbl.cell(row_idx, c).fill.fore_color.rgb = LIGHT_GREY
        else:
            nb = slide.shapes.add_textbox(Inches(0.4), Inches(1.45),
                                          Inches(6), Inches(0.3))
            nb.text_frame.text = "No medium or high risks/issues found."
            nb.text_frame.paragraphs[0].font.size = Pt(9)
            nb.text_frame.paragraphs[0].font.color.rgb = RGBColor(128, 128, 128)

        # -- Footer --
        fb = slide.shapes.add_textbox(Inches(0.4), Inches(7.1),
                                      Inches(4), Inches(0.25))
        ff = fb.text_frame
        fp = ff.paragraphs[0]
        fp.text = f"Generated by Noodle Planner  |  {report_date}"
        fp.font.size = Pt(7)
        fp.font.color.rgb = RGBColor(160, 160, 160)

    return slides


def export_portfolio_to_powerpoint(output_path, portfolio_data, project_reports):
    """Export a portfolio report as a multi-slide PowerPoint deck.

    Creates a presentation with:
      - Slide 1: Portfolio overview (status dashboard + timeline)
      - Slide 2+: Portfolio risk register (Medium and High risks, may span
        multiple slides)
      - Remaining slides: One slide per project (same layout as single-project
        report)

    Args:
        output_path: Path to save the PowerPoint file.
        portfolio_data: dict with keys:
            portfolio_name (str), date (str),
            projects (list of dicts with name, status, rag, completion,
                      risk_count, start_date, end_date).
        project_reports: list of dicts, each matching the ReportExportRequest
            schema (project_name, manager, sponsor, etc.).
    """
    prs = Presentation()
    prs.slide_width = Inches(13.333)   # Widescreen 16:9
    prs.slide_height = Inches(7.5)

    # Slide 1: Portfolio overview
    _add_portfolio_overview_slide(prs, portfolio_data)

    # Slide 2+: Portfolio risk register
    portfolio_risks = _collect_portfolio_risks(project_reports)
    _add_portfolio_risk_slides(prs, portfolio_data, portfolio_risks)

    # Remaining slides: Individual project reports (no footer on these;
    # the overview and risk slides already carry the generation footer)
    for report_data in project_reports:
        _add_report_slide(prs, report_data, include_footer=False)

    prs.save(output_path)
    logger.info(f"Exported portfolio report to PowerPoint: {output_path}")


def export_to_excel(text, output_path, is_yaml=True, project_name="Project", original_text=None):
    """Export project data to Excel format.

    Args:
        text: Input text (YAML or natural language)
        output_path: Path to save the Excel file
        is_yaml: If True, parse as YAML; if False, parse as natural language
        project_name: Project name to use
        original_text: Original text before conversion (for extracting resource mappings)
    """
    # Parse resource mappings from original text if provided
    resource_map = {}
    baseline_lookup = {}
    if original_text:
        resource_map, _ = parse_resource_mappings(original_text)
        # Extract baseline items for milestone comparison
        baseline_text = extract_baseline(original_text)
        if baseline_text:
            baseline_items_list = parse_baseline_markdown(baseline_text)
            baseline_lookup = {item['name']: item for item in baseline_items_list}

    # Parse the text to get tasks and project info
    if is_yaml:
        data = yaml.safe_load(text)
        project_name = list(data.keys())[0]
        phases_raw = data[project_name]
    else:
        # Parse natural language
        data = natural_language_to_yaml(text, project_name)
        phases_raw = data[project_name]

    # If phases_raw is a list, pass as-is; if dict, wrap in a list
    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []

    # Schedule tasks
    tasks = schedule_tasks(phases)

    # Create workbook
    wb = Workbook()

    # Define styles
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center")

    # Create Tasks sheet
    ws_tasks = wb.active
    ws_tasks.title = "Tasks"

    # Task headers (removed Phase column, added RAG, Priority, Bucket)
    task_headers = ['ID', 'Task Name', 'Start', 'Finish', 'Duration (days)',
                    'Resources', '% Complete', 'RAG', 'Priority', 'Bucket', 'Comment']
    ws_tasks.append(task_headers)

    # Style header row
    for col_num, header in enumerate(task_headers, 1):
        cell = ws_tasks.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment

    # Add task data
    task_row_num = 2
    for idx, task in enumerate(tasks, start=1):
        # Calculate duration more robustly
        duration = task.get('duration')
        if isinstance(duration, timedelta):
            duration_days = duration.days
        elif task.get('start') and task.get('finish'):
            # Calculate from date difference
            duration_days = (task.get('finish') - task.get('start')).days
        else:
            duration_days = 0

        # Get task name and apply indentation based on level
        task_name = task.get('description', task.get('name', ''))

        # Convert snake_case to readable names with spaces
        task_name = task_name.replace('_', ' ')

        level = task.get('level', 0)
        if level > 0:
            indent = '  ' * level  # 2 spaces per level
            task_name = f"{indent}{task_name}"

        # Get resources and map to full names if available
        resources_str = task.get('resources', '')
        if resources_str and resource_map:
            # Split multiple resources, map each one, and join back (case-insensitive)
            resource_list = [r.strip() for r in resources_str.split(',')]
            mapped_resources = [resource_map.get(r.lower(), r) for r in resource_list]
            resources_str = ', '.join(mapped_resources)

        # Calculate RAG status (skip for summary tasks)
        if task.get('summary'):
            rag_status = ''
        else:
            rag_status = calculate_rag_status(task)

        row = [
            idx,
            task_name,
            task.get('start').strftime('%Y-%m-%d') if task.get('start') else '',
            task.get('finish').strftime('%Y-%m-%d') if task.get('finish') else '',
            duration_days,
            resources_str,
            task.get('percent', 0) if task.get('percent') else '',
            rag_status,
            task.get('priority', 'Low'),
            task.get('bucket', ''),
            task.get('comment', '')
        ]
        ws_tasks.append(row)

        # Bold summary tasks
        if task.get('summary'):
            for col_num in range(1, len(task_headers) + 1):
                cell = ws_tasks.cell(row=task_row_num, column=col_num)
                cell.font = Font(bold=True)

        # Color RAG status cell
        if rag_status:
            rag_col_num = 8  # RAG is the 8th column
            rag_cell = ws_tasks.cell(row=task_row_num, column=rag_col_num)
            colour = rag_status_to_colour(rag_status)
            if colour == 'green':
                rag_cell.fill = PatternFill(start_color="92D050", end_color="92D050", fill_type="solid")
            elif colour == 'amber':
                rag_cell.fill = PatternFill(start_color="FFC000", end_color="FFC000", fill_type="solid")
            elif colour == 'red':
                rag_cell.fill = PatternFill(start_color="FF0000", end_color="FF0000", fill_type="solid")
                rag_cell.font = Font(color="FFFFFF", bold=True)
            elif colour == 'blue':
                rag_cell.fill = PatternFill(start_color="1976D2", end_color="1976D2", fill_type="solid")
                rag_cell.font = Font(color="FFFFFF", bold=True)

        task_row_num += 1

    # Auto-adjust column widths
    for col_num, header in enumerate(task_headers, 1):
        column_letter = get_column_letter(col_num)
        max_length = len(header)
        for row in ws_tasks.iter_rows(min_row=2, max_col=col_num, max_row=ws_tasks.max_row):
            cell_value = str(row[col_num-1].value) if row[col_num-1].value else ''
            max_length = max(max_length, len(cell_value))
        ws_tasks.column_dimensions[column_letter].width = min(max_length + 2, 50)

    # Create Milestones sheet
    ws_milestones = wb.create_sheet("Milestones")
    has_baseline = len(baseline_lookup) > 0
    milestone_headers = ['Milestone', 'Type', 'Date']
    if has_baseline:
        milestone_headers.extend(['Baseline Finish', 'Variance (days)'])
    ws_milestones.append(milestone_headers)

    # Style header row
    for col_num, header in enumerate(milestone_headers, 1):
        cell = ws_milestones.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment

    # Group tasks by phase to find phase dates
    phase_dates = {}
    for t in tasks:
        phase = t.get('phase')
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': t.get('start'), 'end': t.get('finish')}
            else:
                if t.get('start') and (not phase_dates[phase]['start'] or t.get('start') < phase_dates[phase]['start']):
                    phase_dates[phase]['start'] = t.get('start')
                if t.get('finish') and (not phase_dates[phase]['end'] or t.get('finish') > phase_dates[phase]['end']):
                    phase_dates[phase]['end'] = t.get('finish')

    # Add phase milestones
    milestone_entries = []
    for phase, dates in phase_dates.items():
        milestone_entries.append({
            'name': phase,
            'type': 'Phase',
            'date': dates['end']
        })

    # Add summary task milestones
    for t in tasks:
        if t.get('summary'):
            milestone_entries.append({
                'name': t.get('description', t.get('name', '')),
                'type': 'Summary',
                'date': t.get('finish')
            })

    # Add 0-duration milestones
    for t in tasks:
        duration = t.get('duration', timedelta(days=1))
        if isinstance(duration, timedelta) and duration.days == 0:
            milestone_entries.append({
                'name': t.get('description', t.get('name', '')),
                'type': 'Milestone',
                'date': t.get('start')
            })

    # Remove duplicates and sort
    seen = set()
    unique_milestones = []
    for entry in milestone_entries:
        key = (entry['name'], entry['date'])
        if key not in seen:
            seen.add(key)
            unique_milestones.append(entry)

    unique_milestones.sort(key=lambda x: x['date'] if x['date'] else datetime.now())

    # Add milestone data
    for milestone in unique_milestones:
        row = [
            milestone['name'],
            milestone['type'],
            milestone['date'].strftime('%Y-%m-%d') if milestone['date'] else ''
        ]
        if has_baseline:
            bl = baseline_lookup.get(milestone['name'])
            bl_finish = bl.get('finish', '') if bl else ''
            row.append(bl_finish)
            # Calculate variance in days
            if bl_finish and milestone['date']:
                try:
                    from datetime import date as date_type
                    bl_date = datetime.strptime(bl_finish, '%Y-%m-%d').date() if isinstance(bl_finish, str) else bl_finish
                    current_date = milestone['date'].date() if isinstance(milestone['date'], datetime) else milestone['date']
                    diff = (current_date - bl_date).days
                    if diff > 0:
                        row.append(f'+{diff}')
                    elif diff < 0:
                        row.append(str(diff))
                    else:
                        row.append('0')
                except (ValueError, TypeError):
                    row.append('')
            else:
                row.append('New' if not bl else '')
        ws_milestones.append(row)

    # Auto-adjust column widths
    for col_num, header in enumerate(milestone_headers, 1):
        column_letter = get_column_letter(col_num)
        max_length = len(header)
        for row in ws_milestones.iter_rows(min_row=2, max_col=col_num, max_row=ws_milestones.max_row):
            cell_value = str(row[col_num-1].value) if row[col_num-1].value else ''
            max_length = max(max_length, len(cell_value))
        ws_milestones.column_dimensions[column_letter].width = min(max_length + 2, 50)

    # Create Resources Timesheet sheet
    if tasks:
        # Filter tasks with dates and resources
        tasks_with_dates = [t for t in tasks if t.get('start') and t.get('finish') and t.get('resources') and not t.get('summary')]

        if tasks_with_dates:
            start_date = min([t.get('start') for t in tasks_with_dates])
            finish_date = max([t.get('finish') for t in tasks_with_dates])

            ws_resources = wb.create_sheet("Resources")

            # Generate date range
            date_range = []
            current = start_date
            while current <= finish_date:
                date_range.append(current)
                current += timedelta(days=1)

            # Build header row with day of week and date
            resource_headers = ['Resource']
            for date in date_range:
                day_of_week = date.strftime('%a')  # Mon, Tue, etc
                day = date.strftime('%d')
                month = date.strftime('%b').lower()
                resource_headers.append(f"{day_of_week} {day} {month}")

            ws_resources.append(resource_headers)

            # Style header row
            for col_num, header in enumerate(resource_headers, 1):
                cell = ws_resources.cell(row=1, column=col_num)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = header_alignment

                # Make weekend headers black text on gray background
                if col_num > 1:
                    date = date_range[col_num - 2]
                    if date.weekday() in [5, 6]:  # Saturday or Sunday
                        cell.fill = PatternFill(start_color="D3D3D3", end_color="D3D3D3", fill_type="solid")
                        cell.font = Font(color="000000", bold=True)

            # Calculate resource allocation per day
            resource_daily_hours = {}

            for task in tasks_with_dates:
                resources_str = task.get('resources', '')
                if resources_str:
                    task_resources = [r.strip() for r in resources_str.split(',')]
                    task_start = task.get('start')
                    task_finish = task.get('finish')

                    # Calculate days task spans
                    task_duration_days = (task_finish - task_start).days + 1

                    # Get total duration in days from task (this is effort days)
                    duration = task.get('duration', timedelta(days=0))
                    if isinstance(duration, timedelta):
                        effort_days = duration.days
                    else:
                        effort_days = 0

                    # Hours per day = (effort_days * 8) / task_duration_days / num_resources
                    if task_duration_days > 0 and len(task_resources) > 0:
                        hours_per_day = (effort_days * 8.0) / task_duration_days / len(task_resources)

                        # Add hours for each day
                        current = task_start
                        while current <= task_finish:
                            date_key = current.strftime('%Y-%m-%d')

                            for resource in task_resources:
                                resource_key = resource.lower()
                                if resource_key not in resource_daily_hours:
                                    resource_daily_hours[resource_key] = {'display_name': resource, 'hours': {}}

                                if date_key not in resource_daily_hours[resource_key]['hours']:
                                    resource_daily_hours[resource_key]['hours'][date_key] = 0

                                resource_daily_hours[resource_key]['hours'][date_key] += hours_per_day

                            current += timedelta(days=1)

            # Add resource data rows
            for resource_key in sorted(resource_daily_hours.keys()):
                display_name = resource_daily_hours[resource_key]['display_name']
                hours_dict = resource_daily_hours[resource_key]['hours']

                row = [display_name]
                for date in date_range:
                    date_key = date.strftime('%Y-%m-%d')
                    hours = hours_dict.get(date_key, 0)
                    if hours > 0:
                        row.append(round(hours, 1))
                    else:
                        row.append('-')

                ws_resources.append(row)

                # Color code cells based on hours
                row_num = ws_resources.max_row
                for col_num in range(2, len(resource_headers) + 1):
                    cell = ws_resources.cell(row=row_num, column=col_num)
                    cell.alignment = Alignment(horizontal="center")

                    date = date_range[col_num - 2]
                    is_weekend = date.weekday() in [5, 6]

                    if cell.value == '-':
                        if is_weekend:
                            cell.fill = PatternFill(start_color="F5F5F5", end_color="F5F5F5", fill_type="solid")
                    else:
                        hours = float(cell.value)
                        if hours <= 4:
                            # Low hours - green
                            cell.fill = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")
                            cell.font = Font(color="2E7D32")
                        elif hours <= 8:
                            # Normal hours - orange
                            cell.fill = PatternFill(start_color="FFF3E0", end_color="FFF3E0", fill_type="solid")
                            cell.font = Font(color="E65100")
                        else:
                            # High hours - red
                            cell.fill = PatternFill(start_color="FFEBEE", end_color="FFEBEE", fill_type="solid")
                            cell.font = Font(color="C62828", bold=True)

                        if is_weekend:
                            # Override with weekend background but keep text color
                            current_color = cell.font.color
                            cell.fill = PatternFill(start_color="F5F5F5", end_color="F5F5F5", fill_type="solid")

            # Auto-adjust column widths
            for col_num, header in enumerate(resource_headers, 1):
                column_letter = get_column_letter(col_num)
                max_length = len(header)
                for row in ws_resources.iter_rows(min_row=2, max_col=col_num, max_row=ws_resources.max_row):
                    cell_value = str(row[col_num-1].value) if row[col_num-1].value else ''
                    max_length = max(max_length, len(cell_value))
                ws_resources.column_dimensions[column_letter].width = min(max_length + 2, 50)

    # Create Budget sheet if original_text contains budget items (outside 'if tasks' block)
    if original_text:
        budget_text = extract_budget(original_text)
        if budget_text:
            budget_items = parse_budget_markdown(budget_text)
            if budget_items:
                ws_budget = wb.create_sheet("Budget")

                budget_headers = [
                    'ID', 'Description', 'Estimate', 'Forecast', 'Type',
                    'Invoice', 'PO', 'Supplier', 'Total', 'Ordered',
                    'Received', 'Category'
                ]

                ws_budget.append(budget_headers)

                # Style header row
                budget_header_fill = PatternFill(start_color="667eea", end_color="667eea", fill_type="solid")
                budget_header_font = Font(bold=True, color="FFFFFF", size=11)

                for col_num, header in enumerate(budget_headers, 1):
                    cell = ws_budget.cell(row=1, column=col_num)
                    cell.fill = budget_header_fill
                    cell.font = budget_header_font
                    cell.alignment = Alignment(horizontal='center')

                # Number format for currency columns
                currency_cols = {3, 4, 9}  # Estimate, Forecast, Total

                # Add budget data
                for row_idx, item in enumerate(budget_items, 2):
                    ws_budget.cell(row=row_idx, column=1, value=item.get('id', ''))
                    ws_budget.cell(row=row_idx, column=2, value=item.get('description', ''))

                    for col_num in currency_cols:
                        field = budget_headers[col_num - 1].lower()
                        val = item.get(field, 0)
                        cell = ws_budget.cell(row=row_idx, column=col_num, value=val)
                        cell.number_format = '#,##0.00'

                    ws_budget.cell(row=row_idx, column=5, value=item.get('type', ''))
                    ws_budget.cell(row=row_idx, column=6, value=item.get('invoice', ''))
                    ws_budget.cell(row=row_idx, column=7, value=item.get('po', ''))
                    ws_budget.cell(row=row_idx, column=8, value=item.get('supplier', ''))
                    ws_budget.cell(row=row_idx, column=10, value=item.get('date_ordered', ''))
                    ws_budget.cell(row=row_idx, column=11, value=item.get('date_received', ''))
                    ws_budget.cell(row=row_idx, column=12, value=item.get('category', ''))

                # Summary row
                last_row = len(budget_items) + 2
                total_estimate = sum(item.get('estimate', 0) for item in budget_items)
                total_forecast = sum(item.get('forecast', 0) for item in budget_items)
                total_spend = sum(item.get('total', 0) for item in budget_items)

                ws_budget.cell(row=last_row, column=2, value='TOTALS').font = Font(bold=True)
                for col_num, val in [(3, total_estimate), (4, total_forecast), (9, total_spend)]:
                    cell = ws_budget.cell(row=last_row, column=col_num, value=val)
                    cell.font = Font(bold=True)
                    cell.number_format = '#,##0.00'

                # Set column widths
                budget_col_widths = [6, 30, 12, 12, 10, 15, 12, 20, 12, 12, 12, 18]
                for col_num, width in enumerate(budget_col_widths, 1):
                    ws_budget.column_dimensions[get_column_letter(col_num)].width = width

    # Create RAID Log sheet if original_text contains RAID items (outside 'if tasks' block)
    if original_text:
        raid_log_text = extract_raid_log(original_text)
        if raid_log_text:
            raid_items = parse_raid_markdown(raid_log_text)
            if raid_items:
                ws_raid = wb.create_sheet("RAID Log")

                raid_headers = [
                    'ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner',
                    'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status',
                    'Priority', 'Target Date'
                ]

                ws_raid.append(raid_headers)

                # Style header row
                raid_header_fill = PatternFill(start_color="667eea", end_color="667eea", fill_type="solid")
                raid_header_font = Font(bold=True, color="FFFFFF", size=11)

                for col_num, header in enumerate(raid_headers, 1):
                    cell = ws_raid.cell(row=1, column=col_num)
                    cell.fill = raid_header_fill
                    cell.font = raid_header_font
                    cell.alignment = Alignment(horizontal='center')

                # Add RAID data
                for row_idx, item in enumerate(raid_items, 2):
                    ws_raid.cell(row=row_idx, column=1, value=item.get('id', ''))
                    ws_raid.cell(row=row_idx, column=2, value=item.get('type', '').capitalize())
                    ws_raid.cell(row=row_idx, column=3, value=item.get('title', ''))
                    ws_raid.cell(row=row_idx, column=4, value=item.get('description', ''))
                    ws_raid.cell(row=row_idx, column=5, value=item.get('raised_by', ''))
                    ws_raid.cell(row=row_idx, column=6, value=item.get('owner', ''))
                    ws_raid.cell(row=row_idx, column=7, value=item.get('mitigation_actions', ''))
                    ws_raid.cell(row=row_idx, column=8, value=item.get('impact', ''))
                    ws_raid.cell(row=row_idx, column=9, value=item.get('likelihood', ''))

                    score = item.get('score', 0)
                    score_cell = ws_raid.cell(row=row_idx, column=10, value=score)
                    # Color code score cell
                    if score >= 16:
                        score_cell.fill = PatternFill(start_color="FFE0E0", end_color="FFE0E0", fill_type="solid")
                    elif score >= 6:
                        score_cell.fill = PatternFill(start_color="FFF3BF", end_color="FFF3BF", fill_type="solid")
                    else:
                        score_cell.fill = PatternFill(start_color="D3F9D8", end_color="D3F9D8", fill_type="solid")

                    ws_raid.cell(row=row_idx, column=11, value=item.get('status', '').capitalize())
                    ws_raid.cell(row=row_idx, column=12, value=item.get('priority', ''))
                    ws_raid.cell(row=row_idx, column=13, value=item.get('target_date', item.get('date', '')))

                # Set column widths using named constants
                for col_num, header in enumerate(raid_headers, 1):
                    width = RAID_COLUMN_WIDTHS.get(header, 15)  # Default to 15 if not found
                    ws_raid.column_dimensions[get_column_letter(col_num)].width = width

    # Create Stakeholders sheet if original_text contains stakeholder entries
    if original_text:
        stakeholder_items = parse_stakeholders_from_frontmatter(original_text)
        if stakeholder_items:
            ws_stakeholders = wb.create_sheet("Stakeholders")

            stakeholder_headers = ['Name', 'Role', 'Interest', 'Influence']
            ws_stakeholders.append(stakeholder_headers)

            # Style header row
            stakeholder_header_fill = PatternFill(start_color="667eea", end_color="667eea", fill_type="solid")
            stakeholder_header_font = Font(bold=True, color="FFFFFF", size=11)

            for col_num, header_text in enumerate(stakeholder_headers, 1):
                cell = ws_stakeholders.cell(row=1, column=col_num)
                cell.fill = stakeholder_header_fill
                cell.font = stakeholder_header_font
                cell.alignment = Alignment(horizontal='center')

            # Add stakeholder data
            for row_idx, item in enumerate(stakeholder_items, 2):
                ws_stakeholders.cell(row=row_idx, column=1, value=item.get('name', ''))
                ws_stakeholders.cell(row=row_idx, column=2, value=item.get('role', ''))

                interest_val = item.get('interest', 'low').capitalize()
                interest_cell = ws_stakeholders.cell(row=row_idx, column=3, value=interest_val)
                if interest_val.lower() == 'high':
                    interest_cell.fill = PatternFill(start_color="FFE0E0", end_color="FFE0E0", fill_type="solid")
                else:
                    interest_cell.fill = PatternFill(start_color="D3F9D8", end_color="D3F9D8", fill_type="solid")

                influence_val = item.get('influence', 'low').capitalize()
                influence_cell = ws_stakeholders.cell(row=row_idx, column=4, value=influence_val)
                if influence_val.lower() == 'high':
                    influence_cell.fill = PatternFill(start_color="FFE0E0", end_color="FFE0E0", fill_type="solid")
                else:
                    influence_cell.fill = PatternFill(start_color="D3F9D8", end_color="D3F9D8", fill_type="solid")

            # Set column widths
            stakeholder_col_widths = [25, 30, 12, 12]
            for col_num, width in enumerate(stakeholder_col_widths, 1):
                ws_stakeholders.column_dimensions[get_column_letter(col_num)].width = width

    # Create EVM sheet with calculated Earned Value Management metrics
    if tasks:
        budget_items_for_evm = None
        if original_text:
            budget_text = extract_budget(original_text)
            if budget_text:
                budget_items_for_evm = parse_budget_markdown(budget_text)

        evm_data = calculate_evm(tasks, budget_items_for_evm)
        if evm_data:
            ws_evm = wb.create_sheet("EVM")

            # EVM header styling
            evm_header_fill = PatternFill(start_color="667eea", end_color="667eea", fill_type="solid")
            evm_header_font = Font(bold=True, color="FFFFFF", size=11)

            # Add EVM metrics as a key-value table
            evm_headers = ['Metric', 'Value']
            ws_evm.append(evm_headers)

            for col_num, header_text in enumerate(evm_headers, 1):
                cell = ws_evm.cell(row=1, column=col_num)
                cell.fill = evm_header_fill
                cell.font = evm_header_font
                cell.alignment = Alignment(horizontal='center')

            fmt = lambda v: round(v, 2)
            fmt_pct = lambda v: f"{round(v, 1)}%"
            fmt_idx = lambda v: round(v, 2)

            evm_rows = [
                ('% Complete', fmt_pct(evm_data['overall_percent_complete'])),
                ('BAC (Budget at Completion)', fmt(evm_data['BAC'])),
                ('PV (Planned Value)', fmt(evm_data['PV'])),
                ('EV (Earned Value)', fmt(evm_data['EV'])),
                ('AC (Actual Cost)', fmt(evm_data['AC'])),
                ('CV (Cost Variance)', fmt(evm_data['CV'])),
                ('SV (Schedule Variance)', fmt(evm_data['SV'])),
                ('CPI (Cost Performance Index)', fmt_idx(evm_data['CPI'])),
                ('SPI (Schedule Performance Index)', fmt_idx(evm_data['SPI'])),
                ('EAC (Estimate at Completion)', fmt(evm_data['EAC'])),
                ('ETC (Estimate to Complete)', fmt(evm_data['ETC'])),
                ('VAC (Variance at Completion)', fmt(evm_data['VAC'])),
                ('Project Start', evm_data['project_start'].strftime('%Y-%m-%d') if evm_data.get('project_start') else ''),
                ('Project End', evm_data['project_end'].strftime('%Y-%m-%d') if evm_data.get('project_end') else ''),
                ('Time Elapsed', fmt_pct(evm_data['time_elapsed_fraction'] * 100)),
                ('Budget Data Available', 'Yes' if evm_data.get('has_budget_data') else 'No (using duration proxy)'),
            ]

            for row_data in evm_rows:
                ws_evm.append(list(row_data))

            # Color-code variance rows
            for row_idx in range(2, len(evm_rows) + 2):
                metric_cell = ws_evm.cell(row=row_idx, column=1)
                value_cell = ws_evm.cell(row=row_idx, column=2)
                metric_name = metric_cell.value or ''

                if metric_name.startswith('CV') or metric_name.startswith('SV') or metric_name.startswith('VAC'):
                    try:
                        val = float(value_cell.value)
                        if val >= 0:
                            value_cell.fill = PatternFill(start_color="D3F9D8", end_color="D3F9D8", fill_type="solid")
                        else:
                            value_cell.fill = PatternFill(start_color="FFE0E0", end_color="FFE0E0", fill_type="solid")
                    except (ValueError, TypeError):
                        pass
                elif metric_name.startswith('CPI') or metric_name.startswith('SPI'):
                    try:
                        val = float(value_cell.value)
                        if val >= 1:
                            value_cell.fill = PatternFill(start_color="D3F9D8", end_color="D3F9D8", fill_type="solid")
                        else:
                            value_cell.fill = PatternFill(start_color="FFE0E0", end_color="FFE0E0", fill_type="solid")
                    except (ValueError, TypeError):
                        pass

            # Set column widths
            ws_evm.column_dimensions['A'].width = 35
            ws_evm.column_dimensions['B'].width = 25

    # Save workbook
    wb.save(output_path)
    logger.info(f"Exported project data to {output_path}")

def text_to_markdown_table(text, is_yaml=True, project_name="Project", terminal_width=80, original_text=None):
    """Convert text (YAML or natural language) to markdown table.

    Args:
        text: Input text (YAML or natural language)
        is_yaml: If True, parse as YAML; if False, parse as natural language
        project_name: Project name to use
        terminal_width: Width of terminal for formatting
        original_text: Original text before conversion (for extracting resource mappings)
    """
    today = datetime.today()

    # Parse resource mappings and non-working days from original text if provided
    resource_map = {}
    resource_nwd = {}
    project_holidays = set()
    if original_text:
        resource_map, resource_nwd = parse_resource_mappings(original_text)
        from .front_matter_parser import FrontMatterParser
        _fm_parser = FrontMatterParser(original_text)
        project_holidays = _fm_parser.parse_non_working_days()

    if is_yaml:
        data = yaml.safe_load(text)
        project_name = list(data.keys())[0]
        phases_raw = data[project_name]
    else:
        # Parse natural language
        data = natural_language_to_yaml(text, project_name)
        phases_raw = data[project_name]

    # If phases_raw is a list, pass as-is; if dict, wrap in a list
    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []
    tasks = schedule_tasks(phases, holidays=project_holidays, resource_non_working_days=resource_nwd)

    # Compute phase timelines
    phase_dates = {}
    for t in tasks:
        phase = t.get('phase')
        start = t.get('start') or today
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': start, 'end': finish}
            else:
                if start < phase_dates[phase]['start']:
                    phase_dates[phase]['start'] = start
                if finish > phase_dates[phase]['end']:
                    phase_dates[phase]['end'] = finish

    # Markdown table for tasks
    # First pass: Calculate column widths
    # Use shorter headers for better terminal fit
    col_widths = {
        'id': len('ID'),
        'task_name': len('Task Name'),
        'start': len('Start'),
        'finish': len('Finish'),
        'duration': len('Dur'),
        'resources': len('Res'),
        'percent': len('%'),
        'rag': len('RAG'),
        'comment': len('Comment')
    }

    # Prepare task data for rendering
    # Use shorter date format for narrow terminals
    date_format = '%d %b' if terminal_width < 100 else '%Y-%m-%d'

    task_rows = []
    for idx, t in enumerate(tasks, start=1):
        start = t.get('start') or today
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        resources = t.get('resources','')
        if resources:
            resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
            # Map to full names if available (case-insensitive)
            if resource_map:
                resource_list = [r.strip() for r in resources.split(',')]
                mapped_resources = [resource_map.get(r.lower(), r) for r in resource_list]
                resources = ', '.join(mapped_resources)
        percent = t.get('percent', '')
        comment = t.get('comment','')

        # Calculate RAG status (skip for summary tasks)
        if t.get('summary'):
            rag_status = ''
        else:
            rag_status = calculate_rag_status(t)

        # Use description as task name, fallback to name if no description
        task_name = t.get('description') or t.get('name', '')

        # Indent based on level (0=no indent, 1=2 spaces, 2=4 spaces, etc.)
        level = t.get('level', 0)
        if level > 0:
            indent = '  ' * level  # Use 2 spaces per level for cleaner terminal output
            task_name = f"{indent}{task_name}"

        # Store row data
        row = {
            'id': str(idx),
            'task_name': task_name,
            'start': start.strftime(date_format),
            'finish': finish.strftime(date_format),
            'duration': f"{t.get('duration',timedelta(days=1)).days}d",
            'resources': str(resources),
            'percent': str(percent),
            'rag': rag_status,
            'comment': str(comment)
        }
        task_rows.append(row)

        # Update column widths (except comment which we'll limit later)
        for key, value in row.items():
            if key != 'comment':
                col_widths[key] = max(col_widths[key], len(value))

    # Calculate available width for comment column
    # Account for column separators (| between each column + padding)
    fixed_width = (col_widths['id'] + col_widths['task_name'] + col_widths['start'] +
                   col_widths['finish'] + col_widths['duration'] + col_widths['resources'] +
                   col_widths['percent'] + col_widths['rag'])
    # Add space for separators and padding: 8 columns means 7 separators * 3 chars each = 21
    separators = 7 * 3
    available_for_comment = terminal_width - fixed_width - separators - 5  # Extra buffer

    # Limit comment width
    max_comment_width = max(len('Comment'), min(50, available_for_comment))
    col_widths['comment'] = max_comment_width

    # Truncate comments in task_rows if needed
    for row in task_rows:
        if len(row['comment']) > max_comment_width:
            row['comment'] = row['comment'][:max_comment_width - 3] + '...'

    # Second pass: Generate table with proper padding
    md = f"# {project_name}\n\n"

    # Header row (shorter headers, no leading/trailing |)
    md += f"{'ID':<{col_widths['id']}} | {'Task Name':<{col_widths['task_name']}} | {'Start':<{col_widths['start']}} | {'Finish':<{col_widths['finish']}} | {'Dur':>{col_widths['duration']}} | {'Res':^{col_widths['resources']}} | {'%':^{col_widths['percent']}} | {'RAG':^{col_widths['rag']}} | {'Comment':<{col_widths['comment']}}\n"

    # Separator row (no leading/trailing |)
    md += f"{'-' * (col_widths['id'] + 1)}|{'-' * (col_widths['task_name'] + 2)}|{'-' * (col_widths['start'] + 2)}|{'-' * (col_widths['finish'] + 2)}|{'-' * (col_widths['duration'] + 2)}|{'-' * (col_widths['resources'] + 2)}|{'-' * (col_widths['percent'] + 2)}|{'-' * (col_widths['rag'] + 2)}|{'-' * (col_widths['comment'])}\n"

    # Data rows (no leading/trailing |)
    for row in task_rows:
        md += f"{row['id']:<{col_widths['id']}} | {row['task_name']:<{col_widths['task_name']}} | {row['start']:<{col_widths['start']}} | {row['finish']:<{col_widths['finish']}} | {row['duration']:>{col_widths['duration']}} | {row['resources']:^{col_widths['resources']}} | {row['percent']:^{col_widths['percent']}} | {row['rag']:^{col_widths['rag']}} | {row['comment']:<{col_widths['comment']}}\n"

    # Timeline output block
    milestones = []
    # Show timeline if there are phases OR if there are tasks (even without phases)
    if phase_dates or tasks:
        # Build list of milestone entries (phases, summary tasks, and 0-duration tasks)
        milestone_entries = []

        # Add phases (if any)
        for phase, dates in phase_dates.items():
            milestone_entries.append({
                'name': phase,
                'start': dates['start'],
                'end': dates['end'],
                'type': 'phase'
            })

        # Add summary tasks
        for t in tasks:
            if t.get('summary'):
                milestone_entries.append({
                    'name': t.get('description', t.get('name', '')),
                    'start': t.get('start'),
                    'end': t.get('finish'),
                    'type': 'summary'
                })

        # Add 0-duration milestones
        for t in tasks:
            duration = t.get('duration', timedelta(days=1))
            if isinstance(duration, timedelta) and duration.days == 0:
                milestone_name = t.get('description', t.get('name', ''))
                # Replace underscores with spaces for display
                display_name = milestone_name.replace('_', ' ')
                milestone_entries.append({
                    'name': display_name,
                    'start': t.get('start'),
                    'end': t.get('start'),  # Same as start for milestones
                    'type': 'milestone'
                })
                milestones.append({
                    'name': display_name,
                    'date': t.get('start'),
                    'percent': t.get('percent', 0)  # Include percent for milestone rendering
                })

        # If no phases, add all tasks as milestones for the timeline
        if not phase_dates:
            for t in tasks:
                # Skip summary tasks (already added above)
                if t.get('summary'):
                    continue
                task_name = t.get('description', t.get('name', ''))
                # Replace underscores with spaces for display
                display_name = task_name.replace('_', ' ')
                milestone_entries.append({
                    'name': display_name,
                    'start': t.get('start'),
                    'end': t.get('finish'),
                    'type': 'task'
                })
                # Add task completion as a milestone for the visual timeline
                milestones.append({'name': f"{display_name}", 'date': t.get('finish')})

        # Remove duplicates (same name and dates) - keep phases over summaries
        seen = set()
        unique_entries = []
        for entry in milestone_entries:
            key = (entry['name'], entry['start'], entry['end'])
            if key not in seen:
                seen.add(key)
                unique_entries.append(entry)

        milestone_entries = unique_entries

        # Sort by start date
        milestone_entries.sort(key=lambda x: x['start'] if x['start'] else datetime.now())

        # Calculate column widths for Project Milestones table
        timeline_widths = {
            'name': len('Milestone'),
            'start': len('Start'),
            'end': len('End')
        }
        for entry in milestone_entries:
            timeline_widths['name'] = max(timeline_widths['name'], len(entry['name']))
            if entry['start']:
                timeline_widths['start'] = max(timeline_widths['start'], len(entry['start'].strftime(date_format)))
            if entry['end']:
                timeline_widths['end'] = max(timeline_widths['end'], len(entry['end'].strftime(date_format)))

        # Project Milestones header
        md += f"\n# Project Milestones\n\n{'Milestone':<{timeline_widths['name']}} | {'Start':<{timeline_widths['start']}} | {'End':<{timeline_widths['end']}}\n"
        md += f"{'-' * (timeline_widths['name'] + 1)}|{'-' * (timeline_widths['start'] + 2)}|{'-' * (timeline_widths['end'] + 1)}\n"

        for entry in milestone_entries:
            start_str = entry['start'].strftime(date_format) if entry['start'] else ''
            end_str = entry['end'].strftime(date_format) if entry['end'] else ''
            md += f"{entry['name']:<{timeline_widths['name']}} | {start_str:<{timeline_widths['start']}} | {end_str:<{timeline_widths['end']}}\n"

        # End of each phase is also a milestone for the visual timeline
        for phase, dates in phase_dates.items():
            # Replace underscores with spaces for display
            display_phase = phase.replace('_', ' ')
            milestones.append({'name': f"End of {display_phase}", 'date': dates['end']})
        phase_objs = [{'name': k, 'start': v['start']} for k,v in phase_dates.items()]
        timeline_width = terminal_width
        # Only call min/max if tasks is not empty
        if tasks:
            start_date = min([t.get('start', today) for t in tasks])
            finish_date = max([t.get('finish', today) for t in tasks])
        else:
            start_date = today
            finish_date = today
        # Custom timeline block
        timeline_row, milestone_labels, milestone_dates, milestone_full_dates, milestone_positions = render_custom_timeline(phase_objs, milestones, start_date, finish_date, timeline_width)

        # Get Start and Finish dates for header
        start_date_str = milestone_full_dates[0] if milestone_full_dates else ''
        finish_date_str = milestone_full_dates[-1] if milestone_full_dates else ''

        # Create connector line with vertical bars at milestone positions (no T-junctions)
        def create_connector_line():
            connector = [' '] * timeline_width
            if not milestone_positions:
                return ''.join(connector)

            # Find valid positions within timeline width
            valid_positions = [p for p in milestone_positions if 0 <= p < timeline_width]
            if not valid_positions:
                return ''.join(connector)

            # Place vertical bars at all milestone positions
            for pos in valid_positions:
                connector[pos] = '│'  # U+2502 - Box drawing light vertical
            return ''.join(connector)

        # Render timeline header (project name and Start/Finish labels with dates)
        md += f"Project: {project_name}\n"
        md += f"Start{' ' * (timeline_width - 11)}Finish\n"
        md += f"{start_date_str}{' ' * (timeline_width - len(start_date_str) - len(finish_date_str))}{finish_date_str}\n"

        # Render title lines above the timeline (in reverse order so first line is closest to timeline)
        for title_line in reversed(milestone_labels):
            md += f"{title_line}\n"

        # Add ONE connector line below all titles, connecting them to the timeline
        if milestone_labels:
            md += f"{create_connector_line()}\n"

        # Combine timeline with progress and T-junctions
        combined_timeline = list(timeline_row)
        total_days = (finish_date - start_date).days or 1

        # Calculate progress for each phase and integrate into timeline
        if phase_dates:
            # If we have phases, calculate progress per phase
            for phase, dates in phase_dates.items():
                # Find all tasks in this phase
                phase_tasks = [t for t in tasks if t.get('phase') == phase and not t.get('summary')]

                if phase_tasks:
                    # Calculate average progress for the phase
                    total_progress = sum([t.get('percent', 0) for t in phase_tasks])
                    avg_progress = total_progress / len(phase_tasks) if phase_tasks else 0

                    # Calculate phase position on timeline
                    phase_start_pos = int((dates['start'] - start_date).days / total_days * (timeline_width - 1))
                    phase_end_pos = int((dates['end'] - start_date).days / total_days * (timeline_width - 1))

                    # Fill in progress for this phase (skip milestone positions)
                    phase_length = phase_end_pos - phase_start_pos + 1
                    progress_length = int(phase_length * avg_progress / 100)

                    for i in range(phase_start_pos, phase_end_pos + 1):
                        if i < timeline_width and combined_timeline[i] != '◆':
                            if i < phase_start_pos + progress_length:
                                combined_timeline[i] = '═'  # U+2550 - Box drawing double horizontal
                            else:
                                combined_timeline[i] = '─'  # U+2500 - Box drawing light horizontal
        else:
            # If no phases, calculate progress for individual tasks
            for t in tasks:
                if t.get('summary'):
                    continue

                # Skip 0-duration tasks (milestones)
                duration = t.get('duration', timedelta(days=1))
                if isinstance(duration, timedelta) and duration.days == 0:
                    continue

                task_start = t.get('start')
                task_finish = t.get('finish')
                task_percent = t.get('percent', 0)

                if task_start and task_finish:
                    # Calculate task position on timeline
                    task_start_pos = int((task_start - start_date).days / total_days * (timeline_width - 1))
                    task_end_pos = int((task_finish - start_date).days / total_days * (timeline_width - 1))

                    # Fill in progress for this task (skip milestone positions)
                    task_length = task_end_pos - task_start_pos + 1
                    progress_length = int(task_length * task_percent / 100)

                    for i in range(task_start_pos, task_end_pos + 1):
                        if i < timeline_width and combined_timeline[i] != '◆':
                            if i < task_start_pos + progress_length:
                                combined_timeline[i] = '═'  # U+2550 - Box drawing double horizontal
                            else:
                                combined_timeline[i] = '─'  # U+2500 - Box drawing light horizontal

        # Add T-junctions at the start and end (always, even if there are milestones)
        combined_timeline[0] = '├'  # U+251C - Left T-junction at start
        combined_timeline[-1] = '┤'  # U+2524 - Right T-junction at end

        # Render the combined timeline
        md += f"{''.join(combined_timeline)}\n"

        # Add connector from timeline to dates below
        md += f"{create_connector_line()}\n"

        # Render date line below the timeline
        md += f"{milestone_dates}\n"
    # Gantt chart output
    timeline_width = terminal_width
    # Only call min/max if tasks is not empty
    if tasks:
        start_date = min([t.get('start', today) for t in tasks])
        finish_date = max([t.get('finish', today) for t in tasks])
    else:
        start_date = today
        finish_date = today
    md += "\n"
    md += render_gantt_chart(tasks, start_date, finish_date, timeline_width)
    md += "\n"
    md += render_resource_sheet(tasks, start_date, finish_date, holidays=project_holidays, terminal_width=timeline_width, resource_map=resource_map)
    return md

def yaml_to_markdown_table(yaml_path, terminal_width=80):
    today = datetime.today()

    # Read file content for resource mappings
    with open(yaml_path, encoding="utf-8") as f:
        original_text = f.read()

    # Parse resource mappings and non-working days
    resource_map, resource_nwd = parse_resource_mappings(original_text)
    from .front_matter_parser import FrontMatterParser
    _fm_parser = FrontMatterParser(original_text)
    project_holidays = _fm_parser.parse_non_working_days()

    # Parse YAML
    data = yaml.safe_load(original_text)
    project_name = list(data.keys())[0]
    phases_raw = data[project_name]
    # If phases_raw is a list, pass as-is; if dict, wrap in a list
    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []
    tasks = schedule_tasks(phases, holidays=project_holidays, resource_non_working_days=resource_nwd)

    # Compute phase timelines
    phase_dates = {}
    for t in tasks:
        phase = t.get('phase')
        start = t.get('start') or today
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': start, 'end': finish}
            else:
                if start < phase_dates[phase]['start']:
                    phase_dates[phase]['start'] = start
                if finish > phase_dates[phase]['end']:
                    phase_dates[phase]['end'] = finish

    # Markdown table for tasks
    # First pass: Calculate column widths
    # Use shorter headers for better terminal fit
    col_widths = {
        'id': len('ID'),
        'task_name': len('Task Name'),
        'start': len('Start'),
        'finish': len('Finish'),
        'duration': len('Dur'),
        'resources': len('Res'),
        'percent': len('%'),
        'rag': len('RAG'),
        'comment': len('Comment')
    }

    # Prepare task data for rendering
    # Use shorter date format for narrow terminals
    date_format = '%d %b' if terminal_width < 100 else '%Y-%m-%d'

    task_rows = []
    for idx, t in enumerate(tasks, start=1):
        start = t.get('start') or today
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        resources = t.get('resources','')
        if resources:
            resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
            # Map to full names if available (case-insensitive)
            if resource_map:
                resource_list = [r.strip() for r in resources.split(',')]
                mapped_resources = [resource_map.get(r.lower(), r) for r in resource_list]
                resources = ', '.join(mapped_resources)
        percent = t.get('percent', '')
        comment = t.get('comment','')

        # Calculate RAG status (skip for summary tasks)
        if t.get('summary'):
            rag_status = ''
        else:
            rag_status = calculate_rag_status(t)

        # Use description as task name, fallback to name if no description
        task_name = t.get('description') or t.get('name', '')

        # Indent based on level (0=no indent, 1=2 spaces, 2=4 spaces, etc.)
        level = t.get('level', 0)
        if level > 0:
            indent = '  ' * level  # Use 2 spaces per level for cleaner terminal output
            task_name = f"{indent}{task_name}"

        # Store row data
        row = {
            'id': str(idx),
            'task_name': task_name,
            'start': start.strftime(date_format),
            'finish': finish.strftime(date_format),
            'duration': f"{t.get('duration',timedelta(days=1)).days}d",
            'resources': str(resources),
            'percent': str(percent),
            'rag': rag_status,
            'comment': str(comment)
        }
        task_rows.append(row)

        # Update column widths (except comment which we'll limit later)
        for key, value in row.items():
            if key != 'comment':
                col_widths[key] = max(col_widths[key], len(value))

    # Calculate available width for comment column
    # Account for column separators (| between each column + padding)
    fixed_width = (col_widths['id'] + col_widths['task_name'] + col_widths['start'] +
                   col_widths['finish'] + col_widths['duration'] + col_widths['resources'] +
                   col_widths['percent'] + col_widths['rag'])
    # Add space for separators and padding: 8 columns means 7 separators * 3 chars each = 21
    separators = 7 * 3
    available_for_comment = terminal_width - fixed_width - separators - 5  # Extra buffer

    # Limit comment width
    max_comment_width = max(len('Comment'), min(50, available_for_comment))
    col_widths['comment'] = max_comment_width

    # Truncate comments in task_rows if needed
    for row in task_rows:
        if len(row['comment']) > max_comment_width:
            row['comment'] = row['comment'][:max_comment_width - 3] + '...'

    # Second pass: Generate table with proper padding
    md = f"# {project_name}\n\n"

    # Header row (shorter headers, no leading/trailing |)
    md += f"{'ID':<{col_widths['id']}} | {'Task Name':<{col_widths['task_name']}} | {'Start':<{col_widths['start']}} | {'Finish':<{col_widths['finish']}} | {'Dur':>{col_widths['duration']}} | {'Res':^{col_widths['resources']}} | {'%':^{col_widths['percent']}} | {'RAG':^{col_widths['rag']}} | {'Comment':<{col_widths['comment']}}\n"

    # Separator row (no leading/trailing |)
    md += f"{'-' * (col_widths['id'] + 1)}|{'-' * (col_widths['task_name'] + 2)}|{'-' * (col_widths['start'] + 2)}|{'-' * (col_widths['finish'] + 2)}|{'-' * (col_widths['duration'] + 2)}|{'-' * (col_widths['resources'] + 2)}|{'-' * (col_widths['percent'] + 2)}|{'-' * (col_widths['rag'] + 2)}|{'-' * (col_widths['comment'])}\n"

    # Data rows (no leading/trailing |)
    for row in task_rows:
        md += f"{row['id']:<{col_widths['id']}} | {row['task_name']:<{col_widths['task_name']}} | {row['start']:<{col_widths['start']}} | {row['finish']:<{col_widths['finish']}} | {row['duration']:>{col_widths['duration']}} | {row['resources']:^{col_widths['resources']}} | {row['percent']:^{col_widths['percent']}} | {row['rag']:^{col_widths['rag']}} | {row['comment']:<{col_widths['comment']}}\n"

    # Timeline output block
    milestones = []
    # Show timeline if there are phases OR if there are tasks (even without phases)
    if phase_dates or tasks:
        # Build list of milestone entries (phases, summary tasks, and 0-duration tasks)
        milestone_entries = []

        # Add phases (if any)
        for phase, dates in phase_dates.items():
            milestone_entries.append({
                'name': phase,
                'start': dates['start'],
                'end': dates['end'],
                'type': 'phase'
            })

        # Add summary tasks
        for t in tasks:
            if t.get('summary'):
                milestone_entries.append({
                    'name': t.get('description', t.get('name', '')),
                    'start': t.get('start'),
                    'end': t.get('finish'),
                    'type': 'summary'
                })

        # Add 0-duration milestones
        for t in tasks:
            duration = t.get('duration', timedelta(days=1))
            if isinstance(duration, timedelta) and duration.days == 0:
                milestone_name = t.get('description', t.get('name', ''))
                # Replace underscores with spaces for display
                display_name = milestone_name.replace('_', ' ')
                milestone_entries.append({
                    'name': display_name,
                    'start': t.get('start'),
                    'end': t.get('start'),  # Same as start for milestones
                    'type': 'milestone'
                })
                milestones.append({
                    'name': display_name,
                    'date': t.get('start'),
                    'percent': t.get('percent', 0)  # Include percent for milestone rendering
                })

        # If no phases, add all tasks as milestones for the timeline
        if not phase_dates:
            for t in tasks:
                # Skip summary tasks (already added above)
                if t.get('summary'):
                    continue
                task_name = t.get('description', t.get('name', ''))
                # Replace underscores with spaces for display
                display_name = task_name.replace('_', ' ')
                milestone_entries.append({
                    'name': display_name,
                    'start': t.get('start'),
                    'end': t.get('finish'),
                    'type': 'task'
                })
                # Add task completion as a milestone for the visual timeline
                milestones.append({'name': f"{display_name}", 'date': t.get('finish')})

        # Remove duplicates (same name and dates) - keep phases over summaries
        seen = set()
        unique_entries = []
        for entry in milestone_entries:
            key = (entry['name'], entry['start'], entry['end'])
            if key not in seen:
                seen.add(key)
                unique_entries.append(entry)

        milestone_entries = unique_entries

        # Sort by start date
        milestone_entries.sort(key=lambda x: x['start'] if x['start'] else datetime.now())

        # Calculate column widths for Project Milestones table
        timeline_widths = {
            'name': len('Milestone'),
            'start': len('Start'),
            'end': len('End')
        }
        for entry in milestone_entries:
            timeline_widths['name'] = max(timeline_widths['name'], len(entry['name']))
            if entry['start']:
                timeline_widths['start'] = max(timeline_widths['start'], len(entry['start'].strftime(date_format)))
            if entry['end']:
                timeline_widths['end'] = max(timeline_widths['end'], len(entry['end'].strftime(date_format)))

        # Project Milestones header
        md += f"\n# Project Milestones\n\n{'Milestone':<{timeline_widths['name']}} | {'Start':<{timeline_widths['start']}} | {'End':<{timeline_widths['end']}}\n"
        md += f"{'-' * (timeline_widths['name'] + 1)}|{'-' * (timeline_widths['start'] + 2)}|{'-' * (timeline_widths['end'] + 1)}\n"

        for entry in milestone_entries:
            start_str = entry['start'].strftime(date_format) if entry['start'] else ''
            end_str = entry['end'].strftime(date_format) if entry['end'] else ''
            md += f"{entry['name']:<{timeline_widths['name']}} | {start_str:<{timeline_widths['start']}} | {end_str:<{timeline_widths['end']}}\n"

        # End of each phase is also a milestone for the visual timeline
        for phase, dates in phase_dates.items():
            # Replace underscores with spaces for display
            display_phase = phase.replace('_', ' ')
            milestones.append({'name': f"End of {display_phase}", 'date': dates['end']})
        phase_objs = [{'name': k, 'start': v['start']} for k,v in phase_dates.items()]
        timeline_width = terminal_width
        # Only call min/max if tasks is not empty
        if tasks:
            start_date = min([t.get('start', today) for t in tasks])
            finish_date = max([t.get('finish', today) for t in tasks])
        else:
            start_date = today
            finish_date = today
        # Custom timeline block
        timeline_row, milestone_labels, milestone_dates, milestone_full_dates, milestone_positions = render_custom_timeline(phase_objs, milestones, start_date, finish_date, timeline_width)

        # Get Start and Finish dates for header
        start_date_str = milestone_full_dates[0] if milestone_full_dates else ''
        finish_date_str = milestone_full_dates[-1] if milestone_full_dates else ''

        # Create connector line with vertical bars at milestone positions (no T-junctions)
        def create_connector_line():
            connector = [' '] * timeline_width
            if not milestone_positions:
                return ''.join(connector)

            # Find valid positions within timeline width
            valid_positions = [p for p in milestone_positions if 0 <= p < timeline_width]
            if not valid_positions:
                return ''.join(connector)

            # Place vertical bars at all milestone positions
            for pos in valid_positions:
                connector[pos] = '│'  # U+2502 - Box drawing light vertical
            return ''.join(connector)

        # Render timeline header (project name and Start/Finish labels with dates)
        md += f"Project: {project_name}\n"
        md += f"Start{' ' * (timeline_width - 11)}Finish\n"
        md += f"{start_date_str}{' ' * (timeline_width - len(start_date_str) - len(finish_date_str))}{finish_date_str}\n"

        # Render title lines above the timeline (in reverse order so first line is closest to timeline)
        for title_line in reversed(milestone_labels):
            md += f"{title_line}\n"

        # Add ONE connector line below all titles, connecting them to the timeline
        if milestone_labels:
            md += f"{create_connector_line()}\n"

        # Combine timeline with progress and T-junctions
        combined_timeline = list(timeline_row)
        total_days = (finish_date - start_date).days or 1

        # Calculate progress for each phase and integrate into timeline
        if phase_dates:
            # If we have phases, calculate progress per phase
            for phase, dates in phase_dates.items():
                # Find all tasks in this phase
                phase_tasks = [t for t in tasks if t.get('phase') == phase and not t.get('summary')]

                if phase_tasks:
                    # Calculate average progress for the phase
                    total_progress = sum([t.get('percent', 0) for t in phase_tasks])
                    avg_progress = total_progress / len(phase_tasks) if phase_tasks else 0

                    # Calculate phase position on timeline
                    phase_start_pos = int((dates['start'] - start_date).days / total_days * (timeline_width - 1))
                    phase_end_pos = int((dates['end'] - start_date).days / total_days * (timeline_width - 1))

                    # Fill in progress for this phase (skip milestone positions)
                    phase_length = phase_end_pos - phase_start_pos + 1
                    progress_length = int(phase_length * avg_progress / 100)

                    for i in range(phase_start_pos, phase_end_pos + 1):
                        if i < timeline_width and combined_timeline[i] != '◆':
                            if i < phase_start_pos + progress_length:
                                combined_timeline[i] = '═'  # U+2550 - Box drawing double horizontal
                            else:
                                combined_timeline[i] = '─'  # U+2500 - Box drawing light horizontal
        else:
            # If no phases, calculate progress for individual tasks
            for t in tasks:
                if t.get('summary'):
                    continue

                # Skip 0-duration tasks (milestones)
                duration = t.get('duration', timedelta(days=1))
                if isinstance(duration, timedelta) and duration.days == 0:
                    continue

                task_start = t.get('start')
                task_finish = t.get('finish')
                task_percent = t.get('percent', 0)

                if task_start and task_finish:
                    # Calculate task position on timeline
                    task_start_pos = int((task_start - start_date).days / total_days * (timeline_width - 1))
                    task_end_pos = int((task_finish - start_date).days / total_days * (timeline_width - 1))

                    # Fill in progress for this task (skip milestone positions)
                    task_length = task_end_pos - task_start_pos + 1
                    progress_length = int(task_length * task_percent / 100)

                    for i in range(task_start_pos, task_end_pos + 1):
                        if i < timeline_width and combined_timeline[i] != '◆':
                            if i < task_start_pos + progress_length:
                                combined_timeline[i] = '═'  # U+2550 - Box drawing double horizontal
                            else:
                                combined_timeline[i] = '─'  # U+2500 - Box drawing light horizontal

        # Add T-junctions at the start and end (always, even if there are milestones)
        combined_timeline[0] = '├'  # U+251C - Left T-junction at start
        combined_timeline[-1] = '┤'  # U+2524 - Right T-junction at end

        # Render the combined timeline
        md += f"{''.join(combined_timeline)}\n"

        # Add connector from timeline to dates below
        md += f"{create_connector_line()}\n"

        # Render date line below the timeline
        md += f"{milestone_dates}\n"
    # Gantt chart output
    timeline_width = terminal_width
    # Only call min/max if tasks is not empty
    if tasks:
        start_date = min([t.get('start', today) for t in tasks])
        finish_date = max([t.get('finish', today) for t in tasks])
    else:
        start_date = today
        finish_date = today
    md += "\n"
    md += render_gantt_chart(tasks, start_date, finish_date, timeline_width)
    md += "\n"
    md += render_resource_sheet(tasks, start_date, finish_date, holidays=project_holidays, terminal_width=timeline_width, resource_map=resource_map)
    return md


def export_to_pdf(text, output_path, is_yaml=True, project_name="Project", original_text=None):
    """Export the project plan to a PDF file."""
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.pdfgen import canvas

    # Generate the markdown table output
    ascii_output = text_to_markdown_table(
        text,
        is_yaml=is_yaml,
        project_name=project_name,
        terminal_width=120,
        original_text=original_text
    )

    # Create PDF document
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=30,
        leftMargin=30,
        topMargin=30,
        bottomMargin=30
    )

    # Container for content
    story = []

    # Get default styles
    styles = getSampleStyleSheet()

    # Create custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor='#108BB9',
        spaceAfter=30,
        alignment=TA_CENTER
    )

    # Create monospace style for plan output
    mono_style = ParagraphStyle(
        'Monospace',
        parent=styles['Code'],
        fontName='Courier',
        fontSize=8,
        leading=10,
        leftIndent=0,
        rightIndent=0,
        alignment=TA_LEFT
    )

    # Add title
    title = Paragraph(f"{project_name} - Project Plan", title_style)
    story.append(title)
    story.append(Spacer(1, 12))

    # Add the ASCII output as preformatted text
    preformatted = Preformatted(ascii_output, mono_style)
    story.append(preformatted)

    # Build PDF
    doc.build(story)


def export_to_csv(text, output_path, is_yaml=True, project_name="Project", original_text=None):
    """Export project data to CSV format.

    Args:
        text: Input text (YAML or natural language)
        output_path: Path to save the CSV file
        is_yaml: If True, parse as YAML; if False, parse as natural language
        project_name: Project name to use
        original_text: Original text before conversion (for extracting resource mappings)
    """
    # Parse resource mappings from original text if provided
    resource_map = {}
    if original_text:
        resource_map, _ = parse_resource_mappings(original_text)

    # Parse the text to get tasks and project info
    if is_yaml:
        data = yaml.safe_load(text)
        project_name = list(data.keys())[0]
        phases_raw = data[project_name]
    else:
        # Parse natural language
        data = natural_language_to_yaml(text, project_name)
        phases_raw = data[project_name]

    # If phases_raw is a list, pass as-is; if dict, wrap in a list
    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []

    # Schedule tasks
    tasks = schedule_tasks(phases)

    # Open CSV file for writing
    with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
        # Define CSV headers
        fieldnames = ['ID', 'Task Name', 'Start', 'Finish', 'Duration (days)',
                      'Resources', '% Complete', 'RAG', 'Priority', 'Bucket', 'Comment']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

        # Write header row
        writer.writeheader()

        # Write task data
        for idx, task in enumerate(tasks, start=1):
            # Calculate duration
            duration = task.get('duration')
            if isinstance(duration, timedelta):
                duration_days = duration.days
            else:
                duration_days = 0

            # Get start and finish dates
            start_date = task.get('start')
            finish_date = task.get('finish')
            
            # Format dates
            start_str = start_date.strftime('%Y-%m-%d') if start_date else ''
            finish_str = finish_date.strftime('%Y-%m-%d') if finish_date else ''

            # Get resources
            resources = task.get('resources', [])
            resource_str = ', '.join(resources) if resources else ''

            # Get percentage complete
            percentage = task.get('percentage', 0)

            # Get RAG status
            rag_status = task.get('rag_status', 'N/A')

            # Get comment
            comment = task.get('comment', '')

            # Write row
            writer.writerow({
                'ID': idx,
                'Task Name': task.get('name', ''),
                'Start': start_str,
                'Finish': finish_str,
                'Duration (days)': duration_days,
                'Resources': resource_str,
                '% Complete': percentage,
                'RAG': rag_status,
                'Priority': task.get('priority', 'Low'),
                'Bucket': task.get('bucket', ''),
                'Comment': comment
            })


if __name__ == "__main__":
    import sys
    from projects.scheduling_engine.cli import main

    raise SystemExit(main(sys.argv[1:]))
