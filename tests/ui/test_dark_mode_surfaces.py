"""Tour card and status bar legibility in both themes.

Both surfaces once kept a light background under `data-theme="dark"` while
their text switched to the dark theme's light ink: the welcome tour's heading
and body all but vanished, and the status bar's version/Settings/Details
buttons rendered as pale boxes with pale labels. They now resolve through the
theme tokens in visual-system.css; these tests read the colours the browser
actually computes, so a hard-coded background creeping back in fails here
rather than in someone's dark-mode session.

Usage:
    uv run pytest tests/ui/test_dark_mode_surfaces.py -q
"""

import pytest

from .helpers import open_app

THEMES = ["light", "dark"]

# The contrast between `text_selector`'s colour and the first opaque background
# at or above `surface_selector`, as a WCAG ratio. Walking up from the surface
# (rather than reading its own background) means a surface that turns
# transparent is judged against what actually shows through it.
CONTRAST_JS = """([surfaceSelector, textSelector]) => {
    const toHex = rgb => '#' + rgb.match(/[\\d.]+/g).slice(0, 3)
        .map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
    const alpha = rgb => {
        const parts = rgb.match(/[\\d.]+/g);
        return parts.length > 3 ? Number(parts[3]) : 1;
    };
    let el = document.querySelector(surfaceSelector);
    while (el && alpha(getComputedStyle(el).backgroundColor) === 0) {
        el = el.parentElement;
    }
    const bg = el ? getComputedStyle(el).backgroundColor : 'rgb(255, 255, 255)';
    const fg = getComputedStyle(document.querySelector(textSelector)).color;
    return { bg, fg, ratio: wbContrastRatio(toHex(bg), toHex(fg)) };
}"""


def set_theme(page, theme):
    """Switch theme and wait for the switch to finish painting.

    `.tour-popup` transitions `all` over 0.4s and `.status-bar-btn` its
    background over 0.15s, while the text colours change instantly -- so a
    read taken straight after the flip sees dark-theme ink on a background
    still fading out of the light theme, and reports a contrast failure no
    settled page has.
    """
    page.evaluate(
        """async theme => {
            if (theme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.documentElement.removeAttribute('data-theme');
            }
            // Transitions only: an infinite keyframe animation never finishes.
            // A transition superseded mid-flight rejects, which is fine.
            await Promise.all(document.getAnimations()
                .filter(a => a instanceof CSSTransition)
                .map(a => a.finished.catch(() => {})));
        }""",
        theme,
    )


def contrast(page, surface, text):
    return page.evaluate(CONTRAST_JS, [surface, text])


@pytest.fixture
def tour(page, app_server):
    """The app with the welcome tour open on its first step.

    The suite's page fixture marks the tour completed so it never covers the
    UI; this opens it deliberately, the way startTour() would.
    """
    open_app(page, app_server)
    page.evaluate(
        "() => { document.getElementById('tourOverlay').classList.add('active');"
        " showTourStep(0); }"
    )
    page.wait_for_selector("#tourPopup #tourTitle:not(:empty)")
    return page


class TestTourCard:
    @pytest.mark.parametrize("theme", THEMES)
    @pytest.mark.parametrize("text", ["#tourTitle", "#tourMessage"])
    def test_tour_text_is_legible(self, tour, theme, text):
        set_theme(tour, theme)
        result = contrast(tour, "#tourPopup", text)
        assert result["ratio"] >= 4.5, (
            f"[{theme}] {text} is {result['fg']} on {result['bg']}: "
            f"only {result['ratio']:.2f}:1"
        )


class TestStatusBarButtons:
    @pytest.mark.parametrize("theme", THEMES)
    @pytest.mark.parametrize(
        "button",
        [
            "#statusBarVersionBtn",
            ".status-bar-btn[onclick='toggleSettingsPanel()']",
            ".status-bar-btn[onclick='toggleProjectDetails()']",
        ],
    )
    def test_status_bar_button_label_is_legible(self, page, app_server, theme, button):
        open_app(page, app_server)
        set_theme(page, theme)
        result = contrast(page, button, f"{button} .status-bar-btn-label")
        assert result["ratio"] >= 4.5, (
            f"[{theme}] {button} label is {result['fg']} on {result['bg']}: "
            f"only {result['ratio']:.2f}:1"
        )
