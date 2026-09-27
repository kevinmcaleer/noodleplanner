"""The Report ribbon's Sync button (#1139) and the project workbook target (#1138).

The button used to open Settings > Sync and nothing else. These pin what it
does in each state the sync targets can be in:

- nothing linked: a dialog that says what Sync is for and how to set it up;
- a link needing permission again: a Re-link path, not a silent failure;
- a browser that cannot keep a file link: an honest description of the
  choose-the-file-each-time fallback;
- everything linked: it syncs, shows the run on the button, and says how
  each target ended.

The last one runs the whole project-workbook round trip in the page: the
plan is exported with the app's own workbook builder, a `% Complete` is
edited with ExcelJS the way someone would in Excel, and the linked file
handle is a stub that hands those bytes over and records what is written
back. The File System Access API itself cannot be driven headless -- its
pickers are OS dialogs -- so LocalFileAccess is stubbed at its boundary.

Usage:
    uv run pytest tests/ui/test_sync_button.py -q
"""

import pytest

from .helpers import load_plan, open_project_view, plan_text

pytestmark = pytest.mark.ui

PLAN = """---
title: Office move
start date: 2026-01-05
---
Design
  Wireframes 3d 50% "check with Sam"
  Review 2d
Build
  UI 4d
"""


def _open(page, app_server, plan=PLAN):
    open_project_view(page, app_server)
    load_plan(page, plan, with_project="Office move")


def _click_sync(page):
    page.click('.ribbon-tab-btn[data-tab="report"]')
    page.click('button[data-label="Sync"]')


def _stub_links(page, statuses, supported=True):
    """Replace LocalFileAccess's link state with `statuses` (targetKey ->
    status). Reads and writes of the project workbook go through
    window.__workbookBytes / window.__written."""
    page.evaluate(
        """([statuses, supported]) => {
            window.__written = null;
            LocalFileAccess.isSupported = () => supported;
            LocalFileAccess.ensureRestored = async () => {};
            LocalFileAccess.getLinkStatus = (p, key) => statuses[key] || 'unlinked';
            LocalFileAccess.getLinkedFileName = (p, key) => statuses[key] ? 'Office move.xlsx' : null;
            LocalFileAccess.requestWritePermission = async (p, key) => { statuses[key] = 'linked'; return true; };
            LocalFileAccess.readLinkedFile = async () => ({ name: 'Office move.xlsx', content: window.__workbookBytes });
            LocalFileAccess.writeLinkedFile = async (p, key, content) => {
                window.__written = { key, bytes: content.byteLength };
                return { ok: true, filename: 'Office move.xlsx' };
            };
        }""",
        [statuses, supported],
    )


def _workbook_with_edit(page, task, percent):
    """The plan's own workbook, with `task`'s % Complete changed as in Excel."""
    page.evaluate(
        """async ([task, percent]) => {
            const excel = await import('/static/browser-excel.js');
            const parse = await currentParseResult(document.getElementById('planEditor').value);
            const { buffer } = await excel.exportPlanExcelInBrowser(parse, { download: false });
            const workbook = await excel.loadPlanWorkbook(buffer);
            if (task) {
                workbook.getWorksheet('Tasks').eachRow((row) => {
                    if (String(row.getCell(2).value).trim() === task) row.getCell(7).value = percent;
                });
            }
            window.__workbookBytes = await workbook.xlsx.writeBuffer();
        }""",
        [task, percent],
    )


def test_with_nothing_linked_the_button_explains_how_to_set_sync_up(page, app_server):
    _open(page, app_server)
    _stub_links(page, {})
    _click_sync(page)

    hub = page.locator("#syncHubOverlay.active")
    hub.wait_for()
    assert "Nothing is linked yet" in hub.locator(".sync-hub-intro").inner_text()
    rows = hub.locator(".sync-target-row")
    assert rows.count() == 3
    labels = rows.locator("strong").all_inner_texts()
    assert labels == ["RAID Log", "MS Project Schedule", "Project workbook"]
    workbook = hub.locator('[data-sync-hub-target="workbook"]')
    assert workbook.locator('[data-sync-hub-action="sync"]').inner_text() == "Link existing file…"
    assert workbook.locator('[data-sync-hub-action="create"]').count() == 1
    # The two workbooks say which is which.
    assert "export-only" in workbook.locator(".sync-target-scope").inner_text()
    assert "RAID-only workbook" in hub.locator('[data-sync-hub-target="excel"] .sync-target-scope').inner_text()


