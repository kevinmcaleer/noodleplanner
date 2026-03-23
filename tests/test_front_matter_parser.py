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


PLAN_WITH_NON_WORKING_DAYS = """\
---
title: Holiday Project
non-working-days: 2026-12-25, 2026-12-26, 2027-01-01
Resources:
  - @alice: Alice Smith, Developer, non-working [2026-03-20, 2026-04-14]
---
Phase 1
  Task A 3d @alice
"""

PLAN_WITH_HOLIDAYS_KEY = """\
---
title: Legacy Holidays
holidays: 2026-12-25, 2026-12-26
---
Phase 1
  Task A 3d
"""

PLAN_WITH_BOTH_HOLIDAYS_AND_NWD = """\
---
title: Both Keys
holidays: 2026-12-25
non-working-days: 2027-01-01, 2026-12-26
---
Phase 1
  Task A 3d
"""

PLAN_WITH_MULTIPLE_RESOURCE_NWD = """\
---
title: Multi Resource NWD
Resources:
  - @alice: Alice Smith, Developer, non-working [2026-03-20, 2026-04-14]
  - @bob: Bob Jones, Tester, non-working [2026-05-01]
---
Phase 1
  Task A 3d @alice
  Task B 2d @bob
"""


class TestParseNonWorkingDays:
    def test_parses_non_working_days(self):
        from datetime import date
        parser = FrontMatterParser(PLAN_WITH_NON_WORKING_DAYS)
        nwd = parser.parse_non_working_days()
        assert date(2026, 12, 25) in nwd
        assert date(2026, 12, 26) in nwd
        assert date(2027, 1, 1) in nwd
        assert len(nwd) == 3

    def test_parses_holidays_key(self):
        from datetime import date
        parser = FrontMatterParser(PLAN_WITH_HOLIDAYS_KEY)
        nwd = parser.parse_non_working_days()
        assert date(2026, 12, 25) in nwd
        assert date(2026, 12, 26) in nwd
        assert len(nwd) == 2

    def test_merges_holidays_and_non_working_days(self):
        from datetime import date
        parser = FrontMatterParser(PLAN_WITH_BOTH_HOLIDAYS_AND_NWD)
        nwd = parser.parse_non_working_days()
        assert date(2026, 12, 25) in nwd
        assert date(2026, 12, 26) in nwd
        assert date(2027, 1, 1) in nwd
        assert len(nwd) == 3

    def test_returns_empty_set_without_non_working_days(self):
        parser = FrontMatterParser(PLAN_WITH_TITLE_ONLY)
        assert parser.parse_non_working_days() == set()

    def test_returns_empty_set_without_front_matter(self):
        parser = FrontMatterParser(PLAN_WITHOUT_FRONT_MATTER)
        assert parser.parse_non_working_days() == set()


class TestParseResourceNonWorkingDays:
    def test_parses_resource_non_working_days(self):
        from datetime import date
        parser = FrontMatterParser(PLAN_WITH_NON_WORKING_DAYS)
        rnwd = parser.parse_resource_non_working_days()
        assert 'alice' in rnwd
        assert date(2026, 3, 20) in rnwd['alice']
        assert date(2026, 4, 14) in rnwd['alice']
        assert len(rnwd['alice']) == 2

    def test_parses_multiple_resources(self):
        from datetime import date
        parser = FrontMatterParser(PLAN_WITH_MULTIPLE_RESOURCE_NWD)
        rnwd = parser.parse_resource_non_working_days()
        assert 'alice' in rnwd
        assert 'bob' in rnwd
        assert len(rnwd['alice']) == 2
        assert len(rnwd['bob']) == 1
        assert date(2026, 5, 1) in rnwd['bob']

    def test_returns_empty_dict_without_resource_nwd(self):
        parser = FrontMatterParser(PLAN_WITH_TITLE_ONLY)
        assert parser.parse_resource_non_working_days() == {}

    def test_returns_empty_dict_without_front_matter(self):
        parser = FrontMatterParser(PLAN_WITHOUT_FRONT_MATTER)
        assert parser.parse_resource_non_working_days() == {}

    def test_parses_date_ranges(self):
        from datetime import date
        plan = """\
---
title: Range Test
Resources:
  - @carol: Carol Davis, Designer, non-working [2026-03-01:2026-03-03, 2026-12-31]
---
Phase 1
  Task A 3d @carol
"""
        parser = FrontMatterParser(plan)
        rnwd = parser.parse_resource_non_working_days()
        assert 'carol' in rnwd
        assert date(2026, 3, 1) in rnwd['carol']
        assert date(2026, 3, 2) in rnwd['carol']
        assert date(2026, 3, 3) in rnwd['carol']
        assert date(2026, 12, 31) in rnwd['carol']
        assert len(rnwd['carol']) == 4

    def test_resource_name_preserved_without_nwd(self):
        """Ensure resource names are correctly parsed when non-working days are present."""
        plan = """\
---
Resources:
  - @dave: Dave Wilson, Analyst, dave@co.com, 80%, non-working [2026-06-15]
---
Phase 1
  Task A 3d @dave
"""
        parser = FrontMatterParser(plan)
        rm = parser.parse_resource_mappings()
        assert rm['dave'] == 'Dave Wilson'
        rnwd = parser.parse_resource_non_working_days()
        from datetime import date
        assert date(2026, 6, 15) in rnwd['dave']


