"""Tests for PlanService business logic layer."""

import pytest

from noodle_web.plan_service import (
    PlanService,
    ParseResult,
    RenderResult,
    ExportResult,
    export_to_file,
    parse_front_matter,
    collect_labels_from_plan,
    update_front_matter_with_labels,
)


@pytest.fixture
def service():
    """Create a PlanService instance."""
    return PlanService()


@pytest.fixture
def sample_plan():
    """Simple plan without front matter."""
    return """Phase 1
  Task 1 @john 3d
  Task 2 @jane 2d
Phase 2
  Task 3 @john 5d"""


@pytest.fixture
def plan_with_frontmatter():
    """Plan with YAML front matter."""
    return """---
title: Test Project
resources:
  - name: John Doe
    shortname: john
  - name: Jane Smith
    shortname: jane
---
Phase 1
  Task 1 @john 3d
  Task 2 @jane 2d"""


@pytest.fixture
def plan_with_labels():
    """Plan with hashtag labels on tasks."""
    return """Phase 1
  Task 1 @john 3d #high
  Task 2 @jane 2d #test"""


@pytest.fixture
def plan_with_frontmatter_labels():
    """Plan with existing labels in front matter."""
    return """---
title: Labelled Plan
labels: [existing]
---
Phase 1
  Task 1 3d #new"""


# ---------------------------------------------------------------------------
# export_to_file helper
# ---------------------------------------------------------------------------


class TestExportToFile:
    """Tests for the export_to_file temp-file helper."""

    def test_binary_read(self):
        """export_to_file returns bytes by default."""
        content = export_to_file(
            lambda path: open(path, "wb").close(),
            suffix=".bin",
        )
        assert isinstance(content, bytes)
        assert content == b""

    def test_text_read(self):
        """export_to_file returns str when read_mode='r'."""
        def writer(path):
            with open(path, "w", encoding="utf-8") as f:
                f.write("hello")

        content = export_to_file(writer, suffix=".txt", read_mode="r")
        assert isinstance(content, str)
        assert content == "hello"

    def test_temp_file_cleaned_up(self, tmp_path):
        """Temp file is deleted after export_to_file returns."""
        import os

        captured_path = {}

        def writer(path):
            captured_path["p"] = path
            with open(path, "w") as f:
                f.write("data")

        export_to_file(writer, suffix=".tmp", read_mode="r")
        assert not os.path.exists(captured_path["p"])

    def test_temp_file_cleaned_up_on_error(self):
        """Temp file is deleted even when the export function raises."""
        import os

        captured_path = {}

        def bad_writer(path):
            captured_path["p"] = path
            # Create the file so we can verify cleanup
            with open(path, "w") as f:
                f.write("partial")
            raise RuntimeError("boom")

        with pytest.raises(RuntimeError, match="boom"):
            export_to_file(bad_writer, suffix=".tmp")

        assert not os.path.exists(captured_path["p"])


# ---------------------------------------------------------------------------
# parse_front_matter helper
# ---------------------------------------------------------------------------


class TestParseFrontMatter:
    """Tests for the front matter parser."""

    def test_no_front_matter(self):
        result = parse_front_matter("Phase 1\n  Task 1 3d")
        assert result == {}

    def test_simple_front_matter(self):
        text = "---\ntitle: My Project\nmanager: Alice\n---\nPhase 1"
        result = parse_front_matter(text)
        assert result["title"] == "My Project"
        assert result["manager"] == "Alice"

    def test_keys_lowercased(self):
        text = "---\nTitle: Foo\n---\ncontent"
        result = parse_front_matter(text)
        assert "title" in result

    def test_colon_in_value(self):
        text = "---\nnote: value: with colons\n---\ncontent"
        result = parse_front_matter(text)
        assert result["note"] == "value: with colons"


# ---------------------------------------------------------------------------
# collect_labels_from_plan
# ---------------------------------------------------------------------------


