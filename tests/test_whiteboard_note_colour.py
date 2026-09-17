"""Selenium-driven browser tests for the whiteboard note colour menu
(issue #849): the `...` button's open/close/keyboard behaviour, picking
and clearing a swatch, the row-Colour -> Theme: -> derived-palette
precedence actually taking effect in the rendered DOM, colour following a
task through a Kanban-style rename, and WCAG AA contrast on real rendered
elements in both themes.

Follows the same self-contained app_server/browser fixture pattern as
tests/test_whiteboard_notes.py (#846) and tests/test_whiteboard_canvas.py
(#845). The pure precedence/contrast math itself is already covered by
tests/test_whiteboard_notes.js and the Theme:/Colour write-path round trip
by tests/test_note_colour_writer.mjs; this file is only for what those
can't reach: the real menu DOM, real focus/keyboard behaviour, and the
real rendered colours.

Usage:
    uv run pytest tests/test_whiteboard_note_colour.py -x -q
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
title: Whiteboard Note Colour Test Plan
Theme:
- Discovery: #4A90D9
---

Phase 1
  Discovery
    Research @sam 2d 100%
    Interviews @sam 2d
  Build
    Ship Widget $Widget @sam 3d 100%

---whiteboard---
| Task      | X   | Y  | Colour | Width | Height | Collapsed |
|-----------|-----|----|--------|-------|--------|-----------|
| Discovery | 120 | 80 |        | 280   | 240    | no        |
| Build     | 480 | 80 |        | 280   | 260    | no        |
"""

RENAME_PLAN = """---
title: Whiteboard Note Colour Rename Test Plan
Theme:
- Phase Alpha: #223344
---

Phase Alpha
  Task 1 3d

---whiteboard---
| Task        | X   | Y  | Colour | Width | Height | Collapsed |
|-------------|-----|----|--------|-------|--------|-----------|
| Phase Alpha | 120 | 80 |        | 280   | 240    | no        |
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


# ── Shared helpers (mirrors test_whiteboard_notes.py) ──────────────────


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
    wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.5)


def switch_to_whiteboard(driver):
    driver.execute_script("switchToView('whiteboard');")
    WebDriverWait(driver, 5).until(
        EC.visibility_of_element_located((By.ID, "whiteboardContainer"))
    )
    time.sleep(0.4)


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


def menu_btn_for(driver, task_name):
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask === arguments[0]) return n.querySelector('.wb-note-menu-btn');
        }
        return null;
        """,
        task_name,
    )


def open_menu(driver, task_name):
    btn = menu_btn_for(driver, task_name)
    assert btn is not None, f"no note (or no menu button) found for {task_name}"
    btn.click()
    WebDriverWait(driver, 3).until(
        EC.presence_of_element_located((By.ID, "wbNoteMenu"))
    )
    return driver.find_element(By.ID, "wbNoteMenu")


def pick_swatch(driver, task_name, colour_hex):
    open_menu(driver, task_name)
    swatch = driver.execute_script(
        """
        const menu = document.getElementById('wbNoteMenu');
        const target = arguments[0].toUpperCase();
        return Array.from(menu.querySelectorAll('.wb-note-menu-swatch'))
            .find(b => b.title.toUpperCase() === target) || null;
        """,
        colour_hex,
    )
    assert swatch is not None, f"no swatch button found for {colour_hex}"
    swatch.click()


def pick_default(driver, task_name):
    open_menu(driver, task_name)
    driver.find_element(By.CSS_SELECTOR, "#wbNoteMenu .wb-note-menu-default").click()


def header_for(driver, task_name):
    """One note's `.wb-note-header` element -- issue #1109's selection is
    set by clicking anywhere on this (the same drag handle #848 wired)."""
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask === arguments[0]) return n.querySelector('.wb-note-header');
        }
        return null;
        """,
        task_name,
    )


def is_note_selected(driver, task_name):
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask !== arguments[0]) continue;
            return n.querySelector('.wb-note-card').classList.contains('wb-note-selected');
        }
        return false;
        """,
        task_name,
    )


