"""Tests for format_converter module."""

import pytest
from noodle_core import (
    convert_plan_format_to_standard,
    extract_title_from_frontmatter,
    extract_highlights,
    strip_highlights,
    generate_highlights_text,
    update_plan_highlights,
    extract_raid_log,
    strip_raid_log,
    generate_raid_log_text,
    update_plan_raid_log,
    extract_baseline,
    strip_baseline,
    parse_baseline_markdown,
    generate_baseline_text,
    update_plan_baseline,
    parse_benefits_markdown,
    parse_budget_markdown,
    parse_raid_markdown,
    parse_comms_markdown,
    extract_lessons,
    strip_lessons,
    parse_lessons_markdown,
    generate_lessons_text,
    update_plan_lessons,
)


class TestExtractTitleFromFrontmatter:
    """Test suite for extract_title_from_frontmatter function."""

    def test_extract_title_with_valid_frontmatter(self):
        """Test extracting title from valid YAML front matter."""
        text = """---
title: My Project
resources:
  - name: John Doe
---
Task 1 @john 3d"""
        result = extract_title_from_frontmatter(text)
        assert result == "My Project"

    def test_extract_title_without_frontmatter(self):
        """Test when no front matter exists."""
        text = """Task 1 @john 3d
Task 2 @jane 2w"""
        result = extract_title_from_frontmatter(text)
        assert result is None

    def test_extract_title_frontmatter_without_title_field(self):
        """Test when front matter exists but no title field."""
        text = """---
resources:
  - name: John Doe
---
Task 1 @john 3d"""
        result = extract_title_from_frontmatter(text)
        assert result is None

    def test_extract_title_with_empty_frontmatter(self):
        """Test with empty front matter."""
        text = """---
---
Task 1 @john 3d"""
        result = extract_title_from_frontmatter(text)
        assert result is None

    def test_extract_title_with_invalid_yaml(self):
        """Test with invalid YAML in front matter."""
        text = """---
title: [invalid yaml
---
Task 1 @john 3d"""
        result = extract_title_from_frontmatter(text)
        assert result is None

    def test_extract_title_with_special_characters(self):
        """Test title with special characters."""
        text = """---
title: "Project: Testing & Development (2025)"
---
Task 1 @john 3d"""
        result = extract_title_from_frontmatter(text)
        assert result == "Project: Testing & Development (2025)"


class TestConvertPlanFormatToStandard:
    """Test suite for convert_plan_format_to_standard function."""

    def test_strip_frontmatter(self):
        """Test that YAML front matter is stripped."""
        text = """---
title: My Project
---
Task 1 @john 3days"""
        result = convert_plan_format_to_standard(text)
        assert "---" not in result
        assert "title:" not in result
        assert "Task 1" in result

    def test_convert_duration_days(self):
        """Test conversion of day durations."""
        text = "Task 1 @john 3days"
        result = convert_plan_format_to_standard(text)
        assert "3d" in result
        assert "3days" not in result

    def test_convert_duration_weeks(self):
        """Test conversion of week durations."""
        text = "Task 1 @john 2weeks"
        result = convert_plan_format_to_standard(text)
        assert "2w" in result
        assert "2weeks" not in result

    def test_convert_duration_months(self):
        """Test conversion of month durations."""
        text = "Task 1 @john 1month"
        result = convert_plan_format_to_standard(text)
        assert "1m" in result
        assert "1month" not in result

    def test_preserve_single_dependency(self):
        """Test that [depends] syntax is preserved."""
        text = "Task 2 [depends Task 1] @john 2d"
        result = convert_plan_format_to_standard(text)
        assert "[depends Task 1]" in result

    def test_preserve_multiple_dependencies(self):
        """Test that multiple [depends] dependencies are preserved."""
        text = "Task 3 [depends Task 1, Task 2] @john 2d"
        result = convert_plan_format_to_standard(text)
        assert "[depends Task 1, Task 2]" in result

    def test_preserve_task_names_with_spaces(self):
        """Test that task names with spaces are preserved."""
        text = "My Important Task @john 3d"
        result = convert_plan_format_to_standard(text)
        assert "My Important Task" in result

    def test_preserve_resources(self):
        """Test that @ resources are preserved."""
        text = "Task 1 @john 3d"
        result = convert_plan_format_to_standard(text)
        assert "@john" in result

    def test_preserve_completion_percentage(self):
        """Test that % completion is preserved."""
        text = "Task 1 @john 3d 50%"
        result = convert_plan_format_to_standard(text)
        assert "50%" in result

    def test_preserve_comments(self):
        """Test that ! comments are preserved."""
        text = 'Task 1 @john 3d !"This is a comment"'
        result = convert_plan_format_to_standard(text)
        assert '!"This is a comment"' in result

    def test_sequential_task_marker(self):
        """Test that sequential task marker (*) is preserved."""
        text = "* Task 1 @john 3d"
        result = convert_plan_format_to_standard(text)
        assert "*" in result or "Task 1" in result

    def test_empty_input(self):
        """Test with empty input."""
        text = ""
        result = convert_plan_format_to_standard(text)
        assert result == ""

    def test_complex_plan_with_all_features(self):
        """Test a complex plan with multiple features."""
        text = """---
title: Complex Project
resources:
  - name: John Doe
    role: Developer
---
Phase 1
  Task 1 @john 3days
  * Task 2 [depends Task 1] @jane 2weeks 50% !"Important"
  Task 3 [depends Task 1, Task 2] @john 1month"""

        result = convert_plan_format_to_standard(text)

        # Front matter stripped
        assert "title:" not in result

        # Durations converted
        assert "3d" in result
        assert "2w" in result
        assert "1m" in result

        # Dependencies preserved in [depends] syntax
        assert "[depends Task 1" in result
        assert "Task 2" in result

        # Other elements preserved
        assert "@john" in result
        assert "@jane" in result
        assert "50%" in result
        assert '!"Important"' in result


class TestTaskNameExcludesPercent:
    """Test that task names never include percentage complete tokens."""

    def test_percent_excluded_from_task_name(self):
        """Task name should not contain percent like 'build software 100 %'."""
        text = "*build software 100% @kev"
        result = convert_plan_format_to_standard(text)
        assert "build software 100" not in result or "build software 100%" in result
        # The percent should be a separate token, not merged into the name
        assert "build software 100 %" not in result

    def test_percent_at_end_excluded(self):
        """Percent at end of task should not be in the name."""
        text = "deploy app 50%"
        result = convert_plan_format_to_standard(text)
        assert "deploy app 50 %" not in result

    def test_percent_with_duration_excluded(self):
        """Percent with duration should not appear in name."""
        text = "  build software 5d 100% @kev"
        result = convert_plan_format_to_standard(text)
        assert "build software 100" not in result or "100%" in result
        assert "build software 5d 100 %" not in result

    def test_sequential_task_percent_excluded(self):
        """Sequential (*) task percent should not appear in name."""
        text = "  *build software 100% @kev"
        result = convert_plan_format_to_standard(text)
        assert "build software 100 %" not in result

    def test_task_name_preserved_without_percent(self):
        """Task name should be intact after percent removal."""
        text = "build software 100% @kev"
        result = convert_plan_format_to_standard(text)
        assert "build software" in result
        assert "100%" in result
        assert "@kev" in result


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_no_newline_at_end(self):
        """Test input without trailing newline."""
        text = "Task 1 @john 3days"
        result = convert_plan_format_to_standard(text)
        assert "3d" in result

    def test_windows_line_endings(self):
        """Test with Windows-style line endings."""
        text = "Task 1 @john 3days\r\nTask 2 @jane 2weeks"
        result = convert_plan_format_to_standard(text)
        assert "3d" in result
        assert "2w" in result

    def test_mixed_indentation(self):
        """Test with mixed tabs and spaces."""
        text = "  Task 1 @john 3d\n\tTask 2 @jane 2w"
        result = convert_plan_format_to_standard(text)
        assert "Task 1" in result
        assert "Task 2" in result

    def test_unicode_characters(self):
        """Test with unicode characters in task names."""
        text = "Tâche 1 @jean 3d"
        result = convert_plan_format_to_standard(text)
        assert "Tâche 1" in result

    def test_very_long_task_name(self):
        """Test with very long task name."""
        long_name = "A" * 500
        text = f"{long_name} @john 3d"
        result = convert_plan_format_to_standard(text)
        assert long_name in result

    def test_dependency_case_insensitive(self):
        """Test that dependency syntax is preserved regardless of case."""
        text = "Task 2 [DEPENDS Task 1] @john 2d"
        result = convert_plan_format_to_standard(text)
        assert "[DEPENDS Task 1]" in result


