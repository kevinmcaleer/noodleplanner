"""The task-line contract: three parsers, one meaning (issue #1570, epic #1563).

A task line is read by three independent implementations:

* ``noodle_core.metadata.extract_metadata`` -- the Python engine
* ``static/engine/tokeniser.js`` ``extractMetadata`` -- the browser engine,
  written to mirror the Python one for one
* ``static/task-tokenizer.js`` -- the editor highlighting and the task details
  form, via ``parseTaskLine`` in ``script.js``

and written back by the task details form (``saveTask``), which rebuilds the
whole line from its fields. The multi-line comment bug fixed in #1562 lived in
that write path, and nothing exercised it end to end. This module runs a shared
corpus (``tests/fixtures/task-lines.json``) through all of it and checks:

1. the Python and browser engines return the same metadata, field for field;
2. the form reads the same name, comment, labels, resources and so on as the
   Python engine -- so what the user sees in the form is what gets scheduled;
3. opening a line in the form and saving it **without edits** leaves it
   meaning the same thing to the Python engine.

The browser side answers through one Node process per module
(tests/helpers/task_line_answers.mjs), about a tenth of a second for the whole
corpus, so this runs in the fast suite and under ``-n auto``.

Known defects are pinned by ``xfail`` entries in the corpus, keyed to the issue
that tracks them and ``strict``, so a fix flips the test red until the entry is
removed -- the corpus doubles as the epic's checklist. Add a line to the corpus
whenever a bug in this area is found or fixed.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from noodle_core.metadata import extract_metadata

REPO = Path(__file__).resolve().parent.parent
CORPUS_PATH = REPO / "tests" / "fixtures" / "task-lines.json"
ANSWERS = REPO / "tests" / "helpers" / "task_line_answers.mjs"

CORPUS = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
CASES = CORPUS["cases"] + [{"line": line} for line in CORPUS["generated"]["lines"]]
LINES = [case["line"] for case in CASES]
assert len(LINES) == len(set(LINES)), "duplicate lines in tests/fixtures/task-lines.json"

# Fields the browser engine adds on top of the Python one (noodle view only,
# #984/#985); they are not scheduling metadata and have no Python counterpart.
ENGINE_ONLY = {"pin", "relates"}

# The sequential `*` and its lag are written by the form as an explicit
# `[depends Previous +lag]` when the previous task is known, which the engines
# schedule identically; the round-trip check compares that meaning.
PREVIOUS_TASK = "First"

DURATION_DAYS = {"d": 1, "w": 7, "m": 30, "y": 365}


def _cases(check):
    """The corpus as pytest params, with the xfail entries for `check` applied."""
    params = []
    for case in CASES:
        issue = case.get("xfail", {}).get(check)
        marks = [pytest.mark.xfail(reason=issue, strict=True)] if issue else []
        params.append(pytest.param(case["line"], id=case["line"], marks=marks))
    return params


@pytest.fixture(scope="module")
def answers():
    """The browser side's reading of every corpus line, from one Node process."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    proc = subprocess.run(
        [node, "--no-warnings", str(ANSWERS)],
        input=json.dumps(LINES), capture_output=True, text=True, cwd=REPO, check=True,
    )
    return dict(zip(LINES, json.loads(proc.stdout)))


def python_meta(line):
    """extract_metadata, with the values made JSON-comparable."""
    meta = {}
    for key, value in extract_metadata(line).items():
        if key == "duration":
            meta["duration_days"] = value.days
        elif key == "start":
            meta[key] = value.strftime("%Y-%m-%d")
        else:
            meta[key] = value
    return meta


def _jsonish(value):
    if isinstance(value, float) and value == int(value):
        value = int(value)
    return json.dumps(value, sort_keys=True, default=str)


