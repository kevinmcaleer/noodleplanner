"""Selenium-driven browser tests for whiteboard post-it notes (issue #846).

These exercise the actual rendered note DOM (a <foreignObject class="wb-note">
per summary task with a whiteboard row, embedding a normal HTML card) against
a real running instance of the app in headless Chrome, following the same
self-contained app_server/browser fixture pattern as
tests/test_whiteboard_canvas.py (#845) and tests/test_usability.py.

Covers what tests/test_whiteboard_notes.js (the pure view-model logic) can't:
real DOM structure and positioning, checkbox click -> #planEditor mutation
through the real commit path, single-undo-step behaviour, round-trip
byte-identity of a tick+untick cycle, zoom-fit framing real notes, and the
sub-40%-zoom title-only degrade actually applying to rendered elements.

Usage:
    uv run pytest tests/test_whiteboard_notes.py -x -q
"""

import socket
import threading
import time

import pytest

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import WebDriverException

    HAS_SELENIUM = True
except ImportError:
    HAS_SELENIUM = False

try:
    import uvicorn
    from noodle_web.app import app as fastapi_app

    HAS_APP = True
except ImportError:
    HAS_APP = False

pytestmark = [
    pytest.mark.usability,
    pytest.mark.skipif(not HAS_SELENIUM, reason="selenium not installed"),
    pytest.mark.skipif(not HAS_APP, reason="noodle_web not importable"),
]

SAMPLE_PLAN = """---
title: Whiteboard Notes Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 100%
    Interviews @sam 2d
  Build
    Ship Widget $Widget @sam 3d 100%
    Nested
      Sub A 1d
      Sub B 1d
  Empty Phase "Chase the vendor for a quote."
  Loose Idea

---whiteboard---
| Task        | X   | Y  | Colour  | Width | Height | Collapsed |
|-------------|-----|----|---------|-------|--------|-----------|
| Discovery   | 120 | 80 | #4A90D9 | 280   | 240    | no        |
| Build       | 480 | 80 |         | 280   | 260    | no        |
| Empty Phase | 120 | 400 |        | 240   | 180    | no        |
| Loose Idea  | 480 | 400 |        | 240   | 180    | no        |
"""


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def app_server():
    port = find_free_port()
    config = uvicorn.Config(fastapi_app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.1)
    else:
        pytest.fail("App server did not start in time")

    yield base_url

    server.should_exit = True
    thread.join(timeout=5)


def _create_chrome_driver():
    options = ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,900")

    import os

    if os.path.exists("/usr/bin/chromium"):
        options.binary_location = "/usr/bin/chromium"

    try:
        if os.path.exists("/usr/bin/chromedriver"):
            service = ChromeService("/usr/bin/chromedriver")
            return webdriver.Chrome(service=service, options=options)
        return webdriver.Chrome(options=options)
    except WebDriverException:
        pytest.skip("Chrome/chromedriver not available on this system")


@pytest.fixture(scope="module")
def browser():
    driver = _create_chrome_driver()
    driver.implicitly_wait(3)
    yield driver
    driver.quit()


# ── Shared helpers ──────────────────────────────────────────────────────


def dismiss_tour(driver):
    driver.execute_script(
        "document.cookie = 'tourCompleted=true; path=/; max-age=31536000';"
        "['tourOverlay','tourPopup','tourSpotlight'].forEach(function(id){"
        "  var el = document.getElementById(id); if (el) el.style.display = 'none';"
        "});"
    )


def open_app(driver, base_url):
    driver.get(base_url)
    dismiss_tour(driver)
    time.sleep(0.3)


def load_sample_plan(driver):
    """Set #planEditor to SAMPLE_PLAN and let the render pipeline settle."""
    editor = WebDriverWait(driver, 5).until(
        EC.presence_of_element_located((By.ID, "planEditor"))
    )
    driver.execute_script(
        "arguments[0].value = arguments[1];"
        "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
        editor,
        SAMPLE_PLAN,
    )
    # Let the debounced auto-render (and updateAllViews -> updateWhiteboardView
    # cache population) settle before switching to the whiteboard tab.
    # Specifically wait out the known first-render RAG front-matter
    # normalisation (see wait_for_front_matter_rag()) so it can't land
    # later and get mistaken for part of a subsequent tick's undo step,
    # then confirm general quiescence too.
    wait_for_front_matter_rag(driver)
    wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.5)


def switch_to_whiteboard(driver):
    driver.execute_script("switchToView('whiteboard');")
    WebDriverWait(driver, 5).until(
        EC.visibility_of_element_located((By.ID, "whiteboardContainer"))
    )
    time.sleep(0.4)


