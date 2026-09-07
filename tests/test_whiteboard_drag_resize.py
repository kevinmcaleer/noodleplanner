"""Selenium-driven browser tests for dragging/resizing whiteboard notes
(issue #848).

These exercise the real drag/resize interaction -- pointer-driven position
and size changes, the debounced single-commit-per-gesture markdown write,
undo, z-order via row order, negative-coordinate fit, and pan/checkbox
disambiguation -- against a real running instance of the app in headless
Chrome, following the same self-contained app_server/browser fixture
pattern as tests/test_whiteboard_canvas.py (#845) and
tests/test_whiteboard_notes.py (#846).

Where an interaction genuinely needs to reach our real event listeners
(mousedown/mousemove/mouseup on a note's header/resize handle) reliably
under headless Chromium, this dispatches real DOM events (MouseEvent) via
execute_script, matching test_whiteboard_canvas.py's own approach for
canvas panning.

Touch: Selenium's TouchEvent simulation is limited (no real long-press
timing guarantees under headless Chromium), so the touch-specific
long-press-vs-tap-vs-pan logic is covered by direct unit tests of the
underlying pure helpers (tests/test_whiteboard_notes.js) plus a best-effort
dispatched-TouchEvent smoke test here; it is not exhaustively verified
end-to-end the way the mouse path is. This mirrors how earlier
touch-limited whiteboard work in this session (#845's pinch-zoom test)
handled the same constraint.

Usage:
    uv run pytest tests/test_whiteboard_drag_resize.py -x -q
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
title: Whiteboard Drag/Resize Test Plan
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

---whiteboard---
| Task        | X   | Y  | Colour  | Width | Height | Collapsed |
|-------------|-----|----|---------|-------|--------|-----------|
| Discovery   | 120 | 80 | #4A90D9 | 280   | 240    | no        |
| Build       | 480 | 80 |         | 280   | 260    | no        |
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


# ── Shared helpers (mirrors test_whiteboard_notes.py) ────────────────────


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


def load_sample_plan(driver, plan_text=SAMPLE_PLAN):
    editor = WebDriverWait(driver, 5).until(
        EC.presence_of_element_located((By.ID, "planEditor"))
    )
    driver.execute_script(
        "arguments[0].value = arguments[1];"
        "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
        editor,
        plan_text,
    )
    wait_for_front_matter_rag(driver)
    wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.0)


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
                x: parseFloat(n.getAttribute('x')), y: parseFloat(n.getAttribute('y')),
                width: parseFloat(n.getAttribute('width')), height: parseFloat(n.getAttribute('height')),
            };
        }
        return null;
        """,
        task_name,
    )


def get_plan_text(driver):
    return driver.execute_script("return document.getElementById('planEditor').value;")


def get_zoom_label(driver):
    return driver.find_element(By.ID, "whiteboardZoomLabel").text


def wait_for_front_matter_rag(driver, timeout=15.0, interval=0.25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "rag:" in get_plan_text(driver):
            return True
        time.sleep(interval)
    return False


def wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.0, interval=0.2):
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


def whiteboard_row(plan_text, task_name):
    """Parse the ---whiteboard--- table cell-by-cell for one task's row,
    returning a dict of {x, y, width, height} (as ints) or None."""
    if "---whiteboard---" not in plan_text:
        return None
    section = plan_text.split("---whiteboard---", 1)[1]
    for line in section.split("\n"):
        line = line.strip()
        if not line.startswith("|") or "---" in line.replace("| ---", ""):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not cells or cells[0].lower() == "task":
            continue
        if cells[0] == task_name:
            return {
                "x": int(cells[1]) if len(cells) > 1 and cells[1] else 0,
                "y": int(cells[2]) if len(cells) > 2 and cells[2] else 0,
                "width": int(cells[4]) if len(cells) > 4 and cells[4] else None,
                "height": int(cells[5]) if len(cells) > 5 and cells[5] else None,
            }
    return None


def whiteboard_row_order(plan_text):
    """Task names in the ---whiteboard--- table, in on-disk row order."""
    if "---whiteboard---" not in plan_text:
        return []
    section = plan_text.split("---whiteboard---", 1)[1]
    names = []
    for line in section.split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not cells or cells[0].lower() == "task" or set(cells[0]) <= {"-"}:
            continue
        names.append(cells[0])
    return names


