"""Tests for Gantt chart dependency features (issue #258).

Covers:
- Backend: extract_metadata dependency parsing, detect_dependency_loops
- Frontend logic equivalents: name-to-ID / ID-to-name conversion,
  predecessors string formatting/parsing, and loop detection
"""

import pytest
from noodle_core import extract_metadata, detect_dependency_loops, schedule_tasks


# ---------------------------------------------------------------------------
# Backend: extract_metadata — dependency parsing
# ---------------------------------------------------------------------------

class TestExtractMetadataDependencies:
    """Test that [depends ...] syntax is correctly parsed."""

    def test_single_dependency(self):
        meta = extract_metadata("Design 5d [depends Planning]", "Design")
        assert meta['depends'] == ['Planning']

    def test_multiple_dependencies(self):
        meta = extract_metadata("Build 10d [depends Design, Review]", "Build")
        assert set(meta['depends']) == {'Design', 'Review'}

    def test_dependency_with_lag(self):
        meta = extract_metadata("Test 3d [depends Build +2d]", "Test")
        assert meta['depends'] == ['Build']
        assert meta['lag_lead'] == {'Build': '+2d'}

    def test_dependency_with_negative_lead(self):
        meta = extract_metadata("Test 3d [depends Build -1w]", "Test")
        assert meta['depends'] == ['Build']
        assert meta['lag_lead'] == {'Build': '-1w'}

    def test_multiple_deps_with_mixed_lag(self):
        meta = extract_metadata("Deploy 2d [depends Build +1d, Test]", "Deploy")
        assert set(meta['depends']) == {'Build', 'Test'}
        assert meta['lag_lead'] == {'Build': '+1d'}

    def test_no_dependency(self):
        meta = extract_metadata("Planning 5d @alice", "Planning")
        assert 'depends' not in meta

    def test_case_insensitive_depends_keyword(self):
        meta = extract_metadata("Task 3d [Depends Other]", "Task")
        assert meta['depends'] == ['Other']

    def test_empty_depends_bracket(self):
        """[depends ] with trailing space and no task name should produce empty list or be skipped."""
        meta = extract_metadata("Task 3d [depends ]", "Task")
        # The regex should still match but produce an empty-ish dep
        # The important thing is it doesn't crash
        assert 'depends' in meta


# ---------------------------------------------------------------------------
# Backend: detect_dependency_loops
# ---------------------------------------------------------------------------

class TestDetectDependencyLoops:
    """Test circular dependency detection."""

    def test_no_loops(self):
        tasks = [
            {'name': 'A', 'depends': ['B']},
            {'name': 'B', 'depends': []},
            {'name': 'C', 'depends': ['A']},
        ]
        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is False
        assert result['loops'] == []

    def test_simple_loop(self):
        tasks = [
            {'name': 'A', 'depends': ['B']},
            {'name': 'B', 'depends': ['A']},
        ]
        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is True
        assert len(result['loops']) > 0

    def test_three_node_loop(self):
        tasks = [
            {'name': 'A', 'depends': ['B']},
            {'name': 'B', 'depends': ['C']},
            {'name': 'C', 'depends': ['A']},
        ]
        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is True
        assert len(result['affected_tasks']) == 3

    def test_self_loop(self):
        tasks = [
            {'name': 'A', 'depends': ['A']},
        ]
        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is True

    def test_partial_loop_leaves_others_unaffected(self):
        tasks = [
            {'name': 'A', 'depends': ['B']},
            {'name': 'B', 'depends': ['A']},
            {'name': 'C', 'depends': []},
        ]
        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is True
        assert 'c' not in result['affected_tasks']

    def test_no_depends_key(self):
        """Tasks without a depends key should not cause errors."""
        tasks = [
            {'name': 'A'},
            {'name': 'B'},
        ]
        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is False

    def test_nonexistent_dependency_ignored(self):
        """Dependencies referencing unknown tasks should be ignored, not crash."""
        tasks = [
            {'name': 'A', 'depends': ['NonExistent']},
        ]
        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is False

    def test_case_insensitive_detection(self):
        """Loop detection should be case-insensitive."""
        tasks = [
            {'name': 'Alpha', 'depends': ['beta']},
            {'name': 'Beta', 'depends': ['ALPHA']},
        ]
        result = detect_dependency_loops(tasks)
        assert result['has_loops'] is True