def get_note(driver, task_name):
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask === arguments[0]) return {
                x: n.getAttribute('x'), y: n.getAttribute('y'),
                width: n.getAttribute('width'), height: n.getAttribute('height'),
                html: n.querySelector('.wb-note-card').outerHTML,
                titleOnly: n.querySelector('.wb-note-card').classList.contains('wb-note-title-only'),
            };
        }
        return null;
        """,
        task_name,
    )


def get_plan_text(driver):
    return driver.execute_script("return document.getElementById('planEditor').value;")


def add_row_input_for(driver, task_name):
    """The "Add task..." row's own <input> (issue #1104) inside `task_name`'s
    note, or None if that note isn't on the board or isn't a checklist note
    (a still-freeform note has no add-row -- see wbUpdateNoteNode())."""
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask === arguments[0]) return n.querySelector('.wb-note-add-input');
        }
        return null;
        """,
        task_name,
    )


def wait_for_front_matter_rag(driver, timeout=15.0, interval=0.25):
    """Poll until #planEditor's front matter has a `rag:` field.

    Root cause (traced via a monkeypatched HTMLTextAreaElement.value
    setter): status-bar.js's updateStatusBarRAG(), called on every
    updateAllViews() render, calls version-history.js's
    persistRagToFrontMatter() the first time `rag:` is missing, which
    writes it into #planEditor via setEditorValuePreservingCursor() --
    silently (no 'input' dispatch, so it never gets its own undo
    snapshot), but on a timer entirely independent of this test's own
    actions. Under this sandbox's load, that first natural render can
    take much longer than a short fixed sleep -- wait for the specific,
    known side effect rather than guessing at timing, so a "before"
    baseline captured right after this call can't have that render land
    later and get mistaken for part of a subsequent tick's undo step.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "rag:" in get_plan_text(driver):
            return True
        time.sleep(interval)
    return False


def wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.5, interval=0.25):
    """Poll #planEditor's value until it stops changing for `quiet` seconds.

    A fixed sleep is a race against any async rewrite of the editor value
    (see wait_for_front_matter_rag() for the specific known one); polling
    for actual quiescence is what the single-undo-step and round-trip
    tests below need so an unrelated, later write can't land in between.
    """
    deadline = time.time() + timeout
    last = get_plan_text(driver)
    stable_since = time.time()
    while time.time() < deadline:
        time.sleep(interval)
        current = get_plan_text(driver)
        if current != last:
            last = current
            stable_since = time.time()
        elif time.time() - stable_since >= quiet:
            return last
    return last


def line_for_task(plan_text, task_name):
    """The single markdown line whose task name token is task_name (word-
    boundary match on the trimmed line start, so 'Interviews' doesn't also
    match e.g. 'Interviews 2' if such a task existed)."""
    for line in plan_text.split("\n"):
        if line.strip().split(" ")[0] == task_name or line.strip().startswith(task_name + " "):
            return line
    return None


# ── Tests ────────────────────────────────────────────────────────────────


class TestNoteRendering:
    def test_note_renders_at_stored_position_and_size(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        note = get_note(browser, "Discovery")
        assert note is not None, "Discovery has a whiteboard row and must render a note"
        assert note["x"] == "120"
        assert note["y"] == "80"
        assert note["width"] == "280"
        assert note["height"] == "240"

    def test_note_body_lists_only_direct_children(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        row_names = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask === 'Build') {
                    return Array.from(n.querySelectorAll('.wb-note-row-name')).map(el => el.textContent);
                }
            }
            return null;
            """
        )
        assert row_names is not None
        assert set(row_names) == {"Ship Widget", "Nested"}
        assert "Sub A" not in row_names and "Sub B" not in row_names, \
            "grandchildren must never appear in the note body"

    def test_child_with_children_shows_count_badge(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        badge_text = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Build') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                const nestedRow = rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Nested');
                const badge = nestedRow && nestedRow.querySelector('.wb-note-count-badge');
                return badge ? badge.textContent : null;
            }
            return null;
            """
        )
        assert badge_text is not None and "2" in badge_text

    def test_empty_task_renders_as_free_form_note(self, browser, app_server):
        """Issue #1015: a task with no children at all is a free-form
        note, not an empty checklist -- it shows its own comment text
        (here: 'Chase the vendor for a quote.', set on the 'Empty Phase'
        line in SAMPLE_PLAN) and neither the old checklist empty-state
        copy nor a progress footer."""
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        note = get_note(browser, "Empty Phase")
        assert note is not None
        assert "wb-note-freeform" in note["html"], "a childless task renders with the free-form class"
        assert "Chase the vendor for a quote." in note["html"], "the task's own comment shows as the note's body text"
        assert "wb-note-empty" not in note["html"], \
            "the old checklist-specific 'No subtasks yet' placeholder must not appear on a free-form note"

        footer_visible = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Empty Phase') continue;
                const footer = n.querySelector('.wb-note-footer');
                return getComputedStyle(footer).display !== 'none';
            }
            return null;
            """
        )
        assert footer_visible is False, "the progress footer is not rendered for a free-form note"

    def test_note_gains_checklist_rendering_when_first_child_is_added(self, browser, app_server):
        """Issue #1015: a free-form note switches to checklist rendering
        (child rows, progress footer) the instant its task gains a first
        child -- no separate 'convert to checklist' action anywhere.

        Uses 'Loose Idea' (no comment) rather than 'Empty Phase': giving a
        *summary* task both an inline comment token and a child at once
        hits a pre-existing, unrelated outline-parser quirk (the comment
        stays glued onto `.name` instead of being split into `.comment`)
        that has nothing to do with free-form rendering -- keeping the two
        fixtures separate avoids that quirk rather than working around it
        here."""
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = get_note(browser, "Loose Idea")
        assert before is not None and "wb-note-freeform" in before["html"]

        plan_text = get_plan_text(browser)
        # Give "Loose Idea" its first child, indented one level under it,
        # exactly like a user typing directly into the outline would.
        updated = plan_text.replace(
            '  Loose Idea',
            '  Loose Idea\n    First subtask',
        )
        assert updated != plan_text, "the replacement must actually match SAMPLE_PLAN's own text"
        editor = browser.find_element(By.ID, "planEditor")
        browser.execute_script(
            "arguments[0].value = arguments[1];"
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
            editor,
            updated,
        )
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        after = get_note(browser, "Loose Idea")
        assert after is not None
        assert "wb-note-freeform" not in after["html"], "the note is no longer free-form once it has a child"
        assert "First subtask" in after["html"], "the new child renders as a checklist row"

        footer_visible = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Loose Idea') continue;
                const footer = n.querySelector('.wb-note-footer');
                return getComputedStyle(footer).display !== 'none';
            }
            return null;
            """
        )
        assert footer_visible is True, "the progress footer appears once the note has a checklist"

    def test_existing_checklist_notes_are_unaffected(self, browser, app_server):
        """Issue #1015: notes that already have children (Discovery,
        Build -- both present in SAMPLE_PLAN with subtasks) must keep
        rendering exactly as the #846 checklist post-it always has."""
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        for task_name in ("Discovery", "Build"):
            note = get_note(browser, task_name)
            assert note is not None
            assert "wb-note-freeform" not in note["html"], \
                f"{task_name} has children and must not render as free-form"
            assert "wb-note-row" in note["html"], f"{task_name} still shows its checklist rows"

            footer_visible = browser.execute_script(
                """
                const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
                for (const n of notes) {
                    if (n.dataset.wbTask !== arguments[0]) continue;
                    const footer = n.querySelector('.wb-note-footer');
                    return getComputedStyle(footer).display !== 'none';
                }
                return null;
                """,
                task_name,
            )
            assert footer_visible is True, f"{task_name}'s progress footer is still shown"

    def test_progress_footer_matches_direct_children(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        progress = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask === 'Build') {
                    return n.querySelector('.wb-note-progress').textContent;
                }
            }
            return null;
            """
        )
        # Build's direct children: Widget (100%, complete), Nested (0%, not).
        assert progress == "1 / 2"

    def test_deliverable_child_keeps_its_badge(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        has_badge = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Build') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                const widgetRow = rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Ship Widget');
                return !!(widgetRow && widgetRow.querySelector('.wb-note-deliverable-badge'));
            }
            return false;
            """
        )
        assert has_badge is True

    def test_free_form_note_round_trips_through_whiteboard_section(self, browser, app_server):
        """Issue #1015's own acceptance criterion: a free-form note's row
        persists to and loads from ---whiteboard--- like any other note.
        Nothing about the table's columns changed for this issue (whether
        a note renders free-form or as a checklist is derived from the
        outline, not stored as a column here -- see plan-format.rst's
        'Whiteboard rows' section), so simply rendering a free-form note
        must not rewrite the plan text at all."""
        open_app(browser, app_server)
        load_sample_plan(browser)
        before = get_plan_text(browser)

        switch_to_whiteboard(browser)
        note = get_note(browser, "Empty Phase")
        assert note is not None and "wb-note-freeform" in note["html"]
        assert note["x"] == "120" and note["y"] == "400", \
            "the free-form note's stored X/Y round-tripped through the whiteboard table unchanged"

        after = get_plan_text(browser)
        assert after == before, "merely rendering a free-form note must not write anything to the plan"


