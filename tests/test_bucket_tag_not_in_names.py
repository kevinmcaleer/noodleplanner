"""A `{bucket}` tag is metadata and must never show in a task's name."""
from fastapi.testclient import TestClient

from noodle_web.app import app

PLAN = """---
title: T
start: 2026-10-01
---
## Phase
* Design 5d {blueprint}
* {blueprint} Lead 2d
* Sub-group {blueprint}
  * Child 1d {blueprint}
"""


def test_bucket_tag_is_not_part_of_any_task_name():
    tasks = TestClient(app).post("/api/parse", json={"plan_text": PLAN}).json()["tasks"]
    names = {t["name"] for t in tasks}
    assert {"Design", "Lead", "Sub-group", "Child"} <= names
    assert not any("{" in n or "}" in n for n in names)
    assert {t["name"]: t["bucket"] for t in tasks}["Lead"] == "blueprint"