# ---------------------------------------------------------------------------
# Frontend-equivalent logic: name/ID conversion & predecessors formatting
# These test pure logic that mirrors the JS helpers.
# ---------------------------------------------------------------------------

def _build_name_to_id(tasks):
    """Python equivalent of buildTaskNameToIdMap."""
    return {t['name'].lower(): t['id'] for t in tasks}


def _build_id_to_name(tasks):
    """Python equivalent of buildIdToTaskNameMap."""
    return {t['id']: t['name'] for t in tasks}


def _format_predecessors(task, name_to_id):
    """Python equivalent of formatPredecessors."""
    depends = task.get('depends', [])
    lag_lead = task.get('lag_lead', {})
    if not depends:
        return ''
    parts = []
    for dep_name in depends:
        dep_id = name_to_id.get(dep_name.lower())
        if dep_id is None:
            continue
        entry = f"{dep_id}FS"
        if dep_name in lag_lead:
            entry += lag_lead[dep_name]
        parts.append(entry)
    return ', '.join(parts)


def _parse_predecessors_string(s, id_to_name):
    """Python equivalent of parsePredecessorsString."""
    import re
    if not s or not s.strip():
        return {'depends': [], 'lag_lead': {}}
    depends = []
    lag_lead = {}
    specs = s.split(',')
    for spec in specs:
        spec = spec.strip()
        if not spec:
            continue
        m = re.match(r'^(\d+)\s*FS\s*([+-]\d+[dwmy])?$', spec, re.IGNORECASE)
        if not m:
            return None
        task_id = int(m.group(1))
        name = id_to_name.get(task_id)
        if not name:
            return None
        depends.append(name)
        if m.group(2):
            lag_lead[name] = m.group(2)
    return {'depends': depends, 'lag_lead': lag_lead}


def _would_create_loop(task_id, proposed_dep_ids, tasks):
    """Python equivalent of wouldCreateLoop."""
    name_to_id = _build_name_to_id(tasks)
    deps = {}
    for t in tasks:
        deps[t['id']] = set()
        for dn in t.get('depends', []):
            did = name_to_id.get(dn.lower())
            if did is not None:
                deps[t['id']].add(did)
    deps[task_id] = set(proposed_dep_ids)

    def can_reach(current, target, visited):
        if current == target:
            return True
        if current in visited:
            return False
        visited.add(current)
        for nxt in deps.get(current, set()):
            if can_reach(nxt, target, visited):
                return True
        return False

    for dep_id in proposed_dep_ids:
        if can_reach(dep_id, task_id, set()):
            return True
    return False


SAMPLE_TASKS = [
    {'id': 1, 'name': 'Planning', 'depends': [], 'lag_lead': {}},
    {'id': 2, 'name': 'Design', 'depends': ['Planning'], 'lag_lead': {}},
    {'id': 3, 'name': 'Build', 'depends': ['Design'], 'lag_lead': {'Design': '+2d'}},
    {'id': 4, 'name': 'Test', 'depends': ['Build'], 'lag_lead': {}},
    {'id': 5, 'name': 'Deploy', 'depends': ['Build', 'Test'], 'lag_lead': {}},
]


class TestNameToIdConversion:

    def test_basic_lookup(self):
        m = _build_name_to_id(SAMPLE_TASKS)
        assert m['planning'] == 1
        assert m['build'] == 3

    def test_case_insensitive(self):
        m = _build_name_to_id(SAMPLE_TASKS)
        assert m.get('PLANNING'.lower()) == 1


class TestIdToNameConversion:

    def test_basic_lookup(self):
        m = _build_id_to_name(SAMPLE_TASKS)
        assert m[1] == 'Planning'
        assert m[5] == 'Deploy'


class TestFormatPredecessors:

    def test_no_deps(self):
        assert _format_predecessors(SAMPLE_TASKS[0], _build_name_to_id(SAMPLE_TASKS)) == ''

    def test_single_dep(self):
        result = _format_predecessors(SAMPLE_TASKS[1], _build_name_to_id(SAMPLE_TASKS))
        assert result == '1FS'

    def test_dep_with_lag(self):
        result = _format_predecessors(SAMPLE_TASKS[2], _build_name_to_id(SAMPLE_TASKS))
        assert result == '2FS+2d'

    def test_multiple_deps(self):
        result = _format_predecessors(SAMPLE_TASKS[4], _build_name_to_id(SAMPLE_TASKS))
        assert result == '3FS, 4FS'

    def test_unknown_dep_skipped(self):
        task = {'id': 99, 'name': 'X', 'depends': ['NonExistent'], 'lag_lead': {}}
        result = _format_predecessors(task, _build_name_to_id(SAMPLE_TASKS))
        assert result == ''