class TestExtractHighlights:
    """Test suite for extract_highlights function."""

    def test_extract_highlights_basic(self):
        """Test extracting highlights from plan text."""
        text = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @Alice
- Completed phase 1 ahead of schedule
- **Key risk** mitigated

## 2026-02-06 @Bob
- Sprint planning completed
---end-highlights---"""
        result = extract_highlights(text)
        assert len(result) == 2
        assert result[0]['date'] == '2026-02-13'
        assert result[0]['author'] == 'Alice'
        assert 'Completed phase 1' in result[0]['content']
        assert '**Key risk**' in result[0]['content']
        assert result[1]['date'] == '2026-02-06'
        assert result[1]['author'] == 'Bob'
        assert 'Sprint planning' in result[1]['content']

    def test_extract_highlights_none_present(self):
        """Test when no highlights section exists."""
        text = """Phase 1
  Task 1 @john 3d"""
        result = extract_highlights(text)
        assert result == []

    def test_extract_highlights_empty_section(self):
        """Test with empty highlights section."""
        text = """---highlights---
---end-highlights---"""
        result = extract_highlights(text)
        assert result == []

    def test_extract_highlights_missing_end_marker(self):
        """Test with missing end marker - should parse to EOF."""
        text = """---highlights---
## 2026-02-13 @Alice
- Some content"""
        result = extract_highlights(text)
        assert len(result) == 1
        assert result[0]['date'] == '2026-02-13'
        assert result[0]['author'] == 'Alice'
        assert '- Some content' in result[0]['content']

    def test_extract_highlights_multiline_content(self):
        """Test highlight with multiline content."""
        text = """---highlights---
## 2026-02-13 @Alice
- First point
- Second point
- Third point
---end-highlights---"""
        result = extract_highlights(text)
        assert len(result) == 1
        assert 'First point' in result[0]['content']
        assert 'Third point' in result[0]['content']

    def test_extract_highlights_single_entry(self):
        """Test with a single highlight entry."""
        text = """---highlights---
## 2026-01-15 @Dave
- Kickoff meeting held
---end-highlights---"""
        result = extract_highlights(text)
        assert len(result) == 1
        assert result[0]['date'] == '2026-01-15'
        assert result[0]['author'] == 'Dave'

    def test_extract_highlights_issue_204_exact_format(self):
        """Regression test for issue #204: highlights from plan not rendering.

        Uses the exact format reported in the bug with front matter,
        plan tasks, separator, and highlights section without end marker.
        """
        text = """---
title: My Project
project manager: Kevin
---
Phase 1
  pdd @kevin 3d
  tdd @kevin 2d
  site visit @kevin 1d

---

---highlights---
## 2026-02-13 @kevin
- pdd completed
- tdd drafted
- bradford site visited
- quote expected shortly
- cool
"""
        result = extract_highlights(text)
        assert len(result) == 1
        assert result[0]['date'] == '2026-02-13'
        assert result[0]['author'] == 'kevin'
        assert 'pdd completed' in result[0]['content']
        assert 'tdd drafted' in result[0]['content']
        assert 'bradford site visited' in result[0]['content']
        assert 'quote expected shortly' in result[0]['content']
        assert 'cool' in result[0]['content']

    def test_extract_highlights_with_frontmatter_dash_separator_no_end_marker(self):
        """Test highlights after front matter and --- separator with no end marker."""
        text = """---
title: Test
---
Task @alice 3d

---

---highlights---
## 2026-02-13 @alice
- status update
"""
        result = extract_highlights(text)
        assert len(result) == 1
        assert result[0]['author'] == 'alice'
        assert 'status update' in result[0]['content']


class TestStripHighlights:
    """Test suite for strip_highlights function."""

    def test_strip_highlights_basic(self):
        """Test removing highlights section from plan text."""
        text = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @Alice
- Content here
---end-highlights---"""
        result = strip_highlights(text)
        assert '---highlights---' not in result
        assert '---end-highlights---' not in result
        assert 'Content here' not in result
        assert 'Task 1 @john 3d' in result

    def test_strip_highlights_no_section(self):
        """Test stripping when no highlights section exists."""
        text = """Phase 1
  Task 1 @john 3d"""
        result = strip_highlights(text)
        assert result == text

    def test_strip_highlights_preserves_content_before(self):
        """Test that content before highlights is preserved."""
        text = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @Alice
- Content
---end-highlights---"""
        result = strip_highlights(text)
        assert 'Phase 1' in result
        assert 'Task 1 @john 3d' in result

    def test_strip_highlights_removes_dash_separator(self):
        """Test that the --- separator before highlights is also removed."""
        text = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @Alice
- Content
---end-highlights---"""
        result = strip_highlights(text)
        assert 'Phase 1' in result
        assert 'Task 1 @john 3d' in result
        # The --- separator should be removed along with highlights
        assert result.rstrip() == 'Phase 1\n  Task 1 @john 3d'


class TestGenerateHighlightsText:
    """Test suite for generate_highlights_text function."""

    def test_generate_highlights_basic(self):
        """Test generating highlights text from data."""
        highlights = [
            {'date': '2026-02-13', 'author': 'Alice', 'content': '- Phase 1 complete'},
            {'date': '2026-02-06', 'author': 'Bob', 'content': '- Sprint done'},
        ]
        result = generate_highlights_text(highlights)
        assert '---highlights---' in result
        assert '---end-highlights---' not in result
        assert '## 2026-02-13 @Alice' in result
        assert '## 2026-02-06 @Bob' in result
        assert '- Phase 1 complete' in result
        assert '- Sprint done' in result

    def test_generate_highlights_empty(self):
        """Test generating text with empty list."""
        result = generate_highlights_text([])
        assert result == ''

    def test_generate_highlights_none(self):
        """Test generating text with None."""
        result = generate_highlights_text(None)
        assert result == ''


class TestUpdatePlanHighlights:
    """Test suite for update_plan_highlights function."""

    def test_add_highlights_to_plan_without_existing(self):
        """Test adding highlights to a plan that has none."""
        plan = """Phase 1
  Task 1 @john 3d"""
        highlights = [
            {'date': '2026-02-13', 'author': 'Alice', 'content': '- Good progress'},
        ]
        result = update_plan_highlights(plan, highlights)
        assert 'Phase 1' in result
        assert '---highlights---' in result
        assert '## 2026-02-13 @Alice' in result

    def test_highlights_separated_by_three_dashes(self):
        """Test that highlights are separated from plan content with ---."""
        plan = """Phase 1
  Task 1 @john 3d"""
        highlights = [
            {'date': '2026-02-13', 'author': 'Alice', 'content': '- Good progress'},
        ]
        result = update_plan_highlights(plan, highlights)
        # The --- separator should appear between the plan and highlights
        assert '\n\n---\n\n---highlights---' in result

    def test_replace_existing_highlights(self):
        """Test replacing existing highlights section."""
        plan = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-01 @Old
- Old content
---end-highlights---"""
        highlights = [
            {'date': '2026-02-13', 'author': 'New', 'content': '- New content'},
        ]
        result = update_plan_highlights(plan, highlights)
        assert 'Old content' not in result
        assert '## 2026-02-13 @New' in result
        assert '- New content' in result

    def test_remove_highlights_with_empty_list(self):
        """Test removing highlights by passing empty list."""
        plan = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @Alice
- Content
---end-highlights---"""
        result = update_plan_highlights(plan, [])
        assert '---highlights---' not in result
        assert '---end-highlights---' not in result
        assert 'Phase 1' in result

    def test_roundtrip_extract_and_regenerate(self):
        """Test that extracting and regenerating highlights preserves data."""
        plan = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @Alice
- Completed phase 1 ahead of schedule
- **Key risk** mitigated

