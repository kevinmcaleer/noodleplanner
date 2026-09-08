/**
 * collab-session.js -- host-side trigger for the #963 WebSocket relay,
 * now wired up to the #964 end-to-end encryption layer (part of the #766
 * collab-sessions epic).
 *
 * Deliberately thin: this issue is about proving the backend relay (session
 * create, host/joiner handshake, opaque message relay, zero storage) and
 * now the encryption layer work correctly, not about a polished session UI
 * -- that's #966 (presence) and #967 (the real editing protocol). This
 * just starts a session, shows the code + holding link the PM shares with
 * their team, establishes the encrypted channel with the first joiner, and
 * keeps a live WebSocket open so encrypted messages can be relayed and
 * eyeballed (as ciphertext) via devtools during manual verification.
 *
 * See static/collab-crypto.js's module docstring for the full crypto
 * design (KDF, key exchange, AEAD, wire format). Scope note from that file
 * applies here too: the #963 relay has no sender-id on joiner->host
 * messages, so this file tracks a single active joiner session key at a
 * time -- multi-joiner fan-out is future work (#966/#967).
 *
 * This file is a classic (non-module) script -- see index.html's
 * `onclick="startCollabSession()"` / `closeCollabSessionModal()` handlers,
 * which need it to declare plain globals -- so collab-crypto.js (an ES
 * module) is loaded via dynamic `import()`, the same pattern ribbon.js
 * already uses for ribbon-ia.js.
 */

let cryptoModule = null;
function loadCollabCrypto() {
    if (!cryptoModule) cryptoModule = import('/static/collab-crypto.js');
    return cryptoModule;
}

let collabSocket = null;
let collabConnectKey = null;
let collabKeyPair = null;
let collabSessionId = null;
let collabSessionKey = null; // established once a joiner's pubkey is verified

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

/** Send a plaintext string to the joiner, encrypted under the established session key. */
async function sendCollabMessage(plaintext) {
    if (!collabSocket || collabSocket.readyState !== WebSocket.OPEN) return;
    if (!collabSessionKey) {
        collabLog('(cannot send yet -- secure channel not established)');
        return;
    }
    const { encryptMessage } = await loadCollabCrypto();
    const envelope = await encryptMessage(collabSessionKey, plaintext, collabSessionId);
    collabSocket.send(envelope);
}

async function handleCollabMessage(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        parsed = null;
    }

    const { parsePubkeyAnnouncement, deriveSessionKey, decryptMessage } = await loadCollabCrypto();

    if (parsed && parsed.type === 'joiner_pubkey') {
        const peerKey = await parsePubkeyAnnouncement('joiner_pubkey', collabConnectKey, raw);
        if (!peerKey) {
            // MAC didn't verify -- the joiner used the wrong code. Never
            // derive a session key with an unauthenticated peer.
            collabLog('A joiner failed to authenticate (wrong code?) -- ignoring.');
            return;
        }
        collabSessionKey = await deriveSessionKey(collabKeyPair.privateKey, peerKey, collabSessionId);
        collabLog('Secure channel established with joiner.');
        return;
    }

    if (parsed && parsed.type === 'enc') {
        if (!collabSessionKey) {
            collabLog('(received an encrypted message before the secure channel was ready)');
            return;
        }
        try {
            const plaintext = await decryptMessage(collabSessionKey, raw, collabSessionId);
            collabLog(`joiner: ${plaintext}`);
        } catch {
            collabLog('(failed to decrypt a message -- dropped)');
        }
        return;
    }

    // Anything else (e.g. a future non-encrypted control message) is just
    // logged as-is; this thin UI has no other message types to handle yet.
    collabLog(`joiner: ${raw}`);
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
    collabSessionKey = null;

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

    const { deriveConnectKey, generateEphemeralKeyPair, buildPubkeyAnnouncement } = await loadCollabCrypto();

    collabSessionId = info.session_id;
    collabConnectKey = await deriveConnectKey(info.join_code, info.session_id);
    collabKeyPair = await generateEphemeralKeyPair();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    collabSocket = new WebSocket(
        `${protocol}//${window.location.host}/ws/session/${info.session_id}?token=${encodeURIComponent(info.host_token)}`
    );

    collabSocket.addEventListener('open', async () => {
        // First message on the wire, always: publish our ephemeral ECDH
        // public key, MAC'd with the PBKDF2-derived connect key. See
        // collab-crypto.js's module docstring for why this is safe to send
        // in the clear (it's not secret) and how it gets cached server-side
        // for joiners who connect later.
        const announcement = await buildPubkeyAnnouncement('host_pubkey', collabConnectKey, collabKeyPair);
        collabSocket.send(announcement);
    });

    collabSocket.addEventListener('message', (event) => {
        handleCollabMessage(event.data);
    });

    collabSocket.addEventListener('close', () => {
        status.textContent = 'Session ended.';
        collabSocket = null;
        collabSessionKey = null;
    });
}
