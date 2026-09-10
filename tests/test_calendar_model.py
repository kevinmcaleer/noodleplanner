"""Tests for the named-calendar front-matter model (#1047, #1134)."""

from datetime import date, time

import pytest

from noodle_core import (
    Calendar,
    CalendarFormatError,
    FrontMatterParser,
    STANDARD_CALENDAR,
    parse_calendar_entry,
    parse_week_pattern,
    week_pattern_text,
)


class TestParseWeekPattern:
    def test_simple_range(self):
        assert parse_week_pattern("Mon-Fri") == [{0, 1, 2, 3, 4}]

    def test_comma_list(self):
        assert parse_week_pattern("Mon,Wed,Fri") == [{0, 2, 4}]

    def test_range_plus_extra_day(self):
        assert parse_week_pattern("Mon-Fri,Sat") == [{0, 1, 2, 3, 4, 5}]

    def test_wrapping_range(self):
        # Sun-Thu is a Middle-East-style week: Fri/Sat are the weekend.
        assert parse_week_pattern("Sun-Thu") == [{6, 0, 1, 2, 3}]

    def test_rotation(self):
        assert parse_week_pattern("[Mon-Fri; Mon-Wed]") == [
            {0, 1, 2, 3, 4},
            {0, 1, 2},
        ]

    def test_three_week_rotation(self):
        assert parse_week_pattern("[Mon-Fri; Mon-Fri; Sat]") == [
            {0, 1, 2, 3, 4},
            {0, 1, 2, 3, 4},
            {5},
        ]

    def test_unknown_day_raises(self):
        with pytest.raises(CalendarFormatError):
            parse_week_pattern("Munday-Fri")

    def test_empty_raises(self):
        with pytest.raises(CalendarFormatError):
            parse_week_pattern("")

    def test_round_trip_simple(self):
        assert week_pattern_text(parse_week_pattern("Mon-Fri")) == "Mon-Fri"

    def test_round_trip_rotation(self):
        text = "[Mon-Fri; Mon-Wed]"
        assert week_pattern_text(parse_week_pattern(text)) == text

    def test_round_trip_non_contiguous(self):
        assert week_pattern_text(parse_week_pattern("Mon,Wed,Fri")) == "Mon,Wed,Fri"


class TestParseCalendarEntry:
    def test_bare_week_pattern(self):
        cal = parse_calendar_entry("Standard", "Mon-Fri")
        assert cal.name == "Standard"
        assert cal.week_pattern == [{0, 1, 2, 3, 4}]
        assert cal.hours is None
        assert cal.exceptions == set()

    def test_with_hours(self):
        cal = parse_calendar_entry("Night Shift", "Sun-Thu hours 22:00-06:00")
        assert cal.week_pattern == [{6, 0, 1, 2, 3}]
        assert cal.hours == (time(22, 0), time(6, 0))

    def test_with_exceptions(self):
        cal = parse_calendar_entry(
            "Standard",
            "Mon-Fri exceptions [Christmas: 2026-12-25:2026-12-26, Training Day: 2026-03-10]",
        )
        assert cal.exceptions == {
            date(2026, 12, 25),
            date(2026, 12, 26),
            date(2026, 3, 10),
        }

    def test_unnamed_exception(self):
        cal = parse_calendar_entry("Standard", "Mon-Fri exceptions [2026-12-25]")
        assert cal.exceptions == {date(2026, 12, 25)}

    def test_hours_and_exceptions_and_rotation(self):
        cal = parse_calendar_entry(
            "Fortnight Ops",
            "[Mon-Fri; Mon-Wed] hours 08:00-16:30 exceptions [Christmas: 2026-12-25:2026-12-26]",
        )
        assert cal.week_pattern == [{0, 1, 2, 3, 4}, {0, 1, 2}]
        assert cal.hours == (time(8, 0), time(16, 30))
        assert cal.exceptions == {date(2026, 12, 25), date(2026, 12, 26)}

    def test_order_independent(self):
        a = parse_calendar_entry("X", "Mon-Fri hours 08:00-16:30 exceptions [2026-12-25]")
        b = parse_calendar_entry("X", "Mon-Fri exceptions [2026-12-25] hours 08:00-16:30")
        assert a == b

    def test_bad_exception_entry_raises(self):
        with pytest.raises(CalendarFormatError):
            parse_calendar_entry("X", "Mon-Fri exceptions [not-a-date]")