class TestCollectLabels:
    """Tests for label collection from plan text."""

    def test_no_labels(self, sample_plan):
        labels = collect_labels_from_plan(sample_plan)
        # @john and @jane are resource tokens, not labels
        # But #-prefixed tokens would be labels
        assert isinstance(labels, set)

    def test_hashtag_labels(self, plan_with_labels):
        labels = collect_labels_from_plan(plan_with_labels)
        assert "high" in labels
        assert "test" in labels

    def test_labels_lowercased(self):
        text = "Phase 1\n  Task 1 #HIGH #Test"
        labels = collect_labels_from_plan(text)
        assert "high" in labels
        assert "test" in labels

    def test_labels_skip_front_matter(self):
        text = "---\ntitle: #notlabel\n---\nPhase 1\n  Task 1 #real"
        labels = collect_labels_from_plan(text)
        assert "real" in labels
        assert "notlabel" not in labels


# ---------------------------------------------------------------------------
# update_front_matter_with_labels
# ---------------------------------------------------------------------------


class TestUpdateFrontMatterWithLabels:
    """Tests for front matter label updating."""

    def test_no_labels_returns_unchanged(self, sample_plan):
        result = update_front_matter_with_labels(sample_plan, set())
        assert result == sample_plan

    def test_adds_front_matter_when_missing(self):
        text = "Phase 1\n  Task 1"
        result = update_front_matter_with_labels(text, {"alpha", "beta"})
        assert result.startswith("---\n")
        assert "labels: [alpha, beta]" in result

    def test_adds_labels_line_to_existing_front_matter(self):
        text = "---\ntitle: Foo\n---\nPhase 1"
        result = update_front_matter_with_labels(text, {"tag"})
        assert "labels: [tag]" in result
        assert "title: Foo" in result

    def test_merges_with_existing_labels(self, plan_with_frontmatter_labels):
        result = update_front_matter_with_labels(
            plan_with_frontmatter_labels, {"new"}
        )
        assert "existing" in result
        assert "new" in result


# ---------------------------------------------------------------------------
# PlanService.render
# ---------------------------------------------------------------------------


class TestPlanServiceRender:
    """Tests for PlanService.render()."""

    def test_returns_render_result(self, service, sample_plan):
        result = service.render(sample_plan)
        assert isinstance(result, RenderResult)
        assert isinstance(result.ascii_output, str)
        assert len(result.ascii_output) > 0

    def test_uses_project_name_override(self, service, sample_plan):
        result = service.render(sample_plan, project_name="Custom Name")
        assert isinstance(result.ascii_output, str)

    def test_extracts_title_from_frontmatter(self, service, plan_with_frontmatter):
        result = service.render(plan_with_frontmatter)
        assert isinstance(result, RenderResult)


# ---------------------------------------------------------------------------
# PlanService.parse
# ---------------------------------------------------------------------------


