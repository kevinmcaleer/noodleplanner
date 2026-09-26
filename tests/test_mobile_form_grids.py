"""Detail-pane form grids stack to one column on mobile (#514).

The task, RAID, action, resource and highlight forms used to lay out their
fields with inline `style="display: grid; grid-template-columns: 1fr 1fr"`
attributes. A media query cannot override an inline style, so on a phone the
two- and three-column grids stayed side by side and squeezed the inputs to a
few characters wide.

They now use the `.form-grid-2col` / `.form-grid-3col` classes, which
responsive.css collapses to a single column at the mobile breakpoint. These
tests fail if an inline fixed-column grid creeps back into the templates, or
if the classes lose their mobile override.

    uv run pytest tests/test_mobile_form_grids.py -q
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

WEB = Path(__file__).resolve().parents[1] / "packages" / "noodle-web" / "src" / "noodle_web"
TEMPLATES = WEB / "templates"
STATIC = WEB / "static"

GRID_CLASSES = ("form-grid-2col", "form-grid-3col")

# An inline style whose grid-template-columns is a fixed number of tracks
# ("1fr 1fr", "repeat(3, 1fr)", "120px 1fr" ...). `auto-fit` / `auto-fill`
# grids reflow on their own, so they are allowed.
INLINE_GRID = re.compile(r'style="[^"]*grid-template-columns\s*:\s*([^;"]+)', re.IGNORECASE)


def _media_blocks(css: str, query: str) -> list[str]:
    """Return the bodies of every `@media <query>` block in `css`."""
    bodies = []
    for match in re.finditer(r"@media\s*" + re.escape(query) + r"\s*\{", css):
        depth, start = 1, match.end()
        i = start
        while depth and i < len(css):
            depth += {"{": 1, "}": -1}.get(css[i], 0)
            i += 1
        bodies.append(css[start : i - 1])
    return bodies


def _rule_body(css: str, selector: str) -> str | None:
    """The declarations of the first rule whose selector list names `selector`."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        selectors = [s.strip() for s in match.group(1).split(",")]
        if selector in selectors:
            return match.group(2)
    return None


@pytest.mark.parametrize("template", sorted(TEMPLATES.glob("*.html")), ids=lambda p: p.name)
def test_no_inline_fixed_column_grids(template):
    offenders = []
    for lineno, line in enumerate(template.read_text(encoding="utf-8").splitlines(), 1):
        for match in INLINE_GRID.finditer(line):
            columns = match.group(1)
            if "auto-fit" in columns or "auto-fill" in columns:
                continue
            offenders.append(f"{template.name}:{lineno}: {columns.strip()}")
    assert not offenders, (
        "Inline grid-template-columns cannot be overridden by media queries; "
        "use .form-grid-2col / .form-grid-3col instead:\n" + "\n".join(offenders)
    )


def test_detail_forms_use_grid_classes():
    html = (TEMPLATES / "index.html").read_text(encoding="utf-8")
    for cls in GRID_CLASSES:
        assert f'class="{cls}"' in html, f"index.html no longer uses .{cls}"


@pytest.mark.parametrize("cls,tracks", [("form-grid-2col", 2), ("form-grid-3col", 3)])
def test_grid_classes_define_desktop_columns(cls, tracks):
    css = (STATIC / "components.css").read_text(encoding="utf-8")
    body = _rule_body(css, f".{cls}")
    assert body is not None, f".{cls} is not defined in components.css"
    assert "display: grid" in body
    columns = re.search(r"grid-template-columns\s*:\s*([^;]+);", body)
    assert columns and columns.group(1).split() == ["1fr"] * tracks


@pytest.mark.parametrize("cls", GRID_CLASSES)
def test_grid_classes_stack_on_mobile(cls):
    css = (STATIC / "responsive.css").read_text(encoding="utf-8")
    blocks = _media_blocks(css, "(max-width: 768px)")
    assert blocks, "responsive.css has no (max-width: 768px) block"
    for block in blocks:
        body = _rule_body(block, f".{cls}")
        if body and re.search(r"grid-template-columns\s*:\s*1fr\s*;", body):
            return
    pytest.fail(f".{cls} does not collapse to one column at max-width: 768px")
