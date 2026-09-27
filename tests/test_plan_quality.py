"""Plan quality review (#782): every check fires, and does not false-positive.

Each check has a pair of tests: a plan with the problem, and the nearest plan
without it. The fixes are applied and the result re-reviewed, and every
bundled template must come back clean -- templates are meant to be exemplary.

Run with: uv run pytest tests/test_plan_quality.py -q
"""

from datetime import date
from pathlib import Path

import pytest

from noodle_core.plan_quality import (
    CHECKS,
    DOCS_BASE,
    FixError,
    SEVERITIES,
    apply_finding_fix,
    apply_fix,
    format_review,
    review_plan,
    task_lines,
)

REPO = Path(__file__).resolve().parent.parent
TODAY = date(2026, 3, 16)

FM = """---
title: Review
Resources:
- @alex: Alex Chen, Developer
- @sam: Sam Lee, Designer
---

"""


def review(body, front_matter=FM, today=TODAY):
    return review_plan(front_matter + body, today=today)


def checks(result):
    return [f["check"] for f in result["findings"]]


def only(result, check):
    return [f for f in result["findings"] if f["check"] == check]


# ----- shape ---------------------------------------------------------------


def test_every_finding_has_fix_guidance_docs_and_a_known_severity():
    body = """Phase
  Spec @bob 3d 2026-03-02 [depends Nothing]
  Build 5d
"""
    result = review(body)
    assert result["findings"]
    for finding in result["findings"]:
        assert finding["severity"] in SEVERITIES
        assert finding["fix"]
        assert finding["docs"] == f"{DOCS_BASE}#{finding['check']}"
        assert finding["check"] in CHECKS
        assert finding["id"]


def test_findings_are_ordered_errors_first():
    body = """Phase
  Spec @alex 3d 2026-03-02 [depends Nothing]
  Build 5d @alex [depends Spec]
  Test @alex
"""
    order = [f["severity"] for f in review(body)["findings"]]
    assert order == sorted(order, key=SEVERITIES.index)


def test_a_clean_plan_scores_100():
    body = """Phase
  Spec @alex 3d 2026-03-16
  Build @sam 5d [depends Spec]
  Done 0d [depends Build]
"""
    result = review(body)
    assert result["findings"] == []
    assert result["score"] == 100
    assert result["grade"] == "Healthy"


def test_score_counts_each_kind_of_problem_at_most_three_times():
    # twenty parallel, unowned tasks: all critical, so twenty warnings
    many = "\n".join(f"  Task {i} 1d 2026-03-16" for i in range(20))
    result = review("Phase\n" + many + "\n")
    assert len(only(result, "critical-no-owner")) == 20
    per_check = {}
    for f in result["findings"]:
        per_check[(f["check"], f["severity"])] = per_check.get((f["check"], f["severity"]), 0) + 1
    weights = {"error": 15, "warning": 5, "suggestion": 1}
    expected = 100 - sum(weights[sev] * min(n, 3) for (_, sev), n in per_check.items())
    assert result["score"] == expected
    assert result["score"] >= 100 - 3 * 5 - 3 * 1   # not 100 - 20 * 5


# ----- line numbers ----------------------------------------------------------


def test_findings_point_at_the_right_line_even_with_duplicate_names():
    body = """Phase
  Review @alex 1d 2026-03-16
Other
  Review 1d [depends Missing]
"""
    result = review(body)
    dangling = only(result, "dangling-dependency")
    assert len(dangling) == 1
    lines = (FM + body).splitlines()
    assert lines[dangling[0]["line"] - 1] == "  Review 1d [depends Missing]"


def test_task_lines_skips_front_matter_comments_tables_headings_and_back_matter():
    text = FM + "// note\nPhase\n\n  A 1d\n| x |\n## Heading\n  B 1d\n---raid log---\n| Risk |\n"
    names = [raw.strip() for _, raw in task_lines(text)]
    assert names == ["Phase", "A 1d", "B 1d"]


# ----- structure -------------------------------------------------------------


