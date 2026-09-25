#!/usr/bin/env python3
"""Capture screenshots of NoodlePlanner for Sphinx documentation.

Connects to a running NoodlePlanner instance (default: http://localhost:8007),
loads a sample plan, and captures screenshots of key views.

Requirements:
    - selenium (pip install selenium)
    - Chrome browser + chromedriver (or webdriver-manager)
    - A running NoodlePlanner instance

Usage:
    python docs/capture_screenshots.py
    python docs/capture_screenshots.py --base-url http://localhost:9000

Behind a restricted network, serve the CDN assets locally and set
NOODLE_CDN_MIRROR=127.0.0.1:<port> -- see create_driver(). Without it the
capture silently loses Bootstrap, every icon and the webfonts.
"""

import argparse
import base64
import hashlib
import os
import time
from pathlib import Path

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import (
        TimeoutException,
        NoSuchElementException,
        WebDriverException,
    )
except ImportError:
    raise SystemExit(
        "selenium is required: pip install selenium"
    )

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "http://localhost:8007"

IMG_ROOT = Path(__file__).resolve().parent / "_static" / "img"

SAMPLE_PLAN = """\
---
title: Website Redesign 2026
project manager: Alex Chen
sponsor: Marketing Director
budget: £125,000
status: Amber
Resources:
- @alex: Alex Chen, Project Manager
- @jamie: Jamie Smith, Developer
- @sam: Sam Lee, Designer
---

Discovery & Planning
  Stakeholder interviews @alex 3d start:2026-04-14 100%
  *Requirements gathering @alex @jamie 2d 75%
  Sign-off on requirements @alex 0d [depends Requirements gathering]

Design
  Wireframes @sam 5d [depends Sign-off on requirements]
  *Design review @alex @sam 1d
  *Final designs @sam 3d "Includes mobile breakpoints"

Development
  Frontend build @jamie 10d [depends Final designs]
  *Backend integration @jamie 5d
  *Code review @alex @jamie 2d

Testing & Launch
  UAT @alex @sam 3d [depends Code review]
  *Bug fixes @jamie 2d
  Go Live 0d [depends Bug fixes]

---whiteboard---
| Task                  | X   | Y   | Colour  | Width | Height | Collapsed |
|-----------------------|-----|-----|---------|-------|--------|-----------|
| Discovery & Planning  | 80  | 60  | #4A90D9 | 280   | 220    | no        |
| Design                | 460 | 60  |         | 280   | 220    | no        |
| Requirements gathering| 80  | 340 | #7FB069 | 280   | 200    | no        |
| Wireframes            | 460 | 340 | #E58C8A | 280   | 200    | no        |
"""

# rp-01/rp-02 (#776): the sample plan's shape with a baseline section, some
# progress and one slip, so both reports have something to say.
REPORTS_PLAN = """\
---
title: Website Redesign 2026
Resources:
- @alex: Alex Chen, Project Manager
- @jamie: Jamie Smith, Developer
- @sam: Sam Lee, Designer
---

Discovery & Planning
  Stakeholder interviews @alex 3d 2026-04-13 100%
  Requirements gathering @alex @jamie 2d [depends Stakeholder interviews] 100%
  Sign-off on requirements @alex 0d [depends Requirements gathering]

Design
  Wireframes @sam 7d [depends Sign-off on requirements] 60%
  Design review @alex @sam 1d [depends Wireframes]
  Final designs @sam 3d [depends Design review]

Development
  Frontend build @jamie 10d [depends Final designs]
  Backend integration @jamie 5d [depends Frontend build]
  Content migration 3d [depends Final designs]

Testing & Launch
  UAT @alex @sam 3d [depends Backend integration]
  Go Live 0d [depends UAT]

---baseline---
| Task Name | Start | Finish | Duration |
|-----------|-------|--------|----------|
| Discovery & Planning | 2026-04-13 | 2026-04-18 | 5d |
| Stakeholder interviews | 2026-04-13 | 2026-04-16 | 3d |
| Requirements gathering | 2026-04-16 | 2026-04-18 | 2d |
| Sign-off on requirements | 2026-04-20 | 2026-04-20 | 0d |
| Design | 2026-04-20 | 2026-04-29 | 7d |
| Wireframes | 2026-04-20 | 2026-04-25 | 5d |
| Design review | 2026-04-27 | 2026-04-28 | 1d |
| Final designs | 2026-04-28 | 2026-05-01 | 3d |
| Development | 2026-05-01 | 2026-05-22 | 15d |
| Frontend build | 2026-05-01 | 2026-05-15 | 10d |
| Backend integration | 2026-05-15 | 2026-05-22 | 5d |
| Testing & Launch | 2026-05-22 | 2026-05-28 | 3d |
| UAT | 2026-05-22 | 2026-05-28 | 3d |
| Go Live | 2026-05-28 | 2026-05-28 | 0d |
| Accessibility audit | 2026-05-18 | 2026-05-20 | 2d |
"""

