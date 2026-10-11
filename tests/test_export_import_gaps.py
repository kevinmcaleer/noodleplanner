"""Exporter and importer paths that coverage showed were never executed.

- the named ``non-working [...]`` suffix parser on resource lines
- stakeholder front matter → Excel ``Stakeholders`` sheet → importer round trip
- the importer's ``Budget`` and ``Stakeholders`` sheet handling
- milestones on the PowerPoint timeline slide
- the portfolio deck's deliverables-matrix appendix
- the ASCII ``render_timeline`` renderer
"""

import io

import pytest
from openpyxl import Workbook, load_workbook
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from noodle_core.excel_importer import (
    _build_stakeholder_section,
    _generate_budget_table_text,
    convert_excel_to_markdown,
)
from noodle_core.exporters import (
    _extract_non_working_suffix,
    _parse_named_non_working_suffix,
    _parse_stakeholder_entry,
    export_portfolio_to_powerpoint,
    export_timeline_to_powerpoint,
    export_to_excel,
    parse_stakeholders_from_frontmatter,
)
from noodle_core.format_converter import convert_plan_format_to_standard, parse_budget_markdown
from noodle_core.renderers import render_timeline


# ---------------------------------------------------------------------------
# non-working [...] suffix
# ---------------------------------------------------------------------------

class TestNamedNonWorkingSuffix:
    def test_empty(self):
        assert _parse_named_non_working_suffix("") == []
        assert _parse_named_non_working_suffix(None) == []
        assert _parse_named_non_working_suffix(" , ,") == []

    def test_bare_dates_and_ranges(self):
        entries = _parse_named_non_working_suffix("2026-06-10, 2026-07-01:2026-07-05")
        assert entries == [
            {"name": "", "start": "2026-06-10", "finish": ""},
            {"name": "", "start": "2026-07-01", "finish": "2026-07-05"},
        ]

    def test_named_entries(self):
        entries = _parse_named_non_working_suffix(
            "Summer holiday: 2026-08-03:2026-08-14, Dentist: 2026-09-01"
        )
        assert entries == [
            {"name": "Summer holiday", "start": "2026-08-03", "finish": "2026-08-14"},
            {"name": "Dentist", "start": "2026-09-01", "finish": ""},
        ]

    def test_garbage_is_dropped(self):
        assert _parse_named_non_working_suffix("sometime in June, 2026-13-45x") == []

    def test_extract_suffix_before_and_after_calendar(self):
        rest, raw = _extract_non_working_suffix("Kev, PM non-working [2026-06-10] calendar Gulf")
        assert raw == "2026-06-10"
        assert "non-working" not in rest and "calendar Gulf" in rest

        rest, raw = _extract_non_working_suffix("Kev, PM calendar Gulf, non-working [2026-06-10]")
        assert raw == "2026-06-10"
        assert rest.endswith("calendar Gulf")

    def test_extract_suffix_absent(self):
        assert _extract_non_working_suffix("Kev, PM") == ("Kev, PM", None)


# ---------------------------------------------------------------------------
# Stakeholders: front matter → parse → Excel → import
# ---------------------------------------------------------------------------

PLAN_WITH_STAKEHOLDERS = """\
---
title: Stakeholder Plan
Resources:
- @kev: Kevin McAleer, PM
Stakeholders:
- @ceo: Jane Doe, Chief Executive, interest:high, influence:high
- @ops: Sam Ops, Operations Lead, interest:low, influence:high
- @fan: Just A Name
Risks:
- nothing here
---
Phase
  Task 2d @kev
"""


