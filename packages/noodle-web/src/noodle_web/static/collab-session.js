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
 * presence. This starts a session, shows the code + join link the PM
 * shares with their team, establishes the encrypted channel with the first
 * joiner, keeps a live WebSocket open so encrypted messages can be relayed
 * and eyeballed (as ciphertext) via devtools during manual verification,
 * and now renders who has joined/is active and lets the host remove one.
 *
 * See static/collab-crypto.js's module docstring for the full crypto
 * design (KDF, key exchange, AEAD, wire format, and why the six-digit
 * join code is what authenticates the ECDH exchange).
 *
 * #969 extends #967's op model from the task outline to the RAID/risk log
 * -- see collab-backmatter-ops.js's module docstring for the row-op
 * protocol and why it's RAID only for now. It rides the exact same
 * `enc` frame and relay as everything else here: `applyCollabBackmatterOp`
 * and `broadcastCollabPlan`'s `raidNotice` parameter are the only new
 * surface, added right alongside the task-op equivalents they mirror.
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

let opsModule = null;
function loadCollabOps() {
    if (!opsModule) opsModule = import('/static/collab-ops.js');
    return opsModule;
}

// #969: the RAID/risk log's row-op counterpart to collab-ops.js's task
// ops -- see collab-backmatter-ops.js's module docstring for why RAID
// only (of the four back-matter sections #969 names) and how the
// row-based op protocol is meant to extend to the others later.
let backmatterOpsModule = null;
function loadCollabBackmatterOps() {
    if (!backmatterOpsModule) backmatterOpsModule = import('/static/collab-backmatter-ops.js');
    return backmatterOpsModule;
}

let autosaveModule = null;
function loadCollabAutosave() {
    if (!autosaveModule) autosaveModule = import('/static/collab-autosave.js');
    return autosaveModule;
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

// #967: the host is the single writer, so it owns the revision counter.
// Every applied op bumps it and every snapshot carries it, which is what
// lets a joiner tell a fresh snapshot from one it has already rendered.
let collabPlanRev = 0;
// joiner_id -> display name, learned from #966's presence snapshots. Used
// only to name whoever superseded an edit in the conflict notice.
const collabJoinerNames = new Map();
let collabLocalEditTimer = null;
// True only while the host is writing a joiner's applied op back into the
// editor -- see applyCollabPlanOp.
let collabApplyingRemoteOp = false;
// #967: tracks who last edited each task, so only edits that actually
// raced another participant produce a conflict notice. Created lazily
// with collab-ops.js, which is loaded on demand.
let collabConflicts = null;
// #969: the same tracking, kept as a *separate* instance keyed by RAID
// row id rather than task name -- see collab-backmatter-ops.js's module
// docstring for why sharing collabConflicts would risk a task id and a
// row id that happen to collide cross-reporting each other's conflicts.
let collabBackmatterConflicts = null;
// #968: debounce handle for the host's local crash-recovery snapshot --
// see collab-autosave.js's module docstring and scheduleCollabAutosave
// below.
let collabAutosaveTimer = null;

// #876: session chat is intentionally memory-only. It is never placed in
// localStorage, the project record, the autosave snapshot, or a server
// request. The only durable path is the explicit "Add to task comment"
// action below, which writes one chosen message into the canonical plan.
const collabChatEntries = [];
const collabChatEntryIds = new Set();
let collabChatUnread = 0;

function collabChatId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Build a bounded, display-safe chat/activity frame. The sender supplied
 * by a joiner is never trusted by the host; handleCollabMessage replaces it
 * with the authenticated presence name before calling this helper. */
function buildCollabChatEntry(type, sender, text, id, timestamp) {
    if (type !== 'chat' && type !== 'activity') return null;
    const cleanText = String(text || '').replace(/\0/g, '').trim().slice(0, 2000);
    if (!cleanText) return null;
    const cleanSender = String(sender || 'Participant').replace(/[\r\n\0]+/g, ' ').trim().slice(0, 100);
    return {
        type,
        id: String(id || collabChatId()).slice(0, 120),
        sender: cleanSender || 'Participant',
        text: cleanText,
        timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now(),
    };
}

function resetCollabChat() {
    collabChatEntries.length = 0;
    collabChatEntryIds.clear();
    collabChatUnread = 0;
    const list = document.getElementById('collabChatList');
    if (list) list.innerHTML = '';
    const panel = document.getElementById('collabChatPanel');
    if (panel) { panel.hidden = true; panel.classList.remove('expanded'); }
    const button = document.getElementById('collabChatBtn');
    if (button) button.setAttribute('aria-expanded', 'false');
    updateCollabChatUnread();
}

function setCollabChatActive(active) {
    const wrap = document.getElementById('collabChatWrap');
    if (wrap) wrap.hidden = !active;
    if (!active) resetCollabChat();
}

function updateCollabChatUnread() {
    const badge = document.getElementById('collabChatUnread');
    if (!badge) return;
    badge.hidden = collabChatUnread < 1;
    badge.textContent = collabChatUnread > 99 ? '99+' : String(collabChatUnread);
}

function collabChatIsOpen() {
    const panel = document.getElementById('collabChatPanel');
    return !!(panel && !panel.hidden);
}

function toggleCollabChatPanel() {
    const panel = document.getElementById('collabChatPanel');
    const button = document.getElementById('collabChatBtn');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (button) button.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) {
        collabChatUnread = 0;
        updateCollabChatUnread();
        renderCollabChat();
        const input = document.getElementById('collabChatInput');
        if (input) input.focus();
    }
}

