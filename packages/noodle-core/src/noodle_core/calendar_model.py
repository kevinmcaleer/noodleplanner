"""Named project calendars: work weeks, shift-pattern rotations, optional
daily working hours, and exceptions (#1047, #1134).

A calendar answers one question -- is this date a working day, and if so
what hours -- for the scheduling engine (#1132) and Calendars UI (#1135) to
build on. See ``docs/reference/front-matter.rst`` for the ``calendar:`` /
``calendars:`` front-matter keys this module parses and serializes.

The front-matter grammar for one calendar entry, all but the name optional::

    - <Name>: <week-pattern> [hours HH:MM-HH:MM] [exceptions [<exception-list>]]

``<week-pattern>`` is either a single work week (``Mon-Fri``, ``Sun-Thu``,
``Mon,Wed,Fri``) or a bracketed, semicolon-separated shift rotation
(``[Mon-Fri; Mon-Wed]`` for a two-week fortnight pattern). Day ranges wrap:
``Sun-Thu`` walks Sun, Mon, Tue, Wed, Thu forward through the week rather
than being empty because Sun's index is numerically after Thu's.

``<exception-list>`` reuses the ``non-working-days:`` named-entry grammar --
comma-separated ``Name: YYYY-MM-DD`` or ``Name: YYYY-MM-DD:YYYY-MM-DD``
entries, name optional.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_DAY_INDEX = {name.lower(): i for i, name in enumerate(DAY_NAMES)}

# A fixed Monday used as week 0 of every shift rotation, so a calendar's
# working days come out the same regardless of which project uses it or
# when that project happens to start.
ROTATION_EPOCH = date(2001, 1, 1)

_HOURS_RE = re.compile(r"\bhours\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\b", re.IGNORECASE)
_EXCEPTIONS_RE = re.compile(r"\bexceptions\s*\[([^\]]*)\]", re.IGNORECASE)
_EXCEPTION_ENTRY_RE = re.compile(
    r"^(?:(.+?):\s*)?(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?$"
)


class CalendarFormatError(ValueError):
    """A `calendars:` front-matter entry could not be parsed."""


def _day_index(name: str) -> int:
    key = name.strip().lower()[:3]
    if key not in _DAY_INDEX:
        raise CalendarFormatError(f"unrecognised day name: {name!r}")
    return _DAY_INDEX[key]


def _parse_day_list(text: str) -> set[int]:
    """One week's worth of day tokens: comma-separated names and/or A-B ranges."""
    days: set[int] = set()
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start, end = _day_index(start_s), _day_index(end_s)
            i = start
            while True:
                days.add(i)
                if i == end:
                    break
                i = (i + 1) % 7
        else:
            days.add(_day_index(part))
    if not days:
        raise CalendarFormatError(f"empty day pattern: {text!r}")
    return days


def parse_week_pattern(text: str) -> list[set[int]]:
    """A work week or bracketed shift rotation into per-week working-day sets.

    ``"Mon-Fri"`` -> ``[{0,1,2,3,4}]`` (one week, repeats every week).
    ``"[Mon-Fri; Mon-Wed]"`` -> a two-week rotation, weeks alternating.
    """
    text = text.strip()
    if not text:
        raise CalendarFormatError("empty week pattern")
    if text.startswith("[") and text.endswith("]"):
        weeks = [seg.strip() for seg in text[1:-1].split(";") if seg.strip()]
        if not weeks:
            raise CalendarFormatError(f"empty rotation: {text!r}")
        return [_parse_day_list(week) for week in weeks]
    return [_parse_day_list(text)]


def week_pattern_text(week_pattern: list[set[int]]) -> str:
    """The inverse of ``parse_week_pattern``: day sets back to compact ranges."""
    rendered = [_day_set_text(days) for days in week_pattern]
    if len(rendered) == 1:
        return rendered[0]
    return "[" + "; ".join(rendered) + "]"


def _day_set_text(days: set[int]) -> str:
    ordered = sorted(days)
    ranges: list[tuple[int, int]] = []
    for day in ordered:
        if ranges and ranges[-1][1] == day - 1:
            ranges[-1] = (ranges[-1][0], day)
        else:
            ranges.append((day, day))
    parts = [
        DAY_NAMES[start] if start == end else f"{DAY_NAMES[start]}-{DAY_NAMES[end]}"
        for start, end in ranges
    ]
    return ",".join(parts)


def _parse_time(text: str) -> time:
    hour_s, minute_s = text.split(":", 1)
    return time(int(hour_s), int(minute_s))


def _parse_exceptions(text: str) -> set[date]:
    """The ``exceptions [...]`` bracket contents: named dates and date ranges."""
    dates: set[date] = set()
    for raw in text.split(","):
        entry = raw.strip()
        if not entry:
            continue
        match = _EXCEPTION_ENTRY_RE.match(entry)
        if not match:
            raise CalendarFormatError(f"bad exception entry: {entry!r}")
        start = datetime.strptime(match.group(2), "%Y-%m-%d").date()
        end = datetime.strptime(match.group(3), "%Y-%m-%d").date() if match.group(3) else start
        current = start
        while current <= end:
            dates.add(current)
            current = date.fromordinal(current.toordinal() + 1)
    return dates


@dataclass
class Calendar:
    """A named calendar: which weekdays (or rotation of weekdays) are
    working days, optional daily working hours, and dated exceptions that
    are always non-working regardless of the week pattern.
    """

    name: str
    week_pattern: list[set[int]] = field(default_factory=lambda: [set(range(5))])
    hours: tuple[time, time] | None = None
    exceptions: set[date] = field(default_factory=set)

    def is_working_day(self, on: date) -> bool:
        if on in self.exceptions:
            return False
        week_index = ((on - ROTATION_EPOCH).days // 7) % len(self.week_pattern)
        return on.weekday() in self.week_pattern[week_index]

    def working_hours_on(self, on: date) -> tuple[time, time] | None:
        return self.hours if self.hours and self.is_working_day(on) else None

    def to_front_matter_line(self) -> str:
        """Round-trips ``parse_calendar_entry``'s output back to markdown."""
        line = f"- {self.name}: {week_pattern_text(self.week_pattern)}"
        if self.hours:
            start, end = self.hours
            line += f" hours {start.strftime('%H:%M')}-{end.strftime('%H:%M')}"
        if self.exceptions:
            line += " exceptions [" + ", ".join(
                d.isoformat() for d in sorted(self.exceptions)
            ) + "]"
        return line


#: The implicit calendar every plan has when it declares no ``calendars:``
#: block -- Monday to Friday, no hours restriction, no exceptions. This
#: matches the scheduling engine's long-standing hardcoded weekend rule
#: (``weekday() >= 5``), so a plan with no calendar keeps behaving exactly
#: as it always has.
STANDARD_CALENDAR = Calendar(name="Standard")


def parse_calendar_entry(name: str, rest: str) -> Calendar:
    """One ``calendars:`` list entry's value (everything after ``Name:``)."""
    hours = None
    hours_match = _HOURS_RE.search(rest)
    if hours_match:
        hours = (_parse_time(hours_match.group(1)), _parse_time(hours_match.group(2)))
        rest = rest[: hours_match.start()] + rest[hours_match.end() :]

    exceptions: set[date] = set()
    exceptions_match = _EXCEPTIONS_RE.search(rest)
    if exceptions_match:
        exceptions = _parse_exceptions(exceptions_match.group(1))
        rest = rest[: exceptions_match.start()] + rest[exceptions_match.end() :]

    week_pattern = parse_week_pattern(rest.strip())
    return Calendar(name=name, week_pattern=week_pattern, hours=hours, exceptions=exceptions)
