"""Selenium-driven browser tests for authoring plan structure on the whiteboard.

These cover what tests/test_whiteboard_structure.js, _noodles.js and _notes.js
(the pure helpers) can't: the real rendered DOM and the real commit path
through #planEditor for the three gestures that turn the board from a view of
the plan into a way of writing one --

  * dropping a new post-it creates a task *and* its whiteboard row, in one
    undo step;
  * double-pressing a note's header renames the task in place, keeping the
    rest of the task line (resources, durations, dependencies) intact;
  * dragging a noodle from note A to note B re-parents B's whole subtree
    under A, and cutting that noodle moves it back out to the top level.

Follows the same self-contained app_server/browser fixture pattern as
tests/test_whiteboard_board_membership.py and tests/test_whiteboard_notes.py.

Usage:
    uv run pytest tests/test_whiteboard_structure.py -x -q
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

# Two top-level tasks, both on the board, plus a nested one also on the board
# (so there is one noodle to start with) and a leaf that is not (so the
# outline panel has both an on-board and an off-board row to show).
SAMPLE_PLAN = """---
title: Whiteboard Structure Test Plan
---

Discovery
  Kick-off @kev 1d 100%
  Interviews @kev 3d 60%

Build [depends Discovery]
  Design @adam 5d
    Wireframes @adam 2d
  Develop @adam 8d

---whiteboard---
| Task      | X   | Y   | Colour | Width | Height | Collapsed |
|-----------|-----|-----|--------|-------|--------|-----------|
| Discovery | 40  | 40  |        | 250   | 190    | no        |
| Build     | 400 | 40  |        | 250   | 190    | no        |
| Design    | 400 | 300 |        | 250   | 190    | no        |
"""

# No tasks and no whiteboard section at all -- the "start from nothing" case
# that the board only supports now that a post-it can create a task.
BLANK_PLAN = """---
title: Whiteboard Blank Test Plan
---
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


# ── Shared helpers (mirrors test_whiteboard_board_membership.py) ─────────


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


def get_plan_text(driver):
    return driver.execute_script("return document.getElementById('planEditor').value;")


def wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.5, interval=0.25):
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


def wait_for_front_matter_rag(driver, timeout=15.0, interval=0.25):
    # The app auto-writes a `rag:` front-matter entry shortly after a plan
    # loads. Let that unrelated edit land before a test takes its "before"
    # snapshot, or a single undo of the test's own action looks incomplete
    # (same helper and rationale as test_whiteboard_drag_resize.py).
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "rag:" in get_plan_text(driver):
            return True
        time.sleep(interval)
    return False


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
    wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.5)
    driver.execute_script(
        "if (typeof EditorUndoManager !== 'undefined') {"
        "  EditorUndoManager.captureImmediate(document.getElementById('planEditor').value);"
        "}"
    )


def switch_to_whiteboard(driver):
    driver.execute_script("switchToView('whiteboard');")
    WebDriverWait(driver, 5).until(
        EC.visibility_of_element_located((By.ID, "whiteboardContainer"))
    )
    time.sleep(0.4)


def rendered_note_task_names(driver):
    return driver.execute_script(
        "return Array.from(document.querySelectorAll('#whiteboardContainer .wb-note'))"
        ".map(n => n.dataset.wbTask);"
    )


def rendered_noodles(driver):
    """[(parent, child)] for every noodle currently drawn."""
    return [
        tuple(pair)
        for pair in driver.execute_script(
            "return Array.from(document.querySelectorAll('#whiteboardContainer .wb-noodle'))"
            ".map(g => [g.dataset.parent, g.dataset.child]);"
        )
    ]


def outline_rows(driver):
    """[(task name, depth, on-board?)] for every visible outline-panel row."""
    return [
        (row["name"], row["depth"], row["onBoard"])
        for row in driver.execute_script(
            """
            return Array.from(document.querySelectorAll('.wb-outline-row')).map(r => ({
                name: r.dataset.task,
                depth: Number(getComputedStyle(r).getPropertyValue('--wb-outline-depth')),
                onBoard: r.classList.contains('on-board'),
            }));
            """
        )
    ]