# A small standalone plan for wb-03 (task-peek popover, issue #850): the
# main SAMPLE_PLAN's summary tasks are all one level deep, so nothing on
# its board ever shows a child-count badge. "Requirements gathering" here
# has its own children, which is what makes the badge (and the popover it
# opens) appear on the "Discovery & Planning" note.
WHITEBOARD_PEEK_PLAN = """\
---
title: Website Redesign 2026
project manager: Alex Chen
Resources:
- @alex: Alex Chen, Project Manager
- @jamie: Jamie Smith, Developer
---

Discovery & Planning
  Stakeholder interviews @alex 3d start:2026-04-14 100%
  *Requirements gathering @alex @jamie 2d 75%
    Interviews complete @alex 1d 100%
    Draft brief @alex @jamie 1d 50%
  Sign-off on requirements @alex 0d [depends Requirements gathering]

---whiteboard---
| Task                 | X   | Y   | Colour  | Width | Height | Collapsed |
|----------------------|-----|-----|---------|-------|--------|-----------|
| Discovery & Planning | 80  | 60  | #4A90D9 | 280   | 240    | no        |
"""

# ---------------------------------------------------------------------------
# Driver setup
# ---------------------------------------------------------------------------

# Every image in docs/_static/img/ is captured at 2x so it stays sharp on a
# HiDPI screen and can be downscaled by the theme.
DEVICE_SCALE = 2



VIEWPORT = (1440, 900)


def fit_viewport(driver):
    """Size the window so the *page* gets VIEWPORT, not the whole window.

    --window-size sets the outer window, and how much of that the browser's
    own frame takes varies by Chrome build: headless Chromium 141 keeps 139px
    of it, leaving a 761px-tall page. Every full-page shot then comes out
    short, with scrollbars the committed ones don't have. Measure the frame
    and grow the window by it so the page is 1440x900 on any build.
    """
    width, height = VIEWPORT
    inner_w, inner_h = driver.execute_script("return [innerWidth, innerHeight];")
    size = driver.get_window_size()
    if (inner_w, inner_h) != (width, height):
        driver.set_window_size(
            width + size["width"] - inner_w,
            height + size["height"] - inner_h,
        )
    return driver


def create_driver():
    """Create a headless Chrome WebDriver with high-DPI settings."""
    options = ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument(f"--window-size={VIEWPORT[0]},{VIEWPORT[1]}")
    # Builds without overlay scrollbars otherwise paint classic ones into
    # every scrollable panel, which the committed images don't have.
    options.add_argument("--hide-scrollbars")
    options.add_argument(f"--force-device-scale-factor={DEVICE_SCALE}")

    # index.html pulls Bootstrap, Bootstrap Icons and three webfonts from
    # cdn.jsdelivr.net and fonts.googleapis.com. Where those are unreachable the
    # page still renders, but without Bootstrap's styling, without a single icon
    # and in fallback typefaces -- and a screenshot like that is worse than a
    # stale one, because it looks plausible.
    #
    # NOODLE_CDN_MIRROR points at a local HTTPS server standing in for all three
    # hosts. The page's own URLs are untouched; Chrome simply resolves them
    # here. Cert errors are ignored because the mirror is necessarily
    # self-signed, and that is safe only because every request is being
    # redirected to localhost -- do not set this against a real network.
    mirror = os.environ.get("NOODLE_CDN_MIRROR")
    if mirror:
        hosts = ("cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com")
        rules = ",".join(f"MAP {h} {mirror}" for h in hosts)
        options.add_argument(f"--host-resolver-rules={rules}")
        options.add_argument("--ignore-certificate-errors")

    # Try system chromium/chromedriver first (e.g. Raspberry Pi / Debian),
    # then this sandbox's own pre-installed Playwright Chromium build (the
    # Claude Code web sandbox sets PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
    # and has no /usr/bin/chromium at all).
    import glob

    chromium_paths = [
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        *sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")),
    ]
    for path in chromium_paths:
        if os.path.exists(path):
            options.binary_location = path
            break

    # Try system chromedriver first
    chromedriver_paths = ["/usr/bin/chromedriver", "/usr/local/bin/chromedriver", "/opt/node22/bin/chromedriver"]
    for drv_path in chromedriver_paths:
        if os.path.exists(drv_path):
            try:
                service = ChromeService(executable_path=drv_path)
                return fit_viewport(webdriver.Chrome(service=service, options=options))
            except WebDriverException:
                continue

    # Try webdriver-manager for automatic chromedriver management
    try:
        from webdriver_manager.chrome import ChromeDriverManager

        service = ChromeService(ChromeDriverManager().install())
        return fit_viewport(webdriver.Chrome(service=service, options=options))
    except (ImportError, Exception):
        pass

    # Fall back to default
    try:
        return fit_viewport(webdriver.Chrome(options=options))
    except WebDriverException as exc:
        raise SystemExit(
            f"Chrome/chromedriver not available: {exc}"
        )


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def load_plan(driver, plan_text):
    """Clear the editor, paste *plan_text*, and trigger a render."""
    dismiss_tour(driver)
    # Make sure we are on the project tab with the editor visible
    driver.execute_script(
        "if (typeof switchTab === 'function') switchTab('project');"
    )
    time.sleep(0.5)

    editor = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, "planEditor"))
    )
    # Clear and set value via JS to avoid send_keys issues with large text
    driver.execute_script(
        "arguments[0].value = arguments[1];"
        "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
        editor,
        plan_text,
    )
    time.sleep(0.3)

    # Trigger render
    driver.execute_script(
        "if (typeof renderPlan === 'function') renderPlan();"
    )