class TestParsePredecessorsString:

    def test_empty_string(self):
        m = _build_id_to_name(SAMPLE_TASKS)
        result = _parse_predecessors_string('', m)
        assert result == {'depends': [], 'lag_lead': {}}

    def test_single(self):
        m = _build_id_to_name(SAMPLE_TASKS)
        result = _parse_predecessors_string('1FS', m)
        assert result['depends'] == ['Planning']
        assert result['lag_lead'] == {}

    def test_with_lag(self):
        m = _build_id_to_name(SAMPLE_TASKS)
        result = _parse_predecessors_string('2FS+2d', m)
        assert result['depends'] == ['Design']
        assert result['lag_lead'] == {'Design': '+2d'}

    def test_multiple(self):
        m = _build_id_to_name(SAMPLE_TASKS)
        result = _parse_predecessors_string('3FS, 4FS', m)
        assert result['depends'] == ['Build', 'Test']

    def test_invalid_format_returns_none(self):
        m = _build_id_to_name(SAMPLE_TASKS)
        assert _parse_predecessors_string('bad', m) is None

    def test_unknown_id_returns_none(self):
        m = _build_id_to_name(SAMPLE_TASKS)
        assert _parse_predecessors_string('99FS', m) is None

    def test_roundtrip(self):
        """Format then parse should give back the original data."""
        name_to_id = _build_name_to_id(SAMPLE_TASKS)
        id_to_name = _build_id_to_name(SAMPLE_TASKS)
        for task in SAMPLE_TASKS:
            formatted = _format_predecessors(task, name_to_id)
            parsed = _parse_predecessors_string(formatted, id_to_name)
            assert parsed['depends'] == task['depends']
            assert parsed['lag_lead'] == task.get('lag_lead', {})


class TestWouldCreateLoop:

    def test_no_loop(self):
        """Adding a valid dependency should not be detected as a loop."""
        # Task 1 (Planning) depending on nothing, we propose Task 4 depends on Task 3
        assert _would_create_loop(4, [3], SAMPLE_TASKS) is False

    def test_direct_loop(self):
        """If A depends on B and we make B depend on A, loop detected."""
        assert _would_create_loop(1, [2], SAMPLE_TASKS) is True  # Planning -> Design -> Planning

    def test_indirect_loop(self):
        """Transitive loop: Planning -> Design -> Build -> Planning."""
        assert _would_create_loop(1, [3], SAMPLE_TASKS) is True

    def test_self_loop(self):
        assert _would_create_loop(1, [1], SAMPLE_TASKS) is True

    def test_no_loop_independent(self):
        """Deps on an independent task should be fine."""
        tasks = [
            {'id': 1, 'name': 'A', 'depends': [], 'lag_lead': {}},
            {'id': 2, 'name': 'B', 'depends': [], 'lag_lead': {}},
        ]
        assert _would_create_loop(1, [2], tasks) is False


# ---------------------------------------------------------------------------
# Integration: schedule_tasks with dependencies
# ---------------------------------------------------------------------------

class TestScheduleTasksWithDependencies:
    """Ensure schedule_tasks correctly handles [depends ...] and flags loops."""

    def _make_phases(self, task_lines):
        """Helper to build the nested structure schedule_tasks expects."""
        from noodle_core import natural_language_to_yaml
        plan_text = "Project\n" + "\n".join(f"  {line}" for line in task_lines)
        yaml_data = natural_language_to_yaml(plan_text, "Project")
        return yaml_data["Project"]

    def test_dependency_scheduling_order(self):
        """Tasks with [depends ...] should start after their dependencies finish."""
        phases = self._make_phases([
            "Planning 5d",
            "Design 3d [depends Planning]",
        ])
        tasks = schedule_tasks(phases)
        planning = next(t for t in tasks if t.get('name') == 'Planning' and not t.get('summary'))
        design = next(t for t in tasks if t.get('name') == 'Design' and not t.get('summary'))
        # Design should start on or after Planning finishes
        assert design['start'] >= planning['finish']

    def test_loop_warning_added(self):
        """Circular dependencies should produce a loop_warning on affected tasks."""
        phases = self._make_phases([
            "A 2d [depends B]",
            "B 2d [depends A]",
        ])
        tasks = schedule_tasks(phases)
        warnings = [t.get('loop_warning') for t in tasks if t.get('loop_warning')]
        assert len(warnings) > 0