def outline_only(plan_text):
    """The task outline: everything before ---whiteboard---, trailing
    newlines normalised away (updatePlanWhiteboardText() always separates
    the two with exactly \\n\\n regardless of what was there before)."""
    return plan_text.split("---whiteboard---")[0].rstrip("\n")


def whiteboard_rows(plan_text):
    """The Task column of every ---whiteboard--- row, in order."""
    if "---whiteboard---" not in plan_text:
        return []
    section = plan_text.split("---whiteboard---", 1)[1]
    names = []
    for line in section.strip().splitlines():
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if not cells:
            continue
        task = cells[0]
        if not task or task.lower() == "task" or set(task) <= {"-"}:
            continue
        names.append(task)
    return names


def drag_noodle(driver, parent_name, child_name):
    """Drag a noodle from `parent_name`'s link handle onto `child_name`'s
    card, driving the real pointer handlers (wbBeginLinkDrag ->
    wbUpdateLinkDrag -> wbEndLinkDrag), including the elementFromPoint
    drop-target hit test wbUpdateLinkDrag() does."""
    return driver.execute_script(
        """
        const [parentName, childName] = arguments;
        const noteFor = (name) => Array.from(
            document.querySelectorAll('#whiteboardContainer .wb-note')
        ).find(n => n.dataset.wbTask === name);

        const handle = noteFor(parentName).querySelector('.wb-note-link-handle');
        const card = noteFor(childName).querySelector('.wb-note-card');
        const h = handle.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, {
            clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true,
        }));

        fire(handle, 'mousedown', h.x + h.width / 2, h.y + h.height / 2);
        const ghost = !!document.querySelector('.wb-noodle-ghost');
        fire(window, 'mousemove', c.x + c.width / 2, c.y + c.height / 2);
        const highlighted = !!document.querySelector('.wb-note-card.wb-link-target');
        fire(window, 'mouseup', c.x + c.width / 2, c.y + c.height / 2);
        return { ghost, highlighted, ghostCleared: !document.querySelector('.wb-noodle-ghost') };
        """,
        parent_name,
        child_name,
    )


def drag_outline_row(driver, source_name, target_name, drop_ratio_y, drop_offset_x=8):
    """Drag `source_name`'s outline row onto `target_name`'s row, dropping
    at `drop_ratio_y` (0 = top edge, 1 = bottom edge) of the target row and
    `drop_offset_x` pixels to the right of the target row's own indent --
    driving the real native HTML5 drag-and-drop handlers
    (wbAttachOutlineDragHandlers() in whiteboard-outline.js), the same way
    tests/test_usability.py drives notepad.js's drag-to-reorder."""
    return driver.execute_script(
        """
        const [sourceName, targetName, ratioY, offsetX] = arguments;
        const rowFor = (name) => Array.from(document.querySelectorAll('.wb-outline-row'))
            .find(r => r.dataset.task === name);
        const source = rowFor(sourceName);
        const target = rowFor(targetName);
        const handle = source.querySelector('.wb-outline-drag-handle');
        const rect = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        const x = rect.left + parseFloat(style.paddingLeft) + offsetX;
        const y = rect.top + rect.height * ratioY;
        const transfer = new DataTransfer();
        const fire = (el, type) => el.dispatchEvent(new DragEvent(type, {
            bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y,
        }));
        fire(handle, 'dragstart');
        fire(target, 'dragover');
        fire(target, 'drop');
        fire(handle, 'dragend');
        """,
        source_name,
        target_name,
        drop_ratio_y,
        drop_offset_x,
    )


