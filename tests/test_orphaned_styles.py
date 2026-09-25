"""Every class the running app sets must be styled by a stylesheet the app loads.

`static/style.css` is dead: #571 split it into the modular stylesheets and
switched `index.html` over to loading those, but nothing removed the file. The
split was not complete, and 54 classes were left behind in it -- so components
including the progress toast, the baseline history dialog, the AI settings
modal and the editor's front-matter highlighting rendered unstyled in the live
app from that commit until #1194 recovered them.

`tests/test_collab_session.py::TestPresenceStylesAreReachable` catches this for
one component. This generalises it: any class set by the app's own JavaScript
or markup, but defined only in an unlinked stylesheet, is the same bug.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STATIC_DIR = Path(__file__).resolve().parents[1] / "packages/noodle-web/src/noodle_web/static"
TEMPLATE_DIR = STATIC_DIR.parent / "templates"
INDEX = TEMPLATE_DIR / "index.html"

# Bootstrap is loaded from a CDN, so its utility classes are styled even though
# no local stylesheet defines them. Only the ones the app actually uses.
BOOTSTRAP_UTILITIES = {"bg-success", "bg-danger"}

_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
# A selector prelude is the text before a `{`. Allowing `{` as a leading
# delimiter (not just `}` or `;`) is what lets this see rules nested inside
# an @media block.
_PRELUDE = re.compile(r"(?:^|[{};])\s*([^{};@]+?)\s*\{")
_CLASS = re.compile(r"\.([a-zA-Z0-9_-]+)")


def _classes_in(css: str) -> set[str]:
    """Every class name appearing in any selector in this stylesheet."""
    found: set[str] = set()
    for prelude in _PRELUDE.findall(_COMMENT.sub("", css)):
        prelude = prelude.strip()
        if not prelude or prelude.startswith("@"):
            continue
        found.update(_CLASS.findall(prelude))
    return found


def _linked_stylesheets() -> list[Path]:
    hrefs = re.findall(r'href="/static/([^"?]+\.css)', INDEX.read_text())
    return [STATIC_DIR / href for href in hrefs]


def _unlinked_stylesheets() -> list[Path]:
    linked = {p.resolve() for p in _linked_stylesheets()}
    return sorted(p for p in STATIC_DIR.rglob("*.css") if p.resolve() not in linked and "vendor" not in p.parts)


def _app_sources() -> list[Path]:
    """The files that decide which classes an element ends up carrying."""
    scripts = [p for p in STATIC_DIR.rglob("*.js") if "vendor" not in p.parts]
    return scripts + [INDEX]


def test_every_referenced_class_is_defined_in_a_linked_stylesheet():
    linked_classes: set[str] = set()
    for sheet in _linked_stylesheets():
        linked_classes |= _classes_in(sheet.read_text())

    # Only classes an unlinked stylesheet claims to style: the app names plenty
    # of classes nobody styles anywhere (layout hooks, JS-only markers), and
    # those are not this test's business. A class stranded in a stylesheet that
    # is not loaded is, because someone wrote styling for it that never runs.
    stranded: set[str] = set()
    for sheet in _unlinked_stylesheets():
        stranded |= _classes_in(sheet.read_text())
    stranded -= linked_classes
    stranded -= BOOTSTRAP_UTILITIES
    # templates.html carries its own <style> block rather than linking one.
    stranded -= _classes_in((TEMPLATE_DIR / "templates.html").read_text())
    # The planning-session join page (#1347) is a page of its own, and styles
    # its own classes with the stylesheets it links.
    for href in re.findall(r'href="/static/([^"?]+\.css)', (TEMPLATE_DIR / "collab_join.html").read_text()):
        stranded -= _classes_in((STATIC_DIR / href).read_text())
    if not stranded:
        pytest.skip("no unlinked stylesheet defines anything the linked ones do not")

    sources = {path: path.read_text() for path in _app_sources()}
    unstyled: dict[str, list[str]] = {}
    for name in sorted(stranded):
        # Bounded on both sides so `.task-date` does not match
        # `task-date-suggestion`, and so a bare word in prose does not count.
        pattern = re.compile(r"""['"\s.`]""" + re.escape(name) + r"""['"\s`.:]""")
        users = [p.name for p, text in sources.items() if pattern.search(text)]
        if users:
            unstyled[name] = users

    assert not unstyled, (
        "these classes are set by the running app but only styled in a stylesheet "
        "index.html does not load, so they render unstyled:\n"
        + "\n".join(f"  .{name}  (set by {', '.join(users)})" for name, users in unstyled.items())
    )