def test_missing_front_matter_fires_and_is_fixable():
    result = review_plan("Phase\n  A @x 1d\n", today=TODAY)
    [finding] = only(result, "missing-front-matter")
    fixed = apply_fix("Phase\n  A @x 1d\n", finding["fix_action"])
    assert fixed.startswith("---\ntitle: Untitled plan\n---\n\n")
    assert "missing-front-matter" not in checks(review_plan(fixed, today=TODAY))


def test_missing_title_fires_only_without_a_title():
    assert "missing-title" in checks(review("Phase\n  A @alex 1d\n", front_matter="---\nowner: x\n---\n\n"))
    assert "missing-title" not in checks(review("Phase\n  A @alex 1d\n"))


def test_undeclared_resource_fires_is_fixable_and_the_fix_declares_it():
    body = "Phase\n  A @bob 1d 2026-03-16\n  B @alex 1d\n"
    result = review(body)
    [finding] = only(result, "undeclared-resource")
    assert "@bob" in finding["message"]
    fixed = apply_fix(FM + body, finding["fix_action"])
    assert "- @bob: Bob\n" in fixed
    assert "undeclared-resource" not in checks(review_plan(fixed, today=TODAY))
    # the rest of the plan is untouched
    assert fixed.replace("- @bob: Bob\n", "") == FM + body


def test_declared_resources_are_matched_case_insensitively():
    assert "undeclared-resource" not in checks(review("Phase\n  A @Alex 1d\n"))


def test_no_duration_fires_but_not_for_milestones_long_form_or_effort():
    result = review("Phase\n  A @alex\n  B @alex 0d\n  C @alex 3days\n  D @alex ~4h\n")
    assert [f["task"] for f in only(result, "no-duration")] == ["A"]


def test_empty_summary_catches_a_heading_with_nothing_under_it():
    result = review("Phase One\nPhase Two\n  A @alex 1d\n")
    assert [f["task"] for f in only(result, "empty-summary")] == ["Phase One"]
    assert "no-duration" not in checks(result)


def test_long_duration_is_a_suggestion():
    [finding] = only(review("Phase\n  Big @alex 60d\n"), "long-duration")
    assert finding["severity"] == "suggestion"
    assert "long-duration" not in checks(review("Phase\n  Fine @alex 20d\n"))


def test_milestone_with_duration_fires_and_the_fix_zeroes_it():
    body = "Phase\n  Launch milestone @alex 2d \"sign-off\"\n"
    [finding] = only(review(body), "milestone-with-duration")
    fixed = apply_fix(FM + body, finding["fix_action"])
    assert '  Launch milestone @alex 0d "sign-off"\n' in fixed
    assert "milestone-with-duration" not in checks(review_plan(fixed, today=TODAY))
    assert "milestone-with-duration" not in checks(review("Phase\n  Launch milestone @alex 0d\n"))


def test_child_outside_parent_deadline():
    body = "Phase D2026-03-18\n  A @alex 5d 2026-03-16\n"
    [finding] = only(review(body), "child-outside-parent")
    assert "after its phase" in finding["message"]
    assert "child-outside-parent" not in checks(review("Phase D2026-03-31\n  A @alex 5d 2026-03-16\n"))


# ----- dependencies ------------------------------------------------------------


def test_dangling_dependency_is_an_error_with_a_suggestion_and_a_safe_fix():
    body = "Phase\n  Design @alex 2d 2026-03-16\n  Build @alex 2d [depends Desing, Design]\n"
    [finding] = only(review(body), "dangling-dependency")
    assert finding["severity"] == "error"
    assert "Did you mean 'Design'?" in finding["message"]
    fixed = apply_fix(FM + body, finding["fix_action"])
    assert "  Build @alex 2d [depends Design]\n" in fixed
    assert "dangling-dependency" not in checks(review_plan(fixed, today=TODAY))


def test_removing_the_only_dependency_removes_the_bracket():
    body = "Phase\n  Build @alex 2d [depends Nope] \"note\"\n"
    [finding] = only(review(body), "dangling-dependency")
    assert '  Build @alex 2d "note"\n' in apply_fix(FM + body, finding["fix_action"])


