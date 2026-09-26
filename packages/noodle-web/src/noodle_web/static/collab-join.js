/**
 * collab-join.js -- the planning-session joiner page (/join, #1347).
 *
 * A joiner gets the host's own whiteboard: the page loads the same
 * whiteboard scripts as the app and a hidden `#planEditor` holding the
 * host's plan text, and draws it with `updateWhiteboardView()` from a local
 * parse (engine/local-parse.js) of that text. Notes, colours, groups, the
 * structure panel and zoom are therefore the host's, by construction --
 * #1347 found a separately hand-built joiner board that matched none of
 * them and could not edit a note.
 *
 * Every whiteboard edit goes through `wbCommitMarkdown()`, which writes
 * `#planEditor` and calls `renderText()`. This page defines its own
 * `renderText()` (loaded after script.js, so it replaces that one): draw
 * locally, and send the new text to the host as `plan_text_replace`. The
 * host stays the single writer. It applies a replacement only if it was
 * made against its current revision; a joiner whose edit raced someone
 * else's rebases it onto the newer plan with collab-merge.js and sends it
 * again, and gives up (with a notice) only when both changed the same lines.
 *
 * Undo and Redo (the bar's buttons, Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y) take
 * back only this joiner's own edits, rebased onto the current plan -- see
 * collab-undo.js.
 *
 * Crypto, the join handshake and chat are unchanged from the page this
 * replaces; see collab-crypto.js and collab-session.js.
 */

let cryptoModulePromise = null;
function loadCollabCrypto() {
    if (!cryptoModulePromise) cryptoModulePromise = import('/static/collab-crypto.js');
    return cryptoModulePromise;
}

let localParseModulePromise = null;
function loadLocalParse() {
    if (!localParseModulePromise) localParseModulePromise = import('/static/engine/local-parse.js');
    return localParseModulePromise;
}

// Learned from the server's `joined` reply: the joiner only types the code,
// and the code is what picks the session.
let sessionId = null;
let joinedName = '';
let socket = null;
// A promise, not a key: PBKDF2 takes a moment, and the host's pubkey
// announcement arrives straight after `joined`, so the handler for it has to
// be able to wait for the derivation to finish.
let connectKeyPromise = null;
let keyPair = null;
let sessionKey = null;
let presencePingTimer = null;
let planNoticeTimer = null;
let leaving = false;

const joinerChatEntries = [];
const joinerChatIds = new Set();
let chatUnread = 0;

function el(id) { return document.getElementById(id); }

function planEditorEl() { return el('planEditor'); }

// ---- The whiteboard ---------------------------------------------------------

/**
 * The joiner's view of the plan, kept in step with the host.
 *
 *  rev, synced      the host's latest revision and its plan text; rev is
 *                   -1 until the first snapshot arrives (the host's first
 *                   revision is 0).
 *  pending          {base, text, fit}: the joiner's own edit the host has
 *                   not yet confirmed -- `text` is what the joiner wants,
 *                   made against `base`; `fit` when it is a whiteboard Tidy,
 *                   which every board zooms to fit once it has drawn.
 *  sentRev, sentText, sentFit  the replacement currently with the host, if
 *                   any.
 *  waitForSnapshot  a stale bounce with no newer snapshot yet -- the host
 *                   has typing of its own about to broadcast; resending now
 *                   would bounce again.
 */
const planSync = {
    rev: -1,
    synced: '',
    pending: null,
    sentRev: null,
    sentText: null,
    sentFit: false,
    waitForSnapshot: false,
};

// Set by collabShareWhiteboardFit() just before the Tidy it belongs to is
// committed, and moved onto that edit by noteLocalPlanChange().
let fitRequested = false;

// The joiner's own edits, for Undo and Redo (collab-undo.js). Each is
// reversed by rebasing it onto the plan as it is now, so an undo never takes
// back what the host or another joiner has done since.
const joinerHistory = NoodleCollabUndo.createHistory();
// Set while an undo or redo is being committed, so it is not recorded as a
// fresh edit of its own.
let applyingHistory = false;

function resetPlanSync() {
    joinerHistory.clear();
    refreshUndoButtons();
    planSync.rev = -1;
    planSync.synced = '';
    planSync.pending = null;
    planSync.sentRev = null;
    planSync.sentText = null;
    planSync.sentFit = false;
    planSync.waitForSnapshot = false;
    fitRequested = false;
}

let renderSeq = 0;
let needsFirstFit = true;

