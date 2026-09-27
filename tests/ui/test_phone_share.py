"""A phone saves a copy of a plan through its share sheet (#1395).

A phone has no File System Access API, so Save can only download, and on an
iPhone a download lands in the Files app's Downloads folder, if anywhere.
The share sheet (Web Share API) is the phone's own way to put a file in
Files, iCloud Drive or Google Drive, or to send it by Mail, Messages or
AirDrop. So on a phone, the ⋯ sheet, the menu's Plan group and File all
offer "Save or share a copy":

- where the browser can share a file, it opens the share sheet with the
  plan as the .md file Save writes: the same name and, but for the
  timestamp, the same text;
- cancelling the sheet changes nothing: no toast, no download, no version
  bump;
- where the browser can't share a file, the action says "Download a copy"
  and downloads it.

Headless Chromium on Linux has no Web Share API, which is the download case
as it stands; the share cases stub navigator.share and navigator.canShare.

Usage:
    uv run pytest tests/ui/test_phone_share.py -q
"""

import re

import pytest

from .helpers import load_plan, open_app

pytestmark = pytest.mark.ui

PROJECT = "Office move"

PLAN = """---
title: Office move
version: 1.0
start date: 2026-01-05
---
Design
  Wireframes 3d
Build
  UI 4d
"""

# A share sheet that records what it was given, and that the user cancels
# when `window.__cancelShare` is set.
STUB_SHARE = """
(() => {
    window.__shareCalls = 0;
    window.__shared = [];
    Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data) => !!(data && Array.isArray(data.files) && data.files.length),
    });
    Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
            window.__shareCalls++;
            if (window.__cancelShare) throw new DOMException('Share canceled', 'AbortError');
            const file = data.files[0];
            window.__shared.push({ name: file.name, type: file.type, text: await file.text(), title: data.title });
        },
    });
})();
"""


def _open(pg, app_server, share=True):
    if share:
        pg.context.add_init_script(STUB_SHARE)
    open_app(pg, app_server)
    load_plan(pg, PLAN, with_project=PROJECT)


def _editor(pg):
    return pg.eval_on_selector("#planEditor", "editor => editor.value")


def _without_last_saved(text):
    return re.sub(r"^last_saved:.*\n", "", text, flags=re.M)


def _open_sheet(pg):
    pg.locator("#phoneMoreBtn").tap()
    pg.wait_for_function("() => document.getElementById('phoneSheet').hasAttribute('open')")


def _open_drawer(pg):
    pg.evaluate("() => document.getElementById('phoneAppBar').menuButton.click()")
    pg.wait_for_function("() => document.getElementById('phoneNavDrawer').hasAttribute('open')")


def _open_file(pg):
    pg.evaluate("() => switchToView('backstage')")
    pg.wait_for_selector(".backstage-rail-btn[data-backstage-action='Save a copy']", state="visible")


def _shared(pg, count):
    pg.wait_for_function("n => window.__shared.length >= n", arg=count)
    return pg.evaluate("() => window.__shared")[count - 1]


def test_the_sheet_s_share_button_shares_the_file_save_writes(phone, app_server):
    _open(phone, app_server)
    before = _editor(phone)
    expected = phone.evaluate("text => nextSavedPlanText(text)", before)

    _open_sheet(phone)
    share = phone.locator("#phoneSheet .tool[data-id='share']")
    assert share.inner_text().strip() == "Share"
    share.tap()

    shared = _shared(phone, 1)
    assert shared["name"] == "office_move_plan_v1.1.md", "named as Save names a download"
    assert shared["type"] == "text/markdown"
    assert _without_last_saved(shared["text"]) == _without_last_saved(expected), "the text Save writes"
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('version: 1.1')")


def test_the_menu_and_file_offer_it_too(phone, app_server):
    _open(phone, app_server)

    _open_drawer(phone)
    item = phone.locator("#phoneNavDrawer button[data-id='cmd:share']")
    assert "Save or share a copy" in item.inner_text()
    item.tap()
    assert _shared(phone, 1)["name"] == "office_move_plan_v1.1.md"

    _open_file(phone)
    rail = phone.locator(".backstage-rail-btn[data-backstage-action='Save a copy']")
    assert rail.inner_text().strip() == "Save or share a copy"
    rail.tap()
    assert _shared(phone, 2)["name"] == "office_move_plan_v1.2.md", "each copy is a save: the version moves on"


def test_cancelling_the_share_sheet_changes_nothing(phone, app_server):
    _open(phone, app_server)
    phone.evaluate(
        """() => {
            window.__cancelShare = true;
            window.__objectUrls = 0;
            const create = URL.createObjectURL;
            URL.createObjectURL = function (blob) { window.__objectUrls++; return create.call(URL, blob); };
        }"""
    )
    before = _editor(phone)

    phone.evaluate("() => sharePlanCopy()")  # resolves once the sheet has been dismissed

    assert phone.evaluate("() => window.__shareCalls") == 1, "the share sheet opened"
    assert phone.evaluate("() => window.__objectUrls") == 0, "nothing was downloaded"
    assert _editor(phone) == before, "the version was not bumped"
    assert phone.locator(".baseline-toast").count() == 0, "and no toast complained"


def test_without_a_share_sheet_it_says_download_and_downloads(phone, app_server):
    _open(phone, app_server, share=False)

    _open_sheet(phone)
    assert phone.locator("#phoneSheet .tool[data-id='share']").inner_text().strip() == "Download"
    phone.keyboard.press("Escape")
    phone.wait_for_function("() => !document.getElementById('phoneSheet').hasAttribute('open')")

    _open_drawer(phone)
    assert "Download a copy" in phone.locator("#phoneNavDrawer button[data-id='cmd:share']").inner_text()
    phone.keyboard.press("Escape")
    phone.wait_for_function("() => !document.getElementById('phoneNavDrawer').hasAttribute('open')")

    _open_file(phone)
    rail = phone.locator(".backstage-rail-btn[data-backstage-action='Save a copy']")
    assert rail.inner_text().strip() == "Download a copy"
    with phone.expect_download() as download:
        rail.tap()
    assert download.value.suggested_filename == "office_move_plan_v1.1.md"


def test_a_desktop_s_file_has_no_save_a_copy(page, app_server):
    _open(page, app_server)
    page.evaluate("() => switchToView('backstage')")
    page.wait_for_selector(".backstage-rail-btn[data-backstage-action='Save']", state="visible")
    assert page.is_hidden(".backstage-rail-btn[data-backstage-action='Save a copy']")
