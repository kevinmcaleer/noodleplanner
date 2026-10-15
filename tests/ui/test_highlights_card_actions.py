"""Highlight cards: Edit / Delete appear only while their own card is hovered,
and Delete uses the same neutral trash icon as the RAID and Actions rows.

Usage:
    uv run pytest tests/ui/test_highlights_card_actions.py -q
"""

import pytest

from .helpers import open_project_view

pytestmark = pytest.mark.ui

HIGHLIGHTS = [
    {"date": "2026-10-01", "author": "alex", "content": "First **highlight**"},
    {"date": "2026-10-08", "author": "sam", "content": "Second highlight"},
]


def _open(page, app_server):
    open_project_view(page, app_server)
    page.evaluate("h => updateHighlightsView(h)", HIGHLIGHTS)
    page.evaluate("switchToView('highlights')")
    page.wait_for_selector("#highlights-view .highlight-card")


def _opacity(card):
    return card.locator(".highlight-actions").evaluate("el => getComputedStyle(el).opacity")


def test_actions_show_only_on_the_hovered_card(page, app_server):
    _open(page, app_server)
    cards = page.locator("#highlightsList .highlight-card")
    assert cards.count() == 2
    assert _opacity(cards.nth(0)) == "0"
    assert _opacity(cards.nth(1)) == "0"

    cards.nth(0).hover()
    page.wait_for_function(
        "() => getComputedStyle(document.querySelector('#highlightsList .highlight-card .highlight-actions')).opacity === '1'"
    )
    assert _opacity(cards.nth(0)) == "1"
    assert _opacity(cards.nth(1)) == "0"


def test_delete_is_the_neutral_trash_icon_not_a_red_button(page, app_server):
    _open(page, app_server)
    card = page.locator("#highlightsList .highlight-card").first
    assert card.locator("np-button[variant=danger]").count() == 0
    assert card.locator("np-button .bi-trash").count() == 1
