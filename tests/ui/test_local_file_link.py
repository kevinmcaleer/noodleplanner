"""A plan opened from disk keeps saving to its file after a reload (#1407).

File > Open... links the project to the `.md` file it came from, and Save
writes back to that file (#767). The link was stored in IndexedDB but never
read back when a project loaded, so after a reload the status bar went blank
and Save downloaded a versioned copy instead.

The File System Access API's pickers are OS dialogs, so the picker is
stubbed. What it returns is real, though: a file handle from the origin
private file system. Unlike a hand-made fake, that handle can be stored in
IndexedDB and written through, so the reload and the write are both the
browser's own.

Usage:
    uv run pytest tests/ui/test_local_file_link.py -q
"""

import pytest

from .helpers import (
    open_project_view,
    opfs_read,
    opfs_write,
    wait_for_link_status,
    wait_for_opfs_text,
)

pytestmark = pytest.mark.ui

FILE_NAME = "office-move.md"

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

# showOpenFilePicker hands back a real handle to FILE_NAME in the origin
# private file system, and counts its calls so a test can show Save never
# opened it. An init script, so it is in place again after each reload.
STUB_PICKER = """
(() => {
    const name = %r;
    window.__pickerCalls = 0;
    async function handle() {
        const root = await navigator.storage.getDirectory();
        return root.getFileHandle(name, { create: true });
    }
    window.showOpenFilePicker = async () => { window.__pickerCalls++; return [await handle()]; };
    window.showSaveFilePicker = async () => { window.__pickerCalls++; return handle(); };
})();
""" % FILE_NAME


# After a reload the browser often wants to ask for write permission again.
# Origin-private handles never ask, so this makes them: queryPermission()
# reports window.__permission, and requestPermission() -- the prompt -- answers
# window.__onRequest.
ASK_AGAIN = """
(() => {
    window.__permission = 'prompt';
    window.__onRequest = 'denied';
    FileSystemHandle.prototype.queryPermission = async function () { return window.__permission; };
    FileSystemHandle.prototype.requestPermission = async function () {
        window.__permission = window.__onRequest;
        return window.__onRequest;
    };
})();
"""


def _open_linked_plan(page, app_server):
    """Open PLAN from disk with File > Open..., and return its project id."""
    page.context.add_init_script(STUB_PICKER)
    open_project_view(page, app_server)
    opfs_write(page, FILE_NAME, PLAN)
    page.evaluate("() => openLocalPlanFile()")
    wait_for_link_status(page, "🔗 " + FILE_NAME)
    return page.evaluate("() => getCurrentProjectId()")


def test_save_writes_to_the_linked_file_after_a_reload(page, app_server):
    _open_linked_plan(page, app_server)

    open_project_view(page, app_server)  # reload
    wait_for_link_status(page, "🔗 " + FILE_NAME)

    downloads = []
    page.on("download", lambda download: downloads.append(download.suggested_filename))
    page.keyboard.press("Control+s")

    wait_for_opfs_text(page, FILE_NAME, "version: 1.1")
    saved = opfs_read(page, FILE_NAME)
    assert "Wireframes 3d" in saved, "the plan itself was written, not just front matter"
    assert downloads == [], "Save wrote to the file instead of downloading a copy"
    assert page.evaluate("() => window.__pickerCalls") == 0, "and opened no file dialog"


def test_refusing_permission_downloads_a_copy_and_keeps_the_link(page, app_server):
    _open_linked_plan(page, app_server)
    page.context.add_init_script(ASK_AGAIN)

    open_project_view(page, app_server)  # reload
    wait_for_link_status(page, "🔗 Needs access: " + FILE_NAME)
    before = opfs_read(page, FILE_NAME)

    # The user refuses the prompt Save raises: a copy downloads, a toast
    # says the file was not updated, and the link stays.
    with page.expect_download():
        page.keyboard.press("Control+s")
    page.wait_for_selector(
        ".baseline-toast-error:has-text('%s was not updated')" % FILE_NAME, state="attached"
    )
    assert opfs_read(page, FILE_NAME) == before, "the file on disk was left alone"
    wait_for_link_status(page, "🔗 Needs access: " + FILE_NAME)

    # Next Save, the user allows it: the file is written and nothing downloads.
    page.evaluate("() => { window.__onRequest = 'granted'; }")
    downloads = []
    page.on("download", lambda download: downloads.append(download.suggested_filename))
    page.keyboard.press("Control+s")
    wait_for_link_status(page, "🔗 " + FILE_NAME)
    assert "version: 1.2" in opfs_read(page, FILE_NAME), "the second Save wrote to the file"
    assert downloads == []


def test_each_project_keeps_its_link_across_a_switch(page, app_server):
    linked_id = _open_linked_plan(page, app_server)

    # Make an unlinked project current, so the reload starts on that one and
    # the linked project is only restored when it is switched to.
    page.evaluate(
        """async () => {
            const other = createProject('Unlinked');
            saveProject(other.id, { planText: '---\\ntitle: Unlinked\\n---\\nTask 1d\\n' });
            await loadProjectIntoEditor(other.id);
        }"""
    )
    wait_for_link_status(page, "")
    open_project_view(page, app_server)  # reload
    page.wait_for_function("() => document.getElementById('planEditor').value.includes('Unlinked')")
    wait_for_link_status(page, "")

    page.evaluate("id => switchToProject(id)", linked_id)
    wait_for_link_status(page, "🔗 " + FILE_NAME)