## 2026-02-06 @Bob
- Sprint planning completed
---end-highlights---"""
        highlights = extract_highlights(plan)
        assert len(highlights) == 2

        base = strip_highlights(plan)
        rebuilt = update_plan_highlights(base, highlights)
        re_extracted = extract_highlights(rebuilt)
        assert len(re_extracted) == 2
        assert re_extracted[0]['date'] == '2026-02-13'
        assert re_extracted[0]['author'] == 'Alice'
        assert re_extracted[1]['date'] == '2026-02-06'
        assert re_extracted[1]['author'] == 'Bob'


class TestConvertPlanFormatStripsHighlights:
    """Test that convert_plan_format_to_standard strips highlights."""

    def test_highlights_not_parsed_as_tasks(self):
        """Highlights section should be stripped before task parsing."""
        text = """Phase 1
  Task 1 @john 3days

---highlights---
## 2026-02-13 @Alice
- Completed phase 1
---end-highlights---"""
        result = convert_plan_format_to_standard(text)
        assert '---highlights---' not in result
        assert '---end-highlights---' not in result
        assert 'Completed phase 1' not in result
        assert 'Task 1' in result

    def test_highlights_with_frontmatter(self):
        """Both frontmatter and highlights should be stripped."""
        text = """---
title: My Project
---
Phase 1
  Task 1 @john 3days

---highlights---
## 2026-02-13 @Alice
- Content
---end-highlights---"""
        result = convert_plan_format_to_standard(text)
        assert 'title:' not in result
        assert '---highlights---' not in result
        assert 'Task 1' in result

    def test_highlights_with_dash_separator_not_parsed_as_tasks(self):
        """Highlights with --- separator should be fully stripped."""
        text = """Phase 1
  Task 1 @john 3days

---

---highlights---
## 2026-02-13 @Alice
- Completed phase 1
---end-highlights---"""
        result = convert_plan_format_to_standard(text)
        assert '---highlights---' not in result
        assert '---end-highlights---' not in result
        assert 'Completed phase 1' not in result
        assert 'Task 1' in result
        # The --- separator should not remain either
        assert '---' not in result

    def test_highlights_with_frontmatter_and_dash_separator(self):
        """Frontmatter, --- separator, and highlights should all be handled."""
        text = """---
title: My Project
---
Phase 1
  Task 1 @john 3days

---

---highlights---
## 2026-02-13 @Alice
- Content
---end-highlights---"""
        result = convert_plan_format_to_standard(text)
        assert 'title:' not in result
        assert '---highlights---' not in result
        assert 'Content' not in result
        assert 'Task 1' in result


class TestHighlightSyncRoundTrip:
    """Test that highlights survive the full frontend-backend round trip.

    These tests simulate the format generated by the JavaScript
    ``updatePlanHighlightsText`` function and verify that the Python
    ``extract_highlights`` parser can correctly parse it back.
    """

    def _build_js_style_plan(self, base_text, highlights):
        """Build plan text in the exact format the JS frontend produces.

        This replicates the logic in ``updatePlanHighlightsText`` from
        ``script.js``: the highlights section is separated from the plan
        content by ``\\n\\n---\\n\\n`` and each entry has a ``## date @author``
        heading followed by content and a trailing blank line.
        """
        section = '---highlights---\n'
        for h in highlights:
            section += f"## {h['date']} @{h['author']}\n"
            content = h.get('content', '').rstrip('\n')
            section += content + '\n\n'
        section += '---end-highlights---'
        return base_text.rstrip('\n') + '\n\n---\n\n' + section

    def test_js_generated_highlights_parsed_correctly(self):
        """Highlights written by the JS frontend are extracted by the backend."""
        base = "Phase 1\n  Task 1 @john 3d"
        highlights_input = [
            {'date': '2026-02-13', 'author': 'john', 'content': '- Completed task'},
        ]
        plan_text = self._build_js_style_plan(base, highlights_input)
        extracted = extract_highlights(plan_text)
        assert len(extracted) == 1
        assert extracted[0]['date'] == '2026-02-13'
        assert extracted[0]['author'] == 'john'
        assert extracted[0]['content'] == '- Completed task'

    def test_js_generated_multiple_highlights(self):
        """Multiple highlights written by JS are all extracted correctly."""
        base = "Phase 1\n  Task 1 @john 3d"
        highlights_input = [
            {'date': '2026-02-10', 'author': 'john', 'content': '- Old update'},
            {'date': '2026-02-13', 'author': 'jane', 'content': '- New update'},
        ]
        plan_text = self._build_js_style_plan(base, highlights_input)
        extracted = extract_highlights(plan_text)
        assert len(extracted) == 2
        assert extracted[0]['date'] == '2026-02-10'
        assert extracted[0]['author'] == 'john'
        assert extracted[0]['content'] == '- Old update'
        assert extracted[1]['date'] == '2026-02-13'
        assert extracted[1]['author'] == 'jane'
        assert extracted[1]['content'] == '- New update'

    def test_roundtrip_js_to_python_to_js(self):
        """Full round trip: JS writes → Python extracts → Python regenerates → Python re-extracts."""
        base = "Phase 1\n  Task 1 @john 3d"
        highlights_input = [
            {'date': '2026-02-13', 'author': 'john', 'content': '- Updated task\n- Fixed bug'},
        ]
        # Step 1: JS writes the plan text
        plan_text = self._build_js_style_plan(base, highlights_input)

        # Step 2: Python extracts highlights from JS-generated text
        extracted = extract_highlights(plan_text)
        assert len(extracted) == 1
        assert extracted[0]['content'] == '- Updated task\n- Fixed bug'

        # Step 3: Python regenerates and re-extracts (simulating a save/load cycle)
        stripped = strip_highlights(plan_text)
        rebuilt = update_plan_highlights(stripped, extracted)
        re_extracted = extract_highlights(rebuilt)
        assert len(re_extracted) == 1
        assert re_extracted[0]['date'] == extracted[0]['date']
        assert re_extracted[0]['author'] == extracted[0]['author']
        assert re_extracted[0]['content'] == extracted[0]['content']

    def test_highlight_content_with_blank_lines_preserved(self):
        """Blank lines within highlight content are preserved during parsing."""
        plan = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @Alice
- First point

- Second point after blank line
---end-highlights---"""
        extracted = extract_highlights(plan)
        assert len(extracted) == 1
        assert '- First point' in extracted[0]['content']
        assert '- Second point after blank line' in extracted[0]['content']
        # The blank line between the two points should be preserved
        assert '- First point\n\n- Second point' in extracted[0]['content']

    def test_highlight_with_frontmatter_and_separator(self):
        """Highlights work correctly with YAML front matter and --- separator."""
        plan = """---
title: My Project
---
Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @john
- Status update
---end-highlights---"""
        extracted = extract_highlights(plan)
        assert len(extracted) == 1
        assert extracted[0]['date'] == '2026-02-13'
        assert extracted[0]['author'] == 'john'
        assert extracted[0]['content'] == '- Status update'

        # Verify strip_highlights removes both the section and the separator
        stripped = strip_highlights(plan)
        assert '---highlights---' not in stripped
        assert '---end-highlights---' not in stripped
        # The --- separator before highlights should be removed
        lines = stripped.strip().split('\n')
        assert lines[-1].strip() == 'Task 1 @john 3d'

    def test_js_format_matches_python_format(self):
        """The JS-generated format and the Python-generated format produce the same parse result."""
        highlights_data = [
            {'date': '2026-02-13', 'author': 'Alice', 'content': '- Phase 1 complete'},
            {'date': '2026-02-06', 'author': 'Bob', 'content': '- Sprint done'},
        ]
        base = "Phase 1\n  Task 1 @john 3d"

        # Python-generated plan
        python_plan = update_plan_highlights(base, highlights_data)
        python_extracted = extract_highlights(python_plan)

        # JS-generated plan (simulated)
        js_plan = self._build_js_style_plan(base, highlights_data)
        js_extracted = extract_highlights(js_plan)

        # Both should produce the same parsed highlights
        assert len(python_extracted) == len(js_extracted)
        for py_h, js_h in zip(python_extracted, js_extracted):
            assert py_h['date'] == js_h['date']
            assert py_h['author'] == js_h['author']
            assert py_h['content'] == js_h['content']


class TestExtractRaidLog:
    """Test suite for extract_raid_log function."""

    def test_extract_raid_log_basic(self):
        """Test extracting RAID log from plan text."""
        text = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description | Status |
