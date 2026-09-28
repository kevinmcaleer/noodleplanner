"""The Report ribbon's Sync button (#1139) and the project workbook target (#1138).

The button used to open Settings > Sync and nothing else. These pin what it
does in each state the sync targets can be in:

- nothing linked: a dialog that says what Sync is for and how to set it up;
- a link needing permission again: a Re-link path, not a silent failure;
- a browser that cannot keep a file link: an honest description of the
  choose-the-file-each-time fallback;
- everything linked: it syncs in one click -- applies the changes, writes
  back, and says how each target ended -- opening a review only for a change
  that needs a decision (a conflict or a removal).

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


def test_a_linked_workbook_syncs_in_one_click_without_a_review(page, app_server):
    """Once set up, the button is for keeping the files in step quickly: it
    applies what changed, writes back, and says so -- no dialog in the way."""
    _open(page, app_server)
    _workbook_with_edit(page, "Review", 100)
    _stub_links(page, {"project-excel": "linked"})
    page.evaluate("() => { window.__toasts = []; const t = window.showToast; window.showToast = (m, k) => { window.__toasts.push(m); return t(m, k); }; }")
    _click_sync(page)

    # The run ends only once the write-back and its front-matter stamp are
    # both done, so wait for that rather than for the write alone.
    page.wait_for_function("() => window.__written && window.__written.key === 'project-excel' && !isSyncRunning()")
    assert page.locator("#workbookSyncOverlay.active").count() == 0
    assert page.locator("#syncHubOverlay.active").count() == 0
    editor = plan_text(page)
    assert "  Review 2d 100%" in editor
    assert "workbook_file: Office move.xlsx" in editor
    assert page.locator('button[data-label="Sync"][data-sync-state="running"]').count() == 0
    # One toast for the run, saying what happened, not one per step.
    toasts = page.evaluate("() => window.__toasts")
    assert toasts == ["Synced 1 file — Project workbook: changes applied (1 change)."]


def test_a_removal_still_opens_the_review_from_the_button(page, app_server):
    """A deleted row needs a decision: the default keeps the task, and the
    write-back would then put it straight back into the workbook."""
    _open(page, app_server)
    _workbook_with_edit(page, None, None)
    page.evaluate(
        """async () => {
            const excel = await import('/static/browser-excel.js');
            const workbook = await excel.loadPlanWorkbook(window.__workbookBytes);
            const sheet = workbook.getWorksheet('Tasks');
            sheet.eachRow((row, n) => { if (String(row.getCell(2).value).trim() === 'UI') sheet.spliceRows(n, 1); });
            window.__workbookBytes = await workbook.xlsx.writeBuffer();
        }"""
    )
    _stub_links(page, {"project-excel": "linked"})
    _click_sync(page)

    review = page.locator("#workbookSyncOverlay.active")
    review.wait_for()
    assert page.locator('button[data-label="Sync"][data-sync-state="running"]').count() == 1
    kinds = review.locator(".raid-sync-kind-badge").all_inner_texts()
    assert "removed" in [k.lower() for k in kinds]


def _run_with_review(page):
    """A run that reviews every change: what Settings > Sync's Sync Now and
    the per-target paths do, as opposed to the button's one-click run."""
    page.evaluate(
        "() => { runSyncTargets([SYNC_TARGET_DEFS.find((d) => d.targetKey === 'project-excel')]); }"
    )


def test_a_reviewed_sync_applies_and_writes_back(page, app_server):
    _open(page, app_server)
    _workbook_with_edit(page, "Review", 100)
    _stub_links(page, {"project-excel": "linked"})
    _run_with_review(page)

    review = page.locator("#workbookSyncOverlay.active")
    review.wait_for()
    # The run waits on the review.
    assert page.evaluate("() => isSyncRunning()")
    entries = review.locator(".raid-sync-entry")
    assert entries.count() == 1
    assert "Review" in entries.first.inner_text()
    assert entries.first.locator(".raid-sync-kind-badge").inner_text().lower() == "updated"

    review.locator("np-button[variant=primary]").click()
    page.wait_for_function("() => window.__written && window.__written.key === 'project-excel' && !isSyncRunning()")
    assert "  Review 2d 100%" in plan_text(page)


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
    _run_with_review(page)

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