class TestStakeholderParsing:
    def test_entries_from_front_matter(self):
        items = parse_stakeholders_from_frontmatter(PLAN_WITH_STAKEHOLDERS)
        assert [i["shortname"] for i in items] == ["ceo", "ops", "fan"]
        assert items[0] == {
            "shortname": "ceo", "name": "Jane Doe", "role": "Chief Executive",
            "interest": "high", "influence": "high",
        }
        assert items[1]["interest"] == "low" and items[1]["influence"] == "high"
        assert items[2] == {
            "shortname": "fan", "name": "Just A Name", "role": "",
            "interest": "low", "influence": "low",
        }

    def test_section_ends_at_next_key(self):
        text = PLAN_WITH_STAKEHOLDERS.replace("Risks:\n- nothing here\n", "Risks:\n- @notme: Not A Stakeholder\n")
        names = [i["name"] for i in parse_stakeholders_from_frontmatter(text)]
        assert "Not A Stakeholder" not in names

    def test_key_stakeholders_alias_and_no_front_matter(self):
        text = PLAN_WITH_STAKEHOLDERS.replace("Stakeholders:", "Key Stakeholders:")
        assert len(parse_stakeholders_from_frontmatter(text)) == 3
        assert parse_stakeholders_from_frontmatter("Phase\n  Task 1d\n") == []
        assert parse_stakeholders_from_frontmatter("") == []

    def test_entry_edge_cases(self):
        assert _parse_stakeholder_entry("") is None
        assert _parse_stakeholder_entry("no at sign") is None
        assert _parse_stakeholder_entry("@solo") == {
            "shortname": "solo", "name": "solo", "role": "", "interest": "low", "influence": "low",
        }
        multi_role = _parse_stakeholder_entry("@x: Name, Role A, Role B, Interest:HIGH")
        assert multi_role["role"] == "Role A, Role B"
        assert multi_role["interest"] == "high"


class TestStakeholderExcelRoundTrip:
    def _export(self, tmp_path):
        out = tmp_path / "plan.xlsx"
        export_to_excel(
            convert_plan_format_to_standard(PLAN_WITH_STAKEHOLDERS), str(out),
            is_yaml=False, project_name="Stakeholder Plan",
            original_text=PLAN_WITH_STAKEHOLDERS,
        )
        return out

    def test_export_writes_a_stakeholders_sheet(self, tmp_path):
        wb = load_workbook(self._export(tmp_path))
        assert "Stakeholders" in wb.sheetnames
        ws = wb["Stakeholders"]
        rows = list(ws.iter_rows(values_only=True))
        assert rows[0] == ("Name", "Role", "Interest", "Influence")
        assert rows[1] == ("Jane Doe", "Chief Executive", "High", "High")
        assert rows[2] == ("Sam Ops", "Operations Lead", "Low", "High")
        assert rows[3] == ("Just A Name", None, "Low", "Low")  # empty role cell
        # High cells are tinted red, low ones green.
        assert ws.cell(row=2, column=3).fill.start_color.rgb.endswith("FFE0E0")
        assert ws.cell(row=3, column=3).fill.start_color.rgb.endswith("D3F9D8")

    def test_no_sheet_without_stakeholders(self, tmp_path):
        plain = "---\ntitle: P\n---\nPhase\n  Task 1d\n"
        out = tmp_path / "plain.xlsx"
        export_to_excel(convert_plan_format_to_standard(plain), str(out), is_yaml=False,
                        project_name="P", original_text=plain)
        assert "Stakeholders" not in load_workbook(out).sheetnames

    def test_import_reads_the_sheet_back_into_front_matter(self, tmp_path):
        data = self._export(tmp_path).read_bytes()
        result = convert_excel_to_markdown(data, "plan.xlsx", "Tasks", {
            "task_name": "Task Name",
            "duration": "Duration (days)",
        })
        md = result["markdown"]
        assert "Stakeholders:" in md
        assert "- Jane Doe: Chief Executive, interest:high, influence:high" in md
        assert "- Just A Name: interest:low, influence:low" in md


# ---------------------------------------------------------------------------
# Importer: Budget and Stakeholders sheets, and their serialisers
# ---------------------------------------------------------------------------

def _xlsx_bytes(sheets):
    wb = Workbook()
    first = True
    for name, rows in sheets.items():
        ws = wb.active if first else wb.create_sheet(name)
        ws.title = name
        first = False
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


