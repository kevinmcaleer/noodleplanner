"""Tests for resource levelling markdown flag parsing (issue #681).

The levelling flag has the form `[levelled @<shortname> <YYYY-MM-DD>]` and is
appended inline to task lines by the UI "Level Resources" action. The backend
scheduler recognises the flag and uses the date inside it as the task's
effective start date. "Clear Levelling" strips all such flags from a plan.
"""

from datetime import datetime

from noodle_core import extract_metadata, schedule_tasks, natural_language_to_yaml


class TestLevelledFlagParsing:
    """Unit tests for extract_metadata's handling of [levelled] flag."""

    def test_levelled_flag_sets_start_date(self):
        meta = extract_metadata(
            "DesignReview 3d @alice [levelled @alice 2026-05-18]",
            task_name="DesignReview",
        )
        assert meta.get("levelled") == {
            "resource": "alice",
            "start": "2026-05-18",
        }
        assert meta.get("start") == datetime(2026, 5, 18)
        assert meta.get("due") == "2026-05-18"

    def test_levelled_flag_overrides_other_date_in_line(self):
        # Task has an original date AND a levelling flag — the levelled date wins.
        meta = extract_metadata(
            "DesignReview 2026-04-01 3d @alice [levelled @alice 2026-05-18]",
            task_name="DesignReview",
        )
        assert meta["start"] == datetime(2026, 5, 18)
        assert meta["due"] == "2026-05-18"

    def test_levelled_flag_accepts_no_at_sign(self):
        meta = extract_metadata(
            "Task1 3d @bob [levelled bob 2026-06-01]",
            task_name="Task1",
        )
        assert meta["levelled"]["resource"] == "bob"
        assert meta["start"] == datetime(2026, 6, 1)

    def test_line_without_levelled_flag_behaves_as_before(self):
        meta = extract_metadata(
            "Task1 2026-04-01 3d @alice",
            task_name="Task1",
        )
        assert "levelled" not in meta
        assert meta["start"] == datetime(2026, 4, 1)


class TestLevelledTaskInSchedule:
    """End-to-end: a task with [levelled ...] should schedule at the flag date."""

    def test_scheduler_honours_levelled_start(self):
        # Use a minimal plan body (no frontmatter) and feed it directly.
        plan = (
            "Project:\n"
            "  Phase:\n"
            "    TaskOne 5d @alice [levelled @alice 2026-07-06]\n"
        )
        yaml_data = natural_language_to_yaml(plan, "Project")
        phases = yaml_data["Project"]
        if isinstance(phases, dict):
            phases = [phases]
        tasks = schedule_tasks(phases)
        leaf = [t for t in tasks
                if not t.get("summary") and t.get("name") == "TaskOne"]
        assert len(leaf) == 1
        # Task should start on the levelled date (a Monday in this case)
        assert leaf[0]["start"].date() == datetime(2026, 7, 6).date()


class TestStripLevellingFlagsPython:
    """Sanity: a plain regex can strip flags from plan text (parallels the
    frontend implementation).
    """

    def test_strip_single_flag(self):
        import re
        line = "TaskOne 3d @alice [levelled @alice 2026-05-18]"
        cleaned = re.sub(
            r"\s*\[levelled\s+@?\S+\s+\d{4}-\d{2}-\d{2}\s*\]",
            "",
            line,
        )
        assert cleaned == "TaskOne 3d @alice"

    def test_strip_multiple_flags(self):
        import re
        text = (
            "TaskOne 3d @alice [levelled @alice 2026-05-18]\n"
            "TaskTwo 2d @bob [levelled @bob 2026-05-22]\n"
        )
        cleaned = re.sub(
            r"\s*\[levelled\s+@?\S+\s+\d{4}-\d{2}-\d{2}\s*\]",
            "",
            text,
        )
        assert "[levelled" not in cleaned
        assert "TaskOne 3d @alice" in cleaned
        assert "TaskTwo 2d @bob" in cleaned
