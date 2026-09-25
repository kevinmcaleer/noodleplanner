"""NoodlePlanner is installable as a Progressive Web App (issue #809).

Browsers install a site when it serves a manifest with a name, a start URL,
a standalone display mode and icons of at least 192 and 512 pixels, and when
a service worker controlling the start URL is registered. These tests check
each of those pieces is served the way browsers expect, so a change cannot
quietly make the app uninstallable again.
"""

import json
import re
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from noodle_web import app
from noodle_web.app import STATIC_VERSION

STATIC = Path(__file__).resolve().parent.parent / "packages" / "noodle-web" / "src" / "noodle_web" / "static"


@pytest.fixture
def client():
    from noodle_web.security import reset_rate_limit_store

    reset_rate_limit_store()
    return TestClient(app)


def png_size(data: bytes):
    """Width and height from a PNG's IHDR chunk, without an image library."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    return struct.unpack(">II", data[16:24])


class TestManifest:
    def test_served_with_the_manifest_media_type(self, client):
        response = client.get("/manifest.webmanifest")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/manifest+json")

    def test_declares_what_installation_needs(self, client):
        manifest = client.get("/manifest.webmanifest").json()
        assert manifest["name"] == "Noodle Planner"
        assert manifest["short_name"]
        assert manifest["start_url"] == "/"
        assert manifest["scope"] == "/"
        assert manifest["display"] == "standalone"
        assert re.fullmatch(r"#[0-9a-fA-F]{6}", manifest["theme_color"])
        assert re.fullmatch(r"#[0-9a-fA-F]{6}", manifest["background_color"])
        sizes = {(icon["sizes"], icon.get("purpose", "any")) for icon in manifest["icons"]}
        assert {("192x192", "any"), ("512x512", "any")} <= sizes
        assert {("192x192", "maskable"), ("512x512", "maskable")} <= sizes

    def test_every_icon_exists_and_is_the_size_it_claims(self, client):
        manifest = json.loads((STATIC / "manifest.webmanifest").read_text())
        for icon in manifest["icons"]:
            response = client.get(icon["src"])
            assert response.status_code == 200, icon["src"]
            assert response.headers["content-type"] == "image/png"
            declared = tuple(int(n) for n in icon["sizes"].split("x"))
            assert png_size(response.content) == declared, icon["src"]

    def test_apple_touch_icon_is_served(self, client):
        response = client.get("/static/icons/apple-touch-icon.png")
        assert response.status_code == 200
        assert png_size(response.content) == (180, 180)


class TestServiceWorker:
    def test_served_from_the_root_with_a_whole_site_scope(self, client):
        response = client.get("/sw.js")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/javascript")
        assert response.headers["service-worker-allowed"] == "/"
        assert "no-cache" in response.headers["cache-control"]

    def test_stamped_with_the_deploy_version(self, client):
        source = client.get("/sw.js").text
        assert "__STATIC_VERSION__" not in source
        assert f'const VERSION = "{STATIC_VERSION}";' in source

    def test_never_touches_api_or_writes(self):
        """The worker must not cache API responses or non-GET requests: the
        plan is live data and a stale cache would show a wrong schedule."""
        source = (STATIC / "sw.js").read_text()
        assert 'request.method !== "GET"' in source
        assert '/static/' in source
        assert "/api/" not in source.replace("(/api/, /render, POSTs", ""), (
            "the worker should not name API routes as something it handles"
        )

    def test_unversioned_static_assets_go_to_the_network_first(self):
        """A module imported at run time has no ?v= hash (ribbon.js's
        import('/static/ribbon-ia.js')), so serving it cache-first would hand
        out the previous deploy's copy while the old worker still controls
        the page -- a new ribbon.js drawing old ribbon-ia.js buttons."""
        source = (STATIC / "sw.js").read_text()
        assert 'url.searchParams.has("v") ? cacheFirst(request) : networkFirst(request)' in source


class TestPage:
    def test_page_links_the_manifest_and_registers_the_worker(self, client):
        html = client.get("/").text
        assert '<link rel="manifest" href="/manifest.webmanifest">' in html
        assert '<meta name="theme-color" content="#209080">' in html
        assert '<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">' in html
        assert "navigator.serviceWorker.register('/sw.js', {" in html
        assert "updateViaCache: 'none'" in html

    def test_active_page_reloads_when_a_new_worker_takes_control(self, client):
        html = client.get("/").text
        assert "navigator.serviceWorker.addEventListener('controllerchange'" in html
        assert "if (!wasControlled) {" in html
        assert "wasControlled = true;" in html
        assert "if (reloadingForUpdate) return;" in html
        assert "saveCurrentProjectState();" in html
        assert "window.location.reload();" in html

    def test_open_app_checks_for_worker_updates(self, client):
        html = client.get("/").text
        assert "registration.update()" in html
        assert "document.addEventListener('visibilitychange'" in html
        assert "window.addEventListener('online', checkForUpdate)" in html
        assert "15 * 60 * 1000" in html

    def test_checks_for_a_worker_update_immediately_on_registration(self, client):
        """A tab open across a deploy (or a burst of several close together)
        must not have to wait for a visibility change, an online event, or
        the periodic interval before it even notices -- register() success
        must trigger a check right away too."""
        html = client.get("/").text
        register_start = html.index("navigator.serviceWorker.register('/sw.js'")
        then_start = html.index(".then(function (registration)", register_start)
        first_listener = min(
            html.index("document.addEventListener('visibilitychange'", then_start),
            html.index("window.addEventListener('online', checkForUpdate)", then_start),
        )
        immediate_call_pos = html.index("checkForUpdate();", then_start)
        assert then_start < immediate_call_pos < first_listener, (
            "checkForUpdate() must be called once immediately after registration, "
            "before the event listeners that only fire on some future event"
        )

    def test_page_displays_the_app_and_build_version(self, client):
        html = client.get("/").text
        assert 'id="statusBarAppVersion"' in html
        assert f"App v{app.version}+{STATIC_VERSION}" in html

    def test_csp_allows_a_same_origin_worker_and_manifest(self, client):
        csp = client.get("/").headers["content-security-policy"]
        assert "default-src 'self'" in csp
        assert "worker-src 'none'" not in csp
        assert "manifest-src 'none'" not in csp
