"""Warm Paper + Marigold visual system (#998), on Playwright.

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

Ported from tests/test_visual_system.py. One test here is deliberately *not*
hermetic: "are the approved typefaces fetchable" is a question about Google
Fonts, so it takes `online_page` and pays the network. Every other test takes
`page` and never leaves the machine -- a split the Selenium suite's
module-scoped driver could not express.

Usage:
    uv run pytest tests/ui/test_visual_system.py -q
"""

import pytest

from .helpers import open_app

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

CONTRAST_JS = """
    function lum(c){const m=c.match(/[\\d.]+/g).map(Number);
      const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
      return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2]);}
    function ratio(a,b){const x=lum(a),y=lum(b);
      return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
    function bgOf(el){let e=el;while(e){const b=getComputedStyle(e).backgroundColor;
      if(b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) return b; e=e.parentElement;}
      return getComputedStyle(document.body).backgroundColor;}
"""


def set_theme(page, theme):
    """Set the theme the way the app itself does, then wait for the swap.

    The Selenium version slept 0.2s here. Waiting on the attribute the app
    actually sets returns as soon as the cascade has been recomputed.
    """
    page.evaluate(
        """theme => {
            localStorage.setItem('np-theme-choice', theme);
            if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
            else document.documentElement.removeAttribute('data-theme');
        }""",
        theme,
    )
    page.wait_for_function(
        "theme => (document.documentElement.getAttribute('data-theme') === 'dark')"
        "         === (theme === 'dark')",
        arg=theme,
    )


def token(page, name):
    return page.evaluate(
        "name => getComputedStyle(document.documentElement)"
        "  .getPropertyValue(name).trim()",
        name,
    )


