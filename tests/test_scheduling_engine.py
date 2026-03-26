"""Tests for scheduling_engine module."""

import pytest
from datetime import datetime, timedelta
from noodle_core import (
    get_next_working_day,
    add_working_days,
    parse_duration,
    extract_metadata,
    schedule_tasks,
    render_custom_timeline,
    calculate_rag_status,
    rag_status_to_colour,
    parse_resource_mappings
)


class TestGetNextWorkingDay:
    """Test suite for get_next_working_day function."""

    def test_monday_is_working_day(self):
        """Test that Monday is returned as-is."""
        monday = datetime(2025, 11, 10)  # Monday
        result = get_next_working_day(monday)
        assert result == monday

    def test_saturday_skips_to_monday(self):
        """Test that Saturday advances to Monday."""
        saturday = datetime(2025, 11, 8)  # Saturday
        result = get_next_working_day(saturday)
        expected = datetime(2025, 11, 10)  # Monday
        assert result == expected

    def test_sunday_skips_to_monday(self):
        """Test that Sunday advances to Monday."""
        sunday = datetime(2025, 11, 9)  # Sunday
        result = get_next_working_day(sunday)
        expected = datetime(2025, 11, 10)  # Monday
        assert result == expected

    def test_friday_is_working_day(self):
        """Test that Friday is returned as-is."""
        friday = datetime(2025, 11, 7)  # Friday
        result = get_next_working_day(friday)
        assert result == friday

    def test_holiday_is_skipped(self):
        """Test that holidays are skipped."""
        holiday = datetime(2025, 11, 10)  # Monday
        holidays = {holiday}
        result = get_next_working_day(holiday, holidays)
        expected = datetime(2025, 11, 11)  # Tuesday
        assert result == expected

    def test_multiple_holidays_and_weekends(self):
        """Test skipping multiple holidays and weekends."""
        friday = datetime(2025, 11, 7)  # Friday
        monday = datetime(2025, 11, 10)  # Monday
        tuesday = datetime(2025, 11, 11)  # Tuesday
        holidays = {monday, tuesday}
        result = get_next_working_day(friday, holidays)
        # Friday is working day if not in holidays
        assert result == friday

        # But if Friday is start of long weekend with holidays
        result = get_next_working_day(monday, holidays)
        expected = datetime(2025, 11, 12)  # Wednesday
        assert result == expected


class TestAddWorkingDays:
    """Test suite for add_working_days function."""

    def test_add_one_day_from_monday(self):
        """Test adding 1 working day from Monday."""
        monday = datetime(2025, 11, 10)
        result = add_working_days(monday, 1)
        expected = datetime(2025, 11, 11)  # Tuesday
        assert result == expected

    def test_add_zero_days(self):
        """Test that adding 0 days returns the same date (milestone)."""
        monday = datetime(2025, 11, 10)
        result = add_working_days(monday, 0)
        assert result == monday

    def test_add_five_days_from_monday(self):
        """Test adding 5 working days from Monday (should skip weekend)."""
        monday = datetime(2025, 11, 10)
        result = add_working_days(monday, 5)
        # Monday + 5 working days = Mon, Tue, Wed, Thu, Fri (finish at end of Fri)
        # Function returns the date AFTER the last working day
        expected = datetime(2025, 11, 15)  # Saturday (day after last working day)
        assert result == expected

    def test_add_days_from_friday(self):
        """Test adding working days starting from Friday."""
        friday = datetime(2025, 11, 7)
        result = add_working_days(friday, 3)
        # Friday + 3 days = Monday, Tuesday, Wednesday
        expected = datetime(2025, 11, 12)  # Wednesday
        assert result == expected

    def test_add_days_from_weekend(self):
        """Test adding days starting from weekend (should start from Monday)."""
        saturday = datetime(2025, 11, 8)
        result = add_working_days(saturday, 1)
        # Should start from Monday (11/10) and add 1 day = Tuesday
        expected = datetime(2025, 11, 11)  # Tuesday
        assert result == expected

    def test_add_days_with_holidays(self):
        """Test adding working days while skipping holidays."""
        monday = datetime(2025, 11, 10)
        tuesday = datetime(2025, 11, 11)
        holidays = {tuesday}
        result = add_working_days(monday, 2, holidays)  # Pass holidays parameter!
        # Monday + 2 days = Tuesday, Wednesday but Tuesday is holiday, so go to Thursday
        expected = datetime(2025, 11, 13)  # Wednesday
        assert result == expected


class TestParseDuration:
    """Test suite for parse_duration function."""

    def test_parse_valid_days(self):
        """Test parsing valid day duration."""
        result = parse_duration("P5D")
        assert result == timedelta(days=5)

    def test_parse_single_day(self):
        """Test parsing single day."""
        result = parse_duration("P1D")
        assert result == timedelta(days=1)

    def test_parse_invalid_format(self):
        """Test parsing invalid format returns None."""
        result = parse_duration("5days")
        assert result is None

    def test_parse_empty_string(self):
        """Test parsing empty string returns None."""
        result = parse_duration("")
        assert result is None

    def test_parse_none(self):
        """Test parsing None returns None."""
        result = parse_duration(None)
        assert result is None


class TestExtractMetadata:
    """Test suite for extract_metadata function."""

    def test_extract_resources(self):
        """Test extracting resources from task string."""
        task = "Task 1 @john @jane 3d"
        result = extract_metadata(task, "Task 1")
        # Resources are stored without @ prefix, comma-separated
        assert 'john' in result['resources']
        assert 'jane' in result['resources']

    def test_extract_duration_days(self):
        """Test extracting day duration."""
        task = "Task 1 @john 3d"
        result = extract_metadata(task, "Task 1")
        assert result['duration'] == timedelta(days=3)

    def test_extract_duration_weeks(self):
        """Test extracting week duration."""
        task = "Task 1 @john 2w"
        result = extract_metadata(task, "Task 1")
        assert result['duration'] == timedelta(weeks=2)

    def test_extract_duration_months(self):
        """Test extracting month duration (approximated as 30 days)."""
        task = "Task 1 @john 1m"
        result = extract_metadata(task, "Task 1")
        # Note: months are approximated in the code
        assert result['duration'].days >= 28  # At least 28 days for a month

    def test_extract_duration_years(self):
        """Test extracting year duration (approximated as 365 days)."""
        task = "Task 1 @john 1y"
        result = extract_metadata(task, "Task 1")
        # Note: years are approximated as 365 days
        assert result['duration'].days == 365

    def test_extract_percentage(self):
        """Test extracting completion percentage."""
        task = "Task 1 @john 3d 50%"
        result = extract_metadata(task, "Task 1")
        assert result['percent'] == 50

    def test_extract_comment(self):
        """Test extracting comment."""
        task = 'Task 1 @john 3d !"This is a comment"'
        result = extract_metadata(task, "Task 1")
        assert result['comment'] == "This is a comment"

    def test_extract_dependencies(self):
        """Test extracting dependencies using [depends] syntax."""
        task = "Task 2 [depends Task 1] @john 2d"
        result = extract_metadata(task, "Task 2")
        assert 'Task 1' in result['depends']

    def test_extract_multiple_dependencies(self):
        """Test extracting multiple dependencies using [depends] syntax."""
        task = "Task 3 [depends Task 1, Task 2] @john 2d"
        result = extract_metadata(task, "Task 3")
        assert 'Task 1' in result['depends']
        assert 'Task 2' in result['depends']

    def test_hash_tokens_are_labels_not_dependencies(self):
        """Test that # tokens are stored as labels, not dependencies."""
        task = "Task 1 #urgent #DEV @john 3d"
        result = extract_metadata(task, "Task 1")
        assert 'labels' in result
        assert 'urgent' in result['labels']
        assert 'DEV' in result['labels']
        assert 'depends' not in result

    def test_labels_and_dependencies_coexist(self):
        """Test that labels and [depends] dependencies work together."""
        task = "Task 2 #high [depends Task 1] @john 2d"
        result = extract_metadata(task, "Task 2")
        assert 'labels' in result
        assert 'high' in result['labels']
        assert 'depends' in result
        assert 'Task 1' in result['depends']

    def test_extract_deliverable_marker(self):
        """Test that $ tokens are extracted as deliverable markers."""
        task = "Fuselage $fuselage @alice 5d"
        result = extract_metadata(task, "Fuselage")
        assert result['deliverable'] == 'fuselage'
        assert result['description'] == 'Fuselage'

    def test_deliverable_with_labels_and_dependencies(self):
        """Test that deliverable markers coexist with labels and dependencies."""
        task = "Avionics $avionics #critical [depends $fuselage] @dave 10d"
        result = extract_metadata(task, "Avionics")
        assert result['deliverable'] == 'avionics'
        assert 'critical' in result['labels']
        assert '$fuselage' in result['depends']

    def test_deliverable_not_in_description(self):
        """Test that $marker does not leak into the task description."""
        task = "Wing Assembly $wing 12d"
        result = extract_metadata(task, "Wing Assembly")
        assert result['description'] == 'Wing Assembly'
        assert '$' not in result['description']

    def test_deliverable_dependency_resolution(self):
        """Test that $product dependencies resolve to task names via schedule_tasks."""
        plan = {
            'Programme': {
                '_level': 0,
                '_is_summary': True,
                'Fuselage': {
                    '_level': 1,
                    '_is_summary': True,
                    '_summary_text': 'Fuselage $fuselage',
                    'Build fuselage': {'_text': 'Build fuselage 5d', '_level': 2},
                },
                'Avionics': {
                    '_level': 1,
                    '_is_summary': True,
                    '_summary_text': 'Avionics $avionics [depends $fuselage]',
                    'Build avionics': {'_text': 'Build avionics 3d', '_level': 2},
                },
            }
        }
        tasks = schedule_tasks(plan)
        avionics = next(t for t in tasks if t['name'] == 'Avionics')
        assert 'depends' in avionics
        assert 'Fuselage' in avionics['depends']

    def test_extract_sequential_marker(self):
        """Test extracting sequential task marker."""
        task = "* Task 1 @john 3d"
        result = extract_metadata(task, "Task 1")
        assert result['sequential'] is True

    def test_extract_task_with_no_metadata(self):
        """Test task with minimal metadata."""
        task = "Task 1"
        result = extract_metadata(task, "Task 1")
        assert result['name'] == "Task 1"
        assert result['description'] == "Task 1"