class TestChecklistTicking:
    def test_ticking_writes_100_percent_and_updates_editor(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = get_plan_text(browser)
        before_line = line_for_task(before, "Interviews")
        assert before_line is not None and "100%" not in before_line.split()

        clicked = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Discovery') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                const target = rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Interviews');
                if (!target) return false;
                target.querySelector('.wb-note-checkbox').click();
                return true;
            }
            return false;
            """
        )
        assert clicked is True
        time.sleep(0.5)

        after = get_plan_text(browser)
        after_line = line_for_task(after, "Interviews")
        assert after_line is not None and "100%" in after_line.split(), after

    def test_unticking_reverses_exactly(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        original = wait_for_stable_plan_text(browser)

        # Tick then untick the same checkbox (Research starts at 100%, so
        # untick first, then tick back -- exercises both directions).
        browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Discovery') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                const target = rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Research');
                target.querySelector('.wb-note-checkbox').click();
            }
            """
        )
        time.sleep(0.5)
        mid = get_plan_text(browser)
        mid_line = line_for_task(mid, "Research")
        assert mid_line is not None and "0%" in mid_line.split()

        browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Discovery') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                const target = rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Research');
                target.querySelector('.wb-note-checkbox').click();
            }
            """
        )
        time.sleep(0.5)
        after = get_plan_text(browser)
        assert after == original, "tick+untick must leave the plan text byte-identical"

    def test_ticking_is_a_single_undo_step(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        # Note: we deliberately do NOT compare whole-plan-text equality
        # across the undo here. status-bar.js's updateStatusBarRAG() calls
        # version-history.js's persistRagToFrontMatter() on every render,
        # which silently writes `rag:` into front matter the first time
        # it's missing -- via setEditorValuePreservingCursor(), which never
        # dispatches 'input', so that write never gets its own undo
        # snapshot. That's correct behaviour for the app in general (a
        # derived metadata field re-syncing on the next render regardless),
        # but it means a single undo of *any* real edit -- not just a
        # whiteboard tick -- can also implicitly discard that invisible
        # sync if it happened to land in between. So this test checks the
        # one thing #846 actually owns: the Interviews line's own percent
        # token, before/after the tick/undo.
        before = wait_for_stable_plan_text(browser)
        before_line = line_for_task(before, "Interviews")
        assert before_line is not None and "100%" not in before_line.split()

        browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Discovery') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                const target = rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Interviews');
                target.querySelector('.wb-note-checkbox').click();
            }
            """
        )
        # Wait for the tick (and the 600ms undo-snapshot debounce) to
        # settle as its own single snapshot before we undo.
        ticked = wait_for_stable_plan_text(browser)
        ticked_line = line_for_task(ticked, "Interviews")
        assert ticked_line is not None and "100%" in ticked_line.split()
        assert ticked != before

        browser.execute_script("EditorUndoManager.undo();")
        time.sleep(0.3)
        after_one_undo = get_plan_text(browser)
        after_line = line_for_task(after_one_undo, "Interviews")
        assert after_line is not None and "100%" not in after_line.split(), \
            "a single undo must fully reverse the tick's percent change"
        # Deliberately no second-undo check here: this fixture's browser
        # session (and EditorUndoManager's sessionStorage-backed history)
        # is shared across every test in this module, so a second undo
        # would legitimately pop into a *different, earlier* test's own
        # history rather than saying anything about this tick.


