"""Selenium-driven browser tests for the Warm Paper + Marigold visual system (#998).

PR #1067 shipped the semantic ``--np-*`` token architecture for #998 but had to
build an *interim* identity from the app's own brand palette, because the design
handoff was unreachable at the time; its description asks for the approved token
values to be swapped in once available. ``static/visual-system.css`` is that
swap, loaded last so it wins the cascade over the token defaults in
``dark-mode.css``.

Because everything downstream consumes tokens rather than literal colours, the
risk of that swap is not "does a colour change" -- it is the three things that
only break once the *hue* and the *typeface* change:

  * the palette actually being the approved one, in both themes;
  * text on the accent staying legible. The old accent was a mid blue, so ~50
    rules across the app pair an accent background with ``color: #fff``.
    Marigold is a light accent: white on it is 1.87:1, far below WCAG AA. The
    contrast test below is what stops that regressing;
  * the plan editor's textarea and its syntax-highlight overlay keeping
    identical text metrics. They are two stacked elements whose glyphs must
    land on exactly the same pixels, so a font-family change is precisely the
    kind of edit that silently desyncs them.

Follows the same self-contained app_server/browser fixture pattern as
tests/test_ribbon_simple_view.py.

Usage:
    uv run pytest tests/test_visual_system.py -x -q
"""

import glob
import os
import socket
import threading
import time

import pytest

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
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

# The approved palette's anchor values, light theme. Deliberately asserted as
# literals: this is the one place in the codebase where a colour *is* the
# specification, so a token quietly reverting to the #1067 interim identity
# should fail here rather than only being noticed by eye.
APPROVED_LIGHT = {
    "--np-paper": "#faf8f4",
    "--np-surface": "#fffdf9",
    "--np-accent": "#edb52a",
    "--np-accent-ink": "#8a6205",
}

APPROVED_FONTS = ["Newsreader", "Instrument Sans", "IBM Plex Mono"]

# Foreground/background token pairs that carry small text, and so must meet
# WCAG AA (4.5:1) in both themes.
CONTRAST_PAIRS = [
    ("ink", "surface"),
    ("body", "paper"),
    ("faint", "paper"),
    ("muted", "surface-alt"),
    ("accent-ink", "accent-tint"),
    ("sage-ink", "sage-tint"),
    ("danger-ink", "danger-tint"),
    ("on-accent", "accent"),
]


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

    binary_candidates = [
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        *sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")),
    ]
    for path in binary_candidates:
        if os.path.exists(path):
            options.binary_location = path
            break

    for drv_path in ("/usr/bin/chromedriver", "/opt/node22/bin/chromedriver"):
        if os.path.exists(drv_path):
            try:
                return webdriver.Chrome(service=ChromeService(drv_path), options=options)
            except WebDriverException:
                continue

    try:
        return webdriver.Chrome(options=options)
    except WebDriverException:
        pytest.skip("Chrome/chromedriver not available on this system")


@pytest.fixture(scope="module")
def browser():
    driver = _create_chrome_driver()
    driver.implicitly_wait(3)
    yield driver
    driver.quit()


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


def set_theme(driver, theme):
    """Set the theme the way the app itself does, then let the swap settle."""
    driver.execute_script(
        "localStorage.setItem('np-theme-choice', arguments[0]);"
        "if (arguments[0] === 'dark') document.documentElement.setAttribute('data-theme', 'dark');"
        "else document.documentElement.removeAttribute('data-theme');",
        theme,
    )
    time.sleep(0.2)


def token(driver, name):
    return driver.execute_script(
        "return getComputedStyle(document.documentElement).getPropertyValue(arguments[0]).trim();",
        name,
    )


def _relative_luminance(hex_colour):
    value = hex_colour.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    channels = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return sum(v * w for v, w in zip(linear, (0.2126, 0.7152, 0.0722)))


def contrast(fg_hex, bg_hex):
    a, b = _relative_luminance(fg_hex), _relative_luminance(bg_hex)
    lighter, darker = max(a, b), min(a, b)
    return (lighter + 0.05) / (darker + 0.05)


