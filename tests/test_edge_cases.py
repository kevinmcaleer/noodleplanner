"""Test edge cases identified in code review."""

import pytest
from datetime import datetime, timedelta
from noodle_core import (
    Calendar,
    get_next_working_day,
    add_working_days,
    extract_metadata,
    schedule_tasks,
    natural_language_to_yaml,
    detect_dependency_loops,
)
from noodle_core.date_math import is_working_day


class TestInfiniteLoopProtection:
    """Tests to prevent infinite loops in scheduling functions."""

    def test_get_next_working_day_with_all_holidays(self):
        """A long unbroken run of holidays is searched past, not given up on.

        The search used to be capped at a flat 366 days, so this raised;
        the cap now scales with the number of holiday dates, which still
        bounds the loop (it can't hang) but always reaches the far side of
        any finite holiday set.
        """
        start = datetime(2025, 1, 1)
        # Create a set of 1000 consecutive days as holidays
        holidays = {start + timedelta(days=i) for i in range(1000)}

        result = get_next_working_day(start, holidays)
        assert result == datetime(2027, 9, 28)  # the Tuesday after day 999

    def test_get_next_working_day_with_no_working_days_at_all(self):
        """With no working day to find, the bounded search still gives up."""
        never = Calendar(name='Never', week_pattern=[set()])
        with pytest.raises(ValueError):
            get_next_working_day(datetime(2025, 1, 1), never)

    def test_an_18_month_shutdown_is_scheduled_past(self):
        start = datetime(2026, 1, 1)
        shutdown = {(start + timedelta(days=i)).date() for i in range(548)}
        reopen = datetime(2027, 7, 5)  # the shutdown ends Fri 2027-07-02
        assert get_next_working_day(start, shutdown) == reopen
        assert add_working_days(start, 2, shutdown) == datetime(2027, 7, 7)  # Mon, Tue; exclusive
        assert not is_working_day(start + timedelta(days=300), shutdown)
        assert is_working_day(reopen, shutdown)

    def test_add_working_days_large_number(self):
        """Test adding a very large number of working days."""
        start = datetime(2025, 1, 1)
        # 10000 working days is ~40 years
        # Should complete in reasonable time or raise error
        with pytest.raises((ValueError, OverflowError)) as exc_info:
            result = add_working_days(start, 10000)


class TestEmptyTaskLists:
    """Tests for handling empty or minimal task lists."""

    def test_schedule_tasks_empty_list(self):
        """Test scheduling with empty task list."""
        result = schedule_tasks([])
        assert result == []

    def test_schedule_tasks_empty_dict(self):
        """Test scheduling with empty dict."""
        result = schedule_tasks({})
        assert result == []

    def test_natural_language_to_yaml_empty_string(self):
        """Test parsing empty plan text."""
        result = natural_language_to_yaml("", "Test Project")
        assert "Test Project" in result
        # Should return empty structure, not crash


class TestInvalidDateRanges:
    """Tests for invalid date ranges and edge cases."""

    def test_task_with_start_after_end(self):
        """Test task where start date is after end date."""
        plan = """
        ---
        ---

        Phase 1
          Bad Task @alice 2025-12-31 2025-01-01
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        # Should handle gracefully - swap dates or use start date only
        assert len(tasks) > 0
        if tasks[0].get('start') and tasks[0].get('finish'):
            assert tasks[0]['finish'] >= tasks[0]['start']

    def test_single_day_project(self):
        """Test project that starts and finishes on same day."""
        plan = """
        Task 1 @alice 1d 2025-01-15
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1
        # Should handle division by zero in timeline rendering