def _click_sync_files(page):
    page.click('.ribbon-tab-btn[data-tab="report"]')
    page.click('button[data-label="Sync Files"]')


def test_with_a_workbook_linked_sync_files_still_opens_the_dialog(page, app_server):
    """Once every link works, Sync syncs straight away and never shows the
    dialog, so Sync Files is the way back to it: to link MS Project as well,
    or to change the workbook for a different file."""
    _open(page, app_server, PLAN.replace("---\nDesign", "workbook_file: Office move.xlsx\n---\nDesign"))
    _stub_links(page, {"project-excel": "linked"})
    _click_sync_files(page)

    hub = page.locator("#syncHubOverlay.active")
    hub.wait_for()
    assert "Link another file" in hub.locator(".sync-hub-intro").inner_text()
    workbook = hub.locator('[data-sync-hub-target="workbook"]')
    assert workbook.locator('[data-sync-hub-action="change"]').inner_text() == "Change file…"
    assert workbook.locator('[data-sync-hub-action="unlink"]').count() == 1
    msp = hub.locator('[data-sync-hub-target="msproject"]')
    assert msp.locator('[data-sync-hub-action="sync"]').inner_text() == "Link existing file…"
    assert msp.locator('[data-sync-hub-action="unlink"]').count() == 0
    run = hub.locator('#syncHubFooter [data-sync-hub-action="run"]')
    assert run.inner_text() == "Sync 1 ready file"


def test_change_file_opens_the_picker_and_forgets_the_old_snapshot(page, app_server):
    _open(page, app_server, PLAN.replace("---\nDesign", "workbook_file: Office move.xlsx\n---\nDesign"))
    _workbook_with_edit(page, None, None)
    _stub_links(page, {"project-excel": "linked"})
    page.evaluate(
        """async () => {
            const sync = await import('/static/workbook-sync.js');
            sync.setWorkbookSyncState(getCurrentProjectId() || 'default', { filename: 'Office move.xlsx', rows: [], syncedAt: '' });
            window.__read = false;
            window.__forgot = [];
            const forget = window.forgetSyncBaseline;
            window.forgetSyncBaseline = async (key, projectId) => { window.__forgot.push(key); return forget(key, projectId); };
            LocalFileAccess.readLinkedFile = async () => { window.__read = true; return null; };
            LocalFileAccess.pickAndLinkFile = async (p, key) => {
                window.__picked = key;
                return { name: 'Office move v2.xlsx', content: window.__workbookBytes };
            };
        }"""
    )
    _click_sync_files(page)
    hub = page.locator("#syncHubOverlay.active")
    hub.wait_for()
    hub.locator('[data-sync-hub-target="workbook"] [data-sync-hub-action="change"]').click()

    page.wait_for_function("() => window.__written && !isSyncRunning()")
    assert page.evaluate("() => window.__picked") == "project-excel"
    # Straight to the picker: the linked file is not read first.
    assert page.evaluate("() => window.__read") is False
    assert "workbook_file: Office move v2.xlsx" in plan_text(page)
    # A different file: the old file's snapshot is not the base for its diff.
    assert page.evaluate("() => window.__forgot") == ["workbook"]


def test_settings_storage_opens_the_sync_dialog(page, app_server):
    _open(page, app_server)
    _stub_links(page, {"project-excel": "linked"})
    page.evaluate("() => { openSettingsPanel('storage'); }")
    page.click("#storageSyncFilesBtn")
    hub = page.locator("#syncHubOverlay.active")
    hub.wait_for()
    assert hub.locator('[data-sync-hub-target="workbook"] [data-sync-hub-action="change"]').count() == 1
