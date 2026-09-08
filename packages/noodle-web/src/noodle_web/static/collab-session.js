/**
 * collab-session.js -- host-side trigger for the #963 WebSocket relay, the
 * #964 end-to-end encryption layer, and the #966 presence panel (part of
 * the #766 collab-sessions epic).
 *
 * Deliberately thin on the *editing* side: this file proves the backend
 * relay, encryption, and now presence work correctly, not a polished
 * editing UI -- that's #967. It starts a session, shows the code + holding
 * link the PM shares with their team, tracks who's joined/left/active,
 * establishes the encrypted channel with the first joiner, and keeps a
 * live WebSocket open so encrypted messages can be relayed and eyeballed
 * (as ciphertext) via devtools during manual verification.
 *
 * See static/collab-crypto.js's module docstring for the full crypto
 * design (KDF, key exchange, AEAD, wire format, and -- important -- the
 * two-secret design: `join_code` is admission-only, `handshake_secret` is
 * what actually authenticates the ECDH exchange, and the two must never be
 * conflated). One scope note from that file still applies: the relay has
 * no sender-id on the *encrypted content* channel, so this file still
 * tracks a single active joiner session key at a time for that
 * channel -- multi-joiner encrypted content fan-out is #967's problem.
 * Presence (this file's new #966 piece) is a separate, *plaintext*
 * control-message channel the relay itself understands (see
 * collab_session.py's docstring) and was never limited to one joiner.
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

// #966: host presence panel. Keyed by the server-assigned joiner_id (an
// opaque handle -- see collab_session.py's _JOINER_ID_BYTES -- never
// id(websocket), which stays a server-side implementation detail).
// `lastSeen` is *this browser's* clock, set whenever a presence_join or
// presence_heartbeat notification arrives -- active/inactive is computed
// from it locally (see collabPresenceSweep) rather than the server pushing
// a state transition, so the dot can go stale between heartbeats without
// needing any further chatter from the relay.
let collabJoiners = new Map(); // joiner_id -> { displayName, lastSeen }
let collabPresenceSweepTimer = null;

// #966: matches collab_session.py's JOINER_ACTIVE_WINDOW_SECONDS -- three
// missed heartbeats' (collab_join.html's HEARTBEAT_INTERVAL_MS) worth of
// tolerance before a participant's dot flips to inactive.
const COLLAB_ACTIVE_WINDOW_MS = 45000;
const COLLAB_PRESENCE_SWEEP_MS = 5000;

function renderPresencePanel() {
    const list = document.getElementById('collabPresenceList');
    if (!list) return;

    if (collabJoiners.size === 0) {
        list.innerHTML = '<div class="collab-presence-empty">No one has joined yet.</div>';
        return;
    }

    const now = Date.now();
    const rows = Array.from(collabJoiners.entries()).map(([joinerId, joiner]) => {
        const active = (now - joiner.lastSeen) <= COLLAB_ACTIVE_WINDOW_MS;
        const name = escapeHtmlForCollabPresence(joiner.displayName);
        return `<div class="collab-presence-row">
            <span class="collab-presence-dot${active ? ' active' : ' inactive'}" title="${active ? 'Active' : 'Inactive'}"></span>
            <span class="collab-presence-name">${name}</span>
            <button type="button" class="collab-presence-kick" data-joiner-id="${joinerId}" title="Remove ${name}" aria-label="Remove ${name}">
                <i class="bi bi-x-circle" aria-hidden="true"></i>
            </button>
        </div>`;
    });
    list.innerHTML = rows.join('');

    list.querySelectorAll('.collab-presence-kick').forEach((btn) => {
        btn.addEventListener('click', () => kickCollabJoiner(btn.dataset.joinerId));
    });
}

/** Minimal, dependency-free escaping -- this is participant-supplied
 * display_name text going into innerHTML, so it must not be trusted as
 * markup (see #964's own "never trust relay content" stance, applied here
 * to a plaintext field instead of a crypto frame). */