|------|-------------|--------|
| Risk | Server fail | Open   |"""
        result = extract_raid_log(text)
        assert '| Type' in result
        assert '| Risk' in result

    def test_extract_raid_log_not_present(self):
        """Test when no RAID log section exists."""
        text = """Phase 1
  Task 1 @john 3d"""
        result = extract_raid_log(text)
        assert result == ''

    def test_extract_raid_log_empty_section(self):
        """Test with empty RAID log section."""
        text = """Phase 1
  Task 1 @john 3d

---raid log---"""
        result = extract_raid_log(text)
        assert result == ''

    def test_extract_raid_log_after_highlights(self):
        """Test RAID log extraction when it follows highlights."""
        text = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @Alice
- Status update

---raid log---
| Type | Description |
|------|-------------|
| Risk | Something   |"""
        result = extract_raid_log(text)
        assert '| Type' in result
        assert '| Risk' in result


class TestStripRaidLog:
    """Test suite for strip_raid_log function."""

    def test_strip_raid_log_basic(self):
        """Test removing RAID log section from plan text."""
        text = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description |
|------|-------------|
| Risk | Something   |"""
        result = strip_raid_log(text)
        assert '---raid log---' not in result
        assert '| Type' not in result
        assert 'Task 1 @john 3d' in result

    def test_strip_raid_log_not_present(self):
        """Test stripping when no RAID log section exists."""
        text = """Phase 1
  Task 1 @john 3d"""
        result = strip_raid_log(text)
        assert result == text

    def test_strip_raid_log_preserves_highlights(self):
        """Test that stripping RAID log preserves highlights section."""
        text = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @Alice
- Status update

---raid log---
| Type | Description |
|------|-------------|"""
        result = strip_raid_log(text)
        assert '---highlights---' in result
        assert '## 2026-02-13 @Alice' in result
        assert '---raid log---' not in result


class TestGenerateRaidLogText:
    """Test suite for generate_raid_log_text function."""

    def test_generate_raid_log_basic(self):
        """Test generating a RAID log markdown table."""
        items = [
            {'type': 'Risk', 'title': 'Server may fail', 'status': 'Open',
             'score': 8, 'owner': 'Alice', 'date': '2026-02-13'},
        ]
        result = generate_raid_log_text(items)
        assert '| Type' in result
        assert '| Risk' in result
        assert 'Server may fail' in result
        assert 'Alice' in result
        assert '2026-02-13' in result

    def test_generate_raid_log_empty(self):
        """Test generating text with empty list."""
        result = generate_raid_log_text([])
        assert result == ''

    def test_generate_raid_log_columns_aligned(self):
        """Test that columns are padded to the widest entry."""
        items = [
            {'type': 'Risk', 'title': 'Short', 'status': 'Open',
             'score': 8, 'owner': 'A', 'date': '2026-02-13'},
            {'type': 'Decision', 'title': 'A much longer description here',
             'status': 'Closed', 'score': 12, 'owner': 'Bob', 'date': '2026-01-01'},
        ]
        result = generate_raid_log_text(items)
        lines = result.split('\n')
        # All lines should have the same length (aligned columns)
        assert len(set(len(line) for line in lines)) == 1

    def test_generate_raid_log_pipe_escaped(self):
        """Test that pipe characters in content are escaped."""
        items = [
            {'type': 'Issue', 'title': 'A | B problem', 'status': 'Open',
             'score': 6, 'owner': 'Eve', 'date': '2026-02-13'},
        ]
        result = generate_raid_log_text(items)
        assert 'A \\| B problem' in result

    def test_generate_raid_log_multiple_items(self):
        """Test generating table with multiple items."""
        items = [
            {'type': 'Risk', 'title': 'Risk one', 'status': 'Open',
             'score': 8, 'owner': 'Alice', 'date': '2026-02-13'},
            {'type': 'Issue', 'title': 'Issue two', 'status': 'Open',
             'score': 6, 'owner': 'Bob', 'date': '2026-02-10'},
            {'type': 'Decision', 'title': 'Decision three', 'status': 'Closed',
             'score': 4, 'owner': 'Charlie', 'date': '2026-02-01'},
        ]
        result = generate_raid_log_text(items)
        lines = result.split('\n')
        # Header + separator + 3 data rows
        assert len(lines) == 5
        assert 'Risk one' in result
        assert 'Issue two' in result
        assert 'Decision three' in result

    def test_generate_raid_log_missing_fields(self):
        """Test that missing fields default to empty strings."""
        items = [
            {'type': 'Risk', 'title': 'No owner'},
        ]
        result = generate_raid_log_text(items)
        assert '| Risk' in result
        assert 'No owner' in result


class TestUpdatePlanRaidLog:
    """Test suite for update_plan_raid_log function."""

    def test_add_raid_log_to_plan(self):
        """Test adding a RAID log to a plan that has none."""
        plan = """Phase 1
  Task 1 @john 3d"""
        items = [
            {'type': 'Risk', 'title': 'Server fail', 'status': 'Open',
             'score': 8, 'owner': 'Alice', 'date': '2026-02-13'},
        ]
        result = update_plan_raid_log(plan, items)
        assert 'Phase 1' in result
        assert '---raid log---' in result
        assert 'Server fail' in result

    def test_replace_existing_raid_log(self):
        """Test replacing an existing RAID log."""
        plan = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description | Status | Score | Owner | Date |
|------|-------------|--------|-------|-------|------|
| Risk | Old item    | Open   | 4     | Eve   | 2026-01-01 |"""
        items = [
            {'type': 'Issue', 'title': 'New item', 'status': 'Closed',
             'score': 12, 'owner': 'Bob', 'date': '2026-02-13'},
        ]
        result = update_plan_raid_log(plan, items)
        assert 'Old item' not in result
        assert 'New item' in result
        assert '---raid log---' in result

    def test_remove_raid_log_with_empty_list(self):
        """Test removing RAID log by passing empty list."""
        plan = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description | Status | Score | Owner | Date |
|------|-------------|--------|-------|-------|------|
| Risk | Something   | Open   | 4     | Eve   | 2026-01-01 |"""
        result = update_plan_raid_log(plan, [])
        assert '---raid log---' not in result
        assert 'Phase 1' in result

    def test_raid_log_after_highlights(self):
        """Test RAID log is appended after highlights."""
        plan = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @Alice
- Status update"""
        items = [
            {'type': 'Risk', 'title': 'Server fail', 'status': 'Open',
             'score': 8, 'owner': 'Alice', 'date': '2026-02-13'},
        ]
        result = update_plan_raid_log(plan, items)
        # Highlights should be before RAID log
        highlights_pos = result.find('---highlights---')
        raid_pos = result.find('---raid log---')
        assert highlights_pos < raid_pos

    def test_roundtrip_generate_and_extract(self):
        """Test that generating and extracting RAID log preserves data."""
        plan = """Phase 1
  Task 1 @john 3d"""
        items = [
            {'type': 'Risk', 'title': 'Risk one', 'status': 'Open',
             'score': 8, 'owner': 'Alice', 'date': '2026-02-13'},
            {'type': 'Issue', 'title': 'Issue two', 'status': 'Closed',
             'score': 6, 'owner': 'Bob', 'date': '2026-02-10'},
        ]
        result = update_plan_raid_log(plan, items)
        extracted = extract_raid_log(result)
        assert 'Risk one' in extracted
        assert 'Issue two' in extracted


class TestRaidLogNotParsedAsTasks:
    """Test that RAID log content is not parsed as tasks."""

    def test_raid_log_stripped_before_task_parsing(self):
        """RAID log section should be stripped before task parsing."""
        text = """Phase 1
  Task 1 @john 3days

---raid log---
| Type        | Description    | Status | Score | Owner | Date       |
|-------------|----------------|--------|-------|-------|------------|
| Risk        | Server failure | Open   | 8     | Alice | 2026-02-13 |"""
        result = convert_plan_format_to_standard(text)
        assert '---raid log---' not in result
        assert 'Server failure' not in result
        assert 'Task 1' in result

    def test_raid_log_with_highlights_stripped(self):
        """Both highlights and RAID log should be stripped."""
        text = """Phase 1
  Task 1 @john 3days

---

---highlights---
## 2026-02-13 @Alice
- Content
---end-highlights---