def wait_for_render(driver, timeout=10):
    """Wait for the plan output area to populate after rendering."""
    # Wait for the output area / dashboard to have meaningful content
    WebDriverWait(driver, timeout).until(
        lambda d: len(
            d.find_element(By.TAG_NAME, "body").text
        ) > 200
    )
    # Extra pause for animations and chart rendering
    time.sleep(2)


def switch_to_view(driver, view_id):
    """Switch to a plan sub-navigation view by its data-view identifier.

    Uses the JavaScript switchToView() function for reliability, with
    special handling for dashboard and kanban which have their own functions.
    """
    special = {
        "project-report": "switchPlanSubnavToDashboard()",
        "kanban": "switchPlanSubnavToBoard()",
    }
    # After a fresh driver.get() reload, the trailing <script> tags that
    # define switchToView()/switchPlanSubnavToDashboard() etc. can still
    # be loading even once #planEditor (much earlier in the DOM) and a
    # >200-char body (wait_for_render()'s check) are already present --
    # this was observed to intermittently throw "switchToView is not
    # defined" here. Wait for the specific function to exist before
    # calling it, rather than a fixed sleep.
    fn_name = "switchPlanSubnavToDashboard" if view_id == "project-report" \
        else "switchPlanSubnavToBoard" if view_id == "kanban" else "switchToView"
    WebDriverWait(driver, 10).until(
        lambda d: d.execute_script(f"return typeof {fn_name} === 'function';")
    )
    js = special.get(view_id, f"switchToView('{view_id}')")
    driver.execute_script(js)
    time.sleep(2)  # let view render and animations settle


def capture_element(driver, selector, output_path):
    """Screenshot a specific DOM element and save to *output_path*.

    Not `element.screenshot()`: current Chrome crops that out of the layout
    bitmap *before* --force-device-scale-factor applies, so it returns a 1x
    image while every full-page shot beside it is 2x. That is how
    wb-04-plan-structure.png came back 260x298 where the committed one was
    520x708 — half the resolution, in a figure whose whole point is that the
    panel's small detail stays legible.

    DevTools' own clip is captured after the scale factor, so ask for it there
    and only fall back to Selenium's version if the protocol call is
    unavailable. The clip's own `scale` is a further multiplier on top of
    --force-device-scale-factor, not a replacement for it -- asking for 2 here
    gives a 4x image -- so it stays at 1.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        element = WebDriverWait(driver, 8).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, selector))
        )
    except (TimeoutException, NoSuchElementException) as exc:
        print(f"  [SKIP]    {output_path} — element not found: {selector} ({exc})")
        return

    try:
        rect = driver.execute_script(
            "const r = arguments[0].getBoundingClientRect();"
            "return {x: r.left + window.scrollX, y: r.top + window.scrollY,"
            " width: r.width, height: r.height};",
            element,
        )
        shot = driver.execute_cdp_cmd(
            "Page.captureScreenshot",
            {
                "format": "png",
                "clip": {**rect, "scale": 1},
                "captureBeyondViewport": True,
            },
        )
        output_path.write_bytes(base64.b64decode(shot["data"]))
    except WebDriverException as exc:
        print(f"  [element] CDP clip unavailable ({type(exc).__name__}), falling back to 1x")
        element.screenshot(str(output_path))
    print(f"  [element] {output_path}")


def dismiss_tour(driver):
    """Dismiss the onboarding tour popup by setting the cookie and hiding overlays."""
    driver.execute_script(
        "document.cookie = 'tourCompleted=true; path=/; max-age=31536000';"
        "var overlay = document.getElementById('tourOverlay');"
        "if (overlay) overlay.style.display = 'none';"
        "var popup = document.getElementById('tourPopup');"
        "if (popup) popup.style.display = 'none';"
        "var spotlight = document.getElementById('tourSpotlight');"
        "if (spotlight) spotlight.style.display = 'none';"
    )
    time.sleep(0.3)


def capture_full(driver, output_path):
    """Take a full-viewport screenshot and save to *output_path*."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    driver.save_screenshot(str(output_path))
    print(f"  [full]    {output_path}")