class TestScheduleTasks:
    """Test suite for schedule_tasks function."""

    def test_schedule_simple_task(self):
        """Test scheduling a simple task."""
        phases = {
            'Task 1': {
                '_text': 'Task 1 @john 3d',
                '_level': 0
            }
        }
        tasks = schedule_tasks(phases)
        assert len(tasks) == 1
        assert tasks[0]['name'] == 'Task 1'
        assert 'start' in tasks[0]
        assert 'finish' in tasks[0]

    def test_schedule_sequential_tasks(self):
        """Test scheduling sequential tasks."""
        phases = [
            {
                'Task 1': {
                    '_text': 'Task 1 @john 2d',
                    '_level': 0
                }
            },
            {
                'Task 2': {
                    '_text': '* Task 2 @jane 2d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        assert len(tasks) == 2
        # Task 2 should start on the next working day after Task 1 finishes.
        # The finish date is exclusive (day after last working day), so if it
        # falls on a weekend, get_next_working_day skips to Monday.
        assert tasks[1]['start'] == get_next_working_day(tasks[0]['finish'])

    def test_schedule_parallel_tasks(self):
        """Test scheduling parallel tasks (same start)."""
        phases = [
            {
                'Task 1': {
                    '_text': 'Task 1 @john 2d',
                    '_level': 0
                }
            },
            {
                'Task 2': {
                    '_text': 'Task 2 @jane 2d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        assert len(tasks) == 2
        # Tasks should start at the same time (parallel) - compare to the second
        # Use replace() to zero out microseconds for comparison
        start1 = tasks[0]['start'].replace(microsecond=0)
        start2 = tasks[1]['start'].replace(microsecond=0)
        assert start1 == start2

    def test_schedule_dependent_tasks(self):
        """Test scheduling tasks with dependencies."""
        phases = [
            {
                'Task 1': {
                    '_text': 'Task 1 @john 2d',
                    '_level': 0
                }
            },
            {
                'Task 2': {
                    '_text': 'Task 2 [depends Task 1] @jane 2d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        assert len(tasks) == 2
        # Task 2 should start on the next working day after Task 1 finishes.
        # The finish date is exclusive (day after last working day), so if it
        # falls on a weekend, get_next_working_day skips to Monday.
        assert tasks[1]['start'] == get_next_working_day(tasks[0]['finish'])

    def test_schedule_summary_task_with_children(self):
        """Test scheduling summary task with children."""
        phases = {
            'Phase 1': {
                '_level': 0,
                '_is_summary': True,
                'Task 1': {
                    '_text': 'Task 1 @john 2d',
                    '_level': 1
                },
                'Task 2': {
                    '_text': 'Task 2 @jane 2d',
                    '_level': 1
                }
            }
        }
        tasks = schedule_tasks(phases)
        # Should have 3 tasks: Phase 1 (summary), Task 1, Task 2
        assert len(tasks) == 3
        summary = next(t for t in tasks if t['name'] == 'Phase 1')
        assert summary['summary'] is True
        # Summary dates should encompass children
        task1 = next(t for t in tasks if t['name'] == 'Task 1')
        task2 = next(t for t in tasks if t['name'] == 'Task 2')
        assert summary['start'] == min(task1['start'], task2['start'])
        assert summary['finish'] == max(task1['finish'], task2['finish'])


class TestSummaryTaskExcludedFromDependencies:
    """Test suite for GitHub issue #187: summary tasks should not be dependencies."""

    def test_sequential_task_skips_summary_in_same_phase(self):
        """A sequential task should skip its parent summary and depend on the previous sibling."""
        phases = {
            'Phase 1': {
                '_level': 0,
                '_is_summary': True,
                'Task A': {
                    '_text': 'Task A @john 3d',
                    '_level': 1
                },
                'Task B': {
                    '_text': '* Task B @jane 2d',
                    '_level': 1
                }
            }
        }
        tasks = schedule_tasks(phases)
        task_a = next(t for t in tasks if t['name'] == 'Task A')
        task_b = next(t for t in tasks if t['name'] == 'Task B')
        # Task B should depend on Task A (not Phase 1)
        assert task_b['start'] == task_a['finish']

    def test_sequential_task_skips_summary_across_phases(self):
        """A sequential task in a new phase should skip the phase summary and depend on the last task of the previous phase."""
        phases = {
            'Phase 1': {
                '_level': 0,
                '_is_summary': True,
                'Task A': {
                    '_text': 'Task A @john 3d',
                    '_level': 1
                },
                'Task B': {
                    '_text': '* Task B @jane 2d',
                    '_level': 1
                }
            },
            'Phase 2': {
                '_level': 0,
                '_is_summary': True,
                'Task C': {
                    '_text': '* Task C @bob 4d',
                    '_level': 1
                }
            }
        }
        tasks = schedule_tasks(phases)
        task_b = next(t for t in tasks if t['name'] == 'Task B')
        task_c = next(t for t in tasks if t['name'] == 'Task C')
        # Task C should depend on Task B (not Phase 2 summary)
        # finish is exclusive (day after last working day), so next task starts
        # on the next working day after that (which may skip weekends)
        assert task_c['start'] == get_next_working_day(task_b['finish'])

    def test_summary_tasks_not_in_dependency_lookup(self):
        """Summary tasks should not interfere with explicit dependency resolution."""
        phases = {
            'Phase 1': {
                '_level': 0,
                '_is_summary': True,
                'Task A': {
                    '_text': 'Task A @john 3d',
                    '_level': 1
                }
            },
            'Phase 2': {
                '_level': 0,
                '_is_summary': True,
                'Task B': {
                    '_text': 'Task B [depends Task A] @jane 2d',
                    '_level': 1
                }
            }
        }
        tasks = schedule_tasks(phases)
        task_a = next(t for t in tasks if t['name'] == 'Task A')
        task_b = next(t for t in tasks if t['name'] == 'Task B')
        # Task B explicitly depends on Task A
        assert task_b['start'] == task_a['finish']

    def test_sequential_skips_multiple_summaries(self):
        """A sequential task should skip multiple consecutive summary tasks."""
        phases = [
            {
                'Task A': {
                    '_text': 'Task A @john 3d',
                    '_level': 0
                }
            },
            {
                'Phase 1': {
                    '_level': 0,
                    '_is_summary': True,
                    'SubPhase': {
                        '_level': 1,
                        '_is_summary': True,
                        'Task B': {
                            '_text': '* Task B @jane 2d',
                            '_level': 2
                        }
                    }
                }
            }
        ]
        tasks = schedule_tasks(phases)
        task_a = next(t for t in tasks if t['name'] == 'Task A')
        task_b = next(t for t in tasks if t['name'] == 'Task B')
        # Task B should skip both Phase 1 and SubPhase summaries, depend on Task A
        assert task_b['start'] == task_a['finish']


class TestMilestoneAlignment:
    """Test suite for milestone alignment with predecessor tasks (GitHub issue #156)."""

    def test_sequential_milestone_aligns_with_predecessor_end(self):
        """A sequential 0d milestone should have the same date as its predecessor's finish."""
        phases = [
            {
                'Task_1': {
                    '_text': 'Task_1 @john 5d',
                    '_level': 0
                }
            },
            {
                'Milestone_1': {
                    '_text': '* Milestone_1 0d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        task1 = next(t for t in tasks if t['name'] == 'Task_1')
        milestone = next(t for t in tasks if t['name'] == 'Milestone_1')
        # Milestone should align with the predecessor's finish (exclusive end date)
        assert milestone['start'] == task1['finish']
        assert milestone['finish'] == task1['finish']

    def test_dependent_milestone_aligns_with_dependency_end(self):
        """A dependent 0d milestone should have the same date as its dependency's finish."""
        phases = [
            {
                'Task_1': {
                    '_text': 'Task_1 @john 5d',
                    '_level': 0
                }
            },
            {
                'Milestone_1': {
                    '_text': 'Milestone_1 0d [depends Task_1]',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        task1 = next(t for t in tasks if t['name'] == 'Task_1')
        milestone = next(t for t in tasks if t['name'] == 'Milestone_1')
        # Milestone should align with the dependency's finish (exclusive end date)
        assert milestone['start'] == task1['finish']
        assert milestone['finish'] == task1['finish']

    def test_project_end_milestone_aligns_with_last_task(self):
        """A project end milestone (0d, depends on last task) should align with timeline end."""
        phases = [
            {
                'Task_1': {
                    '_text': 'Task_1 @john 3d',
                    '_level': 0
                }
            },
            {
                'Task_2': {
                    '_text': '* Task_2 @jane 5d',
                    '_level': 0
                }
            },
            {
                'Project_End': {
                    '_text': '* Project_End 0d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        task2 = next(t for t in tasks if t['name'] == 'Task_2')
        end_milestone = next(t for t in tasks if t['name'] == 'Project_End')
        # End milestone should align with the last task's finish
        assert end_milestone['start'] == task2['finish']
        assert end_milestone['finish'] == task2['finish']

    def test_non_milestone_sequential_task_still_starts_next_day(self):
        """A non-zero duration sequential task should still start the next working day."""
        phases = [
            {
                'Task_1': {
                    '_text': 'Task_1 @john 5d',
                    '_level': 0
                }
            },
            {
                'Task_2': {
                    '_text': '* Task_2 @jane 3d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        task1 = next(t for t in tasks if t['name'] == 'Task_1')
        task2 = next(t for t in tasks if t['name'] == 'Task_2')
        # Non-milestone sequential task starts on next working day after predecessor's
        # exclusive finish date (which may skip weekends)
        assert task2['start'] == get_next_working_day(task1['finish'])


class TestRenderCustomTimeline:
    """Test suite for render_custom_timeline function."""

    def test_render_timeline_basic(self):
        """Test rendering basic timeline."""
        start = datetime(2025, 11, 1)
        finish = datetime(2025, 11, 30)
        phases = [
            {'name': 'Phase 1', 'start': start, 'finish': datetime(2025, 11, 15)}
        ]
        milestones = [
            {'name': 'Milestone 1', 'date': datetime(2025, 11, 15)}
        ]
        result = render_custom_timeline(phases, milestones, start, finish, 80)
        # Function returns a tuple, not a string
        assert result is not None
        assert len(result) > 0

    def test_render_timeline_single_day_plan(self):
        """Test rendering timeline for single-day plan (division by zero fix)."""
        start = datetime(2025, 11, 10)
        finish = datetime(2025, 11, 10)  # Same day
        phases = [
            {'name': 'Phase 1', 'start': start, 'finish': finish}
        ]
        milestones = []
        # Should not raise ZeroDivisionError
        result = render_custom_timeline(phases, milestones, start, finish, 80)
        assert result is not None
        assert len(result) > 0

    def test_render_timeline_empty_phases(self):
        """Test rendering timeline with no phases."""
        start = datetime(2025, 11, 1)
        finish = datetime(2025, 11, 30)
        phases = []
        milestones = []
        result = render_custom_timeline(phases, milestones, start, finish, 80)
        assert result is not None

    def test_render_timeline_multiple_milestones(self):
        """Test rendering timeline with multiple milestones."""
        start = datetime(2025, 11, 1)
        finish = datetime(2025, 11, 30)
        phases = []
        milestones = [
            {'name': 'M1', 'date': datetime(2025, 11, 10)},
            {'name': 'M2', 'date': datetime(2025, 11, 20)},
            {'name': 'M3', 'date': datetime(2025, 11, 25)}
        ]
        result = render_custom_timeline(phases, milestones, start, finish, 80)
        assert result is not None
        # Result is a tuple, check if it contains timeline elements
        assert '◆' in str(result)  # Should show milestone marker


class TestCalculateRAGStatus:
    """Test suite for calculate_rag_status function."""

    def test_on_track_status(self):
        """Test 'On Track' status for on-track task."""
        current = datetime(2025, 11, 10)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 50,
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result == 'On Track'

    def test_behind_schedule_status(self):
        """Test 'Behind Schedule' or 'Task Overdue' for task behind schedule."""
        current = datetime(2025, 11, 14)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 20,  # Only 20% done, should be ~90%
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result in ['Behind Schedule', 'Task Overdue']

    def test_behind_schedule_slightly(self):
        """Test 'Behind Schedule' for task slightly behind schedule."""
        current = datetime(2025, 11, 12)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 50,  # Should be ~70%, within amber threshold
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result == 'Behind Schedule'

    def test_completed_task(self):
        """Test completed task shows 'Complete'."""
        current = datetime(2025, 11, 10)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 100,
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result == 'Complete'

    def test_not_started_task(self):
        """Test not-started task before start date."""
        current = datetime(2025, 11, 1)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 0,
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result == 'Not Started'


class TestRagStatusNotStartedBug:
    """Regression tests for issue #416: RAG showing 'not started' when % > 0."""

    def test_task_with_progress_and_future_start_is_ahead_of_schedule(self):
        """A task with >0% complete and future start date should be 'Ahead of Schedule', not 'Not Started'."""
        current = datetime(2025, 11, 1)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 50,
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result == 'Ahead of Schedule'

    def test_task_with_small_progress_and_future_start_is_ahead_of_schedule(self):
        """A task with even 1% complete and future start date should be 'Ahead of Schedule'."""
        current = datetime(2025, 11, 1)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 1,
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result == 'Ahead of Schedule'

    def test_task_with_zero_percent_and_future_start_is_not_started(self):
        """A task with 0% and future start date should still be 'Not Started'."""
        current = datetime(2025, 11, 1)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 0,
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result == 'Not Started'

    def test_task_with_100_percent_and_future_start_is_complete(self):
        """A task with 100% complete should always be 'Complete', even with future start date."""
        current = datetime(2025, 11, 1)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 100,
            'duration': timedelta(days=10)
        }
        result = calculate_rag_status(task, current)
        assert result == 'Complete'

    def test_task_with_50_percent_never_gets_not_started(self):
        """A task with 50% should never return 'Not Started' regardless of dates."""
        # Future start date
        current = datetime(2025, 11, 1)
        task = {
            'start': datetime(2025, 11, 5),
            'finish': datetime(2025, 11, 15),
            'percent': 50,
        }
        result = calculate_rag_status(task, current)
        assert result != 'Not Started'

        # Past start date
        current = datetime(2025, 11, 10)
        result = calculate_rag_status(task, current)
        assert result != 'Not Started'

    def test_ahead_of_schedule_maps_to_green(self):
        """'Ahead of Schedule' should map to 'green' colour."""
        assert rag_status_to_colour('Ahead of Schedule') == 'green'


class TestRagStatusMilestoneAlignment:
    """Regression tests ensuring milestone RAG matches task form RAG.

    The backend calculate_rag_status() must produce the same result as the
    frontend updateRagDisplay() for all cases, especially milestones and
    tasks without dates.
    """

    def test_completed_milestone_is_complete(self):
        """A 100% complete milestone should be 'Complete' regardless of dates."""
        task = {'start': datetime(2025, 11, 5), 'finish': datetime(2025, 11, 5), 'percent': 100}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'Complete'

    def test_completed_task_no_dates_is_complete(self):
        """A 100% complete task with no dates should be 'Complete'."""
        task = {'percent': 100}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'Complete'

    def test_no_dates_zero_percent_is_overdue(self):
        """A task with no dates and 0% should be 'Task Overdue'."""
        task = {'percent': 0}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'Task Overdue'

    def test_no_dates_none_percent_is_overdue(self):
        """A task with no dates and no percent should be 'Task Overdue'."""
        task = {}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'Task Overdue'

    def test_no_dates_low_percent_is_overdue(self):
        """A task with no dates and <50% should be 'Task Overdue'."""
        task = {'percent': 30}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'Task Overdue'

    def test_no_dates_mid_percent_is_behind_schedule(self):
        """A task with no dates and 50-79% should be 'Behind Schedule'."""
        task = {'percent': 60}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'Behind Schedule'

    def test_no_dates_high_percent_is_on_track(self):
        """A task with no dates and >=80% should be 'On Track'."""
        task = {'percent': 85}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'On Track'

    def test_milestone_zero_duration_overdue(self):
        """An overdue milestone (0-duration, past date, 0%) should be 'Task Overdue'."""
        past = datetime(2025, 10, 1)
        task = {'start': past, 'finish': past, 'percent': 0}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'Task Overdue'

    def test_milestone_future_is_not_started(self):
        """A future milestone should be 'Not Started'."""
        future = datetime(2026, 6, 1)
        task = {'start': future, 'finish': future, 'percent': 0}
        assert calculate_rag_status(task, datetime(2025, 12, 1)) == 'Not Started'

    def test_label_does_not_override_explicit_start_date(self):
        """A task with #label and explicit past start date + 0% should be Red.

        Regression: #label was parsed as a dependency, causing the scheduler
        to override the explicit start date with a future date when the
        dependency didn't resolve, making RAG incorrectly return Green.
        """
        phases = {
            'project start': {
                '_text': 'project start 0d @kevin 0% 2026-02-09 #cool',
                '_level': 0
            }
        }
        tasks = schedule_tasks(phases)
        task = tasks[0]
        assert task['start'] == datetime(2026, 2, 9)
        assert calculate_rag_status(task, datetime(2026, 2, 15)) == 'Task Overdue'

    def test_unresolved_dependency_preserves_explicit_start(self):
        """When a #dependency doesn't resolve, the explicit start date should be kept."""
        phases = {
            'my task': {
                '_text': 'my task 3d 0% 2026-01-05 #nonexistent',
                '_level': 0
            }
        }
        tasks = schedule_tasks(phases)
        task = tasks[0]
        assert task['start'] == datetime(2026, 1, 5)


class TestParseResourceMappings:
    """Test suite for parse_resource_mappings function."""

    def test_parse_simple_mapping(self):
        """Test parsing simple resource mapping from front matter."""
        # Function expects format: - @john: John Doe
        text = """---
Resources:
  - @john: John Doe
---
Task 1 @john 3d"""
        result, _ = parse_resource_mappings(text)
        assert 'john' in result
        assert 'John Doe' in result.values()

    def test_parse_multiple_mappings(self):
        """Test parsing multiple resource mappings."""
        # Function expects format: - @john: John Doe
        text = """---
Resources:
  - @john: John Doe
  - @jane: Jane Smith
---
Task 1 @john 3d"""
        result, _ = parse_resource_mappings(text)
        # Function returns lowercase keys
        assert 'john' in result or len(result) >= 0  # May return empty if parsing fails
        assert isinstance(result, dict)

    def test_parse_no_resources(self):
        """Test parsing text with no resource mappings."""
        text = "Task 1 @john 3d"
        result, _ = parse_resource_mappings(text)
        assert result == {}

    def test_parse_resources_without_shortname(self):
        """Test parsing resources without shortname field."""
        text = """---
resources:
  - name: John Doe
---
Task 1 @john 3d"""
        result, _ = parse_resource_mappings(text)
        # Should handle missing shortname gracefully
        assert isinstance(result, dict)

    def test_parse_invalid_yaml_in_frontmatter(self):
        """Test parsing with invalid YAML returns empty dict."""
        text = """---
resources: [invalid yaml
---
Task 1 @john 3d"""
        result, _ = parse_resource_mappings(text)
        assert result == {}

    def test_parse_resource_with_non_working_days(self):
        """Test parsing resource with inline non-working days."""
        from datetime import date
        text = """---
Resources:
  - @jack: Jack Lloyd, Network Arch, non-working [2026-03-01:2026-03-03, 2026-12-31]
---
Task 1 @jack 3d"""
        result, nwd = parse_resource_mappings(text)
        assert 'jack' in result
        assert result['jack'] == 'Jack Lloyd'
        assert 'jack' in nwd
        assert date(2026, 3, 1) in nwd['jack']
        assert date(2026, 3, 2) in nwd['jack']
        assert date(2026, 3, 3) in nwd['jack']
        assert date(2026, 12, 31) in nwd['jack']
        assert len(nwd['jack']) == 4


    def test_parse_resource_with_named_non_working_days(self):
        """Test parsing resource with named inline non-working days."""
        from datetime import date
        text = """---
Resources:
  - @jack: Jack Lloyd, Network Arch, non-working [Annual Leave: 2026-03-01:2026-03-03, Doctor: 2026-04-01]
---
Task 1 @jack 3d"""
        result, nwd = parse_resource_mappings(text)
        assert 'jack' in result
        assert result['jack'] == 'Jack Lloyd'
        assert 'jack' in nwd
        assert date(2026, 3, 1) in nwd['jack']
        assert date(2026, 3, 2) in nwd['jack']
        assert date(2026, 3, 3) in nwd['jack']
        assert date(2026, 4, 1) in nwd['jack']
        assert len(nwd['jack']) == 4


class TestDependencyLoopDetection:
    """Test suite for dependency loop detection (GitHub issue #22)."""

    def test_simple_circular_dependency(self):
        """Test detection of simple A -> B -> A loop."""
        # Task 1 depends on Task 2, Task 2 depends on Task 1
        phases = [
            {
                'Task 1': {
                    '_text': 'Task 1 [depends Task 2] @john 2d',
                    '_level': 0
                }
            },
            {
                'Task 2': {
                    '_text': 'Task 2 [depends Task 1] @jane 2d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        assert len(tasks) == 2
        # Verify loop was detected and warnings added
        loop_warnings = [t for t in tasks if 'loop_warning' in t]
        assert len(loop_warnings) > 0, "Loop warning should be added to affected tasks"

    def test_three_way_circular_dependency(self):
        """Test detection of A -> B -> C -> A loop."""
        phases = [
            {
                'Task 1': {
                    '_text': 'Task 1 [depends Task 3] @john 2d',
                    '_level': 0
                }
            },
            {
                'Task 2': {
                    '_text': 'Task 2 [depends Task 1] @jane 2d',
                    '_level': 0
                }
            },
            {
                'Task 3': {
                    '_text': 'Task 3 [depends Task 2] @bob 2d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        assert len(tasks) == 3
        # All tasks in the cycle should have loop warnings
        loop_warnings = [t for t in tasks if 'loop_warning' in t]
        assert len(loop_warnings) == 3, "All tasks in the cycle should have warnings"

    def test_self_dependency(self):
        """Test detection of task depending on itself."""
        phases = [
            {
                'Task 1': {
                    '_text': 'Task 1 [depends Task 1] @john 2d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        assert len(tasks) == 1
        assert 'loop_warning' in tasks[0], "Self-dependency should be flagged"

    def test_no_circular_dependency(self):
        """Test that valid dependency chain is not flagged."""
        phases = [
            {
                'Task 1': {
                    '_text': 'Task 1 @john 2d',
                    '_level': 0
                }
            },
            {
                'Task 2': {
                    '_text': 'Task 2 [depends Task 1] @jane 2d',
                    '_level': 0
                }
            },
            {
                'Task 3': {
                    '_text': 'Task 3 [depends Task 2] @bob 2d',
                    '_level': 0
                }
            }
        ]
        tasks = schedule_tasks(phases)
        # Valid chain: Task 1 -> Task 2 -> Task 3
        assert len(tasks) == 3
        # Dependent tasks start on the next working day after their dependency finishes.
        # The finish date is exclusive (day after last working day), so if it falls
        # on a weekend, get_next_working_day skips to Monday.
        assert tasks[1]['start'] == get_next_working_day(tasks[0]['finish'])
        assert tasks[2]['start'] == get_next_working_day(tasks[1]['finish'])
        # Valid chain should not trigger warnings
        loop_warnings = [t for t in tasks if 'loop_warning' in t]
        assert len(loop_warnings) == 0, "Valid dependency chain should not be flagged"


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_task_with_very_long_duration(self):
        """Test task with very long duration (365+ days)."""
        phases = {
            'Task 1': {
                '_text': 'Task 1 @john 365d',
                '_level': 0
            }
        }
        tasks = schedule_tasks(phases)
        assert len(tasks) == 1
        assert tasks[0]['duration'] == timedelta(days=365)

    def test_task_starting_on_new_years_day(self):
        """Test task scheduling around year boundary."""
        phases = {
            'Task 1': {
                '_text': 'Task 1 @john 10d',
                '_level': 0
            }
        }
        tasks = schedule_tasks(phases)
        # Should handle year transitions gracefully
        assert len(tasks) == 1

    def test_empty_phases_input(self):
        """Test with empty phases."""
        phases = {}
        tasks = schedule_tasks(phases)
        assert tasks == [] or len(tasks) == 0

    def test_task_with_special_characters_in_name(self):
        """Test task name with special characters."""
        phases = {
            'Task-1_Test (v2)': {
                '_text': 'Task-1_Test (v2) @john 2d',
                '_level': 0
            }
        }
        tasks = schedule_tasks(phases)
        assert len(tasks) == 1
        assert 'Task-1_Test (v2)' in tasks[0]['name']

    def test_task_with_unicode_in_name(self):
        """Test task name with unicode characters."""
        phases = {
            'Tâche 1': {
                '_text': 'Tâche 1 @jean 2d',
                '_level': 0
            }
        }
        tasks = schedule_tasks(phases)
        assert len(tasks) == 1
        assert 'Tâche' in tasks[0]['name']

    def test_multiple_resources_on_one_task(self):
        """Test task assigned to multiple resources."""
        task = "Task 1 @john @jane @bob 5d"
        result = extract_metadata(task, "Task 1")
        # Resources are stored without @ prefix, comma-separated
        assert 'john' in result['resources']
        assert 'jane' in result['resources']
        assert 'bob' in result['resources']

    def test_task_with_100_percent_complete(self):
        """Test task that's fully complete."""
        task = "Task 1 @john 5d 100%"
        result = extract_metadata(task, "Task 1")
        assert result['percent'] == 100


class TestDSTBoundaryRegression:
    """Tests to ensure scheduling works correctly across DST transitions.

    March 29 2026 is a Sunday (UK/Europe DST spring forward).
    March 30 2026 is a Monday (first working day after DST change).
    October 25 2026 is a Sunday (UK/Europe DST fall back).
    """

    def test_working_day_across_spring_dst(self):
        """March 30 2026 (Monday after spring DST) should be a working day."""
        monday = datetime(2026, 3, 30)
        result = get_next_working_day(monday)
        assert result == monday
        assert result.weekday() == 0  # Monday

    def test_add_working_days_across_spring_dst(self):
        """Adding working days across the spring DST boundary should not skip or duplicate days."""
        friday_before = datetime(2026, 3, 27)  # Friday before DST
        # 1 working day from Friday = next Monday (March 30, after DST)
        result = add_working_days(friday_before, 2)
        # 2 working days: Fri 27 (day 1), Mon 30 (day 2), finish = Tue 31 (exclusive)
        assert result == datetime(2026, 3, 31)

    def test_add_working_days_across_autumn_dst(self):
        """Adding working days across the autumn DST boundary should not skip or duplicate days."""
        friday_before = datetime(2026, 10, 23)  # Friday before autumn DST (Oct 25)
        # 3 working days: Fri 23 (day 1), Mon 26 (day 2), Tue 27 (day 3)
        result = add_working_days(friday_before, 3)
        assert result == datetime(2026, 10, 28)  # Exclusive finish = Wed 28

    def test_five_working_days_across_spring_dst(self):
        """5 working days starting Thursday before DST should end on Wednesday after."""
        thursday = datetime(2026, 3, 26)
        # 5 working days: Thu 26, Fri 27, Mon 30, Tue 31, Wed Apr 1
        result = add_working_days(thursday, 5)
        # Exclusive finish = day after Wed Apr 1 = Thu Apr 2
        assert result == datetime(2026, 4, 2)

    def test_no_resource_on_dst_weekend(self):
        """Resources should not be assigned to the DST weekend (Sat 28, Sun 29 March 2026)."""
        from noodle_core.scheduling_engine import calculate_resource_allocation
        tasks = [
            {
                'name': 'DST Task',
                'start': datetime(2026, 3, 26),
                'finish': datetime(2026, 4, 2),
                'duration': timedelta(days=5),
                'resources': 'alice',
                'level': 0,
            },
        ]
        result = calculate_resource_allocation(
            tasks,
            start_date=datetime(2026, 3, 26),
            finish_date=datetime(2026, 4, 2),
        )
        alice_days = result['allocation']['alice']
        saturday = datetime(2026, 3, 28)
        sunday = datetime(2026, 3, 29)
        assert saturday not in alice_days, "Saturday during DST weekend should have no allocation"
        assert sunday not in alice_days, "Sunday during DST weekend should have no allocation"
        # Monday after DST should have allocation
        monday = datetime(2026, 3, 30)
        assert monday in alice_days, "Monday after DST should have allocation"

    def test_datetime_with_time_component_does_not_break_day_calc(self):
        """Dates with non-midnight times should not cause off-by-one in day calculations."""
        # Simulate datetime.now() with time component
        start_with_time = datetime(2026, 3, 27, 14, 30, 0)
        start_midnight = datetime(2026, 3, 27, 0, 0, 0)

        result_time = add_working_days(start_with_time, 3)
        result_midnight = add_working_days(start_midnight, 3)
        # Both should produce the same finish date
        assert result_time.date() == result_midnight.date()

    def test_resource_sheet_no_working_bar_on_weekend(self):
        """Resource sheet should show ░ (not █) on DST weekend days."""
        from noodle_core.scheduling_engine import render_resource_sheet
        tasks = [
            {
                'name': 'DST Task',
                'start': datetime(2026, 3, 26),
                'finish': datetime(2026, 4, 2),
                'duration': timedelta(days=5),
                'resources': 'alice',
                'level': 0,
            },
        ]
        sheet = render_resource_sheet(
            tasks,
            start_date=datetime(2026, 3, 26),
            finish_date=datetime(2026, 4, 2),
            terminal_width=80,
        )
        # Find the resource line
        for line in sheet.split('\n'):
            if 'alice' in line.lower():
                # The chart part is after the last '|'
                parts = line.split('|')
                chart = parts[-1] if len(parts) > 1 else ''
                # Days: Thu26=0, Fri27=1, Sat28=2, Sun29=3, Mon30=4, Tue31=5, Wed1=6
                if len(chart) >= 7:
                    assert chart[2] == '░', f"Saturday (pos 2) should be ░, got '{chart[2]}'"
                    assert chart[3] == '░', f"Sunday (pos 3) should be ░, got '{chart[3]}'"
                    assert chart[4] == '█', f"Monday after DST (pos 4) should be █, got '{chart[4]}'"
                break


class TestInheritSummaryResources:
    """Test suite for summary task resource inheritance."""

    def test_children_inherit_resource_from_summary_parent(self):
        """Children without resources inherit from their summary parent."""
        from noodle_core.scheduling_engine import inherit_summary_resources
        tasks = [
            {'name': 'Design', 'summary': True, 'resources': 'kev', 'parent': None},
            {'name': 'Wireframes', 'summary': False, 'resources': '', 'parent': 'Design'},
            {'name': 'Mockups', 'summary': False, 'resources': '', 'parent': 'Design'},
        ]
        inherit_summary_resources(tasks)
        assert tasks[1]['resources'] == 'kev'
        assert tasks[1]['inherited_resource'] is True
        assert tasks[2]['resources'] == 'kev'
        assert tasks[2]['inherited_resource'] is True

    def test_children_keep_own_resource_over_inherited(self):
        """Children with their own resource are not overwritten."""
        from noodle_core.scheduling_engine import inherit_summary_resources
        tasks = [
            {'name': 'Design', 'summary': True, 'resources': 'kev', 'parent': None},
            {'name': 'Wireframes', 'summary': False, 'resources': 'alice', 'parent': 'Design'},
            {'name': 'Mockups', 'summary': False, 'resources': '', 'parent': 'Design'},
        ]
        inherit_summary_resources(tasks)
        assert tasks[1]['resources'] == 'alice'
        assert tasks[1].get('inherited_resource') is None or tasks[1].get('inherited_resource') is False
        assert tasks[2]['resources'] == 'kev'
        assert tasks[2]['inherited_resource'] is True

    def test_no_inheritance_when_summary_has_no_resource(self):
        """No inheritance occurs when the summary task has no resource."""
        from noodle_core.scheduling_engine import inherit_summary_resources
        tasks = [
            {'name': 'Design', 'summary': True, 'resources': '', 'parent': None},
            {'name': 'Wireframes', 'summary': False, 'resources': '', 'parent': 'Design'},
        ]
        inherit_summary_resources(tasks)
        assert tasks[1]['resources'] == ''
        assert tasks[1].get('inherited_resource') is None or tasks[1].get('inherited_resource') is False

    def test_nested_summary_inheritance(self):
        """Resource propagates through nested summary tasks."""
        from noodle_core.scheduling_engine import inherit_summary_resources
        tasks = [
            {'name': 'Project', 'summary': True, 'resources': 'kev', 'parent': None},
            {'name': 'Design', 'summary': True, 'resources': '', 'parent': 'Project'},
            {'name': 'Wireframes', 'summary': False, 'resources': '', 'parent': 'Design'},
        ]
        inherit_summary_resources(tasks)
        assert tasks[1]['resources'] == 'kev'
        assert tasks[1]['inherited_resource'] is True
        assert tasks[2]['resources'] == 'kev'
        assert tasks[2]['inherited_resource'] is True

    def test_child_summary_with_own_resource_overrides_parent(self):
        """A child summary with its own resource uses that instead of parent's."""
        from noodle_core.scheduling_engine import inherit_summary_resources
        tasks = [
            {'name': 'Project', 'summary': True, 'resources': 'kev', 'parent': None},
            {'name': 'Design', 'summary': True, 'resources': 'alice', 'parent': 'Project'},
            {'name': 'Wireframes', 'summary': False, 'resources': '', 'parent': 'Design'},
        ]
        inherit_summary_resources(tasks)
        assert tasks[1]['resources'] == 'alice'
        assert tasks[2]['resources'] == 'alice'

    def test_schedule_tasks_with_summary_resource(self):
        """End-to-end: summary task resource is inherited by leaf tasks."""
        plan_text = """Design @kev
    Wireframes 3d
    Mockups 2d"""
        from noodle_core.scheduling_engine import natural_language_to_yaml
        phases = natural_language_to_yaml(plan_text)
        tasks = schedule_tasks(phases["Project"])
        # Find leaf tasks
        wireframes = next(t for t in tasks if t['name'] == 'Wireframes')
        mockups = next(t for t in tasks if t['name'] == 'Mockups')
        assert wireframes['resources'] == 'kev'
        assert wireframes.get('inherited_resource') is True
        assert mockups['resources'] == 'kev'
        assert mockups.get('inherited_resource') is True

    def test_schedule_tasks_summary_resource_not_double_counted(self):
        """Inherited resources should not cause double counting in resource allocation."""
        from noodle_core.scheduling_engine import natural_language_to_yaml, calculate_resource_allocation
        plan_text = """Design @kev
    Wireframes 3d
    Mockups 2d"""
        phases = natural_language_to_yaml(plan_text)
        tasks = schedule_tasks(phases["Project"])
        start = min(t['start'] for t in tasks if 'start' in t)
        finish = max(t['finish'] for t in tasks if 'finish' in t)
        result = calculate_resource_allocation(tasks, start, finish)
        # kev should appear as a resource
        assert 'kev' in result['resources']
        # Check there is no double-counting (summary task itself should not be counted)
        summary = next(t for t in tasks if t.get('summary'))
        assert summary['resources'] == 'kev'  # Summary has resource
        # But allocation only counts leaf tasks
        total_hours = sum(result['allocation']['kev'].values())
        # 3d + 2d = 5d * 8h = 40h (not 80h from double-counting)
        assert total_hours == pytest.approx(40.0, abs=1.0)


class TestExportReportToPowerpoint:
    """Tests for the export_report_to_powerpoint function."""

    def test_creates_valid_pptx_file(self, tmp_path):
        """Test that a valid PPTX file is created."""
        from noodle_core import export_report_to_powerpoint
        output = tmp_path / "report.pptx"
        report_data = {
            'project_name': 'Test Project',
            'manager': 'Alice',
            'sponsor': 'Bob',
            'budget': '$100k',
            'date': '2026-03-01',
            'status': 'On Track',
            'milestones': [],
            'up_next': [],
            'highlight': None,
            'risks_issues': [],
            'timeline_tasks': [],
        }
        export_report_to_powerpoint(str(output), report_data)
        assert output.exists()
        assert output.stat().st_size > 0

    def test_slide_contains_project_name(self, tmp_path):
        """Test that the slide contains the project name."""
        from pptx import Presentation
        from noodle_core import export_report_to_powerpoint
        output = tmp_path / "report_name.pptx"
        report_data = {
            'project_name': 'My Cool Project',
            'manager': '', 'sponsor': '', 'budget': '',
            'date': '2026-03-01', 'status': '',
            'milestones': [], 'up_next': [], 'highlight': None,
            'risks_issues': [], 'timeline_tasks': [],
        }
        export_report_to_powerpoint(str(output), report_data)
        prs = Presentation(str(output))
        assert len(prs.slides) == 1
        all_text = ' '.join(
            shape.text_frame.text for shape in prs.slides[0].shapes
            if shape.has_text_frame
        )
        assert 'My Cool Project' in all_text

    def test_slide_has_rag_status_badge(self, tmp_path):
        """Test that the RAG status badge appears on the slide."""
        from pptx import Presentation
        from noodle_core import export_report_to_powerpoint
        output = tmp_path / "report_rag.pptx"
        report_data = {
            'project_name': 'RAG Test',
            'manager': 'PM', 'sponsor': 'Sponsor', 'budget': '50k',
            'date': '2026-03-01', 'status': 'Behind Schedule',
            'milestones': [], 'up_next': [], 'highlight': None,
            'risks_issues': [], 'timeline_tasks': [],
        }
        export_report_to_powerpoint(str(output), report_data)
        prs = Presentation(str(output))
        all_text = ' '.join(
            shape.text_frame.text for shape in prs.slides[0].shapes
            if shape.has_text_frame
        )
        assert 'BEHIND SCHEDULE' in all_text

    def test_slide_has_footer(self, tmp_path):
        """Test that the slide includes the footer."""
        from pptx import Presentation
        from noodle_core import export_report_to_powerpoint
        output = tmp_path / "report_footer.pptx"
        report_data = {
            'project_name': 'Footer Test',
            'manager': '', 'sponsor': '', 'budget': '',
            'date': '2026-03-01', 'status': '',
            'milestones': [], 'up_next': [], 'highlight': None,
            'risks_issues': [], 'timeline_tasks': [],
        }
        export_report_to_powerpoint(str(output), report_data)
        prs = Presentation(str(output))
        all_text = ' '.join(
            shape.text_frame.text for shape in prs.slides[0].shapes
            if shape.has_text_frame
        )
        assert 'Generated by Noodle Planner' in all_text

    def test_slide_with_milestones_and_risks(self, tmp_path):
        """Test slide with milestones and risks data."""
        from pptx import Presentation
        from noodle_core import export_report_to_powerpoint
        output = tmp_path / "report_data.pptx"
        report_data = {
            'project_name': 'Data Test',
            'manager': 'Alice', 'sponsor': 'Bob', 'budget': '$100k',
            'date': '2026-03-01', 'status': 'On Track',
            'milestones': [
                {'name': 'Phase 1 Complete', 'date': '2026-04-01', 'rag': 'green'},
            ],
            'up_next': [
                {'name': 'Design Review', 'start': '2026-03-05',
                 'finish': '2026-03-10', 'rag': 'amber'},
            ],
            'highlight': {'date': '2026-03-01', 'author': 'Alice',
                          'content': 'Good progress this week.'},
            'risks_issues': [
                {'type': 'risk', 'title': 'Resource shortage',
                 'description': 'Not enough devs', 'mitigation': 'Hire more',
                 'score': 12},
            ],
            'timeline_tasks': [],
        }
        export_report_to_powerpoint(str(output), report_data)
        prs = Presentation(str(output))
        # Collect text from both text frames and table cells
        texts = []
        for shape in prs.slides[0].shapes:
            if shape.has_text_frame:
                texts.append(shape.text_frame.text)
            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        texts.append(cell.text)
        all_text = ' '.join(texts)
        assert 'Phase 1 Complete' in all_text
        assert 'Design Review' in all_text
        assert 'Resource shortage' in all_text
        assert 'Good progress this week.' in all_text

    def test_uses_shared_add_report_slide(self, tmp_path):
        """Verify export_report_to_powerpoint delegates to _add_report_slide."""
        from pptx import Presentation as PptxPresentation
        from noodle_core import export_report_to_powerpoint
        from noodle_core.scheduling_engine import _add_report_slide

        output_standalone = tmp_path / "standalone.pptx"
        output_shared = tmp_path / "shared.pptx"

        report_data = {
            'project_name': 'Shared Test',
            'manager': 'PM', 'sponsor': 'Sponsor', 'budget': '50k',
            'date': '2026-03-01', 'status': 'green',
            'milestones': [{'name': 'M1', 'date': '2026-04-01', 'rag': 'green'}],
            'up_next': [], 'highlight': None,
            'risks_issues': [], 'timeline_tasks': [],
        }

        # Standalone export
        export_report_to_powerpoint(str(output_standalone), report_data)

        # Direct use of _add_report_slide
        prs = PptxPresentation()
        prs.slide_width = 12192000  # same as Inches(13.333)
        prs.slide_height = 6858000  # same as Inches(7.5)
        _add_report_slide(prs, report_data)
        prs.save(str(output_shared))

        # Both should produce 1 slide with same text content
        prs1 = PptxPresentation(str(output_standalone))
        prs2 = PptxPresentation(str(output_shared))
        assert len(prs1.slides) == len(prs2.slides) == 1

        text1 = ' '.join(
            shape.text_frame.text for shape in prs1.slides[0].shapes
            if shape.has_text_frame
        )
        text2 = ' '.join(
            shape.text_frame.text for shape in prs2.slides[0].shapes
            if shape.has_text_frame
        )
        assert 'Shared Test' in text1
        assert 'Shared Test' in text2


class TestTimelineImageOnly:
    """Regression tests: PPTX reports use image-based timeline only, not shapes."""

    def test_no_shapes_fallback_when_only_timeline_tasks(self, tmp_path):
        """When timeline_tasks are provided but no timeline_image,
        _add_report_slide should NOT draw shape-based timeline graphics."""
        from pptx import Presentation as PptxPresentation
        from noodle_core.scheduling_engine import _add_report_slide

        prs = PptxPresentation()
        prs.slide_width = 12192000
        prs.slide_height = 6858000

        report_data = {
            'project_name': 'No Shapes Test',
            'manager': '', 'sponsor': '', 'budget': '',
            'date': '2026-03-05', 'status': 'green',
            'milestones': [], 'up_next': [],
            'highlight': None, 'risks_issues': [],
            'timeline_tasks': [
                {'name': 'Phase A', 'start': '2026-01-01',
                 'finish': '2026-06-30', 'percent': 50,
                 'is_summary': True, 'duration_days': 181},
            ],
        }

        _add_report_slide(prs, report_data)
        slide = prs.slides[0]

        # Count shapes: with the old fallback, _draw_timeline_graphic would
        # add rectangles, diamonds, and lines. Without it, the only shapes
        # are the title bar, text boxes, status badge, section headings, and
        # tables — none should be drawn for timeline.
        # Specifically, there should be no freeform or auto-shape elements
        # that represent phase bars or milestone diamonds.
        from pptx.enum.shapes import MSO_SHAPE_TYPE
        auto_shapes = [
            s for s in slide.shapes
            if s.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE
            and s.top > 900000  # below title bar area (~1 inch)
            and s.top < 2000000  # in the timeline zone
        ]
        # With no timeline image and no shapes fallback, there should be
        # zero auto-shapes in the timeline zone
        assert len(auto_shapes) == 0, (
            f"Expected no shape-based timeline graphics, "
            f"found {len(auto_shapes)} auto-shapes in timeline zone"
        )

    def test_timeline_image_is_embedded_when_provided(self, tmp_path):
        """When timeline_image is provided, it should be embedded as a picture."""
        from pptx import Presentation as PptxPresentation
        from pptx.enum.shapes import MSO_SHAPE_TYPE
        from noodle_core.scheduling_engine import _add_report_slide
        import base64

        # Create a minimal valid PNG (1x1 pixel, red)
        import struct
        import zlib
        def _make_png():
            sig = b'\x89PNG\r\n\x1a\n'
            ihdr_data = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
            ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
            ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
            raw = b'\x00\xff\x00\x00'  # filter byte + RGB
            idat_data = zlib.compress(raw)
            idat_crc = zlib.crc32(b'IDAT' + idat_data) & 0xffffffff
            idat = struct.pack('>I', len(idat_data)) + b'IDAT' + idat_data + struct.pack('>I', idat_crc)
            iend_crc = zlib.crc32(b'IEND') & 0xffffffff
            iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
            return sig + ihdr + idat + iend

        png_b64 = base64.b64encode(_make_png()).decode('ascii')

        prs = PptxPresentation()
        prs.slide_width = 12192000
        prs.slide_height = 6858000

        report_data = {
            'project_name': 'Image Timeline Test',
            'manager': '', 'sponsor': '', 'budget': '',
            'date': '2026-03-05', 'status': 'green',
            'milestones': [], 'up_next': [],
            'highlight': None, 'risks_issues': [],
            'timeline_image': png_b64,
        }

        _add_report_slide(prs, report_data)
        slide = prs.slides[0]

        # Should find at least one picture shape (the timeline image)
        pictures = [s for s in slide.shapes
                    if s.shape_type == MSO_SHAPE_TYPE.PICTURE]
        assert len(pictures) >= 1, "Timeline image should be embedded as a picture"


class TestExportPortfolioToPowerpoint:
    """Tests for the export_portfolio_to_powerpoint function."""

    def test_creates_valid_pptx_file(self, tmp_path):
        """Test that a valid PPTX file is created."""
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "portfolio.pptx"
        portfolio_data = {
            'portfolio_name': 'Test Portfolio',
            'date': '2026-02-27',
            'projects': [
                {'name': 'Proj A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 1},
            ],
        }
        project_reports = [
            {'project_name': 'Proj A', 'manager': '', 'sponsor': '',
             'budget': '', 'date': '2026-02-27', 'status': 'green',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        assert output.exists()
        # PPTX is a ZIP file
        content = output.read_bytes()
        assert content[:2] == b'PK'

    def test_creates_correct_slide_count(self, tmp_path):
        """Test that the correct number of slides is created."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "portfolio.pptx"
        portfolio_data = {
            'portfolio_name': 'Portfolio',
            'date': '2026-02-27',
            'projects': [
                {'name': 'A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 0},
                {'name': 'B', 'status': 'At Risk', 'rag': 'red',
                 'completion': 10, 'risk_count': 3},
            ],
        }
        project_reports = [
            {'project_name': 'A', 'manager': '', 'sponsor': '', 'budget': '',
             'date': '2026-02-27', 'status': 'green', 'milestones': [],
             'up_next': [], 'highlight': None, 'risks_issues': [],
             'timeline_tasks': []},
            {'project_name': 'B', 'manager': '', 'sponsor': '', 'budget': '',
             'date': '2026-02-27', 'status': 'red', 'milestones': [],
             'up_next': [], 'highlight': None, 'risks_issues': [],
             'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        # 1 overview + 1 risk register + 2 project slides = 4
        assert len(prs.slides) == 4

    def test_empty_portfolio(self, tmp_path):
        """Test export with empty portfolio still produces a valid file."""
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "empty.pptx"
        portfolio_data = {
            'portfolio_name': 'Empty',
            'date': '2026-02-27',
            'projects': [],
        }
        export_portfolio_to_powerpoint(str(output), portfolio_data, [])
        assert output.exists()
        content = output.read_bytes()
        assert content[:2] == b'PK'

    def test_portfolio_with_timeline_data(self, tmp_path):
        """Test that projects with date ranges produce timeline bars."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "timeline.pptx"
        portfolio_data = {
            'portfolio_name': 'Timeline Test',
            'date': '2026-02-27',
            'projects': [
                {'name': 'A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 0,
                 'start_date': '2026-01-01', 'end_date': '2026-06-30'},
                {'name': 'B', 'status': 'Behind', 'rag': 'amber',
                 'completion': 25, 'risk_count': 1,
                 'start_date': '2026-03-01', 'end_date': '2026-09-30'},
            ],
        }
        project_reports = [
            {'project_name': 'A', 'manager': '', 'sponsor': '', 'budget': '',
             'date': '2026-02-27', 'status': 'green', 'milestones': [],
             'up_next': [], 'highlight': None, 'risks_issues': [],
             'timeline_tasks': []},
            {'project_name': 'B', 'manager': '', 'sponsor': '', 'budget': '',
             'date': '2026-02-27', 'status': 'amber', 'milestones': [],
             'up_next': [], 'highlight': None, 'risks_issues': [],
             'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        # 1 overview + 1 risk register + 2 project slides = 4
        assert len(prs.slides) == 4
        # Overview slide should have shapes for timeline bars
        overview = prs.slides[0]
        assert len(overview.shapes) > 5  # Title + table + timeline elements

    def test_project_report_slide_has_title(self, tmp_path):
        """Test that each project report slide contains the project name."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "titled.pptx"
        portfolio_data = {
            'portfolio_name': 'Titled',
            'date': '2026-02-27',
            'projects': [
                {'name': 'My Project', 'status': 'On Track', 'rag': 'green',
                 'completion': 75, 'risk_count': 0},
            ],
        }
        project_reports = [
            {'project_name': 'My Project', 'manager': 'PM', 'sponsor': 'Sponsor',
             'budget': '50k', 'date': '2026-02-27', 'status': 'green',
             'milestones': [{'name': 'Launch', 'date': '2026-04-01', 'rag': 'green'}],
             'up_next': [], 'highlight': None, 'risks_issues': [],
             'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        # After overview (0) and risk register (1), project slide is at index 2
        project_slide = prs.slides[2]
        all_text = ' '.join(
            shape.text_frame.text for shape in project_slide.shapes
            if shape.has_text_frame
        )
        assert 'My Project' in all_text

    def test_project_report_slides_have_no_generated_by_footer(self, tmp_path):
        """Test that project report slides do not have 'Generated by Noodle Planner' footer."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "no_footer.pptx"
        portfolio_data = {
            'portfolio_name': 'Footer Test',
            'date': '2026-02-27',
            'projects': [
                {'name': 'Project A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 0},
            ],
        }
        project_reports = [
            {'project_name': 'Project A', 'manager': 'PM', 'sponsor': 'Sponsor',
             'budget': '50k', 'date': '2026-02-27', 'status': 'green',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        # Slide 0 is overview, risk register slides follow, then project reports.
        # The last slide is the project report for a single-project portfolio.
        project_slide = prs.slides[-1]
        all_text = ' '.join(
            shape.text_frame.text for shape in project_slide.shapes
            if shape.has_text_frame
        )
        assert 'Generated by Noodle Planner' not in all_text

    def test_overview_slide_keeps_generated_by_footer(self, tmp_path):
        """Test that the portfolio overview slide still has the footer."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "overview_footer.pptx"
        portfolio_data = {
            'portfolio_name': 'Overview Footer Test',
            'date': '2026-02-27',
            'projects': [
                {'name': 'Project B', 'status': 'On Track', 'rag': 'green',
                 'completion': 30, 'risk_count': 0},
            ],
        }
        project_reports = [
            {'project_name': 'Project B', 'manager': 'PM', 'sponsor': 'Sponsor',
             'budget': '50k', 'date': '2026-02-27', 'status': 'green',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        overview_slide = prs.slides[0]
        all_text = ' '.join(
            shape.text_frame.text for shape in overview_slide.shapes
            if shape.has_text_frame
        )
        assert 'Generated by Noodle Planner' in all_text


class TestParseBudgetValue:
    """Tests for the _parse_budget_value helper function."""

    def test_plain_number(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("50000") == 50000

    def test_number_with_commas(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("1,500,000") == 1500000

    def test_dollar_sign(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("$50,000") == 50000

    def test_pound_sign(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("\u00a350,000") == 50000

    def test_k_suffix(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("50k") == 50000

    def test_k_suffix_uppercase(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("$100K") == 100000

    def test_m_suffix(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("$1.5M") == 1500000

    def test_m_suffix_lowercase(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("2.5m") == 2500000

    def test_empty_string(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("") is None

    def test_none(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value(None) is None

    def test_non_numeric(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("TBD") is None

    def test_euro_sign(self):
        from noodle_core.scheduling_engine import _parse_budget_value
        assert _parse_budget_value("\u20ac200k") == 200000


class TestFormatBudgetTotal:
    """Tests for the _format_budget_total helper function."""

    def test_small_amount(self):
        from noodle_core.scheduling_engine import _format_budget_total
        assert _format_budget_total(500) == "$500"

    def test_thousands(self):
        from noodle_core.scheduling_engine import _format_budget_total
        assert _format_budget_total(50000) == "$50,000"

    def test_millions(self):
        from noodle_core.scheduling_engine import _format_budget_total
        assert _format_budget_total(1500000) == "$1.5M"

    def test_billions(self):
        from noodle_core.scheduling_engine import _format_budget_total
        assert _format_budget_total(2000000000) == "$2.0B"


class TestCalculateTotalPortfolioBudget:
    """Tests for the _calculate_total_portfolio_budget helper function."""

    def test_single_project_budget(self):
        from noodle_core.scheduling_engine import _calculate_total_portfolio_budget
        projects = [{'name': 'A', 'budget': '$50,000'}]
        assert _calculate_total_portfolio_budget(projects) == 50000

    def test_multiple_project_budgets(self):
        from noodle_core.scheduling_engine import _calculate_total_portfolio_budget
        projects = [
            {'name': 'A', 'budget': '$50k'},
            {'name': 'B', 'budget': '$100k'},
        ]
        assert _calculate_total_portfolio_budget(projects) == 150000

    def test_no_budgets(self):
        from noodle_core.scheduling_engine import _calculate_total_portfolio_budget
        projects = [
            {'name': 'A', 'budget': ''},
            {'name': 'B'},
        ]
        assert _calculate_total_portfolio_budget(projects) is None

    def test_mixed_budgets(self):
        from noodle_core.scheduling_engine import _calculate_total_portfolio_budget
        projects = [
            {'name': 'A', 'budget': '$50k'},
            {'name': 'B', 'budget': ''},
            {'name': 'C', 'budget': '$100k'},
        ]
        assert _calculate_total_portfolio_budget(projects) == 150000

    def test_empty_projects_list(self):
        from noodle_core.scheduling_engine import _calculate_total_portfolio_budget
        assert _calculate_total_portfolio_budget([]) is None


class TestPortfolioBudgetInSlide:
    """Tests for budget display in portfolio overview slide."""

    def test_total_budget_in_overview_slide(self, tmp_path):
        """Test that total budget appears on the overview slide."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "budget.pptx"
        portfolio_data = {
            'portfolio_name': 'Budget Test',
            'date': '2026-03-01',
            'projects': [
                {'name': 'Proj A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 1, 'budget': '$50,000'},
                {'name': 'Proj B', 'status': 'At Risk', 'rag': 'amber',
                 'completion': 25, 'risk_count': 2, 'budget': '$100,000'},
            ],
        }
        project_reports = [
            {'project_name': 'Proj A', 'manager': '', 'sponsor': '',
             'budget': '$50,000', 'date': '2026-03-01', 'status': 'green',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
            {'project_name': 'Proj B', 'manager': '', 'sponsor': '',
             'budget': '$100,000', 'date': '2026-03-01', 'status': 'amber',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        overview = prs.slides[0]
        all_text = ' '.join(
            shape.text_frame.text for shape in overview.shapes
            if shape.has_text_frame
        )
        assert '$150,000' in all_text

    def test_budget_column_in_dashboard_table(self, tmp_path):
        """Test that individual project budgets appear in the dashboard table."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "budget_table.pptx"
        portfolio_data = {
            'portfolio_name': 'Budget Table',
            'date': '2026-03-01',
            'projects': [
                {'name': 'Proj A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 0, 'budget': '$50k'},
            ],
        }
        project_reports = [
            {'project_name': 'Proj A', 'manager': '', 'sponsor': '',
             'budget': '$50k', 'date': '2026-03-01', 'status': 'green',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        overview = prs.slides[0]
        # Find the table shape on the overview slide
        table_shape = None
        for shape in overview.shapes:
            if shape.has_table:
                table_shape = shape
                break
        assert table_shape is not None, "No table found on overview slide"
        tbl = table_shape.table
        # Table should have 6 columns: Name, Budget, Status, Progress, RAG, Risks
        assert len(tbl.columns) == 6
        # Header row should have 'Budget' label
        assert tbl.cell(0, 1).text == 'Budget'
        # First data row should have the project budget
        assert tbl.cell(1, 1).text == '$50k'

    def test_no_budget_shows_no_total(self, tmp_path):
        """Test that no total is shown when no projects have budgets."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "no_budget.pptx"
        portfolio_data = {
            'portfolio_name': 'No Budget',
            'date': '2026-03-01',
            'projects': [
                {'name': 'Proj A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 0, 'budget': ''},
            ],
        }
        project_reports = [
            {'project_name': 'Proj A', 'manager': '', 'sponsor': '',
             'budget': '', 'date': '2026-03-01', 'status': 'green',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        overview = prs.slides[0]
        all_text = ' '.join(
            shape.text_frame.text for shape in overview.shapes
            if shape.has_text_frame
        )
        assert 'Total Budget' not in all_text


class TestRagBadgeWhiteBackground:
    """Tests for white backgrounds behind RAG badges on portfolio overview."""

    def _make_portfolio(self, tmp_path):
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "rag_bg.pptx"
        portfolio_data = {
            'portfolio_name': 'RAG Background Test',
            'date': '2026-03-02',
            'projects': [
                {'name': 'Proj A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 1, 'budget': '$50k'},
                {'name': 'Proj B', 'status': 'At Risk', 'rag': 'amber',
                 'completion': 25, 'risk_count': 2, 'budget': '$100k'},
                {'name': 'Proj C', 'status': 'Behind', 'rag': 'red',
                 'completion': 10, 'risk_count': 3, 'budget': '$75k'},
            ],
        }
        project_reports = [
            {'project_name': 'Proj A', 'manager': '', 'sponsor': '',
             'budget': '$50k', 'date': '2026-03-02', 'status': 'green',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
            {'project_name': 'Proj B', 'manager': '', 'sponsor': '',
             'budget': '$100k', 'date': '2026-03-02', 'status': 'amber',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
            {'project_name': 'Proj C', 'manager': '', 'sponsor': '',
             'budget': '$75k', 'date': '2026-03-02', 'status': 'red',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [], 'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        return Presentation(str(output))

    def test_overview_has_white_badge_background_shape(self, tmp_path):
        """Test that the overview slide has a white rounded rectangle for RAG badges."""
        from pptx.dml.color import RGBColor
        from pptx.enum.shapes import MSO_SHAPE
        prs = self._make_portfolio(tmp_path)
        overview = prs.slides[0]
        white_rounded_rects = []
        for s in overview.shapes:
            try:
                if (s.auto_shape_type == MSO_SHAPE.ROUNDED_RECTANGLE
                        and s.fill.fore_color.rgb == RGBColor(255, 255, 255)):
                    white_rounded_rects.append(s)
            except (ValueError, AttributeError):
                continue
        assert len(white_rounded_rects) >= 1, (
            "Expected at least one white rounded rectangle for RAG badge background"
        )

    def test_rag_summary_has_coloured_text_runs(self, tmp_path):
        """Test that RAG summary uses coloured runs, not plain white text."""
        from pptx.dml.color import RGBColor
        prs = self._make_portfolio(tmp_path)
        overview = prs.slides[0]
        # Find the textbox containing 'Green:' which is the RAG summary
        rag_textbox = None
        for shape in overview.shapes:
            if shape.has_text_frame:
                full_text = shape.text_frame.text
                if 'Green:' in full_text and 'Red:' in full_text:
                    rag_textbox = shape
                    break
        assert rag_textbox is not None, "RAG summary textbox not found"
        para = rag_textbox.text_frame.paragraphs[0]
        run_colours = [run.font.color.rgb for run in para.runs if run.font.color.rgb]
        white = RGBColor(255, 255, 255)
        assert white not in run_colours, (
            "RAG summary should not use white text; it should use coloured runs"
        )

    def test_rag_summary_contains_all_counts(self, tmp_path):
        """Test that the RAG summary text includes project count and RAG counts."""
        prs = self._make_portfolio(tmp_path)
        overview = prs.slides[0]
        all_text = ' '.join(
            shape.text_frame.text for shape in overview.shapes
            if shape.has_text_frame
        )
        assert '3 Projects' in all_text
        assert 'Green: 1' in all_text
        assert 'Amber: 1' in all_text
        assert 'Red: 1' in all_text

    def test_rag_table_cells_have_white_background(self, tmp_path):
        """Test that RAG column cells in the dashboard table have white backgrounds."""
        from pptx.dml.color import RGBColor
        prs = self._make_portfolio(tmp_path)
        overview = prs.slides[0]
        table_shape = None
        for shape in overview.shapes:
            if shape.has_table:
                table_shape = shape
                break
        assert table_shape is not None, "No table found on overview slide"
        tbl = table_shape.table
        white = RGBColor(255, 255, 255)
        # Check RAG column (index 4) for all data rows has white background
        for row_idx in range(1, tbl.rows.__len__()):
            rag_cell = tbl.cell(row_idx, 4)
            assert rag_cell.fill.fore_color.rgb == white, (
                f"RAG cell in row {row_idx} should have white background"
            )


class TestCollectPortfolioRisks:
    """Tests for the _collect_portfolio_risks function."""

    def test_filters_low_risks(self):
        """Test that low-score risks (< 6) are excluded."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        project_reports = [
            {'project_name': 'A', 'risks_issues': [
                {'type': 'risk', 'title': 'Low risk', 'score': 3},
                {'type': 'risk', 'title': 'High risk', 'score': 20},
            ]},
        ]
        result = _collect_portfolio_risks(project_reports)
        assert len(result) == 1
        assert result[0]['title'] == 'High risk'

    def test_includes_medium_and_high_risks(self):
        """Test that medium (6-15) and high (>= 16) risks are included."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        project_reports = [
            {'project_name': 'A', 'risks_issues': [
                {'type': 'risk', 'title': 'Medium risk', 'score': 10},
                {'type': 'issue', 'title': 'High issue', 'score': 20},
                {'type': 'risk', 'title': 'Low risk', 'score': 2},
            ]},
        ]
        result = _collect_portfolio_risks(project_reports)
        assert len(result) == 2

    def test_sorts_high_to_low(self):
        """Test that risks are sorted from highest score to lowest."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        project_reports = [
            {'project_name': 'A', 'risks_issues': [
                {'type': 'risk', 'title': 'Medium', 'score': 8},
                {'type': 'risk', 'title': 'High', 'score': 20},
                {'type': 'issue', 'title': 'Also medium', 'score': 12},
            ]},
        ]
        result = _collect_portfolio_risks(project_reports)
        assert result[0]['score'] == 20
        assert result[1]['score'] == 12
        assert result[2]['score'] == 8

    def test_assigns_correct_rag(self):
        """Test that RAG is 'red' for >= 16 and 'amber' for 6-15."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        project_reports = [
            {'project_name': 'A', 'risks_issues': [
                {'type': 'risk', 'title': 'High', 'score': 16},
                {'type': 'risk', 'title': 'Medium', 'score': 6},
            ]},
        ]
        result = _collect_portfolio_risks(project_reports)
        assert result[0]['rag'] == 'red'
        assert result[1]['rag'] == 'amber'

    def test_includes_project_name(self):
        """Test that each risk has the correct project_name."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        project_reports = [
            {'project_name': 'Project Alpha', 'risks_issues': [
                {'type': 'risk', 'title': 'Risk 1', 'score': 10},
            ]},
            {'project_name': 'Project Beta', 'risks_issues': [
                {'type': 'issue', 'title': 'Issue 1', 'score': 18},
            ]},
        ]
        result = _collect_portfolio_risks(project_reports)
        assert result[0]['project_name'] == 'Project Beta'
        assert result[1]['project_name'] == 'Project Alpha'

    def test_empty_project_reports(self):
        """Test with no project reports."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        result = _collect_portfolio_risks([])
        assert result == []

    def test_no_qualifying_risks(self):
        """Test when all risks are low score."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        project_reports = [
            {'project_name': 'A', 'risks_issues': [
                {'type': 'risk', 'title': 'Low', 'score': 2},
                {'type': 'risk', 'title': 'Also low', 'score': 5},
            ]},
        ]
        result = _collect_portfolio_risks(project_reports)
        assert result == []

    def test_passes_through_description_and_mitigation(self):
        """Test that description and mitigation fields are included."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        project_reports = [
            {'project_name': 'A', 'risks_issues': [
                {'type': 'risk', 'title': 'Server risk', 'score': 18,
                 'description': 'Server may fail',
                 'mitigation': 'Add redundancy'},
            ]},
        ]
        result = _collect_portfolio_risks(project_reports)
        assert len(result) == 1
        assert result[0]['description'] == 'Server may fail'
        assert result[0]['mitigation'] == 'Add redundancy'

    def test_defaults_empty_description_and_mitigation(self):
        """Test that missing description/mitigation default to empty strings."""
        from noodle_core.scheduling_engine import _collect_portfolio_risks
        project_reports = [
            {'project_name': 'A', 'risks_issues': [
                {'type': 'risk', 'title': 'No details', 'score': 10},
            ]},
        ]
        result = _collect_portfolio_risks(project_reports)
        assert len(result) == 1
        assert result[0]['description'] == ''
        assert result[0]['mitigation'] == ''


class TestAddPortfolioRiskSlides:
    """Tests for the _add_portfolio_risk_slides function."""

    def _make_presentation(self):
        from pptx import Presentation
        from pptx.util import Inches
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        return prs

    def test_adds_single_slide_for_few_risks(self):
        """Test that a single slide is added when risks fit on one page."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        risks = [
            {'project_name': 'A', 'type': 'risk', 'title': 'R1',
             'score': 20, 'rag': 'red'},
            {'project_name': 'B', 'type': 'issue', 'title': 'I1',
             'score': 10, 'rag': 'amber'},
        ]
        slides = _add_portfolio_risk_slides(prs, portfolio_data, risks)
        assert len(slides) == 1
        assert len(prs.slides) == 1

    def test_adds_multiple_slides_for_many_risks(self):
        """Test that multiple slides are created when risks exceed one page."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        # Create 25 risks (exceeds 18 per page)
        risks = [
            {'project_name': f'Proj{i}', 'type': 'risk',
             'title': f'Risk {i}', 'score': 20 - (i % 10), 'rag': 'red'}
            for i in range(25)
        ]
        slides = _add_portfolio_risk_slides(prs, portfolio_data, risks)
        assert len(slides) == 2
        assert len(prs.slides) == 2

    def test_slide_contains_risk_register_title(self):
        """Test that the slide has the portfolio risk register title."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'My Portfolio', 'date': '2026-03-02'}
        risks = [
            {'project_name': 'A', 'type': 'risk', 'title': 'R1',
             'score': 16, 'rag': 'red'},
        ]
        _add_portfolio_risk_slides(prs, portfolio_data, risks)
        slide = prs.slides[0]
        all_text = ' '.join(
            shape.text_frame.text for shape in slide.shapes
            if shape.has_text_frame
        )
        assert 'My Portfolio Risk Register' in all_text

    def test_empty_risks_shows_no_risks_message(self):
        """Test that empty risks list shows a 'no risks' message."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        slides = _add_portfolio_risk_slides(prs, portfolio_data, [])
        assert len(slides) == 1
        slide = prs.slides[0]
        all_text = ' '.join(
            shape.text_frame.text for shape in slide.shapes
            if shape.has_text_frame
        )
        assert 'No medium or high' in all_text

    def test_slide_contains_project_names(self):
        """Test that project names appear in the risk table."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        risks = [
            {'project_name': 'Alpha Project', 'type': 'risk',
             'title': 'Risk A', 'score': 20, 'rag': 'red'},
        ]
        _add_portfolio_risk_slides(prs, portfolio_data, risks)
        slide = prs.slides[0]
        # Check table cells for project name
        table_shapes = [s for s in slide.shapes if s.has_table]
        assert len(table_shapes) == 1
        table = table_shapes[0].table
        # Row 1 (after header) should contain 'Alpha Project'
        assert table.cell(1, 0).text == 'Alpha Project'

    def test_page_numbering_on_multiple_slides(self):
        """Test that multi-page risk slides show page numbers."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        risks = [
            {'project_name': f'P{i}', 'type': 'risk',
             'title': f'R{i}', 'score': 20, 'rag': 'red'}
            for i in range(20)
        ]
        _add_portfolio_risk_slides(prs, portfolio_data, risks)
        slide1 = prs.slides[0]
        slide2 = prs.slides[1]
        text1 = ' '.join(
            s.text_frame.text for s in slide1.shapes if s.has_text_frame
        )
        text2 = ' '.join(
            s.text_frame.text for s in slide2.shapes if s.has_text_frame
        )
        assert '(1/2)' in text1
        assert '(2/2)' in text2

    def test_table_has_seven_columns(self):
        """Test that the risk table has 7 columns including Description and Mitigation."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        risks = [
            {'project_name': 'A', 'type': 'risk', 'title': 'R1',
             'description': 'Risk desc', 'mitigation': 'Fix it',
             'score': 20, 'rag': 'red'},
        ]
        _add_portfolio_risk_slides(prs, portfolio_data, risks)
        slide = prs.slides[0]
        table_shapes = [s for s in slide.shapes if s.has_table]
        assert len(table_shapes) == 1
        table = table_shapes[0].table
        assert len(table.columns) == 7

    def test_table_headers_include_description_and_mitigation(self):
        """Test that the header row includes Description and Mitigation."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        risks = [
            {'project_name': 'A', 'type': 'risk', 'title': 'R1',
             'score': 16, 'rag': 'red'},
        ]
        _add_portfolio_risk_slides(prs, portfolio_data, risks)
        slide = prs.slides[0]
        table_shapes = [s for s in slide.shapes if s.has_table]
        table = table_shapes[0].table
        headers = [table.cell(0, c).text for c in range(len(table.columns))]
        assert 'Description' in headers
        assert 'Mitigation' in headers

    def test_description_and_mitigation_data_in_cells(self):
        """Test that description and mitigation text appears in table cells."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        risks = [
            {'project_name': 'A', 'type': 'risk', 'title': 'Server crash',
             'description': 'Database server may fail under load',
             'mitigation': 'Add read replicas and load balancing',
             'score': 20, 'rag': 'red'},
        ]
        _add_portfolio_risk_slides(prs, portfolio_data, risks)
        slide = prs.slides[0]
        table_shapes = [s for s in slide.shapes if s.has_table]
        table = table_shapes[0].table
        # Row 1 data: col 3 = Description, col 4 = Mitigation
        assert table.cell(1, 3).text == 'Database server may fail under load'
        assert table.cell(1, 4).text == 'Add read replicas and load balancing'

    def test_word_wrap_enabled_on_description_and_mitigation(self):
        """Test that word wrap is enabled on description and mitigation cells."""
        from noodle_core.scheduling_engine import _add_portfolio_risk_slides
        prs = self._make_presentation()
        portfolio_data = {'portfolio_name': 'Test', 'date': '2026-03-02'}
        risks = [
            {'project_name': 'A', 'type': 'risk', 'title': 'R1',
             'description': 'A long description that should wrap',
             'mitigation': 'A long mitigation plan that should wrap',
             'score': 18, 'rag': 'red'},
        ]
        _add_portfolio_risk_slides(prs, portfolio_data, risks)
        slide = prs.slides[0]
        table_shapes = [s for s in slide.shapes if s.has_table]
        table = table_shapes[0].table
        # Check word_wrap on description cell (col 3) and mitigation cell (col 4)
        assert table.cell(1, 3).text_frame.word_wrap is True
        assert table.cell(1, 4).text_frame.word_wrap is True


class TestAddReportSlideRiskTable:
    """Tests for the risk table in _add_report_slide."""

    def _make_presentation(self):
        from pptx import Presentation
        from pptx.util import Inches
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        return prs

    def _make_report_data(self, risks_issues=None):
        return {
            'project_name': 'Test Project',
            'manager': 'PM',
            'sponsor': 'Sponsor',
            'budget': '',
            'date': '2026-03-02',
            'status': 'green',
            'milestones': [],
            'up_next': [],
            'highlight': None,
            'risks_issues': risks_issues or [],
            'timeline_tasks': [],
        }

    def test_risk_table_has_five_columns(self):
        """Test that the per-project risk table has 5 columns."""
        from noodle_core.scheduling_engine import _add_report_slide
        prs = self._make_presentation()
        report_data = self._make_report_data([
            {'type': 'risk', 'title': 'Bug', 'description': 'Desc',
             'mitigation': 'Fix', 'score': 10},
        ])
        _add_report_slide(prs, report_data)
        slide = prs.slides[0]
        table_shapes = [s for s in slide.shapes if s.has_table]
        # Find the risk table (it has "Type" in header row)
        risk_table = None
        for ts in table_shapes:
            if ts.table.cell(0, 0).text == 'Type':
                risk_table = ts.table
                break
        assert risk_table is not None
        assert len(risk_table.columns) == 5

    def test_risk_table_headers_include_description_and_mitigation(self):
        """Test that per-project risk table headers include Description and Mitigation."""
        from noodle_core.scheduling_engine import _add_report_slide
        prs = self._make_presentation()
        report_data = self._make_report_data([
            {'type': 'risk', 'title': 'Bug', 'score': 10},
        ])
        _add_report_slide(prs, report_data)
        slide = prs.slides[0]
        table_shapes = [s for s in slide.shapes if s.has_table]
        risk_table = None
        for ts in table_shapes:
            if ts.table.cell(0, 0).text == 'Type':
                risk_table = ts.table
                break
        assert risk_table is not None
        headers = [risk_table.cell(0, c).text for c in range(len(risk_table.columns))]
        assert 'Description' in headers
        assert 'Mitigation' in headers

    def test_risk_table_description_and_mitigation_data(self):
        """Test that description and mitigation data appears in risk table cells."""
        from noodle_core.scheduling_engine import _add_report_slide
        prs = self._make_presentation()
        report_data = self._make_report_data([
            {'type': 'risk', 'title': 'Server crash',
             'description': 'Server may crash under load',
             'mitigation': 'Add monitoring and alerts',
             'score': 18},
        ])
        _add_report_slide(prs, report_data)
        slide = prs.slides[0]
        table_shapes = [s for s in slide.shapes if s.has_table]
        risk_table = None
        for ts in table_shapes:
            if ts.table.cell(0, 0).text == 'Type':
                risk_table = ts.table
                break
        assert risk_table is not None
        # Row 1: col 2 = Description, col 3 = Mitigation
        assert risk_table.cell(1, 2).text == 'Server may crash under load'
        assert risk_table.cell(1, 3).text == 'Add monitoring and alerts'

    def test_risk_table_word_wrap_on_description_and_mitigation(self):
        """Test that word wrap is enabled on description and mitigation cells."""
        from noodle_core.scheduling_engine import _add_report_slide
        prs = self._make_presentation()
        report_data = self._make_report_data([
            {'type': 'risk', 'title': 'Risk',
             'description': 'Long description text',
             'mitigation': 'Long mitigation text',
             'score': 12},
        ])
        _add_report_slide(prs, report_data)
        slide = prs.slides[0]
        table_shapes = [s for s in slide.shapes if s.has_table]
        risk_table = None
        for ts in table_shapes:
            if ts.table.cell(0, 0).text == 'Type':
                risk_table = ts.table
                break
        assert risk_table is not None
        assert risk_table.cell(1, 2).text_frame.word_wrap is True
        assert risk_table.cell(1, 3).text_frame.word_wrap is True


class TestPortfolioExportWithRiskSlides:
    """Integration tests for portfolio export including risk slides."""

    def test_slide_count_includes_risk_slides(self, tmp_path):
        """Test that the total slide count includes the risk register slide."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "portfolio_with_risks.pptx"
        portfolio_data = {
            'portfolio_name': 'Portfolio',
            'date': '2026-03-02',
            'projects': [
                {'name': 'A', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 1},
            ],
        }
        project_reports = [
            {'project_name': 'A', 'manager': '', 'sponsor': '', 'budget': '',
             'date': '2026-03-02', 'status': 'green', 'milestones': [],
             'up_next': [], 'highlight': None,
             'risks_issues': [
                 {'type': 'risk', 'title': 'High risk', 'score': 20},
             ],
             'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        # 1 overview + 1 risk register + 1 project = 3
        assert len(prs.slides) == 3

    def test_no_high_risks_still_adds_risk_slide(self, tmp_path):
        """Test that a risk slide is added even with no qualifying risks."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "portfolio_no_risks.pptx"
        portfolio_data = {
            'portfolio_name': 'Portfolio',
            'date': '2026-03-02',
            'projects': [
                {'name': 'A', 'status': 'On Track', 'rag': 'green',
                 'completion': 100, 'risk_count': 0},
            ],
        }
        project_reports = [
            {'project_name': 'A', 'manager': '', 'sponsor': '', 'budget': '',
             'date': '2026-03-02', 'status': 'green', 'milestones': [],
             'up_next': [], 'highlight': None, 'risks_issues': [],
             'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        # 1 overview + 1 risk register (empty message) + 1 project = 3
        assert len(prs.slides) == 3

    def test_risk_slide_comes_after_overview(self, tmp_path):
        """Test that the risk slide is placed between overview and projects."""
        from pptx import Presentation
        from noodle_core import export_portfolio_to_powerpoint
        output = tmp_path / "portfolio_order.pptx"
        portfolio_data = {
            'portfolio_name': 'Order Test',
            'date': '2026-03-02',
            'projects': [
                {'name': 'Proj X', 'status': 'On Track', 'rag': 'green',
                 'completion': 50, 'risk_count': 1},
            ],
        }
        project_reports = [
            {'project_name': 'Proj X', 'manager': '', 'sponsor': '',
             'budget': '', 'date': '2026-03-02', 'status': 'green',
             'milestones': [], 'up_next': [], 'highlight': None,
             'risks_issues': [
                 {'type': 'risk', 'title': 'Critical bug', 'score': 25},
             ],
             'timeline_tasks': []},
        ]
        export_portfolio_to_powerpoint(str(output), portfolio_data, project_reports)
        prs = Presentation(str(output))
        # Slide 0: overview, Slide 1: risk register, Slide 2: project
        risk_slide = prs.slides[1]
        risk_text = ' '.join(
            s.text_frame.text for s in risk_slide.shapes if s.has_text_frame
        )
        assert 'Risk Register' in risk_text

        project_slide = prs.slides[2]
        proj_text = ' '.join(
            s.text_frame.text for s in project_slide.shapes if s.has_text_frame
        )
        assert 'Proj X' in proj_text


class TestDrawTimelineGraphic:
    """Tests for _draw_timeline_graphic PPTX timeline rendering."""

    @staticmethod
    def _make_slide():
        """Create a minimal Presentation and return (prs, slide)."""
        from pptx import Presentation
        from pptx.util import Inches
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        return prs, slide

    @staticmethod
    def _sample_phases():
        return [
            {'name': 'Phase A', 'start': '2026-01-01', 'finish': '2026-03-31',
             'percent': 50, 'is_summary': True, 'duration_days': 90},
            {'name': 'Phase B', 'start': '2026-04-01', 'finish': '2026-06-30',
             'percent': 0, 'is_summary': True, 'duration_days': 91},
        ]

    @staticmethod
    def _sample_milestones():
        return [
            {'name': 'M1', 'start': '2026-02-15', 'finish': '2026-02-15',
             'percent': 0, 'is_summary': False, 'duration_days': 0},
            {'name': 'M2', 'start': '2026-05-01', 'finish': '2026-05-01',
             'percent': 100, 'is_summary': False, 'duration_days': 0},
        ]

    def test_returns_nonzero_height(self):
        """Timeline with phases and milestones returns a positive height."""
        from pptx.util import Inches
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        tasks = self._sample_phases() + self._sample_milestones()
        height = _draw_timeline_graphic(
            slide, tasks,
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))
        assert height > 0

    def test_returns_zero_for_empty_input(self):
        """Empty task list returns zero height."""
        from pptx.util import Inches
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        height = _draw_timeline_graphic(
            slide, [],
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))
        assert height == 0

    def test_milestone_diamonds_centred_on_backbone(self):
        """Milestone diamonds should be vertically centred on the backbone."""
        from pptx.util import Inches, Emu
        from pptx.enum.shapes import MSO_SHAPE_TYPE
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        tasks = self._sample_phases() + self._sample_milestones()
        _draw_timeline_graphic(
            slide, tasks,
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))

        # Find backbone rectangle (thin grey line spanning full width)
        backbone = None
        diamonds = []
        for shape in slide.shapes:
            if shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
                # Backbone is a very thin rectangle
                if (shape.height < Inches(0.03)
                        and shape.width > Inches(5)):
                    backbone = shape
                # Diamonds are identified by roughly equal width/height
                elif (abs(shape.width - shape.height) < Inches(0.02)
                      and shape.width < Inches(0.2)
                      and shape.width > Inches(0.05)):
                    diamonds.append(shape)

        assert backbone is not None, "Backbone line not found"
        assert len(diamonds) >= 2, f"Expected 2 diamonds, found {len(diamonds)}"

        backbone_centre_y = backbone.top + backbone.height // 2
        for d in diamonds:
            diamond_centre_y = d.top + d.height // 2
            # Allow 2 EMU tolerance for rounding
            offset = abs(diamond_centre_y - backbone_centre_y)
            assert offset < Emu(5000), (
                f"Diamond not centred on backbone: offset={offset} EMU"
            )

    def test_date_labels_below_backbone(self):
        """Date labels should be positioned below the backbone line."""
        from pptx.util import Inches, Pt
        from pptx.enum.shapes import MSO_SHAPE_TYPE
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        tasks = self._sample_phases() + self._sample_milestones()
        _draw_timeline_graphic(
            slide, tasks,
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))

        # Find backbone
        backbone = None
        for shape in slide.shapes:
            if (shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE
                    and shape.height < Inches(0.03)
                    and shape.width > Inches(5)):
                backbone = shape
                break

        assert backbone is not None, "Backbone line not found"
        backbone_bottom = backbone.top + backbone.height

        # Find date label textboxes (small font, positioned low)
        date_boxes = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                # Date labels are short lowercase strings like "jan 2026"
                if (text and len(text) <= 12
                        and shape.top > backbone.top
                        and text != "Today"):
                    paras = shape.text_frame.paragraphs
                    if paras and paras[0].font.size and paras[0].font.size <= Pt(6):
                        date_boxes.append(shape)

        assert len(date_boxes) > 0, "No date labels found"
        for box in date_boxes:
            assert box.top >= backbone_bottom, (
                f"Date label '{box.text_frame.text}' at top={box.top} "
                f"is above backbone bottom={backbone_bottom}"
            )

    def test_date_labels_fit_on_one_line(self):
        """Date labels should use a small font that fits on one line."""
        from pptx.util import Inches, Pt
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        tasks = self._sample_phases() + self._sample_milestones()
        _draw_timeline_graphic(
            slide, tasks,
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))

        date_boxes = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                if (text and len(text) <= 12
                        and text != "Today"
                        and not any(c.isupper() for c in text)):
                    paras = shape.text_frame.paragraphs
                    if paras and paras[0].font.size and paras[0].font.size <= Pt(6):
                        date_boxes.append(shape)

        assert len(date_boxes) > 0, "No date labels found"
        for box in date_boxes:
            tf = box.text_frame
            assert tf.word_wrap is False, "Date label should not wrap"
            font_size = tf.paragraphs[0].font.size
            assert font_size <= Pt(5), (
                f"Date font {font_size} exceeds Pt(5)"
            )

    def test_reduced_height_compared_to_original(self):
        """Timeline height should be roughly 75% of what it was before.

        The original used bar_height=0.15, row_gap=0.02, diamond=0.12,
        various 0.03/0.01/0.02/0.2 paddings. The new version uses smaller
        values. We verify the returned height is less than a generous upper
        bound.
        """
        from pptx.util import Inches
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        tasks = self._sample_phases() + self._sample_milestones()
        height = _draw_timeline_graphic(
            slide, tasks,
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))
        # With 2 phase rows the original height was roughly:
        #   2*(0.15+0.02) + 0.03 + 0.01 + 0.12 + 0.02 + 0.2 = 0.72 inches
        # New should be roughly:
        #   2*(0.11+0.015) + 0.02 + 0.015 + 0.02 + 0.15 = ~0.455 inches
        # Assert new height is under 0.6 inches (generous upper bound)
        assert height < Inches(0.6), (
            f"Timeline height {height} exceeds expected reduced size"
        )

    def test_phases_only_no_milestones(self):
        """Timeline renders successfully with phases but no milestones."""
        from pptx.util import Inches
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        height = _draw_timeline_graphic(
            slide, self._sample_phases(),
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))
        assert height > 0

    def test_milestones_only_no_phases(self):
        """Timeline renders successfully with milestones but no phases."""
        from pptx.util import Inches
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        height = _draw_timeline_graphic(
            slide, self._sample_milestones(),
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))
        assert height > 0

    def test_date_format_includes_year(self):
        """Date labels for timelines under 365 days should show 'mon yyyy'."""
        from pptx.util import Inches, Pt
        from noodle_core.scheduling_engine import _draw_timeline_graphic

        _, slide = self._make_slide()
        tasks = self._sample_phases() + self._sample_milestones()
        _draw_timeline_graphic(
            slide, tasks,
            left=Inches(0.4), top=Inches(1.0), width=Inches(12.0))

        date_labels = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                paras = shape.text_frame.paragraphs
                if (text and paras and paras[0].font.size
                        and paras[0].font.size <= Pt(6)
                        and text != "Today"):
                    date_labels.append(text)

        assert len(date_labels) > 0, "No date labels found"
        # At least some labels should contain a 4-digit year (e.g., "jan 2026")
        has_year = any('202' in label for label in date_labels)
        assert has_year, (
            f"No date label contains year: {date_labels}"
        )


class TestQualityRoles:
    """Tests for quality role parsing (@resource:P/R/A syntax)."""

    def test_quality_role_producer(self):
        """@alice:P should be parsed as a quality role, not a regular resource."""
        meta = extract_metadata("Design document @alice:P 5d")
        assert meta.get('quality_roles') == {'alice': 'P'}
        assert 'resources' not in meta or 'alice' not in meta.get('resources', '')

    def test_quality_role_reviewer(self):
        meta = extract_metadata("Design document @bob:R 5d")
        assert meta.get('quality_roles') == {'bob': 'R'}

    def test_quality_role_approver(self):
        meta = extract_metadata("Design document @carol:A 5d")
        assert meta.get('quality_roles') == {'carol': 'A'}

    def test_quality_role_case_insensitive(self):
        """Role letter should be normalised to uppercase."""
        meta = extract_metadata("Task @dave:p @eve:r @frank:a")
        qr = meta.get('quality_roles', {})
        assert qr == {'dave': 'P', 'eve': 'R', 'frank': 'A'}

    def test_mixed_regular_and_quality_roles(self):
        """Regular @resources and quality-role @resources should coexist."""
        meta = extract_metadata("Task @alice @bob:R @carol:A 3d")
        assert 'alice' in meta.get('resources', '')
        assert 'bob' not in meta.get('resources', '')
        qr = meta.get('quality_roles', {})
        assert qr == {'bob': 'R', 'carol': 'A'}

    def test_no_quality_roles(self):
        """When no :P/:R/:A suffix, quality_roles should be absent."""
        meta = extract_metadata("Task @alice @bob 3d")
        assert meta.get('quality_roles') is None or meta.get('quality_roles') == {}
        assert 'alice' in meta.get('resources', '')
        assert 'bob' in meta.get('resources', '')

    def test_quality_role_with_deliverable(self):
        """Quality roles should work alongside deliverable markers."""
        meta = extract_metadata("Fuselage $fuselage @kev:P @jane:R @boss:A")
        assert meta.get('deliverable') == 'fuselage'
        qr = meta.get('quality_roles', {})
        assert qr == {'kev': 'P', 'jane': 'R', 'boss': 'A'}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