class TestPlanServiceParse:
    """Tests for PlanService.parse()."""

    def test_returns_parse_result(self, service, sample_plan):
        result = service.parse(sample_plan)
        assert isinstance(result, ParseResult)
        assert result.success is True
        assert result.error is None

    def test_has_tasks(self, service, sample_plan):
        result = service.parse(sample_plan)
        assert len(result.tasks) > 0

    def test_task_structure(self, service, sample_plan):
        result = service.parse(sample_plan)
        task = result.tasks[0]
        assert "id" in task
        assert "name" in task
        assert "start" in task
        assert "finish" in task
        assert "duration_days" in task
        assert "resources" in task
        assert "rag" in task

    def test_uses_project_name_from_frontmatter(self, service, plan_with_frontmatter):
        result = service.parse(plan_with_frontmatter)
        assert result.project_name == "Test Project"

    def test_uses_project_name_override(self, service, plan_with_frontmatter):
        result = service.parse(plan_with_frontmatter, project_name="Override")
        assert result.project_name == "Override"

    def test_ascii_output_is_opt_in(self, service, sample_plan):
        """parse() no longer builds the ASCII table by default: nothing that
        calls /api/parse reads it and it scheduled the plan twice (#789)."""
        result = service.parse(sample_plan)
        assert result.ascii_output == ""

        with_ascii = service.parse(sample_plan, include_ascii=True)
        assert isinstance(with_ascii.ascii_output, str)
        assert len(with_ascii.ascii_output) > 0
        # everything else is unchanged by the flag
        assert with_ascii.tasks == result.tasks

    def test_has_front_matter(self, service, plan_with_frontmatter):
        result = service.parse(plan_with_frontmatter)
        assert "title" in result.front_matter

    def test_has_resource_map(self, service, plan_with_frontmatter):
        result = service.parse(plan_with_frontmatter)
        assert isinstance(result.resource_map, dict)

    def test_collects_labels(self, service, plan_with_labels):
        result = service.parse(plan_with_labels)
        assert result.updated_plan_text is not None
        assert "high" in result.updated_plan_text
        assert "test" in result.updated_plan_text

    def test_highlights_always_present(self, service, sample_plan):
        result = service.parse(sample_plan)
        assert isinstance(result.highlights, list)

    def test_raid_items_always_present(self, service, sample_plan):
        result = service.parse(sample_plan)
        assert isinstance(result.raid_items, list)

    def test_baseline_items_always_present(self, service, sample_plan):
        result = service.parse(sample_plan)
        assert isinstance(result.baseline_items, list)

    def test_baseline_tasks_not_in_parsed_tasks(self, service):
        """Baseline tasks must not appear in the regular tasks list (#615)."""
        plan_with_baseline = """Phase 1
  Task A @john 3d
  Task B @jane 2d

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task A    | 2026-03-02 | 2026-03-05 | 3d       |
| Task B    | 2026-03-02 | 2026-03-04 | 2d       |"""
        result = service.parse(plan_with_baseline)
        assert result.success
        task_names = [t["name"] for t in result.tasks]
        # Only the real tasks should be present (no duplicates from baseline)
        assert task_names.count("Task A") == 1
        assert task_names.count("Task B") == 1
        # Baseline items should be returned separately
        assert len(result.baseline_items) == 2

    def test_parse_failure_returns_partial(self, service):
        """An invalid plan still returns highlights and metadata."""
        # Use text that will cause a parsing error in the scheduling engine
        result = service.parse("---\ntitle: Bad\n---\n")
        # Even when parsing partially fails, supplementary sections are present
        assert isinstance(result.highlights, list)
        assert isinstance(result.raid_items, list)
        assert isinstance(result.baseline_items, list)

    def test_active_calendar_changes_scheduled_dates(self, service):
        """/api/parse applies the front-matter `calendar:` (#1047, #1132):
        a Sun-Thu calendar schedules through a date that a Mon-Fri one
        would push out to the following Monday."""
        plan = """---
title: Calendar Test
calendar: Gulf
calendars:
- Gulf: Sun-Thu
---
Task 1 2026-08-02 5d"""
        result = service.parse(plan)
        assert result.success
        task = next(t for t in result.tasks if t["name"] == "Task 1")
        # 2026-08-02 is a Sunday, a working day on Sun-Thu: no weekend gap.
        assert task["finish"] == "2026-08-07"

        without_calendar = service.parse("Task 1 2026-08-02 5d")
        without_task = next(t for t in without_calendar.tasks if t["name"] == "Task 1")
        assert without_task["finish"] == "2026-08-08"

    def test_resource_specific_calendar_overrides_the_project_calendar(self, service):
        """A resource with its own `calendar <Name>` (#1136) schedules
        their tasks against it, independent of every other resource."""
        plan = """---
title: Resource Calendar Test
calendars:
- Gulf: Sun-Thu
Resources:
- @kev: Kevin McAleer, PM calendar Gulf
- @sam: Sam Jones, Analyst
---
Kev's task 2026-08-02 5d @kev
Sam's task 2026-08-02 5d @sam"""
        result = service.parse(plan)
        assert result.success
        by_name = {t["name"]: t for t in result.tasks}
        # @kev is on Gulf (Sun-Thu): Sunday is a working day, no weekend gap.
        assert by_name["Kev's task"]["finish"] == "2026-08-07"
        # @sam has no assigned calendar: falls back to the implicit Standard.
        assert by_name["Sam's task"]["finish"] == "2026-08-08"


# ---------------------------------------------------------------------------
# PlanService.export_single
# ---------------------------------------------------------------------------


