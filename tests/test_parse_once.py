"""The hot path does its work once (issue #789).

``POST /api/parse`` runs on essentially every plan edit. It used to build an
ASCII table nobody reads, which scheduled the whole plan a second time, and
the summary roll-up rescanned the task list for every summary. These tests
pin the fixed behaviour:

* ``/api/parse`` does not build ``ascii_output`` unless asked; ``/render``
  still does, and the editor output pane is unchanged.
* One parse schedules the plan exactly once and tokenises each task line
  exactly once, asserted by counting calls.
* The optimised summary roll-up and ordering produce exactly what the
  straightforward per-summary scan produced, over the real corpus.
"""

import glob
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from noodle_core import scheduling_engine
from noodle_core import metadata as metadata_module
from noodle_web import app
from noodle_web import plan_service as plan_service_module
from noodle_web.plan_service import PlanService

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
from benchmark_parse import make_plan  # noqa: E402

CORPUS = sorted(glob.glob(str(REPO / "templates" / "*" / "plan.md"))) + sorted(
    glob.glob(str(REPO / "tests" / "fixtures" / "roundtrip" / "*.md"))
)

PLAN = """---
title: Once
---
Phase A
  Task 1 @kev 3d #a
  *Task 2 2d
  Sub phase
    Task 3 1d [depends Task 1]
    *Task 4 0d
Phase B [depends Phase A]
  *Task 5 5d @adam 50%
"""


@pytest.fixture
def client():
    from noodle_web.security import reset_rate_limit_store

    reset_rate_limit_store()
    return TestClient(app)


class TestAsciiIsOptIn:
    def test_api_parse_omits_the_ascii_table_by_default(self, client):
        data = client.post("/api/parse", json={"plan_text": PLAN}).json()
        assert data["success"]
        assert data["ascii_output"] == ""
        assert len(data["tasks"]) == 8

    def test_api_parse_builds_it_on_request(self, client):
        data = client.post("/api/parse", json={"plan_text": PLAN, "include_ascii": True}).json()
        assert "Task 1" in data["ascii_output"]

    def test_render_still_returns_the_table(self, client):
        data = client.post("/render", json={"plan_text": PLAN}).json()
        assert "Task 1" in data["ascii_output"]


class TestWorkHappensOnce:
    def test_plan_is_scheduled_exactly_once_per_parse(self):
        service = PlanService()
        with patch.object(
            plan_service_module, "schedule_tasks", wraps=plan_service_module.schedule_tasks
        ) as schedule, patch.object(
            plan_service_module,
            "natural_language_to_yaml",
            wraps=plan_service_module.natural_language_to_yaml,
        ) as to_yaml:
            result = service.parse(PLAN)
        assert result.success
        assert schedule.call_count == 1
        assert to_yaml.call_count == 1

    def test_each_task_line_is_tokenised_once(self):
        service = PlanService()
        with patch.object(
            scheduling_engine, "extract_metadata", wraps=scheduling_engine.extract_metadata
        ) as extract:
            result = service.parse(PLAN)
        leaves = [t for t in result.tasks if not t["is_summary"]]
        summaries_with_details = 1  # "Phase B [depends Phase A]" carries metadata
        assert extract.call_count == len(leaves) + summaries_with_details

    def test_ascii_table_is_built_only_on_request(self):
        """The table builder (which schedules the plan again internally) runs
        once when asked and never otherwise."""
        service = PlanService()
        with patch.object(
            plan_service_module,
            "text_to_markdown_table",
            wraps=plan_service_module.text_to_markdown_table,
        ) as table:
            service.parse(PLAN)
            assert table.call_count == 0
            service.parse(PLAN, include_ascii=True)
            assert table.call_count == 1


def _reference_rollup_and_order(all_tasks):
    """The pre-#789 algorithm: rescan per summary, recurse without memo."""
    tasks = [dict(t) for t in all_tasks]

    def calc(task_name):
        children = [t for t in tasks if t.get("parent") == task_name]
        if not children:
            return
        for child in children:
            if child.get("summary"):
                calc(child["name"])
        summary_task = next(
            (t for t in tasks if t.get("name") == task_name and t.get("summary")), None
        )
        if not summary_task:
            return
        starts = [c["start"] for c in children if "start" in c]
        finishes = [c["finish"] for c in children if "finish" in c]
        if starts and finishes:
            summary_task["start"] = min(starts)
            summary_task["finish"] = max(finishes)
            summary_task["duration"] = summary_task["finish"] - summary_task["start"]
        percents = [c.get("percent", 0) for c in children if not c.get("summary")]
        if not percents:
            percents = [c.get("percent", 0) for c in children]
        if percents:
            summary_task["percent"] = int(sum(percents) / len(percents))

    for t in tasks:
        if t.get("summary"):
            calc(t["name"])

    ordered, processed = [], set()

    def add(task):
        if "name" not in task or task["name"] in processed:
            return
        processed.add(task["name"])
        ordered.append(task)
        if task.get("summary"):
            for child in [t for t in tasks if t.get("parent") == task["name"]]:
                add(child)

    for task in [t for t in tasks if not t.get("parent")]:
        add(task)
    return [(t["name"], t.get("start"), t.get("finish"), t.get("percent")) for t in ordered]


class TestSummaryRollupIsUnchanged:
    """The indexed roll-up must match the old rescanning one on real plans,
    including duplicate summary names and nested phases."""

    @pytest.mark.parametrize("path", CORPUS, ids=[str(Path(p).relative_to(REPO)) for p in CORPUS])
    def test_corpus_plan(self, path):
        self._check(Path(path).read_text(encoding="utf-8"))

    def test_large_generated_plan(self):
        self._check(make_plan(20))

    def test_duplicate_summary_names(self):
        self._check("Definition\n  Task A 3d\n  *Task B 2d\nDefinition\n  Task C 2d\n  *Task D 1d\n")

    def _check(self, plan_text):
        # Capture the scheduler's task list before roll-up by running the
        # engine and comparing its final ordering against the reference
        # algorithm applied to the same leaf data.
        result = PlanService().parse(plan_text)
        assert result.success
        actual = [(t["name"], t["start"], t["finish"], t["percent"]) for t in result.tasks]

        # Rebuild the same leaf/summary list through the engine's own parser,
        # then roll up with the reference implementation.
        from noodle_core.format_converter import convert_plan_format_to_standard
        from noodle_core.scheduling_engine import natural_language_to_yaml

        converted = convert_plan_format_to_standard(plan_text)
        phases = natural_language_to_yaml(converted, result.project_name)[result.project_name]
        phases = phases if isinstance(phases, list) else [phases]
        engine_tasks = scheduling_engine.schedule_tasks(phases)
        expected = [
            (name, start.strftime("%Y-%m-%d") if start else "", finish.strftime("%Y-%m-%d") if finish else "", percent)
            for name, start, finish, percent in _reference_rollup_and_order(engine_tasks)
        ]
        actual = [(t["key"], t["start"], t["finish"], t["percent"]) for t in result.tasks]

        assert [a[0] for a in actual] == [e[0] for e in expected], "task order differs"
        assert [a[1:3] for a in actual] == [e[1:3] for e in expected], "dates differ"
        # summaries carry the rolled-up percent; compare those exactly
        summary_keys = {t["key"] for t in result.tasks if t["is_summary"]}
        assert [a[3] for a in actual if a[0] in summary_keys] == [
            e[3] for e in expected if e[0] in summary_keys
        ], "rolled-up percents differ"
