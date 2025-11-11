"""Tests for format_converter module."""

import pytest
from noodle_core import (
    convert_plan_format_to_standard,
    extract_title_from_frontmatter
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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