# ---------------------------------------------------------------------------
# Screenshot routines
# ---------------------------------------------------------------------------


def capture_tutorials(driver, base_url):
    """Capture screenshots for the tutorials section."""
    section = IMG_ROOT / "tutorials"
    print("\n--- Tutorials ---")

    # gs-01: Welcome screen (fresh page, no plan loaded)
    driver.get(base_url)
    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, "planEditor"))
    )
    dismiss_tour(driver)
    time.sleep(1)
    capture_full(driver, section / "gs-01-welcome-screen.png")

    # gs-02: Editor with plan text (before render)
    driver.execute_script(
        "if (typeof switchTab === 'function') switchTab('project');"
    )
    time.sleep(0.5)
    editor = driver.find_element(By.ID, "planEditor")
    driver.execute_script(
        "arguments[0].value = arguments[1];"
        "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
        editor,
        SAMPLE_PLAN,
    )
    time.sleep(0.5)
    capture_full(driver, section / "gs-02-editor-with-plan.png")

    # gs-03: Rendered dashboard
    driver.execute_script(
        "if (typeof renderPlan === 'function') renderPlan();"
    )
    wait_for_render(driver)
    switch_to_view(driver, "project-report")
    capture_full(driver, section / "gs-03-rendered-dashboard.png")


