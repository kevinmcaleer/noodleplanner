"""Selenium-driven browser tests for free-floating whiteboard text objects
(issue #1018, part of #885).

These exercise the real rendered text-object DOM (a
<foreignObject class="wb-text-object"> per row, no card/border/background --
see views/whiteboard.css) against a real running instance of the app in
headless Chrome, following the same self-contained app_server/browser
fixture pattern as tests/test_whiteboard_notes.py (#846) and
tests/test_whiteboard_drag_resize.py (#848).

Covers what tests/test_whiteboard_backmatter.mjs (the pure Kind/Id/Text
row-shape parsing) can't: real DOM structure with no post-it chrome,
creation via the toolbar button and the `t` key, click-to-edit vs.
click-and-drag disambiguation, drag-to-reposition committing exactly once,
delete, round-trip persistence across a reload, and -- the storage design's
own key risk (see script.js's "Whiteboard back matter" header comment) --
that a completely unrelated post-it edit on a *mixed* board never clobbers
a text object's row, or vice versa, since both share one table rewritten
from `items` on every commit.

Usage:
    uv run pytest tests/test_whiteboard_text_objects.py -x -q
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
    pytest.mark.usability,
    pytest.mark.skipif(not HAS_SELENIUM, reason="selenium not installed"),
    pytest.mark.skipif(not HAS_APP, reason="noodle_web not importable"),
]

SAMPLE_PLAN = """---
title: Whiteboard Text Object Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 100%
    Interviews @sam 2d
  Build
    Ship Widget $Widget @sam 3d 100%

---whiteboard---
| Task      | X   | Y  | Colour  | Width | Height | Collapsed | Kind | Id  | Text          |
|-----------|-----|----|---------|-------|--------|-----------|------|-----|---------------|
| Discovery | 120 | 80 | #4A90D9 | 280   | 240    | no        |      |     |               |
|           | 480 | 80 |         |       |        |           | text | tx1 | Section label |
"""

EMPTY_BOARD_PLAN = """---
title: Whiteboard Text Object Empty Board Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 100%
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


# ── Shared helpers (mirrors test_whiteboard_notes.py / _drag_resize.py) ──


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


def load_plan(driver, plan_text):
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


def get_plan_text(driver):
    return driver.execute_script("return document.getElementById('planEditor').value;")


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


def get_text_objects(driver):
    """Every rendered `.wb-text-object`, keyed by its own generated id."""
    return driver.execute_script(
        """
        const out = {};
        document.querySelectorAll('#whiteboardContainer .wb-text-object').forEach((fo) => {
            const content = fo.querySelector('.wb-text-object-content');
            out[fo.dataset.wbTextId] = {
                x: parseFloat(fo.getAttribute('x')),
                y: parseFloat(fo.getAttribute('y')),
                text: content ? content.textContent : null,
                editing: content ? content.isContentEditable : null,
                outerHTML: fo.outerHTML,
            };
        });
        return out;
        """
    )


def whiteboard_text_rows(plan_text):
    """Parse the ---whiteboard--- table for Kind=text rows: list of
    {id, text, x, y} dicts, matching the app's own column-by-name rule."""
    if "---whiteboard---" not in plan_text:
        return []
    section = plan_text.split("---whiteboard---", 1)[1]
    lines = [l.strip() for l in section.split("\n") if l.strip()]
    header_idx = None
    headers = []
    for i, line in enumerate(lines):
        if "|" not in line:
            continue
        cells = [c.strip().lower() for c in line.strip("|").split("|")]
        if "task" in cells:
            header_idx = i
            headers = cells
            break
    if header_idx is None:
        return []

    rows = []
    for line in lines[header_idx + 1:]:
        if "|" not in line:
            continue
        if line.replace("|", "").replace("-", "").strip() == "":
            continue  # separator row
        cells = [c.strip() for c in line.strip("|").split("|")]
        row = dict(zip(headers, cells))
        if row.get("kind", "").lower() == "text":
            rows.append({
                "id": row.get("id", ""),
                "text": row.get("text", ""),
                "x": int(row["x"]) if row.get("x") else 0,
                "y": int(row["y"]) if row.get("y") else 0,
            })
    return rows


