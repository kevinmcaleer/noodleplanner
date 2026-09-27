"""A plan reaches a phone: the phone joins a live planning session (#1389,
epic #1376, decision A).

Plans live in the host's browser, so a phone gets one by joining the host's
session. These tests drive both sides for real -- the host is the full app on
a desktop page, the joiner a 390x844 touch phone in its own browser context:

* the session dialog shows a QR code of the join page with the code in its
  fragment, and takes it down when the session ends;
* opening that link fills in the code (and takes it out of the address bar);
* a phone joiner gets the phone layout and the board as cards, not the
  canvas: no ribbon, no sideways scroll, 44px targets, the chat closed;
* ticking a row and editing a task from a card reach the host's plan.
"""

import pytest

from .helpers import load_plan, open_app, switch_to_whiteboard

pytestmark = pytest.mark.ui

PLAN = """---
title: Session on a phone
---
Design
  Research @alex 2d
  Review 1d
Build
  Code 3d

---whiteboard---
| Task   | X   | Y  | Colour | Width | Height | Collapsed |
|--------|-----|----|--------|-------|--------|-----------|
| Design | 60  | 60 |        | 240   | 180    | no        |
| Build  | 360 | 60 |        | 240   | 180    | no        |
"""


def host_plan(host_page):
    return host_page.evaluate("() => document.getElementById('planEditor').value")


@pytest.fixture
def host(page, app_server):
    """The app on a desktop, with PLAN on its whiteboard, hosting a session."""
    page.set_default_timeout(15_000)
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=2)
    page.evaluate("() => startCollabSession()")
    page.wait_for_function("() => document.getElementById('collabSessionCode').value.length === 6")
    return page, page.input_value("#collabSessionCode")


@pytest.fixture
def joiner(host, device_page, app_server):
    """A phone, joined through the QR code's link, with the cards drawn."""
    _, code = host
    phone = device_page("phone", timeout_ms=15_000)
    phone.goto(f"{app_server}/join#code={code}")
    phone.fill("#displayName", "Sam")
    phone.locator("#joinBtn").tap()
    phone.wait_for_selector("#relayInput", state="attached")
    phone.wait_for_selector("#whiteboardCards > np-note")
    return phone


# ── The host's QR code ──────────────────────────────────────────────────


def test_the_session_dialog_shows_the_join_link_as_a_qr_code(host, app_server):
    host_page, code = host
    qr = host_page.locator("#collabSessionQr")
    qr.wait_for(state="visible")
    assert qr.get_attribute("value") == f"{app_server}/join#code={code}"
    drawn = host_page.evaluate(
        """() => {
            const qr = document.getElementById('collabSessionQr');
            const svg = qr.shadowRoot.querySelector('svg');
            const r = svg.getBoundingClientRect();
            return {
                modules: qr.modules,
                path: svg.querySelector('path').getAttribute('d').length,
                label: svg.getAttribute('aria-label'),
                width: r.width, height: r.height,
                ink: getComputedStyle(svg.querySelector('path')).fill,
                paper: getComputedStyle(svg.querySelector('rect')).fill,
            };
        }"""
    )
    # A 40-odd character link at level M is a version 3 or 4 code.
    assert drawn["modules"] in (29, 33), drawn
    assert drawn["path"] > 0
    assert "scan" in drawn["label"].lower()
    assert drawn["width"] >= 150 and drawn["width"] == drawn["height"]
    assert drawn["ink"] == "rgb(22, 22, 22)" and drawn["paper"] == "rgb(255, 255, 255)"


def test_the_qr_code_stays_dark_on_light_in_the_dark_theme(host):
    host_page, _ = host
    host_page.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
    colours = host_page.evaluate(
        """() => {
            const svg = document.getElementById('collabSessionQr').shadowRoot.querySelector('svg');
            return [getComputedStyle(svg.querySelector('path')).fill, getComputedStyle(svg.querySelector('rect')).fill];
        }"""
    )
    assert colours == ["rgb(22, 22, 22)", "rgb(255, 255, 255)"]


def test_an_ended_session_leaves_nothing_to_scan(host):
    host_page, _ = host
    host_page.locator("#collabSessionQr").wait_for(state="visible")
    host_page.evaluate("() => endCollabSession()")
    host_page.wait_for_function("() => document.getElementById('collabSessionQr').hidden")
    assert host_page.locator(".collab-session-qr").is_hidden()
    assert host_page.locator("#collabSessionQr").get_attribute("value") is None


# ── The phone joins ─────────────────────────────────────────────────────