def capture_how_to(driver, base_url):
    """Capture screenshots for the how-to section."""
    section = IMG_ROOT / "how-to"
    print("\n--- How-to ---")

    # Ensure plan is loaded and rendered
    driver.get(base_url)
    load_plan(driver, SAMPLE_PLAN)
    wait_for_render(driver)

    # rp-01 / rp-02: the Tasks by Assignment and Slippage reports (#776).
    # Slippage needs a baseline, so REPORTS_PLAN carries one.
    load_plan(driver, REPORTS_PLAN)
    wait_for_render(driver)
    switch_to_view(driver, "assignments")
    capture_full(driver, section / "rp-01-tasks-by-assignment.png")
    switch_to_view(driver, "slippage")
    capture_full(driver, section / "rp-02-slippage.png")
    load_plan(driver, SAMPLE_PLAN)
    wait_for_render(driver)

    # gv-01: Gantt chart
    switch_to_view(driver, "gantt")
    capture_full(driver, section / "gv-01-gantt-full.png")

    # gv-02: zoomed out between the Months and Quarters detents (#787), so
    # the header shows quarters over months and the readout says "~Months"
    driver.execute_script("setGanttZoom(4);")
    time.sleep(0.8)
    capture_full(driver, section / "gv-02-gantt-zoom.png")

    # gv-03: mid-drag. Dependency lines on, the Wireframes bar's right end
    # held and dragged three days on, so its dependants show in their
    # preview positions; Escape then cancels, leaving the plan untouched.
    driver.execute_script(
        "setGanttZoom(28);"
        "const deps = document.getElementById('ganttShowDependencies');"
        "if (!deps.checked) { deps.checked = true; deps.dispatchEvent(new Event('change')); }"
        "const i = ganttTasks.findIndex(t => t.name === 'Wireframes');"
        "const bar = ganttMainBar(i);"
        "bar.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});"
        "document.querySelector('.gantt-chart-side').scrollLeft ="
        "  Math.max(0, parseFloat(bar.style.left) - 200);"
    )
    time.sleep(0.5)
    handle = driver.execute_script(
        "return ganttMainBar(ganttTasks.findIndex(t => t.name === 'Wireframes'))"
        ".querySelector('.gantt-bar-handle.right');"
    )
    if handle is not None:
        ActionChains(driver).click_and_hold(handle).move_by_offset(30, 0) \
            .move_by_offset(30, 0).move_by_offset(30, 0).pause(0.4).perform()
        capture_full(driver, section / "gv-03-gantt-drag.png")
        ActionChains(driver).send_keys(Keys.ESCAPE).release().perform()
        time.sleep(0.3)
    else:
        print("  [SKIP]    gv-03 -- Wireframes bar not found")

    # np-01: Notepad list view
    switch_to_view(driver, "notepad")
    capture_full(driver, section / "np-01-notepad-view.png")

    # kb-01: Kanban board (grouped by phase — the default)
    switch_to_view(driver, "kanban")
    capture_full(driver, section / "kb-01-kanban-phase.png")

    # tl-01: Timeline view
    switch_to_view(driver, "timeline")
    capture_full(driver, section / "tl-01-timeline.png")

    # cp-01: the editor pane, showing the front matter.
    #
    # An element shot of the left column rather than the whole window, for two
    # reasons. The figure is about the front matter, and at full-window scale
    # the panel it is pointing at is a third of the frame. And a full-window
    # shot here is defined by whatever the *right* pane happens to show, which
    # nothing in this function controls: switchTab() moves the editor's own
    # tab, not the view. Following tl-01 that produced a byte-identical copy of
    # the timeline figure; forcing the dashboard instead produced a
    # byte-identical copy of rs-01. The pane was never the subject.
    #
    # #frontMatterPanel alone would be tighter still, but the code below it is
    # worth keeping in frame: the point the page is making is that the panel
    # and the ``---`` block are two views of one thing.
    driver.execute_script(
        "if (typeof switchTab === 'function') switchTab('project');"
    )
    time.sleep(0.5)
    # Scroll editor to top to show front matter
    editor = driver.find_element(By.ID, "planEditor")
    driver.execute_script("arguments[0].scrollTop = 0;", editor)
    time.sleep(0.3)
    capture_element(driver, ".editor-panel", section / "cp-01-editor-frontmatter.png")

    # mr-01: Resource table view
    switch_to_view(driver, "resources")
    capture_full(driver, section / "mr-01-resource-table.png")

    # wb-01: the whiteboard as a whole — post-it notes, the noodles that
    # carry the plan's hierarchy, and the floating plan-structure panel.
    #
    # Two of the sample plan's four whiteboard rows deliberately name
    # *child* tasks ("Requirements gathering" under "Discovery &
    # Planning", "Wireframes" under "Design"): a noodle is only drawn when
    # both ends have a note, so a board of nothing but top-level phases
    # would show no noodles at all and the shot would not illustrate the
    # feature the page is describing.
    switch_to_view(driver, "whiteboard")
    driver.execute_script("if (typeof whiteboardZoomFit === 'function') whiteboardZoomFit();")
    time.sleep(0.6)
    capture_full(driver, section / "wb-01-whiteboard-notes.png")

    # wb-02: Note colour swatches (issue #849, palette replaced by #1017) —
    # select the first note and press Colour on the object toolbar above
    # it, so both the toolbar and the fixed pastel swatch grid are visible.
    colour_btn = driver.execute_script(
        """
        const first = document.querySelector('#whiteboardContainer .wb-note');
        if (!first || typeof wbSetSelectedNote !== 'function') return null;
        wbSetSelectedNote(first.dataset.wbTask);
        return typeof wbObjectToolbarButton === 'function' ? wbObjectToolbarButton('colour') : null;
        """
    )
    if colour_btn:
        colour_btn.click()
        time.sleep(0.4)
        capture_full(driver, section / "wb-02-note-colour-menu.png")
        driver.execute_script(
            "if (typeof wbCloseNoteMenu === 'function') wbCloseNoteMenu();"
        )
        time.sleep(0.2)

    # wb-04: the floating plan-structure panel on its own — the outline
    # the noodles build up, and the way to find a note again on a busy
    # board. Captured as an element shot so the panel's own detail (dots
    # marking which tasks are on the board, chevrons, the search box) is
    # legible rather than lost at full-page scale.
    capture_element(driver, "#whiteboardOutlinePanel", section / "wb-04-plan-structure.png")

    # wb-03: Task-peek popover (issue #850) — drilling into a subtask
    # that has its own children opens a lightweight popover rather than
    # the full task form. Needs a plan with a grandchild task, so this
    # loads its own small plan rather than reusing SAMPLE_PLAN.
    load_plan(driver, WHITEBOARD_PEEK_PLAN)
    wait_for_render(driver)
    switch_to_view(driver, "whiteboard")
    driver.execute_script("if (typeof whiteboardZoomFit === 'function') whiteboardZoomFit();")
    time.sleep(0.4)
    badge = driver.find_elements(By.CSS_SELECTOR, ".wb-note-count-badge")
    if badge:
        badge[0].click()
        time.sleep(0.4)
        capture_full(driver, section / "wb-03-task-peek.png")