def double_press_header(driver, task_name):
    """Two mousedown/mouseup pairs on a note's header, the rename gesture.

    Deliberately not a native dblclick: the first press raises the note to
    the front of the notes layer, and moving a node in the DOM cancels the
    browser's own double-click tracking -- which is exactly why the app
    detects the gesture from consecutive mousedowns itself (see
    wbIsRepeatHeaderPress() in whiteboard-notes.js). This test drives the
    same two presses a real user's double-click produces.
    """
    return driver.execute_script(
        """
        const note = Array.from(document.querySelectorAll('#whiteboardContainer .wb-note'))
            .find(n => n.dataset.wbTask === arguments[0]);
        const header = note.querySelector('.wb-note-header');
        const r = header.getBoundingClientRect();
        const x = r.x + 20, y = r.y + r.height / 2;
        const fire = (type) => header.dispatchEvent(new MouseEvent(type, {
            clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true,
        }));
        fire('mousedown'); fire('mouseup');
        fire('mousedown'); fire('mouseup');
        return !!document.querySelector('.wb-note-title.editing');
        """,
        task_name,
    )


def commit_title_edit(driver, new_name):
    """Type a new name into the note title currently being edited and press
    Enter, the way a real rename ends."""
    driver.execute_script(
        """
        const t = document.querySelector('.wb-note-title.editing');
        t.textContent = arguments[0];
        t.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true,
        }));
        """,
        new_name,
    )
    wait_for_stable_plan_text(driver, timeout=6.0, quiet=1.0)


def undo(driver):
    driver.execute_script(
        "const ed = document.getElementById('planEditor');"
        "ed.focus();"
        "ed.dispatchEvent(new KeyboardEvent('keydown', "
        "  {key: 'z', ctrlKey: true, bubbles: true, cancelable: true}));"
    )
    wait_for_stable_plan_text(driver, timeout=6.0, quiet=1.0)


# ── New post-it creates a task ───────────────────────────────────────────


def test_new_post_it_creates_a_task_and_a_row(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    name = browser.execute_script("return wbCreateNoteAt(900, 500);")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    after = get_plan_text(browser)

    assert name == "New idea"
    # The task line lands at the top level of the outline, before the back
    # matter -- not appended to the end of the file.
    assert outline_only(after).splitlines()[-1] == "New idea"
    assert "New idea" in whiteboard_rows(after)
    assert name in rendered_note_task_names(browser)

    # Every pre-existing outline line survives untouched.
    assert outline_only(before).splitlines() == outline_only(after).splitlines()[:-1]


def test_text_note_is_a_commented_out_line_not_a_task(app_server, browser):
    """The toolbar's "Text note" button makes a note that is not a task: a
    commented-out line at the end of the outline (so the scheduler never
    sees it) plus an ordinary whiteboard row naming it. It renders as a
    card, flagged as a thought, and adds nothing to the task list."""
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    tasks_before = browser.execute_script("return wbLastTasks.length;")
    browser.find_element(By.ID, "whiteboardTextNoteBtn").click()
    # The new card opens in title-edit; leave it without typing so it keeps
    # its placeholder name.
    browser.execute_script("document.activeElement && document.activeElement.blur();")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    after = get_plan_text(browser)

    assert outline_only(after).splitlines()[-1] == "// New thought"
    assert "New thought" in whiteboard_rows(after)
    assert "New thought" in rendered_note_task_names(browser)
    assert outline_only(before).splitlines() == outline_only(after).splitlines()[:-1]
    assert browser.execute_script("return wbIsThoughtNote('New thought');")
    assert browser.execute_script("return wbLastTasks.length;") == tasks_before


def test_promoting_a_text_note_uncomments_it_into_a_task(app_server, browser):
    """"Promote to task" on a text note uncomments its line: the same card,
    in place, is now a post-it backed by a real task -- and it is one undo
    step."""
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    browser.execute_script("wbCreateThoughtAt(900, 500);")
    browser.execute_script("document.activeElement && document.activeElement.blur();")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    browser.execute_script("wbSetThoughtText('New thought', 'Ask legal about \"the\" licence');")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    thought_text = get_plan_text(browser)
    assert outline_only(thought_text).splitlines()[-1] == "// New thought \"Ask legal about 'the' licence\""

    browser.execute_script("wbOpenNoteMenu('New thought', document.querySelector('.wb-note-menu-btn'));")
    promote = WebDriverWait(browser, 3).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, "#wbNoteMenu .wb-note-menu-promote-thought"))
    )
    assert promote.text.strip() == "Promote to task"
    promote.click()
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    promoted = get_plan_text(browser)

    assert outline_only(promoted).splitlines()[-1] == "New thought \"Ask legal about 'the' licence\""
    assert "New thought" in whiteboard_rows(promoted)
    assert not browser.execute_script("return wbIsThoughtNote('New thought');")
    assert browser.execute_script(
        "return wbLastTasks.some(t => t.name === 'New thought');"
    )

    undo(browser)
    assert get_plan_text(browser) == thought_text