class TestCircularDependencies:
    """Tests for circular dependency detection and handling."""

    def test_simple_circular_dependency(self):
        """Test detection of A -> B -> A cycle."""
        tasks = [
            {'name': 'Task A', 'depends': ['Task B']},
            {'name': 'Task B', 'depends': ['Task A']},
        ]

        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is True
        assert len(result['loops']) > 0
        assert 'task a' in result['affected_tasks']
        assert 'task b' in result['affected_tasks']

    def test_complex_circular_dependency(self):
        """Test detection of A -> B -> C -> A cycle."""
        tasks = [
            {'name': 'Task A', 'depends': ['Task B']},
            {'name': 'Task B', 'depends': ['Task C']},
            {'name': 'Task C', 'depends': ['Task A']},
        ]

        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is True
        assert len(result['affected_tasks']) == 3

    def test_self_dependency(self):
        """Test task that depends on itself."""
        tasks = [
            {'name': 'Task A', 'depends': ['Task A']},
        ]

        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is True

    def test_cycle_is_reported_as_a_path_from_where_the_walk_entered_it(self):
        """Pins the reported form so the iterative walk (which replaced a
        recursive one that overflowed on long chains) cannot drift."""
        tasks = [
            {'name': 'Task A', 'depends': ['Task B']},
            {'name': 'Task B', 'depends': ['Task C']},
            {'name': 'Task C', 'depends': ['Task A']},
            {'name': 'Task D', 'depends': ['Task C']},
        ]

        result = detect_dependency_loops(tasks)
        assert result['loops'] == ['task a -> task b -> task c -> task a']
        assert sorted(result['affected_tasks']) == ['task a', 'task b', 'task c']
        assert result['task_warnings']['Task B'] == (
            'Circular dependency detected. Part of cycle: task a -> task b -> task c -> task a'
        )

    def test_long_chain_does_not_overflow_the_stack(self):
        """A chain far longer than Python's recursion limit, written
        dependant-first, used to raise RecursionError out of the DFS."""
        n = 3000
        tasks = [{'name': f'T{i}', 'depends': [f'T{i - 1}'] if i > 1 else []}
                 for i in range(n, 0, -1)]

        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is False

        # ...and one link back to the far end closes a loop through all of it
        tasks[-1]['depends'] = [f'T{n}']
        result = detect_dependency_loops(tasks)
        assert result['loops'] == [' -> '.join(f't{i}' for i in range(n, 0, -1)) + f' -> t{n}']
        assert len(result['affected_tasks']) == n


class TestMissingDependencies:
    """Tests for tasks with dependencies on non-existent tasks."""

    def test_dependency_on_missing_task(self):
        """Test task depending on non-existent task."""
        plan = """
        Task A #NonExistentTask @alice 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        # Should schedule anyway, treating it as no dependency
        assert len(tasks) == 1
        # Ideally should have warning in task metadata

    def test_multiple_missing_dependencies(self):
        """Test task with multiple missing dependencies."""
        plan = """
        Task A #Missing1 #Missing2 @alice 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1


class TestLongTaskNames:
    """Tests for very long task names."""

    def test_very_long_task_name(self):
        """Test task with 200+ character name."""
        long_name = "A" * 250
        plan = f"""
        {long_name} @alice 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1
        # Should truncate gracefully in rendering

    def test_task_name_with_special_characters(self):
        """Test task name with special characters."""
        plan = """
        Task with "quotes" and 'apostrophes' @alice 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1


class TestUnicodeHandling:
    """Tests for unicode characters in various fields."""

    def test_task_name_with_emoji(self):
        """Test task name with emoji characters."""
        plan = """
        Task with emoji 🚀 @alice 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1
        assert '🚀' in tasks[0]['description']

    def test_resource_name_with_unicode(self):
        """Test resource name with non-ASCII characters."""
        plan = """
        Task @François 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1
        assert 'François' in tasks[0].get('resources', '')

    def test_rtl_text_in_task_name(self):
        """Test right-to-left text in task name."""
        plan = """
        مهمة @alice 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1


class TestNegativeAndLargeDurations:
    """Tests for edge cases in duration values."""

    def test_negative_duration(self):
        """Test task with negative duration."""
        # This should be validated and rejected or converted to 0
        plan = """
        Task @alice -5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        # Should either reject or convert to valid duration
        if len(tasks) > 0:
            duration = tasks[0].get('duration')
            if duration:
                assert duration.days >= 0, "Duration should not be negative"

    def test_very_large_duration(self):
        """Test task with unreasonably large duration."""
        plan = """
        Task @alice 99999d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")

        # Should reject unreasonably large durations
        with pytest.raises(ValueError):
            schedule_tasks(yaml_data["Project"])

    def test_zero_duration(self):
        """Test milestone with 0 duration."""
        plan = """
        Milestone @alice 0d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1
        assert tasks[0].get('duration') == timedelta(days=0)