def test_deliverable_and_lag_dependencies_are_not_dangling():
    body = "Phase\n  $GW1 Gate @alex 1d 2026-03-16\n  Build @alex 2d [depends $GW1 +2d, $GW1 Gate:SS]\n"
    assert "dangling-dependency" not in checks(review(body))
    # the scheduler names that task "$GW1 Gate", so plain "Gate" is not it
    [finding] = only(review(body.replace("$GW1 Gate:SS", "Gate:SS")), "dangling-dependency")
    assert "Did you mean '$GW1 Gate'?" in finding["message"]


def test_dependency_on_a_phase_is_reported():
    body = "Design\n  A @alex 2d 2026-03-16\nBuild\n  B @alex 2d [depends Design]\n"
    [finding] = only(review(body), "phase-dependency")
    assert finding["task"] == "B"


def test_dependency_on_a_phase_line_is_reported():
    body = "Spec\n  A @alex 2d 2026-03-16\nBuild [depends A]\n  B @alex 2d\n"
    [finding] = only(review(body), "phase-dependency")
    assert finding["task"] == "Build"


def test_dependency_on_a_duplicated_name_warns_and_names_the_first():
    body = ("Phase\n  Design @alex 3d 2026-03-16\n  Design UI @alex 2d [depends design]\n"
            "Other\n  Design @sam 4d 2026-03-16\n")
    [finding] = only(review(body), "ambiguous-dependency")
    assert finding["severity"] == "warning"
    assert finding["task"] == "Design UI"
    assert finding["fix_action"] is None  # which task was meant is the author's call
    assert "2 tasks have that name" in finding["message"]
    lines = (FM + body).splitlines()
    assert f"'Design' under 'Phase' (line {lines.index('  Design @alex 3d 2026-03-16') + 1})" \
        in finding["message"]
    assert lines[finding["line"] - 1] == "  Design UI @alex 2d [depends design]"


def test_duplicated_names_nothing_depends_on_do_not_warn():
    body = "Phase\n  Design @alex 3d 2026-03-16\nOther\n  Design @sam 4d 2026-03-16\n"
    assert "ambiguous-dependency" not in checks(review(body))
    unique = "Phase\n  Design @alex 3d 2026-03-16\n  Build @alex 2d [depends Design]\n"
    assert "ambiguous-dependency" not in checks(review(unique))


def test_phase_sharing_a_name_with_a_later_task_takes_the_dependency():
    """The first definition wins, so the dependency lands on the phase and is ignored."""
    body = ("Design\n  Spec @alex 2d 2026-03-16\nBuild\n  Design @alex 2d 2026-03-23\n"
            "  Code @alex 2d [depends Design]\n")
    result = review(body)
    [phase] = only(result, "phase-dependency")
    assert phase["task"] == "Code"
    [ambiguous] = only(result, "ambiguous-dependency")
    assert "the phase 'Design'" in ambiguous["message"]


def test_circular_dependency_is_an_error():
    body = "Phase\n  A @alex 1d [depends B]\n  B @alex 1d [depends A]\n"
    found = only(review(body), "circular-dependency")
    assert found and all(f["severity"] == "error" for f in found)
    assert "circular-dependency" not in checks(review("Phase\n  A @alex 1d\n  B @alex 1d [depends A]\n"))


# ----- schedule quality ------------------------------------------------------------


def test_critical_task_with_no_owner_is_a_warning_not_a_suggestion():
    body = "Phase\n  A 3d 2026-03-16\n  B @alex 1d [depends A]\n"
    result = review(body)
    assert [f["task"] for f in only(result, "critical-no-owner")] == ["A"]
    assert "no-resource" not in checks(result)


def test_non_critical_unowned_task_is_a_suggestion():
    body = "Phase\n  Long @alex 10d 2026-03-16\n  Short 1d 2026-03-16\n"
    result = review(body)
    assert [f["task"] for f in only(result, "no-resource")] == ["Short"]
    assert "critical-no-owner" not in checks(result)


def test_over_allocation_fires_for_parallel_work_and_honours_shares():
    clash = "Phase\n  A @alex 3d 2026-03-16\n  B @alex 3d 2026-03-16\n"
    [finding] = only(review(clash), "over-allocation")
    assert "Alex Chen" in finding["message"] and "2x" in finding["message"]
    shared = "Phase\n  A @alex[50%] 3d 2026-03-16\n  B @alex[50%] 3d 2026-03-16\n"
    assert "over-allocation" not in checks(review(shared))
    serial = "Phase\n  A @alex 3d 2026-03-16\n  B @alex 3d [depends A]\n"
    assert "over-allocation" not in checks(review(serial))


