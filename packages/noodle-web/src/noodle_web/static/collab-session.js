/**
 * collab-session.js -- host-side trigger for the #963 WebSocket relay,
 * wired up to the #964 end-to-end encryption layer and #965's lifecycle
 * controls, now with a #966 presence panel (part of the #766
 * collab-sessions epic).
 *
 * Deliberately thin: this issue is about proving the backend relay (session
 * create, host/joiner handshake, opaque message relay, zero storage) and
 * the encryption layer work correctly, not about a polished session UI --
 * that's still #967 (the real editing protocol) for anything beyond
 * presence. This starts a session, shows the code + holding link the PM
 * shares with their team, establishes the encrypted channel with the first
 * joiner, keeps a live WebSocket open so encrypted messages can be relayed
 * and eyeballed (as ciphertext) via devtools during manual verification,
 * and now renders who has joined/is active and lets the host remove one.
 *
 * See static/collab-crypto.js's module docstring for the full crypto
 * design (KDF, key exchange, AEAD, wire format, and -- important -- the
 * two-secret design: `join_code` is admission-only, `handshake_secret` is
 * what actually authenticates the ECDH exchange, and the two must never be
 * conflated).
 *
 * #967 lifted the single-joiner limit this file used to carry. The relay
 * now tags every joiner->host frame with its sender id (app.py's
 * `_wrap_from_joiner`) and routes host->joiner frames addressed at one
 * joiner (`_parse_to_joiner_envelope`), so `collabSessionKeys` below holds
 * a separate ECDH session key per joiner and `sendCollabMessage` encrypts
 * each outgoing message once per recipient. Those ids are the same ones
 * #966's presence snapshots already carry, so presence and crypto agree on
 * who is in the session without a second identity scheme.
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
// #967: one AES-GCM session key per joiner, keyed by the relay-assigned
// `joiner_id` that arrives on every inbound frame (see collab-crypto.js's
// `unwrapFromJoiner`) and in every presence snapshot. #963/#964 held a
// single key here, which meant a second joiner's handshake silently
// replaced the first joiner's key and the host could only ever talk to
// whoever joined last.
const collabSessionKeys = new Map();

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

/** Host-initiated removal of one participant (#966) -- see app.py's
 * `_parse_kick_message` docstring for the `joiner_id` contract (the same
 * id each presence snapshot already carries per joiner). */
function kickCollabJoiner(joinerId) {
    if (!collabSocket || collabSocket.readyState !== WebSocket.OPEN) return;
    collabSocket.send(JSON.stringify({ type: 'kick', joiner_id: joinerId }));
}

/** Render the #966 presence panel from the host's latest `{"type":
 * "presence", "joiners": [...]}` snapshot -- see
 * collab_session.py's `SessionState.presence_snapshot()` for the payload
 * shape (`id`, `display_name`, `active`). Hidden entirely while no one has
 * joined yet. */