class TestApprovedPalette:
    def test_light_palette_is_the_approved_one(self, browser, app_server):
        open_app(browser, app_server)
        set_theme(browser, "light")
        actual = {name: token(browser, name).lower() for name in APPROVED_LIGHT}
        assert actual == APPROVED_LIGHT

    def test_dark_theme_keeps_the_marigold_accent_and_warms_the_surfaces(self, browser, app_server):
        open_app(browser, app_server)
        set_theme(browser, "dark")
        # The accent is deliberately identical in both themes -- it is the
        # brand colour, not a surface -- which is also why --np-on-accent
        # stays dark in dark mode.
        assert token(browser, "--np-accent").lower() == "#edb52a"
        assert token(browser, "--np-on-accent").lower() == "#23201c"
        # Surfaces invert to warm near-blacks rather than neutral greys.
        paper = token(browser, "--np-paper").lstrip("#")
        r, g, b = (int(paper[i:i + 2], 16) for i in (0, 2, 4))
        assert _relative_luminance("#" + paper) < 0.05, "dark paper must be dark"
        assert r >= g >= b, f"dark paper should stay warm (r>=g>=b), got #{paper}"
        set_theme(browser, "light")

    def test_approved_typefaces_are_declared_and_fetchable(self, browser, app_server):
        """Each approved family must actually resolve to a downloadable webfont.

        Checked with document.fonts.load() rather than a bare check(): the
        stylesheet is loaded lazily per family, so a face nothing on the
        current screen happens to use (IBM Plex Mono, until a plan with
        durations is rendered) is legitimately "not loaded yet" without being
        misconfigured. load() forces the fetch, so a typo in the family name
        or a family missing from the Google Fonts URL still fails here.
        """
        open_app(browser, app_server)
        browser.execute_async_script("document.fonts.ready.then(arguments[0])")
        missing = []
        for family in APPROVED_FONTS:
            loaded = browser.execute_async_script(
                'const done = arguments[arguments.length - 1];'
                'document.fonts.load(`400 12px "${arguments[0]}"`)'
                '  .then(faces => done(faces.length > 0))'
                '  .catch(() => done(false));',
                family,
            )
            if not loaded:
                missing.append(family)
        assert not missing, f"webfont families not declared/fetchable: {missing}"

    def test_the_three_typefaces_are_wired_to_their_roles(self, browser, app_server):
        """Loading a face is not the same as using it -- assert each token
        actually carries the approved family at the front of its stack."""
        open_app(browser, app_server)
        stacks = browser.execute_script(
            "const s = getComputedStyle(document.documentElement);"
            "return ['--np-font-heading','--np-font-ui','--np-font-data']"
            "  .map(k => s.getPropertyValue(k).trim());"
        )
        heading, ui, data = stacks
        assert heading.startswith("'Newsreader'") or heading.startswith('"Newsreader"'), heading
        assert "Instrument Sans" in ui.split(",")[0], ui
        assert "IBM Plex Mono" in data.split(",")[0], data
        # Every stack must keep a real fallback, so an offline load degrades
        # rather than rendering in whatever the browser defaults to.
        for stack in stacks:
            assert len(stack.split(",")) > 1, f"no fallback in font stack: {stack}"