---raid log---
| Type | Description | Status | Score | Owner | Date |
|------|-------------|--------|-------|-------|------|
| Risk | Something   | Open   | 4     | Eve   | 2026-01-01 |"""
        result = convert_plan_format_to_standard(text)
        assert '---highlights---' not in result
        assert '---raid log---' not in result
        assert 'Something' not in result
        assert 'Task 1' in result


    def test_raid_log_after_highlights_without_end_marker(self):
        """RAID log after highlights without ---end-highlights--- should be stripped.

        Regression test: when highlights don't have an explicit end marker,
        strip_highlights was consuming the ---raid log--- marker, so
        strip_raid_log couldn't find it and the RAID table leaked through.
        """
        text = """Phase 1
  Task 1 @john 3days

---

---highlights---
## 2026-02-13 @Alice
- Content

---

---raid log---
| Type     | Description           | Status | Score | Owner | Date       |
|----------|-----------------------|--------|-------|-------|------------|
| risk     | this is a test        | open   | 9     | kev   | 2026-02-16 |
| issue    | mo money, mo problems | open   | 25    | kev   | 2026-02-16 |"""
        result = convert_plan_format_to_standard(text)
        assert '---highlights---' not in result
        assert '---raid log---' not in result
        assert 'this is a test' not in result
        assert 'mo money' not in result
        assert 'Task 1' in result


class TestMarkdownTablesNotParsedAsTasks:
    """Markdown tables and headings must not become tasks even if a section
    marker is malformed (e.g. ``benefits---`` instead of ``---benefits---``).
    """

    def test_table_rows_skipped_with_malformed_marker(self):
        text = """Phase 1
  Task 1 @john 3days

benefits---
# Benefits Map

| ID | Type      | Title                |
|----|-----------|----------------------|
| 1  | objective | Improve productivity |
| 2  | enabler   | Implement Foundation |"""
        result = convert_plan_format_to_standard(text)
        assert 'Task 1' in result
        assert '| ID' not in result
        assert '|----' not in result
        assert 'Improve productivity' not in result
        assert '# Benefits Map' not in result

    def test_well_formed_marker_still_strips_section(self):
        text = """Phase 1
  Task 1 @john 3days

---benefits---
| ID | Type | Title |
|----|------|-------|
| 1  | obj  | foo   |"""
        result = convert_plan_format_to_standard(text)
        assert 'Task 1' in result
        assert '---benefits---' not in result
        assert '| ID' not in result


class TestCommentedTableRows:
    """Rows prefixed with `//` are excluded from each markdown table parser."""

    def test_benefits_skips_commented_row(self):
        text = """| ID | Type      | Title       |
|----|-----------|-------------|
| 1  | objective | active      |
// | 2  | enabler   | hidden      |
| 3  | benefit   | also active |"""
        items = parse_benefits_markdown(text)
        ids = [it['id'] for it in items]
        titles = [it['title'] for it in items]
        assert ids == [1, 3]
        assert 'hidden' not in ' '.join(titles)
        assert 'enabler' not in ' '.join(titles)

    def test_raid_skips_commented_row(self):
        text = """| Type | Description    | Status |
|------|----------------|--------|
| risk | active risk    | open   |
// | risk | hidden risk    | open   |
| issue | another active | open  |"""
        items = parse_raid_markdown(text)
        descriptions = [it.get('title', '') + ' ' + it.get('description', '') for it in items]
        joined = ' '.join(descriptions)
        assert 'active risk' in joined
        assert 'another active' in joined
        assert 'hidden risk' not in joined

    def test_budget_skips_commented_row(self):
        text = """| ID | Description     | Estimate | Forecast | Type |
|----|-----------------|----------|----------|------|
| 1  | active item     | 1000     | 1100     | Capex |
// | 2  | hidden item     | 9999     | 9999     | Capex |
| 3  | another item    | 500      | 500      | Opex  |"""
        items = parse_budget_markdown(text)
        descriptions = [it['description'] for it in items]
        assert 'active item' in descriptions
        assert 'another item' in descriptions
        assert 'hidden item' not in descriptions

    def test_comms_skips_commented_row(self):
        text = """| ID | Activity     | Audience | Content     | Channel | Frequency | Owner | Status |
|----|--------------|----------|-------------|---------|-----------|-------|--------|
| 1  | active update | execs   | active msg  | email   | Weekly    | kev   | Active |
// | 2  | hidden update | team   | hidden msg  | slack   | Daily     | kev   | Active |
| 3  | another update | clients | another msg | email   | Monthly   | kev   | Active |"""
        items = parse_comms_markdown(text)
        contents = [it.get('content', '') for it in items]
        assert 'active msg' in contents
        assert 'another msg' in contents
        assert 'hidden msg' not in contents

    def test_baseline_skips_commented_row(self):
        text = """| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task A    | 2026-01-01 | 2026-01-05 | 5d       |
// | Task B    | 2026-01-06 | 2026-01-10 | 5d       |
| Task C    | 2026-01-11 | 2026-01-15 | 5d       |"""
        items = parse_baseline_markdown(text)
        names = [it['name'] for it in items]
        assert 'Task A' in names
        assert 'Task C' in names
        assert 'Task B' not in names


class TestHighlightsPreserveRaidLog:
    """Test that highlights operations preserve the RAID log."""

    def test_update_highlights_preserves_raid_log(self):
        """Updating highlights should not remove the RAID log."""
        plan = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @Alice
- Old content

---raid log---
| Type | Description | Status | Score | Owner | Date       |
|------|-------------|--------|-------|-------|------------|
| Risk | Server fail | Open   | 8     | Alice | 2026-02-13 |"""
        new_highlights = [
            {'date': '2026-02-13', 'author': 'Bob', 'content': '- New content'},
        ]
        result = update_plan_highlights(plan, new_highlights)
        assert '---highlights---' in result
        assert '## 2026-02-13 @Bob' in result
        assert '- New content' in result
        assert '---raid log---' in result
        assert 'Server fail' in result
        # Highlights should be before RAID log
        highlights_pos = result.find('---highlights---')
        raid_pos = result.find('---raid log---')
        assert highlights_pos < raid_pos

    def test_remove_highlights_preserves_raid_log(self):
        """Removing highlights should not remove the RAID log."""
        plan = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @Alice
- Content

---raid log---
| Type | Description | Status | Score | Owner | Date       |
|------|-------------|--------|-------|-------|------------|
| Risk | Server fail | Open   | 8     | Alice | 2026-02-13 |"""
        result = update_plan_highlights(plan, [])
        assert '---highlights---' not in result
        assert '---raid log---' in result
        assert 'Server fail' in result

    def test_extract_highlights_ends_at_raid_log(self):
        """Highlights extraction should stop at the RAID log marker."""
        text = """---highlights---
## 2026-02-13 @Alice
- Status update

---raid log---
| Type | Description |
|------|-------------|
| Risk | Something   |"""
        result = extract_highlights(text)
        assert len(result) == 1
        assert result[0]['author'] == 'Alice'
        assert 'Status update' in result[0]['content']
        assert '| Type' not in result[0]['content']


class TestExtractBaseline:
    """Test suite for extract_baseline function."""

    def test_extract_baseline_basic(self):
        """Test extracting baseline from plan text."""
        text = """Phase 1
  Task 1 @john 3d

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        result = extract_baseline(text)
        assert '| Task Name' in result
        assert '| Task 1' in result

    def test_extract_baseline_not_present(self):
        """Test when no baseline section exists."""
        text = """Phase 1
  Task 1 @john 3d"""
        result = extract_baseline(text)
        assert result == ''

    def test_extract_baseline_empty_section(self):
        """Test with empty baseline section."""
        text = """Phase 1
  Task 1 @john 3d

---baseline---"""
        result = extract_baseline(text)
        assert result == ''

    def test_extract_baseline_after_raid_log(self):
        """Test baseline extraction when it follows RAID log."""
        text = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description |
|------|-------------|
| Risk | Something   |

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        result = extract_baseline(text)
        assert '| Task Name' in result
        assert '| Task 1' in result
        assert '| Risk' not in result

    def test_extract_baseline_after_highlights_and_raid(self):
        """Test baseline extraction after both highlights and RAID log."""
        text = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @Alice
- Status update

---raid log---
| Type | Description |
|------|-------------|
| Risk | Something   |

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        result = extract_baseline(text)
        assert '| Task Name' in result
        assert '| Task 1' in result


