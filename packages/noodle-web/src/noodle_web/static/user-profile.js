/**
 * user-profile.js -- the user's own profile (#1377).
 *
 * Clicking the profile circle at the right of the ribbon's title bar opens
 * "Your profile": the same details the resource form asks for (shortname,
 * full name, role, email, allocation and non-working days), kept in this
 * browser's localStorage under `np-user-profile`. It is never written into a
 * plan and never sent anywhere by this file. What leaves the browser is the
 * name others already see in a planning session: the host's chat messages
 * carry it (collab-session.js's collabHostName()), and the join page offers
 * it as the "Your name" a joiner sends when they join.
 *
 * Loaded by both index.html and collab_join.html, the two pages whose ribbon
 * shows the circle, so the dialog's markup is one shared partial
 * (templates/_user_profile_dialog.html) rather than a detail-pane section:
 * the join page has no detail pane.
 *
 * A classic script exposing `NoodleUserProfile`, like collab-chat.js, because
 * ribbon.js and collab-session.js are classic scripts too. The storage and
 * normalising half needs no DOM, so tests/test_user_profile.mjs runs it in
 * plain node.
 *
 * Storage can be missing or throw (a private window, blocked site data), so
 * every access is guarded and the profile is also held in memory: in that
 * case it lasts until the page is closed, and nothing else breaks.
 */