def join_session(driver, base_url, code, name):
    """Open a new window and join the live planning session as *name*.

    Returns the window's handle, left as the current window. Each joiner is
    a separate window of the same browser, the way a PM running a session
    on one machine and a colleague on another look to the relay.
    """
    driver.switch_to.new_window("window")
    fit_viewport(driver)
    driver.get(f"{base_url}/join")
    WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "joinCode")))
    driver.find_element(By.ID, "joinCode").send_keys(code)
    driver.find_element(By.ID, "displayName").send_keys(name)
    driver.find_element(By.ID, "joinBtn").click()
    WebDriverWait(driver, 15).until(EC.visibility_of_element_located((By.ID, "relayInput")))
    # The host's plan arrives over the encrypted channel a moment after
    # `joined`; the board is drawn once it has.
    WebDriverWait(driver, 15).until(
        lambda d: d.execute_script(
            "return document.querySelectorAll('#whiteboardContainer .wb-note').length > 0;"
        )
    )
    return driver.current_window_handle


def send_joiner_chat(driver, text):
    """Send a chat message from the joiner window that is current.

    Enter only sends once the secure channel is up, and clears the box when
    it does -- so press it until the box empties.
    """
    box = driver.find_element(By.ID, "relayInput")
    box.send_keys(text)
    for _ in range(50):
        box.send_keys(Keys.ENTER)
        if not box.get_attribute("value"):
            return
        time.sleep(0.2)