class TestContrast:
    def test_small_text_token_pairs_meet_aa_in_both_themes(self, browser, app_server):
        open_app(browser, app_server)
        failures = []
        for theme in ("light", "dark"):
            set_theme(browser, theme)
            for fg, bg in CONTRAST_PAIRS:
                fg_hex, bg_hex = token(browser, f"--np-{fg}"), token(browser, f"--np-{bg}")
                assert fg_hex and bg_hex, f"--np-{fg}/--np-{bg} undefined in {theme}"
                ratio = contrast(fg_hex, bg_hex)
                if ratio < 4.5:
                    failures.append(f"{theme}: --np-{fg} on --np-{bg} = {ratio:.2f}:1")
        set_theme(browser, "light")
        assert not failures, "token pairs below WCAG AA:\n  " + "\n  ".join(failures)

    def test_no_rendered_text_on_the_accent_falls_below_aa(self, browser, app_server):
        """The regression guard for the hue change itself.

        ~50 rules pair an accent background with white text, which was legible
        on the old blue accent and is not on marigold. This walks what is
        actually rendered rather than trusting the stylesheets, so a new accent
        surface added anywhere is caught here too.
        """
        open_app(browser, app_server)
        browser.execute_script(
            "const ed = document.getElementById('planEditor');"
            "ed.value = '---\\ntitle: Contrast\\n---\\n\\nDiscovery\\n"
            "  Kick-off @kev 1d 100%\\n  Interviews @kev 3d 60%\\n\\nBuild\\n  Design @adam 5d\\n';"
            "ed.dispatchEvent(new Event('input', {bubbles: true}));"
        )
        time.sleep(1.5)

        probe = """
            function lum(c){const m=c.match(/[\\d.]+/g).map(Number);
              const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
              return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2]);}
            function ratio(a,b){const x=lum(a),y=lum(b);
              return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
            function bgOf(el){let e=el;while(e){const b=getComputedStyle(e).backgroundColor;
              if(b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) return b; e=e.parentElement;}
              return getComputedStyle(document.body).backgroundColor;}
            const accent = getComputedStyle(document.documentElement)
              .getPropertyValue('--np-accent').trim().toUpperCase();
            const bad = [];
            document.querySelectorAll('*').forEach(el => {
              if (!el.offsetParent || el.children.length) return;
              const text = (el.textContent || '').trim();
              if (!text || text.length > 40) return;
              const bg = bgOf(el);
              const m = bg.match(/[\\d.]+/g);
              if (!m) return;
              const hex = '#' + m.slice(0,3)
                .map(n => (+n).toString(16).padStart(2,'0')).join('').toUpperCase();
              if (hex !== accent) return;
              const r = ratio(getComputedStyle(el).color, bg);
              if (r < 4.5) bad.push(text.slice(0,30) + ' = ' + r.toFixed(2) + ':1');
            });
            return [...new Set(bad)];
        """
        for view in ("gantt", "kanban", "tasks"):
            browser.execute_script("switchToView(arguments[0])", view)
            time.sleep(0.7)
            for theme in ("light", "dark"):
                set_theme(browser, theme)
                bad = browser.execute_script(probe)
                assert not bad, f"{view}/{theme}: illegible text on the accent: {bad}"
        set_theme(browser, "light")


class TestEditorMetrics:
    def test_editor_and_highlight_overlay_keep_identical_metrics(self, browser, app_server):
        """The textarea and its syntax-highlight overlay are stacked and must
        lay text out identically. A font-family swap is exactly what desyncs
        them, so this is asserted against the *new* typeface."""
        open_app(browser, app_server)
        browser.execute_async_script("document.fonts.ready.then(arguments[0])")
        browser.execute_script(
            "const ed = document.getElementById('planEditor');"
            "ed.value = 'Discovery\\n  Interviews 3d\\nBuild\\n  Deliver 2d';"
            "ed.dispatchEvent(new Event('input', {bubbles: true}));"
        )
        time.sleep(0.6)

        mismatched = browser.execute_script(
            """
            const a = getComputedStyle(document.getElementById('planEditor'));
            const layer = document.getElementById('highlightLayer');
            if (!layer) return 'no-highlight-layer';
            const b = getComputedStyle(layer);
            const keys = ['fontFamily','fontSize','lineHeight','letterSpacing',
                          'wordSpacing','tabSize','padding'];
            return keys.filter(k => a[k] !== b[k]).map(k => `${k}: ${a[k]} vs ${b[k]}`);
            """
        )
        assert mismatched != "no-highlight-layer", "highlight overlay missing"
        assert mismatched == [], f"editor/overlay metrics diverged: {mismatched}"
