/**
 * sync-ui.js -- the cloud button in the ribbon's title bar and the "Account
 * and sync" dialog (templates/_sync_dialog.html). The engine is
 * account-sync.js (window.NoodleSync.instance); this only shows its status
 * and forwards the buttons.
 */
(function (root) {
    'use strict';

    const doc = root.document;
    if (!doc) return;

    const STATES = {
        loading:      { label: 'Account and sync' },
        'signed-out': { label: 'Sign in to sync your plans' },
        off:          { label: 'Sync is off' },
        idle:         { label: 'Account and sync' },
        syncing:      { label: 'Syncing…' },
        ok:           { label: 'Plans are in sync' },
        error:        { label: 'Sync problem' },
    };

    function engine() {
        return root.NoodleSync && root.NoodleSync.instance;
    }

    function byId(id) { return doc.getElementById(id); }

    function currentKind() {
        const e = engine();
        return e ? e.getStatus().kind : 'idle';
    }

    // ---- the button ------------------------------------------------------

    function renderButton(slot) {
        if (!slot) return;
        const kind = currentKind();
        const info = STATES[kind] || STATES.idle;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'sync-button';
        button.dataset.state = kind;
        button.title = info.label;
        button.setAttribute('aria-label', info.label);
        button.innerHTML = '<svg width="14" height="14" aria-hidden="true"><use href="#icon-cloud"></use></svg>';
        button.addEventListener('click', open);
        slot.replaceChildren(button);
    }

    function renderButtons() {
        doc.querySelectorAll('.sync-slot').forEach(renderButton);
    }

    // ---- the dialog ------------------------------------------------------

    function ago(ms) {
        if (!ms) return 'not yet';
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 60) return 'just now';
        if (s < 3600) return Math.round(s / 60) + ' min ago';
        if (s < 86400) return Math.round(s / 3600) + ' h ago';
        return new Date(ms).toLocaleDateString();
    }

    function summaryText(s) {
        if (!s) return '';
        const parts = [];
        if (s.created) parts.push(s.created + ' uploaded');
        if (s.pushed) parts.push(s.pushed + ' sent');
        if (s.downloaded) parts.push(s.downloaded + ' downloaded');
        if (s.pulled) parts.push(s.pulled + ' updated');
        if (s.deleted || s.removedLocal) parts.push((s.deleted + s.removedLocal) + ' deleted');
        if (s.versionsPushed || s.versionsPulled) {
            parts.push((s.versionsPushed + s.versionsPulled) + ' version' + (s.versionsPushed + s.versionsPulled === 1 ? '' : 's'));
        }
        if (s.conflicts) parts.push(s.conflicts + ' conflict' + (s.conflicts === 1 ? '' : 's') + ' kept as copies');
        return parts.length ? ' · ' + parts.join(', ') : '';
    }

    function show(id, on) {
        const el = byId(id);
        if (el) el.hidden = !on;
    }

    function renderDialog() {
        const dialog = byId('syncDialog');
        if (!dialog) return;
        const e = engine();
        const st = e ? e.getStatus() : { kind: 'idle' };
        const kind = st.kind;
        const signedOut = kind === 'signed-out';
        const known = kind !== 'idle' && kind !== 'loading';
        show('syncChecking', !known);
        show('syncSignedOut', signedOut);
        show('syncOff', known && !signedOut && !st.enabled);
        show('syncOn', known && !signedOut && !!st.enabled);
        const email = st.user && st.user.email ? st.user.email : '';
        byId('syncOffEmail').textContent = email;
        byId('syncOnEmail').textContent = email;
        const line = byId('syncStatusLine');
        if (kind === 'syncing') line.textContent = 'Syncing…';
        else line.textContent = 'Last synced ' + ago(st.lastSync) + summaryText(st.summary);
        const err = byId('syncError');
        err.textContent = st.error || '';
        err.hidden = !st.error;
        const now = byId('syncNow');
        if (now) now.disabled = kind === 'syncing';
    }

    function open() {
        const dialog = byId('syncDialog');
        if (!dialog) return;
        renderDialog();
        if (!dialog.open) dialog.showModal();
        const e = engine();
        if (e) e.sync();                                      // refresh who is signed in
    }

    function close() {
        const dialog = byId('syncDialog');
        if (dialog && dialog.open) dialog.close();
    }

    function init() {
        const e = engine();
        if (e) e.subscribe(() => { renderButtons(); renderDialog(); });
        renderButtons();
        const dialog = byId('syncDialog');
        if (!dialog) return;
        byId('syncDialogClose').addEventListener('click', close);
        dialog.addEventListener('click', (ev) => { if (ev.target === dialog) close(); });
        byId('syncEnable').addEventListener('click', () => { if (e) e.enable(); });
        byId('syncDisable').addEventListener('click', () => { if (e) { e.disable(); renderDialog(); } });
        byId('syncNow').addEventListener('click', () => { if (e) e.sync(); });
    }

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();

    root.NoodleSyncUI = { renderButton, renderButtons, open, close };
})(typeof globalThis !== 'undefined' ? globalThis : this);