def capture_planning_session(driver, base_url):
    """A live planning session, from both sides (docs/how-to/run-a-planning-session.rst).

    Everything here only exists once someone has joined -- the joiner page,
    the ribbon's participant chips, the session chat -- so this starts a
    session as the host, joins it from two more windows, and has them talk.

    ps-01  the joiner page: the host's whiteboard, and the chat beside it
    ps-02  the host's ribbon: who is in the session, one chip's card open
    ps-03  the host: the whiteboard with its parking lot open and the
           chat docked beside it rather than over it
    wb-05  a note mid-drag over the parking lot: drawn on top of the
           panel, a dotted outline where it will land
           (docs/how-to/use-the-whiteboard.rst)
    """
    section = IMG_ROOT / "how-to"
    print("\n--- Planning session ---")

    driver.get(base_url)
    load_plan(driver, SAMPLE_PLAN)
    wait_for_render(driver)
    switch_to_view(driver, "whiteboard")
    host = driver.current_window_handle

    driver.execute_script("startCollabSession();")
    WebDriverWait(driver, 15).until(
        lambda d: len(d.execute_script(
            "return document.getElementById('collabSessionCode').value;") or "") == 6
    )
    code = driver.execute_script("return document.getElementById('collabSessionCode').value;")
    # Tucked into the chat bubble, as a host working on the plan has it.
    driver.execute_script("minimiseCollabSessionModal();")
    time.sleep(0.6)

    joiners = []
    try:
        joiners.append(join_session(driver, base_url, code, "Priya Shah"))
        send_joiner_chat(driver, "Morning! Shall we start with the design notes?")
        joiners.append(join_session(driver, base_url, code, "Sam Lee"))

        # The host answers, so the conversation has both sides.
        driver.switch_to.window(host)
        driver.execute_script(
            "const box = document.getElementById('collabChatInput');"
            "box.value = 'Yes -- drag anything that can wait into the parking lot.';"
            "submitCollabChat();"
        )
        time.sleep(1)

        # ps-01: Priya's page -- her own message on the right, the host's
        # on the left, the host's board filling the rest.
        driver.switch_to.window(joiners[0])
        WebDriverWait(driver, 10).until(
            lambda d: d.execute_script(
                "return document.querySelectorAll('#relayLog .np-chat-message').length >= 2;")
        )
        driver.execute_script("if (typeof whiteboardZoomFit === 'function') whiteboardZoomFit();")
        time.sleep(0.6)
        capture_full(driver, section / "ps-01-joiner-board.png")

        # ps-02: the host's title bar, with Priya's chip hovered so its card
        # (name, presence, Open session chat) is showing.
        driver.switch_to.window(host)
        WebDriverWait(driver, 10).until(
            lambda d: d.execute_script(
                "const s = document.getElementById('ribbonCollabPeople');"
                "return !!s && s.shadowRoot.querySelectorAll('.chip').length === 2;")
        )
        chip = driver.execute_script(
            "return document.getElementById('ribbonCollabPeople').shadowRoot.querySelector('.chip');"
        )
        ActionChains(driver).move_to_element(chip).perform()
        time.sleep(0.4)
        capture_element(driver, "#ribbonShell", section / "ps-02-participant-chips.png")
        ActionChains(driver).move_by_offset(0, 400).perform()

        # ps-03: the chat docked beside the whiteboard, the parking lot open
        # and still in view. Docked, the board is narrow, so give it the
        # editor's width and put away the structure panel and the tips --
        # otherwise the panels cover every note -- then fit the notes into
        # the stretch the parking lot leaves.
        driver.execute_script(
            """
            const editor = document.querySelector('.editor-panel');
            window.__captureEditorWasOpen = !!editor && !editor.classList.contains('collapsed');
            if (window.__captureEditorWasOpen && typeof toggleMainEditor === 'function') toggleMainEditor();
            if (typeof wbToggleOutlinePanel === 'function') wbToggleOutlinePanel(false);
            if (typeof wbSetToolbarHintVisible === 'function') wbSetToolbarHintVisible(false);
            openCollabChatPanel();
            document.getElementById('collabChatDockBtn').click();
            if (typeof wbOpenParkingLotPanel === 'function') wbOpenParkingLotPanel();
            """
        )
        time.sleep(0.8)
        driver.execute_script(
            """
            if (typeof whiteboardZoomFit !== 'function') return;
            whiteboardZoomFit({ maxZoom: 1 });
            // Fit frames the whole canvas; shift the notes left of the panel.
            const panel = document.getElementById('wbParkingLotPanel');
            const board = document.getElementById('whiteboardContainer');
            if (panel && board && typeof wbPanX === 'number' && typeof wbApplyTransform === 'function') {
                const covered = board.getBoundingClientRect().right - panel.getBoundingClientRect().left;
                wbPanX -= covered / 2;
                wbApplyTransform(false);
            }
            """
        )
        time.sleep(0.6)
        capture_full(driver, section / "ps-03-docked-chat.png")

        # wb-05: hold a note over the open parking lot. Taken last, since
        # letting go would park it. Only a note whose header is actually
        # under the pointer can be picked up -- one under a panel would
        # start a text selection instead -- so find one that is.
        drag = driver.execute_script(
            """
            const panel = document.getElementById('wbParkingLotPanel');
            if (!panel) return null;
            const p = panel.getBoundingClientRect();
            for (const header of document.querySelectorAll('#whiteboardContainer .wb-note .wb-note-header')) {
                const h = header.getBoundingClientRect();
                const x = h.left + 12, y = h.top + h.height / 2;
                if (!header.contains(document.elementFromPoint(x, y))) continue;
                return {header, dx: (p.left + p.width / 2) - (h.left + h.width / 2),
                        dy: (p.top + p.height / 2) - (h.top + h.height / 2)};
            }
            return null;
            """
        )
        if drag:
            actions = ActionChains(driver).click_and_hold(drag["header"])
            for _ in range(10):
                actions.move_by_offset(drag["dx"] / 10, drag["dy"] / 10)
            actions.perform()
            time.sleep(0.4)
            capture_full(driver, section / "wb-05-parking-lot-drag.png")
            # Let go off the panel, so the note is moved rather than parked.
            ActionChains(driver).move_by_offset(-drag["dx"], -drag["dy"]).release().perform()
        else:
            print("  [SKIP]    wb-05 -- no note on screen to drag, or no parking lot panel")

        # Put the board back as the rest of the capture expects it.
        driver.execute_script(
            """
            if (typeof wbCloseParkingLotPanel === 'function') wbCloseParkingLotPanel();
            if (typeof closeCollabChatPanel === 'function') closeCollabChatPanel();
            if (typeof wbToggleOutlinePanel === 'function') wbToggleOutlinePanel(true);
            if (typeof wbSetToolbarHintVisible === 'function') wbSetToolbarHintVisible(true);
            if (window.__captureEditorWasOpen && typeof toggleMainEditor === 'function') toggleMainEditor();
            """
        )
    finally:
        for handle in joiners:
            driver.switch_to.window(handle)
            driver.close()
        driver.switch_to.window(host)
        driver.execute_script(
            "if (typeof endCollabSession === 'function') endCollabSession();"
        )
        time.sleep(0.4)


