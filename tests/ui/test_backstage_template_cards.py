"""Portrait template cards in Backstage (#945) and the seed set behind them (#946).

Each card is a picture of the template's shape -- stacked phase rows with
milestone bubbles -- above its name, drawn from the template's plan once it
is read. The pure drawing is covered by tests/test_template_card.mjs; these
cover the card in the page: the strip, the full browser, and that picking a
card still makes a new plan.

Usage:
    uv run pytest -m ui tests/ui/test_backstage_template_cards.py -q
"""

from .helpers import open_app


def _open_backstage(page, app_server):
    open_app(page, app_server)
    page.evaluate("() => switchToView('backstage')")
    page.wait_for_selector("#backstage-tab.active")
    page.wait_for_selector("#backstageTemplateStrip .backstage-card-row")


class TestTemplateStrip:
    def test_strip_is_blank_plus_four_popular_templates(self, page, app_server):
        _open_backstage(page, app_server)
        cards = page.locator("#backstageTemplateStrip .backstage-template-card")
        assert cards.count() == 5
        assert page.locator("#backstageTemplateStrip .backstage-template-card-blank").count() == 1

    def test_software_deployment_is_in_the_strip(self, page, app_server):
        _open_backstage(page, app_server)
        card = page.locator(
            '#backstageTemplateStrip .backstage-template-card[data-template-id="software-deployment"]'
        )
        assert card.count() == 1
        assert card.locator(".backstage-template-card-name").inner_text() == "Software Deployment"

    def test_every_real_card_draws_phase_rows_and_milestone_bubbles(self, page, app_server):
        _open_backstage(page, app_server)
        page.wait_for_function(
            "() => [...document.querySelectorAll('#backstageTemplateStrip"
            " .backstage-template-card-portrait')].every("
            "c => c.querySelector('.backstage-card-row'))"
        )
        deployment = page.locator(
            '#backstageTemplateStrip [data-template-id="software-deployment"]'
        )
        assert deployment.locator(".backstage-card-row").count() == 5
        assert deployment.locator(".backstage-card-bubble").count() >= 5
        assert "5 phases" in deployment.locator(".backstage-card-summary").inner_text()

    def test_card_shape_is_hidden_from_assistive_tech(self, page, app_server):
        _open_backstage(page, app_server)
        shape = page.locator("#backstageTemplateStrip .backstage-card-shape").first
        assert shape.get_attribute("aria-hidden") == "true"


class TestTemplateBrowser:
    def test_more_templates_lists_every_seed_template_as_a_portrait_card(self, page, app_server):
        _open_backstage(page, app_server)
        page.click("#backstageMoreTemplatesBtn")
        page.wait_for_selector("#backstageTemplateGrid .backstage-card-row")
        ids = page.eval_on_selector_all(
            "#backstageTemplateGrid .backstage-template-card-portrait",
            "els => els.map(e => e.dataset.templateId)",
        )
        assert "software-deployment" in ids and "software-delivery" in ids
        assert not any("_" in i for i in ids)

    def test_cards_in_the_strip_are_one_height(self, page, app_server):
        _open_backstage(page, app_server)
        heights = page.eval_on_selector_all(
            "#backstageTemplateStrip .backstage-template-card",
            "els => els.map(e => Math.round(e.getBoundingClientRect().height))",
        )
        assert len(set(heights)) == 1, f"cards in the strip should be one height: {heights}"


class TestPickingACard:
    def test_picking_a_template_still_creates_a_new_plan(self, page, app_server):
        _open_backstage(page, app_server)
        page.once("dialog", lambda d: d.accept("Release 42"))
        page.locator(
            '#backstageTemplateStrip [data-template-id="software-deployment"]'
        ).click()
        page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('title: Release 42')"
        )
        assert "Release readiness".lower() in page.evaluate(
            "() => document.getElementById('planEditor').value"
        ).lower()
