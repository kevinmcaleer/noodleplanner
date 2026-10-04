"""Every /static/ load must carry the deploy hash, so a deploy cannot leave a
browser running a stale copy of one file against fresh copies of the rest
(the ribbon's dependency/structure toggles went missing that way when
ribbon.js imported '/static/ribbon-ia.js' unversioned).

Three routes cover everything, and each has a check here:
  * tags in a template carry ?v={{ v }};
  * module imports are versioned by the import map the templates include;
  * URLs a script hands to the browser itself (Worker, fetch, a created
    <script>) go through staticUrl().
"""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from noodle_web import app
from noodle_web.app import STATIC_VERSION

WEB = Path(__file__).resolve().parent.parent / "packages" / "noodle-web" / "src" / "noodle_web"
STATIC = WEB / "static"
TEMPLATES = WEB / "templates"

# Images and icons are not scripts or styles; the manifest and sw.js have
# their own revalidation (see sw.js and StaticCacheControlMiddleware).
UNVERSIONED_TAG_OK = re.compile(r"\.(png|ico|svg|webmanifest)$")


@pytest.fixture
def client():
    from noodle_web.security import reset_rate_limit_store

    reset_rate_limit_store()
    return TestClient(app)


def _page_templates():
    return [t for t in sorted(TEMPLATES.glob("*.html")) if not t.name.startswith("_")]


def test_template_script_and_style_tags_are_versioned():
    bad = []
    for template in sorted(TEMPLATES.glob("*.html")):
        for n, line in enumerate(template.read_text().splitlines(), 1):
            for url in re.findall(r"""(?:src|href)=["'](/static/[^"']+)["']""", line):
                if "?v=" not in url and not UNVERSIONED_TAG_OK.search(url):
                    bad.append(f"{template.name}:{n} {url}")
            for url in re.findall(r"""\bimport\s[^;'"]*['"](/static/[^"']+)['"]""", line):
                if "?v=" not in url:
                    bad.append(f"{template.name}:{n} import {url}")
    assert not bad, "unversioned /static/ loads in templates:\n" + "\n".join(bad)


def test_every_page_includes_the_static_boot_partial():
    missing = [
        t.name for t in _page_templates()
        if "/static/" in t.read_text() and "_static_boot.html" not in t.read_text()
    ]
    assert not missing, f"templates loading /static/ without the import map: {missing}"


def test_import_map_covers_every_module_file():
    from noodle_web.app import _static_import_map

    imports = json.loads(_static_import_map("abc12345"))["imports"]
    files = {
        "/static/" + p.relative_to(STATIC).as_posix()
        for p in STATIC.rglob("*")
        if p.suffix in (".js", ".mjs") and p.name != "sw.js"
    }
    assert files == set(imports)
    assert all(url.endswith("?v=abc12345") for url in imports.values())
    assert imports["/static/ribbon-ia.js"] == "/static/ribbon-ia.js?v=abc12345"


@pytest.mark.parametrize("route", ["/", "/templates", "/components"])
def test_served_pages_carry_import_map_before_first_module(client, route):
    html = client.get(route).text
    assert f'window.NP_STATIC_V = "{STATIC_VERSION}"' in html
    m = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
    assert m, "no import map"
    assert json.loads(m.group(1))["imports"]["/static/ribbon-ia.js"].endswith(f"?v={STATIC_VERSION}")
    first_module = re.search(r'<script type="module"', html)
    if first_module:
        assert m.start() < first_module.start()


def test_collab_join_page_has_import_map(client):
    from noodle_web.app import templates

    html = templates.get_template("collab_join.html").render(v=STATIC_VERSION)
    assert '<script type="importmap">' in html


def test_scripts_do_not_hand_unversioned_static_urls_to_the_browser():
    """new Worker('/static/..'), fetch('/static/..') and script.src = '/static/..'
    must go through staticUrl() (or, in a classic script, window.NP_STATIC_V)."""
    patterns = [
        r"""new\s+(?:Shared)?Worker\(\s*['"`]/static/""",
        r"""fetch\(\s*['"`]/static/""",
        r"""\.src\s*=\s*['"`]/static/[^'"`]*\.(?:js|css)""",
        r"""importScripts\(\s*['"`]/static/""",
    ]
    bad = []
    for path in sorted(STATIC.rglob("*.js")):
        if "vendor" in path.parts:
            continue
        for n, line in enumerate(path.read_text().splitlines(), 1):
            if any(re.search(p, line) for p in patterns) and "NP_STATIC_V" not in line:
                bad.append(f"{path.relative_to(STATIC)}:{n} {line.strip()}")
    assert not bad, "unversioned URLs handed to the browser:\n" + "\n".join(bad)