class TestParseNamedNonWorkingDays:
    """Tests for the new named non-working days list format."""

    def test_parses_named_list_format(self):
        from datetime import date
        plan = """\
---
title: Named NWD Test
non-working-days:
  - Christmas: 2026-12-25:2026-12-26
  - New Year: 2027-01-01
  - Easter: 2027-04-18:2027-04-21
---
Phase 1
  Task A 3d
"""
        parser = FrontMatterParser(plan)
        nwd = parser.parse_non_working_days()
        assert date(2026, 12, 25) in nwd
        assert date(2026, 12, 26) in nwd
        assert date(2027, 1, 1) in nwd
        assert date(2027, 4, 18) in nwd
        assert date(2027, 4, 19) in nwd
        assert date(2027, 4, 20) in nwd
        assert date(2027, 4, 21) in nwd
        assert len(nwd) == 7

    def test_parses_named_entries_preserving_names(self):
        plan = """\
---
title: Named NWD Test
non-working-days:
  - Christmas: 2026-12-25:2026-12-26
  - New Year: 2027-01-01
---
Phase 1
  Task A 3d
"""
        parser = FrontMatterParser(plan)
        entries = parser.parse_named_non_working_days()
        assert len(entries) == 2
        assert entries[0]['name'] == 'Christmas'
        assert entries[0]['start'] == '2026-12-25'
        assert entries[0]['finish'] == '2026-12-26'
        assert entries[1]['name'] == 'New Year'
        assert entries[1]['start'] == '2027-01-01'
        assert entries[1]['finish'] == ''

    def test_falls_back_to_legacy_flat_format(self):
        from datetime import date
        plan = """\
---
title: Legacy Test
non-working-days: 2026-12-25, 2026-12-26
---
Phase 1
  Task A 3d
"""
        parser = FrontMatterParser(plan)
        nwd = parser.parse_non_working_days()
        assert date(2026, 12, 25) in nwd
        assert date(2026, 12, 26) in nwd
        assert len(nwd) == 2

    def test_named_list_with_holidays_key(self):
        from datetime import date
        plan = """\
---
title: Holidays Key Test
holidays:
  - Bank Holiday: 2026-08-31
---
Phase 1
  Task A 3d
"""
        parser = FrontMatterParser(plan)
        nwd = parser.parse_non_working_days()
        assert date(2026, 8, 31) in nwd
        assert len(nwd) == 1


class TestResourceNamedNonWorkingDays:
    """Tests for named non-working days in resource inline format."""

    def test_parses_named_resource_nwd(self):
        from datetime import date
        plan = """\
---
Resources:
  - @jack: Jack Lloyd, Network Arch, non-working [Annual Leave: 2026-03-01:2026-03-03, Doctor: 2026-04-01]
---
Phase 1
  Task A 3d @jack
"""
        parser = FrontMatterParser(plan)
        rnwd = parser.parse_resource_non_working_days()
        assert 'jack' in rnwd
        assert date(2026, 3, 1) in rnwd['jack']
        assert date(2026, 3, 2) in rnwd['jack']
        assert date(2026, 3, 3) in rnwd['jack']
        assert date(2026, 4, 1) in rnwd['jack']
        assert len(rnwd['jack']) == 4

    def test_backward_compatible_with_legacy_resource_nwd(self):
        from datetime import date
        plan = """\
---
Resources:
  - @jack: Jack Lloyd, Network Arch, non-working [2026-03-01:2026-03-03, 2026-12-31]
---
Phase 1
  Task A 3d @jack
"""
        parser = FrontMatterParser(plan)
        rnwd = parser.parse_resource_non_working_days()
        assert 'jack' in rnwd
        assert date(2026, 3, 1) in rnwd['jack']
        assert date(2026, 3, 2) in rnwd['jack']
        assert date(2026, 3, 3) in rnwd['jack']
        assert date(2026, 12, 31) in rnwd['jack']
        assert len(rnwd['jack']) == 4


PLAN_WITH_DEPENDENCIES = """\
---
title: Project B
dependencies:
  - from: Project A
    task: Milestone 1
    to_task: Design Start
    type: FS
    lag: 0
  - from: Project C
    task: Delivery
    to_task: Integration Start
    type: FS
    lag: 5
---
Phase 1
  Design Start 3d
  Integration Start 5d
"""


class TestParseDependencies:
    def test_parses_dependencies(self):
        parser = FrontMatterParser(PLAN_WITH_DEPENDENCIES)
        deps = parser.parse_dependencies()
        assert len(deps) == 2
        assert deps[0]['from'] == 'Project A'
        assert deps[0]['task'] == 'Milestone 1'
        assert deps[0]['to_task'] == 'Design Start'
        assert deps[0]['type'] == 'FS'
        assert deps[0]['lag'] == 0
        assert deps[1]['from'] == 'Project C'
        assert deps[1]['task'] == 'Delivery'
        assert deps[1]['to_task'] == 'Integration Start'
        assert deps[1]['lag'] == 5

    def test_returns_empty_list_without_dependencies(self):
        parser = FrontMatterParser(PLAN_WITH_TITLE_ONLY)
        assert parser.parse_dependencies() == []

    def test_returns_empty_list_without_front_matter(self):
        parser = FrontMatterParser(PLAN_WITHOUT_FRONT_MATTER)
        assert parser.parse_dependencies() == []

    def test_defaults_type_and_lag(self):
        plan = """\
---
title: Defaults Test
dependencies:
  - from: Project X
    task: Task 1
    to_task: Task 2
---
Task 2 3d
"""
        parser = FrontMatterParser(plan)
        deps = parser.parse_dependencies()
        assert len(deps) == 1
        assert deps[0]['type'] == 'FS'
        assert deps[0]['lag'] == 0


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