function renderCollabPresence(joiners) {
    const panel = document.getElementById('collabPresencePanel');
    const list = document.getElementById('collabPresenceList');
    if (!panel || !list) return;

    if (!Array.isArray(joiners) || joiners.length === 0) {
        panel.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    panel.style.display = 'block';
    list.innerHTML = '';
    for (const joiner of joiners) {
        const row = document.createElement('div');
        row.className = 'collab-presence-row';

        const dot = document.createElement('span');
        dot.className = `collab-presence-dot ${joiner.active ? 'active' : 'inactive'}`;
        dot.title = joiner.active ? 'Active' : 'Inactive';
        row.appendChild(dot);

        const name = document.createElement('span');
        name.className = 'collab-presence-name';
        name.textContent = joiner.display_name;
        row.appendChild(name);

        const statusLabel = document.createElement('span');
        statusLabel.className = 'collab-presence-status';
        statusLabel.textContent = joiner.active ? 'Active' : 'Inactive';
        row.appendChild(statusLabel);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-outline-danger btn-sm';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => kickCollabJoiner(joiner.id));
        row.appendChild(removeBtn);

        list.appendChild(row);
    }
}

/** Drop session keys for joiners who are no longer in the session (#967).
 *
 * Presence snapshots are the host's authoritative view of who is
 * connected, so a joiner missing from one has left or been removed. Their
 * key is useless from that moment -- keeping it would mean encrypting
 * later broadcasts for a socket that no longer exists, and holding key
 * material for a departed participant for the rest of the session. */
function pruneCollabSessionKeys(joiners) {
    const live = new Set((Array.isArray(joiners) ? joiners : []).map((joiner) => joiner.id));
    for (const joinerId of [...collabSessionKeys.keys()]) {
        if (!live.has(joinerId)) collabSessionKeys.delete(joinerId);
    }
}

/** Send a plaintext string to every joiner with an established secure
 * channel (#967).
 *
 * Each joiner has its own session key, so the same message is encrypted
 * separately per joiner and addressed individually -- there is no shared
 * key a single broadcast could use. Returns the number of joiners it
 * reached, which is what makes "did this actually go anywhere?" testable
 * without inspecting the socket. */
async function sendCollabMessage(plaintext) {
    if (!collabSocket || collabSocket.readyState !== WebSocket.OPEN) return 0;
    if (collabSessionKeys.size === 0) {
        collabLog('(cannot send yet -- no secure channel established)');
        return 0;
    }
    const { encryptMessage, buildToJoinerEnvelope } = await loadCollabCrypto();
    let sent = 0;
    for (const [joinerId, key] of collabSessionKeys) {
        const ciphertext = await encryptMessage(key, plaintext, collabSessionId);
        collabSocket.send(buildToJoinerEnvelope(joinerId, ciphertext));
        sent++;
    }
    return sent;
}

async function handleCollabMessage(raw) {
    const {
        classifyFrameType, parsePubkeyAnnouncement, deriveSessionKey, decryptMessage, unwrapFromJoiner,
    } = await loadCollabCrypto();
    let frameType = classifyFrameType(raw);

    // #967: everything a joiner sends now reaches the host wrapped with
    // that joiner's id. Unwrap first, then classify the inner frame
    // exactly as before -- the checks below are unchanged, they just now
    // know which joiner the frame came from.
    let joinerId = null;
    let frame = raw;
    if (frameType === 'from_joiner') {
        const unwrapped = unwrapFromJoiner(raw);
        if (!unwrapped) {
            collabLog('(received a malformed relay envelope -- ignored)');
            return;
        }
        joinerId = unwrapped.joinerId;
        frame = unwrapped.frame;
        frameType = classifyFrameType(frame);
    }

    if (frameType === 'joiner_pubkey') {
        if (joinerId === null) {
            // A joiner_pubkey that didn't arrive inside a from_joiner
            // envelope has no identifiable sender, so there is no key slot
            // to put it in. Only the relay could produce that.
            collabLog('(received an unaddressed joiner handshake -- ignored)');
            return;
        }
        const peerKey = await parsePubkeyAnnouncement('joiner_pubkey', collabConnectKey, frame);
        if (!peerKey) {
            // MAC didn't verify -- the joiner used the wrong handshake
            // secret (or this is a forged announcement, e.g. from the
            // relay itself -- see collab-crypto.js's module docstring).
            // Never derive a session key with an unauthenticated peer.
            collabLog('A joiner failed to authenticate -- ignoring.');
            return;
        }
        collabSessionKeys.set(joinerId, await deriveSessionKey(collabKeyPair.privateKey, peerKey, collabSessionId));
        collabLog('Secure channel established with joiner.');
        return;
    }

    if (frameType === 'enc') {
        const key = joinerId === null ? null : collabSessionKeys.get(joinerId);
        if (!key) {
            collabLog('(received an encrypted message before the secure channel was ready)');
            return;
        }
        try {
            const plaintext = await decryptMessage(key, frame, collabSessionId);
            collabLog(`joiner: ${plaintext}`);
        } catch {
            collabLog('(failed to decrypt a message -- dropped)');
        }
        return;
    }

    if (frameType === 'presence') {
        // #966: sent by the server itself, not a joiner -- plaintext by
        // design (see collab-crypto.js's KNOWN_FRAME_TYPES comment), so no
        // decryption step here, just parse and render.
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        renderCollabPresence(parsed.joiners);
        pruneCollabSessionKeys(parsed.joiners);
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
    collabSessionKeys.clear();
    renderCollabPresence([]);

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
        collabSessionKeys.clear();
        renderCollabPresence([]);
    });
}
