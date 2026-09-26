"""Tests for the `noodle` command line interface (packages/noodle-cli).

`analyze` is covered alongside the plan review it prints, in
tests/test_plan_quality.py.
"""

import subprocess
import sys

from noodle_cli.cli import main

CLEAN_PLAN = """\
---
title: Validate Me
Resources:
- @alex: Alex Chen, Developer
---
Phase
  Build 3d @alex
  Test 2d @alex [depends Build]
"""


def test_init_writes_a_plan_that_render_schedules(tmp_path, capsys):
    """The sample used to be a YAML schema nothing reads: rendered, it
    showed a table with no tasks in it."""
    plan = tmp_path / "plan.md"
    assert main(["init", str(plan)]) == 0
    capsys.readouterr()

    assert main(["render", str(plan)]) == 0
    table = capsys.readouterr().out.split("# Project Milestones")[0]
    rows = [line.split("|") for line in table.splitlines() if line[:1].isdigit()]
    assert [row[1].strip() for row in rows] == [
        "Planning", "Scope the project", "Plan the build",
        "Build", "Build prototype", "Stakeholder review",
    ]
    assert rows[4][5].strip() == "Alice, Bob"  # front-matter resources mapped


def test_init_does_not_overwrite_without_force(tmp_path, capsys):
    plan = tmp_path / "plan.md"
    plan.write_text("mine\n", encoding="utf-8")
    assert main(["init", str(plan)]) == 1
    assert plan.read_text(encoding="utf-8") == "mine\n"
    assert main(["init", str(plan), "--force"]) == 0
    assert "Scope the project" in plan.read_text(encoding="utf-8")


def test_the_sample_plan_validates_cleanly(tmp_path, capsys):
    plan = tmp_path / "plan.md"
    main(["init", str(plan)])
    capsys.readouterr()
    assert main(["validate", str(plan)]) == 0
    assert capsys.readouterr().out.strip() == "No validation issues found."


def test_validate_reports_errors_and_exits_non_zero(tmp_path, capsys):
    """validate used to import a `project_validator` module that doesn't
    exist, so it died with ModuleNotFoundError whatever the plan."""
    plan = tmp_path / "plan.md"
    plan.write_text(CLEAN_PLAN, encoding="utf-8")
    assert main(["validate", str(plan)]) == 0
    assert "No validation issues found." in capsys.readouterr().out

    plan.write_text(CLEAN_PLAN.replace("[depends Build]", "[depends Ghost]"), encoding="utf-8")
    assert main(["validate", str(plan)]) == 1
    out = capsys.readouterr().out
    assert "ERROR: dangling-dependency" in out
    assert "(line 8)" in out


def test_validate_reports_warnings_without_failing(tmp_path, capsys):
    plan = tmp_path / "plan.md"
    # Build and Test now both start today, for the same person
    plan.write_text(CLEAN_PLAN.replace(" [depends Build]", ""), encoding="utf-8")
    assert main(["validate", str(plan)]) == 0
    assert "WARNING: over-allocation" in capsys.readouterr().out


def test_validate_declines_yaml(tmp_path, capsys):
    plan = tmp_path / "plan.yaml"
    plan.write_text("project:\n  name: Old schema\ntasks: []\n", encoding="utf-8")
    assert main(["validate", str(plan)]) == 2
    assert "looks like YAML" in capsys.readouterr().err


def test_scheduling_engine_has_no_broken_main():
    """`python -m noodle_core.scheduling_engine` used to import a
    long-gone `projects.scheduling_engine.cli` and crash."""
    result = subprocess.run(
        [sys.executable, "-m", "noodle_core.scheduling_engine"],
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "Error" not in result.stderr
