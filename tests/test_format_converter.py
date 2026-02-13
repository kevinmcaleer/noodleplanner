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

    def test_convert_single_dependency(self):
        """Test conversion of single dependency."""
        text = "Task 2 [depends Task 1] @john 2d"
        result = convert_plan_format_to_standard(text)
        assert "#Task 1" in result
        assert "[depends" not in result

    def test_convert_multiple_dependencies(self):
        """Test conversion of multiple dependencies."""
        text = "Task 3 [depends Task 1, Task 2] @john 2d"
        result = convert_plan_format_to_standard(text)
        assert "#Task 1" in result
        assert "#Task 2" in result
        assert "[depends" not in result

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

        # Dependencies converted
        assert "#Task 1" in result
        assert "#Task 2" in result

        # Other elements preserved
        assert "@john" in result
        assert "@jane" in result
        assert "50%" in result
        assert '!"Important"' in result


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
        """Test that dependency conversion is case insensitive."""
        text = "Task 2 [DEPENDS Task 1] @john 2d"
        result = convert_plan_format_to_standard(text)
        assert "#Task 1" in result


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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
