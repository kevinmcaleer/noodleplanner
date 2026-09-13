"""#783's headline criterion, checked against the *server* scheduler.

    "A first-time user can produce a valid, schedulable 20-task plan
     without ever seeing Markdown syntax."

``tests/test_first_time_plan.mjs`` is the other half of this: it builds the
plan by typing plain prose into the notepad surface (#1049), estimating
every task through the three-point popup (#1053) and asserting that the
result is byte-for-byte ``tests/fixtures/first_time_plan.md``. Nothing in
that flow ever types a duration, a resource, a tag, a dependency or a date.

This module takes the same fixture and puts it through the real server
path -- ``PlanService.parse``, i.e. the scheduler the app actually runs --
so "schedulable" is asserted against both engines rather than only the
browser's. The fixture is the contract between the two files: regenerating
it without re-running both is what these tests exist to catch.
"""

from datetime import date, timedelta
from pathlib import Path

import pytest

from noodle_web.plan_service import PlanService

REPO = Path(__file__).resolve().parent.parent
FIXTURE = REPO / "tests" / "fixtures" / "first_time_plan.md"

# The sixteen leaf tasks, in document order; the four phases above them are
# summaries, whose dates roll up from their children.
LEAF_TASKS = [
    "Kick-off workshop",
    "Interview the team",
    "Write up what we found",
    "Agree the scope",
    "Draft the approach",
    "Review with stakeholders",
    "Revise the approach",
    "Sign off the design",
    "Set up the environment",
    "Build the first slice",
    "Build the rest",
    "Internal demo",
    "User testing",
    "Fix what testing found",
    "Train the users",
    "Go live",
]
PHASES = ["Discovery", "Design", "Build", "Launch"]


@pytest.fixture
def plan_text():
    return FIXTURE.read_text()


@pytest.fixture
def parsed(plan_text):
    return PlanService().parse(plan_text)


class TestFirstTimePlanSchedules:
    """The plan a first-time user produces is a real, schedulable plan."""

    def test_the_fixture_contains_no_syntax_a_user_had_to_type(self, plan_text):
        # Everything below the front matter and above the ---estimates---
        # section should be prose plus the duration the estimating popup
        # wrote -- no @resources, #tags, [depends] or hand-typed dates.
        body = plan_text.split("---estimates---")[0].split("---\n", 2)[2]
        for line in body.splitlines():
            if not line.strip():
                continue
            assert "@" not in line, line
            assert "#" not in line, line
            assert "[depends" not in line, line

    def test_all_twenty_tasks_are_parsed(self, parsed):
        names = [task["name"] for task in parsed.tasks]
        assert len(names) == 20
        for name in PHASES + LEAF_TASKS:
            assert name in names

    def test_every_task_is_scheduled_with_real_dates(self, parsed):
        for task in parsed.tasks:
            assert task["start"], f"{task['name']} has no start date"
            assert task["finish"], f"{task['name']} has no finish date"

    def test_the_plan_starts_today_since_no_task_pins_a_date(self, parsed):
        # Nothing in this plan carries an explicit start date -- a
        # first-time user typed prose and estimated it, nothing more -- so
        # the scheduler starts it from today. (`start date` in front matter
        # is informational and deliberately does not move tasks; see
        # docs/reference/plan-format.rst.)
        #
        # "Today" is read from the same module the scheduler reads it from
        # rather than from date.today(), so this holds under a frozen clock
        # too (scripts/build_conformance_corpus.py freezes exactly these).
        from noodle_core import date_math

        today = date_math.datetime.now().date()
        first = next(t for t in parsed.tasks if t["name"] == "Kick-off workshop")
        assert first["start"] >= today.isoformat()
        # ...and no later than the following Monday, if today is a weekend.
        assert first["start"] <= (today + timedelta(days=2)).isoformat()

    def test_phases_roll_up_over_their_own_children(self, parsed):
        by_name = {task["name"]: task for task in parsed.tasks}
        for phase in PHASES:
            assert by_name[phase]["is_summary"] is True
        # Nothing in this plan declares a dependency, so a phase's tasks all
        # start together and the phase spans exactly that one block.
        for name in LEAF_TASKS[:4]:
            assert by_name["Discovery"]["start"] == by_name[name]["start"]
            assert by_name["Discovery"]["finish"] == by_name[name]["finish"]

    def test_the_estimating_section_is_not_parsed_as_tasks(self, parsed):
        # The three raw estimate inputs live in an ---estimates--- back-matter
        # section (#1053). Back matter must stay out of the task list --
        # otherwise every table row would schedule as a task.
        names = [task["name"] for task in parsed.tasks]
        assert not any("Optimistic" in name for name in names)
        assert not any(name.startswith("|") for name in names)

    def test_no_task_carries_a_scheduling_conflict(self, parsed):
        for task in parsed.tasks:
            assert not task.get("loop_warning"), task
            assert not task.get("circular_dependencies"), task