def note_header_style(driver, task_name):
    """{background, color} computed style of one note's header, plus the
    --wb-note-accent custom property on its card and the card's own
    computed background. Issue #1103 deliberately leaves the header
    transparent, so tests that care about what colour the title *renders
    on* should use effectiveBackground/cardBackground rather than the
    header's own raw backgroundColor."""
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask !== arguments[0]) continue;
            const card = n.querySelector('.wb-note-card');
            const header = n.querySelector('.wb-note-header');
            const style = getComputedStyle(header);
            function effectiveBackground(el) {
                for (let cur = el; cur; cur = cur.parentElement) {
                    const bg = getComputedStyle(cur).backgroundColor;
                    if (bg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) return bg;
                }
                return getComputedStyle(document.body).backgroundColor;
            }
            return {
                background: style.backgroundColor,
                color: style.color,
                accent: card.style.getPropertyValue('--wb-note-accent'),
                cardBackground: getComputedStyle(card).backgroundColor,
                effectiveBackground: effectiveBackground(header),
            };
        }
        return null;
        """,
        task_name,
    )


def rgb_to_hex(rgb_string):
    """'rgb(74, 144, 217)' -> '#4A90D9'."""
    nums = [int(n) for n in rgb_string.strip("rgba()").split(",")[:3]]
    return "#" + "".join(f"{n:02X}" for n in nums)


def contrast_ratio(driver, hex_a, hex_b):
    """Delegate to the app's own real wbContrastRatio() (not a re-derived
    Python copy), so this test can never silently disagree with the code
    it is meant to be checking."""
    return driver.execute_script(
        "return wbContrastRatio(arguments[0], arguments[1]);", hex_a, hex_b
    )


# ── Tests ────────────────────────────────────────────────────────────────


class TestNoteMenuOpenClose:
    def test_menu_button_exists_and_starts_closed(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = menu_btn_for(browser, "Discovery")
        assert btn is not None
        assert btn.get_attribute("aria-haspopup") == "true"
        assert btn.get_attribute("aria-expanded") == "false"
        assert browser.find_elements(By.ID, "wbNoteMenu") == []

    def test_click_opens_menu_with_colour_swatches(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = menu_btn_for(browser, "Discovery")
        menu = open_menu(browser, "Discovery")
        assert btn.get_attribute("aria-expanded") == "true"
        swatches = menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-swatch")
        assert len(swatches) > 0, "the menu must offer at least one colour swatch"
        assert menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-default"), \
            "a default/no-colour option must be present"

    def test_click_again_toggles_menu_closed(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = menu_btn_for(browser, "Discovery")
        open_menu(browser, "Discovery")
        btn.click()
        WebDriverWait(browser, 3).until_not(
            lambda d: d.find_elements(By.ID, "wbNoteMenu")
        )
        assert btn.get_attribute("aria-expanded") == "false"

    def test_escape_closes_menu_and_refocuses_button(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = menu_btn_for(browser, "Discovery")
        open_menu(browser, "Discovery")
        browser.switch_to.active_element.send_keys(Keys.ESCAPE)
        WebDriverWait(browser, 3).until_not(
            lambda d: d.find_elements(By.ID, "wbNoteMenu")
        )
        active = browser.execute_script("return document.activeElement.className;")
        assert "wb-note-menu-btn" in active, "focus must return to the `...` button on Escape"

    def test_outside_click_closes_menu(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_menu(browser, "Discovery")
        # A real Selenium click resolves by screen geometry and can land on
        # the menu itself if it happens to overlap the target element at
        # that point; dispatch the mousedown directly on <body> instead, so
        # this test exercises wbNoteMenuOutsideClick()'s own e.target check
        # rather than depending on where the menu happens to be positioned.
        browser.execute_script(
            "document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));"
        )
        WebDriverWait(browser, 3).until_not(
            lambda d: d.find_elements(By.ID, "wbNoteMenu")
        )

    def test_arrow_keys_move_focus_between_swatches(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_menu(browser, "Discovery")
        first_item = browser.execute_script(
            "return document.activeElement.getAttribute('role');"
        )
        assert first_item == "menuitem", "opening the menu focuses its first item"

        # Issue #1247: swatches are `menuitemradio`, not `menuitem` carrying
        # `aria-checked` -- which is not a supported combination, so the
        # selected colour was never announced. Collect both roles.
        browser.switch_to.active_element.send_keys(Keys.ARROW_DOWN)
        second_active = browser.execute_script(
            """
            const menu = document.getElementById('wbNoteMenu');
            const items = Array.from(menu.querySelectorAll(
                '[role="menuitem"], [role="menuitemradio"]'));
            return {
                index: items.indexOf(document.activeElement),
                role: document.activeElement.getAttribute('role'),
            };
            """
        )
        assert second_active["index"] == 1, "ArrowDown must move focus to the next menu item"
        assert second_active["role"] == "menuitemradio", \
            "the item after 'Default colour' is the first swatch"


class TestNoteColourPrecedenceAndPersistence:
    def test_picking_a_swatch_recolours_the_note_immediately(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before = note_header_style(browser, "Build")
        pick_swatch(browser, "Build", "#FFAFA3")
        after = note_header_style(browser, "Build")

        assert after["accent"].upper() == "#FFAFA3", \
            "the accent bar takes the raw swatch colour right away, before the debounced commit lands"
        # Issue #1103: the header itself is transparent -- the whole card
        # carries the colour -- so the effective rendered background the
        # header text sits on is the card's fill underneath it.
        assert after["cardBackground"] != before["cardBackground"]
        assert after["effectiveBackground"] == after["cardBackground"], \
            "the header must show the card's colour through it, not a background of its own"

    def test_picking_a_swatch_persists_to_theme_front_matter(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        pick_swatch(browser, "Build", "#FFAFA3")
        after = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "- Build: #FFAFA3" in after, after
        assert "- Discovery: #4A90D9" in after, "an unrelated Theme: entry must survive untouched"

    def test_clearing_returns_to_derived_palette_and_leaves_no_residue(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        pick_swatch(browser, "Build", "#FFAFA3")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        pick_default(browser, "Build")
        after = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "Build: #FFAFA3" not in after
        assert "- Build:" not in after, "clearing must remove the Theme: entry, not blank it"

        style = note_header_style(browser, "Build")
        assert style["accent"], "a colour (the derived palette fallback) is always applied -- never blank"

    def test_kanban_style_theme_colour_shows_on_the_whiteboard(self, browser, app_server):
        # SAMPLE_PLAN already declares `Theme:\n- Discovery: #4A90D9`,
        # simulating a colour set from the Kanban board (tier 2 of the
        # precedence) before the whiteboard was ever opened.
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        style = note_header_style(browser, "Discovery")
        assert style["accent"].upper() == "#4A90D9", \
            "a Theme:-sourced colour (as Kanban would write) must show on the whiteboard note"

    def test_whiteboard_row_colour_overrides_theme_entry(self, browser, app_server):
        plan = SAMPLE_PLAN.replace(
            "| Discovery | 120 | 80 |        | 280   | 240    | no        |",
            "| Discovery | 120 | 80 | #1C9E41 | 280   | 240    | no        |",
        )
        open_app(browser, app_server)
        load_plan(browser, plan)
        switch_to_whiteboard(browser)

        style = note_header_style(browser, "Discovery")
        assert style["accent"].upper() == "#1C9E41", \
            "a hand-set whiteboard-row Colour (tier 1) must still win over the Theme: entry (tier 2)"


class TestNoteSolidColour:
    """Issue #1103: a post-it note is one uniform colour block -- the
    title area must not render a different colour from the body/footer,
    and that colour must fill the entire card, not just a left accent
    bar."""

    def test_header_and_card_share_the_same_background(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        pick_swatch(browser, "Build", "#FFAFA3")
        style = note_header_style(browser, "Build")

        # The header paints no colour of its own (transparent) -- the
        # card's fill shows straight through it, which is exactly how the
        # header ends up the same colour as the rest of the note.
        assert style["background"] == "rgba(0, 0, 0, 0)", \
            f"the header must be transparent, not tint itself separately (got {style['background']!r})"
        assert rgb_to_hex(style["cardBackground"]) == "#FFAFA3", \
            "the card itself must be filled with the raw picked swatch colour"


class TestNoteColourRename:
    def test_renaming_a_summary_task_carries_its_colour(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, RENAME_PLAN)
        switch_to_whiteboard(browser)

        before_style = note_header_style(browser, "Phase Alpha")
        assert before_style["accent"].upper() == "#223344"

        browser.execute_script(
            """
            window.prompt = function() { return 'Phase Beta'; };
            kanbanBoard.parse();
            kanbanBoard.renamePhase('Phase Alpha');
            """
        )
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        time.sleep(0.3)

        after_text = get_plan_text(browser)
        assert "- Phase Beta: #223344" in after_text
        assert "Phase Alpha" not in after_text

        renamed_style = note_header_style(browser, "Phase Beta")
        assert renamed_style is not None, "the note must re-render under the new task name"
        assert renamed_style["accent"].upper() == "#223344", \
            "the colour must follow the task through the rename"


class TestNoteColourContrast:
    """Programmatic WCAG AA contrast checks against the *real* rendered
    header, in both themes, for every swatch the menu offers -- not an
    eyeballed screenshot.

    Issue #1017 replaced the three swatch grids #849 offered (a saturated
    "Palette" plus the boards view's own "Pastel"/"Dark" conditional-
    formatting swatches) with a single fixed pastel palette dedicated to
    whiteboard notes -- wbPalette() alone is now the complete swatch list
    the menu offers, so that's the only source this test needs.
    """

    def _swatch_hexes(self, driver):
        return driver.execute_script("return wbPalette();")

    def _assert_all_swatches_meet_aa(self, driver, task_name):
        for colour in self._swatch_hexes(driver):
            pick_swatch(driver, task_name, colour)
            style = note_header_style(driver, task_name)
            # Issue #1103: the header is transparent -- its own computed
            # background is meaningless -- the card underneath is what
            # actually paints the colour the header text sits on.
            bg_hex = rgb_to_hex(style["cardBackground"])
            text_hex = rgb_to_hex(style["color"])
            ratio = contrast_ratio(driver, bg_hex, text_hex)
            assert ratio >= 4.5, (
                f"{colour} -> header bg {bg_hex} / text {text_hex} only reaches "
                f"{ratio:.2f}:1, below WCAG AA (4.5:1)"
            )

    def test_every_swatch_meets_aa_contrast_in_light_mode(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)
        browser.execute_script("document.documentElement.setAttribute('data-theme', 'light');")

        self._assert_all_swatches_meet_aa(browser, "Build")

    def test_every_swatch_meets_aa_contrast_in_dark_mode(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)
        browser.execute_script("document.documentElement.setAttribute('data-theme', 'dark');")

        self._assert_all_swatches_meet_aa(browser, "Build")

    # ── Past the header (issue #1250) ────────────────────────────────────
    #
    # Everything above measures one element: `.wb-note-header`'s computed
    # colour against the card's fill. That left the rest of the card
    # unscored, and five separate `opacity` declarations were quietly
    # dimming --wb-note-text below its threshold over the same fill --
    # the empty state at 4.29:1, the add-row placeholder at 3.31:1 and the
    # add "+" glyph at 2.58:1, none of which any test or either design gate
    # could see. They are one two-step ink ladder now
    # (--wb-note-ink-muted / --wb-note-ink-faint, views/whiteboard.css),
    # and this is the assertion that keeps them honest on the real render.
    #
    # Composited rather than nominal, because the ladder is
    # `color-mix(... transparent)`: getComputedStyle hands back a colour
    # with an alpha channel, and scoring that raw would report a 70% ink as
    # if it were opaque -- exactly the mistake that made the old `opacity`
    # values look fine.

    # (selector, minimum, what). 4.5:1 is WCAG AA for text; 3:1 is SC
    # 1.4.11 for a non-text glyph or control boundary.
    CARD_ELEMENTS = [
        (".wb-note-title", 4.5, "the note title"),
        (".wb-note-row-name", 4.5, "a checklist row's task name"),
        (".wb-note-progress", 4.5, "the footer's progress count"),
        (".wb-note-add-input", 4.5, "the add row's input"),
    ]

    def _composited_ratio(self, driver, task_name, selector, prop="color"):
        return driver.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== arguments[0]) continue;
                const card = n.querySelector('.wb-note-card');
                const el = card.querySelector(arguments[1]);
                if (!el) return null;
                const parse = (s) => {
                    const v = String(s).match(/[\d.]+/g).map(Number);
                    return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
                };
                const chan = (c) => {
                    const x = c / 255;
                    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
                };
                const lum = (c) =>
                    0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
                const bg = parse(getComputedStyle(card).backgroundColor);
                const raw = parse(getComputedStyle(el).getPropertyValue(arguments[2]));
                const fg = {
                    r: raw.r * raw.a + bg.r * (1 - raw.a),
                    g: raw.g * raw.a + bg.g * (1 - raw.a),
                    b: raw.b * raw.a + bg.b * (1 - raw.a),
                };
                const [hi, lo] = lum(fg) > lum(bg)
                    ? [lum(fg), lum(bg)] : [lum(bg), lum(fg)];
                return (hi + 0.05) / (lo + 0.05);
            }
            return null;
            """,
            task_name,
            selector,
            prop,
        )

    def _assert_card_elements_meet_threshold(self, driver, task_name):
        for colour in self._swatch_hexes(driver):
            pick_swatch(driver, task_name, colour)
            for selector, minimum, what in self.CARD_ELEMENTS:
                ratio = self._composited_ratio(driver, task_name, selector)
                if ratio is None:
                    continue  # not rendered on this note -- nothing to score
                assert ratio >= minimum, (
                    f"{colour} -> {what} ({selector}) reaches only {ratio:.2f}:1, "
                    f"below its {minimum}:1 threshold"
                )

    def test_card_elements_meet_their_threshold_in_light_mode(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)
        browser.execute_script("document.documentElement.setAttribute('data-theme', 'light');")

        self._assert_card_elements_meet_threshold(browser, "Build")

    def test_card_elements_meet_their_threshold_in_dark_mode(self, browser, app_server):
        # The one that mattered most: --np-text-muted, which four of these
        # elements used to take, resolves to #C0B6A6 in dark mode and
        # measures 1.07:1 on #F7A8B8. A theme token on a note fill.
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)
        browser.execute_script("document.documentElement.setAttribute('data-theme', 'dark');")

        self._assert_card_elements_meet_threshold(browser, "Build")


