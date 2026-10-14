"""A project's computed RAG can be overridden from the Track ribbon.

The override is the front matter an initiative uses (`rag:`, `rag_comment:`,
`rag_updated:`). The Rate button sits in Track > Progress.

Usage:
    uv run pytest tests/ui/test_project_rag_override.py -q
"""

import os
import pathlib

import pytest

from .helpers import open_project_view

pytestmark = pytest.mark.ui

PLAN = "---\ntitle: Launch\n---\nTask one 3d\nTask two 2d\n"
SHOTS = os.environ.get("NP_SHOT_DIR")


def open_plan(page, text):
    page.evaluate("text => createProject('Launch', text)", text)


def open_track(page):
    page.get_by_role("tab", name="Track", exact=True).first.click()


def shot(page, name, theme):
    if not SHOTS:
        return
    page.evaluate(
        "t => t === 'dark' ? document.documentElement.setAttribute('data-theme', 'dark')"
        " : document.documentElement.removeAttribute('data-theme')", theme)
    pathlib.Path(SHOTS).mkdir(parents=True, exist_ok=True)
    page.screenshot(path=f"{SHOTS}/{name}-{theme}.png")


def test_rate_button_is_under_track_progress(page, app_server):
    open_project_view(page, app_server)
    open_track(page)
    group = page.locator(".ribbon-group", has_text="Progress").first
    assert group.get_by_text("Rate", exact=True).is_visible()
    shot(page, "ribbon", "light")
    shot(page, "ribbon", "dark")


def test_rate_overrides_and_clears_the_project_rag(page, app_server):
    open_project_view(page, app_server)
    open_plan(page, PLAN)
    open_track(page)
    page.locator(".ribbon-group", has_text="Progress").first.get_by_text("Rate", exact=True).click()
    dialog = page.locator("dialog.initiative-rag-dialog")
    dialog.get_by_label("At Risk").check()
    dialog.locator("input[name=comment]").fill("Waiting on legal")
    shot(page, "dialog", "light")
    shot(page, "dialog", "dark")
    dialog.locator("[data-action=save]").click()
    text = page.evaluate("() => document.getElementById('planEditor').value")
    assert "rag: amber" in text and "rag_comment: Waiting on legal" in text and "rag_updated:" in text
    # The status-bar refresh must not write the computed RAG back over it.
    page.wait_for_timeout(800)
    assert "rag: amber" in page.evaluate("() => document.getElementById('planEditor').value")
    page.locator(".ribbon-group", has_text="Progress").first.get_by_text("Rate", exact=True).click()
    dialog = page.locator("dialog.initiative-rag-dialog")
    dialog.get_by_label("Computed from the schedule").check()
    dialog.locator("[data-action=save]").click()
    assert "rag_updated" not in page.evaluate("() => document.getElementById('planEditor').value")