function closeCollabChatPanel() {
    const panel = document.getElementById('collabChatPanel');
    const button = document.getElementById('collabChatBtn');
    if (panel) { panel.hidden = true; panel.classList.remove('expanded'); }
    if (button) { button.setAttribute('aria-expanded', 'false'); button.focus(); }
}

function toggleCollabChatExpanded() {
    const panel = document.getElementById('collabChatPanel');
    if (panel) panel.classList.toggle('expanded');
}

function receiveCollabChatEntry(entry, countUnread) {
    const clean = buildCollabChatEntry(entry && entry.type, entry && entry.sender,
        entry && entry.text, entry && entry.id, entry && entry.timestamp);
    if (!clean || collabChatEntryIds.has(clean.id)) return false;
    collabChatEntryIds.add(clean.id);
    collabChatEntries.push(clean);
    if (collabChatEntries.length > 500) {
        const removed = collabChatEntries.shift();
        collabChatEntryIds.delete(removed.id);
    }
    if (countUnread && !collabChatIsOpen()) {
        collabChatUnread++;
        updateCollabChatUnread();
    }
    renderCollabChat();
    return true;
}

/** Draw the host's chat panel with collab-chat.js's shared bubbles (#1347),
 * the same renderer the joiner page uses. The host's own messages are sent
 * as "Host", so that is the name they sit on the right under. */
function renderCollabChat() {
    const list = document.getElementById('collabChatList');
    if (!list || typeof NoodleCollabChat === 'undefined') return;
    NoodleCollabChat.render(list, collabChatEntries, {
        selfName: 'Host',
        onPromote: (entry) => promoteCollabChatToComment(entry.id),
    });
}

async function submitCollabChat(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('collabChatInput');
    if (!input || !input.value.trim()) return;
    const entry = buildCollabChatEntry('chat', 'Host', input.value);
    input.value = '';
    receiveCollabChatEntry(entry, false);
    await sendCollabMessage(JSON.stringify(entry));
}

function collabChatTranscript(entries) {
    return (entries || []).map(entry => {
        const stamp = new Date(entry.timestamp).toISOString();
        return entry.type === 'activity'
            ? `[${stamp}] * ${entry.sender} ${entry.text}`
            : `[${stamp}] ${entry.sender}: ${entry.text}`;
    }).join('\n');
}

