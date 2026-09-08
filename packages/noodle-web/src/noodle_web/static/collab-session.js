/**
 * collab-session.js -- minimal host-side trigger for the #963 WebSocket
 * relay foundation (part of the #766 collab-sessions epic).
 *
 * Deliberately thin: this issue is about proving the backend relay (session
 * create, host/joiner handshake, opaque message relay, zero storage) works
 * correctly, not about a polished session UI -- that's #966 (presence) and
 * #967 (the real editing protocol). This just starts a session, shows the
 * code + holding link the PM shares with their team, and keeps a live
 * WebSocket open to the host endpoint so messages can be relayed and
 * eyeballed via devtools during manual verification.
 */

let collabSocket = null;

function collabLog(line) {
    const log = document.getElementById('collabSessionLog');
    if (!log) return;
    const div = document.createElement('div');
    div.textContent = line;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

function closeCollabSessionModal() {
    const overlay = document.getElementById('collabSessionOverlay');
    if (overlay) overlay.classList.remove('active');
}

async function startCollabSession() {
    const overlay = document.getElementById('collabSessionOverlay');
    const status = document.getElementById('collabSessionStatus');
    const details = document.getElementById('collabSessionDetails');
    if (!overlay || !status || !details) return;

    if (collabSocket && collabSocket.readyState === WebSocket.OPEN) {
        collabSocket.close();
        collabSocket = null;
    }

    overlay.classList.add('active');
    status.textContent = 'Starting session...';
    details.style.display = 'none';

    let info;
    try {
        const response = await fetch('/api/collab/start', { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        info = await response.json();
    } catch (error) {
        status.textContent = 'Could not start a session. Please try again.';
        if (typeof showToast === 'function') showToast('Could not start planning session', 'error');
        return;
    }

    const codeInput = document.getElementById('collabSessionCode');
    const urlInput = document.getElementById('collabSessionUrl');
    if (codeInput) codeInput.value = info.join_code;
    if (urlInput) urlInput.value = `${window.location.origin}${info.holding_url}`;

    status.textContent = 'Session live. Share the code and link below with your team.';
    details.style.display = 'block';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    collabSocket = new WebSocket(
        `${protocol}//${window.location.host}/ws/session/${info.session_id}?token=${encodeURIComponent(info.host_token)}`
    );

    collabSocket.addEventListener('message', (event) => {
        collabLog(`joiner: ${event.data}`);
    });

    collabSocket.addEventListener('close', () => {
        status.textContent = 'Session ended.';
        collabSocket = null;
    });
}