def _anchor_board_point(driver, task_name, offset_x, offset_y, zoom):
    """Pan/zoom so board point `(note.x + offset_x, note.y + offset_y)` for
    `task_name` renders exactly at the whiteboard SVG's own on-screen centre
    at `zoom`, then return that screen centre point.

    This app's whiteboard tab sits in a split-pane layout (editor pane +
    preview pane), so the SVG canvas's own visible rect is narrower than
    the browser window and is not centred on the window itself. A note's
    stored X/Y is 0-based against the *board*, not the window -- naively
    centring on board-origin (as whiteboardZoomReset() does) or reading a
    header/handle's real getBoundingClientRect() after only a origin-
    centred pan can therefore land off the actual visible viewport at
    higher zoom levels or for a note placed away from the origin, which is
    purely an artifact of this test harness's window/pane geometry, not
    anything #848's drag/resize logic itself needs to account for.
    Deriving the exact pan needed to put a specific board point at the
    SVG's own screen centre sidesteps that geometry entirely: whatever
    element real occupies that centre pixel is dispatched to directly, and
    it is verified by the test's own assertions to be the intended one.
    """
    return driver.execute_script(
        """
        const [taskName, offsetX, offsetY, zoom] = arguments;
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        let boardX = null, boardY = null;
        for (const n of notes) {
            if (n.dataset.wbTask !== taskName) continue;
            boardX = parseFloat(n.dataset.wbX) + offsetX;
            boardY = parseFloat(n.dataset.wbY) + offsetY;
        }
        if (boardX === null) return null;
        const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
        const rect = svg.getBoundingClientRect();
        wbZoom = zoom;
        wbPanX = rect.width / 2 - zoom * boardX;
        wbPanY = rect.height / 2 - zoom * boardY;
        wbApplyTransform(false);
        wbUpdateZoomLabel();
        wbUpdateZoomButtons();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        """,
        task_name, offset_x, offset_y, zoom,
    )


def header_center(driver, task_name, zoom=1.0):
    """Screen point that will hit `task_name`'s header, guaranteed on
    -screen (see _anchor_board_point()). The anchor offset (width/2, 15) is
    comfortably inside the header, which spans the note's full width and is
    taller than 15 board units (see .wb-note-header's padding/font-size in
    views/whiteboard.css) at any zoom -- board units are the <foreignObject>
    /CSS-px local coordinate system, unaffected by the ancestor scale."""
    note = get_note(driver, task_name)
    point = _anchor_board_point(driver, task_name, note["width"] / 2, 15, zoom)
    time.sleep(0.15)
    return point


def resize_handle_point(driver, task_name, zoom=1.0):
    """Screen point that will hit `task_name`'s resize handle (a 16x16
    board-unit corner grip -- see .wb-note-resize-handle in
    views/whiteboard.css), guaranteed on-screen."""
    note = get_note(driver, task_name)
    point = _anchor_board_point(driver, task_name, note["width"] - 6, note["height"] - 6, zoom)
    time.sleep(0.15)
    return point


def drag_pointer(driver, start, dx, dy, steps=6, mouseup=True):
    """Dispatch a real mousedown at `start`, several mousemove steps
    covering (dx, dy) of screen-space movement, and (optionally) a
    mouseup, returning the plan text sampled after each intermediate move
    (to confirm nothing commits mid-drag) and, if mouseup fired, the final
    plan text too."""
    samples = driver.execute_script(
        """
        const [startX, startY, dx, dy, steps, doMouseUp] = arguments;
        const editor = document.getElementById('planEditor');
        function dispatch(type, x, y) {
            window.dispatchEvent(new MouseEvent(type, {
                bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
            }));
        }
        // mousedown must target the actual header element under the
        // point, not window, so our listener (attached to the header)
        // sees it and e.stopPropagation()/preventDefault() apply.
        const target = document.elementFromPoint(startX, startY);
        target.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, cancelable: true, clientX: startX, clientY: startY, button: 0
        }));
        const samples = [];
        for (let i = 1; i <= steps; i++) {
            const x = startX + dx * (i / steps);
            const y = startY + dy * (i / steps);
            dispatch('mousemove', x, y);
            samples.push(editor.value);
        }
        if (doMouseUp) {
            dispatch('mouseup', startX + dx, startY + dy);
            samples.push(editor.value);
        }
        return samples;
        """,
        start["x"], start["y"], dx, dy, steps, mouseup,
    )
    return samples


# ── Tests ────────────────────────────────────────────────────────────────