def test_the_link_fills_in_the_code_and_leaves_the_address_bar(host, device_page, app_server):
    _, code = host
    phone = device_page("phone")
    phone.goto(f"{app_server}/join#code={code}")
    phone.wait_for_function("c => document.getElementById('joinCode').value === c", arg=code)
    assert phone.evaluate("() => location.hash") == ""
    assert phone.evaluate("() => document.activeElement.id") in ("displayName", "joinBtn")


def test_a_phone_joiner_gets_the_phone_layout_and_the_cards(joiner):
    phone = joiner
    assert phone.evaluate("() => document.documentElement.dataset.layout") == "phone"
    assert phone.evaluate("() => document.getElementById('whiteboard-view').dataset.wbMode") == "cards"
    cards = phone.evaluate(
        "() => [...document.querySelectorAll('#whiteboardCards > np-note')].map(n => n.getAttribute('task'))"
    )
    assert cards == ["Design", "Build"]
    assert phone.locator("#whiteboard-view > .wb-content").is_hidden()
    assert phone.locator("#ribbonShell").is_hidden()
    assert phone.locator("#chatPanel").is_hidden()
    assert phone.locator("#whiteboardModeChips").is_visible()


def test_the_joiner_s_phone_does_not_scroll_sideways_and_its_targets_are_44px(joiner):
    phone = joiner
    phone.locator('#whiteboardCards > np-note[task="Design"] .wb-note-expand').tap()
    phone.wait_for_selector('#whiteboardCards .wb-note-row[data-wb-row-task="Review"]')
    result = phone.evaluate(
        """() => {
            const W = innerWidth;
            const small = [];
            const sel = '.session-bar button, #whiteboardCards button, #whiteboardCards np-checkbox';
            for (const el of document.querySelectorAll(sel)) {
                if (!el.getClientRects().length) continue;
                const r = el.getBoundingClientRect();
                if (r.right <= 0 || r.left >= W) continue;
                if (Math.round(Math.min(r.width, r.height)) < 44) small.push(el.id || el.className || el.tagName);
            }
            return { page: document.scrollingElement.scrollWidth > W + 1, small };
        }"""
    )
    assert result == {"page": False, "small": []}


def test_ticking_a_row_on_the_phone_reaches_the_host(joiner, host):
    phone = joiner
    host_page, _ = host
    phone.locator('#whiteboardCards > np-note[task="Design"] .wb-note-expand').tap()
    row = phone.locator('#whiteboardCards .wb-note-row[data-wb-row-task="Review"]')
    row.locator("np-checkbox").tap()
    host_page.wait_for_function(
        "() => document.getElementById('planEditor').value.split('\\n').some(l => /^\\s+Review\\b.*\\b100%/.test(l))"
    )


def test_a_card_row_opens_the_quick_editor_as_a_phone_card(joiner, host):
    phone = joiner
    host_page, _ = host
    phone.locator('#whiteboardCards > np-note[task="Design"] .wb-note-expand').tap()
    phone.locator('#whiteboardCards .wb-note-row[data-wb-row-task="Research"] .wb-note-row-name').tap()
    form = phone.locator(".wb-quick-edit")
    form.wait_for(state="visible")
    assert "wb-quick-edit-phone" in form.get_attribute("class")
    box = form.bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 390 and box["y"] >= 0
    font = phone.evaluate("() => getComputedStyle(document.querySelector('.wb-quick-edit input')).fontSize")
    assert font == "16px"
    phone.fill("#wbQuickEditPercent", "40")
    phone.locator(".wb-quick-edit np-button[variant='primary']").tap()
    host_page.wait_for_function(
        "() => document.getElementById('planEditor').value.split('\\n').some(l => /^\\s+Research\\b.*\\b40%/.test(l))"
    )


def test_a_desktop_joiner_keeps_the_canvas(host, page, app_server):
    _, code = host
    joiner = page.context.new_page()
    joiner.set_default_timeout(15_000)
    joiner.goto(f"{app_server}/join#code={code}")
    joiner.fill("#displayName", "Jo")
    joiner.click("#joinBtn")
    joiner.wait_for_selector("#relayInput", state="visible")
    joiner.wait_for_function("() => document.querySelectorAll('#whiteboardContainer .wb-note').length === 2")
    assert joiner.evaluate("() => document.documentElement.dataset.layout") == "desktop"
    assert joiner.locator("#whiteboardCards").is_hidden()
    assert joiner.locator("#ribbonShell").is_visible()
    assert joiner.locator("#chatPanel").is_visible()
    joiner.close()