def render_plan(page, plan):
    """Type a plan into the editor and wait for the app to finish rendering it.

    Replaces a fixed `time.sleep(1.5)`: the wait ends the moment a task row
    exists, which on a warm page is tens of milliseconds.
    """
    page.evaluate(
        """value => {
            const ed = document.getElementById('planEditor');
            ed.value = value;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        plan,
    )
    page.wait_for_function(
        "() => document.querySelectorAll("
        "  '#ganttBody tr, #tasksTableBody tr, .gantt-row').length > 0"
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
    def test_light_palette_is_the_approved_one(self, page, app_server):
        open_app(page, app_server)
        set_theme(page, "light")
        actual = {name: token(page, name).lower() for name in APPROVED_LIGHT}
        assert actual == APPROVED_LIGHT

    def test_dark_theme_keeps_the_marigold_accent_and_warms_the_surfaces(self, page, app_server):
        open_app(page, app_server)
        set_theme(page, "dark")
        # The accent is deliberately identical in both themes -- it is the
        # brand colour, not a surface -- which is also why --np-on-accent
        # stays dark in dark mode.
        assert token(page, "--np-accent").lower() == "#edb52a"
        assert token(page, "--np-on-accent").lower() == "#23201c"
        # Surfaces invert to warm near-blacks rather than neutral greys.
        paper = token(page, "--np-paper").lstrip("#")
        r, g, b = (int(paper[i:i + 2], 16) for i in (0, 2, 4))
        assert _relative_luminance("#" + paper) < 0.05, "dark paper must be dark"
        assert r >= g >= b, f"dark paper should stay warm (r>=g>=b), got #{paper}"

    @pytest.mark.external_assets
    def test_approved_typefaces_are_declared_and_fetchable(self, online_page, app_server):
        """Each approved family must actually resolve to a downloadable webfont.

        Checked with document.fonts.load() rather than a bare check(): the
        stylesheet is loaded lazily per family, so a face nothing on the
        current screen happens to use (IBM Plex Mono, until a plan with
        durations is rendered) is legitimately "not loaded yet" without being
        misconfigured. load() forces the fetch, so a typo in the family name
        or a family missing from the Google Fonts URL still fails here.

        This is the one test in the suite that asks the network a question, so
        it is the one test that gets `online_page` -- and the one that can go
        red because Google Fonts is having a bad day rather than because this
        repo broke something. `-m "not external_assets"` deselects it if that
        ever happens; nothing else in tests/ui leaves the machine.
        """
        open_app(online_page, app_server)
        online_page.evaluate("() => document.fonts.ready")
        missing = []
        for family in APPROVED_FONTS:
            loaded = online_page.evaluate(
                """family => document.fonts.load(`400 12px "${family}"`)
                     .then(faces => faces.length > 0)
                     .catch(() => false)""",
                family,
            )
            if not loaded:
                missing.append(family)
        assert not missing, f"webfont families not declared/fetchable: {missing}"

    def test_the_three_typefaces_are_wired_to_their_roles(self, page, app_server):
        """Loading a face is not the same as using it -- assert each token
        actually carries the approved family at the front of its stack."""
        open_app(page, app_server)
        heading, ui, data = page.evaluate(
            "() => { const s = getComputedStyle(document.documentElement);"
            "  return ['--np-font-heading','--np-font-ui','--np-font-data']"
            "    .map(k => s.getPropertyValue(k).trim()); }"
        )
        assert heading.startswith("'Newsreader'") or heading.startswith('"Newsreader"'), heading
        assert "Instrument Sans" in ui.split(",")[0], ui
        assert "IBM Plex Mono" in data.split(",")[0], data
        # Every stack must keep a real fallback, so an offline load degrades
        # rather than rendering in whatever the browser defaults to.
        for stack in (heading, ui, data):
            assert len(stack.split(",")) > 1, f"no fallback in font stack: {stack}"


class TestContrast:
    def test_small_text_token_pairs_meet_aa_in_both_themes(self, page, app_server):
        open_app(page, app_server)
        failures = []
        for theme in ("light", "dark"):
            set_theme(page, theme)
            for fg, bg in CONTRAST_PAIRS:
                fg_hex, bg_hex = token(page, f"--np-{fg}"), token(page, f"--np-{bg}")
                assert fg_hex and bg_hex, f"--np-{fg}/--np-{bg} undefined in {theme}"
                ratio = contrast(fg_hex, bg_hex)
                if ratio < 4.5:
                    failures.append(f"{theme}: --np-{fg} on --np-{bg} = {ratio:.2f}:1")
        assert not failures, "token pairs below WCAG AA:\n  " + "\n  ".join(failures)

    def test_no_rendered_text_on_the_accent_falls_below_aa(self, page, app_server):
        """The regression guard for the hue change itself.

        ~50 rules pair an accent background with white text, which was legible
        on the old blue accent and is not on marigold. This walks what is
        actually rendered rather than trusting the stylesheets, so a new accent
        surface added anywhere is caught here too.
        """
        open_app(page, app_server)
        render_plan(
            page,
            "---\ntitle: Contrast\n---\n\nDiscovery\n"
            "  Kick-off @kev 1d 100%\n  Interviews @kev 3d 60%\n\n"
            "Build\n  Design @adam 5d\n",
        )

        probe = CONTRAST_JS + """
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
            page.evaluate("view => switchToView(view)", view)
            page.wait_for_timeout(150)
            for theme in ("light", "dark"):
                set_theme(page, theme)
                bad = page.evaluate(f"() => {{ {probe} }}")
                assert not bad, f"{view}/{theme}: illegible text on the accent: {bad}"


class TestComponentOwnedColours:
    def test_whiteboard_note_titles_stay_legible_on_their_own_header_colour(self, page, app_server):
        """Components that colour their own surface must keep their own text colour.

        A whiteboard note's header text sits on the note's own colour --
        chosen by the user or derived from the task's place in the outline --
        and whiteboard-notes.js computes a real WCAG-contrasting text colour
        for it (wbContrastTextColour()). The palette's blanket `h1,h2,h3 {
        color }` used to paint over that, putting near-black ink on a dark
        navy note at 1.12:1. This walks the rendered notes rather than the
        stylesheet, so any future heading rule that reintroduces the clobber
        is caught whether the header paints that colour itself or lets the
        card show through.
        """
        open_app(page, app_server)
        set_theme(page, "light")
        render_plan(page, WHITEBOARD_PLAN)
        page.evaluate("() => switchToView('whiteboard')")
        # The notes are drawn asynchronously once the view is on screen, so
        # wait for them rather than for a fixed 1.2s.
        page.wait_for_function("() => document.querySelectorAll('.wb-note').length > 0")

        probe = CONTRAST_JS + """
            return [...document.querySelectorAll('.wb-note')].map(fo => {
              const header = fo.querySelector('.wb-note-header');
              const title = fo.querySelector('.wb-note-title');
              if (!header || !title) return null;
              return {
                task: fo.dataset.wbTask,
                ratio: +ratio(getComputedStyle(title).color,
                              bgOf(header)).toFixed(2),
              };
            }).filter(Boolean);
        """
        notes = page.evaluate(f"() => {{ {probe} }}")
        assert notes, "no whiteboard notes rendered"
        # 4.5:1 is AA for normal text; a note title is 13px bold, so AA applies.
        illegible = [n for n in notes if n["ratio"] < 4.5]
        assert not illegible, (
            "note titles below WCAG AA on their own header: "
            + ", ".join(f"{n['task']} = {n['ratio']}:1" for n in illegible)
        )


class TestEditorMetrics:
    def test_editor_and_highlight_overlay_keep_identical_metrics(self, page, app_server):
        """The textarea and its syntax-highlight overlay are stacked and must
        lay text out identically. A font-family swap is exactly what desyncs
        them, so this is asserted against the *new* typeface."""
        open_app(page, app_server)
        page.evaluate("() => document.fonts.ready")
        render_plan(page, "Discovery\n  Interviews 3d\nBuild\n  Deliver 2d")

        mismatched = page.evaluate(
            """() => {
                const a = getComputedStyle(document.getElementById('planEditor'));
                const layer = document.getElementById('highlightLayer');
                if (!layer) return 'no-highlight-layer';
                const b = getComputedStyle(layer);
                const keys = ['fontFamily','fontSize','lineHeight','letterSpacing',
                              'wordSpacing','tabSize','padding'];
                return keys.filter(k => a[k] !== b[k]).map(k => `${k}: ${a[k]} vs ${b[k]}`);
            }"""
        )
        assert mismatched != "no-highlight-layer", "highlight overlay missing"
        assert mismatched == [], f"editor/overlay metrics diverged: {mismatched}"


WHITEBOARD_PLAN = """---
title: Note Title Contrast
---

Discovery & Planning
  Stakeholder interviews @alex 3d 100%
  Requirements gathering @alex 2d 75%

Design
  Wireframes @sam 5d

---whiteboard---
| Task                   | X   | Y   | Colour  | Width | Height | Collapsed |
|------------------------|-----|-----|---------|-------|--------|-----------|
| Discovery & Planning   | 80  | 60  | #4A90D9 | 280   | 220    | no        |
| Design                 | 460 | 60  |         | 280   | 220    | no        |
| Requirements gathering | 80  | 340 | #7FB069 | 280   | 200    | no        |
| Wireframes             | 460 | 340 | #E58C8A | 280   | 200    | no        |
"""