TASKS_SHEET = [["Task Name", "Duration (days)"], ["Build", 3], ["Test", 2]]
TASK_MAPPING = {"task_name": "Task Name", "duration": "Duration (days)"}


class TestImporterBudgetSheet:
    def test_budget_sheet_becomes_a_budget_section(self):
        data = _xlsx_bytes({
            "Tasks": TASKS_SHEET,
            "Budget": [
                ["ID", "Description", "Estimate", "Forecast", "Type", "Invoice", "PO",
                 "Supplier", "Total", "Ordered", "Received", "Category"],
                [1, "Laptops", 1000, 1100, "Capex", "INV-1", "PO-9", "Acme", 1100,
                 "2026-01-05", "2026-01-20", "Hardware"],
                [None, "Training", "abc", None, None, None, None, None, None, None, None, None],
                [None, None, None, None, None, None, None, None, None, None, None, None],
                [None, "TOTALS", 1000, 1100, None, None, None, None, 1100, None, None, None],
            ],
        })
        result = convert_excel_to_markdown(data, "plan.xlsx", "Tasks", TASK_MAPPING)
        md = result["markdown"]
        assert result["warnings"] == []
        assert "---budget---" in md

        items = parse_budget_markdown(md.split("---budget---", 1)[1])
        assert len(items) == 2, md
        laptops, training = items
        assert laptops["description"] == "Laptops"
        assert laptops["estimate"] == 1000 and laptops["forecast"] == 1100
        assert laptops["supplier"] == "Acme"
        assert laptops["category"] == "Hardware"
        # Missing id is assigned, non-numeric estimate falls back to 0, type and
        # category get their defaults, the pipe survives escaping.
        assert training["id"] == 2
        assert training["estimate"] == 0
        assert training["type"] == "Capex"
        assert training["category"] == "Consultancy"

    @pytest.mark.xfail(
        strict=True,
        reason="_generate_budget_table_text escapes '|' as '\\|' but parse_budget_markdown "
               "splits on every '|', so a description containing a pipe is truncated on re-import",
    )
    def test_budget_description_with_a_pipe_survives_import(self):
        data = _xlsx_bytes({
            "Tasks": TASKS_SHEET,
            "Budget": [
                ["ID", "Description", "Estimate"],
                [1, "Training | with pipe", 10],
            ],
        })
        md = convert_excel_to_markdown(data, "plan.xlsx", "Tasks", TASK_MAPPING)["markdown"]
        items = parse_budget_markdown(md.split("---budget---", 1)[1])
        assert items[0]["description"] == "Training | with pipe"

    def test_header_only_budget_sheet_is_ignored(self):
        data = _xlsx_bytes({"Tasks": TASKS_SHEET, "Budget": [["ID", "Description"]]})
        result = convert_excel_to_markdown(data, "plan.xlsx", "Tasks", TASK_MAPPING)
        assert "---budget---" not in result["markdown"]

    def test_generate_budget_table_text_round_trips_and_escapes(self):
        items = [{
            "id": 7, "description": "A and B", "estimate": 10.5, "forecast": 12,
            "type": "Opex", "invoice": "", "po": "", "supplier": "Multi\nline",
            "total": 12, "date_ordered": "2026-02-01", "date_received": "",
            "category": "Software",
        }]
        text = _generate_budget_table_text(items)
        lines = text.splitlines()
        assert lines[0].startswith("| ID") and set(lines[1].replace("|", "").strip()) == {"-", " "}
        assert "Multi line" in lines[2]
        # Pipes are escaped on the way out (re-import of them is the xfail above).
        assert "A \\| B" in _generate_budget_table_text([{"description": "A | B"}])
        parsed = parse_budget_markdown(text)
        assert parsed[0]["id"] == 7
        assert parsed[0]["category"] == "Software"
        assert parsed[0]["supplier"] == "Multi line"

    def test_generate_budget_table_text_empty(self):
        assert _generate_budget_table_text([]) == ""