def divergences(expected, actual, ignore=()):
    """{field: (expected, actual)} for every field the two readings disagree on."""
    out = {}
    for key in sorted((set(expected) | set(actual)) - set(ignore)):
        if _jsonish(expected.get(key)) != _jsonish(actual.get(key)):
            out[key] = (expected.get(key), actual.get(key))
    return out


def form_as_meta(form):
    """The form's fields, in the Python engine's vocabulary.

    Only the fields the form shows are compared; the form has no field for the
    levelled flag, the pin, the quality roles or the product type.
    """
    meta = {"description": form["name"], "priority": form["priority"]}
    if form["comment"]:
        meta["comment"] = form["comment"]
    if form["labels"]:
        meta["labels"] = [label for label in form["labels"].split(", ") if label]
    if form["resources"]:
        meta["resources"] = form["resources"]
    if form["bucket"]:
        meta["bucket"] = form["bucket"]
    if form["deadline"]:
        meta["deadline"] = form["deadline"]
    if form["startDate"]:
        meta["due"] = form["startDate"]
    if form["percent"]:
        meta["percent"] = max(0, min(100, int(form["percent"])))
    if form["dependencies"]:
        meta["depends"] = [d.split(":")[0].rsplit(" +", 1)[0].rsplit(" -", 1)[0].strip()
                           for d in form["dependencies"].split(", ")]
    if form["durationToken"]:
        value, unit = re.match(r"(\d+)(\D+)", form["durationToken"]).groups()
        meta["duration_days"] = int(value) * DURATION_DAYS[unit[0]]
    return meta


def python_as_form(meta):
    """The Python reading, cut down to the fields the form shows."""
    keep = {"description", "priority", "comment", "labels", "resources", "bucket", "deadline", "due", "percent", "depends", "duration_days"}
    return {k: v for k, v in sequential_as_depends(meta).items() if k in keep}


def sequential_as_depends(meta):
    """Fold `* +lag` into `[depends First +lag]`, which is how the form reads and writes it."""
    meta = dict(meta)
    if meta.pop("sequential", None):
        lag = meta.pop("sequential_lag", None)
        depends = meta.get("depends", [])
        if PREVIOUS_TASK not in depends:
            meta["depends"] = [PREVIOUS_TASK, *depends]
        if lag:
            meta["lag_lead"] = {PREVIOUS_TASK: lag, **meta.get("lag_lead", {})}
    return meta


def as_scheduled(meta):
    """What the engine schedules from a reading: `*` as a dependency, and the
    one-day default duration made explicit (the form writes `1d` for a task
    that had none, which the engine already assumed)."""
    meta = sequential_as_depends(meta)
    meta.setdefault("duration_days", 1)
    return meta


@pytest.mark.parametrize("line", _cases("engine"))
def test_python_and_browser_engines_agree(line, answers):
    expected = python_meta(line)
    actual = answers[line]["engine"]
    assert divergences(expected, actual, ignore=ENGINE_ONLY) == {}, line


@pytest.mark.parametrize("line", _cases("form"))
def test_task_form_reads_what_the_engine_schedules(line, answers):
    expected = python_as_form(python_meta(line))
    actual = form_as_meta(answers[line]["form"])
    assert divergences(expected, actual) == {}, line


@pytest.mark.parametrize("line", _cases("roundtrip"))
def test_task_form_save_without_edits_keeps_the_meaning(line, answers):
    answer = answers[line]
    assert answer["error"] is None, answer["error"]
    before = as_scheduled(python_meta(line))
    after = as_scheduled(python_meta(answer["roundtrip"]))
    assert divergences(before, after) == {}, f"{line!r} -> {answer['roundtrip']!r}"


def test_corpus_entries_are_well_formed():
    for case in CORPUS["cases"]:
        assert isinstance(case["line"], str) and case["line"].strip()
        for check, issue in case.get("xfail", {}).items():
            assert check in ("engine", "form", "roundtrip"), case
            assert issue.startswith("#"), f"xfail must name an issue: {case}"