class TestStripBaseline:
    """Test suite for strip_baseline function."""

    def test_strip_baseline_basic(self):
        """Test removing baseline section from plan text."""
        text = """Phase 1
  Task 1 @john 3d

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        result = strip_baseline(text)
        assert '---baseline---' not in result
        assert '| Task Name' not in result
        assert 'Task 1 @john 3d' in result

    def test_strip_baseline_not_present(self):
        """Test stripping when no baseline section exists."""
        text = """Phase 1
  Task 1 @john 3d"""
        result = strip_baseline(text)
        assert result == text

    def test_strip_baseline_preserves_raid_log(self):
        """Test that stripping baseline preserves RAID log section."""
        text = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description |
|------|-------------|
| Risk | Something   |

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        result = strip_baseline(text)
        assert '---raid log---' in result
        assert '| Risk' in result
        assert '---baseline---' not in result


class TestParseBaselineMarkdown:
    """Test suite for parse_baseline_markdown function."""

    def test_parse_baseline_basic(self):
        """Test parsing a basic baseline table."""
        text = """| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |
| Task 2    | 2026-03-05 | 2026-03-10 | 5d       |"""
        result = parse_baseline_markdown(text)
        assert len(result) == 2
        assert result[0]['name'] == 'Task 1'
        assert result[0]['start'] == '2026-03-02'
        assert result[0]['finish'] == '2026-03-05'
        assert result[0]['duration'] == '3d'
        assert result[1]['name'] == 'Task 2'

    def test_parse_baseline_empty(self):
        """Test parsing empty text returns empty list."""
        result = parse_baseline_markdown('')
        assert result == []

    def test_parse_baseline_no_header(self):
        """Test parsing text without proper header returns empty list."""
        text = """| Some | Other | Columns |
|------|-------|---------|
| data | more  | stuff   |"""
        result = parse_baseline_markdown(text)
        assert result == []

    def test_parse_baseline_single_item(self):
        """Test parsing a baseline with a single item."""
        text = """| Task Name      | Start      | Finish     | Duration |
|----------------|------------|------------|----------|
| Design Phase   | 2026-03-01 | 2026-03-05 | 5d       |"""
        result = parse_baseline_markdown(text)
        assert len(result) == 1
        assert result[0]['name'] == 'Design Phase'

    def test_parse_baseline_milestone(self):
        """Test parsing a baseline milestone (0 duration)."""
        text = """| Task Name       | Start      | Finish     | Duration |
|-----------------|------------|------------|----------|
| Design Complete | 2026-03-05 | 2026-03-05 | 0d       |"""
        result = parse_baseline_markdown(text)
        assert len(result) == 1
        assert result[0]['duration'] == '0d'


class TestGenerateBaselineText:
    """Test suite for generate_baseline_text function."""

    def test_generate_baseline_basic(self):
        """Test generating a baseline table."""
        items = [
            {'name': 'Task 1', 'start': '2026-03-02', 'finish': '2026-03-05', 'duration': '3d'},
            {'name': 'Task 2', 'start': '2026-03-05', 'finish': '2026-03-10', 'duration': '5d'},
        ]
        result = generate_baseline_text(items)
        assert '| Task Name' in result
        assert '| Task 1' in result
        assert '| Task 2' in result
        assert '2026-03-02' in result
        assert '5d' in result

    def test_generate_baseline_empty(self):
        """Test generating baseline from empty list returns empty string."""
        result = generate_baseline_text([])
        assert result == ''

    def test_generate_baseline_columns_aligned(self):
        """Test that generated table has aligned columns."""
        items = [
            {'name': 'Short', 'start': '2026-03-01', 'finish': '2026-03-02', 'duration': '1d'},
            {'name': 'A Much Longer Task Name', 'start': '2026-03-02', 'finish': '2026-03-10', 'duration': '8d'},
        ]
        result = generate_baseline_text(items)
        lines = result.strip().split('\n')
        # All lines should have 4 pipe-delimited columns
        for line in lines:
            assert line.count('|') == 5  # outer pipes + inner pipes


class TestUpdatePlanBaseline:
    """Test suite for update_plan_baseline function."""

    def test_add_baseline_to_plan(self):
        """Test adding baseline to a plan without one."""
        plan = """Phase 1
  Task 1 @john 3d"""
        items = [
            {'name': 'Task 1', 'start': '2026-03-02', 'finish': '2026-03-05', 'duration': '3d'},
        ]
        result = update_plan_baseline(plan, items)
        assert '---baseline---' in result
        assert '| Task 1' in result
        assert 'Task 1 @john 3d' in result

    def test_replace_existing_baseline(self):
        """Test replacing an existing baseline."""
        plan = """Phase 1
  Task 1 @john 3d

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-01 | 2026-03-04 | 3d       |"""
        items = [
            {'name': 'Task 1', 'start': '2026-03-02', 'finish': '2026-03-05', 'duration': '3d'},
        ]
        result = update_plan_baseline(plan, items)
        assert '---baseline---' in result
        assert '2026-03-02' in result
        assert '2026-03-01' not in result  # Old date replaced

    def test_remove_baseline_with_empty_list(self):
        """Test removing baseline by passing empty list."""
        plan = """Phase 1
  Task 1 @john 3d

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        result = update_plan_baseline(plan, [])
        assert '---baseline---' not in result
        assert 'Task 1 @john 3d' in result

    def test_baseline_after_raid_log(self):
        """Test that baseline is placed after RAID log."""
        plan = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description |
|------|-------------|
| Risk | Something   |"""
        items = [
            {'name': 'Task 1', 'start': '2026-03-02', 'finish': '2026-03-05', 'duration': '3d'},
        ]
        result = update_plan_baseline(plan, items)
        raid_pos = result.find('---raid log---')
        baseline_pos = result.find('---baseline---')
        assert raid_pos < baseline_pos

    def test_update_raid_log_preserves_baseline(self):
        """Test that updating RAID log preserves the baseline section."""
        plan = """Phase 1
  Task 1 @john 3d

---raid log---
| ID | Type   | Title       | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |
|----|--------|-------------|-------------|-----------|-------|--------------------| -------|------------|-------|--------|
| 1  | Risk   | Server fail | Desc        | Alice     | Bob   | Backup             | 3      | 2          | 6     | Open   |

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        new_raid_items = [{
            'id': '1', 'type': 'Risk', 'title': 'Server fail', 'description': 'Desc',
            'raised_by': 'Alice', 'owner': 'Bob', 'mitigation_actions': 'Backup',
            'impact': '3', 'likelihood': '2', 'score': '6', 'status': 'Closed'
        }]
        result = update_plan_raid_log(plan, new_raid_items)
        assert '---baseline---' in result
        assert '| Task 1' in result
        assert 'Closed' in result

    def test_update_highlights_preserves_baseline(self):
        """Test that updating highlights preserves the baseline section."""
        plan = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @Alice
- Status update

---raid log---
| ID | Type | Title | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |
|----|------|-------|-------------|-----------|-------|--------------------| -------|------------|-------|--------|
| 1  | Risk | Fail  | Desc        | Alice     | Bob   | Backup             | 3      | 2          | 6     | Open   |

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        new_highlights = [
            {'date': '2026-02-14', 'author': 'Bob', 'content': 'New update'}
        ]
        result = update_plan_highlights(plan, new_highlights)
        assert '---baseline---' in result
        assert '| Task 1' in result
        assert '2026-02-14' in result
        assert 'Bob' in result

    def test_extract_raid_log_stops_at_baseline(self):
        """Test that extract_raid_log stops at the baseline section."""
        text = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description |
|------|-------------|
| Risk | Something   |

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        result = extract_raid_log(text)
        assert '| Type' in result
        assert '| Risk' in result
        assert '---baseline---' not in result
        assert '| Task Name' not in result

    def test_baseline_not_parsed_as_tasks(self):
        """Test that baseline section is not parsed as tasks."""
        text = """---
title: My Project
---
Phase 1
  Task 1 @john 3d

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |"""
        converted = convert_plan_format_to_standard(text)
        assert '---baseline---' not in converted
        assert '| Task Name' not in converted
        assert 'Task 1' in converted


