"""Tests for recurring task functionality in noodle-core."""

import pytest
from datetime import date, timedelta
from noodle_core import parse_recurrence, generate_recurrence_occurrences


class TestParseRecurrence:
    """Tests for the parse_recurrence function."""

    def test_parse_daily(self):
        result = parse_recurrence('daily')
        assert result['frequency'] == 'daily'
        assert result['raw'] == 'daily'

    def test_parse_yearly(self):
        result = parse_recurrence('yearly')
        assert result['frequency'] == 'yearly'

    def test_parse_weekly_no_days(self):
        result = parse_recurrence('weekly')
        assert result['frequency'] == 'weekly'
        assert result['days'] == []

    def test_parse_weekly_single_day(self):
        result = parse_recurrence('weekly mon')
        assert result['frequency'] == 'weekly'
        assert result['days'] == ['mon']

    def test_parse_weekly_multiple_days(self):
        result = parse_recurrence('weekly mon,wed,fri')
        assert result['frequency'] == 'weekly'
        assert result['days'] == ['mon', 'wed', 'fri']

    def test_parse_weekly_with_spaces(self):
        result = parse_recurrence('weekly mon, wed, fri')
        assert result['frequency'] == 'weekly'
        assert result['days'] == ['mon', 'wed', 'fri']

    def test_parse_monthly_1st_thursday(self):
        result = parse_recurrence('monthly 1st thu')
        assert result['frequency'] == 'monthly'
        assert result['week_of_month'] == 1
        assert result['day_of_week'] == 'thu'

    def test_parse_monthly_3rd_thursday(self):
        result = parse_recurrence('monthly 3rd thu')
        assert result['frequency'] == 'monthly'
        assert result['week_of_month'] == 3
        assert result['day_of_week'] == 'thu'

    def test_parse_monthly_2nd_monday(self):
        result = parse_recurrence('monthly 2nd mon')
        assert result['frequency'] == 'monthly'
        assert result['week_of_month'] == 2
        assert result['day_of_week'] == 'mon'

    def test_parse_monthly_5th_friday(self):
        result = parse_recurrence('monthly 5th fri')
        assert result['frequency'] == 'monthly'
        assert result['week_of_month'] == 5
        assert result['day_of_week'] == 'fri'

    def test_parse_case_insensitive(self):
        result = parse_recurrence('DAILY')
        assert result['frequency'] == 'daily'

    def test_parse_weekly_case_insensitive(self):
        result = parse_recurrence('Weekly MON,WED')
        assert result['frequency'] == 'weekly'
        assert 'mon' in result['days']
        assert 'wed' in result['days']

    def test_raw_preserved(self):
        result = parse_recurrence('weekly mon,fri')
        assert 'raw' in result