def whiteboard_note_row_exists(plan_text, task_name):
    if "---whiteboard---" not in plan_text:
        return False
    section = plan_text.split("---whiteboard---", 1)[1]
    for line in section.split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and cells[0] == task_name:
            return True
    return False


def click_new_text_button(driver):
    btn = WebDriverWait(driver, 5).until(
        EC.element_to_be_clickable((By.ID, "whiteboardNewTextBtn"))
    )
    btn.click()
    time.sleep(0.5)


def set_editing_text_and_blur(driver, text):
    """Find the currently-editing text object, set its content, and blur
    it -- the same commit path a real user leaving the field triggers."""
    driver.execute_script(
        """
        const [text] = arguments;
        const content = document.querySelector(
            '#whiteboardContainer .wb-text-object-content[contenteditable="true"]'
        );
        if (!content) return false;
        content.textContent = text;
        content.blur();
        return true;
        """,
        text,
    )
    time.sleep(0.3)


def drag_pointer(driver, start, dx, dy, steps=6, mouseup=True):
    """Dispatch a real mousedown/mousemove(s)/mouseup sequence, mirroring
    test_whiteboard_drag_resize.py's own helper of the same name."""
    samples = driver.execute_script(
        """
        const [startX, startY, dx, dy, steps, doMouseUp] = arguments;
        const editor = document.getElementById('planEditor');
        function dispatch(type, x, y) {
            window.dispatchEvent(new MouseEvent(type, {
                bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
            }));
        }
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


def anchor_text_object_point(driver, text_id, offset_x, offset_y, zoom=1.0):
    """Pan/zoom so board point `(object.x + offset_x, object.y + offset_y)`
    renders at the whiteboard SVG's own on-screen centre, then return that
    screen point -- same rationale as _drag_resize.py's _anchor_board_point()."""
    point = driver.execute_script(
        """
        const [textId, offsetX, offsetY, zoom] = arguments;
        const fo = document.querySelector(
            '#whiteboardContainer .wb-text-object[data-wb-text-id="' + textId + '"]'
        );
        if (!fo) return null;
        const boardX = parseFloat(fo.dataset.wbX) + offsetX;
        const boardY = parseFloat(fo.dataset.wbY) + offsetY;
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
        text_id, offset_x, offset_y, zoom,
    )
    time.sleep(0.15)
    return point


def content_point(driver, text_id, zoom=1.0):
    """Screen point guaranteed to land on `text_id`'s own rendered content
    (a small offset from its origin, comfortably inside the default box)."""
    return anchor_text_object_point(driver, text_id, 20, 15, zoom)


# ── Tests ────────────────────────────────────────────────────────────────


class TestTextObjectCreation:
    def test_new_text_button_creates_a_bare_text_object_in_edit_mode(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, EMPTY_BOARD_PLAN)
        switch_to_whiteboard(browser)

        click_new_text_button(browser)
        objs = get_text_objects(browser)
        assert len(objs) == 1, "New text creates exactly one text object"
        obj = next(iter(objs.values()))
        assert obj["editing"] is True, "a freshly created text object goes straight into edit mode"

    def test_t_key_creates_a_text_object(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, EMPTY_BOARD_PLAN)
        switch_to_whiteboard(browser)

        container = browser.find_element(By.ID, "whiteboardContainer")
        browser.execute_script(
            "arguments[0].dispatchEvent(new KeyboardEvent('keydown', "
            "{key: 't', bubbles: true, cancelable: true}));",
            container,
        )
        time.sleep(0.5)
        objs = get_text_objects(browser)
        assert len(objs) == 1, "the `t` key creates exactly one text object"

    def test_typed_text_persists_to_the_whiteboard_section(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, EMPTY_BOARD_PLAN)
        switch_to_whiteboard(browser)

        click_new_text_button(browser)
        set_editing_text_and_blur(browser, "A margin question?")

        plan_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        rows = whiteboard_text_rows(plan_text)
        assert len(rows) == 1
        assert rows[0]["text"] == "A margin question?"

        objs = get_text_objects(browser)
        obj = next(iter(objs.values()))
        assert obj["text"] == "A margin question?"
        assert obj["editing"] is False, "committing (blur) leaves edit mode"


class TestTextObjectNoCardChrome:
    def test_renders_with_no_card_no_border_no_background(self, browser, app_server):
        """Acceptance: visually and structurally distinct from a bordered
        post-it -- no card chrome at all, unlike even #1015's free-form
        note (still a bordered .wb-note-card)."""
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        html = get_text_objects(browser)
        assert len(html) == 1
        outer_html = next(iter(html.values()))["outerHTML"]
        assert "wb-note-card" not in outer_html
        assert "wb-note-header" not in outer_html
        assert "wb-note-footer" not in outer_html

        style = browser.execute_script(
            """
            const content = document.querySelector('#whiteboardContainer .wb-text-object-content');
            const cs = getComputedStyle(content);
            return {
                borderWidth: cs.borderTopWidth,
                boxShadow: cs.boxShadow,
                backgroundColor: cs.backgroundColor,
            };
            """
        )
        assert style["borderWidth"] in ("0px", "0"), "no border on a text object at rest"
        assert style["boxShadow"] in ("none", ""), "no shadow on a text object"
        assert style["backgroundColor"] in ("rgba(0, 0, 0, 0)", "transparent"), \
            "no background fill on a text object"

    def test_distinct_from_a_real_post_it_card(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        note_style = browser.execute_script(
            """
            const card = document.querySelector('#whiteboardContainer .wb-note-card');
            const cs = getComputedStyle(card);
            return { borderWidth: cs.borderTopWidth, boxShadow: cs.boxShadow };
            """
        )
        assert note_style["borderWidth"] != "0px", "a real post-it does have a border"
        assert note_style["boxShadow"] != "none", "a real post-it does have a shadow"


class TestTextObjectDragAndEdit:
    def test_click_without_moving_enters_edit_mode_not_a_drag(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        text_id = list(get_text_objects(browser).keys())[0]
        before = get_text_objects(browser)[text_id]
        point = content_point(browser, text_id)

        drag_pointer(browser, point, 0, 0, steps=1)
        time.sleep(0.3)

        after = get_text_objects(browser)[text_id]
        assert after["x"] == before["x"] and after["y"] == before["y"], \
            "a zero-movement click must not reposition the object"
        assert after["editing"] is True, "a click that doesn't drag enters edit mode"

        # Leave edit mode cleanly so later tests in this module see a
        # settled DOM.
        browser.execute_script(
            "document.activeElement && document.activeElement.blur && document.activeElement.blur();"
        )

    def test_drag_repositions_and_commits_once_on_drop(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        text_id = list(get_text_objects(browser).keys())[0]
        before_plan = get_plan_text(browser)
        point = content_point(browser, text_id)

        samples = drag_pointer(browser, point, 120, 40, steps=6)
        # Nothing commits mid-drag -- only the final (post-mouseup) sample
        # may differ from the plan text captured before the gesture began.
        for mid_sample in samples[:-1]:
            assert mid_sample == before_plan, "no markdown write during the drag itself"

        final_plan = wait_for_stable_plan_text(browser, timeout=5.0, quiet=0.8)
        assert final_plan != before_plan, "the drop commits exactly once"

        rows = whiteboard_text_rows(final_plan)
        row = next(r for r in rows if r["id"] == text_id)
        objs = get_text_objects(browser)
        assert row["x"] == objs[text_id]["x"]
        assert row["y"] == objs[text_id]["y"]

    def test_undo_reverts_the_drag_in_one_step(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.2)

        text_id = list(get_text_objects(browser).keys())[0]
        # Wait out any still-in-flight async rewrite (e.g. the front-matter
        # `rag:` normalisation -- see wait_for_front_matter_rag()'s own doc
        # comment) before capturing the "before" row, matching
        # test_whiteboard_drag_resize.py's TestUndo pattern.
        before_row = whiteboard_text_rows(wait_for_stable_plan_text(browser))[0]
        point = content_point(browser, text_id)
        drag_pointer(browser, point, 60, 60, steps=4)
        dragged_row = whiteboard_text_rows(wait_for_stable_plan_text(browser, timeout=5.0, quiet=0.8))[0]
        assert dragged_row["x"] != before_row["x"] or dragged_row["y"] != before_row["y"]

        browser.execute_script("EditorUndoManager.undo();")
        time.sleep(0.3)
        after_row = whiteboard_text_rows(get_plan_text(browser))[0]
        assert after_row["x"] == before_row["x"] and after_row["y"] == before_row["y"], \
            "a single undo must fully restore the text object's previous position"


class TestTextObjectDelete:
    def test_delete_button_removes_the_row(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        text_id = list(get_text_objects(browser).keys())[0]
        browser.execute_script(
            """
            const btn = document.querySelector('#whiteboardContainer .wb-text-object-delete');
            if (btn) btn.click();
            """
        )
        plan_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=0.8)
        assert whiteboard_text_rows(plan_text) == []
        assert get_text_objects(browser) == {}


class TestMixedBoardIndependence:
    """The storage design's own key risk (script.js's "Whiteboard back
    matter" header comment): a post-it row and a text-object row share one
    ---whiteboard--- table, rewritten in full from `items` on every commit.
    An edit to one must never disturb the other."""

    def test_dragging_a_post_it_leaves_the_text_object_untouched(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        text_id = list(get_text_objects(browser).keys())[0]
        before_text_row = whiteboard_text_rows(get_plan_text(browser))[0]

        # Drag the real post-it ("Discovery") via its header, the same
        # gesture test_whiteboard_drag_resize.py exercises.
        point = browser.execute_script(
            """
            const n = document.querySelector('#whiteboardContainer .wb-note[data-wb-task="Discovery"]');
            const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
            const rect = svg.getBoundingClientRect();
            wbZoom = 1;
            wbPanX = rect.width / 2 - parseFloat(n.dataset.wbX);
            wbPanY = rect.height / 2 - parseFloat(n.dataset.wbY) - 15;
            wbApplyTransform(false);
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            """
        )
        time.sleep(0.15)
        drag_pointer(browser, point, 40, 20, steps=4)
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=0.8)

        after_plan = get_plan_text(browser)
        assert whiteboard_note_row_exists(after_plan, "Discovery")
        after_text_row = whiteboard_text_rows(after_plan)[0]
        assert after_text_row == before_text_row, \
            "an unrelated post-it drag must not move/alter the text object's own row"

    def test_creating_a_text_object_leaves_post_it_rows_untouched(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before_plan = get_plan_text(browser)
        click_new_text_button(browser)
        set_editing_text_and_blur(browser, "Another label")
        after_plan = wait_for_stable_plan_text(browser, timeout=5.0, quiet=0.8)

        assert whiteboard_note_row_exists(before_plan, "Discovery")
        assert whiteboard_note_row_exists(after_plan, "Discovery")
        assert len(whiteboard_text_rows(after_plan)) == 2


class TestTextObjectPersistence:
    def test_text_and_position_survive_a_reload(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        text_id = list(get_text_objects(browser).keys())[0]
        before = get_text_objects(browser)[text_id]
        plan_text = get_plan_text(browser)

        # Reload the app fresh and reload the exact same plan text -- the
        # round-trip guarantee this issue asks for (persisted state, not
        # in-session DOM survival).
        open_app(browser, app_server)
        load_plan(browser, plan_text)
        switch_to_whiteboard(browser)

        after = get_text_objects(browser)
        assert text_id in after, "the same text-object id renders again after reload"
        assert after[text_id]["x"] == before["x"]
        assert after[text_id]["y"] == before["y"]
        assert after[text_id]["text"] == before["text"]