class TestSequentialLag:
    """`* +2d Build 3d` starts two working days after the previous task
    finishes: the lag is applied exactly as `[depends Previous +2d]` applies
    one, and is never part of the task's name or its duration."""

    @staticmethod
    def schedule(body):
        from noodle_core import convert_plan_format_to_standard, natural_language_to_yaml

        text = "---\ntitle: Lag\n---\n\n" + body
        data = natural_language_to_yaml(convert_plan_format_to_standard(text), "Project")
        phases = data["Project"] if isinstance(data["Project"], list) else [data["Project"]]
        return {t["name"]: t for t in schedule_tasks(phases)}

    def test_lag_prefix_is_neither_duration_nor_name(self):
        meta = extract_metadata("* +2d Build 3d @a", "Build")
        assert meta["duration"].days == 3
        assert meta["sequential"] is True
        assert meta["sequential_lag"] == "+2d"
        assert "duration" not in extract_metadata("* +2d Build", "Build")
        tasks = self.schedule("P\n  Spec 3d 2026-03-02\n  * +2d Build 3d\n  *-1d Lead 1d\n")
        assert set(tasks) == {"P", "Spec", "Build", "Lead"}

    def test_lag_delays_the_start_by_working_days(self):
        # Spec Mon 2 - Wed 4 March; two working days on (Thu, Fri): Mon 9
        tasks = self.schedule("P\n  Spec 3d 2026-03-02\n  * +2d Build 3d\n")
        assert tasks["Build"]["start"].date().isoformat() == "2026-03-09"
        assert tasks["Build"]["lag_lead"] == {"Spec": "+2d"}
        assert tasks["Build"]["depends"] == ["Spec"]

    def test_lag_matches_the_same_lag_on_a_depends_link(self):
        star = self.schedule("P\n  Spec 3d 2026-03-02\n  * +2d Build 3d\n")
        link = self.schedule("P\n  Spec 3d 2026-03-02\n  Build 3d [depends Spec +2d]\n")
        assert star["Build"]["start"] == link["Build"]["start"]
        assert star["Build"]["finish"] == link["Build"]["finish"]

    def test_a_lead_overlaps_the_previous_task(self):
        # Spec's finish is Thu 5 (exclusive); a one-day lead starts Wed 4
        tasks = self.schedule("P\n  Spec 3d 2026-03-02\n  * -1d Review 2d\n")
        assert tasks["Review"]["start"].date().isoformat() == "2026-03-04"

    def test_a_lagged_milestone_sits_where_a_lagged_depends_puts_it(self):
        # A milestone sits on its predecessor's (exclusive) finish boundary, so
        # two working days after Wed 4 is the end of Fri 6, i.e. Sat 7
        star = self.schedule("P\n  Spec 3d 2026-03-02\n  * +2d Gate 0d\n")
        link = self.schedule("P\n  Spec 3d 2026-03-02\n  Gate 0d [depends Spec +2d]\n")
        assert star["Gate"]["start"] == link["Gate"]["start"]
        assert star["Gate"]["start"].date().isoformat() == "2026-03-07"
        assert star["Gate"]["finish"] == star["Gate"]["start"]

    def test_no_lag_is_unchanged(self):
        tasks = self.schedule("P\n  Spec 3d 2026-03-02\n  * Build 3d\n  *Test 2w\n")
        assert tasks["Build"]["start"].date().isoformat() == "2026-03-05"
        assert "lag_lead" not in tasks["Build"] or not tasks["Build"]["lag_lead"]
        assert tasks["Test"]["duration"].days == 14

    def test_a_lagged_gap_is_not_float(self):
        # The chain Spec -> (+2d) -> Build ends the project, so both are critical
        tasks = self.schedule("P\n  Spec 3d 2026-03-02\n  * +2d Build 3d\n  Side 1d 2026-03-02\n")
        assert tasks["Spec"]["critical"] is True
        assert tasks["Spec"]["total_float"] == 0
        assert tasks["Build"]["critical"] is True
        assert tasks["Side"]["critical"] is False

    def test_the_converter_keeps_the_lag(self):
        from noodle_core import convert_plan_format_to_standard

        out = convert_plan_format_to_standard("P\n  * +2d Build @a 3days\n")
        assert "*+2d Build @a 3d" in out