(function (root) {
    'use strict';

    const STORAGE_KEY = 'np-user-profile';
    // Raised on document whenever the profile changes, here or in another
    // tab. This file redraws every profile circle on it.
    const CHANGE_EVENT = 'np-user-profile-change';
    // The server trims a joiner's display name to 100 characters
    // (app.py's _admit_joiner), so a longer name could not be used anyway.
    const NAME_MAX = 100;
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    const AUTOSAVE_MS = 500;

    /** One display line: no newlines, runs of whitespace collapsed. */
    function oneLine(value, max) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
    }

    /** A handle as the resource form's `@shortname` takes it: no leading
     * `@`, and none of the characters that end a handle in a resource line
     * (`- @alice: Alice Smith, ...`) or a task's `@alice, @bob`. */
    function cleanShortname(value) {
        return String(value == null ? '' : value).replace(/^@+/, '').replace(/[\s:,@]+/g, '').slice(0, 50);
    }

    function cleanAllocation(value) {
        if (value === '' || value == null) return null;
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.min(100, Math.max(0, Math.round(n)));
    }

    function cleanNonWorkingDays(value) {
        if (!Array.isArray(value)) return [];
        const days = [];
        for (const entry of value) {
            if (!entry || typeof entry !== 'object') continue;
            const start = String(entry.start || '').trim();
            if (!DATE.test(start)) continue;
            const finish = String(entry.finish || '').trim();
            days.push({
                name: oneLine(entry.name, NAME_MAX),
                start,
                finish: DATE.test(finish) && finish >= start ? finish : '',
            });
        }
        days.sort((a, b) => a.start.localeCompare(b.start));
        return days.slice(0, 366);
    }

    /** The profile as it is stored, or null when there is nothing in it.
     * Anything read back from storage goes through here first, so a value
     * hand-edited in devtools or written by an older version cannot put
     * markup or a second line into a chat sender. */
    function normalise(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const profile = {
            shortname: cleanShortname(raw.shortname),
            fullName: oneLine(raw.fullName, NAME_MAX),
            role: oneLine(raw.role, NAME_MAX),
            email: oneLine(raw.email, 254),
            allocation: cleanAllocation(raw.allocation),
            nonWorkingDays: cleanNonWorkingDays(raw.nonWorkingDays),
        };
        const empty = !profile.shortname && !profile.fullName && !profile.role && !profile.email
            && profile.allocation === null && profile.nonWorkingDays.length === 0;
        return empty ? null : profile;
    }

    /** What the profile is called in the app: the full name, else the
     * shortname, else '' (no profile yet). */
    function displayName(profile) {
        if (!profile) return '';
        return profile.fullName || profile.shortname || '';
    }

    function storage() {
        try { return root.localStorage || null; } catch { return null; }
    }

    function readStored() {
        try {
            const store = storage();
            const raw = store ? store.getItem(STORAGE_KEY) : null;
            return raw ? normalise(JSON.parse(raw)) : null;
        } catch {
            return null;
        }
    }

    function writeStored(profile) {
        try {
            const store = storage();
            if (!store) return false;
            if (profile) store.setItem(STORAGE_KEY, JSON.stringify(profile));
            else store.removeItem(STORAGE_KEY);
            return true;
        } catch {
            return false;
        }
    }

    // undefined until first read; null means "no profile".
    let current;

    function get() {
        if (current === undefined) current = readStored();
        return current;
    }

    function announce() {
        const doc = root.document;
        if (!doc || typeof root.CustomEvent !== 'function') return;
        doc.dispatchEvent(new root.CustomEvent(CHANGE_EVENT, { detail: current }));
    }

    /** Save `raw` (normalised) as the profile, or remove it when there is
     * nothing in it. Returns whether it reached storage; the in-memory copy
     * changes either way, so this page still uses it. */
    function set(raw) {
        const next = normalise(raw);
        const persisted = writeStored(next);
        const changed = JSON.stringify(next) !== JSON.stringify(get());
        current = next;
        if (changed) announce();
        return persisted;
    }

    function clear() {
        return set(null);
    }

    // ---- The profile circle ----------------------------------------------
    //
    // A page puts an empty `.user-profile-slot` where the circle goes -- the
    // ribbon's title bar (ribbon.js) and the join page's session bar -- and
    // this file fills it, and fills it again whenever the profile changes.

    /** Draw the circle into `slot`: with a profile, an <np-resource-stack>
     * of one, the chip the planning-session people use, whose card shows
     * name, role and email; without one, an empty button that sets one up.
     * Both open "Your profile". */
    function renderCircle(slot) {
        const doc = root.document;
        if (!slot || !doc) return;
        const profile = get();
        const name = displayName(profile);
        let circle;
        if (name) {
            circle = doc.createElement('np-resource-stack');
            circle.className = 'user-profile-circle';
            circle.setAttribute('max', '1');
            circle.setAttribute('card-action', 'Edit your profile');
            circle.setAttribute('role', 'group');
            circle.setAttribute('aria-label', 'Your profile');
            // By property, not the comma-separated `names` attribute: a name
            // can hold a comma. And only once the element is defined, or the
            // property would shadow the component's own setter.
            const fill = () => {
                circle.names = [name];
                circle.details = { [name]: { name, role: profile.role, email: profile.email } };
            };
            const registry = root.customElements;
            if (registry && registry.get('np-resource-stack')) fill();
            else if (registry) registry.whenDefined('np-resource-stack').then(fill);
            circle.addEventListener('resource-activate', () => open(slot));
            circle.addEventListener('resource-open', () => open(slot));
        } else {
            circle = doc.createElement('button');
            circle.type = 'button';
            circle.className = 'user-profile-circle-empty';
            circle.title = 'Set up your profile';
            circle.setAttribute('aria-label', 'Set up your profile');
            circle.innerHTML = '<svg width="14" height="14" aria-hidden="true"><use href="#icon-person"></use></svg>';
            circle.addEventListener('click', () => open(slot));
        }
        slot.replaceChildren(circle);
    }

    function renderCircles() {
        if (!root.document) return;
        root.document.querySelectorAll('.user-profile-slot').forEach(renderCircle);
    }

    /** The control inside a slot, to hand focus back to. */
    function circleControl(slot) {
        const circle = slot && slot.firstElementChild;
        if (!circle) return null;
        return circle.shadowRoot ? circle.shadowRoot.querySelector('.chip') : circle;
    }

    // ---- The dialog ------------------------------------------------------

    const NWD_TABLE = 'userProfileNonWorkingDaysTableBody';
    let autosaveTimer = null;
    // The slot whose circle opened the dialog, by id: its contents are
    // redrawn while the dialog is open (every save redraws them, and the
    // ribbon redraws its whole title bar on Esc), so a node would be stale.
    let openerSlotId = '';

    function byId(id) {
        return root.document ? root.document.getElementById(id) : null;
    }

    function dialogEl() {
        return byId('userProfileDialog');
    }

    function fillForm(profile, suggestedName) {
        const p = profile || {};
        byId('userProfileShortname').value = p.shortname || '';
        byId('userProfileFullName').value = p.fullName || suggestedName || '';
        byId('userProfileRole').value = p.role || '';
        byId('userProfileEmail').value = p.email || '';
        byId('userProfileAllocation').value = p.allocation == null ? '' : String(p.allocation);
        if (typeof root.initNwdTable === 'function') root.initNwdTable(NWD_TABLE, p.nonWorkingDays || []);
    }

    function readForm() {
        return {
            shortname: byId('userProfileShortname').value,
            fullName: byId('userProfileFullName').value,
            role: byId('userProfileRole').value,
            email: byId('userProfileEmail').value,
            allocation: byId('userProfileAllocation').value,
            nonWorkingDays: typeof root.getNwdEntriesFromTable === 'function'
                ? root.getNwdEntriesFromTable(NWD_TABLE) : [],
        };
    }

    function flushAutosave() {
        if (autosaveTimer === null) return;
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
        set(readForm());
    }

    /** Save as the user types, the way the resource form does. Also what
     * script.js's non-working-days table calls on a row change. */
    function autoSave() {
        if (autosaveTimer !== null) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            autosaveTimer = null;
            set(readForm());
        }, AUTOSAVE_MS);
    }

    /** Open "Your profile". With no profile yet, the full name starts as
     * whatever name this page already knows the user by -- the name a
     * joiner joined with (collab-join.js's userProfileSuggestedName()).
     * `slot` is the circle's slot, when a circle opened it. */
    function open(slot) {
        const dialog = dialogEl();
        if (!dialog) return;
        openerSlotId = slot && slot.id ? slot.id : '';
        const profile = get();
        const suggested = !profile && typeof root.userProfileSuggestedName === 'function'
            ? oneLine(root.userProfileSuggestedName(), NAME_MAX) : '';
        fillForm(profile, suggested);
        if (!dialog.open) dialog.showModal();
        const first = byId('userProfileFullName');
        if (first) first.focus();
    }

    function close() {
        const dialog = dialogEl();
        if (dialog && dialog.open) dialog.close();
    }

    function done() {
        if (autosaveTimer !== null) clearTimeout(autosaveTimer);
        autosaveTimer = null;
        set(readForm());
        close();
    }

    function clearFromDialog() {
        if (autosaveTimer !== null) clearTimeout(autosaveTimer);
        autosaveTimer = null;
        clear();
        fillForm(null, '');
        const first = byId('userProfileFullName');
        if (first) first.focus();
    }

    function wireDialog() {
        const dialog = dialogEl();
        if (!dialog || dialog.dataset.wired) return;
        dialog.dataset.wired = 'true';
        const form = byId('userProfileForm');
        if (form) {
            form.addEventListener('input', (event) => {
                // The non-working-days table saves itself through
                // triggerNwdAutoSave(), on its own row logic.
                if (!event.target.closest('#' + NWD_TABLE)) autoSave();
            });
            form.addEventListener('submit', (event) => { event.preventDefault(); done(); });
        }
        byId('userProfileDone')?.addEventListener('click', done);
        byId('userProfileClear')?.addEventListener('click', clearFromDialog);
        byId('userProfileClose')?.addEventListener('click', close);
        // Esc closes a modal dialog natively; anything typed in the last
        // half-second is saved rather than dropped. The dialog would hand
        // focus back to the element that opened it, but that circle has
        // usually been redrawn since, so focus goes to its replacement --
        // after a tick, so the ribbon's own redraw on Esc has landed.
        dialog.addEventListener('close', () => {
            flushAutosave();
            const slotId = openerSlotId;
            openerSlotId = '';
            if (!slotId) return;
            setTimeout(() => {
                const control = circleControl(byId(slotId));
                if (control) control.focus();
            }, 0);
        });
        // A click on the backdrop lands on the <dialog> itself: its panel
        // fills the whole box, so nothing inside the form does.
        dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    }

    function init() {
        wireDialog();
        renderCircles();
        root.document.addEventListener(CHANGE_EVENT, renderCircles);
        // Another tab saved or cleared the profile.
        if (typeof root.addEventListener === 'function') {
            root.addEventListener('storage', (event) => {
                if (event.key !== STORAGE_KEY && event.key !== null) return;
                current = readStored();
                announce();
            });
        }
    }

    if (root.document) {
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
        else init();
    }

    const api = {
        STORAGE_KEY, CHANGE_EVENT,
        normalise, displayName, get, set, clear,
        open, close, autoSave, renderCircle,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NoodleUserProfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