def test_over_allocation_ignores_the_resources_own_non_working_days():
    fm = FM.replace("- @alex: Alex Chen, Developer", "- @alex: Alex Chen, Developer, non-working [2026-03-17]")
    body = "Phase\n  A @alex 1d 2026-03-17\n  B @alex 1d 2026-03-16\n"
    assert "over-allocation" not in checks(review(body, front_matter=fm))


def test_over_allocation_survives_a_shutdown_longer_than_a_year():
    # The check used to test each day with get_next_working_day(day) == day,
    # which searches ahead -- and gave up, raising out of review_plan, from
    # any day more than a year before the end of a shutdown.
    fm = FM.replace("---\n\n", "non-working-days:\n  - Closure: 2026-04-01:2027-09-30\n---\n\n", 1)
    body = "Phase\n  A @alex 10d 2026-03-25\n  B @alex 10d 2026-03-25\n"
    [finding] = only(review(body, front_matter=fm), "over-allocation")
    # five days either side of the closure, none inside it
    assert "on 10 working days between 2026-03-25 and 2027-10-07" in finding["message"]


def test_start_on_a_non_working_day_fires_with_a_fix_to_the_next_working_day():
    body = "Phase\n  A @alex 2d 2026-03-21\n"   # a Saturday
    [finding] = only(review(body), "non-working-day")
    assert "2026-03-23" in finding["message"]
    fixed = apply_fix(FM + body, finding["fix_action"])
    assert "  A @alex 2d 2026-03-23\n" in fixed
    assert "non-working-day" not in checks(review_plan(fixed, today=TODAY))


def test_start_on_a_project_holiday_fires():
    fm = FM.replace("---\n\n", "non-working-days:\n  - 2026-03-18\n---\n\n", 1)
    [finding] = only(review("Phase\n  A @alex 2d 2026-03-18\n", front_matter=fm), "non-working-day")
    assert "2026-03-19" in finding["message"]


def test_a_deadline_on_a_weekend_is_not_a_start_date():
    assert "non-working-day" not in checks(review("Phase\n  A @alex 2d 2026-03-16 D2026-03-21\n"))


def test_long_chain_without_a_milestone_is_reported_once():
    chain = "\n".join(f"  * Step {i} @alex 1d" for i in range(1, 10))
    body = "Phase\n  Step 0 @alex 1d 2026-03-16\n" + chain + "\n"
    found = only(review(body), "long-chain-no-milestone")
    assert len(found) == 1
    assert found[0]["task"] == "Step 9"


def test_a_very_long_chain_written_dependant_first_does_not_overflow_the_stack():
    # Each task names the one on the next line, so the walk back from the
    # first task goes 3,000 links deep -- past Python's recursion limit,
    # which used to surface as "The plan could not be scheduled".
    n = 3000
    lines = [f"  T{i} @alex 1d [depends T{i - 1}]" for i in range(n, 1, -1)]
    body = "Phase\n" + "\n".join(lines) + "\n  T1 @alex 1d 2026-03-16\n"
    result = review(body)
    assert not [f for f in result["findings"] if "could not be scheduled" in f["message"]]
    found = only(result, "long-chain-no-milestone")
    assert len(found) == 1
    assert found[0]["task"] == f"T{n}"
    assert found[0]["message"].startswith(f"{n} tasks")


def test_a_milestone_in_the_middle_breaks_the_chain():
    first = "\n".join(f"  * A{i} @alex 1d" for i in range(5))
    second = "\n".join(f"  * B{i} @alex 1d" for i in range(5))
    body = f"Phase\n  Start @alex 1d 2026-03-16\n{first}\n  * Checkpoint 0d\n{second}\n"
    assert "long-chain-no-milestone" not in checks(review(body))