class TestFixedPastelPalette:
    """Issue #1017: the menu offers exactly one fixed pastel palette --
    not #849's three grids (a saturated "Palette" plus the boards view's
    own "Pastel"/"Dark" conditional-formatting swatches)."""

    def test_menu_offers_only_the_fixed_pastel_palette(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        menu = open_menu(browser, "Discovery")
        swatch_titles = [
            s.get_attribute("title")
            for s in menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-swatch")
        ]
        expected = browser.execute_script("return wbPalette();")

        assert sorted(t.upper() for t in swatch_titles) == sorted(c.upper() for c in expected), (
            "the menu's swatches must be exactly wbPalette() -- no leftover "
            "conditional-formatting or mind-map colours"
        )
        assert len(menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-grid")) == 1, \
            "a single pastel grid replaces #849's three (Palette/Pastel/Dark) grids"

    def test_palette_is_pastel_not_saturated(self, browser, app_server):
        # A crude but effective "is this actually pastel" check: every
        # swatch must be high-lightness (HSL L well above 50%), unlike the
        # old saturated MM_BRANCH_COLOURS palette (e.g. #4A90D9).
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        lightness_values = browser.execute_script(
            """
            return wbPalette().map(function(hex) {
                const r = parseInt(hex.slice(1, 3), 16) / 255;
                const g = parseInt(hex.slice(3, 5), 16) / 255;
                const b = parseInt(hex.slice(5, 7), 16) / 255;
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                return (max + min) / 2;
            });
            """
        )
        assert all(l >= 0.75 for l in lightness_values), (
            f"every swatch should read as genuinely pastel (high lightness), got {lightness_values}"
        )


class TestNoteColourBackwardCompatibility:
    """Issue #1017's explicit backward-compatibility requirement: a colour
    value set before the fixed pastel palette existed (e.g. a Theme: entry
    picked from #849's old MM_BRANCH_COLOURS/CF_* grids, or a hand-edited
    hex in the row's own Colour column) must keep rendering with SOME
    colour rather than breaking, even though it no longer matches any
    swatch the menu currently offers."""

    def test_old_theme_colour_outside_the_new_palette_still_renders(self, browser, app_server):
        # SAMPLE_PLAN's `Theme:\n- Discovery: #4A90D9` is exactly this case:
        # a saturated colour that predates #1017's pastel palette.
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        style = note_header_style(browser, "Discovery")
        assert style["accent"].upper() == "#4A90D9", \
            "an old, non-pastel Theme: colour must still render as-is, not be remapped or dropped"
        assert rgb_to_hex(style["cardBackground"]) == "#4A90D9", \
            "the card must still get a real background colour"

        # Opening the menu on this note must not error, and since #4A90D9
        # isn't one of the new swatches, none should show as selected.
        menu = open_menu(browser, "Discovery")
        selected = menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-swatch.selected")
        assert selected == [], \
            "an old colour outside the new palette must not falsely match one of its swatches"

    def test_hand_set_row_colour_outside_the_new_palette_still_renders(self, browser, app_server):
        # A hand-edited whiteboard-row Colour is tier 1 of the precedence
        # and always wins; it can be any hex, old palette or new.
        plan = SAMPLE_PLAN.replace(
            "| Build     | 480 | 80 |        | 280   | 260    | no        |",
            "| Build     | 480 | 80 | #123456 | 280   | 260    | no        |",
        )
        open_app(browser, app_server)
        load_plan(browser, plan)
        switch_to_whiteboard(browser)

        style = note_header_style(browser, "Build")
        assert style["accent"].upper() == "#123456"
        bg_hex = rgb_to_hex(style["cardBackground"])
        text_hex = rgb_to_hex(style["color"])
        ratio = contrast_ratio(browser, bg_hex, text_hex)
        assert ratio >= 4.5, \
            "even an arbitrary hand-set colour must still get a legible header via wbContrastTextColour()"


class TestSelectedNoteColourButton:
    """Issue #1109: the ribbon's whiteboard "Colour" button -- previously
    an unwired stub (clicking it just showed "not available yet") -- opens
    the currently *selected* note's colour panel, the same `...` menu
    wbOpenNoteMenu() builds for a note's own button. Exercises the
    selection/action functions directly (wbGetSelectedNoteTask(),
    wbOpenColourPanelForSelectedNote()) rather than the ribbon's own DOM,
    which test_ribbon_action_coverage.mjs already confirms wires
    'whiteboard:Colour' to these."""

    def test_clicking_a_note_selects_it(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        assert browser.execute_script("return wbGetSelectedNoteTask();") is None
        header_for(browser, "Build").click()

        assert is_note_selected(browser, "Build")
        assert browser.execute_script("return wbGetSelectedNoteTask();") == "Build"

    def test_selecting_a_second_note_deselects_the_first(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        header_for(browser, "Build").click()
        header_for(browser, "Discovery").click()

        assert not is_note_selected(browser, "Build")
        assert is_note_selected(browser, "Discovery")
        assert browser.execute_script("return wbGetSelectedNoteTask();") == "Discovery"

    def test_clicking_bare_canvas_deselects(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        header_for(browser, "Build").click()
        assert browser.execute_script("return wbGetSelectedNoteTask();") == "Build"

        # Same bare-canvas mousedown TestNoteMenuOpenClose's outside-click
        # test uses to close a note's own menu -- whiteboard.js's
        # wbHandleMouseDown() clears the selected note the same way it
        # already clears the selected noodle.
        browser.execute_script(
            """
            const svg = document.querySelector('#whiteboardContainer svg');
            svg.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
            """
        )
        assert browser.execute_script("return wbGetSelectedNoteTask();") is None
        assert not is_note_selected(browser, "Build")

    def test_colour_button_opens_selected_notes_menu(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        header_for(browser, "Build").click()
        browser.execute_script("wbOpenColourPanelForSelectedNote(document.getElementById('whiteboardZoomInBtn'));")

        menu = WebDriverWait(browser, 3).until(
            EC.presence_of_element_located((By.ID, "wbNoteMenu"))
        )
        swatches = menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-swatch")
        assert swatches, "must be the same colour-swatch panel a note's own `...` menu opens"

        # And it must be *Build*'s panel, not some other note's -- picking a
        # swatch here (straight from this already-open menu -- reopening it
        # via pick_swatch()'s own open_menu() would instead *toggle it
        # closed*, since menuBtn's click handler treats a second click on
        # the same already-open task as "close") should recolour Build.
        target = next(s for s in swatches if s.get_attribute("title").upper() == "#FFAFA3")
        target.click()
        style = note_header_style(browser, "Build")
        assert style["accent"].upper() == "#FFAFA3"

    def test_colour_button_with_nothing_selected_explains_itself(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        assert browser.execute_script("return wbGetSelectedNoteTask();") is None
        browser.execute_script("wbOpenColourPanelForSelectedNote(document.getElementById('whiteboardZoomInBtn'));")

        # Check the message *before* the no-menu-opened check: the message
        # auto-hides itself after a few seconds (wbFlashNoodleMessage()),
        # and find_elements() for an id that genuinely doesn't exist blocks
        # for the driver's full implicit wait -- long enough, on its own,
        # to race past that auto-hide and make this flaky/order-sensitive.
        message = WebDriverWait(browser, 3).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, ".wb-noodle-message"))
        )
        assert message.text.strip(), \
            "must explain what to do (per the issue's own acceptance criterion) rather than silently no-op"
        assert browser.execute_script("return document.getElementById('wbNoteMenu') === null;"), \
            "nothing is selected -- no colour panel should open"
