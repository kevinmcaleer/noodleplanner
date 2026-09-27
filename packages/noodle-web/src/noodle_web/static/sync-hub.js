/**
 * sync-hub.js -- what the Report ribbon's Sync button does (#1139, part of
 * the front-of-house Sync feature #913).
 *
 * The per-target sync (RAID workbook, MS Project, project workbook) lives in
 * script.js and is listed in Settings > Sync (SYNC_TARGET_DEFS in
 * settings.js). Until this, the ribbon's Sync button only opened that tab
 * (#1123). A button that works needs an answer for every state the targets
 * can be in, and this is those answers:
 *
 *   - **Nothing linked yet.** Say what Sync is for and offer each kind of
 *     file, with a Create button for the one NoodlePlanner can write from
 *     scratch (the project workbook).
 *   - **Linked, and this browser can use every link.** Sync them all, one
 *     after the other, with no dialog of its own: each target opens its own
 *     review when something changed.
 *   - **A link needs attention.** A handle whose permission lapsed
 *     (needs-relink), or a file the plan was synced with in another browser,
 *     cannot be reached without a click: permission prompts need one. List
 *     the targets, a Re-link button on each that needs it, and a Sync button
 *     for the rest. Never skip a target silently.
 *   - **A browser without the File System Access API** (Firefox, Safari).
 *     It cannot remember a file at all, so there is no one-click sync. Say
 *     so, and give each target a button that asks for its file, one click
 *     each (a file dialog needs its own click).
 *
 * Once everything is linked the button never shows the dialog again, so it
 * cannot be how a plan synced with one file goes on to link a second, or
 * swaps a linked file for another. openSyncFiles() opens the dialog in
 * 'manage' mode for that, whatever state the targets are in: the Report
 * ribbon's Sync Files button, and Settings > Storage and Settings > Sync,
 * all open it.
 *
 * While a run is going, the button shows it (data-sync-state="running",
 * aria-busy) and a second press opens the dialog on the progress rather than
 * starting another run. When it ends, a toast says what happened to each
 * target. The button's look while it runs -- the spinning green circle -- is
 * #941's; this sets the state that styling keys off.
 *
 * Each target's flow reports how it ended through reportSyncOutcome(), which
 * script.js calls at the points a review is applied, cancelled, found
 * nothing, or fails. A flow that ends without reporting (a file picker
 * cancelled) counts as skipped.
 */

const syncRun = {
    running: false,
    current: null,       // the target def being synced
    queue: [],           // the defs this run covers
    outcomes: new Map(), // targetKey -> { outcome, detail }
    waiters: new Map(),  // targetKey -> resolve()
};

const SYNC_OUTCOME_TEXT = {
    applied: 'changes applied',
    nochange: 'already up to date',
    cancelled: 'review cancelled',
    error: 'failed',
    skipped: 'skipped',
};

/** Called by each target's flow (script.js) as it ends. The first report for
 *  a target in a run wins: applying a review also closes it. */
function reportSyncOutcome(targetKey, outcome, detail) {
    if (!syncRun.running || syncRun.outcomes.has(targetKey)) return;
    syncRun.outcomes.set(targetKey, { outcome, detail: detail || '' });
    const resolve = syncRun.waiters.get(targetKey);
    if (resolve) resolve();
}

function isSyncRunning() {
    return syncRun.running;
}