def test_no_slack_fires_only_when_parallel_work_has_no_float():
    # parallel tasks of identical length ending together: all critical
    body = "Phase\n" + "\n".join(f"  T{i} @alex[20%] 3d 2026-03-16" for i in range(5)) + "\n"
    assert "no-slack" in checks(review(body))
    # a single straight chain has no float by construction, and is not flagged
    chain = "Phase\n  T0 @alex 1d 2026-03-16\n" + "\n".join(f"  * T{i} @alex 1d" for i in range(1, 6)) + "\n"
    assert "no-slack" not in checks(review(chain))
    # float exists once one branch is shorter
    mixed = "Phase\n  Long @alex 5d 2026-03-16\n" + "\n".join(f"  S{i} @sam[20%] 1d 2026-03-16" for i in range(5)) + "\n"
    assert "no-slack" not in checks(review(mixed))


# ----- progress and governance --------------------------------------------------------


def test_stale_progress_flags_work_that_should_have_finished():
    body = "Phase\n  Old @alex 2d 2026-03-02 0%\n  Done @alex 2d 2026-03-02 100%\n  Future @alex 2d 2026-03-30 0%\n"
    assert [f["task"] for f in only(review(body), "stale-progress")] == ["Old"]


GOV_BODY = "Phase\n" + "\n".join(f"  T{i} @alex 1d [depends T{i - 1}]" for i in range(1, 9)) + "\n"


def test_governance_is_not_expected_of_a_plan_that_has_not_started():
    body = "Phase\n  T0 @alex 1d 2026-04-01\n" + GOV_BODY.split("\n", 1)[1]
    result = review(body)
    for check in ("no-raid", "no-benefits", "no-stakeholders", "no-baseline"):
        assert check not in checks(result)


def test_governance_is_expected_once_a_sizeable_plan_is_under_way():
    body = "Phase\n  T0 @alex 1d 2026-03-02 100%\n" + GOV_BODY.split("\n", 1)[1]
    result = review(body)
    for check in ("no-raid", "no-benefits", "no-stakeholders", "no-baseline"):
        assert check in checks(result), check
        assert only(result, check)[0]["severity"] == "suggestion"


def test_governance_is_satisfied_by_the_real_sections():
    fm = FM.replace("---\n\n", "Stakeholders:\n- @cfo: Chief Financial Officer\n---\n\n", 1)
    body = "Phase\n  T0 @alex 1d 2026-03-02 100%\n" + GOV_BODY.split("\n", 1)[1] + """
---raid log---
| ID | Type | Description | Owner | Status | Priority | Date Raised | Due Date | Updates |
|----|------|-------------|-------|--------|----------|-------------|----------|---------|
| R1 | Risk | Supplier late | Alex | Open | High | 2026-03-01 | 2026-04-01 | |

---benefits---
| ID | Benefit | Measure | Target | Owner | Status | Realisation Date | Linked Tasks |
|----|---------|---------|--------|-------|--------|------------------|--------------|
| B1 | Faster orders | Time | -20% | Alex | Planned | 2026-06-01 | T1 |

---baseline---
| Task Name | Start | Finish | Duration |
|-----------|-------|--------|----------|
| T0 | 2026-03-02 | 2026-03-03 | 1d |
"""
    result = review(body, front_matter=fm)
    for check in ("no-raid", "no-benefits", "no-stakeholders", "no-baseline"):
        assert check not in checks(result), (check, [f["message"] for f in only(result, check)])


# ----- fixes ----------------------------------------------------------------


def test_fixes_refuse_when_the_plan_has_moved_on():
    body = "Phase\n  Launch milestone @alex 2d\n"
    [finding] = only(review(body), "milestone-with-duration")
    moved = (FM + body).replace("Launch milestone", "Something else")
    with pytest.raises(FixError):
        apply_fix(moved, finding["fix_action"])


def test_apply_finding_fix_by_id_and_crlf_is_preserved():
    body = "Phase\r\n  A @bob 1d 2026-03-16\r\n"
    text = FM.replace("\n", "\r\n") + body
    [finding] = only(review_plan(text, today=TODAY), "undeclared-resource")
    fixed = apply_finding_fix(text, finding["id"], today=TODAY)
    assert "- @bob: Bob\r\n" in fixed
    assert "\n" not in fixed.replace("\r\n", "")


