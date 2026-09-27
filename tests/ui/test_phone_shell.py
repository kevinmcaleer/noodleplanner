"""The phone's app bar, view chips and navigation drawer (#1380, epic #1376).

With `data-layout="phone"` the ribbon and the status bar give way to an app
bar, a strip of view chips and a slide-out drawer (static/phone-shell.js and
the np-app-bar / np-view-chips / np-nav-drawer components). Measured on a
390x844 touch phone:

* the ribbon and status bar are hidden, and the shell is not shown on a
  tablet or a desktop;
* the drawer lists exactly the router's views -- no more, no fewer;
* a phone-first view is one tap away, any other view two;
* the drawer traps focus and closes on Escape, a backdrop tap or a swipe to
  the left, handing focus back to the menu button;
* every target in the shell is at least 44x44, and the chrome is 110px or
  less;
* the status bar's RAG dot and message bell reach the app bar.
"""

from .helpers import load_plan, open_app

PLAN = """---
title: Phone shell
---

Design
  Research @alex 2d
"""

DRAWER_VIEWS = """() => [...document.getElementById('phoneNavDrawer').shadowRoot
    .querySelectorAll('button[data-id^="view:"]')].map(b => b.dataset.id.slice(5))"""

DEEP_ACTIVE = """() => {
    let el = document.activeElement;
    const path = [];
    while (el) {
        path.push((el.id || el.className || el.tagName).toString());
        el = el.shadowRoot && el.shadowRoot.activeElement;
    }
    return path;
}"""


def _open_drawer(pg):
    pg.evaluate("() => document.getElementById('phoneAppBar').menuButton.click()")
    pg.wait_for_function("() => document.getElementById('phoneNavDrawer').hasAttribute('open')")


def _current(pg):
    pg.wait_for_function("() => !NavigationController.isTransitioning()")
    return pg.evaluate("() => NavigationController.getCurrentView()")


def test_a_phone_gets_the_app_bar_instead_of_the_ribbon(phone, app_server):
    open_app(phone, app_server)
    shown = phone.evaluate(
        """() => Object.fromEntries(['#ribbonShell', '.status-bar', '#phoneAppBar', '#phoneViewChips']
            .map(sel => [sel, getComputedStyle(document.querySelector(sel)).display !== 'none'
                && document.querySelector(sel).getBoundingClientRect().height > 0]))"""
    )
    assert shown == {"#ribbonShell": False, ".status-bar": False, "#phoneAppBar": True, "#phoneViewChips": True}


def test_tablets_and_desktops_keep_the_ribbon(tablet_portrait, page, app_server):
    for pg in (tablet_portrait, page):
        open_app(pg, app_server)
        assert pg.evaluate("() => getComputedStyle(document.getElementById('phoneShell')).display") == "none"
        assert pg.evaluate("() => document.getElementById('ribbonShell').getBoundingClientRect().height") > 0


def test_the_drawer_lists_exactly_the_router_s_views(phone, app_server):
    open_app(phone, app_server)
    _open_drawer(phone)
    listed = phone.evaluate(DRAWER_VIEWS)
    assert len(listed) == len(set(listed)), "a view is listed twice"

    routed = phone.evaluate(
        """() => {
            const shells = NoodleViewCatalogue.SHELLS;
            return Object.keys(NavigationController.getRegistry()).filter(v => !shells.includes(v));
        }"""
    )
    project = sorted(v for v in listed if not v.startswith("portfolio:"))
    assert project == sorted(routed)

    # The portfolio's own sub-views, as portfolio.js switches between them.
    portfolio = sorted(v.split(":", 1)[1] for v in listed if v.startswith("portfolio:"))
    known = phone.evaluate(
        """() => {
            const src = switchPortfolioView.toString();
            return [...src.matchAll(/viewName === '([a-z]+)'/g)].map(m => m[1]);
        }"""
    )
    assert portfolio == sorted(set(known))