function escapeHtmlForCollabPresence(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function kickCollabJoiner(joinerId) {
    if (!collabSocket || collabSocket.readyState !== WebSocket.OPEN || !joinerId) return;
    collabSocket.send(JSON.stringify({ type: 'kick', joiner_id: joinerId }));
}

function resetCollabPresence() {
    collabJoiners = new Map();
    clearInterval(collabPresenceSweepTimer);
    collabPresenceSweepTimer = setInterval(renderPresencePanel, COLLAB_PRESENCE_SWEEP_MS);
    renderPresencePanel();
}

/** True for one of #966's presence control messages -- handled here,
 * before classifyFrameType() ever sees them, the same way collab_join.html
 * special-cases the "joined" ack before its own crypto-frame dispatch. */
function handleCollabPresenceMessage(parsed) {
    if (parsed.type === 'presence_join') {
        collabJoiners.set(parsed.joiner_id, { displayName: parsed.display_name, lastSeen: Date.now() });
        renderPresencePanel();
        return true;
    }
    if (parsed.type === 'presence_leave') {
        collabJoiners.delete(parsed.joiner_id);
        renderPresencePanel();
        return true;
    }
    if (parsed.type === 'presence_heartbeat') {
        const joiner = collabJoiners.get(parsed.joiner_id);
        if (joiner) {
            joiner.lastSeen = Date.now();
            renderPresencePanel();
        }
        return true;
    }
    return false;
}

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

/** Host-initiated explicit end (#965) -- see app.py's
 * _is_end_session_message() docstring for why this is a WS message rather
 * than a new HTTP endpoint: the host already has a live relay connection
 * open, and ending the session is a live action on it, same as any other
 * relay message. */
function endCollabSession() {
    if (!collabSocket || collabSocket.readyState !== WebSocket.OPEN) return;
    collabSocket.send(JSON.stringify({ type: 'end_session' }));
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
    // #966: presence control messages are plain JSON with a `type` the
    // crypto layer doesn't know about -- peek for them first, exactly how
    // collab_join.html special-cases its own "joined" ack before handing
    // off to classifyFrameType().
    let maybePresence = null;
    try { maybePresence = JSON.parse(raw); } catch { maybePresence = null; }
    if (maybePresence && typeof maybePresence === 'object' && handleCollabPresenceMessage(maybePresence)) {
        return;
    }

    const { classifyFrameType, parsePubkeyAnnouncement, deriveSessionKey, decryptMessage } = await loadCollabCrypto();
    const frameType = classifyFrameType(raw);

    if (frameType === 'joiner_pubkey') {
        const peerKey = await parsePubkeyAnnouncement('joiner_pubkey', collabConnectKey, raw);
        if (!peerKey) {
            // MAC didn't verify -- the joiner used the wrong handshake
            // secret (or this is a forged announcement, e.g. from the
            // relay itself -- see collab-crypto.js's module docstring).
            // Never derive a session key with an unauthenticated peer.
            collabLog('A joiner failed to authenticate -- ignoring.');
            return;
        }
        collabSessionKey = await deriveSessionKey(collabKeyPair.privateKey, peerKey, collabSessionId);
        collabLog('Secure channel established with joiner.');
        return;
    }

    if (frameType === 'enc') {
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

    // Anything else -- including `classifyFrameType`'s 'unrecognized', and
    // even a well-formed-but-wrong-role 'host_pubkey' (the host should
    // never receive its own frame type back). Security review finding:
    // this used to fall through to displaying the raw payload with the
    // same log format as genuine decrypted content -- meaning anyone who
    // could write a frame into this socket (trivially, the relay itself)
    // could inject a message that looked exactly like real peer content,
    // no decryption or authentication required. Never display unrecognized
    // frames as if they were peer content; just note one arrived and drop
    // it.
    collabLog('(received an unrecognized message -- ignored)');
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
    resetCollabPresence();

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
    // info.holding_url already carries the `#k=<handshake_secret>` URL
    // fragment (see collab_session.py) -- sharing this exact link is how
    // the joiner's browser gets the handshake secret without it ever
    // passing through the server.
    if (urlInput) urlInput.value = `${window.location.origin}${info.holding_url}`;

    status.textContent = 'Session live. Share the code and link below with your team.';
    details.style.display = 'block';

    const { deriveConnectKey, generateEphemeralKeyPair, buildPubkeyAnnouncement } = await loadCollabCrypto();

    collabSessionId = info.session_id;
    // #964 security review: `join_code` (six digits, admission-only -- the
    // relay legitimately sees it) must NEVER be used here. The ECDH
    // handshake is authenticated with `handshake_secret` instead, which
    // only ever travels via the URL fragment / this JSON response, never
    // through the relay -- see collab-crypto.js's module docstring.
    collabConnectKey = await deriveConnectKey(info.handshake_secret, info.session_id);
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

    collabSocket.addEventListener('close', (event) => {
        // #965: a close `reason` is set whenever the server tore the
        // session down itself (idle timeout, or this host's own explicit
        // end_session action echoed back) -- see collab_session.py's
        // CLOSE_* constants. A reason-less close means the host's own
        // browser closed the socket (e.g. tab/page navigating away), so
        // the generic message stays accurate for that case.
        status.textContent = event.reason || 'Session ended.';
        collabSocket = null;
        collabSessionKey = null;
        clearInterval(collabPresenceSweepTimer);
        collabPresenceSweepTimer = null;
        collabJoiners = new Map();
        renderPresencePanel();
    });
}
