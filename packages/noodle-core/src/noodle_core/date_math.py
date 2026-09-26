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


class _NormalizedHolidays(frozenset):
    """A holiday set already reduced to plain `date`s by
    ``_normalize_calendar_or_holidays``.

    Normalizing is O(number of holidays), and it used to happen on every
    date_math call -- several per task, plus once more when
    ``add_working_days`` handed the raw set on to ``get_next_working_day``.
    With a few thousand holiday dates that turned a 2,000-task schedule from
    hundredths of a second into seconds. Marking the normalized set with its
    own type lets a caller normalize once and pass the result to every
    call, each of which then recognises it and skips the work.
    """
    __slots__ = ()


_NO_HOLIDAYS = _NormalizedHolidays()


def _normalize_calendar_or_holidays(holidays):
    """Prepare the ``holidays`` argument once per call for repeated checks.

    ``holidays`` is either the historical shape -- an iterable of exception
    dates, Mon-Fri assumed working -- or a ``Calendar``-like object (issue
    #1132, duck-typed via ``is_working_day`` rather than isinstance so
    ``noodle_core.calendar_model`` doesn't have to be importable from here)
    whose own week pattern decides instead of the hardcoded Mon-Fri
    assumption. A calendar is returned as-is; a plain iterable is
    normalized to a `date`-only set once, rather than on every day checked,
    and a set this function already normalized is returned as-is too.
    """
    if holidays is None:
        return _NO_HOLIDAYS
    if isinstance(holidays, _NormalizedHolidays) or hasattr(holidays, 'is_working_day'):
        return holidays
    return _NormalizedHolidays(_as_date(h) for h in holidays)


def _is_working_day(current_date, normalized):
    """Whether `current_date` is a working day under an already-normalized
    ``holidays`` value (see ``_normalize_calendar_or_holidays``)."""
    if hasattr(normalized, 'is_working_day'):
        return normalized.is_working_day(_as_date(current_date))
    is_weekend = current_date.weekday() >= 5  # Saturday=5, Sunday=6
    is_holiday = _as_date(current_date) in normalized
    return not is_weekend and not is_holiday


def is_working_day(day, holidays=None):
    """Whether *day* is a working day.

    Use this rather than ``get_next_working_day(day, holidays) == day``,
    which answers the same question by searching ahead from every
    non-working day -- and raises if it runs out of search first.

    Args:
        day: The date (or datetime) to check
        holidays: Set of holiday dates to skip, or a Calendar (optional)
    """
    return _is_working_day(day, _normalize_calendar_or_holidays(holidays))


def _max_days_to_next_working_day(normalized):
    """How far ``get_next_working_day`` may search before giving up.

    A flat year used to be the cap, so a plan with a longer shutdown -- an
    18-month site closure, say -- raised instead of scheduling past it.
    The search can only fail for a calendar with no working weekdays at all;
    otherwise every rotation of ``week_pattern`` has a working day, and each
    exception date can knock out at most one of them, so a working day is
    always found within 7 * weeks-in-rotation * (exceptions + 1) days. The
    year stays as the floor so short searches are unchanged.
    """
    if hasattr(normalized, 'is_working_day'):
        exceptions = len(getattr(normalized, 'exceptions', ()) or ())
        weeks = len(getattr(normalized, 'week_pattern', ()) or ()) or 1
    else:
        exceptions = len(normalized)
        weeks = 1
    return max(366, 7 * weeks * (exceptions + 1))


def get_next_working_day(date, holidays=None):
    """Get the next working day from a given date.

    If the given date is already a working day, return it.
    Otherwise, find the next working day (skipping weekends and holidays).

    Args:
        date: The date to check
        holidays: Set of holiday dates to skip, or a Calendar (optional)

    Returns:
        The next working day (could be the same date if it's already a working day)
    """
    normalized = _normalize_calendar_or_holidays(holidays)

    current_date = date
    max_iterations = _max_days_to_next_working_day(normalized)
    for _ in range(max_iterations):
        if _is_working_day(current_date, normalized):
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
        holidays: Set of holiday dates to skip, or a Calendar (optional)

    Returns:
        The finish date after adding working days (exclusive)
    """
    normalized = _normalize_calendar_or_holidays(holidays)

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

            if _is_working_day(current_date, normalized):
                days_subtracted += 1

        return current_date

    # Handle positive days (going forward)
    # Ensure we start from a working day (passing the set normalized above,
    # not the raw one, so it isn't normalized a second time)
    current_date = get_next_working_day(start_date, normalized)
    days_added = 1  # Start day counts as day 1

    # Add remaining days
    while days_added < num_days:
        current_date += timedelta(days=1)

        if _is_working_day(current_date, normalized):
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
    normalized = _normalize_calendar_or_holidays(holidays)
    if start_date >= end_date:
        return 0
    count = 0
    current = start_date
    while current < end_date:
        if _is_working_day(current, normalized):
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