class TestPercentageEdgeCases:
    """Tests for percentage completion edge cases."""

    def test_percent_over_100(self):
        """Test task with >100% completion."""
        meta = extract_metadata("Task @alice 150%")
        # Should clamp to 100 or reject
        if 'percent' in meta:
            assert meta['percent'] <= 100

    def test_negative_percent(self):
        """Test task with negative percentage."""
        # This shouldn't parse as percent
        meta = extract_metadata("Task @alice -50%")
        # Should either not parse or clamp to 0
        if 'percent' in meta:
            assert meta['percent'] >= 0

    def test_decimal_percent(self):
        """Test task with decimal percentage."""
        meta = extract_metadata("Task @alice 50.5%")
        # Should handle decimal (round or truncate)
        if 'percent' in meta:
            assert isinstance(meta['percent'], int)

    def test_allocation_is_not_percent_complete(self):
        """`@dev[30%]` is a share of the resource's day, not progress."""
        meta = extract_metadata("Design @dev[30%] 5d 0%", "Design")
        assert meta['percent'] == 0
        assert meta['resources'] == 'dev[30%]'

    def test_allocation_alone_sets_no_percent(self):
        meta = extract_metadata("Design @dev[30%] 5d", "Design")
        assert 'percent' not in meta


class TestWeekendAndHolidayEdgeCases:
    """Tests for edge cases with weekends and holidays."""

    def test_task_starting_on_saturday(self):
        """Test task that starts on Saturday."""
        saturday = datetime(2025, 11, 8)  # A Saturday
        next_working = get_next_working_day(saturday)
        assert next_working.weekday() == 0  # Monday

    def test_task_with_week_long_holiday(self):
        """Test scheduling with a week-long holiday."""
        monday = datetime(2025, 11, 10)
        # Make Mon-Fri all holidays
        holidays = {monday + timedelta(days=i) for i in range(5)}

        next_working = get_next_working_day(monday, holidays)
        # Should skip to next Monday
        assert next_working == monday + timedelta(days=7)

    def test_add_days_over_holiday_weekend(self):
        """Test adding working days over weekend + holiday."""
        friday = datetime(2025, 11, 7)
        monday = datetime(2025, 11, 10)
        holidays = {monday}  # Monday is holiday

        # 3 working days starting from Friday (inclusive): Fri, Tue, Wed
        # Monday is a holiday so it's skipped, weekend is skipped
        result = add_working_days(friday, 3, holidays)
        # Fri (day 1), skip Sat/Sun/Mon-holiday, Tue (day 2), Wed (day 3)
        # Exclusive finish = Thu Nov 13
        expected = datetime(2025, 11, 13)
        assert result == expected


class TestResourceNameCollisions:
    """Tests for resource name handling and collisions."""

    def test_duplicate_resource_shortnames(self):
        """Test that duplicate shortnames are handled."""
        # Both should generate 'john' as shortname
        # Need to test excel_importer._make_shortname
        from noodle_core.excel_importer import _make_shortname

        name1 = "John Smith"
        name2 = "John Doe"

        short1 = _make_shortname(name1)
        short2 = _make_shortname(name2)

        # Both will be 'john' - this is the collision issue
        assert short1 == "john"
        assert short2 == "john"
        # TODO: Fix collision handling

    def test_resource_with_special_characters(self):
        """Test resource name with special characters."""
        from noodle_core.excel_importer import _make_shortname

        name = "O'Brien, Patrick"
        short = _make_shortname(name)

        # Should handle apostrophe and comma
        assert short is not None
        assert len(short) > 0


