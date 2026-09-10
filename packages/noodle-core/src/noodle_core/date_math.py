"""Date math utilities for the scheduling engine.

Pure date/calendar functions with no internal package dependencies.
"""

import re
from datetime import datetime, timedelta


def _as_date(value):
    """Normalize a date or datetime to a plain date.

    ``date`` and ``datetime`` are never equal to each other even for the same
    calendar day (a `datetime` is considered more precise), so a holiday set
    built from `date` objects silently never matches the `datetime` values
    the scheduling engine works with unless both sides are normalized first.

    Duck-typed (``hasattr`` rather than ``isinstance(value, datetime)``)
    because the conformance-corpus builder monkeypatches this module's
    ``datetime`` name with a `.now()`-frozen subclass to pin "today" -- an
    isinstance check against that name would silently stop matching real
    `datetime` instances the moment the patch is active. `date` objects have
    no `.date()` method, so this still leaves them unchanged.
    """
    return value.date() if hasattr(value, 'date') else value


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
    normalized_holidays = {_as_date(h) for h in holidays}

    current_date = date
    max_iterations = 366
    for _ in range(max_iterations):
        is_weekend = current_date.weekday() >= 5  # Saturday=5, Sunday=6
        is_holiday = _as_date(current_date) in normalized_holidays

        if not is_weekend and not is_holiday:
            return current_date

        current_date += timedelta(days=1)

    raise ValueError(
        f"Could not find a working day within {max_iterations} days of {date}"
    )

def today_working_day(holidays=None):
    """Return today (midnight) snapped to the next working day."""
    return get_next_working_day(
        datetime.now().replace(hour=0, minute=0, second=0, microsecond=0),
        holidays,
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
    normalized_holidays = {_as_date(h) for h in holidays}

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
            is_holiday = _as_date(current_date) in normalized_holidays

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
        is_holiday = _as_date(current_date) in normalized_holidays

        if not is_weekend and not is_holiday:
            days_added += 1

    # Return the day AFTER the last working day (finish date is exclusive for rendering)
    # This allows Gantt charts to render bars with proper width
    return current_date + timedelta(days=1)

def compute_finish(task, holidays=None):
    """Calculate and set task['finish'] from task['start'] and task['duration'].

    Uses working-day arithmetic when duration is a timedelta, otherwise
    falls back to adding one calendar day.
    """
    duration = task.get('duration', timedelta(days=1))
    if isinstance(duration, timedelta):
        task['finish'] = add_working_days(task['start'], duration.days, holidays)
    else:
        task['finish'] = task['start'] + timedelta(days=1)

def count_working_days(start_date, end_date, holidays=None):
    """Count the number of working days between start_date and end_date.

    Both dates are inclusive-exclusive (matching the finish date convention).
    """
    if holidays is None:
        holidays = set()
    normalized_holidays = {_as_date(h) for h in holidays}
    if start_date >= end_date:
        return 0
    count = 0
    current = start_date
    while current < end_date:
        if current.weekday() < 5 and _as_date(current) not in normalized_holidays:
            count += 1
        current += timedelta(days=1)
    return count

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