/** Draw the whiteboard from #planEditor's text, the way the app does after
 * a render: a local parse for the tasks, then updateWhiteboardView(). */
async function renderJoinerBoard() {
    const editor = planEditorEl();
    if (!editor) return;
    const seq = ++renderSeq;
    const text = editor.value;
    let result = { tasks: [] };
    try {
        const engine = await loadLocalParse();
        const parsed = engine.localParse(text);
        if (parsed && parsed.success) result = parsed;
    } catch (error) {
        console.warn('[join] could not parse the plan locally:', error);
    }
    if (seq !== renderSeq) return; // a newer render has started
    if (typeof lastRenderedTasks !== 'undefined') lastRenderedTasks = result.tasks || [];
    if (typeof updateWhiteboardView === 'function') updateWhiteboardView(result, text);
    // The board is built empty when the joiner arrives and the plan follows
    // a moment later, so frame the notes once they are there.
    if (needsFirstFit && text && typeof wbAnyNoteOnScreen === 'function' &&
        typeof whiteboardZoomFit === 'function') {
        needsFirstFit = false;
        if (!wbAnyNoteOnScreen()) whiteboardZoomFit({ maxZoom: 1 });
    }
}

/** Replace the plan the board shows, without treating it as a local edit. */
function showPlanText(text) {
    const editor = planEditorEl();
    if (!editor) return;
    if (editor.value !== text) editor.value = text;
    renderJoinerBoard();
}

/** Called by the whiteboard (through renderText) after every commit. */
function noteLocalPlanChange() {
    const editor = planEditorEl();
    if (!editor) return;
    const text = editor.value;
    const current = planSync.pending ? planSync.pending.text : planSync.synced;
    const fit = fitRequested;
    fitRequested = false;
    if (text === current) return;
    if (!applyingHistory) {
        joinerHistory.record(current, text);
        refreshUndoButtons();
    }
    if (planSync.pending) planSync.pending.text = text;
    else planSync.pending = { base: planSync.synced, text, fit: false };
    if (fit) planSync.pending.fit = true;
    flushPlanChange();
}

/** Rebase the pending edit onto `latest`. False when it cannot merge. */
function rebasePending(latest) {
    const pending = planSync.pending;
    if (!pending || pending.base === latest) return true;
    const merged = NoodleCollabMerge.merge3(pending.base, pending.text, latest);
    if (merged === null) return false;
    planSync.pending = { base: latest, text: merged, fit: pending.fit };
    return true;
}

function dropPendingForConflict() {
    planSync.pending = null;
    showPlanNotice('Someone changed the same part of the board at the same time — their version is on screen now.');
    showPlanText(planSync.synced);
}

/** Send the pending edit to the host, unless one is already with it. */
function flushPlanChange() {
    if (!planSync.pending || planSync.sentText !== null || planSync.waitForSnapshot) return;
    if (!rebasePending(planSync.synced)) { dropPendingForConflict(); return; }
    const text = planSync.pending.text;
    if (text === planSync.synced) { planSync.pending = null; return; }
    const editor = planEditorEl();
    if (editor && editor.value !== text) showPlanText(text);
    planSync.sentRev = planSync.rev;
    planSync.sentText = text;
    planSync.sentFit = Boolean(planSync.pending.fit);
    planSync.pending.fit = false;
    const message = { type: 'plan_text_replace', rev: planSync.rev, text };
    if (planSync.sentFit) message.fit = true;
    sendEncrypted(message);
}

function receivePlanSnapshot(rev, text) {
    planSync.rev = rev;
    planSync.synced = text;
    planSync.waitForSnapshot = false;

    if (planSync.sentText !== null && text === planSync.sentText) {
        // Our replacement landed. Anything typed since builds on it.
        planSync.sentText = null;
        planSync.sentRev = null;
        planSync.sentFit = false;
        if (planSync.pending) planSync.pending.base = text;
    } else if (planSync.pending) {
        // Someone else's change came first. If ours is still with the host
        // it will bounce as stale; either way, show both changes now and
        // resend ours on top once the host is ready for it.
        if (!rebasePending(text)) { dropPendingForConflict(); return; }
        showPlanText(planSync.pending.text);
    } else {
        showPlanText(text);
    }
    if (planSync.pending && planSync.pending.text === text) planSync.pending = null;
    flushPlanChange();
}

