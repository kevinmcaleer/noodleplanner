"""A neutral icon-only <np-button> has no border.

The status bar's notification bell and the session chat's Expand and Download
buttons are `<np-button icon-only variant="neutral">`. `neutral` is a bordered
button, which is right for a labelled Back or Skip, but on a lone icon it drew
a box that nothing else nearby has -- the close button beside them in the
chat header, the status bar's own buttons. The icon-only form drops it.

Usage:
    uv run pytest tests/ui/test_icon_button_border.py -q
"""

from .helpers import open_app

BORDER = """sel => {
    const host = document.querySelector(sel);
    return getComputedStyle(host.shadowRoot.querySelector('button')).borderTopColor;
}"""

TRANSPARENT = "rgba(0, 0, 0, 0)"


def test_the_notification_bell_has_no_border(page, app_server):
    open_app(page, app_server)
    assert page.evaluate(BORDER, "#statusBarHistoryBtn") == TRANSPARENT


def test_the_session_chat_header_buttons_have_no_border(page, app_server):
    open_app(page, app_server)
    colours = page.evaluate(
        """() => [...document.querySelectorAll('#collabChatPanel .collab-chat-header np-button')]
                .map(b => getComputedStyle(b.shadowRoot.querySelector('button')).borderTopColor)"""
    )
    assert len(colours) == 2
    assert colours == [TRANSPARENT, TRANSPARENT]


def test_a_labelled_neutral_button_keeps_its_border(page, app_server):
    open_app(page, app_server)
    colour = page.evaluate(
        """() => {
            const b = document.createElement('np-button');
            b.setAttribute('variant', 'neutral');
            b.textContent = 'Back';
            document.body.appendChild(b);
            return getComputedStyle(b.shadowRoot.querySelector('button')).borderTopColor;
        }"""
    )
    assert colour != TRANSPARENT