def test_a_phone_first_view_is_one_tap_away(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    phone.locator("#phoneViewChips button[data-id='kanban']").tap()
    assert _current(phone) == "kanban"
    assert phone.evaluate(
        "() => document.getElementById('phoneViewChips').shadowRoot"
        ".querySelector('[aria-current=page]').dataset.id"
    ) == "kanban"
    assert phone.evaluate("() => document.getElementById('phoneAppBar').getAttribute('subheading')") == "Board"


def test_any_other_view_is_two_taps_away(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _open_drawer(phone)
    phone.locator("#phoneNavDrawer button[data-id='view:stakeholders']").tap()
    assert _current(phone) == "stakeholders"
    assert not phone.evaluate("() => document.getElementById('phoneNavDrawer').hasAttribute('open')")

    _open_drawer(phone)
    phone.locator("#phoneNavDrawer button[data-id='view:portfolio:risks']").tap()
    assert _current(phone) == "portfolio"
    phone.wait_for_function("() => getComputedStyle(document.getElementById('portfolioRisksView')).display !== 'none'")


def test_the_drawer_traps_focus_and_escape_hands_it_back(phone, app_server):
    open_app(phone, app_server)
    _open_drawer(phone)
    for _ in range(60):
        phone.keyboard.press("Tab")
        path = phone.evaluate(DEEP_ACTIVE)
        assert "phoneNavDrawer" in path, f"focus left the drawer: {path}"
    phone.keyboard.press("Shift+Tab")
    assert "phoneNavDrawer" in phone.evaluate(DEEP_ACTIVE)

    phone.keyboard.press("Escape")
    assert not phone.evaluate("() => document.getElementById('phoneNavDrawer').hasAttribute('open')")
    path = phone.evaluate(DEEP_ACTIVE)
    assert path[:2] == ["phoneAppBar", "menu"], path
    assert phone.evaluate(
        "() => document.getElementById('phoneAppBar').menuButton.getAttribute('aria-expanded')"
    ) == "false"


def test_a_backdrop_tap_closes_the_drawer(phone, app_server):
    open_app(phone, app_server)
    _open_drawer(phone)
    phone.wait_for_timeout(300)
    phone.touchscreen.tap(370, 400)  # right of the 320px panel
    phone.wait_for_function("() => !document.getElementById('phoneNavDrawer').hasAttribute('open')")


def test_a_swipe_left_closes_the_drawer(phone, app_server):
    open_app(phone, app_server)
    _open_drawer(phone)
    phone.evaluate(
        """() => {
            const panel = document.getElementById('phoneNavDrawer').shadowRoot.querySelector('.panel');
            const at = (type, x) => panel.dispatchEvent(new PointerEvent(type, {
                bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 400,
            }));
            at('pointerdown', 250);
            at('pointerup', 120);
        }"""
    )
    phone.wait_for_function("() => !document.getElementById('phoneNavDrawer').hasAttribute('open')")


def test_every_shell_target_is_44px_and_the_chrome_is_110px_or_less(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _open_drawer(phone)
    phone.wait_for_timeout(300)
    sizes = phone.evaluate(
        """() => {
            const out = [];
            const collect = (root, where) => {
                for (const el of root.querySelectorAll('button, np-button')) {
                    const r = el.getBoundingClientRect();
                    if (!r.width || !r.height || getComputedStyle(el).display === 'none') continue;
                    if (el.closest('[hidden]')) continue;
                    out.push({ where, label: el.getAttribute('label') || el.textContent.trim().slice(0, 20),
                               w: Math.round(r.width), h: Math.round(r.height) });
                }
            };
            collect(document.getElementById('phoneAppBar').shadowRoot, 'app bar');
            collect(document.getElementById('phoneAppBar'), 'app bar actions');
            collect(document.getElementById('phoneViewChips').shadowRoot, 'chips');
            collect(document.getElementById('phoneNavDrawer').shadowRoot, 'drawer');
            return out;
        }"""
    )
    small = [s for s in sizes if s["w"] < 44 or s["h"] < 44]
    assert sizes and not small, small

    chrome = phone.evaluate(
        "() => document.getElementById('phoneViewChips').getBoundingClientRect().bottom"
    )
    assert chrome <= 110


def test_the_app_bar_pads_itself_below_the_notch(phone, app_server):
    open_app(phone, app_server)
    css = phone.evaluate(
        "() => [...document.getElementById('phoneAppBar').shadowRoot.querySelectorAll('style')]"
        ".map(s => s.textContent).join('')"
    )
    assert "env(safe-area-inset-top" in css


def test_the_title_opens_the_plan_switcher(phone, app_server):
    open_app(phone, app_server)
    phone.evaluate("() => { const p = createProject('Office Move'); setCurrentProjectId(p.id); }")
    phone.evaluate("() => NoodlePhoneShell.refresh()")
    assert phone.evaluate("() => document.getElementById('phoneAppBar').getAttribute('heading')") == "Office Move"
    phone.evaluate("() => document.getElementById('phoneAppBar').titleButton.click()")
    phone.wait_for_function("() => document.getElementById('phoneSheet').hasAttribute('open')")
    labels = phone.evaluate(
        "() => [...document.getElementById('phoneSheet').shadowRoot.querySelectorAll('.item .label')]"
        ".map(e => e.textContent)"
    )
    assert "Office Move" in labels and "New plan" in labels


def test_the_status_bar_s_rag_and_messages_reach_the_app_bar(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    phone.wait_for_function("() => !document.getElementById('phoneRagDot').hidden")
    phone.evaluate(
        "() => pushStatusLogEntry({ text: 'Two tasks overlap', key: 'test', "
        "actions: [{ label: 'Fix', run: () => {} }] })"
    )
    phone.wait_for_function(
        "() => document.getElementById('phoneBellBtn').classList.contains('has-actionable')"
    )
    _open_drawer(phone)
    assert phone.evaluate(
        "() => !!document.getElementById('phoneNavDrawer').shadowRoot"
        ".querySelector('[data-id=\"cmd:messages\"] .badge')"
    )