function syncHubProjectId() {
    return (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';
}

function syncHubSupported() {
    return typeof LocalFileAccess !== 'undefined' && LocalFileAccess.isSupported();
}

/** Every target, with where it stands in this browser for this plan. */
async function syncTargetStates() {
    const editor = document.getElementById('planEditor');
    const text = editor ? editor.value : '';
    const projectId = syncHubProjectId();
    const supported = syncHubSupported();
    if (supported) await LocalFileAccess.ensureRestored(projectId);
    return SYNC_TARGET_DEFS.map((def) => {
        const file = getSyncFrontMatterField(text, def.fileField);
        const synced = getSyncFrontMatterField(text, def.syncedField);
        const status = supported ? LocalFileAccess.getLinkStatus(projectId, def.targetKey) : 'unsupported';
        const linkedName = supported ? LocalFileAccess.getLinkedFileName(projectId, def.targetKey) : null;
        const configured = Boolean(file) || status === 'linked' || status === 'needs-relink';
        return { def, file, synced, status, linkedName, configured };
    });
}

/**
 * Which dialog the button should open, if any, for a set of target states:
 * 'setup' (nothing linked), 'manual' (no File System Access), 'attention'
 * (something needs a click first) or null (sync straight away).
 */
function syncHubMode(states, supported) {
    const configured = states.filter((s) => s.configured);
    if (!configured.length) return 'setup';
    if (!supported) return 'manual';
    if (configured.some((s) => s.status !== 'linked')) return 'attention';
    return null;
}

/** The dialog for linking, changing and unlinking the files, whatever state
 *  they are in: the way back to it once everything is linked. */
async function openSyncFiles() {
    if (syncRun.running) {
        openSyncHub('running');
        return;
    }
    openSyncHub('manage', await syncTargetStates());
}

/** The Report ribbon's Sync button. Runs from the click. */
async function runFrontOfHouseSync() {
    if (syncRun.running) {
        openSyncHub('running');
        return;
    }
    const supported = syncHubSupported();
    const states = await syncTargetStates();
    const mode = syncHubMode(states, supported);
    if (mode) {
        openSyncHub(mode, states);
        return;
    }
    await runSyncTargets(states.filter((s) => s.configured).map((s) => s.def));
}

function setSyncButtonState() {
    if (typeof refreshRibbon === 'function') refreshRibbon();
}

function overlayIsOpen(id) {
    const el = id && document.getElementById(id);
    return Boolean(el && el.classList.contains('active'));
}

/**
 * Sync each target in turn. A target that opens a review is waited on until
 * the review is applied or cancelled, so reviews never stack on top of one
 * another.
 */
async function runSyncTargets(defs, options) {
    if (syncRun.running || !defs.length) return;
    syncRun.running = true;
    syncRun.queue = defs.slice();
    syncRun.outcomes = new Map();
    syncRun.waiters = new Map();
    setSyncButtonState();
    renderSyncHubIfOpen();

    for (const def of defs) {
        syncRun.current = def;
        renderSyncHubIfOpen();
        const reported = new Promise((resolve) => syncRun.waiters.set(def.targetKey, resolve));
        try {
            await def.syncAction(options);
        } catch (error) {
            console.error('Sync of ' + def.label + ' failed:', error);
            reportSyncOutcome(def.targetKey, 'error', error.message);
        }
        if (!syncRun.outcomes.has(def.targetKey)) {
            if (overlayIsOpen(def.reviewOverlay)) await reported;
            else reportSyncOutcome(def.targetKey, 'skipped');
        }
    }

    const results = defs.map((def) => ({ def, ...syncRun.outcomes.get(def.targetKey) }));
    syncRun.running = false;
    syncRun.current = null;
    setSyncButtonState();
    renderSyncHubIfOpen();
    if (typeof renderSyncSettings === 'function') renderSyncSettings();
    announceSyncResults(results);
    return results;
}

function describeSyncResults(results) {
    return results.map((r) => r.def.label + ': ' + (SYNC_OUTCOME_TEXT[r.outcome] || r.outcome) +
        (r.detail && r.outcome !== 'nochange' ? ' (' + r.detail + ')' : '')).join('; ');
}

function announceSyncResults(results) {
    if (!results.length || typeof showToast !== 'function') return;
    const failed = results.some((r) => r.outcome === 'error');
    const n = results.length;
    showToast('Synced ' + n + ' file' + (n === 1 ? '' : 's') + ' — ' + describeSyncResults(results) + '.', failed ? 'error' : 'success');
}

// ---------------------------------------------------------------------------
// The dialog

let syncHubOpenMode = null;

function openSyncHub(mode, states) {
    syncHubOpenMode = mode;
    const overlay = document.getElementById('syncHubOverlay');
    if (!overlay) return;
    renderSyncHub(states);
    overlay.classList.add('active');
}

function closeSyncHub() {
    document.getElementById('syncHubOverlay')?.classList.remove('active');
    syncHubOpenMode = null;
}

function renderSyncHubIfOpen() {
    if (overlayIsOpen('syncHubOverlay')) renderSyncHub();
}

const SYNC_HUB_INTRO = {
    setup: 'Sync keeps this plan and the files other people work in the same. Nothing is linked yet: link a file below, and from then on this button reads the changes made in it, lets you review them, and writes the plan back out.',
    manual: 'This browser can’t remember a file between syncs, so Sync can’t be one click here: choose the file each time, and the updated copy downloads rather than overwriting it. Chrome and Edge can link a file once and sync it in one click.',
    attention: 'Some linked files need your permission again before this browser can read them. Re-link them below, then sync. Files that are ready sync as they are.',
    manage: 'The files this plan syncs with. Link another file, change a linked file for a different one, or unlink one. Sync reads the changes made in each linked file, lets you review them, and writes the plan back out.',
    running: 'Syncing…',
};

function syncHubStatusText(s) {
    if (s.status === 'linked') return 'Linked to ' + (s.linkedName || s.file || 'a file') + (s.synced ? ' — last synced ' + s.synced : '') + '.';
    if (s.status === 'needs-relink') return 'Linked to ' + (s.linkedName || s.file || 'a file') + ', but this browser needs permission again.';
    if (s.status === 'unsupported') return s.file ? 'Last synced with ' + s.file + (s.synced ? ' on ' + s.synced : '') + '.' : 'Not synced yet.';
    return s.file ? 'Synced with ' + s.file + ' in another browser — link it here to sync.' : 'Not linked.';
}

async function renderSyncHub(states) {
    const body = document.getElementById('syncHubBody');
    const footer = document.getElementById('syncHubFooter');
    if (!body || !footer) return;
    const mode = syncRun.running ? 'running' : syncHubOpenMode;
    const list = states || await syncTargetStates();
    const supported = syncHubSupported();

    const intro = '<p class="sync-hub-intro">' + escapeHtml(SYNC_HUB_INTRO[mode] || '') + '</p>';
    const rows = list.map((s, idx) => {
        const def = s.def;
        const outcome = syncRun.outcomes.get(def.targetKey);
        let status = syncHubStatusText(s);
        if (mode === 'running') {
            status = outcome ? (SYNC_OUTCOME_TEXT[outcome.outcome] || outcome.outcome)
                : syncRun.current === def ? 'Syncing…'
                : syncRun.queue.includes(def) ? 'Waiting' : 'Not part of this sync';
        }
        const buttons = [];
        if (mode === 'setup' || mode === 'manual') {
            buttons.push(['sync', supported ? 'Link existing file…' : 'Choose file…', 'secondary']);
            if (def.createAction && supported) buttons.push(['create', def.createLabel || 'Create…', 'neutral']);
        } else if (mode === 'manage') {
            buttons.push(...manageButtons(s, def, supported));
        } else if (mode === 'attention') {
            if (s.status === 'needs-relink') buttons.push(['relink', 'Re-link', 'primary']);
            else if (s.status === 'unlinked' && s.file) buttons.push(['sync', 'Link and sync…', 'secondary']);
        }
        const actions = buttons.map(([action, label, variant]) =>
            '<np-button size="small" variant="' + variant + '" data-sync-hub-action="' + action + '" data-sync-hub-idx="' + idx + '">' + escapeHtml(label) + '</np-button>').join('');
        return '<div class="sync-target-row" data-sync-hub-target="' + escapeHtml(def.key) + '">' +
            '<div class="sync-target-info"><i class="bi ' + def.icon + '" aria-hidden="true"></i> <strong>' + escapeHtml(def.label) + '</strong>' +
            '<small class="sync-target-status sync-target-status-' + (mode === 'running' ? 'running' : s.status) + '">' + escapeHtml(status) + '</small>' +
            (def.scope ? '<small class="sync-target-scope">' + escapeHtml(def.scope) + '</small>' : '') +
            '</div>' +
            (actions ? '<div class="sync-target-actions">' + actions + '</div>' : '') +
            '</div>';
    }).join('');
    body.innerHTML = intro + '<div class="sync-settings-list sync-hub-list" aria-live="polite">' + rows + '</div>';

    const ready = list.filter((s) => s.configured && s.status === 'linked');
    let footerHtml = '<np-button variant="neutral" data-sync-hub-action="settings">Sync settings</np-button>';
    if (mode === 'attention' || (mode === 'manage' && ready.length)) {
        footerHtml += '<np-button variant="primary" data-sync-hub-action="run"' + (ready.length ? '' : ' disabled') + '>' +
            (ready.length ? 'Sync ' + ready.length + ' ready file' + (ready.length === 1 ? '' : 's') : 'Nothing ready to sync') + '</np-button>';
    } else {
        footerHtml += '<np-button variant="primary" data-sync-hub-action="close">' + (mode === 'running' ? 'Hide' : 'Done') + '</np-button>';
    }
    footer.innerHTML = footerHtml;

    const handle = (el, action, s) => el.addEventListener('click', () => syncHubAction(action, s, list));
    body.querySelectorAll('[data-sync-hub-action]').forEach((el) => handle(el, el.dataset.syncHubAction, list[Number(el.dataset.syncHubIdx)]));
    footer.querySelectorAll('[data-sync-hub-action]').forEach((el) => handle(el, el.dataset.syncHubAction, null));
}

/** A target's buttons in 'manage' mode: link it if it isn't, change or
 *  unlink it if it is. */
function manageButtons(s, def, supported) {
    const buttons = [];
    if (!supported) {
        buttons.push(['sync', 'Choose file…', 'secondary']);
    } else if (!s.configured) {
        buttons.push(['sync', 'Link existing file…', 'secondary']);
        if (def.createAction) buttons.push(['create', def.createLabel || 'Create…', 'neutral']);
    } else if (s.status === 'unlinked') {
        buttons.push(['sync', 'Link and sync…', 'secondary']);
    } else {
        if (s.status === 'needs-relink') buttons.push(['relink', 'Re-link', 'primary']);
        buttons.push(['change', 'Change file…', 'secondary']);
    }
    if (s.configured) buttons.push(['unlink', 'Unlink', 'neutral']);
    return buttons;
}

async function syncHubAction(action, s, list) {
    if (action === 'close') { closeSyncHub(); return; }
    if (action === 'settings') {
        closeSyncHub();
        if (typeof openSettingsPanel === 'function') openSettingsPanel('sync');
        return;
    }
    if (action === 'relink') {
        // The permission prompt must be the first thing the click awaits.
        const granted = await LocalFileAccess.requestWritePermission(syncHubProjectId(), s.def.targetKey);
        if (!granted && typeof showToast === 'function') {
            showToast('Permission wasn’t granted for ' + s.def.label + '. Link and sync it to choose the file again.', 'info');
        }
        renderSyncHub();
        return;
    }
    if (action === 'create') {
        await s.def.createAction();
        renderSyncHub();
        return;
    }
    if (action === 'change') {
        // Straight to the file picker, even though a file is linked: it
        // needs this click's activation, so nothing may be awaited first.
        closeSyncHub();
        await runSyncTargets([s.def], { chooseFile: true });
        return;
    }
    if (action === 'unlink') {
        if (typeof unlinkSyncTarget === 'function') await unlinkSyncTarget(s.def.key);
        renderSyncHub();
        return;
    }
    if (action === 'sync') {
        // One target, from its own click: a file dialog needs one.
        closeSyncHub();
        await runSyncTargets([s.def]);
        return;
    }
    if (action === 'run') {
        const ready = list.filter((x) => x.configured && x.status === 'linked').map((x) => x.def);
        const skipped = list.filter((x) => x.configured && x.status !== 'linked');
        closeSyncHub();
        const results = await runSyncTargets(ready);
        if (skipped.length && typeof showToast === 'function') {
            showToast('Not synced, still waiting to be re-linked: ' + skipped.map((x) => x.def.label).join(', ') + '.', 'info');
        }
        return results;
    }
}

// For the ribbon's button markup (ribbon.js renderButton): the attributes
// that show a run in progress.
function syncButtonAttributes() {
    return syncRun.running ? ' data-sync-state="running" aria-busy="true"' : '';
}