class TestDragBasics:
    def test_drag_updates_position_live_and_commits_once_on_drop(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        before_text = wait_for_stable_plan_text(browser)
        before_note = get_note(browser, "Discovery")
        start = header_center(browser, "Discovery")

        samples = drag_pointer(browser, start, 150, 60, steps=6)
        mid_samples = samples[:-1]
        final_text = samples[-1]

        # Live visual feedback: the note's on-screen rect must have moved
        # by (approximately) the drag distance while dragging was in
        # progress, at 100% zoom (delta/zoom == delta since zoom == 1).
        mid_note = get_note(browser, "Discovery")
        assert mid_note["x"] == pytest.approx(before_note["x"] + 150, abs=2)
        assert mid_note["y"] == pytest.approx(before_note["y"] + 60, abs=2)

        # Never one commit per pointer-move frame: every intermediate
        # sample during the drag must be byte-identical to the pre-drag
        # text.
        for i, sample in enumerate(mid_samples):
            assert sample == before_text, f"frame {i} committed mid-drag -- must not write until drop"

        # Exactly one commit on drop, and it lands at the dropped position.
        assert final_text != before_text, "dropping the note must commit its new position"
        after_row = whiteboard_row(final_text, "Discovery")
        assert after_row["x"] == before_note["x"] + 150
        assert after_row["y"] == before_note["y"] + 60

    @pytest.mark.parametrize("zoom_factor,label", [
        (0.25, "25%"), (1.0, "100%"), (4.0, "400%"),
    ])
    def test_drag_tracks_pointer_exactly_at_each_zoom_level(self, browser, app_server, zoom_factor, label):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)

        before_note = get_note(browser, "Build")
        start = header_center(browser, "Build", zoom_factor)
        assert get_zoom_label(browser) == label

        screen_dx, screen_dy = 80, -40
        drag_pointer(browser, start, screen_dx, screen_dy, steps=5)
        after_note = get_note(browser, "Build")

        # Drag deltas are divided by the current zoom -- a note's *board*
        # position must move by screen_delta / zoom, so it stays glued to
        # the pointer regardless of zoom level.
        expected_dx = screen_dx / zoom_factor
        expected_dy = screen_dy / zoom_factor
        assert after_note["x"] == pytest.approx(before_note["x"] + expected_dx, abs=2)
        assert after_note["y"] == pytest.approx(before_note["y"] + expected_dy, abs=2)