def test_without_file_links_the_fallback_is_described_honestly(page, app_server):
    _open(page, app_server, PLAN.replace("---\nDesign", "workbook_file: Office move.xlsx\n---\nDesign"))
    _stub_links(page, {}, supported=False)
    _click_sync(page)

    hub = page.locator("#syncHubOverlay.active")
    hub.wait_for()
    intro = hub.locator(".sync-hub-intro").inner_text()
    assert "can’t remember a file" in intro
    assert "choose the file each time" in intro
    workbook = hub.locator('[data-sync-hub-target="workbook"]')
    assert workbook.locator('[data-sync-hub-action="sync"]').inner_text() == "Choose file…"
    # No Create: nothing could keep the link to what it created.
    assert workbook.locator('[data-sync-hub-action="create"]').count() == 0


def test_a_link_needing_permission_gets_a_relink_path(page, app_server):
    _open(page, app_server)
    _stub_links(page, {"raid-excel": "needs-relink", "project-excel": "linked"})
    _click_sync(page)

    hub = page.locator("#syncHubOverlay.active")
    hub.wait_for()
    assert "need your permission again" in hub.locator(".sync-hub-intro").inner_text()
    raid = hub.locator('[data-sync-hub-target="excel"]')
    assert "needs permission again" in raid.locator(".sync-target-status").inner_text()
    run = hub.locator('#syncHubFooter [data-sync-hub-action="run"]')
    assert run.inner_text() == "Sync 1 ready file"

    raid.locator('[data-sync-hub-action="relink"]').click()
    page.wait_for_function(
        "() => document.querySelector('#syncHubFooter [data-sync-hub-action=\"run\"]').textContent === 'Sync 2 ready files'"
    )


def test_a_linked_workbook_syncs_reviews_and_writes_back(page, app_server):
    _open(page, app_server)
    _workbook_with_edit(page, "Review", 100)
    _stub_links(page, {"project-excel": "linked"})
    _click_sync(page)

    review = page.locator("#workbookSyncOverlay.active")
    review.wait_for()
    # The run is visible on the button while the review is open.
    assert page.locator('button[data-label="Sync"][data-sync-state="running"]').count() == 1
    entries = review.locator(".raid-sync-entry")
    assert entries.count() == 1
    assert "Review" in entries.first.inner_text()
    assert entries.first.locator(".raid-sync-kind-badge").inner_text().lower() == "updated"

    review.locator("np-button[variant=primary]").click()
    # The run ends only once the write-back and its front-matter stamp are
    # both done, so wait for that rather than for the write alone.
    page.wait_for_function("() => window.__written && window.__written.key === 'project-excel' && !isSyncRunning()")
    editor = plan_text(page)
    assert "  Review 2d 100%" in editor
    assert "workbook_file: Office move.xlsx" in editor
    assert page.locator('button[data-label="Sync"][data-sync-state="running"]').count() == 0


def test_an_unchanged_workbook_syncs_without_a_review(page, app_server):
    _open(page, app_server)
    _workbook_with_edit(page, None, None)
    _stub_links(page, {"project-excel": "linked"})
    _click_sync(page)

    page.wait_for_function("() => window.__written && !isSyncRunning()")
    assert page.locator("#workbookSyncOverlay.active").count() == 0
    assert page.locator("#syncHubOverlay.active").count() == 0


def test_cancelling_a_review_ends_the_run(page, app_server):
    _open(page, app_server)
    _workbook_with_edit(page, "Review", 100)
    _stub_links(page, {"project-excel": "linked"})
    _click_sync(page)

    review = page.locator("#workbookSyncOverlay.active")
    review.wait_for()
    review.locator("np-button[variant=neutral]").click()
    page.wait_for_function("() => !isSyncRunning()")
    assert "  Review 2d\n" in plan_text(page)
    assert page.evaluate("() => window.__written") is None


def test_settings_lists_the_project_workbook_apart_from_the_raid_workbook(page, app_server):
    _open(page, app_server)
    _stub_links(page, {})
    page.evaluate("() => { openSettingsPanel('sync'); }")
    rows = page.locator("#syncSettingsList .sync-target-row")
    rows.nth(2).wait_for()
    assert rows.locator("strong").all_inner_texts() == ["RAID Log", "MS Project Schedule", "Project workbook"]
    workbook = rows.nth(2)
    assert "Tasks sheet" in workbook.locator(".sync-target-scope").inner_text()
    assert workbook.locator("[data-sync-create]").inner_text() == "Create…"
    # The RAID workbook has no Create: it is written by the RAID view.
    assert rows.nth(0).locator("[data-sync-create]").count() == 0