function exportCollabChat() {
    const blob = new Blob([collabChatTranscript(collabChatEntries)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `noodleplanner-session-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** Pure plan-text update used by the explicit durable path. */
function appendCollabTaskComment(planText, taskName, addition) {
    if (typeof NoodlePlanModel === 'undefined') return { ok: false, reason: 'model_unavailable' };
    const model = NoodlePlanModel.PlanModel.parse(planText);
    const wanted = String(taskName || '').trim().toLowerCase();
    const task = model.tasks.find(node => String(node.name || '').toLowerCase() === wanted);
    if (!task) return { ok: false, reason: 'unknown_task' };
    const safe = String(addition || '').replace(/[\r\n]+/g, ' ').replace(/["\u201c\u201d]/g, "'").trim();
    if (!safe) return { ok: false, reason: 'empty_comment' };
    model.updateLine(task, line => {
        const existing = /"([^"]*)"/.exec(line);
        if (!existing) return `${line} "${safe}"`;
        const joined = existing[1] ? `${existing[1]} · ${safe}` : safe;
        return line.slice(0, existing.index) + `"${joined}"` + line.slice(existing.index + existing[0].length);
    });
    return { ok: true, text: model.serialize() };
}

function promoteCollabChatToComment(entryId) {
    const entry = collabChatEntries.find(item => item.id === entryId && item.type === 'chat');
    const editor = collabEditor();
    if (!entry || !editor) return false;
    const taskName = prompt('Add this message as a comment to which task? Enter the exact task name.');
    if (!taskName) return false;
    const result = appendCollabTaskComment(editor.value, taskName, `[${entry.sender}] ${entry.text}`);
    if (!result.ok) {
        if (typeof showToast === 'function') showToast('Task not found; the chat message was not saved', 'error');
        return false;
    }
    editor.value = result.text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof renderText === 'function') Promise.resolve(renderText());
    if (typeof showToast === 'function') showToast('Chat message added to the task comment', 'success');
    return true;
}

function describeCollabPlanActivity(op) {
    if (!op) return 'updated the plan';
    if (op.op === 'add_task') return `added task “${op.name || 'Untitled'}”`;
    if (op.op === 'rename') return `renamed task “${op.expect || 'Untitled'}”`;
    if (op.op === 'delete_task') return `removed task “${op.expect || 'Untitled'}”`;
    return `updated task “${op.expect || op.id || 'Untitled'}”`;
}

async function recordCollabActivity(sender, text) {
    const entry = buildCollabChatEntry('activity', sender || 'Participant', text);
    receiveCollabChatEntry(entry, true);
    await sendCollabMessage(JSON.stringify(entry));
}

/** The host's authoritative plan document. This is the same textarea the
 * PM edits by hand -- there is deliberately no second copy of the plan for
 * the session, so a joiner's edit and the host's own edit go through
 * exactly the same text. */
function collabEditor() {
    return document.getElementById('planEditor');
}

function collabLog(line) {
    const log = document.getElementById('collabSessionLog');
    if (!log) return;
    const div = document.createElement('div');
    div.textContent = line;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

/** #1339: true from the moment the host asks for a session until its
 * socket closes -- including the gap while /api/collab/start and the key
 * setup are still in flight, before `collabSocket` exists. The ribbon's
 * planning-session button reads this to decide between restoring the live
 * session's dialog and starting a new session, so a second click during
 * that gap must not start a second session either. */
let collabSessionStarting = false;

function isCollabSessionLive() {
    if (collabSessionStarting) return true;
    return !!collabSocket && (collabSocket.readyState === WebSocket.CONNECTING
        || collabSocket.readyState === WebSocket.OPEN);
}

function refreshCollabRibbon() {
    if (typeof refreshRibbon === 'function') refreshRibbon();
}

function collabPrefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** A `--np-anim-duration*` token in milliseconds, so the fly-to-bubble
 * animation runs at the design system's own pace. */
function collabAnimDuration(token, fallbackMs) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return fallbackMs;
    return raw.endsWith('ms') ? value : value * 1000;
}

/** The status-bar chat bubble, if it's on screen -- the dialog's minimised
 * home. It is only shown while a session is live (setCollabChatActive()). */
function collabChatBubble() {
    const bubble = document.getElementById('collabChatBtn');
    if (!bubble || bubble.getClientRects().length === 0) return null;
    return bubble;
}

/** Keyframes that shrink `dialog` onto `bubble`. Under reduced motion it
 * only fades -- the bubble's pulse still says where it went. */
function collabMinimiseKeyframes(dialog, bubble) {
    if (collabPrefersReducedMotion()) return [{ opacity: 1 }, { opacity: 0 }];
    const from = dialog.getBoundingClientRect();
    const to = bubble.getBoundingClientRect();
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    const scale = Math.max(0.02, to.width / Math.max(1, from.width));
    return [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 },
    ];
}

let collabDialogAnimation = null;

function cancelCollabDialogAnimation() {
    if (collabDialogAnimation) {
        const running = collabDialogAnimation;
        collabDialogAnimation = null;
        running.forEach((animation) => animation.cancel());
    }
}

/** Run the dialog + backdrop animation, then `done`. Browsers without the
 * Web Animations API (or with nothing to animate) go straight to `done`. */
function runCollabDialogAnimation(overlay, dialog, keyframes, reverse, done) {
    cancelCollabDialogAnimation();
    if (!dialog || typeof dialog.animate !== 'function') { done(); return; }
    const timing = {
        duration: collabAnimDuration('--np-anim-duration-slow', 400),
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        direction: reverse ? 'reverse' : 'normal',
        fill: 'both',
    };
    const animations = [
        dialog.animate(keyframes, timing),
        overlay.animate([{ opacity: 1 }, { opacity: 0 }], timing),
    ];
    collabDialogAnimation = animations;
    animations[0].finished.then(() => {
        if (collabDialogAnimation !== animations) return;
        collabDialogAnimation = null;
        done();
        animations.forEach((animation) => animation.cancel());
    }, () => { /* cancelled by a newer minimise/restore */ });
}

function pulseCollabChatBubble(bubble) {
    bubble.classList.remove('collab-bubble-pulse');
    // Force a reflow so a repeat minimise restarts the pulse.
    void bubble.offsetWidth;
    bubble.classList.add('collab-bubble-pulse');
    bubble.addEventListener('animationend', () => bubble.classList.remove('collab-bubble-pulse'), { once: true });
}

/** #1339: tuck the dialog into the chat bubble so the host can work on the
 * plan. Only hides it -- the socket, joiners, chat and code are untouched,
 * and the ribbon's planning-session button restores it. */
function minimiseCollabSessionModal() {
    const overlay = document.getElementById('collabSessionOverlay');
    if (!overlay || !overlay.classList.contains('active')) return;
    const dialog = overlay.querySelector('.task-form-modal');
    const bubble = collabChatBubble();
    const finish = () => {
        overlay.classList.remove('active');
        if (bubble) {
            pulseCollabChatBubble(bubble);
            bubble.focus();
        }
    };
    if (!bubble) { finish(); return; }
    runCollabDialogAnimation(overlay, dialog, collabMinimiseKeyframes(dialog, bubble), false, finish);
}

/** #1339: bring the live session's dialog back out of the chat bubble --
 * same code, link, participants and End session as before it was
 * minimised. */
function showCollabSessionModal() {
    const overlay = document.getElementById('collabSessionOverlay');
    if (!overlay) return;
    const alreadyOpen = overlay.classList.contains('active') && !collabDialogAnimation;
    overlay.classList.add('active');
    const dialog = overlay.querySelector('.task-form-modal');
    const focusDialog = () => {
        const code = document.getElementById('collabSessionCode');
        const target = code && code.getClientRects().length ? code : document.getElementById('collabSessionMinimise');
        if (target) target.focus();
    };
    const bubble = collabChatBubble();
    if (alreadyOpen || !bubble) { cancelCollabDialogAnimation(); focusDialog(); return; }
    runCollabDialogAnimation(overlay, dialog, collabMinimiseKeyframes(dialog, bubble), true, focusDialog);
}

function closeCollabSessionModal() {
    // #1339: while the session runs, closing is minimising -- the dialog is
    // the only place the code and End session live, so it has to be
    // somewhere the host can get it back from.
    if (isCollabSessionLive()) { minimiseCollabSessionModal(); return; }
    cancelCollabDialogAnimation();
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
    // #968: an explicit end means the host has consciously chosen to stop
    // -- the crash-recovery snapshot exists only for the *unexpected* drop,
    // so it has nothing left to protect against once the host has said
    // "we're done" themselves. Cancel any pending debounced write too, or
    // the close handler's flush-on-close (below) would write a fresh
    // snapshot right back after this clears it.
    clearTimeout(collabAutosaveTimer);
    collabAutosaveTimer = null;
    const projectId = typeof getCurrentProjectId === 'function' ? getCurrentProjectId() : null;
    if (projectId) clearCollabAutosaveForProject(projectId);
}

/** Give up the #968 recovery snapshot for `projectId`, if it holds one.
 * Called on the host's own explicit "end session" above, and from
 * project-storage.js's saveCurrentProjectState() on every real save --
 * once the project record itself has this content, the snapshot is
 * redundant. Safe to call with no session or no snapshot in play; both are
 * no-ops. */
async function clearCollabAutosaveForProject(projectId) {
    if (!projectId) return;
    const { clearCollabAutosaveIfCurrent } = await loadCollabAutosave();
    clearCollabAutosaveIfCurrent(projectId);
}

/** Debounced after every joiner op the host applies (#968) -- see
 * collab-autosave.js's module docstring for why this needs to be tighter
 * than the general 30 s project autosave. */
async function scheduleCollabAutosave() {
    const { COLLAB_AUTOSAVE_DEBOUNCE_MS } = await loadCollabAutosave();
    clearTimeout(collabAutosaveTimer);
    collabAutosaveTimer = setTimeout(writeCollabAutosaveNow, COLLAB_AUTOSAVE_DEBOUNCE_MS);
}

async function writeCollabAutosaveNow() {
    const editor = collabEditor();
    if (!editor) return;
    const projectId = typeof getCurrentProjectId === 'function' ? getCurrentProjectId() : null;
    if (!projectId) return;
    const { buildCollabAutosaveRecord, writeCollabAutosave } = await loadCollabAutosave();
    writeCollabAutosave(buildCollabAutosaveRecord(projectId, collabSessionId, editor.value, collabPlanRev));
}

/** #968: after the plan for `projectId` has just been loaded into the
 * editor (page load, or the host reconnecting after a refresh), check
 * whether an earlier session left a newer recovery snapshot for it and, if
 * so, let the host choose to bring it back or discard it -- see
 * collab-autosave.js's shouldOfferCollabRecovery for why an interrupted
 * session is distinguishable from a clean end. Called once on startup --
 * see multi-plan-loader.js's initMultiPlanLoader(). Never applies a
 * snapshot without the host's confirmation. */
async function checkCollabAutosaveRecovery(projectId) {
    if (!projectId) return;
    const project = typeof loadProject === 'function' ? loadProject(projectId) : null;
    if (!project) return;

    const { readCollabAutosave, shouldOfferCollabRecovery, clearCollabAutosaveIfCurrent } = await loadCollabAutosave();
    const snapshot = readCollabAutosave();
    if (!shouldOfferCollabRecovery(snapshot, project)) return;

    const recover = confirm(
        'A collaborative planning session was interrupted before its changes were saved. ' +
        'Recover the latest changes made during that session?'
    );
    if (!recover) {
        clearCollabAutosaveIfCurrent(projectId);
        return;
    }

    const editor = collabEditor();
    if (editor) {
        editor.value = snapshot.planText;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (typeof saveCurrentProjectState === 'function') saveCurrentProjectState();
    clearCollabAutosaveIfCurrent(projectId);
    if (typeof showToast === 'function') showToast('Recovered changes from the interrupted planning session', 'success');
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
    collabJoinerNames.clear();
    for (const joiner of Array.isArray(joiners) ? joiners : []) {
        collabJoinerNames.set(joiner.id, joiner.display_name);
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

/** Send a plaintext string to one joiner only, encrypted under that
 * joiner's own key (#967). Used for replies that concern a single sender --
 * a rejected op, or the initial snapshot handed to someone who has just
 * finished their handshake. */
async function sendCollabMessageTo(joinerId, plaintext) {
    if (!collabSocket || collabSocket.readyState !== WebSocket.OPEN) return false;
    const key = collabSessionKeys.get(joinerId);
    if (!key) return false;
    const { encryptMessage, buildToJoinerEnvelope } = await loadCollabCrypto();
    const ciphertext = await encryptMessage(key, plaintext, collabSessionId);
    collabSocket.send(buildToJoinerEnvelope(joinerId, ciphertext));
    return true;
}

async function sendCollabJsonTo(joinerId, payload) {
    return sendCollabMessageTo(joinerId, JSON.stringify(payload));
}

function isPlanTextReplace(value) {
    return Boolean(value) && typeof value === 'object' && value.type === 'plan_text_replace';
}

async function applyCollabReplacement(joinerId, nextText, rejectionType) {
    const editor = collabEditor();
    if (!editor || typeof nextText !== 'string') {
        await sendCollabJsonTo(joinerId, { type: rejectionType, reason: 'invalid' });
        return false;
    }
    if (nextText === editor.value) return true;

    editor.value = nextText;
    collabApplyingRemoteOp = true;
    try {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
        collabApplyingRemoteOp = false;
    }
    if (typeof renderPlan === 'function') {
        try {
            await renderPlan();
        } catch (error) {
            collabLog('(applied an edit but could not re-render the plan)');
        }
    }
    collabPlanRev++;
    scheduleCollabAutosave();
    await broadcastCollabPlan(null, null, null);
    return true;
}

async function applyCollabPlanTextReplace(joinerId, message) {
    if (!Number.isInteger(message.rev) || typeof message.text !== 'string') {
        await sendCollabJsonTo(joinerId, { type: 'plan_text_replace_rejected', reason: 'invalid' });
        return;
    }
    // #1347: the host typing is a change too, but it only takes a revision
    // once its debounced broadcast fires. Until then a joiner's replacement
    // -- the whole plan text, made against the last snapshot -- would quietly
    // drop whatever the host just typed, so it is stale like any other race.
    if (message.rev !== collabPlanRev || collabLocalEditTimer !== null) {
        await sendCollabJsonTo(joinerId, { type: 'plan_text_replace_rejected', reason: 'stale' });
        return;
    }
    await applyCollabReplacement(joinerId, message.text, 'plan_text_replace_rejected');
}

/** Broadcast the current plan to every joiner (#967).
 *
 * The host sends a full snapshot rather than a diff. A planning session is
 * a handful of people editing a plan of a few hundred lines over a LAN, so
 * a diff protocol would add reconciliation bugs (and a second way for
 * clients to disagree about state) to buy back bandwidth nobody is short
 * of. `notice`, when present, is the "X also edited this" message from the
 * conflict rule -- see collab-ops.js's describeConflict.
 *
 * #969: the plan text is one document, tasks and RAID log alike, so any
 * change to it -- a task op, a RAID row op, or the host's own typing --
 * is broadcast as both a `plan_snapshot` and a `raid_snapshot` together.
 * That costs a little redundant chatter when only one half actually
 * changed, which is the same trade-off this function's own task-snapshot
 * broadcast already makes (see the comment above): correctness from a
 * single full-snapshot source of truth, over a diff protocol that would
 * have to reconcile two content types instead of one. `raidNotice` is the
 * RAID counterpart of `notice` -- see describeBackmatterConflict. */
async function broadcastCollabPlan(notice, raidNotice, sectionNotice) {
    if (collabSessionKeys.size === 0) return 0;
    const { buildPlanSnapshot } = await loadCollabOps();
    const { buildRaidSnapshot, buildSectionSnapshot, EDITABLE_SECTIONS } = await loadCollabBackmatterOps();
    const editor = collabEditor();
    if (!editor) return 0;
    const snapshot = buildPlanSnapshot(editor.value, collabPlanRev);
    if (notice) snapshot.notice = notice;
    const raidSnapshot = buildRaidSnapshot(editor.value, collabPlanRev);
    if (raidNotice) raidSnapshot.notice = raidNotice;
    let sent = await sendCollabMessage(JSON.stringify(snapshot));
    sent += await sendCollabMessage(JSON.stringify(raidSnapshot));

    // #1036: the other editable back-matter sections travel the same way,
    // one `backmatter_snapshot` each. RAID keeps its own frame type for
    // compatibility with the joiner #969 already shipped.
    for (const section of EDITABLE_SECTIONS) {
        if (section === 'raid') continue;
        const sectionSnapshot = buildSectionSnapshot(editor.value, collabPlanRev, section);
        if (!sectionSnapshot) continue;
        if (sectionNotice && sectionNotice.section === section) {
            sectionSnapshot.notice = sectionNotice.text;
        }
        sent += await sendCollabMessage(JSON.stringify(sectionSnapshot));
    }
    return sent;
}

/** Apply one joiner's edit intent to the host's plan, then tell everyone.
 *
 * This is the whole of the host-authoritative model: joiners never touch
 * the document, they ask the host to. Because this runs on the host's
 * single event loop, ops are applied in arrival order and last write wins
 * -- see collab-ops.js's module docstring for the full rule. */
async function applyCollabPlanOp(joinerId, op) {
    const { applyPlanOp, describeConflict, createConflictTracker } = await loadCollabOps();
    if (!collabConflicts) collabConflicts = createConflictTracker();
    const editor = collabEditor();
    if (!editor) return;

    const result = applyPlanOp(editor.value, op);
    if (!result.ok) {
        // Tell only the sender. A stale op means their snapshot has been
        // overtaken; the fresh one they already have (or are about to get)
        // is the fix, so this is informational rather than an error state.
        await sendCollabMessageTo(joinerId, JSON.stringify({
            type: 'plan_op_rejected', op: op.op, reason: result.reason,
        }));
        return;
    }

    editor.value = result.text;
    // The same event a human typing would raise, so the kanban editor
    // mirror, line numbers and autosave all stay in step -- a joiner's edit
    // must be indistinguishable from the host's own. The guard stops that
    // event being mistaken for the host typing, which would queue a second,
    // notice-less broadcast that raced the one below and could hide the
    // "X also edited this" message.
    collabApplyingRemoteOp = true;
    try {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
        collabApplyingRemoteOp = false;
    }
    if (typeof renderPlan === 'function') {
        try {
            await renderPlan();
        } catch (error) {
            collabLog('(applied an edit but could not re-render the plan)');
        }
    }

    collabPlanRev++;
    // #968: this is an *incoming* contribution the host would otherwise
    // have no record of outside the next real save -- see
    // collab-autosave.js's module docstring.
    scheduleCollabAutosave();
    // Only announce an edit that actually raced someone else's recent edit
    // to the same task. Reporting every value change would mean a person
    // working through the plan alone got a stream of "also edited this"
    // notices, and a notice that always fires is one nobody reads.
    const editor_name = collabJoinerNames.get(joinerId);
    const raced = collabConflicts.record(op.expect || String(op.id), editor_name);
    await broadcastCollabPlan(raced ? describeConflict(op, result.previous, editor_name) : null, null);
    await recordCollabActivity(editor_name || 'Participant', describeCollabPlanActivity(op));
}

/** #969: apply one joiner's RAID row edit intent to the host's plan, then
 * tell everyone -- the RAID counterpart of applyCollabPlanOp above. Same
 * host-authoritative model (joiners never touch the document, they ask
 * the host to) and the same arrival-order-is-the-conflict-rule guarantee;
 * see collab-backmatter-ops.js's module docstring for how row identity
 * and staleness differ from task ops. */
async function applyCollabBackmatterOp(joinerId, op) {
    const { applyBackmatterOp, describeBackmatterConflict } = await loadCollabBackmatterOps();
    const { createConflictTracker } = await loadCollabOps();
    if (!collabBackmatterConflicts) collabBackmatterConflicts = createConflictTracker();
    const editor = collabEditor();
    if (!editor) return;

    const result = applyBackmatterOp(editor.value, op);
    if (!result.ok) {
        await sendCollabMessageTo(joinerId, JSON.stringify({
            type: 'backmatter_op_rejected', section: op.section, op: op.op, reason: result.reason,
        }));
        return;
    }

    editor.value = result.text;
    collabApplyingRemoteOp = true;
    try {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
        collabApplyingRemoteOp = false;
    }
    if (typeof renderPlan === 'function') {
        try {
            await renderPlan();
        } catch (error) {
            collabLog('(applied an edit but could not re-render the plan)');
        }
    }

    collabPlanRev++;
    // #968: same crash-recovery discipline as applyCollabPlanOp -- a RAID
    // row a joiner just added or edited is exactly the kind of incoming
    // contribution the host would otherwise have no record of outside the
    // next real save, and it deserves no less protection than a task edit.
    scheduleCollabAutosave();
    const editor_name = collabJoinerNames.get(joinerId);
    // #1036: the tracker is keyed by section *and* row, so row 1 of the
    // comms plan and row 1 of the RAID log are not mistaken for the same
    // thing -- the mistake the separate task/RAID trackers already exist
    // to avoid, now that there is more than one row-based section.
    const raced = collabBackmatterConflicts.record(`${op.section}:${op.row_id}`, editor_name);
    const notice = raced ? describeBackmatterConflict(op, result.previous, editor_name) : null;
    if (op.section === 'raid') {
        await broadcastCollabPlan(null, notice, null);
    } else {
        await broadcastCollabPlan(null, null, notice ? { section: op.section, text: notice } : null);
    }
    const sectionLabel = op.section === 'raid' ? 'RAID log' : op.section;
    await recordCollabActivity(editor_name || 'Participant', `updated the ${sectionLabel}`);
}

/** Push the host's own typing out to joiners (#967).
 *
 * Debounced: the host is a person typing into a textarea, and a snapshot
 * per keystroke would be both wasteful and visually noisy on the joiner
 * side. The delay is short enough to stay well inside the issue's
 * under-a-second requirement on a LAN. */
/** Watch the host's own editor so their edits reach joiners too (#967) --
 * "an edit by any participant" in the issue includes the host's. Attached
 * once and left in place: `scheduleCollabPlanBroadcast` is a no-op while
 * no joiner holds a key, so this costs nothing outside a live session. */
let collabLocalEditListenerAttached = false;
function attachCollabLocalEditListener() {
    if (collabLocalEditListenerAttached) return;
    const editor = collabEditor();
    if (!editor) return;
    editor.addEventListener('input', scheduleCollabPlanBroadcast);
    collabLocalEditListenerAttached = true;
}

function scheduleCollabPlanBroadcast() {
    if (collabApplyingRemoteOp) return;
    if (collabSessionKeys.size === 0) return;
    clearTimeout(collabLocalEditTimer);
    collabLocalEditTimer = setTimeout(() => {
        collabLocalEditTimer = null;
        collabPlanRev++;
        broadcastCollabPlan(null, null)
            .then(() => recordCollabActivity('Host', 'updated the plan'));
    }, 250);
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
            // MAC didn't verify -- the announcement wasn't made with this
            // session's join code (a forged or corrupted frame). Never
            // derive a session key with an unauthenticated peer.
            collabLog('A joiner failed to authenticate -- ignoring.');
            return;
        }
        collabSessionKeys.set(joinerId, await deriveSessionKey(collabKeyPair.privateKey, peerKey, collabSessionId));
        collabLog('Secure channel established with joiner.');
        // #967: hand the new joiner the current plan straight away, so they
        // have something to edit without waiting for someone else to make
        // the next change. #969: the RAID log rides along the same way.
        const { buildPlanSnapshot } = await loadCollabOps();
        const {
            buildRaidSnapshot, buildSectionSnapshot, EDITABLE_SECTIONS,
        } = await loadCollabBackmatterOps();
        const editor = collabEditor();
        if (editor) {
            await sendCollabMessageTo(joinerId, JSON.stringify(buildPlanSnapshot(editor.value, collabPlanRev)));
            await sendCollabMessageTo(joinerId, JSON.stringify(buildRaidSnapshot(editor.value, collabPlanRev)));
            // #1036: and the rest of the editable back matter, so a joiner
            // arrives with every section they can edit already populated.
            for (const section of EDITABLE_SECTIONS) {
                if (section === 'raid') continue;
                const snapshot = buildSectionSnapshot(editor.value, collabPlanRev, section);
                if (snapshot) {
                    await sendCollabMessageTo(joinerId, JSON.stringify(snapshot));
                }
            }
            // Chat is ephemeral but session-scoped, not connection-scoped:
            // someone joining late should see the conversation and activity
            // that happened earlier in this still-live session.
            for (const entry of collabChatEntries) {
                await sendCollabMessageTo(joinerId, JSON.stringify(entry));
            }
        }
        return;
    }

    if (frameType === 'enc') {
        const key = joinerId === null ? null : collabSessionKeys.get(joinerId);
        if (!key) {
            collabLog('(received an encrypted message before the secure channel was ready)');
            return;
        }
        let plaintext;
        try {
            plaintext = await decryptMessage(key, frame, collabSessionId);
        } catch {
            collabLog('(failed to decrypt a message -- dropped)');
            return;
        }

        // #967/#969: an edit intent, or ordinary chatter. Only content that
        // decrypted under this joiner's own key gets this far, so the
        // sender is authenticated before any op is applied.
        const { isPlanOp } = await loadCollabOps();
        const { isBackmatterOp } = await loadCollabBackmatterOps();
        let parsed = null;
        try {
            parsed = JSON.parse(plaintext);
        } catch {
            parsed = null;
        }
        if (isPlanOp(parsed)) {
            await applyCollabPlanOp(joinerId, parsed);
            return;
        }
        if (isBackmatterOp(parsed)) {
            await applyCollabBackmatterOp(joinerId, parsed);
            return;
        }
        if (isPlanTextReplace(parsed)) {
            await applyCollabPlanTextReplace(joinerId, parsed);
            return;
        }
        if (parsed && parsed.type === 'chat') {
            // The relay envelope authenticated the sender; discard any
            // display name supplied inside their payload to prevent spoofing.
            const entry = buildCollabChatEntry(
                'chat', collabJoinerNames.get(joinerId) || 'Participant',
                parsed.text, collabChatId(), Date.now()
            );
            if (entry && receiveCollabChatEntry(entry, true)) {
                await sendCollabMessage(JSON.stringify(entry));
            }
            return;
        }
        collabLog(`joiner: ${plaintext}`);
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

    // #1339: a live session's button restores its dialog. Starting afresh
    // here used to close the socket and drop every joiner.
    if (isCollabSessionLive()) {
        showCollabSessionModal();
        return;
    }
    collabSessionStarting = true;
    collabSessionKeys.clear();
    collabJoinerNames.clear();
    collabPlanRev = 0;
    resetCollabChat();
    if (collabConflicts) collabConflicts.reset();
    if (collabBackmatterConflicts) collabBackmatterConflicts.reset();
    attachCollabLocalEditListener();
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
        collabSessionStarting = false;
        refreshCollabRibbon();
        status.textContent = 'Could not start a session. Please try again.';
        if (typeof showToast === 'function') showToast('Could not start planning session', 'error');
        return;
    }

    const codeInput = document.getElementById('collabSessionCode');
    const urlInput = document.getElementById('collabSessionUrl');
    if (codeInput) codeInput.value = info.join_code;
    // Just `<origin>/join` -- the same for every session, so the PM can say
    // it out loud alongside the code.
    if (urlInput) urlInput.value = `${window.location.origin}${info.holding_url}`;

    status.textContent = 'Session live. Tell your team to open the link below and enter the code.';
    details.style.display = 'block';
    setCollabChatActive(true);

    try {
        const { deriveConnectKey, generateEphemeralKeyPair } = await loadCollabCrypto();

        collabSessionId = info.session_id;
        // The join code is the one secret the joiner has, so it is what
        // authenticates the ECDH handshake -- see collab-crypto.js's module
        // docstring for what that does and does not protect against.
        collabConnectKey = await deriveConnectKey(info.join_code, info.session_id);
        collabKeyPair = await generateEphemeralKeyPair();

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        collabSocket = new WebSocket(
            `${protocol}//${window.location.host}/ws/session/${info.session_id}?token=${encodeURIComponent(info.host_token)}`
        );
    } finally {
        // From here the socket itself says whether the session is live.
        collabSessionStarting = false;
    }
    refreshCollabRibbon();
    const { buildPubkeyAnnouncement } = await loadCollabCrypto();

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
        collabJoinerNames.clear();
        setCollabChatActive(false);
        // Nothing left to broadcast to; a pending timer would only wake up
        // and find no keys.
        clearTimeout(collabLocalEditTimer);
        collabLocalEditTimer = null;
        // #968: a pending debounced autosave hasn't written its snapshot
        // yet -- this close might be the very crash that snapshot exists
        // for, so flush it now instead of leaving it queued behind a timer
        // that a closed page will never run.
        if (collabAutosaveTimer) {
            clearTimeout(collabAutosaveTimer);
            collabAutosaveTimer = null;
            writeCollabAutosaveNow();
        }
        renderCollabPresence([]);
        refreshCollabRibbon();
        // #1339: a minimised dialog can't show why the session ended, and
        // the chat bubble it was tucked into has just gone.
        const overlay = document.getElementById('collabSessionOverlay');
        if (overlay && !overlay.classList.contains('active') && typeof showToast === 'function') {
            showToast(status.textContent, 'info');
        }
    });
}
