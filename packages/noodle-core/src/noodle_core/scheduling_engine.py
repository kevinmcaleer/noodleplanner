"""Scheduling engine: task scheduling, natural-language parsing, and re-exports.

This module is the public API surface for noodle_core scheduling.  The
implementation has been split into focused modules (date_math, metadata,
renderers, exporters) but every name is re-exported here so that existing
``from noodle_core.scheduling_engine import X`` imports continue to work.
"""

import os
import re
import logging
import dataclasses
from datetime import datetime, timedelta

from .calendar_model import STANDARD_CALENDAR
from .date_math import (
    get_next_working_day,
    today_working_day,
    add_working_days,
    compute_finish,
    count_working_days,
    parse_duration,
    parse_duration_to_days,
    _normalize_calendar_or_holidays,
)
from .metadata import (
    extract_metadata,
    split_star_lag,
    detect_dependency_loops,
    detect_hierarchy_dependency_conflicts,
    inherit_summary_resources,
    task_name_lookup,
    _propagate_resource_to_children,
    parse_recurrence,
    generate_recurrence_occurrences,
)

# ---------------------------------------------------------------------------
# Re-exports – keep every public name importable from scheduling_engine
# ---------------------------------------------------------------------------
from .date_math import *          # noqa: F401,F403
from .metadata import *           # noqa: F401,F403
from .renderers import *          # noqa: F401,F403
from .exporters import *          # noqa: F401,F403

