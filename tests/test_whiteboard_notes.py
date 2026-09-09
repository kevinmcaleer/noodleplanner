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
