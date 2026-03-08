"""Tests for the FrontMatterParser class."""

import pytest
from noodle_core import FrontMatterParser


PLAN_WITH_FULL_FRONT_MATTER = """\
---
title: My Project
status: active
owner: Alice
Resources:
  - @Andy: Andy McCarthy, Lead Developer
  - @Bob: Bob Smith, Developer, 50%
---
Phase 1
  Task A 3d @Andy

---highlights---
## 2026-02-13 @Alice
- Completed phase 1

---end-highlights---

---raid log---
| Type | Title | Owner | Status | Priority | Description |
|------|-------|-------|--------|----------|-------------|
| Risk | Budget overrun | Alice | Open | High | May exceed budget |

---baseline---
| Task Name | Start | Finish | Duration |
|-----------|-------|--------|----------|
| Task A | 2026-01-01 | 2026-01-03 | 3d |
"""

PLAN_WITHOUT_FRONT_MATTER = """\
Phase 1
  Task A 3d
  Task B 2d
"""

PLAN_WITH_EMPTY_FRONT_MATTER = """\
---
---
Phase 1
  Task A 3d
"""

PLAN_WITH_TITLE_ONLY = """\
---
title: Simple Plan
---
Phase 1
  Task A 3d
"""

PLAN_WITH_YAML_ERROR = """\
---
title: My Plan
Resources:
  - @Andy: Andy McCarthy
invalid_yaml: [unclosed
---
Phase 1
  Task A 3d
"""


class TestParseTitle:
    def test_extracts_title(self):
        parser = FrontMatterParser(PLAN_WITH_FULL_FRONT_MATTER)
        assert parser.parse_title() == "My Project"

    def test_returns_none_without_front_matter(self):
        parser = FrontMatterParser(PLAN_WITHOUT_FRONT_MATTER)
        assert parser.parse_title() is None

    def test_returns_none_with_empty_front_matter(self):
        parser = FrontMatterParser(PLAN_WITH_EMPTY_FRONT_MATTER)
        assert parser.parse_title() is None

    def test_extracts_title_case_insensitive(self):
        plan = "---\nTitle: Upper Case Title\n---\nPhase 1\n  Task A 3d\n"
        parser = FrontMatterParser(plan)
        assert parser.parse_title() == "Upper Case Title"

    def test_falls_back_to_line_parsing_on_yaml_error(self):
        parser = FrontMatterParser(PLAN_WITH_YAML_ERROR)
        assert parser.parse_title() == "My Plan"


class TestParseHighlights:
    def test_extracts_highlights(self):
        parser = FrontMatterParser(PLAN_WITH_FULL_FRONT_MATTER)
        highlights = parser.parse_highlights()
        assert len(highlights) == 1
        assert highlights[0]["author"] == "Alice"
        assert "Completed phase 1" in highlights[0]["content"]

    def test_returns_empty_list_without_highlights(self):
        parser = FrontMatterParser(PLAN_WITH_TITLE_ONLY)
        assert parser.parse_highlights() == []


class TestParseRaid:
    def test_extracts_raid_items(self):
        parser = FrontMatterParser(PLAN_WITH_FULL_FRONT_MATTER)
        raid_items = parser.parse_raid()
        assert len(raid_items) == 1
        assert raid_items[0]["type"].lower() == "risk"
        assert raid_items[0]["title"] == "Budget overrun"

    def test_returns_empty_list_without_raid(self):
        parser = FrontMatterParser(PLAN_WITH_TITLE_ONLY)
        assert parser.parse_raid() == []


class TestParseBaseline:
    def test_extracts_baseline_items(self):
        parser = FrontMatterParser(PLAN_WITH_FULL_FRONT_MATTER)
        baseline_items = parser.parse_baseline()
        assert len(baseline_items) == 1
        assert baseline_items[0]["name"] == "Task A"

    def test_returns_empty_list_without_baseline(self):
        parser = FrontMatterParser(PLAN_WITH_TITLE_ONLY)
        assert parser.parse_baseline() == []


class TestParseKeyValues:
    def test_extracts_key_value_pairs(self):
        parser = FrontMatterParser(PLAN_WITH_FULL_FRONT_MATTER)
        kv = parser.parse_key_values()
        assert kv["title"] == "My Project"
        assert kv["status"] == "active"
        assert kv["owner"] == "Alice"

    def test_keys_are_lowercase(self):
        plan = "---\nTitle: Test\nSTATUS: active\n---\n"
        parser = FrontMatterParser(plan)
        kv = parser.parse_key_values()
        assert "title" in kv
        assert "status" in kv

    def test_returns_empty_dict_without_front_matter(self):
        parser = FrontMatterParser(PLAN_WITHOUT_FRONT_MATTER)
        assert parser.parse_key_values() == {}

    def test_caches_result(self):
        parser = FrontMatterParser(PLAN_WITH_TITLE_ONLY)
        kv1 = parser.parse_key_values()
        kv2 = parser.parse_key_values()
        assert kv1 is kv2


class TestParseResourceMappings:
    def test_extracts_resource_mappings(self):
        parser = FrontMatterParser(PLAN_WITH_FULL_FRONT_MATTER)
        resource_map = parser.parse_resource_mappings()
        assert resource_map["andy"] == "Andy McCarthy"
        assert resource_map["bob"] == "Bob Smith"

    def test_returns_empty_dict_without_resources(self):
        parser = FrontMatterParser(PLAN_WITH_TITLE_ONLY)
        assert parser.parse_resource_mappings() == {}


class TestParserReuse:
    """Verify that a single parser instance can serve all parsing needs."""

    def test_all_methods_on_same_instance(self):
        parser = FrontMatterParser(PLAN_WITH_FULL_FRONT_MATTER)
        assert parser.parse_title() == "My Project"
        assert len(parser.parse_highlights()) == 1
        assert len(parser.parse_raid()) == 1
        assert len(parser.parse_baseline()) == 1
        assert "title" in parser.parse_key_values()
        assert len(parser.parse_resource_mappings()) == 2