def test_new_post_it_lands_where_it_was_dropped(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    browser.execute_script("return wbCreateNoteAt(1200, 700);")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)

    rect = browser.execute_script(
        "const n = Array.from(document.querySelectorAll('.wb-note'))"
        "  .find(n => n.dataset.wbTask === 'New idea');"
        "return {x: parseFloat(n.getAttribute('x')), y: parseFloat(n.getAttribute('y')),"
        "        w: parseFloat(n.getAttribute('width')), h: parseFloat(n.getAttribute('height'))};"
    )
    # Centred on the drop point, not placed at some default corner.
    assert abs((rect["x"] + rect["w"] / 2) - 1200) <= 1
    assert abs((rect["y"] + rect["h"] / 2) - 700) <= 1


def test_new_post_it_is_one_undo_step(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    browser.execute_script("return wbCreateNoteAt(900, 500);")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    assert get_plan_text(browser) != before

    undo(browser)
    assert get_plan_text(browser) == before


def test_new_post_it_on_a_blank_plan(app_server, browser):
    """A board can be started from nothing -- the case that only works now
    that a post-it creates its own task."""
    open_app(browser, app_server)
    load_plan(browser, BLANK_PLAN)
    switch_to_whiteboard(browser)

    browser.execute_script("return wbCreateNoteAt(300, 300);")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    after = get_plan_text(browser)

    assert outline_only(after).strip().endswith("New idea")
    assert whiteboard_rows(after) == ["New idea"]
    assert rendered_note_task_names(browser) == ["New idea"]


def test_second_new_post_it_gets_a_unique_name(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, BLANK_PLAN)
    switch_to_whiteboard(browser)

    first = browser.execute_script("return wbCreateNoteAt(300, 300);")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    second = browser.execute_script("return wbCreateNoteAt(900, 300);")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)

    assert (first, second) == ("New idea", "New idea 2")
    assert sorted(rendered_note_task_names(browser)) == ["New idea", "New idea 2"]


# ── Inline rename ────────────────────────────────────────────────────────