def capture_reference(driver, base_url):
    """Capture screenshots for the reference section."""
    section = IMG_ROOT / "reference"
    print("\n--- Reference ---")

    # Ensure plan is loaded and rendered
    driver.get(base_url)
    load_plan(driver, SAMPLE_PLAN)
    wait_for_render(driver)

    # ks-01: Keyboard shortcuts modal
    # Open via JS since the ? key needs a non-input context
    driver.execute_script("openShortcutsModal();")
    time.sleep(1)
    capture_full(driver, section / "ks-01-keyboard-shortcuts.png")
    # Close it
    driver.execute_script("closeShortcutsModal();")
    time.sleep(0.5)

    # vw-01: the ribbon's Views group.
    #
    # This replaces vw-01-subnav.png and vw-02-views-menu.png, which
    # photographed `#planSubnav` and the `#viewsDropdownBtn` dropdown inside
    # it. That bar computes to `display: none` now -- the ribbon took over
    # (#1045) -- so clicking the button raised ElementNotInteractableException
    # and the two files documented a UI the app no longer has. Re-capturing
    # them was never the fix; there is nothing there to photograph.
    #
    # The Views group on the Home tab is where those entries went, so that is
    # what the reference page shows instead. It does not hold all of them:
    # Mind Map and Whiteboard are under Plan > Model and Dashboard under
    # Home > Plan, which docs/reference/views.rst now says in prose rather
    # than implying one menu lists everything.
    switch_to_view(driver, "project-report")
    time.sleep(0.5)
    capture_element(
        driver,
        '.ribbon-group[data-group="Views"]',
        section / "vw-01-ribbon-views-group.png",
    )

    # vw-02: the ribbon's View tab -- Layout, Window and Help, including the
    # Help group's Tour button that replays the interface tour. The whole
    # shell rather than just the body, so the selected tab is in the shot.
    driver.execute_script(
        "document.querySelector('.ribbon-tab-btn[data-tab=\"view\"]').click();"
    )
    time.sleep(0.5)
    capture_element(driver, "#ribbonShell", section / "vw-02-ribbon-view-tab.png")
    driver.execute_script(
        "document.querySelector('.ribbon-tab-btn[data-tab=\"home\"]').click();"
    )
    time.sleep(0.3)

    # pq-01: the Analysis view's Plan review (#782), after the review has
    # come back from /api/analyse.
    switch_to_view(driver, "analysis")
    try:
        WebDriverWait(driver, 10).until(
            lambda d: d.execute_script(
                "return !!document.querySelector('#planReview .plan-review-score');"
            )
        )
    except TimeoutException:
        print("  [SKIP]    pq-01 -- the plan review did not load")
    else:
        capture_element(driver, "#planReview", section / "pq-01-plan-review.png")


def capture_explanation(driver, base_url):
    """Capture screenshots for the explanation section."""
    section = IMG_ROOT / "explanation"
    print("\n--- Explanation ---")

    # Ensure plan is loaded and rendered (plan has status: Amber)
    driver.get(base_url)
    load_plan(driver, SAMPLE_PLAN)
    wait_for_render(driver)

    # rs-01: Dashboard showing RAG status
    switch_to_view(driver, "project-report")
    capture_full(driver, section / "rs-01-rag-dashboard.png")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Capture NoodlePlanner screenshots for documentation."
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"URL of the running NoodlePlanner instance (default: {DEFAULT_BASE_URL})",
    )
    args = parser.parse_args()

    print(f"Capturing screenshots from {args.base_url}")
    print(f"Saving to {IMG_ROOT}")

    driver = create_driver()
    try:
        capture_tutorials(driver, args.base_url)
        capture_how_to(driver, args.base_url)
        capture_planning_session(driver, args.base_url)
        capture_reference(driver, args.base_url)
        capture_explanation(driver, args.base_url)
        print("\nDone. All screenshots saved.")
    finally:
        driver.quit()

    return report_duplicates()


def report_duplicates():
    """Name any two figures that came out byte-identical.

    A capture that fails to change the view does not raise -- it just shoots
    whatever is still on screen, and the result is a plausible-looking image
    filed under the wrong name. That is how cp-01 came back as a second copy
    of tl-01. Two identical files are never intentional here, so say so and
    exit non-zero rather than leaving it to be noticed in review.
    """
    by_digest = {}
    for path in sorted(IMG_ROOT.rglob("*.png")):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        by_digest.setdefault(digest, []).append(path.relative_to(IMG_ROOT))

    clashes = [group for group in by_digest.values() if len(group) > 1]
    if not clashes:
        return 0
    print("\nIdentical captures — a view switch did not take effect:")
    for group in clashes:
        print("  " + "  ==  ".join(str(x) for x in group))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
