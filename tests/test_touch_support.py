"""Regression checks for the touch interaction layer added for issue #814."""

from fastapi.testclient import TestClient

from noodle_web.app import app


def test_shared_controls_have_touch_targets_and_button_semantics():
    client = TestClient(app)
    nav = client.get("/static/nav.js").text
    css = client.get("/static/components.css").text

    assert "button.className = 'category-link'" in nav
    assert "button.dataset.category = value" in nav
    assert "button.dataset.templateId === String(templateId)" in nav
    assert "min-height: 44px" in css
    assert ".nav-menu-item" in css


def test_kanban_has_pointer_drag_and_tap_move_fallbacks():
    client = TestClient(app)
    source = client.get("/static/kanban.js").text
    css = client.get("/static/views/kanban.css").text

    assert "setupPointerColumnDrag" in source
    assert "setupPointerCardDrag" in source
    assert "kanban-card-move-select" in source
    assert "kanban-card-order-btn" in source
    assert "pointercancel" in source
    assert "touch-action: pan-y" in css


def test_noodlesheet_has_touch_edit_context_and_pointer_resize():
    client = TestClient(app)
    source = client.get("/static/noodlesheet.js").text
    css = client.get("/static/noodlesheet.css").text

    assert "_bindCellPointerEvents" in source
    assert "_bindLongPress" in source
    assert "_showCellContextMenu" in source
    assert "addEventListener('pointerdown', (e) => this._initResize" in source
    assert "touch-action: none" in css


def test_schedule_interactions_use_pointer_events_and_tap_editing():
    client = TestClient(app)
    source = client.get("/static/views-gantt.js").text
    css = client.get("/static/views/gantt.css").text

    assert "setupGanttEditableCell" in source
    assert "setPointerCapture" in source
    assert "pointercancel" in source
    assert "addEventListener('mousedown'" not in source
    assert "touch-action: pan-y" in css


def test_diagram_interactions_support_touch_and_visible_actions():
    client = TestClient(app)
    products = client.get("/static/views-products.js").text
    product_css = client.get("/static/views/products.css").text
    benefits = client.get("/static/benefits.js").text
    mindmap = client.get("/static/mindmap.js").text
    portfolio = client.get("/static/portfolio-benefits.js").text
    components = client.get("/static/components.css").text

    assert "pfPendingConnectionSource" in products
    assert "pfClearPendingConnection" in products
    assert "addEventListener('pointerdown'" in products
    assert "addEventListener('mousedown'" not in products
    assert ".pf-connectors" in product_css
    assert "@media (pointer: coarse)" in product_css
    assert "touchcancel" in benefits
    assert "benTouchEditWasMulti" in benefits
    assert "touchcancel" in mindmap
    assert "mindmapTouchEditWasMulti" in mindmap
    assert "setPointerCapture" in portfolio
    assert "addEventListener('mousedown'" not in portfolio
    assert "touch-action: none" in components
