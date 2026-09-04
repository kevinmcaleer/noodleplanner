"""Markdown is the canonical, lossless plan format (issue #771).

The guarantee under test, as written in docs/reference/plan-format.rst:

* Opening a plan and saving it without edits leaves every byte as it was,
  except for the front-matter keys the app itself maintains (``labels``,
  ``rag``, ``version``, ``last_saved``).
* Each of those keys is changed by a single-line, in-place edit that touches
  nothing else, and re-applying the edit changes nothing.

The server's only write-back is the ``labels:`` line, returned by
``PlanService.parse`` as ``updated_plan_text`` and applied to the editor by
the page. This module runs a corpus of real plans (every bundled template
plus hand-written edge cases) through ``parse`` and checks that nothing
else moves. The browser-side writers are covered by
tests/test_markdown_roundtrip.mjs. Both run in CI
(.github/workflows/markdown-roundtrip.yml).
"""

import difflib
from pathlib import Path

import pytest

from noodle_web.plan_service import PlanService, update_front_matter_with_labels

REPO = Path(__file__).resolve().parent.parent
TEMPLATE_PLANS = sorted((REPO / "templates").glob("*/plan.md"))
FIXTURE_PLANS = sorted((REPO / "tests" / "fixtures" / "roundtrip").glob("*.md"))
CORPUS = TEMPLATE_PLANS + FIXTURE_PLANS

assert TEMPLATE_PLANS, "no bundled templates found under templates/*/plan.md"
assert FIXTURE_PLANS, "no fixtures found under tests/fixtures/roundtrip/"

APP_MAINTAINED_KEYS = ("labels", "rag", "version", "last_saved")


def _ids(paths):
    return [str(p.relative_to(REPO)) for p in paths]


def _diff(before: str, after: str) -> str:
    return "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True), after.splitlines(keepends=True),
            "before", "after", n=1,
        )
    )


def _changed_lines(before: str, after: str):
    """(removed, added) line lists, so a change can be pinned to one key."""
    matcher = difflib.SequenceMatcher(a=before.split("\n"), b=after.split("\n"), autojunk=False)
    removed, added = [], []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            continue
        removed.extend(before.split("\n")[i1:i2])
        added.extend(after.split("\n")[j1:j2])
    return removed, added


@pytest.fixture(scope="module")
def service():
    return PlanService()


@pytest.mark.parametrize("path", CORPUS, ids=_ids(CORPUS))
def test_parse_reads_the_whole_corpus(service, path):
    """Every plan in the corpus is a valid plan; a broken fixture proves nothing."""
    result = service.parse(path.read_text(encoding="utf-8"))
    assert result.success, result.error
    assert result.tasks, f"{path.name} parsed to no tasks"


@pytest.mark.parametrize("path", CORPUS, ids=_ids(CORPUS))
def test_parse_does_not_rewrite_an_unedited_plan(service, path):
    """The server hands back the plan byte-for-byte, or changes only ``labels:``."""
    text = path.read_text(encoding="utf-8")
    result = service.parse(text)

    if result.updated_plan_text is None or result.updated_plan_text == text:
        return

    removed, added = _changed_lines(text, result.updated_plan_text)
    assert len(added) == 1 and len(removed) <= 1, (
        "parse changed more than the labels line:\n" + _diff(text, result.updated_plan_text)
    )
    assert added[0].startswith("labels:"), _diff(text, result.updated_plan_text)
    if removed:
        assert removed[0].startswith("labels:"), _diff(text, result.updated_plan_text)

    # and only because the plan used a #tag the front matter did not list
    again = service.parse(result.updated_plan_text)
    assert again.updated_plan_text in (None, result.updated_plan_text), (
        "a second parse should be a fixed point:\n"
        + _diff(result.updated_plan_text, again.updated_plan_text)
    )


@pytest.mark.parametrize("path", TEMPLATE_PLANS, ids=_ids(TEMPLATE_PLANS))
def test_bundled_templates_are_fixed_points(service, path):
    """The templates ship with a complete ``labels:`` line, so nothing at all
    changes when one is opened."""
    text = path.read_text(encoding="utf-8")
    result = service.parse(text)
    assert result.updated_plan_text in (None, text), _diff(text, result.updated_plan_text)


