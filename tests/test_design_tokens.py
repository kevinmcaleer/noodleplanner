"""The Penpot-owned tokens in visual-system.css are generated from Penpot.

Penpot is the source of truth for the design tokens (#1318, epic #1317).
`docs/design/tokens/*.json` is its token export, and `npm run design:tokens`
(scripts/design-tokens.mjs) writes the block of visual-system.css between the
BEGIN/END PENPOT TOKENS markers from it.

This used to run the other way. `npm run audit:tokens` exported the CSS to the
JSON, and tests/test_design_token_export.py checked the export had kept up.
Nothing stopped a token being changed in Penpot and not in the CSS, or the other
way round, so the two drifted and nobody could say which one was right.

So the direction is now one-way, and these tests fail when:

- the generated block and the JSON disagree, because the JSON was re-exported
  and the generator was not run;
- someone hand-edits a Penpot-owned token, inside the block or by redeclaring
  it anywhere else in the file;
- a code-owned token (gradients, motion) turns up in the JSON or goes missing
  from the CSS.

    uv run pytest tests/test_design_tokens.py -q

If the first test fails, export the tokens from Penpot over docs/design/tokens/
and run `npm run design:tokens`. Never edit the generated block itself.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/design-tokens.mjs"
STYLESHEET = ROOT / "packages/noodle-web/src/noodle_web/static/visual-system.css"
TOKENS = ROOT / "docs/design/tokens"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def _check(tokens: Path = TOKENS, stylesheet: Path = STYLESHEET) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", str(SCRIPT), "--check", "--tokens", str(tokens), "--stylesheet", str(stylesheet)],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )


def _node(expr: str):
    """Evaluate *expr* with the generator module bound to `m`."""
    code = f"import(process.argv[1]).then((m) => console.log(JSON.stringify({expr})))"
    out = subprocess.run(
        ["node", "-e", code, SCRIPT.as_uri()], capture_output=True, text=True, check=True, cwd=ROOT
    )
    return json.loads(out.stdout)


@pytest.fixture
def copies(tmp_path: Path) -> tuple[Path, Path]:
    tokens = tmp_path / "tokens"
    shutil.copytree(TOKENS, tokens)
    css = tmp_path / "visual-system.css"
    shutil.copy(STYLESHEET, css)
    return tokens, css


def test_stylesheet_matches_the_penpot_export():
    result = _check()
    assert result.returncode == 0, result.stderr


def test_a_json_change_without_regenerating_fails(copies):
    tokens, css = copies
    path = tokens / "color-light.json"
    data = json.loads(path.read_text())
    data["accent"]["$value"] = "#123456"
    path.write_text(json.dumps(data, indent=2))

    result = _check(tokens, css)
    assert result.returncode == 1
    assert "does not match" in result.stderr


def test_hand_editing_a_token_in_the_block_fails(copies):
    tokens, css = copies
    text = css.read_text()
    assert "    --np-accent: #EDB52A;" in text
    css.write_text(text.replace("    --np-accent: #EDB52A;", "    --np-accent: #FF0000;", 1))

    result = _check(tokens, css)
    assert result.returncode == 1
    assert "edited by hand" in result.stderr


def test_redeclaring_a_penpot_token_outside_the_block_fails(copies):
    tokens, css = copies
    css.write_text(css.read_text() + '\n[data-theme="dark"] { --np-accent: #FF0000; }\n')

    result = _check(tokens, css)
    assert result.returncode == 1
    assert "--np-accent is a Penpot-owned token" in result.stderr


def test_a_code_owned_token_in_the_json_fails(copies):
    tokens, css = copies
    path = tokens / "core.json"
    data = json.loads(path.read_text())
    data["anim-duration"] = {"$value": "0.2s", "$type": "duration"}
    path.write_text(json.dumps(data, indent=2))

    result = _check(tokens, css)
    assert result.returncode == 1
    assert "--np-anim-duration is code-owned" in result.stderr


def test_a_code_owned_token_missing_from_the_css_fails(copies):
    tokens, css = copies
    text = css.read_text()
    line = next(l for l in text.splitlines() if l.strip().startswith("--np-anim-easing:"))
    css.write_text(text.replace(line + "\n", ""))

    result = _check(tokens, css)
    assert result.returncode == 1
    assert "--np-anim-easing is code-owned but is not declared" in result.stderr


def test_every_code_owned_token_is_hand_written_outside_the_block():
    code_owned = _node("m.CODE_OWNED")
    css = STYLESHEET.read_text()
    start, end = css.index("/* BEGIN PENPOT TOKENS"), css.index("/* END PENPOT TOKENS */")
    outside = css[:start] + css[end:]
    for name in code_owned:
        assert f"{name}:" in outside
        assert f"{name}:" not in css[start:end]


@pytest.mark.parametrize(
    ("token", "css"),
    [
        # Penpot's font sizes are px at a 16px base; the type scale is em.
        ({"path": "text-110", "type": "fontSizes", "value": "17.6"}, "1.1em"),
        ({"path": "text-75", "type": "fontSizes", "value": "12"}, "0.75em"),
        ({"path": "text-100", "type": "fontSizes", "value": "16"}, "1em"),
        # A family and its generic fallback get the full stack back.
        (
            {"path": "font-ui", "type": "fontFamilies", "value": ["Instrument Sans", "sans-serif"]},
            "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        ),
        # ...but a family not in the table is used as Penpot has it.
        ({"path": "font-ui", "type": "fontFamilies", "value": ["Inter", "sans-serif"]}, "'Inter', sans-serif"),
        # A value Penpot cannot hold is restored while Penpot's stand-in is unchanged...
        ({"path": "radius-circle", "type": "borderRadius", "value": "9999px"}, "50%"),
        # ...and stops applying once a designer changes it.
        ({"path": "radius-circle", "type": "borderRadius", "value": "16px"}, "16px"),
        ({"path": "radius-control", "type": "borderRadius", "value": "{radius-lg}"}, "var(--np-radius-lg)"),
        ({"path": "legacy.text-muted", "type": "color", "value": "{faint}"}, "var(--np-faint)"),
        ({"path": "bg", "type": "color", "value": "{legacy.bg-primary}"}, "var(--bg-primary)"),
        (
            {
                "path": "elevation-1",
                "type": "shadow",
                "value": [{"offsetX": "0", "offsetY": "1", "blur": "2", "spread": "0", "color": "{shadow-tint}", "inset": False}],
            },
            "0 1px 2px var(--np-shadow-tint)",
        ),
        (
            {
                "path": "focus-ring",
                "type": "shadow",
                "value": [
                    {"offsetX": "0", "offsetY": "0", "blur": "0", "spread": "{focus-ring-offset}", "color": "{paper}"},
                    {
                        "offsetX": "0",
                        "offsetY": "0",
                        "blur": "0",
                        "spread": "{focus-ring-offset} + {focus-ring-width}",
                        "color": "{focus-ring-color}",
                    },
                ],
            },
            "0 0 0 var(--np-focus-ring-offset) var(--np-paper), "
            "0 0 0 calc(var(--np-focus-ring-offset) + var(--np-focus-ring-width)) var(--np-focus-ring-color)",
        ),
    ],
)
def test_penpot_values_translate_back_to_the_css(token, css):
    assert _node(f"m.toCss({json.dumps(token)})") == css