class TestPlanServiceExportSingle:
    """Tests for PlanService.export_single()."""

    def test_excel_export(self, service, sample_plan):
        result = service.export_single(sample_plan, "excel")
        assert isinstance(result, ExportResult)
        assert result.media_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        assert result.filename.endswith(".xlsx")
        assert len(result.content) > 0

    def test_csv_export(self, service, sample_plan):
        result = service.export_single(sample_plan, "csv")
        assert isinstance(result, ExportResult)
        assert result.media_type == "text/csv"
        assert result.filename.endswith(".csv")

    def test_ppt_export(self, service, sample_plan):
        result = service.export_single(sample_plan, "ppt")
        assert isinstance(result, ExportResult)
        assert result.media_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        assert result.filename.endswith(".pptx")

    def test_pdf_export(self, service, sample_plan):
        result = service.export_single(sample_plan, "pdf")
        assert isinstance(result, ExportResult)
        assert result.media_type == "application/pdf"
        assert result.filename.endswith(".pdf")

    def test_unknown_format_raises(self, service, sample_plan):
        with pytest.raises(ValueError, match="Unknown export format"):
            service.export_single(sample_plan, "docx")

    def test_project_name_in_filename(self, service, sample_plan):
        result = service.export_single(
            sample_plan, "excel", project_name="My Plan"
        )
        assert "My Plan" in result.filename


# ---------------------------------------------------------------------------
# PlanService.export_zip
# ---------------------------------------------------------------------------


class TestPlanServiceExportZip:
    """Tests for PlanService.export_zip()."""

    def test_returns_zip(self, service, sample_plan):
        result = service.export_zip(
            sample_plan, excel=True, csv=True
        )
        assert isinstance(result, ExportResult)
        assert result.media_type == "application/zip"
        assert result.filename.endswith("-exports.zip")

    def test_zip_contains_txt(self, service, sample_plan):
        import zipfile
        import io

        result = service.export_zip(sample_plan)
        zf = zipfile.ZipFile(io.BytesIO(result.content))
        names = zf.namelist()
        assert any(n.endswith(".txt") for n in names)

    def test_zip_contains_requested_formats(self, service, sample_plan):
        import zipfile
        import io

        result = service.export_zip(
            sample_plan, excel=True, pdf=True
        )
        zf = zipfile.ZipFile(io.BytesIO(result.content))
        names = zf.namelist()
        assert any(n.endswith(".xlsx") for n in names)
        assert any(n.endswith(".pdf") for n in names)


# ---------------------------------------------------------------------------
# PlanService._resolve_project_name
# ---------------------------------------------------------------------------


class TestResolveProjectName:
    """Tests for project name resolution logic."""

    def test_override_takes_precedence(self, service, plan_with_frontmatter):
        name = service._resolve_project_name(
            plan_with_frontmatter, "Override"
        )
        assert name == "Override"

    def test_falls_back_to_frontmatter_title(self, service, plan_with_frontmatter):
        name = service._resolve_project_name(plan_with_frontmatter, None)
        assert name == "Test Project"

    def test_defaults_to_project(self, service, sample_plan):
        name = service._resolve_project_name(sample_plan, None)
        assert name == "Project"


class TestCircularDependencyFields:
    """The parse result exposes the scheduler's circular-dependency flags so
    the editor can mark them and the status bar can offer a fix."""

    def test_own_phase_dependency_is_reported(self, service):
        result = service.parse("""Definition $definition
  Project Charter $charter 1d
  *GW2 Approval $GW2 0d [depends $definition, $charter]""")

        assert result.success
        gw2 = next(t for t in result.tasks if t["name"] == "GW2 Approval")
        assert gw2["circular_dependencies"] == [{
            "name": "Definition",
            "deliverable": "definition",
            "reason": "own_phase",
            "message": '"GW2 Approval" depends on its own phase "Definition"',
            "fixable": True,
        }]
        assert "its own phase" in gw2["loop_warning"]

    def test_clean_plan_has_empty_fields(self, service, sample_plan):
        result = service.parse(sample_plan)
        assert all(t["circular_dependencies"] == [] for t in result.tasks)
        assert all(t["loop_warning"] == "" for t in result.tasks)
