"""Storybook's stories stay in step with the component gallery spec.

`static/component-gallery.js` is the single source of truth for what components
exist and what variants they have. Two things consume it: the /components page,
which loops over it and so needs no maintenance, and Storybook, which cannot --
CSF reads static named exports, so a story per section has to be written out.

That one hand-maintained list is the only place the two can drift, so it is the
thing worth a test. Adding a *variant* to the spec needs no change anywhere;
adding a *section* fails here until it has a story.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "packages/noodle-web/src/noodle_web/static/component-gallery.js"
STORIES = ROOT / ".storybook/stories/components.stories.js"
MAIN = ROOT / ".storybook/main.mjs"
INDEX = ROOT / "packages/noodle-web/src/noodle_web/templates/index.html"


def _spec_section_ids() -> list[str]:
    """The `id:` of each entry in the GALLERY array.

    Matched on the two-space indentation the array's entries carry, so a nested
    object that happens to have an `id` key cannot be mistaken for a section.
    """
    return re.findall(r"^        id: '([^']+)'", SPEC.read_text(), re.MULTILINE)


def test_spec_parses_to_sections():
    """Guard the guard: a regex that matched nothing would pass every test below."""
    ids = _spec_section_ids()
    assert len(ids) >= 5, f"expected the gallery spec to declare sections, found {ids}"
    assert len(ids) == len(set(ids)), f"duplicate section ids: {ids}"


def test_every_section_has_a_story():
    stories = STORIES.read_text()
    referenced = set(re.findall(r"storyFor\('([^']+)'\)", stories))
    missing = [i for i in _spec_section_ids() if i not in referenced]
    assert not missing, (
        "these gallery sections have no Storybook story, so they are visible at "
        f"/components but not in Storybook: {missing}\n"
        "Add `export const Name = storyFor('<id>')` to .storybook/stories/components.stories.js"
    )


def test_no_story_references_a_section_that_no_longer_exists():
    stories = STORIES.read_text()
    referenced = set(re.findall(r"storyFor\('([^']+)'\)", stories))
    stale = sorted(referenced - set(_spec_section_ids()))
    assert not stale, (
        f"these stories reference gallery sections that no longer exist: {stale}. "
        "storyFor() throws at render time, so Storybook would fail to build."
    )


def test_storybook_reads_the_stylesheet_list_from_index_html():
    """Not a copied list.

    Load order decides which of two equal-specificity rules wins, which is the
    bug epic #1187 exists to fix -- so a Storybook rendering components under a
    stale stylesheet order would be actively misleading.
    """
    main = MAIN.read_text()
    assert "templates/index.html" in main, (
        "main.mjs should derive its stylesheet list from index.html, not hardcode one"
    )
    assert not re.search(r"'\w[\w-]*\.css'", main), (
        "main.mjs appears to hardcode a stylesheet name; read them from index.html instead"
    )


def test_the_app_still_links_stylesheets_the_way_both_consumers_expect():
    """The shared assumption behind the gallery route and main.mjs."""
    sheets = re.findall(r'href="/static/([^"?]+\.css)', INDEX.read_text())
    assert len(sheets) > 20, f"only found {len(sheets)} linked stylesheets in index.html"
    assert "visual-system.css" in sheets, "the canonical token layer is not linked"