function receivePlanTextRejected(reason) {
    const sentRev = planSync.sentRev;
    const sentFit = planSync.sentFit;
    planSync.sentText = null;
    planSync.sentRev = null;
    planSync.sentFit = false;
    if (reason !== 'stale') {
        planSync.pending = null;
        showPlanNotice(reason === 'protected'
            ? 'That change touches part of the plan the host is keeping private, so it was not applied.'
            : 'The host could not apply that change.');
        showPlanText(planSync.synced);
        return;
    }
    // A bounced Tidy is still a Tidy when it is resent.
    if (sentFit && planSync.pending) planSync.pending.fit = true;
    // Bounced before any newer snapshot reached us: the host has changes of
    // its own about to broadcast. Wait for them, then rebase and resend.
    if (sentRev === planSync.rev) planSync.waitForSnapshot = true;
    else flushPlanChange();
}

/**
 * The whiteboard's Tidy, on a joiner (whiteboard-notes.js's
 * wbCommitLayout()): the host's board and every other joiner's should zoom
 * to fit as well. Called before the commit, so `withEdit` marks the edit
 * that commit is about to send; with no edit, the request goes on its own.
 */
// eslint-disable-next-line no-unused-vars
function collabShareWhiteboardFit(withEdit) {
    if (withEdit) fitRequested = true;
    else sendEncrypted({ type: 'whiteboard_fit' });
}

// The whiteboard commits through wbCommitMarkdown(), which calls
// renderText(). This declaration comes after script.js's and so replaces
// it: on this page, "render" means draw locally and tell the host.
// eslint-disable-next-line no-unused-vars
async function renderText() {
    noteLocalPlanChange();
    await renderJoinerBoard();
}

// eslint-disable-next-line no-unused-vars
async function renderPlan() {
    return renderText();
}

// script.js sets the app's editors, split panes and upload tab up on load,
// with functions from files this page does not load (editor.js, nav.js,
// views-gantt.js ...). This page has none of those -- no editor, no panes,
// just the board -- so each step has nothing to do here. Without these, the
// first missing one throws and takes the rest of that start-up with it.
/* eslint-disable no-unused-vars */
function initializeEditor() {}
function initializeEditorDragDrop() {}
function initializeKanbanEditor() {}
function initializeKanbanEditorDragDrop() {}
function initializeUploadTab() {}
function initResizer() {}
function initGanttSplitter() {}
function initEditorSplitter() {}
// script.js's keyboard shortcuts reach for the app's other views and its
// shortcuts overlay, neither of which is here. Its Ctrl+S downloads the
// plan -- and a joiner deliberately holds no copy of it.
function switchToView() {}
function openShortcutsModal() {}
function closeShortcutsModal() {}
function downloadMarkdown() {}
// kanban.js wires its board and an editor-sync listener up on load; the
// board is not here (the whiteboard only uses kanban.js's colour helpers),
// and the listener would throw on every whiteboard edit without it.
function initializeKanban() {}
function setupKanbanAutoSync() {}
// The full task-details form and the resource form are the host's app, not
// part of the board. Here a task's details open in the whiteboard's quick
// editor instead (duration, % complete, comment -- whiteboard-outline.js),
// which commits like any other board edit; the notice is the fallback for
// a task it cannot find.
function openTaskFormByName(taskName) {
    if (typeof wbOpenQuickTaskEditor === 'function' && wbOpenQuickTaskEditor(taskName)) return;
    showPlanNotice('The full task details open in the host’s plan — ask them to open it.');
}
function openTaskInspectorByName(taskName) { openTaskFormByName(taskName); }
function openResourceForm() {
    showPlanNotice('Resource details open in the host’s plan — ask them to open it.');
}
/* eslint-enable no-unused-vars */

// ---- Undo and redo ------------------------------------------------------------

function refreshUndoButtons() {
    const undoBtn = el('undoBtn');
    const redoBtn = el('redoBtn');
    if (undoBtn) undoBtn.disabled = !joinerHistory.canUndo();
    if (redoBtn) redoBtn.disabled = !joinerHistory.canRedo();
}

/** Undo (or redo) the joiner's last edit on top of the plan as it is now,
 * and send the result to the host like any other board edit. */