class TestImporterStakeholdersSheet:
    def test_sheet_rows_become_stakeholder_entries(self):
        data = _xlsx_bytes({
            "Tasks": TASKS_SHEET,
            "Stakeholders": [
                ["Name", "Role", "Interest", "Influence"],
                ["Jane", "CEO", "High", "HIGH"],
                [" Sam ", None, None, None],
                [None, "orphan role", "high", "high"],   # no name: skipped
                [None, None, None, None],
            ],
        })
        md = convert_excel_to_markdown(data, "plan.xlsx", "Tasks", TASK_MAPPING)["markdown"]
        assert "- Jane: CEO, interest:high, influence:high" in md
        assert "- Sam: interest:low, influence:low" in md
        assert "orphan role" not in md

    def test_build_stakeholder_section(self):
        assert _build_stakeholder_section([]) == ""
        text = _build_stakeholder_section([
            {"name": "A", "role": "R", "interest": "HIGH", "influence": "Low"},
            {"name": "B"},
        ])
        assert text == "Stakeholders:\n- A: R, interest:high, influence:low\n- B: interest:low, influence:low"


# ---------------------------------------------------------------------------
# PowerPoint timeline: milestones
# ---------------------------------------------------------------------------

MILESTONE_PLAN = """\
---
title: Milestone Plan
---
Discovery
  Research 3d
  *Research signed off 0d [depends Research]
Delivery
  Build 4d [depends Research signed off]
  *Go live 0d [depends Build]
"""


def _shapes(prs):
    return [s for slide in prs.slides for s in slide.shapes]


class TestTimelinePowerPointMilestones:
    def test_milestones_drawn_as_diamonds_with_labels_and_dates(self, tmp_path):
        out = tmp_path / "timeline.pptx"
        export_timeline_to_powerpoint(
            convert_plan_format_to_standard(MILESTONE_PLAN), str(out), is_yaml=False,
            project_name="Milestone Plan", original_text=MILESTONE_PLAN,
        )
        prs = Presentation(str(out))
        shapes = _shapes(prs)
        diamonds = [s for s in shapes if s.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE
                    and s.auto_shape_type is not None and "DIAMOND" in str(s.auto_shape_type)]
        # Two milestone markers plus the legend swatch.
        assert len(diamonds) == 3, [str(s.auto_shape_type) for s in shapes if s.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE]

        texts = [s.text_frame.text for s in shapes if s.has_text_frame]
        assert "Research signed off" in texts
        assert "Go live" in texts
        # Every milestone also gets a "%d %b" date label beneath the diamond.
        import re
        date_labels = [t for t in texts if re.fullmatch(r"\d{1,2} [A-Z][a-z]{2}", t)]
        assert len(date_labels) >= 2

    def test_no_tasks_writes_nothing(self, tmp_path, monkeypatch):
        import noodle_core.scheduling_engine as se
        monkeypatch.setattr(se, "schedule_tasks", lambda phases: [])
        out = tmp_path / "empty.pptx"
        export_timeline_to_powerpoint("Phase\n  Task 1d\n", str(out), is_yaml=False, project_name="Empty")
        assert not out.exists()


# ---------------------------------------------------------------------------
# Portfolio deck: deliverables appendix
# ---------------------------------------------------------------------------

def _report(name, deliverables=None):
    return {
        "project_name": name, "manager": "M", "sponsor": "S", "budget": "",
        "date": "2026-03-01", "status": "Green", "milestones": [], "up_next": [],
        "highlight": None, "risks_issues": [], "timeline_tasks": [],
        "deliverables": deliverables,
    }


PORTFOLIO = {
    "name": "Portfolio", "date": "2026-03-01", "projects": [],
    "summary": {}, "manager": "", "sponsor": "",
}


