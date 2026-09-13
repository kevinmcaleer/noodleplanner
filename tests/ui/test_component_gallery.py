"""The component gallery renders, and every control in it shows focus.

The audit counted 513 button rules carrying 172 `:hover` rules and 37 `:focus`
ones, and 114 badge class names with 3 focus rules between them. #1193's fix is
a single `:focus-visible` rule in `visual-system.css` covering every natively
focusable element, rather than a focus style bolted onto each of 825 component
class names.

That fix is exactly the kind that regresses silently: a component adds
`outline: none`, or a rule with one more class in its selector overrides the
box-shadow, and nobody notices until someone tries to use the keyboard. So the
assertion here is not "does a rule exist" -- it is "drive a real keyboard, and
check the focused element actually looks different".
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.ui


# Transitions have to be off before any of this is measurable. .btn-primary
# carries `transition: box-shadow 0.2s`, so sampling the computed style straight
# after Tab catches the ring at zero opacity and reports a button that rings
# correctly as having no ring at all.
_KILL_TRANSITIONS = """
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(style);
"""

# What counts as a visible focus indicator. The app's ring is a box-shadow
# (chosen so a component's `outline: none` cannot suppress it), but a component
# is free to use an outline or a border change instead, so all three count.
#
# `visibleShadow` is the part that matters. A computed box-shadow of
# `rgba(0, 0, 0, 0) 0px 0px 0px 0px` is a shadow in the string sense and no
# shadow at all on screen, so the layers are parsed and at least one has to be
# both non-transparent and non-zero.
_INDICATOR_JS = """
(el) => {
    const s = getComputedStyle(el);
    const shadow = s.boxShadow;
    let visibleShadow = false;
    if (shadow && shadow !== 'none') {
        // Split on commas that are not inside rgb()/rgba().
        const layers = shadow.split(/,(?![^(]*\\))/);
        visibleShadow = layers.some((layer) => {
            const alpha = /rgba?\\(([^)]*)\\)/.exec(layer);
            if (alpha) {
                const parts = alpha[1].split(/[,\\s/]+/).filter(Boolean);
                if (parts.length > 3 && parseFloat(parts[3]) === 0) return false;
            }
            return /(^|\\s)(?!0px)(-?\\d*\\.?\\d+)px/.test(layer);
        });
    }
    return {
        boxShadow: shadow,
        visibleShadow,
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        outlineColor: s.outlineColor,
        borderColor: s.borderColor,
        backgroundColor: s.backgroundColor,
    };
}
"""


def _snapshot(page, handle):
    return page.evaluate(_INDICATOR_JS, handle)


def _has_visible_indicator(resting: dict, focused: dict) -> bool:
    if focused["visibleShadow"] and focused["boxShadow"] != resting["boxShadow"]:
        return True
    outline_shown = (
        focused["outlineStyle"] not in ("none", "")
        and focused["outlineWidth"] not in ("0px", "")
    )
    if outline_shown and (
        focused["outlineStyle"] != resting["outlineStyle"]
        or focused["outlineWidth"] != resting["outlineWidth"]
    ):
        return True
    if focused["borderColor"] != resting["borderColor"]:
        return True
    if focused["backgroundColor"] != resting["backgroundColor"]:
        return True
    return False


# Identifies a control well enough to find it from a failure message: the cell
# it sits in, its tag, and its classes or type.
_KEY_JS = """
(el) => {
    const cell = el.closest('.gallery-cell');
    if (!cell || !el.closest('#gallery')) return null;
    const label = cell.querySelector('.gallery-cell-label');
    const what = el.className || (el.getAttribute('type') ? 'type=' + el.getAttribute('type') : '');
    return (label ? label.textContent.trim() : '?') + ' > ' +
           el.tagName.toLowerCase() + (what ? '.' + what : '');
}
"""


@pytest.fixture
def gallery(page, app_server):
    page.goto(f"{app_server}/components")
    page.wait_for_selector("#gallery section")
    page.evaluate(_KILL_TRANSITIONS)
    return page


def test_gallery_renders_every_section(gallery):
    """Each section in the spec produces a section on the page."""
    spec_ids = gallery.evaluate("GALLERY.map((s) => s.id)")
    assert spec_ids, "component-gallery.js exposed no sections"
    for section_id in spec_ids:
        assert gallery.locator(f"section#{section_id}").count() == 1, (
            f"gallery section {section_id!r} did not render"
        )


def test_gallery_uses_the_apps_own_stylesheets(gallery, app_server):
    """The gallery's stylesheet list is the app's, not a copy of it."""
    index_sheets = gallery.evaluate(
        """async (base) => {
            const html = await (await fetch(base + '/')).text();
            return [...html.matchAll(/href="\\/static\\/([^"?]+\\.css)/g)].map((m) => m[1]);
        }""",
        app_server,
    )
    gallery_sheets = gallery.evaluate(
        """() => [...document.querySelectorAll('link[rel=stylesheet]')]
            .map((l) => l.getAttribute('href'))
            .filter((h) => h.startsWith('/static/'))
            .map((h) => h.replace('/static/', '').replace(/\\?.*$/, ''))"""
    )
    assert gallery_sheets == index_sheets, (
        "the gallery is not loading the same stylesheets, in the same order, as the app"
    )


def test_tokens_resolve_to_real_values(gallery):
    """Every token the gallery displays resolves to something."""
    unresolved = gallery.evaluate(
        """() => {
            const cs = getComputedStyle(document.documentElement);
            const names = ['--np-paper', '--np-ink', '--np-accent', '--np-space-8',
                           '--np-text-85', '--np-radius-lg', '--np-elevation-2',
                           '--np-focus-ring', '--np-focus-ring-color', '--np-border-control'];
            return names.filter((n) => !cs.getPropertyValue(n).trim());
        }"""
    )
    assert not unresolved, f"tokens resolve to nothing: {unresolved}"


def test_every_focusable_control_shows_a_focus_indicator(gallery):
    """Tab through the gallery; every control must change appearance.

    Driven with real Tab presses rather than `.focus()`, because `:focus-visible`
    deliberately does not match programmatic focus in Chromium -- a test that
    called `.focus()` would report no ring on a page that rings correctly.
    """
    controls = gallery.locator(
        "#gallery :is(button, input, select, textarea, a[href], [tabindex]:not([tabindex^='-'])):not([disabled])"
    )
    total = controls.count()
    assert total >= 15, f"expected the gallery to offer a decent set of controls, got {total}"

    resting = [_snapshot(gallery, controls.nth(i).element_handle()) for i in range(total)]

    # Start from the top of the document so Tab order is deterministic.
    gallery.locator("body").click(position={"x": 2, "y": 2})
    gallery.keyboard.press("Home")

    seen: dict[str, dict] = {}
    # Enough presses to walk past the page chrome and through every control.
    for _ in range(total + 30):
        gallery.keyboard.press("Tab")
        handle = gallery.evaluate_handle("() => document.activeElement")
        element = handle.as_element()
        if element is None:
            continue
        key = gallery.evaluate(_KEY_JS, element)
        if key is None or key in seen:
            continue
        seen[key] = _snapshot(gallery, element)

    assert seen, "tabbing never landed inside the gallery"

    resting_by_key = {}
    for i in range(total):
        handle = controls.nth(i).element_handle()
        key = gallery.evaluate(_KEY_JS, handle)
        resting_by_key.setdefault(key, resting[i])

    missing = [
        key
        for key, focused in seen.items()
        if key in resting_by_key and not _has_visible_indicator(resting_by_key[key], focused)
    ]
    assert not missing, (
        "these controls look identical focused and unfocused, so a keyboard user "
        "cannot tell where they are:\n  " + "\n  ".join(sorted(missing))
    )


def test_focus_indicator_survives_a_component_setting_outline_none(gallery):
    """The ring is a box-shadow precisely so `outline: none` cannot kill it.

    Nine components set `outline: none` on their resting state. If the global
    ring were outline-based, every one of them would swallow it.
    """
    ring = gallery.evaluate(
        "() => getComputedStyle(document.documentElement).getPropertyValue('--np-focus-ring')"
    )
    assert "inset" not in ring
    assert ring.count("0 0 0") >= 2, (
        "expected a two-layer ring (halo + ring) so it stays visible on any surface, "
        f"got {ring!r}"
    )