function stepJoinerHistory(direction) {
    const editor = planEditorEl();
    if (!editor || !socket) return;
    const result = direction === 'redo'
        ? joinerHistory.redo(editor.value)
        : joinerHistory.undo(editor.value);
    refreshUndoButtons();
    if (!result) return;
    if (result.conflict) {
        showPlanNotice(direction === 'redo'
            ? 'That change can’t be redone — someone has since changed the same part of the board.'
            : 'That change can’t be undone — someone has since changed the same part of the board.');
        return;
    }
    if (result.text === editor.value) return;
    editor.value = result.text;
    applyingHistory = true;
    try {
        noteLocalPlanChange();
    } finally {
        applyingHistory = false;
    }
    renderJoinerBoard();
}

function undoJoinerEdit() { stepJoinerHistory('undo'); }
function redoJoinerEdit() { stepJoinerHistory('redo'); }

/** Typing in a field (chat, a note's text, the quick editor) keeps the
 * browser's own text undo; everywhere else Ctrl+Z is the board's. */
function isTextEntryTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    const type = (target.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset'].includes(type);
}

function handleUndoShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (el('relay').hidden || isTextEntryTarget(event.target)) return;
    const key = String(event.key || '').toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault();
    if (key === 'y' || event.shiftKey) redoJoinerEdit(); else undoJoinerEdit();
}

// ---- Notices ------------------------------------------------------------------

/** Show a transient message -- the "X also edited this" notice from the
 * host's conflict rule, or an explanation for a bounced edit. */
function showPlanNotice(text) {
    const notice = el('planNotice');
    if (!notice || !text) return;
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(planNoticeTimer);
    planNoticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
}

// ---- Chat -----------------------------------------------------------------------

function joinerChatId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normaliseJoinerChatEntry(value) {
    if (!value || (value.type !== 'chat' && value.type !== 'activity')) return null;
    const text = String(value.text || '').replace(/\0/g, '').trim().slice(0, 2000);
    if (!text) return null;
    return {
        type: value.type,
        id: String(value.id || joinerChatId()).slice(0, 120),
        sender: String(value.sender || 'Participant').replace(/[\r\n\0]+/g, ' ').trim().slice(0, 100),
        text,
        timestamp: Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : Date.now(),
    };
}

function renderJoinerChat() {
    NoodleCollabChat.render(el('relayLog'), joinerChatEntries, { selfName: joinedName });
}

function chatPanelOpen() {
    const shell = el('relay');
    return !!shell && !shell.classList.contains('chat-collapsed');
}

function updateChatUnread() {
    const badge = el('chatUnread');
    if (!badge) return;
    badge.hidden = chatUnread < 1;
    badge.textContent = chatUnread > 99 ? '99+' : String(chatUnread);
}

function setChatPanelOpen(open) {
    const shell = el('relay');
    if (!shell) return;
    shell.classList.toggle('chat-collapsed', !open);
    const toggle = el('chatToggle');
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(open));
        toggle.title = open ? 'Hide the session chat' : 'Show the session chat';
    }
    const panel = el('chatPanel');
    if (panel) panel.hidden = !open;
    if (open) {
        chatUnread = 0;
        updateChatUnread();
        const list = el('relayLog');
        if (list) list.scrollTop = list.scrollHeight;
    }
    // The board's canvas has just changed width.
    if (typeof wbApplyTransform === 'function') {
        try { wbApplyTransform(false); } catch { /* canvas not built yet */ }
    }
}

function receiveJoinerChatEntry(value) {
    const entry = normaliseJoinerChatEntry(value);
    if (!entry || joinerChatIds.has(entry.id)) return false;
    joinerChatIds.add(entry.id);
    joinerChatEntries.push(entry);
    if (joinerChatEntries.length > 500) joinerChatIds.delete(joinerChatEntries.shift().id);
    if (!chatPanelOpen() && entry.type === 'chat' && entry.sender !== joinedName) {
        chatUnread++;
        updateChatUnread();
    }
    renderJoinerChat();
    return true;
}

function joinerChatTranscript() {
    return joinerChatEntries.map(entry => {
        const stamp = new Date(entry.timestamp).toISOString();
        return entry.type === 'activity'
            ? `[${stamp}] * ${entry.sender} ${entry.text}`
            : `[${stamp}] ${entry.sender}: ${entry.text}`;
    }).join('\n');
}