class TestGenerateRecurrenceOccurrences:
    """Tests for the generate_recurrence_occurrences function."""

    def _make_task(self, recurrence_str, start='2026-03-01'):
        return {
            'name': 'Test Task',
            'start': start,
            'recurrence': parse_recurrence(recurrence_str),
        }

    def test_daily_produces_occurrences_for_each_day(self):
        task = self._make_task('daily')
        window_start = date(2026, 3, 1)
        window_end = date(2026, 3, 5)
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        assert len(occurrences) == 5
        assert occurrences[0] == date(2026, 3, 1)
        assert occurrences[4] == date(2026, 3, 5)

    def test_daily_respects_window_bounds(self):
        task = self._make_task('daily')
        window_start = date(2026, 3, 10)
        window_end = date(2026, 3, 12)
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        assert len(occurrences) == 3

    def test_weekly_specific_days(self):
        task = self._make_task('weekly mon,wed,fri')
        # Week of 2026-03-16 (Mon) to 2026-03-22 (Sun)
        window_start = date(2026, 3, 16)  # Monday
        window_end = date(2026, 3, 22)    # Sunday
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        # Should be Mon Mar 16, Wed Mar 18, Fri Mar 20
        assert len(occurrences) == 3
        assert date(2026, 3, 16) in occurrences  # Monday
        assert date(2026, 3, 18) in occurrences  # Wednesday
        assert date(2026, 3, 20) in occurrences  # Friday

    def test_weekly_no_days_produces_daily(self):
        task = self._make_task('weekly')
        window_start = date(2026, 3, 1)
        window_end = date(2026, 3, 3)
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        assert len(occurrences) == 3

    def test_monthly_1st_monday(self):
        task = self._make_task('monthly 1st mon')
        # March 2026: 1st Monday is March 2
        window_start = date(2026, 3, 1)
        window_end = date(2026, 3, 31)
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        assert date(2026, 3, 2) in occurrences

    def test_monthly_3rd_thursday_march_2026(self):
        task = self._make_task('monthly 3rd thu')
        # March 2026: Thursdays are 5, 12, 19, 26 -> 3rd is March 19
        window_start = date(2026, 3, 1)
        window_end = date(2026, 3, 31)
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        assert date(2026, 3, 19) in occurrences

    def test_monthly_crosses_multiple_months(self):
        task = self._make_task('monthly 1st mon')
        # March and April 2026
        window_start = date(2026, 3, 1)
        window_end = date(2026, 4, 30)
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        # Should have entries for both March and April
        months = {o.month for o in occurrences}
        assert 3 in months
        assert 4 in months

    def test_yearly_includes_occurrence_in_window(self):
        task = self._make_task('yearly', start='2025-06-15')
        window_start = date(2026, 6, 1)
        window_end = date(2026, 6, 30)
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        assert date(2026, 6, 15) in occurrences

    def test_yearly_excludes_occurrence_outside_window(self):
        task = self._make_task('yearly', start='2025-06-15')
        window_start = date(2026, 1, 1)
        window_end = date(2026, 5, 31)
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        assert len(occurrences) == 0

    def test_no_recurrence_returns_empty(self):
        task = {'name': 'Task', 'start': '2026-03-01'}
        occurrences = generate_recurrence_occurrences(task, date(2026, 3, 1), date(2026, 3, 31))
        assert occurrences == []

    def test_empty_window_returns_empty(self):
        task = self._make_task('daily')
        window_start = date(2026, 3, 5)
        window_end = date(2026, 3, 4)  # end before start
        occurrences = generate_recurrence_occurrences(task, window_start, window_end)
        assert occurrences == []


class TestRecurrenceExtractionFromMetadata:
    """Tests that recurrence is extracted correctly from task strings."""

    def test_extract_daily_recurrence(self):
        from noodle_core import extract_metadata
        meta = extract_metadata('my task [repeats daily]', 'my task')
        assert 'recurrence' in meta
        assert meta['recurrence']['frequency'] == 'daily'

    def test_extract_weekly_recurrence(self):
        from noodle_core import extract_metadata
        meta = extract_metadata('standup [repeats weekly mon,wed,fri]', 'standup')
        assert 'recurrence' in meta
        assert meta['recurrence']['frequency'] == 'weekly'
        assert 'mon' in meta['recurrence']['days']
        assert 'fri' in meta['recurrence']['days']

    def test_extract_monthly_recurrence(self):
        from noodle_core import extract_metadata
        meta = extract_metadata('team meeting [repeats monthly 3rd thu]', 'team meeting')
        assert 'recurrence' in meta
        assert meta['recurrence']['frequency'] == 'monthly'
        assert meta['recurrence']['week_of_month'] == 3
        assert meta['recurrence']['day_of_week'] == 'thu'

    def test_extract_yearly_recurrence(self):
        from noodle_core import extract_metadata
        meta = extract_metadata('annual review [repeats yearly]', 'annual review')
        assert 'recurrence' in meta
        assert meta['recurrence']['frequency'] == 'yearly'

    def test_no_recurrence_not_in_meta(self):
        from noodle_core import extract_metadata
        meta = extract_metadata('simple task 5d @kev', 'simple task')
        assert 'recurrence' not in meta

    def test_recurrence_case_insensitive(self):
        from noodle_core import extract_metadata
        meta = extract_metadata('task [REPEATS DAILY]', 'task')
        assert 'recurrence' in meta
        assert meta['recurrence']['frequency'] == 'daily'

    def test_recurrence_coexists_with_other_metadata(self):
        from noodle_core import extract_metadata
        meta = extract_metadata('standup 1d @alice [repeats weekly mon,wed,fri]', 'standup')
        assert 'recurrence' in meta
        assert meta['recurrence']['frequency'] == 'weekly'
        assert 'resources' in meta
        assert 'alice' in meta['resources']