class TestCalendarWorkingDays:
    def test_standard_calendar_matches_default_weekend(self):
        cal = STANDARD_CALENDAR
        assert cal.is_working_day(date(2026, 8, 5))  # Wednesday
        assert not cal.is_working_day(date(2026, 8, 8))  # Saturday
        assert not cal.is_working_day(date(2026, 8, 9))  # Sunday

    def test_exceptions_override_the_week_pattern(self):
        cal = Calendar(name="X", exceptions={date(2026, 8, 5)})
        assert not cal.is_working_day(date(2026, 8, 5))

    def test_rotation_alternates_by_week(self):
        cal = Calendar(name="Fortnight", week_pattern=parse_week_pattern("[Mon-Fri; Mon-Wed]"))
        # Anchor a known week-0 Monday and its Thursday to check the pattern
        # actually alternates rather than just always using week 0.
        from noodle_core.calendar_model import ROTATION_EPOCH

        week0_thursday = ROTATION_EPOCH.replace(
            day=ROTATION_EPOCH.day + 3
        )  # Thu of week 0: full week
        week1_start = ROTATION_EPOCH.replace(day=ROTATION_EPOCH.day + 7)
        week1_thursday = week1_start.replace(day=week1_start.day + 3)

        assert cal.is_working_day(week0_thursday)  # week 0 is Mon-Fri
        assert not cal.is_working_day(week1_thursday)  # week 1 is Mon-Wed only

    def test_working_hours_on_non_working_day_is_none(self):
        cal = Calendar(name="X", hours=(time(9, 0), time(17, 0)), exceptions={date(2026, 8, 5)})
        assert cal.working_hours_on(date(2026, 8, 5)) is None

    def test_working_hours_on_working_day(self):
        cal = Calendar(name="X", hours=(time(9, 0), time(17, 0)))
        assert cal.working_hours_on(date(2026, 8, 5)) == (time(9, 0), time(17, 0))


class TestCalendarSerialization:
    def test_round_trips_through_front_matter_line(self):
        original = "- Fortnight Ops: [Mon-Fri; Mon-Wed] hours 08:00-16:30 exceptions [2026-12-25, 2026-12-26]"
        name, rest = original[2:].split(":", 1)
        cal = parse_calendar_entry(name.strip(), rest.strip())
        assert cal.to_front_matter_line() == (
            "- Fortnight Ops: [Mon-Fri; Mon-Wed] hours 08:00-16:30 "
            "exceptions [2026-12-25, 2026-12-26]"
        )

    def test_simple_calendar_line_is_compact(self):
        cal = Calendar(name="Standard")
        assert cal.to_front_matter_line() == "- Standard: Mon-Fri"


PLAN_WITH_CALENDARS = """\
---
title: Calendar Test
calendar: Fortnight Ops
calendars:
- Standard: Mon-Fri
- Night Shift: Sun-Thu hours 22:00-06:00
- Fortnight Ops: [Mon-Fri; Mon-Wed] hours 08:00-16:30 exceptions [Christmas: 2026-12-25:2026-12-26]
---
Phase 1
  Task A 3d
"""


class TestFrontMatterParserCalendars:
    def test_parses_all_named_calendars(self):
        parser = FrontMatterParser(PLAN_WITH_CALENDARS)
        calendars = parser.parse_calendars()
        assert set(calendars) == {"Standard", "Night Shift", "Fortnight Ops"}
        assert calendars["Night Shift"].hours == (time(22, 0), time(6, 0))
        assert calendars["Fortnight Ops"].week_pattern == [{0, 1, 2, 3, 4}, {0, 1, 2}]

    def test_active_calendar_name(self):
        parser = FrontMatterParser(PLAN_WITH_CALENDARS)
        assert parser.parse_active_calendar_name() == "Fortnight Ops"

    def test_active_calendar_resolves_the_object(self):
        parser = FrontMatterParser(PLAN_WITH_CALENDARS)
        active = parser.active_calendar()
        assert active.name == "Fortnight Ops"
        assert active.hours == (time(8, 0), time(16, 30))

    def test_no_calendars_block_defaults_to_standard(self):
        parser = FrontMatterParser("---\ntitle: No Calendars\n---\nTask A 1d\n")
        calendars = parser.parse_calendars()
        assert set(calendars) == {"Standard"}
        assert parser.active_calendar().name == "Standard"

    def test_calendar_key_naming_an_undefined_calendar_falls_back_to_standard(self):
        parser = FrontMatterParser(
            "---\ntitle: X\ncalendar: Nonexistent\n---\nTask A 1d\n"
        )
        assert parser.active_calendar().name == "Standard"

    def test_invalid_calendar_entry_is_skipped_not_fatal(self):
        plan = "---\ntitle: X\ncalendars:\n- Bad: Notaday-Fri\n- Good: Mon-Fri\n---\nTask A 1d\n"
        parser = FrontMatterParser(plan)
        calendars = parser.parse_calendars()
        assert set(calendars) == {"Good"}