function downloadJoinerChat() {
    const blob = new Blob([joinerChatTranscript()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `noodleplanner-session-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function submitJoinerChat() {
    const input = el('relayInput');
    if (!socket || socket.readyState !== WebSocket.OPEN || !input.value.trim()) return;
    if (!sessionKey) {
        showPlanNotice('Still establishing the secure channel — try that again in a moment.');
        return;
    }
    const entry = normaliseJoinerChatEntry({
        type: 'chat', id: joinerChatId(), sender: '', text: input.value, timestamp: Date.now(),
    });
    const { encryptMessage } = await loadCollabCrypto();
    const envelope = await encryptMessage(sessionKey, JSON.stringify(entry), sessionId);
    socket.send(envelope);
    input.value = '';
}

// ---- The connection -----------------------------------------------------------

async function sendEncrypted(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!sessionKey) {
        showPlanNotice('Still establishing the secure channel — try that again in a moment.');
        return;
    }
    const { encryptMessage } = await loadCollabCrypto();
    const envelope = await encryptMessage(sessionKey, JSON.stringify(payload), sessionId);
    socket.send(envelope);
}

function stopPresencePing() {
    if (presencePingTimer !== null) {
        clearInterval(presencePingTimer);
        presencePingTimer = null;
    }
}

function setJoinedUi(joined) {
    el('joinScreen').hidden = joined;
    el('relay').hidden = !joined;
    document.body.classList.toggle('is-joined', joined);
    if (joined && typeof initWhiteboard === 'function') {
        needsFirstFit = true;
        initWhiteboard();
        renderJoinerBoard();
    }
}

/** #1347: leave on purpose. Closing with 1000 tells the relay this was the
 * joiner's choice; the close handler below then says so. */
function leaveSession() {
    if (!socket) return;
    leaving = true;
    socket.close(1000, 'Left the session');
}

function handleEncryptedPayload(parsed) {
    if (!parsed) return;
    if (parsed.type === 'plan_snapshot') {
        if (parsed.notice) showPlanNotice(parsed.notice);
        if (typeof parsed.plan_text === 'string' && Number.isInteger(parsed.rev)) {
            // Revisions only move forward. The host builds and encrypts
            // each snapshot asynchronously, so one can reach us after a
            // newer one; drawing it would put the board back to an older
            // plan, and rebase this joiner's pending edit onto it.
            if (parsed.rev <= planSync.rev) return;
            // Someone tidied the board: zoom to fit once it is drawn. The
            // render is asked for outright, since a snapshot that only
            // confirms this joiner's own edit does not redraw anything.
            const fit = parsed.fit === true && typeof wbQueueLayoutFit === 'function';
            if (fit) wbQueueLayoutFit();
            receivePlanSnapshot(parsed.rev, parsed.plan_text);
            if (fit) renderJoinerBoard();
        }
        return;
    }
    if (parsed.type === 'whiteboard_fit') {
        // A Tidy that moved nothing: there is no new board to wait for.
        if (typeof wbQueueLayoutFit === 'function') wbQueueLayoutFit();
        if (typeof wbRunPendingLayoutFit === 'function') wbRunPendingLayoutFit();
        return;
    }
    if (parsed.type === 'plan_text_replace_rejected') {
        receivePlanTextRejected(parsed.reason);
        return;
    }
    if (parsed.type === 'plan_op_rejected') {
        showPlanNotice(parsed.reason === 'stale'
            ? 'That task changed while you were editing — try again.'
            : parsed.reason === 'protected'
                ? 'That change touches part of the plan the host is keeping private, so it was not applied.'
                : 'The host could not apply that change.');
        return;
    }
    if (parsed.type === 'chat' || parsed.type === 'activity') {
        receiveJoinerChatEntry(parsed);
    }
}

async function joinSession(event) {
    event.preventDefault();
    const joinBtn = el('joinBtn');
    const status = el('status');
    joinBtn.disabled = true;
    status.textContent = 'Connecting...';
    leaving = false;

    const code = el('joinCode').value.trim();
    const displayName = el('displayName').value.trim();
    const { deriveConnectKey, generateEphemeralKeyPair } = await loadCollabCrypto();
    keyPair = await generateEphemeralKeyPair();
    sessionId = null;
    connectKeyPromise = null;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws/join`);

    socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'join', code, display_name: displayName }));
    });

    const handleJoinerMessage = async (messageEvent) => {
        let parsed = null;
        try { parsed = JSON.parse(messageEvent.data); } catch { parsed = null; }

        if (parsed && parsed.type === 'joined') {
            sessionId = parsed.session_id;
            joinedName = String(parsed.display_name || displayName);
            connectKeyPromise = deriveConnectKey(code, sessionId);
            status.textContent = '';
            el('sessionWho').textContent = `Joined as ${joinedName}`;
            setJoinedUi(true);
            renderJoinerChat();
            stopPresencePing();
            presencePingTimer = setInterval(() => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'presence_ping' }));
                }
            }, 15000);
            return;
        }

        const {
            classifyFrameType, parsePubkeyAnnouncement, buildPubkeyAnnouncement, deriveSessionKey, decryptMessage,
        } = await loadCollabCrypto();
        const frameType = classifyFrameType(messageEvent.data);

        if (frameType === 'host_pubkey') {
            if (!connectKeyPromise) return;
            const connectKey = await connectKeyPromise;
            const peerKey = await parsePubkeyAnnouncement('host_pubkey', connectKey, messageEvent.data);
            if (!peerKey) {
                status.textContent = 'Could not establish a secure channel with the host. Enter the code again to retry.';
                socket.close();
                return;
            }
            sessionKey = await deriveSessionKey(keyPair.privateKey, peerKey, sessionId);
            const announcement = await buildPubkeyAnnouncement('joiner_pubkey', connectKey, keyPair);
            socket.send(announcement);
            return;
        }

        if (frameType === 'enc') {
            if (!sessionKey) return;
            let plaintext;
            try {
                plaintext = await decryptMessage(sessionKey, messageEvent.data, sessionId);
            } catch {
                return;
            }
            let payload = null;
            try { payload = JSON.parse(plaintext); } catch { payload = null; }
            handleEncryptedPayload(payload);
        }
    };

    // Messages are handled one at a time, in arrival order. Decrypting is
    // async, so handling each as it arrived let a snapshot that finished
    // decrypting late overwrite a newer one already drawn.
    let inbox = Promise.resolve();
    socket.addEventListener('message', (messageEvent) => {
        inbox = inbox
            .then(() => handleJoinerMessage(messageEvent))
            .catch((error) => console.warn('[join] could not handle a message:', error));
    });

    socket.addEventListener('close', (closeEvent) => {
        const wasJoined = !el('relay').hidden;
        const leftOnPurpose = leaving;
        leaving = false;
        stopPresencePing();
        socket = null;
        sessionKey = null;
        keyPair = null;
        connectKeyPromise = null;
        joinerChatEntries.length = 0;
        joinerChatIds.clear();
        chatUnread = 0;
        updateChatUnread();
        renderJoinerChat();
        joinBtn.disabled = false;
        resetPlanSync();
        showPlanText('');
        clearTimeout(planNoticeTimer);
        el('planNotice').hidden = true;
        setJoinedUi(false);

        if (leftOnPurpose) {
            status.textContent = 'You left the session. Enter the code again to rejoin.';
            return;
        }
        if (!wasJoined) {
            if (closeEvent.reason) {
                status.textContent = `${closeEvent.reason} Enter the code again to try again.`;
            } else if (closeEvent.code === 1006) {
                status.textContent = 'Could not connect to the session -- this looks like a network issue (for example, a corporate proxy or firewall blocking secure WebSocket connections) rather than the code. Try a different network, or check with your IT team, then try again.';
            } else {
                status.textContent = 'Could not join -- check the code and try again.';
            }
            return;
        }
        status.textContent = closeEvent.reason
            ? `${closeEvent.reason} Enter the code again to rejoin.`
            : 'Lost connection to the session. Enter the code again to rejoin.';
    });
}

function initJoinPage() {
    el('joinForm').addEventListener('submit', joinSession);
    el('leaveBtn').addEventListener('click', leaveSession);
    el('chatToggle').addEventListener('click', () => setChatPanelOpen(!chatPanelOpen()));
    el('chatCollapse').addEventListener('click', () => setChatPanelOpen(false));
    el('relayForm').addEventListener('submit', (event) => {
        event.preventDefault();
        submitJoinerChat();
    });
    el('relayDownload').addEventListener('click', downloadJoinerChat);
    el('undoBtn').addEventListener('click', undoJoinerEdit);
    el('redoBtn').addEventListener('click', redoJoinerEdit);
    document.addEventListener('keydown', handleUndoShortcut);
    refreshUndoButtons();
    // A hand edit to #planEditor -- nothing on this page makes one, but the
    // whiteboard's own commit raises this event too -- is a local change.
    const editor = planEditorEl();
    if (editor) editor.addEventListener('input', noteLocalPlanChange);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJoinPage);
} else {
    initJoinPage();
}
