"""Consolidated front matter parsing for NoodlePlanner project plans.

Replaces scattered front matter parsing with a single class that provides
a consistent interface for extracting title, highlights, RAID log, baseline,
resource mappings, and key-value pairs from plan text.
"""

import logging
import re
import yaml

from .format_converter import (
    extract_highlights,
    extract_raid_log,
    parse_raid_markdown,
    extract_baseline,
    parse_baseline_markdown,
    _is_valid_yaml_value,
)
from .scheduling_engine import parse_resource_mappings, parse_resource_calendars
from .calendar_model import Calendar, CalendarFormatError, STANDARD_CALENDAR, parse_calendar_entry

logger = logging.getLogger(__name__)


def programme_name_from_slug(slug: str) -> str:
    """Derive a human-readable programme name from its slug.

    ``digital-transformation`` becomes ``Digital Transformation``.
    """
    return re.sub(r'[-_]+', ' ', slug).strip().title()


class FrontMatterParser:
    """Parse all front matter data from a plan text in a single pass.

    Usage:
        parser = FrontMatterParser(plan_text)
        title = parser.parse_title()
        highlights = parser.parse_highlights()
        raid_items = parser.parse_raid()
        key_values = parser.parse_key_values()
        resource_map = parser.parse_resource_mappings()
        baseline_items = parser.parse_baseline()
    """

    def __init__(self, plan_text: str):
        self._plan_text = plan_text
        self._front_matter_lines = None
        self._cached_key_values = None

    def _extract_front_matter_lines(self) -> list[str]:
        """Extract raw front matter lines between --- delimiters."""
        if self._front_matter_lines is not None:
            return self._front_matter_lines

        lines = self._plan_text.split('\n')
        in_front_matter = False
        front_matter_lines = []

        for line in lines:
            if line.strip() == '---':
                if not in_front_matter:
                    in_front_matter = True
                    continue
                else:
                    break
            if in_front_matter:
                front_matter_lines.append(line)

        self._front_matter_lines = front_matter_lines
        return self._front_matter_lines

    def parse_title(self) -> str | None:
        """Extract title from YAML front matter.

        Returns the title string, or None if not found.
        """
        front_matter_lines = self._extract_front_matter_lines()
        if not front_matter_lines:
            return None

        try:
            yaml_text = '\n'.join(front_matter_lines)
            frontmatter = yaml.safe_load(yaml_text)
            if isinstance(frontmatter, dict):
                for key, value in frontmatter.items():
                    if key.lower() == 'title' and value is not None:
                        return str(value)
        except yaml.YAMLError:
            for line in front_matter_lines:
                if ':' in line:
                    key, value = line.split(':', 1)
                    if key.strip().lower() == 'title':
                        title = value.strip()
                        if title and _is_valid_yaml_value(title):
                            return title

        return None

    def parse_highlights(self) -> list:
        """Extract highlights from the plan text.

        Returns a list of highlight dicts with date, author, and content fields.
        """
        return extract_highlights(self._plan_text)

    def parse_raid(self) -> list:
        """Extract and parse RAID log items from the plan text.

        Returns a list of RAID item dicts.
        """
        try:
            raid_log_text = extract_raid_log(self._plan_text)
            if raid_log_text:
                return parse_raid_markdown(raid_log_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse RAID log from plan text: {e}")
        return []

    def parse_baseline(self) -> list:
        """Extract and parse baseline items from the plan text.

        Returns a list of baseline item dicts.
        """
        try:
            baseline_text = extract_baseline(self._plan_text)
            if baseline_text:
                return parse_baseline_markdown(baseline_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse baseline from plan text: {e}")
        return []

    def parse_key_values(self) -> dict:
        """Parse key-value pairs from front matter.

        Returns a dict of lowercase keys to stripped string values.
        """
        if self._cached_key_values is not None:
            return self._cached_key_values

        front_matter = {}
        for line in self._extract_front_matter_lines():
            if ':' in line:
                key, value = line.split(':', 1)
                front_matter[key.strip().lower()] = value.strip()

        self._cached_key_values = front_matter
        return self._cached_key_values

    def parse_programme(self) -> dict | None:
        """Extract programme membership from front matter.

        A project belongs to a programme by naming it in a ``programme:``
        slug field; there is no programme file to point at. Returns a dict
        with ``slug`` and ``name`` keys, or None when the project has no
        ``programme:`` field (it is unassigned). ``name`` comes from
        ``programme_name`` when present, otherwise it is derived from the
        slug.
        """
        key_values = self.parse_key_values()
        slug = key_values.get('programme', '').strip()
        if not slug:
            return None

        name = key_values.get('programme_name', '').strip()
        if not name:
            name = programme_name_from_slug(slug)

        return {'slug': slug, 'name': name}

    def parse_resource_mappings(self) -> dict:
        """Parse resource mappings from front matter.

        Returns a dict mapping short names to full names.
        """
        resource_map, _ = parse_resource_mappings(self._plan_text)
        return resource_map

    def parse_non_working_days(self) -> set:
        """Parse project-wide non-working days from front matter.

        Supports two formats:

        Legacy flat format::

            non-working-days: 2026-12-25, 2026-12-26

        Named list format with optional date ranges::

            non-working-days:
              - Christmas: 2026-12-25:2026-12-26
              - New Year: 2027-01-01

        Returns a set of datetime.date objects.
        """
        from datetime import datetime as _dt, timedelta as _td

        dates = set()

        # First try the new list format by scanning front matter lines
        lines = self._extract_front_matter_lines()
        in_nwd_list = False
        found_list = False
        for line in lines:
            stripped = line.strip()
            # Detect section header
            if stripped.lower() in ('non-working-days:', 'holidays:'):
                in_nwd_list = True
                continue
            # If we're in the list, look for "- Name: date" or "- Name: date:date"
            if in_nwd_list:
                if stripped.startswith('- '):
                    found_list = True
                    entry = stripped[2:].strip()
                    # Named entry: "Name: date" or "Name: date:date"
                    # Also handle legacy unnamed: "- 2026-12-25"
                    name_match = re.match(
                        r'(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$',
                        entry
                    )
                    if name_match:
                        start_str = name_match.group(2)
                        end_str = name_match.group(3)
                        try:
                            start = _dt.strptime(start_str, '%Y-%m-%d').date()
                            if end_str:
                                end = _dt.strptime(end_str, '%Y-%m-%d').date()
                                current = start
                                while current <= end:
                                    dates.add(current)
                                    current += _td(days=1)
                            else:
                                dates.add(start)
                        except ValueError:
                            logger.warning("Invalid date in non-working-days list entry: %s", entry)
                    else:
                        # Try as a bare date
                        date_match = re.match(r'(\d{4}-\d{2}-\d{2})\s*$', entry)
                        if date_match:
                            try:
                                dates.add(_dt.strptime(date_match.group(1), '%Y-%m-%d').date())
                            except ValueError:
                                logger.warning("Invalid date in non-working-days list: %s", entry)
                elif stripped and not stripped.startswith('#'):
                    # Non-list-item, non-empty line means we left the section
                    in_nwd_list = False

        # If no list items found, fall back to the legacy flat format
        if not found_list:
            key_values = self.parse_key_values()
            for key in ('non-working-days', 'holidays'):
                value = key_values.get(key, '')
                if value:
                    date_matches = re.findall(r'\d{4}-\d{2}-\d{2}', value)
                    for date_str in date_matches:
                        try:
                            dates.add(_dt.strptime(date_str, '%Y-%m-%d').date())
                        except ValueError:
                            logger.warning(f"Invalid date in {key}: {date_str}")

        return dates

    def parse_named_non_working_days(self) -> list:
        """Parse project-wide non-working days preserving names and ranges.

        Returns a list of dicts with 'name', 'start', and optional 'finish' keys.
        Dates are strings in YYYY-MM-DD format.
        """
        entries = []
        lines = self._extract_front_matter_lines()
        in_nwd_list = False
        for line in lines:
            stripped = line.strip()
            if stripped.lower() in ('non-working-days:', 'holidays:'):
                in_nwd_list = True
                continue
            if in_nwd_list:
                if stripped.startswith('- '):
                    entry_text = stripped[2:].strip()
                    name_match = re.match(
                        r'(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$',
                        entry_text
                    )
                    if name_match:
                        entries.append({
                            'name': name_match.group(1).strip(),
                            'start': name_match.group(2),
                            'finish': name_match.group(3) or '',
                        })
                    else:
                        # Bare date
                        date_match = re.match(r'(\d{4}-\d{2}-\d{2})\s*$', entry_text)
                        if date_match:
                            entries.append({
                                'name': '',
                                'start': date_match.group(1),
                                'finish': '',
                            })
                elif stripped and not stripped.startswith('#'):
                    in_nwd_list = False
        return entries

    def parse_dependencies(self) -> list:
        """Parse programme dependencies from front matter.

        Supports the list format::

            dependencies:
              - from: Project A
                task: Milestone 1
                to_task: Design Start
                type: FS
                lag: 0

        Returns a list of dicts with 'from', 'task', 'to_task', 'type', and 'lag' keys.
        """
        entries = []
        lines = self._extract_front_matter_lines()
        in_deps = False
        current_entry = None

        for line in lines:
            stripped = line.strip()
            if stripped.lower() == 'dependencies:':
                in_deps = True
                continue
            if in_deps:
                if stripped.startswith('- '):
                    # New dependency entry
                    if current_entry is not None:
                        entries.append(current_entry)
                    current_entry = {
                        'from': '',
                        'task': '',
                        'to_task': '',
                        'type': 'FS',
                        'lag': 0,
                    }
                    # Parse inline key if present: "- from: value"
                    remainder = stripped[2:].strip()
                    if ':' in remainder:
                        key, value = remainder.split(':', 1)
                        key = key.strip().lower()
                        if key in current_entry:
                            val = value.strip()
                            if key == 'lag':
                                try:
                                    val = int(val)
                                except ValueError:
                                    val = 0
                            current_entry[key] = val
                elif stripped and ':' in stripped and current_entry is not None:
                    # Continuation key: "  task: value"
                    key, value = stripped.split(':', 1)
                    key = key.strip().lower()
                    if key in current_entry:
                        val = value.strip()
                        if key == 'lag':
                            try:
                                val = int(val)
                            except ValueError:
                                val = 0
                        current_entry[key] = val
                elif stripped and not stripped.startswith('#') and not stripped.startswith('-'):
                    # Non-continuation, non-list line means we left the section
                    # only if it doesn't look like a key: value
                    if ':' not in stripped:
                        in_deps = False
                        if current_entry is not None:
                            entries.append(current_entry)
                            current_entry = None

        if current_entry is not None:
            entries.append(current_entry)

        return entries

    def parse_resource_non_working_days(self) -> dict:
        """Parse resource-level non-working days from resource lines.

        Extracts the ``non-working [...]`` suffix from resource lines in the
        front matter.  Supports individual dates and date ranges
        (``YYYY-MM-DD:YYYY-MM-DD``).

        Returns a dict mapping lowercase shortnames to sets of datetime.date objects.
        """
        _, resource_nwd = parse_resource_mappings(self._plan_text)
        return resource_nwd

    def parse_calendars(self) -> dict:
        """Named project calendars from the ``calendars:`` front-matter list.

        Returns ``{"Standard": Calendar(name="Standard")}`` when the plan
        declares no ``calendars:`` block, so callers always have at least
        one calendar to schedule against -- matching the engine's
        long-standing Mon-Fri default.
        """
        calendars: dict[str, Calendar] = {}
        lines = self._extract_front_matter_lines()
        in_list = False
        for line in lines:
            stripped = line.strip()
            if stripped.lower() == 'calendars:':
                in_list = True
                continue
            if in_list:
                if stripped.startswith('- ') and ':' in stripped[2:]:
                    entry = stripped[2:]
                    name, rest = entry.split(':', 1)
                    name = name.strip()
                    try:
                        calendars[name] = parse_calendar_entry(name, rest.strip())
                    except CalendarFormatError as exc:
                        logger.warning("Skipping invalid calendar %r: %s", name, exc)
                elif stripped and not stripped.startswith('#'):
                    in_list = False

        if not calendars:
            calendars[STANDARD_CALENDAR.name] = STANDARD_CALENDAR
        return calendars

    def parse_active_calendar_name(self) -> str | None:
        """The ``calendar:`` top-level key naming the active project calendar.

        None when the plan doesn't set one -- callers fall back to the
        Standard (Mon-Fri) calendar.
        """
        value = self.parse_key_values().get('calendar', '').strip()
        return value or None

    def active_calendar(self) -> Calendar:
        """The project's active calendar: named by ``calendar:``, falling
        back to Standard when unset or when the named calendar doesn't
        exist among ``calendars:``.
        """
        calendars = self.parse_calendars()
        active_name = self.parse_active_calendar_name()
        if active_name:
            if active_name in calendars:
                return calendars[active_name]
            logger.warning(
                "calendar: %r not found among calendars:, falling back to Standard",
                active_name,
            )
        return calendars.get(STANDARD_CALENDAR.name, STANDARD_CALENDAR)

    def resource_calendars(self) -> dict:
        """Each resource's assigned calendar, resolved to a Calendar object
        (issue #1136).

        A resource's ``calendar <Name>`` suffix (see
        ``parse_resource_calendars``) is resolved against ``calendars:``.
        A resource naming a calendar that isn't declared is omitted here
        entirely -- schedule_tasks() already falls back to the project's
        active calendar for any resource with no entry, which is the right
        behaviour for a typo'd or since-removed calendar name too.
        """
        calendars = self.parse_calendars()
        resolved: dict[str, Calendar] = {}
        for short_name, calendar_name in parse_resource_calendars(self._plan_text).items():
            if calendar_name in calendars:
                resolved[short_name] = calendars[calendar_name]
            else:
                logger.warning(
                    "resource @%s's calendar %r not found among calendars:, "
                    "falling back to the project calendar",
                    short_name, calendar_name,
                )
        return resolved
