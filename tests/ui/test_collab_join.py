"""The collaboration join page (/join), on Playwright.

The joiner page's inline script once wired `addTaskBtn`, `newTaskName`,
`addRaidBtn` and `newRaidTitle` after those elements had left the template
(the joiner surface moved to the post-its/list tabs). The first
`getElementById(...).addEventListener` threw, the exception aborted the rest
of the script, and the chat listeners registered after it -- Send, Enter and
Download -- were never attached, so a joiner's chat message went nowhere.
tests/test_collab_session.py only fetches the HTML, which cannot see that; it
takes a browser running the script.

`host` below plays the host side in a second page, using the same
/static/collab-crypto.js the real host uses: it publishes the host pubkey,
completes the handshake for the joiner, and decrypts what the joiner sends.

Usage:
    uv run pytest tests/ui/test_collab_join.py -q
"""

import json

import pytest


# Runs in the host page. Starts a session, connects as host, and records every
# message it decrypts from a joiner in `window.hostReceived`.
HOST_SCRIPT = """
async () => {
    const crypto = await import('/static/collab-crypto.js');
    const info = await (await fetch('/api/collab/start', { method: 'POST' })).json();
    const connectKey = await crypto.deriveConnectKey(info.join_code, info.session_id);
    const keyPair = await crypto.generateEphemeralKeyPair();
    const sessionKeys = new Map();
    window.hostReceived = [];

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
        `${protocol}//${location.host}/ws/session/${info.session_id}?token=${encodeURIComponent(info.host_token)}`
    );
    socket.addEventListener('message', async (event) => {
        const wrapped = crypto.unwrapFromJoiner(event.data);
        if (!wrapped) return;
        const frameType = crypto.classifyFrameType(wrapped.frame);
        if (frameType === 'joiner_pubkey') {
            const peerKey = await crypto.parsePubkeyAnnouncement('joiner_pubkey', connectKey, wrapped.frame);
            if (peerKey) {
                sessionKeys.set(
                    wrapped.joinerId,
                    await crypto.deriveSessionKey(keyPair.privateKey, peerKey, info.session_id),
                );
            }
        } else if (frameType === 'enc' && sessionKeys.has(wrapped.joinerId)) {
            const plaintext = await crypto.decryptMessage(
                sessionKeys.get(wrapped.joinerId), wrapped.frame, info.session_id,
            );
            window.hostReceived.push(JSON.parse(plaintext));
        }
    });
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve);
        socket.addEventListener('error', reject);
    });
    socket.send(await crypto.buildPubkeyAnnouncement('host_pubkey', connectKey, keyPair));
    window.hostSocket = socket;
    return info;
}
"""


@pytest.fixture
def host(page, app_server):
    """A second page acting as the session host; yields (host_page, session info)."""
    host_page = page.context.new_page()
    host_page.set_default_timeout(15_000)
    host_page.goto(f"{app_server}/static/collab-crypto.js")
    info = host_page.evaluate(HOST_SCRIPT)
    yield host_page, info
    host_page.close()


def join(page, app_server, info, name="Alex"):
    page.goto(f"{app_server}{info['holding_url']}")
    page.fill("#joinCode", info["join_code"])
    page.fill("#displayName", name)
    page.click("#joinBtn")
    page.wait_for_selector("#relayInput", state="visible", timeout=15_000)


class TestJoinPage:
    def test_join_page_loads_without_page_errors(self, page, app_server, host):
        _, info = host
        page.goto(f"{app_server}{info['holding_url']}")
        page.wait_for_load_state("load")
        assert page.console_errors == []

    def test_joining_raises_no_page_errors(self, page, app_server, host):
        _, info = host
        join(page, app_server, info)
        assert page.console_errors == []

    def test_joiner_chat_message_reaches_the_host(self, page, app_server, host):
        host_page, info = host
        join(page, app_server, info)

        # The Send button is live only once the secure channel is up; until
        # then submitJoinerChat() logs a notice and keeps the text. Retry
        # the click until the input clears, which is the "sent" signal.
        page.fill("#relayInput", "hello from the joiner")
        for _ in range(50):
            page.click("#relaySend")
            if page.input_value("#relayInput") == "":
                break
            page.wait_for_timeout(200)
        assert page.input_value("#relayInput") == ""

        host_page.wait_for_function(
            "window.hostReceived.some(m => m.type === 'chat')", timeout=10_000
        )
        received = host_page.evaluate("window.hostReceived")
        chats = [m for m in received if m["type"] == "chat"]
        assert [m["text"] for m in chats] == ["hello from the joiner"], json.dumps(received)
        assert page.console_errors == []

    def test_enter_in_the_chat_input_sends(self, page, app_server, host):
        host_page, info = host
        join(page, app_server, info)

        page.fill("#relayInput", "sent with enter")
        for _ in range(50):
            page.press("#relayInput", "Enter")
            if page.input_value("#relayInput") == "":
                break
            page.wait_for_timeout(200)

        host_page.wait_for_function(
            "window.hostReceived.some(m => m.type === 'chat' && m.text === 'sent with enter')",
            timeout=10_000,
        )
        assert page.console_errors == []