def test_double_press_header_renames_the_task(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    assert double_press_header(browser, "Build") is True
    commit_title_edit(browser, "Build and integrate")
    after = get_plan_text(browser)

    # The name changes; everything else on that task line survives.
    assert "Build and integrate [depends Discovery]" in after
    assert "Build [depends Discovery]" not in after
    assert "  Design @adam 5d" in after
    assert "    Wireframes @adam 2d" in after

    # The whiteboard row is migrated with it, so the note isn't orphaned.
    assert "Build and integrate" in whiteboard_rows(after)
    assert "Build" not in whiteboard_rows(after)
    assert "Build and integrate" in rendered_note_task_names(browser)
    assert "Build" not in rendered_note_task_names(browser)


def test_rename_is_refused_when_the_name_is_taken(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    # Whiteboard rows, dependencies and Theme: colours all key on the task
    # name, so two tasks sharing one would make those references ambiguous.
    assert browser.execute_script(
        "return wbRenameNoteTask('Build', 'Discovery');"
    ) is False
    assert get_plan_text(browser) == before


def test_escape_abandons_a_rename(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    assert double_press_header(browser, "Build") is True
    browser.execute_script(
        "const t = document.querySelector('.wb-note-title.editing');"
        "t.textContent = 'Something else';"
        "t.dispatchEvent(new KeyboardEvent('keydown', "
        "  {key: 'Escape', bubbles: true, cancelable: true}));"
    )
    time.sleep(0.5)

    # The task outline is byte-for-byte untouched: no rename happened.
    assert outline_only(get_plan_text(browser)) == outline_only(before)
    # The whiteboard rows still name the same tasks. Their *order* may have
    # changed: the first press of the pair is an ordinary press on a note,
    # which brings it to the front, and front-ness is persisted as row
    # order (wbMoveTaskToEnd()). That is the pre-existing click-to-raise
    # behaviour, not part of the rename.
    assert sorted(whiteboard_rows(get_plan_text(browser))) == sorted(whiteboard_rows(before))
    assert "Build" in rendered_note_task_names(browser)
    assert browser.execute_script(
        "return !document.querySelector('.wb-note-title.editing');"
    ), "the title is no longer in edit mode"


# ── Noodles ──────────────────────────────────────────────────────────────


def test_noodles_are_drawn_for_on_board_parents_only(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    # Build -> Design is the only pair where both ends have a note.
    assert rendered_noodles(browser) == [("Build", "Design")]

    # Design's own child has no note, so it stays a checklist row inside it;
    # Build's on-board child does not appear as a row.
    rows = browser.execute_script(
        "const n = Array.from(document.querySelectorAll('.wb-note'))"
        "  .find(n => n.dataset.wbTask === arguments[0]);"
        "return Array.from(n.querySelectorAll('.wb-note-row-name')).map(e => e.textContent);",
        "Build",
    )
    assert rows == ["Develop"], "an on-board child is a noodle, not a checklist row"


def test_dragging_a_noodle_reparents_the_subtree(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    result = drag_noodle(browser, "Discovery", "Build")
    assert result["ghost"] is True, "a ghost noodle follows the pointer"
    assert result["highlighted"] is True, "the drop target is highlighted"
    assert result["ghostCleared"] is True, "the ghost is removed on drop"

    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    lines = outline_only(get_plan_text(browser)).splitlines()

    assert "  Build [depends Discovery]" in lines, "Build is now a child of Discovery"
    assert "    Design @adam 5d" in lines, "its subtree moved with it"
    assert "      Wireframes @adam 2d" in lines, "a grandchild kept its relative depth"
    assert "    Develop @adam 8d" in lines
    assert lines.count("  Build [depends Discovery]") == 1, "no duplicated task line"

    assert set(rendered_noodles(browser)) == {("Build", "Design"), ("Discovery", "Build")}


def test_cutting_a_noodle_moves_the_task_to_the_top_level(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    assert browser.execute_script("return wbCutNoodle('Build', 'Design');") is True
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    lines = outline_only(get_plan_text(browser)).splitlines()

    assert "Design @adam 5d" in lines, "Design is now top level"
    assert "  Wireframes @adam 2d" in lines, "its child came with it, one level shallower"
    assert rendered_noodles(browser) == []
    # Cutting a noodle un-files a task; it never deletes one.
    assert "Design" in rendered_note_task_names(browser)
    assert "Wireframes" in get_plan_text(browser)


def test_a_noodle_is_one_undo_step(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    drag_noodle(browser, "Discovery", "Build")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    assert get_plan_text(browser) != before

    undo(browser)
    assert get_plan_text(browser) == before


def test_a_cycle_is_refused_with_a_message(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    # Design already sits under Build, so linking Build under Design would
    # detach that whole branch into a loop.
    assert browser.execute_script("return wbLinkNotes('Design', 'Build');") is False
    time.sleep(0.4)

    assert get_plan_text(browser) == before, "a refused link writes nothing"
    message = browser.execute_script(
        "const m = document.querySelector('.wb-noodle-message');"
        "return m && m.classList.contains('visible') ? m.textContent : null;"
    )
    assert message is not None and "loop" in message


def test_an_existing_link_is_a_no_op(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    assert browser.execute_script("return wbLinkNotes('Build', 'Design');") is False
    time.sleep(0.4)
    assert get_plan_text(browser) == before, "re-drawing an existing link creates no undo step"


def test_noodles_follow_a_note_as_it_is_dragged(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    moved = browser.execute_script(
        """
        const noodle = document.querySelector('.wb-noodle .wb-noodle-path');
        const before = noodle.getAttribute('d');

        const note = Array.from(document.querySelectorAll('.wb-note'))
            .find(n => n.dataset.wbTask === 'Design');
        const header = note.querySelector('.wb-note-header');
        const r = header.getBoundingClientRect();
        const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, {
            clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true,
        }));

        fire(header, 'mousedown', r.x + 20, r.y + r.height / 2);
        fire(window, 'mousemove', r.x + 220, r.y + r.height / 2 + 120);
        const during = document.querySelector('.wb-noodle .wb-noodle-path').getAttribute('d');
        fire(window, 'mouseup', r.x + 220, r.y + r.height / 2 + 120);
        return { before, during };
        """
    )
    assert moved["before"] != moved["during"], (
        "a noodle re-routes on every frame of the note drag it is attached to"
    )


# ── Floating outline panel ───────────────────────────────────────────────


def test_outline_panel_mirrors_the_plan_hierarchy(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    assert outline_rows(browser) == [
        ("Discovery", 0, True),
        ("Kick-off", 1, False),
        ("Interviews", 1, False),
        ("Build", 0, True),
        ("Design", 1, True),
        ("Wireframes", 2, False),
        ("Develop", 1, False),
    ]


def test_outline_panel_follows_a_noodle(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    drag_noodle(browser, "Discovery", "Build")
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)

    # Build (and its whole subtree) is now nested one level deeper, under
    # Discovery -- the outline is a rendering of the same hierarchy the
    # noodles are, so it cannot disagree with them.
    assert outline_rows(browser) == [
        ("Discovery", 0, True),
        ("Kick-off", 1, False),
        ("Interviews", 1, False),
        ("Build", 1, True),
        ("Design", 2, True),
        ("Wireframes", 3, False),
        ("Develop", 2, False),
    ]


def test_outline_collapse_hides_children_and_persists(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    browser.execute_script("wbToggleOutlineNode('Discovery');")
    time.sleep(0.3)
    names = [name for name, _, _ in outline_rows(browser)]
    assert "Kick-off" not in names and "Interviews" not in names
    assert "Discovery" in names and "Build" in names

    stored = browser.execute_script(
        "return localStorage.getItem('whiteboard_outline_' + "
        "  ((typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default'));"
    )
    assert stored and "discovery" in stored

    # Collapse is view state: it must never reach the plan file.
    assert "collapsed" not in get_plan_text(browser).lower().split("---whiteboard---")[0]

    # Restore the expanded state: this suite's `browser` fixture is
    # module-scoped and localStorage survives every later test's page
    # navigation (it is keyed by project, not by page load), so leaving
    # Discovery collapsed here would silently hide its children from every
    # outline_rows() assertion for the rest of this file.
    browser.execute_script("wbOutlineExpandAll();")


def test_outline_search_keeps_matches_and_their_ancestors(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    browser.execute_script(
        "const s = document.querySelector('.wb-outline-search-input');"
        "s.value = 'wire';"
        "s.dispatchEvent(new Event('input', {bubbles: true}));"
    )
    time.sleep(0.3)
    assert [name for name, _, _ in outline_rows(browser)] == ["Build", "Design", "Wireframes"]


def test_outline_row_pans_the_board_to_its_note(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    result = browser.execute_script(
        """
        const before = [wbPanX, wbPanY];
        const row = Array.from(document.querySelectorAll('.wb-outline-row'))
            .find(r => r.dataset.task === 'Design');
        row.querySelector('.wb-outline-label').click();
        return {
            moved: wbPanX !== before[0] || wbPanY !== before[1],
            flashed: !!document.querySelector('.wb-note-card.wb-note-flash'),
        };
        """
    )
    assert result["moved"] is True
    assert result["flashed"] is True


def test_outline_panel_hides_to_a_rail(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    browser.execute_script("wbToggleOutlinePanel(false);")
    time.sleep(0.3)
    state = browser.execute_script(
        "return {"
        "  hidden: document.querySelector('.wb-outline-panel').classList.contains('hidden'),"
        "  rail: getComputedStyle(document.querySelector('.wb-outline-rail')).display,"
        "};"
    )
    assert state["hidden"] is True
    assert state["rail"] != "none", "hiding the panel is never a one-way door"

    browser.execute_script("wbToggleOutlinePanel(true);")
    time.sleep(0.3)
    assert browser.execute_script(
        "return document.querySelector('.wb-outline-panel').classList.contains('hidden');"
    ) is False


def test_outline_add_button_puts_a_task_on_the_board(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before_outline = outline_only(get_plan_text(browser))
    browser.execute_script(
        "Array.from(document.querySelectorAll('.wb-outline-row'))"
        "  .find(r => r.dataset.task === 'Wireframes')"
        "  .querySelector('.wb-outline-add').click();"
    )
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    after = get_plan_text(browser)

    assert "Wireframes" in whiteboard_rows(after)
    assert "Wireframes" in rendered_note_task_names(browser)
    # Adding a note must not touch the task outline at all.
    assert outline_only(after) == before_outline
    # And the noodle for its now-on-board parent appears with it.
    assert ("Design", "Wireframes") in rendered_noodles(browser)


# ── Drag positioning in the outline panel (issue #1156) ──────────────────


def test_dragging_a_row_to_the_top_reorders_it(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    # Dropping on the *top* half of a row reorders the dragged task to sit
    # just before it, at that row's own depth -- a plain "move up/down",
    # not the "make it a sub-task" gesture.
    drag_outline_row(browser, "Develop", "Discovery", drop_ratio_y=0.1)
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)

    assert outline_rows(browser) == [
        ("Develop", 0, False),
        ("Discovery", 0, True),
        ("Kick-off", 1, False),
        ("Interviews", 1, False),
        ("Build", 0, True),
        ("Design", 1, True),
        ("Wireframes", 2, False),
    ]
    lines = outline_only(get_plan_text(browser)).splitlines()
    assert lines.count("Develop @adam 8d") == 1, "the old line is gone, not duplicated"


def test_dragging_a_row_to_the_bottom_reorders_it_after(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    # Dropping on the bottom half *without* a rightward offset is still a
    # plain reorder: Kick-off (Discovery's child) lands right after Build's
    # whole subtree, at Build's own top level -- un-nested for free.
    drag_outline_row(browser, "Kick-off", "Build", drop_ratio_y=0.9, drop_offset_x=2)
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)

    assert outline_rows(browser) == [
        ("Discovery", 0, True),
        ("Interviews", 1, False),
        ("Build", 0, True),
        ("Design", 1, True),
        ("Wireframes", 2, False),
        ("Develop", 1, False),
        ("Kick-off", 0, False),
    ]


def test_dragging_a_row_under_and_right_nests_it_as_a_subtask(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    # Bottom half *and* well to the right of Discovery's own indent -- the
    # "make it a sub-task" gesture the issue asks not to confuse with a
    # plain reorder.
    drag_outline_row(browser, "Develop", "Discovery", drop_ratio_y=0.9, drop_offset_x=40)
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)

    assert outline_rows(browser) == [
        ("Discovery", 0, True),
        ("Kick-off", 1, False),
        ("Interviews", 1, False),
        ("Develop", 1, False),
        ("Build", 0, True),
        ("Design", 1, True),
        ("Wireframes", 2, False),
    ]
    lines = outline_only(get_plan_text(browser)).splitlines()
    assert "  Develop @adam 8d" in lines, "Develop is now Discovery's child, not Build's"


def test_dragging_a_row_onto_its_own_child_is_refused(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    # Nesting Discovery under its own child would detach the branch into a
    # loop -- the same cycle check a dragged noodle already refuses.
    drag_outline_row(browser, "Discovery", "Kick-off", drop_ratio_y=0.9, drop_offset_x=40)
    time.sleep(0.4)

    assert get_plan_text(browser) == before, "a refused nest writes nothing"


def test_dragging_a_row_is_one_undo_step(app_server, browser):
    open_app(browser, app_server)
    load_plan(browser, SAMPLE_PLAN)
    switch_to_whiteboard(browser)

    before = get_plan_text(browser)
    drag_outline_row(browser, "Develop", "Discovery", drop_ratio_y=0.1)
    wait_for_stable_plan_text(browser, timeout=6.0, quiet=1.0)
    assert get_plan_text(browser) != before

    undo(browser)
    assert get_plan_text(browser) == before