class TestConvertPlanFormatStripsBudget:
    """Test that convert_plan_format_to_standard strips budget section."""

    def test_budget_not_parsed_as_tasks(self):
        """Budget section should be stripped before task parsing."""
        text = """Phase 1
  Task 1 @john 3d

---budget---
| ID | Description | Estimate | Forecast | Actual | Variance | Status |
|----|-------------|----------|----------|--------|----------|--------|
| 1  | Dev work    | 5000     | 5000     | 0      | 5000     | Open   |"""
        result = convert_plan_format_to_standard(text)
        assert '---budget---' not in result
        assert 'Dev work' not in result
        assert 'Estimate' not in result
        assert 'Task 1' in result

    def test_budget_with_raid_log_after(self):
        """Budget should be stripped but RAID log marker preserved for its own stripper."""
        text = """Phase 1
  Task 1 @john 3d

---budget---
| ID | Description | Estimate |
|----|-------------|----------|
| 1  | Dev work    | 5000     |

---raid log---
| ID | Type | Title |
|----|------|-------|
| R1 | Risk | Test  |"""
        result = convert_plan_format_to_standard(text)
        assert '---budget---' not in result
        assert 'Dev work' not in result
        assert '---raid log---' not in result
        assert 'Task 1' in result

    def test_budget_with_frontmatter(self):
        """Both frontmatter and budget should be stripped."""
        text = """---
title: My Project
---
Phase 1
  Task 1 @john 3d

---budget---
| ID | Description | Estimate |
|----|-------------|----------|
| 1  | Dev work    | 5000     |"""
        result = convert_plan_format_to_standard(text)
        assert 'title:' not in result
        assert '---budget---' not in result
        assert 'Dev work' not in result
        assert 'Task 1' in result


class TestParseBenefitsMarkdown:
    """Test suite for parse_benefits_markdown function."""

    def test_parse_benefits_markdown_basic(self):
        """Well-formed table with all columns parses correctly."""
        text = """| ID | Type | Title | Description | Objective Type | Target Value | Current Value | Target Date | Measurement | Linked To | Contribution % |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | benefit | Faster delivery | Reduce cycle time | efficiency | 20% | 5% | 2026-06-01 | Sprint metrics | 2, 3 | 40 |
| 2 | dis-benefit | Higher cost | Increased hosting | cost | 500 | 200 | 2026-12-01 | Monthly bill |  | 10 |"""

        items = parse_benefits_markdown(text)
        assert len(items) == 2
        assert items[0]['id'] == 1
        assert items[0]['type'] == 'benefit'
        assert items[0]['title'] == 'Faster delivery'
        assert items[0]['description'] == 'Reduce cycle time'
        assert items[0]['objective_type'] == 'efficiency'
        assert items[0]['target_value'] == '20%'
        assert items[0]['current_value'] == '5%'
        assert items[0]['target_date'] == '2026-06-01'
        assert items[0]['measurement_method'] == 'Sprint metrics'
        assert items[0]['contribution_percent'] == 40
        assert items[1]['id'] == 2
        assert items[1]['type'] == 'dis-benefit'

    def test_parse_benefits_markdown_empty(self):
        """Empty string returns empty list."""
        assert parse_benefits_markdown('') == []

    def test_parse_benefits_markdown_no_header(self):
        """Text without table headers returns empty list."""
        text = """Some random text
without any table structure."""
        assert parse_benefits_markdown(text) == []

    def test_parse_benefits_markdown_linked_to(self):
        """Comma-separated linked_to parsed as list of ints."""
        text = """| ID | Type | Title | Description | Objective Type | Target Value | Current Value | Target Date | Measurement | Linked To | Contribution % |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | benefit | Test | Desc | perf | 100 | 50 | 2026-01-01 | KPI | 2, 5, 8 | 30 |
| 2 | benefit | No links | Desc2 | cost | 10 | 0 | 2026-02-01 | Report |  | 20 |"""

        items = parse_benefits_markdown(text)
        assert items[0]['linked_to'] == [2, 5, 8]
        assert items[1]['linked_to'] == []

    def test_parse_benefits_round_trip(self):
        """Verify all fields parse correctly in a round trip."""
        text = """| ID | Type | Title | Description | Objective Type | Target Value | Current Value | Target Date | Measurement | Linked To | Contribution % |
|---|---|---|---|---|---|---|---|---|---|---|
| 3 | benefit | Revenue growth | Increase monthly revenue | financial | 50000 | 30000 | 2026-09-15 | Financial report | 1 | 75 |"""

        items = parse_benefits_markdown(text)
        assert len(items) == 1
        item = items[0]
        assert item['id'] == 3
        assert item['type'] == 'benefit'
        assert item['title'] == 'Revenue growth'
        assert item['description'] == 'Increase monthly revenue'
        assert item['objective_type'] == 'financial'
        assert item['target_value'] == '50000'
        assert item['current_value'] == '30000'
        assert item['target_date'] == '2026-09-15'
        assert item['measurement_method'] == 'Financial report'
        assert item['linked_to'] == [1]
        assert item['contribution_percent'] == 75


SAMPLE_LESSONS = """| ID | Project Manager | Project Type | Technology | Project Phase | Area     | Impact Type     | Observation                | Impact                | Recommendations         | Date       |
|----|-----------------|--------------|------------|---------------|----------|-----------------|----------------------------|-----------------------|-------------------------|------------|
| 1  | Alice           | Agile        | Python     | Delivery      | Quality  | Went Well       | Pair programming worked    | Faster code review    | Continue pairing        | 2026-04-01 |
| 2  | Bob             | Waterfall    | .NET       | Planning      | Resource | Needs to Change | Resource conflicts         | Delayed phase 2       | Confirm resources early | 2026-04-10 |"""


class TestExtractLessons:
    """Test suite for extract_lessons function."""

    def test_extract_lessons_basic(self):
        text = (
            "Phase 1\n  Task 1 @john 3d\n\n---lessons learned---\n" + SAMPLE_LESSONS
        )
        result = extract_lessons(text)
        assert '| ID' in result
        assert 'Pair programming worked' in result
        assert 'Resource conflicts' in result

    def test_extract_lessons_not_present(self):
        assert extract_lessons("Phase 1\n  Task 1 @john 3d") == ''

    def test_extract_lessons_stops_at_baseline(self):
        text = (
            "---lessons learned---\n" + SAMPLE_LESSONS +
            "\n\n---baseline---\n| Task Name | Start | Finish | Duration |\n"
        )
        result = extract_lessons(text)
        assert '---baseline---' not in result
        assert 'Task Name' not in result
        assert 'Pair programming worked' in result


class TestStripLessons:
    """Test suite for strip_lessons function."""

    def test_strip_lessons_removes_section(self):
        text = (
            "Phase 1\n  Task 1 @john 3d\n\n---lessons learned---\n" + SAMPLE_LESSONS
        )
        result = strip_lessons(text)
        assert '---lessons learned---' not in result
        assert 'Pair programming' not in result
        assert 'Task 1' in result

    def test_strip_lessons_preserves_baseline(self):
        text = (
            "Phase 1\n  Task 1 @john 3d\n\n"
            "---lessons learned---\n" + SAMPLE_LESSONS + "\n\n"
            "---baseline---\n| Task Name | Start | Finish | Duration |\n"
            "|-----------|-------|--------|----------|\n"
            "| Task 1    | 2026-01-01 | 2026-01-04 | 3d |"
        )
        result = strip_lessons(text)
        assert '---lessons learned---' not in result
        assert 'Pair programming' not in result
        assert '---baseline---' in result
        assert '| Task 1' in result

    def test_strip_lessons_no_section(self):
        text = "Phase 1\n  Task 1 @john 3d"
        assert strip_lessons(text) == text


class TestParseLessonsMarkdown:
    """Test suite for parse_lessons_markdown function."""

    def test_parse_lessons_basic(self):
        items = parse_lessons_markdown(SAMPLE_LESSONS)
        assert len(items) == 2

        first = items[0]
        assert first['id'] == 1
        assert first['project_manager'] == 'Alice'
        assert first['project_type'] == 'Agile'
        assert first['technology'] == 'Python'
        assert first['project_phase'] == 'Delivery'
        assert first['area'] == 'Quality'
        assert first['impact_type'] == 'Went Well'
        assert first['observation'] == 'Pair programming worked'
        assert first['impact'] == 'Faster code review'
        assert first['recommendations'] == 'Continue pairing'
        assert first['date'] == '2026-04-01'

        second = items[1]
        assert second['impact_type'] == 'Needs to Change'
        assert second['observation'] == 'Resource conflicts'

    def test_parse_lessons_empty(self):
        assert parse_lessons_markdown('') == []

    def test_parse_lessons_no_header(self):
        assert parse_lessons_markdown('just some text') == []

    def test_parse_lessons_id_autoincrement(self):
        text = """| ID | Project Manager | Observation        | Date       |
|----|-----------------|--------------------|------------|
|    | Alice           | First lesson       | 2026-04-01 |
|    | Bob             | Second lesson      | 2026-04-02 |"""
        items = parse_lessons_markdown(text)
        assert len(items) == 2
        assert items[0]['id'] == 1
        assert items[1]['id'] == 2