class TestZoomAndFit:
    def test_zoom_fit_frames_real_notes(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        browser.execute_script("whiteboardZoomReset(); whiteboardZoomOut(); whiteboardZoomOut();")
        time.sleep(0.3)
        zoomed_out_label = browser.find_element(By.ID, "whiteboardZoomLabel").text

        browser.execute_script("whiteboardZoomFit();")
        time.sleep(0.4)
        fit_label = browser.find_element(By.ID, "whiteboardZoomLabel").text

        # With real notes present, Fit must compute an actual bounding-box
        # zoom rather than the #845 empty-board 100%-reset placeholder.
        assert fit_label != "100%" or zoomed_out_label == "100%"
        assert fit_label != zoomed_out_label

    def test_below_40_percent_shows_title_only_card(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)
        note_full = get_note(browser, "Discovery")
        assert note_full["titleOnly"] is False

        browser.execute_script(
            "wbZoom = 0.3; wbApplyTransform(false); wbUpdateZoomLabel(); wbUpdateZoomButtons();"
        )
        time.sleep(0.2)
        note_small = get_note(browser, "Discovery")
        assert note_small["titleOnly"] is True, "below ~40% zoom a note must degrade to a title-only card"

        body_visible = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask === 'Discovery') {
                    const body = n.querySelector('.wb-note-body');
                    return body ? window.getComputedStyle(body).display !== 'none' : null;
                }
            }
            return null;
            """
        )
        assert body_visible is False


class TestReRenderPreservesViewport:
    def test_editing_plan_text_does_not_reset_pan_or_zoom(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        browser.execute_script("whiteboardZoomReset(); whiteboardZoomIn();")
        time.sleep(0.2)
        before = browser.execute_script(
            """
            const layer = document.querySelector('#whiteboardContainer .wb-layer');
            return layer.getAttribute('transform');
            """
        )

        # Tick a checkbox -- this rewrites plan text and runs the full
        # updateAllViews -> updateWhiteboardView -> wbRenderNotes cycle.
        browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Discovery') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                const target = rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Interviews');
                target.querySelector('.wb-note-checkbox').click();
            }
            """
        )
        time.sleep(0.6)

        after = browser.execute_script(
            """
            const layer = document.querySelector('#whiteboardContainer .wb-layer');
            return layer.getAttribute('transform');
            """
        )
        assert after == before, "re-rendering notes after a plan edit must not reset pan/zoom"