# Private names are not covered by wildcard imports, so re-export them
# explicitly for backwards compatibility with tests and other callers.
from .exporters import (          # noqa: F401
    _add_report_slide,
    _add_portfolio_deliverables_slides,
    _parse_budget_value,
    _format_budget_total,
    _calculate_total_portfolio_budget,
    _collect_portfolio_risks,
    _add_portfolio_risk_slides,
    _add_portfolio_overview_slide,
    _draw_timeline_graphic,
    _parse_non_working_suffix,
    _parse_named_non_working_suffix,
    _parse_stakeholder_entry,
)
from .metadata import (           # noqa: F401
    _propagate_resource_to_children,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configurable task limits (override via environment variables)
# ---------------------------------------------------------------------------
MAX_TASK_COUNT = int(os.environ.get("NOODLE_MAX_TASK_COUNT", 10000))
MAX_NESTING_DEPTH = int(os.environ.get("NOODLE_MAX_NESTING_DEPTH", 20))
MAX_TASK_NAME_LENGTH = int(os.environ.get("NOODLE_MAX_TASK_NAME_LENGTH", 500))

# A calendar date anywhere on a line marks it as carrying task details. This
# used to be three hard-coded substrings ('2024-', '2025-', '2026-'), so from
# 2027 a line whose only metadata was a date parsed as a bare heading: the date
# became part of the task's name and every `[depends ...]` on it stopped
# resolving. Same pattern the name extraction below already uses.
_DATE_ANY = re.compile(r"\d{4}-\d{2}-\d{2}")

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


# ---------------------------------------------------------------------------
# Critical path analysis
# ---------------------------------------------------------------------------

def _get_duration_days(task):
    """Return the task duration in working days (minimum 1 for non-milestones)."""
    duration = task.get('duration', timedelta(days=1))
    if isinstance(duration, timedelta):
        return max(duration.days, 0)
    return 1

def _subtract_working_days(end_date, num_days, holidays=None):
    """Subtract *num_days* working days from *end_date* (exclusive convention)."""
    return add_working_days(end_date, -num_days, holidays)

def _task_resource_keys(task):
    """A task's resource shortnames, lowercased, in task-line order."""
    return [
        r.strip().lstrip('@').lower()
        for r in task.get('resources', '').split(',')
        if r.strip()
    ]

def _calendar_or_holidays_for_task(task, holidays, resource_non_working_days, calendar, resource_calendars):
    """The value to pass as ``holidays`` to date_math for one task.

    A plain set when no calendar is in play at all (the historical
    behaviour, unchanged bit-for-bit). Otherwise a Calendar: the task's
    first resource with an assigned calendar (`resource_calendars`),
    falling back to the project's `calendar` (or Standard), with the
    project-wide and resource-specific exception dates layered on top as
    extra exceptions (issue #1132).

    The plain set comes back already normalized for date_math (see
    ``_normalize_calendar_or_holidays``), so the per-task date arithmetic
    doesn't re-normalize it on every call; and a task with no
    resource-specific days gets the project set itself rather than a copy.
    """
    task_resource_keys = _task_resource_keys(task)

    if calendar is None and not resource_calendars:
        resource_days = [
            resource_non_working_days[res_key]
            for res_key in task_resource_keys
            if resource_non_working_days and res_key in resource_non_working_days
        ]
        if not resource_days:
            # A no-op when the caller passes holidays it normalized itself.
            return _normalize_calendar_or_holidays(holidays)
        task_holidays = set(holidays)
        for days in resource_days:
            task_holidays |= days
        return _normalize_calendar_or_holidays(task_holidays)

    base = calendar or STANDARD_CALENDAR
    if resource_calendars:
        for res_key in task_resource_keys:
            if res_key in resource_calendars:
                base = resource_calendars[res_key]
                break

    extra_exceptions = set(holidays)
    if resource_non_working_days:
        for res_key in task_resource_keys:
            if res_key in resource_non_working_days:
                extra_exceptions |= resource_non_working_days[res_key]

    if not extra_exceptions:
        return base
    return dataclasses.replace(base, exceptions=base.exceptions | extra_exceptions)

def _late_finish_allowed_by(succ, dep_type, lag, duration_days, holidays):
    """The latest a predecessor may finish without delaying *succ*.

    The inverse of the forward pass in schedule_tasks: there a link pushes
    the successor's start (FS, SS) or finish (FF, SF) to the predecessor's
    finish (FS, FF) or start (SS, SF), shifted by *lag* working days. Here
    the successor's late start or finish is shifted back by the same lag,
    and a start-anchored link is turned into a finish by adding the
    predecessor's own duration.
    """
    succ_ref = succ['late_start'] if dep_type in ('FS', 'SS') else succ['late_finish']
    if lag:
        succ_ref = add_working_days(succ_ref, -lag, holidays)
    if dep_type in ('SS', 'SF') and duration_days:
        # a start-anchored link bounds the predecessor's start; its finish
        # may be no later than that plus its own duration
        return add_working_days(succ_ref, duration_days, holidays)
    return succ_ref


def calculate_critical_path(tasks, holidays=None):
    """Calculate critical path, slack/float for each leaf task.

    Adds to each leaf task: early_start, early_finish, late_start,
    late_finish, total_float, critical (bool).
    """
    # Normalized once here rather than inside each of the several date_math
    # calls made per task below.
    holidays = _normalize_calendar_or_holidays(holidays)

    leaf_tasks = [t for t in tasks if not t.get('summary') and 'start' in t and 'finish' in t]
    if not leaf_tasks:
        return

    # Resolve names as schedule_tasks does, over every task, so a dependency
    # on a duplicated name means the same task here as it did there.
    name_lookup = task_name_lookup(tasks)

    # Forward pass — use already-scheduled dates as ES/EF
    for t in leaf_tasks:
        t['early_start'] = t['start']
        t['early_finish'] = t['finish']

    # Find project end
    project_end = max(t['finish'] for t in leaf_tasks)

    # Build successors map, keyed by task identity: a dependency on a
    # duplicated name belongs to its first definition only. Each link keeps
    # its type and lag/lead, looked up by the name as written -- exactly as
    # schedule_tasks looked them up going forward.
    successors = {id(t): [] for t in leaf_tasks}
    for t in leaf_tasks:
        dep_types = t.get('dependency_types', {})
        lags = t.get('lag_lead', {})
        for dep_name in t.get('depends', []):
            pred = name_lookup.get(dep_name.lower())
            if pred is not None and id(pred) in successors:
                lag = parse_duration_to_days(lags[dep_name]) if dep_name in lags else 0
                successors[id(pred)].append((t, dep_types.get(dep_name, 'FS'), lag))

    # Backward pass
    for t in leaf_tasks:
        t['late_finish'] = project_end
        t['late_start'] = project_end

    # Process in reverse order
    for t in reversed(leaf_tasks):
        duration_days = _get_duration_days(t)
        t['late_finish'] = project_end
        for s, dep_type, lag in successors[id(t)]:
            t['late_finish'] = min(
                t['late_finish'],
                _late_finish_allowed_by(s, dep_type, lag, duration_days, holidays),
            )

        if duration_days == 0:
            t['late_start'] = t['late_finish']
        else:
            t['late_start'] = _subtract_working_days(t['late_finish'], duration_days, holidays)
            t['late_start'] = get_next_working_day(t['late_start'], holidays)

    # Calculate float and mark critical tasks
    for t in leaf_tasks:
        t['total_float'] = count_working_days(t['early_start'], t['late_start'], holidays)
        t['critical'] = t['total_float'] == 0


# ---------------------------------------------------------------------------
# Core scheduling
# ---------------------------------------------------------------------------

def schedule_tasks(
    phases,
    holidays=None,
    resource_non_working_days=None,
    calendar=None,
    resource_calendars=None,
):
    """Schedule tasks from arbitrarily nested structure.

    Args:
        phases: Nested dict structure from natural_language_to_yaml or YAML.
                Leaf tasks have {'_text': str, '_level': int}
                Summary tasks have nested dicts with '_level' and '_is_summary' markers
                A child dict may carry an optional '_name' marker; when present it is
                the task's true name and takes precedence over its dict key (used by
                natural_language_to_yaml to give duplicate sibling names distinct dict
                keys internally while preserving the real name -- see issue #838).
        holidays: Set of project-wide holiday dates to skip when scheduling.
        resource_non_working_days: Dict mapping lowercase resource shortnames to
                sets of datetime.date for resource-specific non-working days.
        calendar: Optional Calendar (see noodle_core.calendar_model) giving the
                project's active calendar -- a work week or shift rotation other
                than the default Mon-Fri, with optional daily hours. When given,
                every task schedules against it (layering `holidays` on top as
                extra exception dates) instead of the hardcoded Mon-Fri rule
                (issue #1132).
        resource_calendars: Optional dict mapping lowercase resource shortnames
                to a Calendar that resource uses instead of `calendar`. A task
                with more than one resource uses the first one (in task-line
                order) that has an assigned calendar.

    Returns:
        List of tasks, each with: name, description, level, resources, start, finish,
        duration, percent, comment, summary (bool), parent, phase
    """
    all_tasks = []

    def create_leaf_task(text, task_name, level, parent_name, parent_uid=None):
        """Create a leaf task from text and metadata, appending it to all_tasks."""
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
        # Internal identity, distinct from the (possibly duplicated) display
        # name -- see the '_uid'/'_parent_uid' note below for why this
        # exists.
        meta['_uid'] = len(all_tasks)
        meta['_parent_uid'] = parent_uid
        all_tasks.append(meta)

    def traverse_nested_dict(node, parent_name=None, parent_level=-1, depth=0, parent_uid=None):
        """Recursively traverse nested dict and extract tasks."""
        if depth > MAX_NESTING_DEPTH:
            raise ValueError(
                f"Task nesting depth exceeds maximum of {MAX_NESTING_DEPTH}. "
                f"Reduce nesting or set NOODLE_MAX_NESTING_DEPTH environment variable."
            )

        if isinstance(node, list):
            # Handle list of dicts at top level
            for item in node:
                traverse_nested_dict(item, parent_name, parent_level, depth, parent_uid)
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

            create_leaf_task(text, task_name, level, parent_name, parent_uid)
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
                # natural_language_to_yaml disambiguates duplicate sibling
                # names with a unique dict key (since dict keys must be
                # unique) and stashes the real name under '_name'. Prefer
                # that when present so duplicate siblings keep their true,
                # user-visible name; hand-authored YAML plans (which have no
                # '_name') fall back to the dict key exactly as before.
                true_name = value.get('_name', key) if isinstance(value, dict) else key

                if '_text' in value:
                    # Leaf task
                    create_leaf_task(value['_text'], true_name, value.get('_level', level + 1), parent_name, parent_uid)
                elif '_is_summary' in value or any(isinstance(v, dict) for v in value.values()):
                    # Summary task with children
                    if len(true_name) > MAX_TASK_NAME_LENGTH:
                        raise ValueError(
                            f"Task name '{true_name[:50]}...' exceeds maximum length of "
                            f"{MAX_TASK_NAME_LENGTH} characters. "
                            f"Set NOODLE_MAX_TASK_NAME_LENGTH environment variable to increase."
                        )
                    # Build summary metadata from base fields + optional extracted metadata
                    summary_text = value.get('_summary_text', '')
                    summary_meta_data = extract_metadata(summary_text, true_name) if summary_text else {}
                    summary_meta = {
                        'name': true_name,
                        'description': true_name,
                        'level': value.get('_level', level + 1),
                        'parent': parent_name,
                        'phase': parent_name or '',
                        'summary': True,
                        'resources': summary_meta_data.get('resources', ''),
                        'percent': 0,
                        'comment': summary_meta_data.get('comment', ''),
                    }
                    if summary_meta_data.get('deliverable'):
                        summary_meta['deliverable'] = summary_meta_data['deliverable']
                        summary_meta['product_type'] = summary_meta_data.get('product_type', 'internal')
                    if summary_meta_data.get('depends'):
                        summary_meta['depends'] = summary_meta_data['depends']
                    if summary_meta_data.get('quality_roles'):
                        summary_meta['quality_roles'] = summary_meta_data['quality_roles']
                    if len(all_tasks) >= MAX_TASK_COUNT:
                        raise ValueError(
                            f"Task count exceeds maximum of {MAX_TASK_COUNT}. "
                            f"Reduce tasks or set NOODLE_MAX_TASK_COUNT environment variable."
                        )
                    # Internal identity, distinct from the (possibly
                    # duplicated) display name. children_by_parent /
                    # build_ordered_list below key off this rather than
                    # off 'name', so that two summary tasks sharing a name
                    # (anywhere in the tree, not just as siblings) each
                    # keep their own subtree instead of one being merged
                    # into or dropped in favour of the other (#838).
                    summary_meta['_uid'] = len(all_tasks)
                    summary_meta['_parent_uid'] = parent_uid
                    all_tasks.append(summary_meta)
                    # Recursively process children
                    traverse_nested_dict(value, parent_name=true_name, parent_level=value.get('_level', level + 1), depth=depth + 1, parent_uid=summary_meta['_uid'])
                else:
                    # Single key-value that might be a simple dict
                    traverse_nested_dict(value, parent_name=true_name, parent_level=level + 1, depth=depth + 1, parent_uid=parent_uid)

    # Start traversal
    if isinstance(phases, list):
        traverse_nested_dict(phases)
    else:
        traverse_nested_dict(phases)

    # Build deliverable lookup: $name -> task name, for resolving $product dependencies
    deliverable_lookup = {}
    for t in all_tasks:
        if 'deliverable' in t and 'name' in t:
            deliverable_lookup[t['deliverable'].lower()] = t['name']

    # Resolve $product references in dependencies to actual task names
    for t in all_tasks:
        if 'depends' in t and t['depends']:
            resolved = []
            for dep in t['depends']:
                if dep.startswith('$'):
                    product_name = dep[1:].lower()
                    if product_name in deliverable_lookup:
                        resolved.append(deliverable_lookup[product_name])
                    else:
                        logger.warning("Product dependency '%s' not found for task '%s'", dep, t.get('name'))
                        resolved.append(dep)
                else:
                    resolved.append(dep)
            t['depends'] = resolved

    # Schedule leaf tasks (non-summary tasks)
    # Case-insensitive; a dependency on a duplicated name means its first
    # definition (see task_name_lookup).
    name_lookup = task_name_lookup(all_tasks)

    # Prepare holiday sets
    if holidays is None:
        holidays = set()
    if resource_non_working_days is None:
        resource_non_working_days = {}
    if calendar is None and not resource_calendars:
        # Plain-set scheduling: normalize the project holidays once for
        # every task and date_math call below, instead of once per call.
        # (With a calendar in play they are layered onto its exceptions
        # as given, exactly as before.)
        holidays = _normalize_calendar_or_holidays(holidays)

    # A task's calendar depends only on its resource list, so build each
    # distinct one once rather than copying the holiday set per task.
    task_calendars = {}

    for idx, t in enumerate(all_tasks):
        # Skip summary tasks - their dates will be calculated from children
        if t.get('summary'):
            continue

        # Per-task calendar: project-wide + assigned resource's non-working
        # days, plus (issue #1132) whichever calendar applies to this task.
        resource_keys = tuple(_task_resource_keys(t))
        task_holidays = task_calendars.get(resource_keys)
        if task_holidays is None:
            task_holidays = task_calendars[resource_keys] = _calendar_or_holidays_for_task(
                t, holidays, resource_non_working_days, calendar, resource_calendars
            )

        logger.debug("[SCHEDULE] Task %d: %s (sequential: %s, depends: %s, start: %s)", idx, t.get('name'), t.get('sequential'), t.get('depends'), t.get('start'))

        # Normalize duration and milestone flag once before the scheduling block
        duration = t.get('duration', timedelta(days=1))
        is_milestone = isinstance(duration, timedelta) and duration.days == 0

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

            if prev and 'finish' in prev:
                # Record the resolved sequential dependency so the frontend
                # can draw dependency lines for '*' tasks.
                prev_name = prev.get('name', '')
                if prev_name:
                    if 'depends' not in t or not t['depends']:
                        t['depends'] = []
                    if prev_name not in t['depends']:
                        t['depends'].append(prev_name)

                # A lag or lead on the star (`* +2d`, `* -1d`) shifts the
                # predecessor's finish by that many working days first --
                # exactly as `[depends Prev +2d]` would, and it is recorded
                # the same way so exports and the Gantt see the offset.
                ref_date = prev['finish']
                seq_lag = t.get('sequential_lag')
                if seq_lag:
                    ref_date = add_working_days(ref_date, parse_duration_to_days(seq_lag), task_holidays)
                    if prev_name:
                        t.setdefault('lag_lead', {}).setdefault(prev_name, seq_lag)

                if is_milestone:
                    # Milestones (0-duration) align with the end of the predecessor.
                    seq_start = ref_date
                else:
                    # Sequential tasks start the next working day after predecessor finishes
                    seq_start = get_next_working_day(ref_date, task_holidays)

                # If the task has an explicit start date, use the later of the
                # two — the explicit date acts as a "not before" constraint.
                explicit_start = t.get('start')
                if explicit_start and explicit_start > seq_start:
                    t['start'] = explicit_start
                else:
                    t['start'] = seq_start

                if is_milestone:
                    t['finish'] = t['start']

                logger.debug("[SEQ-LOGIC] Task '%s' scheduled after '%s' finish=%s, new start=%s", t.get('name'), prev.get('name'), prev['finish'], t['start'])
            else:
                t['start'] = today_working_day(task_holidays)
                logger.debug("[SEQ-LOGIC] Task '%s' no predecessor, starting from today: %s", t.get('name'), t['start'])

            # Calculate finish date using working days (skip for milestones already set above)
            if not is_milestone or 'finish' not in t:
                compute_finish(t, task_holidays)

        elif 'depends' in t and t['depends']:
            # Has dependencies (case-insensitive lookup)
            # Apply lag/lead time if specified
            lag_lead_map = t.get('lag_lead', {})
            dep_type_map = t.get('dependency_types', {})

            task_duration_days = duration.days if isinstance(duration, timedelta) else 1

            # Collect effective start dates from each dependency based on type
            dep_start_dates = []
            for dep_name in t['depends']:
                dep_name_lower = dep_name.lower()
                if dep_name_lower not in name_lookup:
                    continue
                dep_task = name_lookup[dep_name_lower]
                if 'finish' not in dep_task or 'start' not in dep_task:
                    continue

                dep_type = dep_type_map.get(dep_name, 'FS')

                if dep_type == 'FS':
                    # Finish-Start: successor starts after predecessor finishes
                    ref_date = dep_task['finish']
                elif dep_type == 'SS':
                    # Start-Start: successor starts when predecessor starts
                    ref_date = dep_task['start']
                elif dep_type == 'FF':
                    # Finish-Finish: successor finishes when predecessor finishes
                    # So successor start = predecessor finish - successor duration
                    ff_finish = dep_task['finish']
                    # Apply lag/lead before calculating start from finish
                    if dep_name in lag_lead_map:
                        offset_str = lag_lead_map[dep_name]
                        offset_days = parse_duration_to_days(offset_str)
                        ff_finish = add_working_days(ff_finish, offset_days, task_holidays)
                    # Work backwards from required finish to find start
                    if is_milestone:
                        dep_start_dates.append(ff_finish)
                    else:
                        # Subtract duration to find start (finish is exclusive)
                        from_finish = add_working_days(ff_finish, -task_duration_days, task_holidays)
                        dep_start_dates.append(get_next_working_day(from_finish, task_holidays))
                    continue  # Already handled lag/lead above
                elif dep_type == 'SF':
                    # Start-Finish: successor finishes when predecessor starts
                    sf_finish = dep_task['start']
                    # Apply lag/lead before calculating start from finish
                    if dep_name in lag_lead_map:
                        offset_str = lag_lead_map[dep_name]
                        offset_days = parse_duration_to_days(offset_str)
                        sf_finish = add_working_days(sf_finish, offset_days, task_holidays)
                    # Work backwards from required finish to find start
                    if is_milestone:
                        dep_start_dates.append(sf_finish)
                    else:
                        from_finish = add_working_days(sf_finish, -task_duration_days, task_holidays)
                        dep_start_dates.append(get_next_working_day(from_finish, task_holidays))
                    continue  # Already handled lag/lead above
                else:
                    ref_date = dep_task['finish']  # Default to FS

                # Apply lag/lead time if specified for this dependency (FS, SS)
                if dep_name in lag_lead_map:
                    offset_str = lag_lead_map[dep_name]
                    offset_days = parse_duration_to_days(offset_str)
                    ref_date = add_working_days(ref_date, offset_days, task_holidays)

                if dep_type == 'SS':
                    # For SS, the ref_date is the predecessor start - use directly
                    dep_start_dates.append(get_next_working_day(ref_date, task_holidays))
                elif is_milestone:
                    dep_start_dates.append(ref_date)
                else:
                    dep_start_dates.append(get_next_working_day(ref_date, task_holidays))

            if dep_start_dates:
                latest_start = max(dep_start_dates)

                dep_start = latest_start

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
                    t['start'] = today_working_day(task_holidays)

            # Calculate finish date using working days (skip for milestones already set above)
            if not is_milestone or 'finish' not in t:
                compute_finish(t, task_holidays)

        elif 'start' in t:
            # Has explicit start date (manual scheduling)
            # Use the explicit start date provided
            # Calculate finish date using working days
            compute_finish(t, task_holidays)

        else:
            # Default: start in parallel (at parent's start or now)
            # Look for parent task or first sibling to determine start
            parent_uid = t.get('_parent_uid')
            if parent_uid is not None:
                # Find first sibling (non-summary task with same parent).
                # Matched by parent identity (_parent_uid), not parent name,
                # so that two same-named phases elsewhere in the tree don't
                # bleed their children's default start dates into each
                # other (#838).
                first_sibling = None
                for j in range(len(all_tasks)):
                    if (all_tasks[j].get('_parent_uid') == parent_uid and
                        not all_tasks[j].get('summary') and
                        'start' in all_tasks[j]):
                        first_sibling = all_tasks[j]
                        break

                if first_sibling:
                    t['start'] = first_sibling['start']
                else:
                    t['start'] = today_working_day(task_holidays)
            else:
                t['start'] = today_working_day(task_holidays)

            # Calculate finish date using working days
            compute_finish(t, task_holidays)

        # Ensure duration is set (but allow 0 duration for milestones)
        if 'duration' not in t or t['duration'] is None:
            t['duration'] = timedelta(days=1)

    # One pass over the task list serves every summary roll-up and the
    # re-ordering below; both used to rescan all_tasks per summary (#789).
    # Order within each child list is the original order.
    #
    # Grouped by _uid/_parent_uid (an identity assigned per task when it was
    # created above), not by name. Two tasks -- summary or leaf -- can share
    # a display name anywhere in the tree, as siblings or otherwise; keying
    # this by name would silently merge or drop one of them, which is
    # exactly the data-loss bug reported in #838. _uid is unique per task by
    # construction, so no "first one with this name wins" tie-break is
    # needed any more.
    children_by_parent = {}
    summary_by_uid = {}
    for t in all_tasks:
        parent_uid = t.get('_parent_uid')
        if parent_uid is not None:
            children_by_parent.setdefault(parent_uid, []).append(t)
        if t.get('summary'):
            summary_by_uid[t['_uid']] = t
    summaries_done = set()

    # Calculate summary task dates from children
    def calculate_summary_dates(uid):
        """Calculate start/finish for a summary task from its children.

        Each summary is computed once, bottom-up. Before, every call rescanned
        all_tasks for children and recursed into nested summaries without
        remembering them, so a 300-summary plan did this 1,200 times (#789).
        """
        if uid in summaries_done:
            return
        summaries_done.add(uid)

        children = children_by_parent.get(uid, [])
        if not children:
            return

        # Recursively calculate for any summary children first
        for child in children:
            if child.get('summary'):
                calculate_summary_dates(child['_uid'])

        summary_task = summary_by_uid.get(uid)
        if not summary_task:
            return

        # Calculate from children's dates
        starts = [c['start'] for c in children if 'start' in c]
        finishes = [c['finish'] for c in children if 'finish' in c]

        if starts and finishes:
            summary_task['start'] = min(starts)
            summary_task['finish'] = max(finishes)
            summary_task['duration'] = summary_task['finish'] - summary_task['start']

        # Always calculate average percent complete from children
        percents = [c.get('percent', 0) for c in children if not c.get('summary')]
        if not percents:
            # If no leaf children, include summary children
            percents = [c.get('percent', 0) for c in children]
        if percents:
            summary_task['percent'] = int(sum(percents) / len(percents))

    # Calculate dates for all summary tasks
    for t in all_tasks:
        if t.get('summary'):
            calculate_summary_dates(t['_uid'])

    # Re-order tasks so summary tasks appear immediately before their children
    def build_ordered_list():
        """Build properly ordered list with summary tasks before children."""
        ordered = []
        processed = set()

        def add_task_and_children(task):
            """Recursively add task and its children in order."""
            uid = task.get('_uid')
            if uid is None or uid in processed:
                return
            processed.add(uid)

            # Add the task itself
            ordered.append(task)

            # If it's a summary task, add its children (original order)
            if task.get('summary'):
                for child in children_by_parent.get(uid, []):
                    add_task_and_children(child)

        # Start with top-level tasks (no parent)
        top_level = [t for t in all_tasks if t.get('_parent_uid') is None]
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
        affected = set(loop_analysis['affected_tasks'])
        name_lookup_ordered = task_name_lookup(ordered_tasks)
        for task in ordered_tasks:
            task_name = task.get('name', '').lower()
            if task_name in affected:
                task['loop_warning'] = loop_analysis['task_warnings'].get(
                    task.get('name', task_name),
                    "Circular dependency detected"
                )
                # Flag the links that take part in the cycle so the editor
                # can mark them.  Which one to remove is the user's call, so
                # these are not offered as an automatic fix.
                for dep_name in task.get('depends') or []:
                    if dep_name.strip().lower() not in affected:
                        continue
                    pred = name_lookup_ordered.get(dep_name.strip().lower(), {})
                    task.setdefault('circular_dependencies', []).append({
                        'name': pred.get('name', dep_name),
                        'deliverable': pred.get('deliverable', ''),
                        'reason': 'cycle',
                        'message': task['loop_warning'],
                        'fixable': False,
                    })

    # A task that depends on its own phase (or a phase on its own subtask)
    # is circular to anything that rolls phase dates up from subtasks, and
    # MS Project refuses such a plan outright.  Removing the entry from the
    # [depends ...] list is always the right fix, so these are fixable.
    for idx, conflicts in detect_hierarchy_dependency_conflicts(ordered_tasks).items():
        task = ordered_tasks[idx]
        # These take precedence over a generic cycle entry for the same
        # predecessor (a self-dependency is caught by both) because they
        # come with a fix.
        conflict_names = {c['name'].lower() for c in conflicts}
        task['circular_dependencies'] = [
            c for c in task.get('circular_dependencies', [])
            if c['name'].lower() not in conflict_names
        ] + conflicts
        task['loop_warning'] = conflicts[0]['message']
        logger.warning("Hierarchy dependency conflict: %s", conflicts[0]['message'])

    # Calculate critical path (slack/float and critical flag). Uses the
    # project-wide calendar only -- per-resource calendars vary float
    # differently per task, which the current float model doesn't represent.
    project_calendar_or_holidays = holidays
    if calendar is not None:
        project_calendar_or_holidays = (
            dataclasses.replace(calendar, exceptions=calendar.exceptions | set(holidays))
            if holidays else calendar
        )
    calculate_critical_path(ordered_tasks, project_calendar_or_holidays)

    return ordered_tasks


# ---------------------------------------------------------------------------
# Natural-language parsing
# ---------------------------------------------------------------------------

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

        # Skip commented-out lines (// prefix)
        if line.lstrip().startswith('//'):
            continue

        indent_level = len(line) - len(line.lstrip())
        stripped = line.strip()

        # Check if has task details
        has_duration = re.search(r'\b\d+[dwmy]\b', stripped) is not None
        has_quotes = '"' in stripped or "'" in stripped
        has_deliverable = re.search(r'[/^]?\$[A-Za-z_]', stripped) is not None
        has_brackets = '[' in stripped
        has_details = '@' in stripped or '%' in stripped or '!' in stripped or '#' in stripped or _DATE_ANY.search(stripped) is not None or has_duration or has_quotes or has_deliverable or has_brackets

        # Extract task name (everything before metadata), from the line
        # with a sequential lag (`* +2d Build 3d`) blanked out, so neither
        # the `+` nor the `2d` is mistaken for the name or its end.
        named, _ = split_star_lag(stripped)
        if has_details:
            # Find where metadata starts
            #
            # '"' is one of these boundary characters (matching
            # metadata.py's DESCRIPTION-equivalent quoted-comment
            # extraction, which already stops there) -- found while
            # implementing issue #1020: this list used to omit it, so a
            # line whose only metadata was a quoted comment (e.g.
            # `Phase "note"`) kept the whole line, quotes and all, as its
            # tree-level name. That was invisible for a *leaf* task
            # (extract_metadata() below independently derives a clean
            # description from task_str), but a *summary* task's
            # description is this value directly (see the
            # `'description': true_name` build below) with no such
            # rescue -- so a task with an inline comment lost its clean
            # name, and anything keyed on the task name (e.g. a
            # whiteboard row) silently orphaned the moment it gained a
            # child.
            metadata_start = len(named)
            for char in ['@', '#', '!', '$', '[', '"']:
                pos = named.find(char)
                if pos > 0:
                    metadata_start = min(metadata_start, pos)
            # Also check for /$ and ^$ product type prefixes
            for prefix in ['/$', '^$']:
                pos = named.find(prefix)
                if pos > 0:
                    metadata_start = min(metadata_start, pos)

            # Check for percent token (digits followed by %) - use start of digits, not %
            percent_match = re.search(r'\b(\d{1,3})%', named)
            if percent_match and percent_match.start() > 0:
                metadata_start = min(metadata_start, percent_match.start())

            # Also check for dates and durations
            date_match = re.search(r'\d{4}-\d{2}-\d{2}', named)
            if date_match and date_match.start() > 0:
                metadata_start = min(metadata_start, date_match.start())

            duration_match = re.search(r'\d+[dwmy]', named)
            if duration_match and duration_match.start() > 0:
                metadata_start = min(metadata_start, duration_match.start())

            task_name = named[:metadata_start].strip().lstrip('*')
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
            key = child['name'] if '_text' in child_result else child['full_name']
            if key in result:
                # Duplicate sibling name. Dict keys must be unique, so give
                # this child its own key (a suffix that cannot appear in a
                # parsed task name) rather than overwriting the earlier
                # sibling's entry -- re-assigning an existing dict key keeps
                # the key's original insertion position but replaces its
                # value, which would both drop the earlier sibling's subtree
                # and leave the survivor in the wrong outline position.
                # Using a fresh key for every duplicate preserves outline
                # order (each child gets its own insertion-ordered slot) and
                # keeps every duplicate's subtree intact. The true name is
                # recovered by the consumer (schedule_tasks) via '_name'.
                dedup_key = f"{key}\x00{len(result)}"
                child_result['_name'] = key
                result[dedup_key] = child_result
            else:
                result[key] = child_result

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