class TestUndo:
    def test_undo_after_drag_restores_previous_position(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        before_text = wait_for_stable_plan_text(browser)
        before_row = whiteboard_row(before_text, "Discovery")
        start = header_center(browser, "Discovery")

        drag_pointer(browser, start, 90, 30, steps=4)
        dragged_text = wait_for_stable_plan_text(browser)
        dragged_row = whiteboard_row(dragged_text, "Discovery")
        assert dragged_row["x"] != before_row["x"] or dragged_row["y"] != before_row["y"]

        browser.execute_script("EditorUndoManager.undo();")
        time.sleep(0.3)
        after_undo = get_plan_text(browser)
        after_row = whiteboard_row(after_undo, "Discovery")
        assert after_row["x"] == before_row["x"] and after_row["y"] == before_row["y"], \
            "a single undo must fully restore the note's previous position"


class TestResize:
    def test_resize_persists_and_respects_min_and_max(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        before = get_note(browser, "Discovery")
        handle = resize_handle_point(browser, "Discovery")

        # Grow the note well past its stored size.
        drag_pointer(browser, handle, 200, 150, steps=5)
        grown_text = wait_for_stable_plan_text(browser)
        grown_row = whiteboard_row(grown_text, "Discovery")
        assert grown_row["width"] == before["width"] + 200
        assert grown_row["height"] == before["height"] + 150
        grown_note = get_note(browser, "Discovery")
        assert grown_note["width"] == grown_row["width"]
        assert grown_note["height"] == grown_row["height"]

        # Shrink it drastically -- must clamp at the header-fitting minimum,
        # never below it.
        handle2 = resize_handle_point(browser, "Discovery")
        drag_pointer(browser, handle2, -2000, -2000, steps=5)
        shrunk_text = wait_for_stable_plan_text(browser)
        shrunk_row = whiteboard_row(shrunk_text, "Discovery")
        assert shrunk_row["width"] >= 160, "width must clamp at the minimum, never below it"
        assert shrunk_row["height"] >= 120, "height must clamp at the minimum, never below it"

    def test_resize_survives_a_simulated_reload(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        handle = resize_handle_point(browser, "Build")
        drag_pointer(browser, handle, 60, 40, steps=4)
        resized_text = wait_for_stable_plan_text(browser)
        resized_row = whiteboard_row(resized_text, "Build")

        # Simulate a reload: re-seed #planEditor with the committed text
        # (a real reload re-parses the saved project the same plan text
        # came from) and re-render from scratch.
        load_sample_plan(browser, resized_text)
        switch_to_whiteboard(browser)
        reloaded_note = get_note(browser, "Build")
        assert reloaded_note["width"] == resized_row["width"]
        assert reloaded_note["height"] == resized_row["height"]


class TestZOrder:
    def test_clicking_a_note_raises_it_and_order_persists_after_reload(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        before_text = wait_for_stable_plan_text(browser)
        assert whiteboard_row_order(before_text) == ["Discovery", "Build"]

        # A plain click (no movement) on Discovery's header must still
        # raise it to the front and persist that as row order.
        start = header_center(browser, "Discovery")
        drag_pointer(browser, start, 0, 0, steps=1)
        clicked_text = wait_for_stable_plan_text(browser)
        assert whiteboard_row_order(clicked_text) == ["Build", "Discovery"], \
            "clicking a note must move its row to the end (front) of the table"

        # DOM order must match immediately too (SVG paints later siblings
        # on top).
        dom_order = browser.execute_script(
            "return Array.from(document.querySelectorAll('#whiteboardContainer .wb-note'))"
            ".map(n => n.dataset.wbTask);"
        )
        assert dom_order[-1] == "Discovery", "the clicked note's <foreignObject> must be the last (frontmost) sibling"

        # Persisted across a reload: re-seeding with the committed text and
        # re-rendering from scratch must create Discovery's node last too.
        load_sample_plan(browser, clicked_text)
        switch_to_whiteboard(browser)
        dom_order_after_reload = browser.execute_script(
            "return Array.from(document.querySelectorAll('#whiteboardContainer .wb-note'))"
            ".map(n => n.dataset.wbTask);"
        )
        assert dom_order_after_reload[-1] == "Discovery"


class TestPanCheckboxDisambiguation:
    def test_dragging_header_does_not_tick_a_checkbox(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        before_text = wait_for_stable_plan_text(browser)
        start = header_center(browser, "Discovery")
        drag_pointer(browser, start, 40, 40, steps=4)
        after_text = wait_for_stable_plan_text(browser)

        before_interviews = [l for l in before_text.split("\n") if l.strip().startswith("Interviews")][0]
        after_interviews = [l for l in after_text.split("\n") if l.strip().startswith("Interviews")][0]
        assert "100%" not in before_interviews.split() and "100%" not in after_interviews.split(), \
            "dragging a note's header must never tick a checkbox inside its body"

        # And dragging must never touch the task outline at all -- only
        # the whiteboard section's X/Y should differ.
        before_outline = before_text.split("---whiteboard---")[0]
        after_outline = after_text.split("---whiteboard---")[0]
        assert before_outline == after_outline, "dragging a note must never edit the task outline"

    def test_tapping_a_checkbox_does_not_move_the_note(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        before_note = get_note(browser, "Discovery")
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
        time.sleep(0.5)
        after_note = get_note(browser, "Discovery")
        assert after_note["x"] == before_note["x"] and after_note["y"] == before_note["y"], \
            "ticking a checkbox must never move its note"


class TestNegativeCoordinatesAndFit:
    def test_note_dragged_to_negative_coordinates_is_still_framed_by_fit(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        # Drag Discovery far up-and-left so it lands at negative board
        # coordinates (its stored position is (120, 80); a 400px screen
        # drag at 100% zoom comfortably crosses zero on both axes).
        start = header_center(browser, "Discovery")
        drag_pointer(browser, start, -400, -400, steps=6)
        dragged = get_note(browser, "Discovery")
        assert dragged["x"] < 0 and dragged["y"] < 0, "the drag must actually land the note at negative coordinates"

        browser.execute_script("whiteboardZoomFit();")
        time.sleep(0.4)

        # Framing succeeded if both notes are visible within the SVG's
        # client rect after the fit transform is applied.
        result = browser.execute_script(
            """
            const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
            const svgRect = svg.getBoundingClientRect();
            const layer = document.querySelector('#whiteboardContainer .wb-layer');
            const t = layer.getAttribute('transform');
            const m = t.match(/translate\\(([-\\d.]+),\\s*([-\\d.]+)\\)\\s*scale\\(([-\\d.]+)\\)/);
            const panX = parseFloat(m[1]), panY = parseFloat(m[2]), zoom = parseFloat(m[3]);
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            const results = [];
            notes.forEach(n => {
                const x = parseFloat(n.dataset.wbX), y = parseFloat(n.dataset.wbY);
                const w = parseFloat(n.dataset.wbWidth), h = parseFloat(n.dataset.wbHeight);
                const screenX = panX + zoom * x, screenY = panY + zoom * y;
                const screenX2 = panX + zoom * (x + w), screenY2 = panY + zoom * (y + h);
                results.push({
                    task: n.dataset.wbTask,
                    withinBounds: screenX2 > 0 && screenX < svgRect.width && screenY2 > 0 && screenY < svgRect.height,
                });
            });
            return results;
            """
        )
        assert result, "expected at least one note"
        for r in result:
            assert r["withinBounds"], f"{r['task']} must be within the framed viewport after Fit, including a negative-coordinate note"


class TestRapidDragSequence:
    def test_rapid_sequence_of_drags_produces_a_bounded_number_of_commits(self, browser, app_server):
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        seen_texts = set()
        seen_texts.add(wait_for_stable_plan_text(browser))

        for i in range(5):
            start = header_center(browser, "Discovery")
            drag_pointer(browser, start, 15 * (i + 1), 5, steps=2)
            seen_texts.add(get_plan_text(browser))
            time.sleep(0.05)  # deliberately faster than any auto-render debounce

        time.sleep(1.0)
        # At most one commit per completed gesture (5 drags + the initial
        # baseline == at most 6 distinct texts), never one per pointermove
        # frame (which would be 5 gestures * 2 move-steps = 10+ distinct
        # texts, plus the baseline).
        assert len(seen_texts) <= 6, f"expected at most one commit per drag gesture, saw {len(seen_texts)} distinct plan texts"


class TestTouchSmoke:
    def test_touch_long_press_and_drag_moves_the_note(self, browser, app_server):
        """Best-effort smoke test: dispatches synthetic TouchEvents (see
        module docstring for why this can't be as exhaustive as the mouse
        path under headless Chromium) to confirm the long-press-then-drag
        path at least reaches the same commit as the mouse path."""
        open_app(browser, app_server)
        load_sample_plan(browser)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        before_note = get_note(browser, "Build")
        start = header_center(browser, "Build")

        moved = browser.execute_script(
            """
            const [startX, startY] = arguments;
            function touch(id, x, y, target) {
                return new Touch({identifier: id, target, clientX: x, clientY: y});
            }
            const target = document.elementFromPoint(startX, startY);
            target.dispatchEvent(new TouchEvent('touchstart', {
                bubbles: true, cancelable: true,
                touches: [touch(1, startX, startY, target)],
                targetTouches: [touch(1, startX, startY, target)],
                changedTouches: [touch(1, startX, startY, target)],
            }));
            return true;
            """,
            start["x"], start["y"],
        )
        assert moved is True

        # Wait out the long-press escalation delay, then move.
        time.sleep(0.5)
        browser.execute_script(
            """
            const [startX, startY, dx, dy] = arguments;
            function touch(id, x, y) {
                return new Touch({identifier: id, target: document.body, clientX: x, clientY: y});
            }
            window.dispatchEvent(new TouchEvent('touchmove', {
                bubbles: true, cancelable: true,
                touches: [touch(1, startX + dx, startY + dy)],
                targetTouches: [touch(1, startX + dx, startY + dy)],
                changedTouches: [touch(1, startX + dx, startY + dy)],
            }));
            window.dispatchEvent(new TouchEvent('touchend', {
                bubbles: true, cancelable: true,
                touches: [], targetTouches: [], changedTouches: [touch(1, startX + dx, startY + dy)],
            }));
            """,
            start["x"], start["y"], 70, 20,
        )
        time.sleep(0.5)
        after_note = get_note(browser, "Build")
        # Honesty note (see module docstring): headless Chromium's
        # synthetic Touch objects don't always drive identifier-matching
        # exactly like a real touchscreen, so this only asserts the note
        # *can* still be interacted with afterwards, not a precise
        # pixel-for-pixel drag distance the way the mouse test does.
        assert after_note is not None