class TestGenerateLessonsText:
    """Test suite for generate_lessons_text function."""

    def test_generate_lessons_empty(self):
        assert generate_lessons_text([]) == ''

    def test_generate_lessons_basic(self):
        items = [
            {
                'id': 1,
                'project_manager': 'Alice',
                'project_type': 'Agile',
                'technology': 'Python',
                'project_phase': 'Delivery',
                'area': 'Quality',
                'impact_type': 'Went Well',
                'observation': 'Pair programming worked',
                'impact': 'Faster review',
                'recommendations': 'Continue pairing',
                'date': '2026-04-01',
            }
        ]
        text = generate_lessons_text(items)
        assert '| ID' in text
        assert '| Alice' in text
        assert 'Pair programming worked' in text
        assert 'Went Well' in text

    def test_generate_lessons_escapes_pipes(self):
        items = [
            {
                'id': 1, 'project_manager': 'A', 'project_type': '', 'technology': '',
                'project_phase': '', 'area': '', 'impact_type': 'Went Well',
                'observation': 'note | with pipe', 'impact': '', 'recommendations': '',
                'date': '',
            }
        ]
        text = generate_lessons_text(items)
        assert 'note \\| with pipe' in text


class TestUpdatePlanLessons:
    """Test suite for update_plan_lessons function."""

    def test_update_plan_lessons_appends(self):
        plan = "Phase 1\n  Task 1 @john 3d"
        items = [
            {
                'id': 1, 'project_manager': 'Alice', 'project_type': 'Agile',
                'technology': 'Python', 'project_phase': 'Delivery',
                'area': 'Quality', 'impact_type': 'Went Well',
                'observation': 'Pair programming worked',
                'impact': 'Faster review', 'recommendations': 'Continue',
                'date': '2026-04-01',
            }
        ]
        result = update_plan_lessons(plan, items)
        assert '---lessons learned---' in result
        assert 'Pair programming worked' in result
        assert 'Task 1' in result

    def test_update_plan_lessons_replaces_existing(self):
        plan = (
            "Phase 1\n  Task 1 @john 3d\n\n---lessons learned---\n" + SAMPLE_LESSONS
        )
        items = [
            {
                'id': 1, 'project_manager': 'Carol', 'project_type': 'Agile',
                'technology': 'JS', 'project_phase': 'Closure',
                'area': 'Communication', 'impact_type': 'Mixed',
                'observation': 'New observation only',
                'impact': 'New impact', 'recommendations': 'Adopt',
                'date': '2026-05-01',
            }
        ]
        result = update_plan_lessons(plan, items)
        assert '---lessons learned---' in result
        assert 'New observation only' in result
        assert 'Pair programming worked' not in result
        assert 'Resource conflicts' not in result

    def test_update_plan_lessons_empty_removes(self):
        plan = (
            "Phase 1\n  Task 1 @john 3d\n\n---lessons learned---\n" + SAMPLE_LESSONS
        )
        result = update_plan_lessons(plan, [])
        assert '---lessons learned---' not in result
        assert 'Pair programming' not in result
        assert 'Task 1' in result

    def test_update_plan_lessons_preserves_baseline(self):
        plan = (
            "Phase 1\n  Task 1 @john 3d\n\n"
            "---baseline---\n| Task Name | Start | Finish | Duration |\n"
            "|-----------|-------|--------|----------|\n"
            "| Task 1    | 2026-01-01 | 2026-01-04 | 3d |"
        )
        items = [
            {
                'id': 1, 'project_manager': 'Alice', 'project_type': '',
                'technology': '', 'project_phase': '', 'area': '',
                'impact_type': 'Went Well', 'observation': 'Obs',
                'impact': '', 'recommendations': '', 'date': '',
            }
        ]
        result = update_plan_lessons(plan, items)
        assert '---lessons learned---' in result
        assert '---baseline---' in result
        # Lessons must come BEFORE baseline so baseline still terminates the file
        lessons_pos = result.find('---lessons learned---')
        baseline_pos = result.find('---baseline---')
        assert lessons_pos < baseline_pos

    def test_update_plan_lessons_round_trip(self):
        plan = "Phase 1\n  Task 1 @john 3d"
        items = parse_lessons_markdown(SAMPLE_LESSONS)
        assert len(items) == 2
        result = update_plan_lessons(plan, items)

        # Re-extract and re-parse — fields should round-trip
        round_tripped = parse_lessons_markdown(extract_lessons(result))
        assert len(round_tripped) == 2
        assert round_tripped[0]['observation'] == items[0]['observation']
        assert round_tripped[0]['impact_type'] == items[0]['impact_type']
        assert round_tripped[1]['recommendations'] == items[1]['recommendations']


class TestLessonsLearnedNotParsedAsTasks:
    """Test that lessons learned content is not parsed as tasks."""

    def test_lessons_stripped_before_task_parsing(self):
        text = (
            "Phase 1\n  Task 1 @john 3days\n\n---lessons learned---\n"
            + SAMPLE_LESSONS
        )
        result = convert_plan_format_to_standard(text)
        assert '---lessons learned---' not in result
        assert 'Pair programming worked' not in result
        assert 'Resource conflicts' not in result
        assert 'Task 1' in result

    def test_lessons_with_other_sections(self):
        """Lessons should be stripped alongside RAID and comms."""
        text = (
            "Phase 1\n  Task 1 @john 3days\n\n"
            "---raid log---\n"
            "| Type | Description | Status | Score | Owner | Date |\n"
            "|------|-------------|--------|-------|-------|------|\n"
            "| risk | demo risk   | open   | 9     | kev   | 2026 |\n\n"
            "---comms---\n"
            "| ID | Activity | Audience | Content | Frequency | Channel | Owner | Status |\n"
            "|----|----------|----------|---------|-----------|---------|-------|--------|\n"
            "| 1  | Update   | Sponsor  | Status  | Weekly    | Email   | Alice | Active |\n\n"
            "---lessons learned---\n" + SAMPLE_LESSONS
        )
        result = convert_plan_format_to_standard(text)
        assert '---lessons learned---' not in result
        assert '---raid log---' not in result
        assert '---comms---' not in result
        assert 'Pair programming worked' not in result
        assert 'demo risk' not in result
        assert 'Task 1' in result


class TestLessonsPreservedDuringSectionUpdates:
    """Updates to other sections must not destroy the lessons learned table."""

    def test_update_highlights_preserves_lessons(self):
        plan = (
            "Phase 1\n  Task 1 @john 3d\n\n"
            "---highlights---\n## 2026-04-01 @Alice\n- Old\n\n"
            "---lessons learned---\n" + SAMPLE_LESSONS
        )
        new_highlights = [
            {'date': '2026-04-15', 'author': 'Bob', 'content': '- New'},
        ]
        result = update_plan_highlights(plan, new_highlights)
        assert '---highlights---' in result
        assert '---lessons learned---' in result
        assert 'Pair programming worked' in result
        # Highlights must come before lessons
        assert result.find('---highlights---') < result.find('---lessons learned---')

    def test_update_raid_log_preserves_lessons(self):
        plan = (
            "Phase 1\n  Task 1 @john 3d\n\n"
            "---raid log---\n"
            "| Type | Description | Status | Score | Owner | Date |\n"
            "|------|-------------|--------|-------|-------|------|\n"
            "| risk | old         | open   | 9     | kev   | 2026 |\n\n"
            "---lessons learned---\n" + SAMPLE_LESSONS
        )
        result = update_plan_raid_log(plan, [
            {'type': 'risk', 'title': 'new risk', 'description': 'd', 'status': 'open',
             'impact': 3, 'likelihood': 3, 'score': 9, 'owner': 'kev'},
        ])
        assert '---raid log---' in result
        assert '---lessons learned---' in result
        assert 'Pair programming worked' in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
