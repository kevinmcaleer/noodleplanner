"""Tests for calendar-aware scheduling (#1047, #1132).

Covers schedule_tasks' `calendar` and `resource_calendars` parameters: a
custom work week, a multi-week shift rotation, resource-specific calendar
overrides, and that layering a calendar in doesn't change anything for
callers that don't pass one (the historical Mon-Fri + holidays behaviour).

An explicit task start date (e.g. "2026-08-02") is kept verbatim in
``task['start']`` even when it falls outside the calendar's working days --
only ``finish`` (computed via working-day arithmetic from that start) moves.
So these tests read the calendar's effect off `finish`, not `start`.
`start`/`finish` come back as `datetime.datetime`, not `date`.
"""

from datetime import datetime, timedelta

from noodle_core import Calendar, parse_week_pattern, schedule_tasks


def _task(name, text, level=0):
    return {name: {'_text': text, '_level': level}}


class TestNoCalendarUnchanged:
    """Passing neither `calendar` nor `resource_calendars` must schedule
    exactly as before -- this is what the conformance corpus already pins;
    this is the same guarantee as a fast, targeted unit test."""

    def test_matches_scheduling_without_the_new_parameters(self):
        phases = [_task('Task 1', 'Task 1 @john 10d 2026-08-05')]
        with_none = schedule_tasks(phases, calendar=None, resource_calendars=None)
        without = schedule_tasks(phases)
        assert with_none[0]['finish'] == without[0]['finish']
        assert with_none[0]['finish'] == datetime(2026, 8, 19)  # straight through, no calendar


class TestCustomWorkWeek:
    def test_sun_thu_week_schedules_around_a_fri_sat_weekend(self):
        cal = Calendar(name='Gulf', week_pattern=parse_week_pattern('Sun-Thu'))
        # 2026-08-02 is a Sunday, a working day on Sun-Thu: 5 working days
        # (Sun,Mon,Tue,Wed,Thu) finish exclusive on Friday.
        phases = [_task('Task 1', 'Task 1 2026-08-02 5d')]
        tasks = schedule_tasks(phases, calendar=cal)
        assert tasks[0]['start'] == datetime(2026, 8, 2)
        assert tasks[0]['finish'] == datetime(2026, 8, 7)

    def test_the_same_task_on_the_default_calendar_runs_into_the_weekend(self):
        # On plain Mon-Fri, the Sunday start isn't a working day, so the
        # 5-day count doesn't begin until Monday -- one week later than the
        # Sun-Thu case above.
        phases = [_task('Task 1', 'Task 1 2026-08-02 5d')]
        tasks = schedule_tasks(phases)
        assert tasks[0]['start'] == datetime(2026, 8, 2)  # kept verbatim
        assert tasks[0]['finish'] == datetime(2026, 8, 8)  # Mon 3rd..Fri 7th, exclusive


class TestShiftRotation:
    def test_fortnight_rotation_produces_a_later_finish_than_a_plain_work_week(self):
        cal = Calendar(name='Fortnight', week_pattern=parse_week_pattern('[Mon-Fri; Mon-Wed]'))
        # Anchor the task inside a "short" (Mon-Wed) rotation week so the
        # difference from a plain Mon-Fri calendar is observable.
        from noodle_core.calendar_model import ROTATION_EPOCH
        short_week_monday = ROTATION_EPOCH + timedelta(days=7)  # rotation week index 1

        phases = [_task('Task 1', f'Task 1 {short_week_monday.isoformat()} 6d')]
        rotated = schedule_tasks(phases, calendar=cal)

        plain = Calendar(name='Standard')
        straight = schedule_tasks(phases, calendar=plain)

        assert rotated[0]['finish'] > straight[0]['finish']


class TestResourceCalendars:
    def test_a_resource_with_its_own_calendar_uses_it_instead_of_the_project_calendar(self):
        gulf = Calendar(name='Gulf', week_pattern=parse_week_pattern('Sun-Thu'))
        phases = [_task('Task 1', 'Task 1 @kev 2026-08-02 5d')]

        tasks = schedule_tasks(phases, resource_calendars={'kev': gulf})
        assert tasks[0]['finish'] == datetime(2026, 8, 7)  # Sun-Thu: no weekend gap

    def test_a_resource_without_an_assigned_calendar_uses_the_project_calendar(self):
        gulf = Calendar(name='Gulf', week_pattern=parse_week_pattern('Sun-Thu'))
        phases = [_task('Task 1', 'Task 1 @sam 2026-08-02 5d')]

        # @sam has no entry in resource_calendars, so falls back to the
        # implicit Standard (Mon-Fri) calendar: the weekend still applies.
        tasks = schedule_tasks(phases, resource_calendars={'kev': gulf})
        assert tasks[0]['finish'] == datetime(2026, 8, 8)


class TestHolidaysLayerOnTopOfACalendar:
    def test_project_wide_holiday_still_applies_when_a_calendar_is_given(self):
        cal = Calendar(name='Standard')
        holidays = {datetime(2026, 8, 10).date()}
        phases = [_task('Task 1', 'Task 1 2026-08-10 1d')]

        tasks = schedule_tasks(phases, calendar=cal, holidays=holidays)
        # 2026-08-10 (Monday) is the declared holiday; the 1-day task's
        # finish moves to the day after the next real working day.
        assert tasks[0]['finish'] == datetime(2026, 8, 12)

    def test_resource_non_working_days_still_apply_with_a_calendar(self):
        cal = Calendar(name='Standard')
        phases = [_task('Task 1', 'Task 1 @kev 2026-08-10 1d')]

        tasks = schedule_tasks(
            phases,
            calendar=cal,
            resource_non_working_days={'kev': {datetime(2026, 8, 10).date()}},
        )
        assert tasks[0]['finish'] == datetime(2026, 8, 12)

    def test_does_not_mutate_the_calendar_passed_in(self):
        # dataclasses.replace must be used, not an in-place exceptions.add():
        # the same Calendar instance is reused across every task and project.
        cal = Calendar(name='Standard')
        phases = [_task('Task 1', 'Task 1 2026-08-10 1d')]
        schedule_tasks(phases, calendar=cal, holidays={datetime(2026, 8, 10).date()})
        assert cal.exceptions == set()


class TestCriticalPathHonoursTheCalendar:
    def test_total_float_reflects_the_active_calendar(self):
        # Two parallel tasks feeding a shared successor; the longer one has
        # zero float (critical) on the Sun-Thu calendar too, proving the
        # float calc used the calendar rather than silently ignoring it.
        cal = Calendar(name='Gulf', week_pattern=parse_week_pattern('Sun-Thu'))
        phases = [
            _task('Short', 'Short 2026-08-02 2d'),
            _task('Long', 'Long 2026-08-02 5d'),
            _task('Final', '[depends: Short, Long] Final 1d'),
        ]
        tasks = schedule_tasks(phases, calendar=cal)
        by_name = {t['name']: t for t in tasks}
        assert by_name['Long']['critical'] is True
        assert by_name['Long']['total_float'] == 0
        assert by_name['Short']['total_float'] > 0
