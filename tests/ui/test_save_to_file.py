"""Save asks where to put a plan that has no file yet, then keeps saving there (#1406).

In a browser with the File System Access API, the first Save of a plan that
was never opened from disk opens the browser's save dialog. The file chosen
there is linked to the plan, so every later Save writes to it, as it does
for a plan opened with File > Open... (#767). File > Save As... moves the
plan to a new file, and File > Download a copy is the download Save used to
be. Where the API is missing, Save still downloads and those two stay hidden.

The save dialog is an OS dialog, so it is stubbed. What it returns is a real
file handle from the origin private file system, so the writes are the
browser's own.

Usage:
    uv run pytest tests/ui/test_save_to_file.py -q
"""

import pytest

from .helpers import (
    load_plan,
    open_project_view,
    opfs_read,
    wait_for_link_status,
    wait_for_opfs_text,
)

pytestmark = pytest.mark.ui

PROJECT = "Office move"
FILE_NAME = PROJECT + ".md"

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

# showSaveFilePicker opens `window.__saveAs` (or the suggested name) in the
# origin private file system, or throws AbortError, as a cancelled dialog
# does, when `window.__cancelDialog` is set. It records each call's
# suggested name.
STUB_DIALOGS = """
(() => {
    window.__suggested = [];
    window.showSaveFilePicker = async (options) => {
        window.__suggested.push(options.suggestedName);
        if (window.__cancelDialog) throw new DOMException('The user aborted a request.', 'AbortError');
        const root = await navigator.storage.getDirectory();
        return root.getFileHandle(window.__saveAs || options.suggestedName, { create: true });
    };
    window.showOpenFilePicker = async () => { throw new DOMException('not used here', 'AbortError'); };
})();
"""

# Firefox and Safari have neither picker.
NO_FILE_ACCESS = """
window.showSaveFilePicker = undefined;
window.showOpenFilePicker = undefined;
"""


def _open(page, app_server, init_script=STUB_DIALOGS):
    page.context.add_init_script(init_script)
    open_project_view(page, app_server)
    load_plan(page, PLAN, with_project=PROJECT)


def _dialogs_opened(page):
    return page.evaluate("() => window.__suggested")


def _show_backstage(page):
    """Open File (the Backstage), and wait for its rail."""
    page.evaluate("() => switchToView('backstage')")
    page.wait_for_selector(".backstage-rail-btn[data-backstage-action='Save']", state="visible")


def _file_action(page, label):
    """Click `label` in File (the Backstage rail), the way a user does."""
    _show_backstage(page)
    page.click(f".backstage-rail-btn[data-backstage-action='{label}']")


def _saved(page, app_server):
    """A plan whose first Save has linked it to FILE_NAME (version 1.1)."""
    _open(page, app_server)
    page.keyboard.press("Control+s")
    wait_for_link_status(page, "🔗 " + FILE_NAME)
    wait_for_opfs_text(page, FILE_NAME, "version: 1.1")


def test_first_save_asks_where_then_later_saves_write_there(page, app_server):
    _open(page, app_server)
    wait_for_link_status(page, "")
    downloads = []
    page.on("download", lambda download: downloads.append(download.suggested_filename))

    page.keyboard.press("Control+s")
    wait_for_link_status(page, "🔗 " + FILE_NAME)
    wait_for_opfs_text(page, FILE_NAME, "version: 1.1")
    assert _dialogs_opened(page) == [FILE_NAME], "one save dialog, suggesting the plan's name"
    assert "Wireframes 3d" in opfs_read(page, FILE_NAME), "the whole plan was written"

    page.keyboard.press("Control+s")
    wait_for_opfs_text(page, FILE_NAME, "version: 1.2")
    assert _dialogs_opened(page) == [FILE_NAME], "the second Save wrote to the same file, with no dialog"
    assert downloads == [], "and nothing was downloaded"


def test_cancelling_the_save_dialog_does_nothing(page, app_server):
    _open(page, app_server)
    page.evaluate("() => { window.__cancelDialog = true; }")
    before = page.eval_on_selector("#planEditor", "editor => editor.value")
    page.evaluate(
        """() => {
            window.__objectUrls = 0;
            const create = URL.createObjectURL;
            URL.createObjectURL = function (blob) { window.__objectUrls++; return create.call(URL, blob); };
        }"""
    )

    page.evaluate("() => downloadMarkdown()")  # resolves once Save has finished

    assert _dialogs_opened(page) == [FILE_NAME], "the dialog opened"
    assert page.evaluate("() => window.__objectUrls") == 0, "nothing was downloaded"
    assert page.eval_on_selector("#planEditor", "editor => editor.value") == before, "the version was not bumped"
    assert page.locator(".baseline-toast").count() == 0, "and no toast complained"
    assert page.text_content("#localFileLinkStatus") == ""


def test_save_as_moves_the_plan_to_a_new_file(page, app_server):
    _saved(page, app_server)
    page.evaluate("() => { window.__saveAs = 'office-move-v2.md'; }")

    _file_action(page, "Save As…")
    wait_for_link_status(page, "🔗 office-move-v2.md")
    wait_for_opfs_text(page, "office-move-v2.md", "version: 1.2")
    assert _dialogs_opened(page) == [FILE_NAME, FILE_NAME], "Save As asked, suggesting the current file's name"
    assert "version: 1.1" in opfs_read(page, FILE_NAME), "the old file was left as it was"

    page.keyboard.press("Control+s")
    wait_for_opfs_text(page, "office-move-v2.md", "version: 1.3")
    assert len(_dialogs_opened(page)) == 2, "and Save now writes to the new file, with no dialog"


def test_download_a_copy_leaves_the_linked_file_alone(page, app_server):
    _saved(page, app_server)

    with page.expect_download() as download:
        _file_action(page, "Download a copy")
    assert download.value.suggested_filename == "office_move_plan_v1.2.md"
    assert "version: 1.1" in opfs_read(page, FILE_NAME), "the linked file was not written"
    assert _dialogs_opened(page) == [FILE_NAME], "and no dialog opened"
    wait_for_link_status(page, "🔗 " + FILE_NAME)


def test_save_as_and_download_a_copy_show_only_where_save_can_write_files(page, app_server):
    _open(page, app_server)
    _show_backstage(page)
    for label in ("Save As…", "Download a copy"):
        assert page.is_visible(f".backstage-rail-btn[data-backstage-action='{label}']"), label


def test_without_file_access_save_still_downloads(page, app_server):
    _open(page, app_server, init_script=NO_FILE_ACCESS)
    _show_backstage(page)
    for label in ("Save As…", "Download a copy"):
        assert page.is_hidden(f".backstage-rail-btn[data-backstage-action='{label}']"), label

    with page.expect_download() as download:
        _file_action(page, "Save")
    assert download.value.suggested_filename == "office_move_plan_v1.1.md"
    assert page.text_content("#localFileLinkStatus") == ""