class TestFirstTimePlanDeadlines:
    """The Scheduling stage's question: what breaks against a deadline?"""

    @staticmethod
    def _with_go_live_deadline(plan_text, offset_days):
        """The fixture with a deadline `offset_days` from Go live's own
        scheduled finish. The plan pins no start date, so it schedules from
        today -- a hard-coded deadline would mean something different every
        time this ran."""
        assert "  Go live 4d\n" in plan_text
        finish = next(
            t for t in PlanService().parse(plan_text).tasks if t["name"] == "Go live"
        )["finish"]
        deadline = date.fromisoformat(finish) + timedelta(days=offset_days)
        # What the task form writes when a deadline is entered (#877).
        marked = plan_text.replace(
            "  Go live 4d\n", f"  Go live 4d D{deadline.isoformat()}\n"
        )
        return marked, deadline.isoformat()

    def test_an_unreachable_deadline_turns_the_task_red(self, plan_text):
        with_deadline, deadline = self._with_go_live_deadline(plan_text, -2)

        parsed = PlanService().parse(with_deadline)
        go_live = next(t for t in parsed.tasks if t["name"] == "Go live")
        assert go_live["deadline"] == deadline
        assert go_live["finish"] > deadline, "this plan genuinely cannot hit that deadline"
        # calculate_rag_status's deadline branch -- the same judgement
        # static/schedule-check.js reports in the wizard's Scheduling stage.
        assert go_live["rag"] == "Task Overdue"

    def test_an_achievable_deadline_leaves_the_task_alone(self, plan_text):
        with_deadline, deadline = self._with_go_live_deadline(plan_text, 30)
        parsed = PlanService().parse(with_deadline)
        go_live = next(t for t in parsed.tasks if t["name"] == "Go live")
        assert go_live["deadline"] == deadline
        # Compared against the same plan with no deadline at all, rather
        # than against a literal status: a 0%-complete task that has already
        # started is "Task Overdue" on its own account, deadline or not, so
        # the thing worth asserting is that the deadline changed nothing.
        baseline = next(
            t for t in PlanService().parse(plan_text).tasks if t["name"] == "Go live"
        )
        assert go_live["rag"] == baseline["rag"]

    def test_a_deadline_never_moves_the_dates_it_judges(self, plan_text):
        before = {t["name"]: (t["start"], t["finish"]) for t in PlanService().parse(plan_text).tasks}
        with_deadline, _ = self._with_go_live_deadline(plan_text, -2)
        after = {t["name"]: (t["start"], t["finish"]) for t in PlanService().parse(with_deadline).tasks}
        assert before == after


class TestFirstTimePlanRoundTrip:
    """#783's definition of done: no regression in the Markdown round-trip."""

    def test_parsing_the_plan_does_not_rewrite_it(self, plan_text):
        result = PlanService().parse(plan_text)
        updated = getattr(result, "updated_plan_text", None)
        # The service's only write-back is the `labels:` front-matter line,
        # and this plan has no labels, so nothing should move.
        assert updated in (None, "", plan_text)
