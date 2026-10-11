"""CLI coverage for the commands the existing CLI tests never ran.

``tests/test_noodle_cli.py`` exercises ``init``, ``render`` and ``validate``.
``export``, ``export-ppt``, ``analyze``, ``render --split-markdown`` and the
``--format`` override were untested, so a regression in any of them (the
``validate`` command once died on a stale import for months) would only be
found by a user.
"""

from openpyxl import load_workbook
from pptx import Presentation

from noodle_cli.cli import _looks_like_yaml, _write_markdown_outputs, main

PLAN = """\
---
title: CLI Export
Resources:
- @alex: Alex Chen, Developer
- @bea: Bea Lopez, Tester
---
Build
  Design 2d @alex
  *Design sign-off 0d @alex [depends Design]
  Implement 3d @alex [depends Design sign-off]
Verify
  Test 2d @bea [depends Implement]
"""


def _write_plan(tmp_path, text=PLAN, name="cli_export_plan.md"):
    plan = tmp_path / name
    plan.write_text(text, encoding="utf-8")
    return plan


# ---------------------------------------------------------------------------
# export (Excel)
# ---------------------------------------------------------------------------

def test_export_writes_a_workbook_with_the_plan_tasks(tmp_path, capsys):
    plan = _write_plan(tmp_path)
    out = tmp_path / "plan.xlsx"

    assert main(["export", str(plan), str(out)]) == 0
    assert f"Exported project data to {out}" in capsys.readouterr().out

    wb = load_workbook(out)
    # Task names are written indented to show the hierarchy.
    cells = {str(c.value).strip() for ws in wb.worksheets for row in ws.iter_rows() for c in row if c.value is not None}
    for expected in ("Design", "Implement", "Test"):
        assert expected in cells
    # The front-matter title is the project name, not the file stem.
    assert "CLI Export" in cells


UNTITLED_PLAN = PLAN.replace("title: CLI Export\n", "")


def test_export_project_name_defaults_to_the_file_stem(tmp_path, capsys):
    plan = _write_plan(tmp_path, UNTITLED_PLAN, name="my_big_launch.md")
    out = tmp_path / "x.xlsx"
    assert main(["export", str(plan), str(out)]) == 0
    wb = load_workbook(out)
    everything = " ".join(
        str(c.value) for ws in wb.worksheets for row in ws.iter_rows() for c in row if c.value is not None
    )
    assert "My Big Launch" in everything


def test_export_honours_explicit_project_name(tmp_path, capsys):
    plan = _write_plan(tmp_path, UNTITLED_PLAN)
    out = tmp_path / "x.xlsx"
    assert main(["export", str(plan), str(out), "--project-name", "Named Project"]) == 0
    wb = load_workbook(out)
    everything = " ".join(
        str(c.value) for ws in wb.worksheets for row in ws.iter_rows() for c in row if c.value is not None
    )
    assert "Named Project" in everything


# ---------------------------------------------------------------------------
# export-ppt (PowerPoint timeline)
# ---------------------------------------------------------------------------

def _slide_text(prs):
    out = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                out.append(shape.text_frame.text)
    return "\n".join(out)


def test_export_ppt_writes_a_timeline_deck(tmp_path, capsys):
    plan = _write_plan(tmp_path)
    out = tmp_path / "timeline.pptx"

    assert main(["export-ppt", str(plan), str(out)]) == 0
    assert "Exported timeline to PowerPoint" in capsys.readouterr().out

    prs = Presentation(str(out))
    assert len(prs.slides) >= 1
    text = _slide_text(prs)
    # Phases are drawn as labelled bars and starred tasks as milestones.
    assert "Build" in text
    assert "Verify" in text
    assert "Design sign-off" in text


def test_export_ppt_with_natural_format_override(tmp_path, capsys):
    plan = _write_plan(tmp_path)
    out = tmp_path / "timeline.pptx"
    assert main(["export-ppt", str(plan), str(out), "--format", "natural", "--project-name", "Forced"]) == 0
    assert "Forced" in _slide_text(Presentation(str(out)))


# ---------------------------------------------------------------------------
# analyze
# ---------------------------------------------------------------------------

def test_analyze_prints_a_review(tmp_path, capsys):
    plan = _write_plan(tmp_path)
    rc = main(["analyze", str(plan)])
    out = capsys.readouterr().out
    assert rc in (0, 1)
    assert out.strip(), "analyze printed nothing"


# ---------------------------------------------------------------------------
# render --split-markdown
# ---------------------------------------------------------------------------

def test_render_split_markdown_writes_the_three_files(tmp_path, capsys):
    plan = _write_plan(tmp_path)
    out_dir = tmp_path / "out"

    assert main(["render", str(plan), "--split-markdown", "--output-dir", str(out_dir)]) == 0
    msg = capsys.readouterr().out
    assert "project_table.md" in msg and "gantt.md" in msg

    table = (out_dir / "project_table.md").read_text(encoding="utf-8")
    gantt = (out_dir / "gantt.md").read_text(encoding="utf-8")
    assert "Design" in table
    assert gantt.startswith("# Gantt Chart")
    # The gantt section must not leak into the table file and vice versa.
    assert "# Gantt Chart" not in table
    assert "| Design" not in gantt or "Gantt" in gantt


def test_write_markdown_outputs_splits_sections_and_derives_timeline(tmp_path):
    markdown = (
        "# Project Table\n"
        "| # | Task | Start | Finish | Who |\n"
        "| 1 | Alpha | 2026-01-05 | 2026-01-07 | a |\n"
        "| 2 | Beta | 2026-01-08 | 2026-01-12 | b |\n"
        "# Gantt Chart\n"
        "Alpha ███\n"
    )
    out_dir = tmp_path / "split"
    _write_markdown_outputs(markdown, out_dir)

    assert (out_dir / "project_table.md").read_text().startswith("# Project Table")
    assert (out_dir / "gantt.md").read_text() == "# Gantt Chart\nAlpha ███\n"
    # No "# Project Timeline" section existed, so the timeline is derived
    # from the earliest start and latest finish in the table.
    timeline = (out_dir / "timeline.md").read_text()
    assert timeline == "Project Start: 2026-01-05\nProject Finish: 2026-01-12\n"


def test_write_markdown_outputs_keeps_an_explicit_timeline_section(tmp_path):
    markdown = (
        "# Project Table\n"
        "| 1 | Alpha | 2026-01-05 | 2026-01-07 | a |\n"
        "# Project Timeline\n"
        "---◆---\n"
        "\n"
        "# Gantt Chart\n"
        "bar\n"
    )
    out_dir = tmp_path / "split"
    _write_markdown_outputs(markdown, out_dir)
    assert (out_dir / "timeline.md").read_text() == "# Project Timeline\n---◆---\n"


def test_write_markdown_outputs_omits_timeline_and_gantt_when_absent(tmp_path):
    out_dir = tmp_path / "split"
    _write_markdown_outputs("# Only a table\n| Task | x |\n", out_dir)
    assert (out_dir / "project_table.md").exists()
    assert not (out_dir / "timeline.md").exists()
    assert not (out_dir / "gantt.md").exists()


# ---------------------------------------------------------------------------
# format detection
# ---------------------------------------------------------------------------

def test_looks_like_yaml_heuristic():
    assert _looks_like_yaml("project: x\ntasks:\n- id: 1\n")
    assert _looks_like_yaml("resources:\n")
    assert not _looks_like_yaml("Phase\n  Task 3d @alex\n")
    assert not _looks_like_yaml("")