def test_a_finding_without_a_fix_cannot_be_applied_by_id():
    body = "Phase\n  A 3d 2026-03-16\n"
    [finding] = only(review(body), "critical-no-owner")
    with pytest.raises(FixError):
        apply_finding_fix(FM + body, finding["id"], today=TODAY)


# ----- templates ----------------------------------------------------------------


@pytest.mark.parametrize("template", sorted((REPO / "templates").glob("*/plan.md")), ids=lambda p: p.parent.name)
def test_every_bundled_template_is_clean(template):
    result = review_plan(template.read_text(encoding="utf-8"))
    assert result["findings"] == [], format_review(result)


# ----- surfaces: API, AI tools, CLI --------------------------------------------------


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from noodle_web.app import app

    return TestClient(app)


def test_api_analyse_and_fix(client):
    text = FM + "Phase\n  A @bob 1d 2026-03-16\n"
    response = client.post("/api/analyse", json={"plan_text": text, "today": "2026-03-16"})
    assert response.status_code == 200
    body = response.json()
    [finding] = [f for f in body["findings"] if f["check"] == "undeclared-resource"]
    fixed = client.post("/api/analyse/fix", json={"plan_text": text, "action": finding["fix_action"]})
    assert fixed.status_code == 200
    assert "- @bob: Bob\n" in fixed.json()["plan_text"]
    by_id = client.post("/api/analyse/fix", json={"plan_text": text, "finding_id": finding["id"],
                                                    "today": "2026-03-16"})
    assert by_id.json()["plan_text"] == fixed.json()["plan_text"]


def test_api_fix_conflict_and_bad_input(client):
    text = FM + "Phase\n  A @alex 1d\n"
    stale = client.post("/api/analyse/fix", json={"plan_text": text, "action": {
        "kind": "set_duration", "line": 99, "days": 0, "task": "A"}})
    assert stale.status_code == 409
    assert client.post("/api/analyse/fix", json={"plan_text": text}).status_code == 422
    assert client.post("/api/analyse", json={"plan_text": text, "today": "nope"}).status_code == 422


def test_ai_tools_expose_the_review_and_the_fix():
    from noodle_web.ai_tools import TOOL_DEFINITIONS, execute_tool

    names = {t["function"]["name"] for t in TOOL_DEFINITIONS}
    assert {"analyse_plan", "apply_plan_fix"} <= names
    text = FM + "Phase\n  A @bob 1d 2026-03-16\n"
    same, message = execute_tool("analyse_plan", text, {})
    assert same == text
    assert "Resource not declared" in message and "one-click fix available" in message
    finding_id = next(part.split("]")[0] for part in message.split("[id: ")[1:]
                      if part.startswith("undeclared-resource"))
    fixed, message = execute_tool("apply_plan_fix", text, {"finding_id": finding_id})
    assert "- @bob: Bob" in fixed


def test_cli_analyze_prints_the_review_and_exits_non_zero_on_errors(tmp_path, capsys):
    from noodle_cli.cli import main

    plan = tmp_path / "plan.md"
    plan.write_text(FM + "Phase\n  A @alex 1d [depends Ghost]\n", encoding="utf-8")
    assert main(["analyze", str(plan)]) == 1
    out = capsys.readouterr().out
    assert "ERRORS" in out and "Dependency on a missing task" in out and "Fix:" in out
    plan.write_text(FM + "Phase\n  A @alex 1d\n", encoding="utf-8")
    assert main(["analyze", str(plan)]) == 0


def test_legacy_analyze_plan_wraps_the_review():
    from noodle_core import analyze_plan

    findings = analyze_plan("", original_text=FM + "Phase\n  A @alex 1d [depends Ghost]\n")
    assert findings[0]["type"] == "Dependency on a missing task"
    assert findings[0]["severity"] == "error"
    assert findings[0]["fix"]


def test_every_check_is_documented_with_an_anchor():
    """Each finding's `docs` link lands on a real section of the reference page."""
    page = (REPO / "docs" / "reference" / "plan-quality-checks.rst").read_text(encoding="utf-8")
    missing = [check for check in CHECKS if f".. _{check}:" not in page]
    assert missing == []