class TestLabelsLineIsMinimal:
    """``labels:`` is the one line the server may write; it must write it as
    narrowly as possible."""

    def test_complete_line_is_left_verbatim_whatever_its_order_or_case(self):
        plan = "---\ntitle: T\nlabels: [Zeta,  alpha ,BETA]\n---\nTask 1d #beta #zeta #Alpha\n"
        assert update_front_matter_with_labels(plan, {"beta", "zeta", "alpha"}) == plan

    def test_missing_labels_are_appended_to_the_existing_list(self):
        plan = "---\ntitle: T\nlabels: [Existing]\n---\nTask 1d #existing #newtag\n"
        out = update_front_matter_with_labels(plan, {"existing", "newtag"})
        assert out == "---\ntitle: T\nlabels: [Existing, newtag]\n---\nTask 1d #existing #newtag\n"
        assert update_front_matter_with_labels(out, {"existing", "newtag"}) == out

    def test_absent_line_is_added_as_the_last_key(self):
        plan = "---\ntitle: T\nsponsor: S\n---\nTask 1d #x\n"
        out = update_front_matter_with_labels(plan, {"x"})
        assert out == "---\ntitle: T\nsponsor: S\nlabels: [x]\n---\nTask 1d #x\n"

    def test_no_front_matter_gains_only_a_labels_block(self):
        plan = "Task 1d #x\n"
        out = update_front_matter_with_labels(plan, {"x"})
        assert out == "---\nlabels: [x]\n---\nTask 1d #x\n"
        assert update_front_matter_with_labels(out, {"x"}) == out

    def test_nothing_else_moves(self):
        plan = "---\ntitle:   spaced   \nlabels: [a]\nweird_key: 'quoted'\n---\n\n\nTask 1d #a #b   \n"
        out = update_front_matter_with_labels(plan, {"a", "b"})
        removed, added = _changed_lines(plan, out)
        assert removed == ["labels: [a]"]
        assert added == ["labels: [a, b]"]


class TestCorpusExercisesTheFormat:
    """The kitchen-sink fixture must keep covering the whole grammar, or the
    round-trip guarantee is being tested against a toy."""

    def test_kitchen_sink_covers_every_section_and_construct(self):
        text = (REPO / "tests" / "fixtures" / "roundtrip" / "kitchen-sink.md").read_text(encoding="utf-8")
        for marker in ("---highlights---", "---end-highlights---", "---raid log---", "---comms---",
                       "---budget---", "---benefits---", "---lessons learned---", "---baseline---"):
            assert marker in text, marker
        for construct in ("[depends", ":SS", "+2d", "-1d", "*+1d", "$", "^$", "/$", "{Design}", "~8h/16h",
                          "[repeats", "!!!", '"', "'", "//", "#urgent", "2026-08-03", "0d"):
            assert construct in text, construct
        for key in APP_MAINTAINED_KEYS:
            assert f"\n{key}:" in text, key

    def test_kitchen_sink_parses_the_constructs_it_claims(self, service):
        text = (REPO / "tests" / "fixtures" / "roundtrip" / "kitchen-sink.md").read_text(encoding="utf-8")
        result = service.parse(text)
        by_name = {t["name"]: t for t in result.tasks}
        assert by_name["Backend"]["dependency_types"] == {"Wireframes": "SS"}
        assert by_name["Backend"]["lag_lead"] == {"Wireframes": "+2d", "Visual design": "-1d"}
        assert by_name["Interviews"]["priority"] == "Important"
        assert by_name["Decision point"]["duration_days"] == 0
        assert by_name["Kick-off workshop"]["comment"] == "Held on site"
        assert result.front_matter.get("title", "").startswith("Kitchen Sink")
        assert result.raid_items and result.comms_items and result.highlights
        assert result.benefits_items and result.lessons_items and result.baseline_items