def bare_line_for(plan_text, task_name):
    """The single markdown line whose *entire* trimmed content is exactly
    `task_name` -- what wbAppendChildTask() writes for a promoted child
    (no duration/resources/comment tokens, just the indented name), unlike
    line_for_task() above which matches a name that's merely the first
    token on an otherwise-decorated line."""
    for line in plan_text.split("\n"):
        if line.strip() == task_name:
            return line
    return None


class TestPromoteToTask:
    """Issue #1020, part of #885: promoting a free-form note's own loose
    `comment` text into a real child task.

    Per #1015's already-landed free-form/checklist split, a free-form
    note's own task already exists in the outline -- there is no "create a
    task that didn't exist before" step. Promotion's entire job is turning
    the note's loose comment into one real child task
    (wbAppendChildTask(), whiteboard-structure.js), which is exactly what
    flips wbIsFreeformNote() to false and switches the note to checklist
    rendering on the very next render pass -- see
    wbPromoteFreeformNote()'s own doc comment in whiteboard-notes.js for
    the full reasoning. Exercised here by calling wbPromoteFreeformNote()
    directly (same pattern test_whiteboard_note_colour.py's
    TestNoteColourRename uses for kanbanBoard.renamePhase()) plus one test
    that drives the real `...` menu item end to end.
    """

    def test_promoting_creates_a_child_task_named_from_the_comment(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = get_note(browser, "Empty Phase")
        assert before is not None and "wb-note-freeform" in before["html"]

        promoted = browser.execute_script("return wbPromoteFreeformNote('Empty Phase');")
        assert promoted is True
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        plan_text = get_plan_text(browser)
        child_line = bare_line_for(plan_text, "Chase the vendor for a quote.")
        assert child_line is not None, "the comment text becomes a real outline line"

        parent_line = line_for_task(plan_text, "Empty Phase")
        parent_indent = len(parent_line) - len(parent_line.lstrip(" "))
        child_indent = len(child_line) - len(child_line.lstrip(" "))
        assert child_indent == parent_indent + 2, \
            "the promoted child is indented one outline level under its parent"

    def test_promoted_note_renders_as_checklist(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        browser.execute_script("wbPromoteFreeformNote('Empty Phase');")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        after = get_note(browser, "Empty Phase")
        assert after is not None
        assert "wb-note-freeform" not in after["html"], \
            "the note is no longer free-form once promotion gives it a child"
        assert "Chase the vendor for a quote." in after["html"], \
            "the new child renders as a checklist row, reusing #1015's existing rendering"

        footer_visible = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Empty Phase') continue;
                const footer = n.querySelector('.wb-note-footer');
                return getComputedStyle(footer).display !== 'none';
            }
            return null;
            """
        )
        assert footer_visible is True, "the progress footer appears once the note has a checklist"

    def test_promoting_a_blank_note_prompts_for_a_name(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = get_note(browser, "Loose Idea")
        assert before is not None and "wb-note-freeform" in before["html"]

        browser.execute_script("window.prompt = function() { return 'First step'; };")
        promoted = browser.execute_script("return wbPromoteFreeformNote('Loose Idea');")
        assert promoted is True
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        plan_text = get_plan_text(browser)
        assert bare_line_for(plan_text, "First step") is not None, \
            "the typed prompt answer becomes the new child task's name"

        after = get_note(browser, "Loose Idea")
        assert "wb-note-freeform" not in after["html"]

    def test_promoting_a_blank_note_cancelled_prompt_is_a_no_op(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = wait_for_stable_plan_text(browser)

        browser.execute_script("window.prompt = function() { return null; };")
        promoted = browser.execute_script("return wbPromoteFreeformNote('Loose Idea');")
        assert promoted is False, "a cancelled prompt must not create a garbage task"

        after = get_plan_text(browser)
        assert after == before, "a cancelled promotion writes nothing to the plan"

        still_freeform = get_note(browser, "Loose Idea")
        assert still_freeform is not None and "wb-note-freeform" in still_freeform["html"]

    def test_promoting_a_blank_note_blank_prompt_answer_is_a_no_op(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = wait_for_stable_plan_text(browser)

        browser.execute_script("window.prompt = function() { return '   '; };")
        promoted = browser.execute_script("return wbPromoteFreeformNote('Loose Idea');")
        assert promoted is False, "a whitespace-only prompt answer must not create a garbage task"

        after = get_plan_text(browser)
        assert after == before

    def test_promoting_a_checklist_note_is_a_no_op(self, browser, app_server):
        """Discovery already has children (issue #1015's checklist case) --
        promoting it makes no sense (there's no free-form comment to
        materialise) and must not touch the plan."""
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = wait_for_stable_plan_text(browser)
        promoted = browser.execute_script("return wbPromoteFreeformNote('Discovery');")
        assert promoted is False

        after = get_plan_text(browser)
        assert after == before

    def test_promotion_is_a_single_undo_step(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        # Same rationale as TestChecklistTicking.test_ticking_is_a_single_undo_step
        # above for checking one specific side effect rather than whole-plan-text
        # equality across the undo (status-bar.js's RAG front-matter sync can
        # land its own, separately-undoable write at any point).
        before = wait_for_stable_plan_text(browser)
        assert bare_line_for(before, "Chase the vendor for a quote.") is None

        browser.execute_script("wbPromoteFreeformNote('Empty Phase');")
        promoted_text = wait_for_stable_plan_text(browser)
        assert bare_line_for(promoted_text, "Chase the vendor for a quote.") is not None
        assert promoted_text != before

        browser.execute_script("EditorUndoManager.undo();")
        time.sleep(0.3)
        after_one_undo = get_plan_text(browser)
        assert bare_line_for(after_one_undo, "Chase the vendor for a quote.") is None, \
            "a single undo must fully reverse the promotion -- both the new child line and the commit"

    def test_menu_item_promotes_a_free_form_note_and_is_absent_for_a_checklist(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        # This is the only test in the module that drives a real Selenium
        # click rather than calling wbPromoteFreeformNote() via
        # execute_script -- a click requires its target to actually be
        # inside the viewport, on top of the floating "PLAN STRUCTURE"
        # panel rather than under it (see whiteboardZoomFit()'s own comment
        # on that panel covering part of the canvas). The saved viewport is
        # per-project and persists in localStorage across this module's
        # page reloads (see whiteboard.js's wbScheduleSaveViewport()), so a
        # pan/zoom left over from an earlier test in this file -- or an
        # earlier pytest run against the same browser profile -- can start
        # this test with a note positioned off-screen or behind that panel.
        # Frame to the actual notes rather than depend on execution order.
        browser.execute_script("whiteboardZoomFit();")
        time.sleep(0.3)

        def menu_btn_for(task_name):
            return browser.execute_script(
                """
                const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
                for (const n of notes) {
                    if (n.dataset.wbTask === arguments[0]) return n.querySelector('.wb-note-menu-btn');
                }
                return null;
                """,
                task_name,
            )

        def open_menu(task_name):
            btn = menu_btn_for(task_name)
            assert btn is not None, f"no note (or no menu button) found for {task_name}"
            btn.click()
            WebDriverWait(browser, 3).until(EC.presence_of_element_located((By.ID, "wbNoteMenu")))
            return browser.find_element(By.ID, "wbNoteMenu")

        menu = open_menu("Discovery")
        assert menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-promote") == [], \
            "a checklist note (already has children) must not offer 'Promote to task'"
        browser.execute_script("document.body.click();")
        time.sleep(0.2)

        open_menu("Empty Phase")
        promote_btn = WebDriverWait(browser, 3).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, "#wbNoteMenu .wb-note-menu-promote"))
        )
        assert promote_btn.text.strip() == "Promote to task"
        promote_btn.click()
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        plan_text = get_plan_text(browser)
        assert bare_line_for(plan_text, "Chase the vendor for a quote.") is not None, \
            "clicking the real menu item performs the promotion, not just wbPromoteFreeformNote() in isolation"

    def test_promoted_child_round_trips(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        browser.execute_script("wbPromoteFreeformNote('Empty Phase');")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        committed = get_plan_text(browser)

        # Reload the exact committed text as a fresh plan and confirm it
        # parses back identically -- the promoted child survives a full
        # parse/reload cycle like any other outline task.
        editor = browser.find_element(By.ID, "planEditor")
        browser.execute_script(
            "arguments[0].value = arguments[1];"
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
            editor,
            committed,
        )
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        reloaded = get_plan_text(browser)
        assert bare_line_for(reloaded, "Chase the vendor for a quote.") is not None

        note = get_note(browser, "Empty Phase")
        assert note is not None and "wb-note-freeform" not in note["html"]


class TestAddChecklistItem:
    """Issue #1104, part of epic #1090: "there should be an extra
    checkbox/task row ready for the user to add new rows (currently there
    isn't an easy way to add items to the checklist)."

    Before this issue the only ways to add a child task to an existing
    checklist note were: drag a noodle from another note onto it, edit the
    outline/markdown directly, or -- only for a still-freeform note with no
    children yet -- the "..." menu's "Promote to task" (issue #1020), whose
    own prompt() is a one-shot, not a repeatable row that stays on the
    note. This adds a genuinely always-present empty row (wbBuildAddChildRow()
    in whiteboard-notes.js) with a plain text input, committed with Enter
    via wbAddChecklistItem() -- which deliberately reuses the exact same
    wbAppendChildTask()/wbUniqueTaskName()/wbSanitiseChildTaskName()
    primitives "Promote to task" already uses, so a checklist item added
    this way is subject to the same summary/parent rules, is a single undo
    step, and round-trips through markdown identically -- see
    wbAddChecklistItem()'s own doc comment.
    """

    def test_add_row_present_on_checklist_notes_absent_on_freeform_notes(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        # Discovery and Build both already have children (checklist notes).
        assert add_row_input_for(browser, "Discovery") is not None, \
            "a checklist note always offers an empty 'Add task...' row"
        assert add_row_input_for(browser, "Build") is not None

        # Empty Phase and Loose Idea have zero children -- still free-form
        # (issue #1015) -- so no add-row yet; "Promote to task" (or typing a
        # comment) is still how those gain their first child.
        assert add_row_input_for(browser, "Empty Phase") is None, \
            "a free-form note has no checklist to add to yet"
        assert add_row_input_for(browser, "Loose Idea") is None

        placeholder = add_row_input_for(browser, "Discovery").get_attribute("placeholder")
        assert placeholder == "Add task…"

    def test_typing_and_pressing_enter_adds_a_child_and_resets_the_row(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomFit();")
        time.sleep(0.3)

        before = wait_for_stable_plan_text(browser)
        assert bare_line_for(before, "Draft brief") is None

        add_input = add_row_input_for(browser, "Discovery")
        assert add_input is not None
        add_input.click()
        add_input.send_keys("Draft brief")
        add_input.send_keys(Keys.ENTER)

        after = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        assert after != before

        child_line = bare_line_for(after, "Draft brief")
        assert child_line is not None, "the typed text becomes a real outline line"

        parent_line = line_for_task(after, "Discovery")
        parent_indent = len(parent_line) - len(parent_line.lstrip(" "))
        child_indent = len(child_line) - len(child_line.lstrip(" "))
        assert child_indent == parent_indent + 2, \
            "the new child is indented one outline level under Discovery, same as its existing children"

        note = get_note(browser, "Discovery")
        assert "Draft brief" in note["html"], "the new child renders as an ordinary checklist row"

        # The row commits, then the whole body re-renders (wbUpdateNoteNode())
        # -- the old input node is gone, so this checks a *fresh* add-row
        # input exists, empty, ready for the next item (wbFocusAddRowWhenReady()).
        fresh_input = add_row_input_for(browser, "Discovery")
        assert fresh_input is not None
        assert fresh_input.get_attribute("value") == "", \
            "the add-row resets to empty so the next task can be typed straight away"

        focused = browser.execute_script(
            "return document.activeElement && document.activeElement.classList.contains('wb-note-add-input');"
        )
        assert focused is True, "the fresh add-row is refocused so adding several tasks is one continuous gesture"

    def test_blank_input_on_enter_is_a_no_op(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = wait_for_stable_plan_text(browser)

        add_input = add_row_input_for(browser, "Discovery")
        add_input.click()
        add_input.send_keys(Keys.ENTER)
        time.sleep(0.3)

        after = get_plan_text(browser)
        assert after == before, "pressing Enter on an empty add-row must not write anything to the plan"

    def test_whitespace_only_input_on_enter_is_a_no_op(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = wait_for_stable_plan_text(browser)

        add_input = add_row_input_for(browser, "Discovery")
        add_input.click()
        add_input.send_keys("   ")
        add_input.send_keys(Keys.ENTER)
        time.sleep(0.3)

        after = get_plan_text(browser)
        assert after == before

    def test_add_is_a_single_undo_step(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        # Same rationale as TestChecklistTicking.test_ticking_is_a_single_undo_step
        # and TestPromoteToTask.test_promotion_is_a_single_undo_step above:
        # check one specific side effect rather than whole-plan-text equality
        # across the undo (status-bar.js's RAG front-matter sync can land its
        # own, separately-undoable write at any point).
        before = wait_for_stable_plan_text(browser)
        assert bare_line_for(before, "Sign off scope") is None

        browser.execute_script("wbAddChecklistItem('Discovery', 'Sign off scope');")
        added_text = wait_for_stable_plan_text(browser)
        assert bare_line_for(added_text, "Sign off scope") is not None
        assert added_text != before

        browser.execute_script("EditorUndoManager.undo();")
        time.sleep(0.3)
        after_one_undo = get_plan_text(browser)
        assert bare_line_for(after_one_undo, "Sign off scope") is None, \
            "a single undo must fully reverse adding the checklist item"

    def test_added_child_is_a_normal_task_tickable_like_any_other(self, browser, app_server):
        """The new child is subject to the same summary/parent rules as any
        other task -- nothing about how it was created marks it specially:
        it can be ticked complete through the exact same checkbox/commit
        path as an existing checklist row (TestChecklistTicking above)."""
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        browser.execute_script("wbAddChecklistItem('Discovery', 'Sign off scope');")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        clicked = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Discovery') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                const target = rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Sign off scope');
                if (!target) return false;
                target.querySelector('.wb-note-checkbox').click();
                return true;
            }
            return false;
            """
        )
        assert clicked is True
        time.sleep(0.5)

        after = get_plan_text(browser)
        after_line = line_for_task(after, "Sign off scope")
        assert after_line is not None and "100%" in after_line.split(), after

    def test_added_child_round_trips_through_markdown(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        browser.execute_script("wbAddChecklistItem('Discovery', 'Sign off scope');")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        committed = get_plan_text(browser)
        assert bare_line_for(committed, "Sign off scope") is not None

        # Reload the exact committed text as a fresh plan and confirm it
        # parses back identically -- same round-trip check as
        # TestPromoteToTask.test_promoted_child_round_trips.
        editor = browser.find_element(By.ID, "planEditor")
        browser.execute_script(
            "arguments[0].value = arguments[1];"
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
            editor,
            committed,
        )
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        reloaded = get_plan_text(browser)
        assert bare_line_for(reloaded, "Sign off scope") is not None

        note = get_note(browser, "Discovery")
        assert note is not None and "Sign off scope" in note["html"]

    def test_helper_gives_a_freeform_note_its_first_child_and_the_note_gains_an_add_row(self, browser, app_server):
        """wbAddChecklistItem() is not gated on the note already being a
        checklist -- calling it on a still-freeform note (issue #1015) adds
        its very first child, which is exactly what flips wbIsFreeformNote()
        to false, same as "Promote to task". The note's own add-row then
        appears automatically on the very next render, with no separate
        "convert to checklist" action -- matching wbBuildAddChildRow()'s own
        doc comment."""
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = get_note(browser, "Empty Phase")
        assert before is not None and "wb-note-freeform" in before["html"]
        assert add_row_input_for(browser, "Empty Phase") is None

        added = browser.execute_script("return wbAddChecklistItem('Empty Phase', 'Kickoff call');")
        assert added is True
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        after = get_note(browser, "Empty Phase")
        assert after is not None and "wb-note-freeform" not in after["html"]
        assert add_row_input_for(browser, "Empty Phase") is not None, \
            "the note gains its own add-row the moment it has a real child"

    def test_unknown_task_is_a_no_op(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before = wait_for_stable_plan_text(browser)
        added = browser.execute_script("return wbAddChecklistItem('Does Not Exist', 'New idea');")
        assert added is False

        after = get_plan_text(browser)
        assert after == before