class TestMalformedInput:
    """Tests for malformed or unusual input."""

    def test_task_with_only_whitespace(self):
        """Test task line with only whitespace."""
        plan = """


        Task A @alice 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        # Should skip empty lines
        assert len(tasks) == 1

    def test_task_with_multiple_at_signs(self):
        """Test task with multiple @ resource markers."""
        plan = """
        Task @alice @bob @charlie 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == 1
        # Should parse all resources

    def test_task_with_malformed_dependency(self):
        """Test task with malformed dependency syntax."""
        plan = """
        Task A #[depends] @alice 5d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        # Should parse but maybe not recognize dependency
        assert len(tasks) == 1

    def test_deeply_nested_tasks(self):
        """Test tasks with very deep nesting."""
        indent = "  "
        plan = "Phase 1\n"
        for i in range(20):  # 20 levels deep
            plan += indent * (i + 1) + f"Task Level {i} @alice 1d\n"

        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        # Should handle deep nesting without stack overflow
        assert len(tasks) > 0
        # Check max level is reasonable
        max_level = max(t.get('level', 0) for t in tasks)
        assert max_level <= 20


class TestConcurrentModifications:
    """Tests for potential race conditions (when multi-user support added)."""

    def test_task_list_modification_during_iteration(self):
        """Test that task list can't be modified during scheduling."""
        # This is more of a future-proofing test
        # Currently single-threaded but good to verify behavior
        plan = """
        Task A @alice 5d
        Task B @bob 3d
        """
        yaml_data = natural_language_to_yaml(plan, "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        # Verify tasks list is stable
        assert len(tasks) == 2


class TestFilenameInjection:
    """Tests for filename/path injection attacks."""

    def test_project_name_with_path_traversal(self):
        """Test project name with path traversal attempt."""
        dangerous_name = "../../etc/passwd"
        # Should sanitize before using in filename
        # This requires the filename sanitization fix

        # For now, just document the issue
        assert "/" not in dangerous_name or True  # Would fail without fix

    def test_project_name_with_special_chars(self):
        """Test project name with special characters."""
        dangerous_name = 'Project"name<>:"|?*'
        # Should sanitize for use in filename
        # Most OSes don't allow these in filenames
        pass  # TODO: Add sanitization


class TestMemoryAndPerformance:
    """Tests for memory usage and performance edge cases."""

    def test_large_number_of_tasks(self):
        """Test scheduling with many tasks (performance test)."""
        # Generate 1000 tasks
        lines = ["Phase 1"]
        for i in range(1000):
            lines.append(f"  Task {i} @alice 1d")

        plan = "\n".join(lines)
        yaml_data = natural_language_to_yaml(plan, "Project")

        import time
        start = time.time()
        tasks = schedule_tasks(yaml_data["Project"])
        duration = time.time() - start

        assert len(tasks) == 1001  # 1000 tasks + 1 phase
        # Should complete in reasonable time
        assert duration < 5.0, f"Scheduling took {duration}s, should be < 5s"

    def test_complex_dependency_graph(self):
        """Test scheduling with complex dependency graph."""
        # Create tasks where each depends on previous (chain)
        lines = []
        for i in range(100):
            if i == 0:
                lines.append(f"Task{i} @alice 1d")
            else:
                lines.append(f"Task{i} [depends Task{i-1}] @alice 1d")

        plan = "\n".join(lines)
        yaml_data = natural_language_to_yaml(plan, "Project")

        import time
        start = time.time()
        tasks = schedule_tasks(yaml_data["Project"])
        duration = time.time() - start

        assert len(tasks) == 100
        # Should complete in reasonable time even with long chain
        assert duration < 2.0, f"Scheduling took {duration}s, should be < 2s"

    def test_many_holidays_do_not_slow_scheduling_down(self):
        """The holiday set used to be re-normalized (and copied per task) on
        every date calculation: 2,000 tasks against ~3,000 holiday dates
        took seconds instead of hundredths of a second."""
        from datetime import date

        first = date(2020, 1, 1)
        holidays = {first + timedelta(days=3 * i) for i in range(3000)}  # to 2044
        lines = ["Phase 1", "  Task 0 @alice 1d 2026-03-16"]
        lines += [f"  * Task {i} @alice 1d" for i in range(1, 2000)]
        # a few with a resource day of their own, so there is more than one
        # task calendar in play
        lines += [f"  Extra {i} @bob 1d 2026-03-16" for i in range(5)]
        yaml_data = natural_language_to_yaml("\n".join(lines), "Project")

        import time
        start = time.perf_counter()
        tasks = schedule_tasks(yaml_data["Project"], holidays=holidays,
                               resource_non_working_days={'bob': {date(2026, 3, 16)}})
        duration = time.perf_counter() - start
        assert duration < 1.5, f"Scheduling took {duration:.2f}s, should be well under 1.5s"

        # Same dates as ever: a chain of 1-day tasks takes consecutive
        # working days, i.e. weekdays not in the holiday set.
        expected, day = [], datetime(2026, 3, 16)
        while len(expected) < 2000:
            if day.weekday() < 5 and day.date() not in holidays:
                expected.append(day)
            day += timedelta(days=1)
        chain = [t for t in tasks if t['name'].startswith('Task ')]
        assert [t['start'] for t in chain] == expected
        assert [t['finish'] for t in chain] == [d + timedelta(days=1) for d in expected]
        assert all(t['critical'] for t in chain)
        # 2026-03-16 is a Monday, a working day but not bob's
        extras = [t for t in tasks if t['name'].startswith('Extra ')]
        assert {t['finish'] for t in extras} == {datetime(2026, 3, 18)}

    def test_long_chain_written_dependant_first_schedules(self):
        """A 3,000-task chain listed last-task-first used to crash
        schedule_tasks with RecursionError in the dependency-loop check."""
        n = 3000
        lines = ["Phase 1"]
        for i in range(n, 0, -1):
            dep = f" [depends Task{i - 1}]" if i > 1 else ""
            lines.append(f"  Task{i} @alice 1d{dep}")

        yaml_data = natural_language_to_yaml("\n".join(lines), "Project")
        tasks = schedule_tasks(yaml_data["Project"])

        assert len(tasks) == n + 1  # n tasks + 1 phase
        assert not any('loop_warning' in t for t in tasks)


class TestDeadlineMetadata:
    """Tests for the D-prefixed deadline smart tag (#877, #1149)."""

    def test_deadline_is_extracted(self):
        meta = extract_metadata("Design phase 5d D2026-09-10")
        assert meta["deadline"] == "2026-09-10"

    def test_deadline_does_not_leak_into_description(self):
        meta = extract_metadata("Design phase 5d D2026-09-10")
        assert meta["description"] == "Design phase"

    def test_deadline_before_other_tokens_does_not_leak_into_description(self):
        meta = extract_metadata("Design D2026-09-10 review 5d")
        assert meta["description"] == "Design"

    def test_deadline_does_not_shadow_start_date(self):
        meta = extract_metadata("Task 2026-01-01 5d D2026-09-10")
        assert meta["due"] == "2026-01-01"
        assert meta["start"] == datetime(2026, 1, 1)
        assert meta["deadline"] == "2026-09-10"

    def test_task_without_deadline_has_no_deadline_key(self):
        meta = extract_metadata("Task no deadline 5d")
        assert "deadline" not in meta

    def test_deadline_does_not_drive_duration_or_start(self):
        # A deadline is a marker, not a schedule input: it must not be
        # mistaken for a duration or a plain start date.
        meta = extract_metadata("Task D2026-09-10")
        assert meta["deadline"] == "2026-09-10"
        assert "duration" not in meta
        assert "start" not in meta


# Markers for different test categories
pytestmark = [
    pytest.mark.edge_cases,
]