class TestPortfolioDeliverablesAppendix:
    def test_appendix_slide_per_project_with_deliverables(self, tmp_path):
        out = tmp_path / "portfolio.pptx"
        reports = [
            _report("Alpha", {
                "items": [
                    {"id": 1, "name": "Spec \x01doc", "start": "2026-01-01", "finish": "2026-01-10",
                     "status": "complete", "roles": {"kev": "P", "bea": "R"}},
                    {"id": 2, "name": "Build", "start": "2026-01-11", "finish": "2026-02-01",
                     "status": "in-progress", "roles": {"kev": "A"}},
                ],
                "people": ["kev", "bea"],
                "role_map": {"kev": "Project Manager", "bea": "Tester"},
            }),
            _report("Beta", {"items": [], "people": [], "role_map": {}}),
            _report("Gamma", None),
        ]
        export_portfolio_to_powerpoint(str(out), PORTFOLIO, reports)

        prs = Presentation(str(out))
        titles = [s.text_frame.text for s in _shapes(prs) if s.has_text_frame]
        matrix_titles = [t for t in titles if t.startswith("Deliverables Matrix")]
        assert matrix_titles == ["Deliverables Matrix — Alpha"]

        tables = [s.table for s in _shapes(prs) if s.has_table]
        assert len(tables) == 1
        table = tables[0]
        # ID, Deliverable, Dates, Status + one column per person + QA
        assert len(table.columns) == 4 + 2 + 1
        assert len(table.rows) == 1 + 2
        header = [table.cell(0, c).text for c in range(len(table.columns))]
        assert header[0] == "ID"
        assert any("Project Manager" in h or "kev" in h for h in header)
        body = [[table.cell(r, c).text for c in range(len(table.columns))] for r in range(1, 3)]
        # Control characters are sanitised out of cell text.
        assert body[0][1] == "Spec doc"
        assert "P" in body[0] and "R" in body[0]

    def test_appendix_caps_rows_per_slide(self, tmp_path):
        out = tmp_path / "big.pptx"
        items = [{"id": i, "name": f"D{i}", "start": "", "finish": "", "status": "", "roles": {}}
                 for i in range(1, 31)]
        export_portfolio_to_powerpoint(str(out), PORTFOLIO, [
            _report("Big", {"items": items, "people": [], "role_map": {}}),
        ])
        tables = [s.table for s in _shapes(Presentation(str(out))) if s.has_table]
        assert len(tables) >= 1
        assert all(len(t.rows) <= 19 for t in tables)


# ---------------------------------------------------------------------------
# ASCII timeline renderer
# ---------------------------------------------------------------------------

class TestRenderTimeline:
    def test_symbols_labels_and_dates_are_positioned(self):
        from datetime import datetime
        start = datetime(2026, 1, 1)
        finish = datetime(2026, 1, 31)
        out = render_timeline(
            phases=[{"name": "Build", "start": datetime(2026, 1, 11)}],
            milestones=[{"name": "Demo", "date": datetime(2026, 1, 21), "percent": 50}],
            start_date=start, finish_date=finish, timeline_width=61,
        )
        lines = out.splitlines()
        assert lines[0] == "-" * 61
        symbols = lines[1]
        assert symbols[0] == "◆" and symbols[-1] == "◆"   # Start / Finish
        assert symbols[20] == "■"                               # phase at 1/3
        assert symbols[40] == "◆"                               # milestone at 2/3
        assert lines[2].startswith("Start")
        assert lines[2][20:25] == "Build"
        assert lines[2][40:44] == "Demo"
        assert lines[3].startswith("Date")
        assert lines[4].startswith("1 Jan")
        assert lines[4][20:26] == "11 Jan"
        assert lines[4][60] == "3"  # "31 Jan" is clipped at the right edge

    def test_dates_include_year_when_span_crosses_years(self):
        from datetime import datetime
        out = render_timeline([], [], datetime(2025, 12, 1), datetime(2026, 2, 1), timeline_width=40)
        assert "1 Dec 2025" in out.splitlines()[4]

    def test_labels_are_clipped_at_the_right_edge(self):
        from datetime import datetime
        out = render_timeline(
            [], [{"name": "A very long milestone name", "date": datetime(2026, 1, 30)}],
            datetime(2026, 1, 1), datetime(2026, 1, 31), timeline_width=30,
        )
        for line in out.splitlines():
            assert len(line) == 30
