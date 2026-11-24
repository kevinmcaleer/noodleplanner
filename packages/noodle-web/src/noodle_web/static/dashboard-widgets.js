/**
 * dashboard-widgets.js — configurable dashboard widgets (issues #779, #1619+).
 *
 * The project dashboard (`project-report` view) is a set of widgets, each a
 * child of #dashboardWidgets carrying a stable `data-widget-id`. The PM can
 * move, resize, hide and show them, and each device (desktop, tablet, phone)
 * keeps its own arrangement. The arrangement is stored in the plan's front
 * matter so it travels with the file:
 *
 *   dashboard:                    # desktop, a 12-column grid
 *     - {id: timeline, w: 9}
 *     - {id: milestones, w: 6, h: 2}
 *     - {id: risks, w: 6, hidden: true}
 *   dashboard_tablet:             # tablet, 6 columns
 *     - {id: actions, w: 6, h: 2}
 *   dashboard_phone:              # phone, one column: order and height only
 *     - {id: milestones, w: 1}
 *
 *   w       columns the widget spans (whole columns, clamped to the device)
 *   h       rows tall (a row is --dashboard-row, 170px); absent = size to content
 *   hidden  true hides the widget but keeps its place
 *   size    legacy (#779) word for w on the desktop block: full/wide/half/narrow
 *
 * Rules (all in the pure functions below, unit tested in
 * tests/test_dashboard_widgets.mjs):
 *   - A device with no block shows its default layout; Reset removes the block.
 *   - A widget absent from a block is a *new* one and is appended, visible.
 *   - An unknown id (written by a newer version) is never rendered, never an
 *     error, and is written back untouched so it survives a save.
 *
 * Pure layout logic first, DOM after. Loaded after settings.js.
 */

// ---------------------------------------------------------------------------
// Registry and devices
// ---------------------------------------------------------------------------

/**
 * Per-device grid: the front-matter key it is stored under, how many columns it
 * has, and the narrowest a widget may be on it. Device names are the values of
 * <html data-layout> (layout-mode.js).
 */
const DASHBOARD_DEVICES = {
    desktop: { key: 'dashboard',        cols: 12, minW: 3 },
    tablet:  { key: 'dashboard_tablet', cols: 6,  minW: 2 },
    phone:   { key: 'dashboard_phone',  cols: 1,  minW: 1 },
};

const DASHBOARD_MAX_ROWS = 8;

/** Legacy (#779) `size:` words, as desktop columns. */
const DASHBOARD_LEGACY_SIZES = { full: 12, wide: 9, half: 6, narrow: 3 };

/**
 * Every dashboard widget: stable id, title, and default column span per device.
 * The array order is the default (desktop and tablet) order; the phone default
 * order is DASHBOARD_PHONE_ORDER.
 */
const DASHBOARD_WIDGETS = [
    { id: 'timeline',        title: 'Timeline',         w: { desktop: 9, tablet: 4 } },
    { id: 'task_completion', title: 'Task completion',  w: { desktop: 3, tablet: 2 } },
    { id: 'milestones',      title: 'Milestones',       w: { desktop: 6, tablet: 3 } },
    { id: 'up_next',         title: 'Up Next',          w: { desktop: 6, tablet: 3 } },
    { id: 'highlights',      title: 'Latest Highlight', w: { desktop: 6, tablet: 3 } },
    { id: 'risks',           title: 'Risks & Issues',   w: { desktop: 6, tablet: 3 } },
    { id: 'budget',          title: 'Budget Summary',   w: { desktop: 6, tablet: 3 } },
    { id: 'actions',         title: 'Open Actions',     w: { desktop: 6, tablet: 3 } },
];

/** The order someone checks the dashboard in on a phone. */
const DASHBOARD_PHONE_ORDER = ['milestones', 'up_next', 'risks', 'actions', 'highlights', 'budget', 'timeline', 'task_completion'];

const DASHBOARD_WIDGET_BY_ID = Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w.id, w]));

function dashboardDevice(device) {
    return DASHBOARD_DEVICES[device] ? device : 'desktop';
}

function defaultWidgetWidth(id, device) {
    const dev = dashboardDevice(device);
    if (dev === 'phone') return 1;
    return DASHBOARD_WIDGET_BY_ID[id].w[dev];
}

function defaultDashboardLayout(device) {
    const dev = dashboardDevice(device);
    const ids = dev === 'phone' ? DASHBOARD_PHONE_ORDER : DASHBOARD_WIDGETS.map(w => w.id);
    return ids.map(id => ({ id, w: defaultWidgetWidth(id, dev), h: null, hidden: false }));
}

function clampDashboardWidth(w, device) {
    const dev = DASHBOARD_DEVICES[dashboardDevice(device)];
    const n = Math.round(Number(w));
    if (!Number.isFinite(n)) return dev.cols;
    return Math.max(dev.minW, Math.min(dev.cols, n));
}

/** Rows tall, or null for "size to the content". */
function clampDashboardHeight(h) {
    const n = Math.round(Number(h));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(DASHBOARD_MAX_ROWS, n);
}

// ---------------------------------------------------------------------------
// Front matter <-> layout (pure)
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Location of the `<key>:` block's lines inside a front-matter line array. */
function findDashboardBlock(fmLines, key) {
    const header = new RegExp('^' + escapeRegExp(key) + '\\s*:\\s*$', 'i');
    let start = -1;
    for (let i = 0; i < fmLines.length; i++) {
        if (header.test(fmLines[i])) { start = i; break; }
    }
    if (start === -1) return null;
    let end = start + 1;
    // The block is the indented / list lines that follow.
    while (end < fmLines.length && /^(\s+|-\s)/.test(fmLines[end]) && fmLines[end].trim() !== '') end++;
    return { start, end };
}

/** Parse one `- {id: x, w: 6, h: 2, hidden: true}` line, or null. */
function parseDashboardLine(line) {
    const m = line.match(/^\s*-\s*\{(.*)\}\s*$/);
    if (!m) return null;
    const entry = {};
    for (const part of m[1].split(',')) {
        const kv = part.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
        if (kv) entry[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
    }
    return entry.id ? entry : null;
}

/** Raw entries for a device from plan text; null when it has no block. */
function readDashboardEntries(planText, device) {
    const fm = String(planText || '').match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fm) return null;
    const lines = fm[1].split('\n');
    const block = findDashboardBlock(lines, DASHBOARD_DEVICES[dashboardDevice(device)].key);
    if (!block) return null;
    const entries = [];
    for (const line of lines.slice(block.start + 1, block.end)) {
        const e = parseDashboardLine(line);
        if (e) entries.push(e);
    }
    return entries;
}

/**
 * Turn raw entries into a full layout: known widgets in the saved order,
 * unknown ids kept (flagged) for write-back, new widgets appended visible.
 */
function resolveDashboardLayout(entries, device) {
    const dev = dashboardDevice(device);
    if (!entries) return defaultDashboardLayout(dev);
    const seen = new Set();
    const out = [];
    for (const e of entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const hidden = e.hidden === 'true';
        if (!DASHBOARD_WIDGET_BY_ID[e.id]) {
            out.push({ id: e.id, w: e.w ? Number(e.w) || null : null, h: clampDashboardHeight(e.h), hidden, unknown: true });
            continue;
        }
        let w = defaultWidgetWidth(e.id, dev);
        if (e.w !== undefined) w = clampDashboardWidth(e.w, dev);
        else if (dev === 'desktop' && DASHBOARD_LEGACY_SIZES[e.size]) w = DASHBOARD_LEGACY_SIZES[e.size];
        out.push({ id: e.id, w: dev === 'phone' ? 1 : w, h: clampDashboardHeight(e.h), hidden });
    }
    const missing = defaultDashboardLayout(dev).filter(i => !seen.has(i.id));
    return out.concat(missing);
}

function dashboardLayoutFromText(planText, device) {
    return resolveDashboardLayout(readDashboardEntries(planText, device), device);
}

function isDefaultDashboardLayout(layout, device) {
    const def = defaultDashboardLayout(device);
    return layout.length === def.length &&
        def.every((d, i) => layout[i].id === d.id && !layout[i].unknown &&
            layout[i].w === d.w && layout[i].h == null && !layout[i].hidden);
}

/** The block text for a layout, e.g. "dashboard:\n  - {id: x, w: 6}\n". */
function formatDashboardBlock(layout, device) {
    let out = DASHBOARD_DEVICES[dashboardDevice(device)].key + ':\n';
    for (const i of layout) {
        const parts = [`id: ${i.id}`];
        if (i.w) parts.push(`w: ${i.w}`);
        if (i.h) parts.push(`h: ${i.h}`);
        if (i.hidden) parts.push('hidden: true');
        out += `  - {${parts.join(', ')}}\n`;
    }
    return out;
}

/**
 * Return `planText` with the device's block set to `layout` (replacing in
 * place, so an unchanged layout is byte-identical), or removed when `layout`
 * is null or the default. Other devices' blocks are never touched.
 */
function setDashboardBlock(planText, layout, device) {
    const text = String(planText || '');
    const dev = dashboardDevice(device);
    const wantBlock = layout && !isDefaultDashboardLayout(layout, dev);
    const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fm) {
        return wantBlock ? '---\n' + formatDashboardBlock(layout, dev) + '---\n' + text : text;
    }
    const lines = fm[1].split('\n');
    const block = findDashboardBlock(lines, DASHBOARD_DEVICES[dev].key);
    const newLines = wantBlock ? formatDashboardBlock(layout, dev).replace(/\n$/, '').split('\n') : [];
    if (block) {
        lines.splice(block.start, block.end - block.start, ...newLines);
    } else if (wantBlock) {
        lines.push(...newLines);
    } else {
        return text;
    }
    const open = fm[0].slice(0, fm[0].indexOf('\n') + 1);
    return open + lines.join('\n') + text.slice(fm[0].length - 4);
}

// ---------------------------------------------------------------------------
// Layout edits (pure)
// ---------------------------------------------------------------------------

function moveDashboardWidget(layout, id, delta) {
    const next = layout.map(i => ({ ...i }));
    const from = next.findIndex(i => i.id === id);
    if (from === -1) return next;
    // Step over unknown (never rendered) entries so a move is always visible.
    let to = from;
    const dir = delta < 0 ? -1 : 1;
    let steps = Math.abs(delta);
    while (steps > 0 && to + dir >= 0 && to + dir < next.length) {
        to += dir;
        if (!next[to].unknown) steps--;
    }
    if (to === from) return next;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

function moveDashboardWidgetBefore(layout, id, beforeId) {
    const next = layout.map(i => ({ ...i }));
    const from = next.findIndex(i => i.id === id);
    if (from === -1 || id === beforeId) return next;
    const [item] = next.splice(from, 1);
    const to = beforeId ? next.findIndex(i => i.id === beforeId) : -1;
    if (to === -1) next.push(item); else next.splice(to, 0, item);
    return next;
}

function setDashboardWidgetHidden(layout, id, hidden) {
    return layout.map(i => (i.id === id ? { ...i, hidden: !!hidden } : { ...i }));
}

/** Set a widget's width in columns and/or height in rows (0 = size to content). */
function setDashboardWidgetSpan(layout, id, device, span) {
    return layout.map(i => {
        if (i.id !== id) return { ...i };
        const next = { ...i };
        if (span.w !== undefined) next.w = clampDashboardWidth(span.w, device);
        if (span.h !== undefined) next.h = clampDashboardHeight(span.h);
        return next;
    });
}

function stepDashboardWidgetWidth(layout, id, device, delta) {
    const cur = layout.find(i => i.id === id);
    if (!cur) return layout.map(i => ({ ...i }));
    return setDashboardWidgetSpan(layout, id, device, { w: (cur.w || defaultWidgetWidth(id, device)) + delta });
}

/** One row taller / shorter. Content-sized counts as "two rows" going up. */
function stepDashboardWidgetHeight(layout, id, delta) {
    const cur = layout.find(i => i.id === id);
    if (!cur) return layout.map(i => ({ ...i }));
    let h;
    if (cur.h == null) h = delta > 0 ? 2 : null;
    else h = cur.h + delta;
    return layout.map(i => (i.id === id ? { ...i, h: clampDashboardHeight(h) } : { ...i }));
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const dashboardState = { editing: false };

function dashboardGrid() {
    return document.getElementById('dashboardWidgets');
}

/** 'desktop' | 'tablet' | 'phone', from <html data-layout> (never a width in JS). */
function currentDashboardDevice() {
    const d = document.documentElement && document.documentElement.dataset.layout;
    return dashboardDevice(d);
}

function currentPlanEditor() {
    return (typeof getActiveEditor === 'function' ? getActiveEditor() : null) || document.getElementById('planEditor');
}

function currentDashboardLayout() {
    const editor = currentPlanEditor();
    return dashboardLayoutFromText(editor ? editor.value : '', currentDashboardDevice());
}

/** Order, size and show/hide the widgets to match `layout`. */
function renderDashboardLayout(layout, device) {
    const grid = dashboardGrid();
    if (!grid) return;
    const dev = dashboardDevice(device || currentDashboardDevice());
    grid.setAttribute('data-device', dev);
    if (isDefaultDashboardLayout(layout, dev)) grid.removeAttribute('data-custom'); else grid.setAttribute('data-custom', '');
    let unknown = 0;
    for (const item of layout) {
        if (item.unknown) { unknown++; continue; }
        const el = grid.querySelector(`:scope > [data-widget-id="${item.id}"]`);
        if (!el) continue;
        grid.appendChild(el); // appending in layout order sorts the DOM
        el.style.setProperty('--dashboard-w', String(item.w || defaultWidgetWidth(item.id, dev)));
        if (item.h) { el.style.setProperty('--dashboard-h', String(item.h)); el.setAttribute('data-h', String(item.h)); }
        else { el.style.removeProperty('--dashboard-h'); el.removeAttribute('data-h'); }
        if (item.hidden) el.setAttribute('data-widget-hidden', ''); else el.removeAttribute('data-widget-hidden');
    }
    // A quiet note, not an error, when the file names widgets this version lacks.
    grid.dataset.unknownWidgets = unknown ? String(unknown) : '';
    if (unknown) console.info(`[dashboard] ignoring ${unknown} unknown widget id(s) in front matter`);
}

/** Apply the layout stored in the plan text (called whenever the report renders). */
function applyDashboardFromPlan(planText) {
    const dev = currentDashboardDevice();
    renderDashboardLayout(dashboardLayoutFromText(planText, dev), dev);
    refreshDashboardEditing();
}

/** Write a new layout for the current device to the plan's front matter and re-render. */
function commitDashboardLayout(layout) {
    const editor = currentPlanEditor();
    if (!editor) return;
    const dev = currentDashboardDevice();
    const updated = setDashboardBlock(editor.value, layout, dev);
    renderDashboardLayout(layout || defaultDashboardLayout(dev), dev);
    if (updated !== editor.value) {
        editor.value = updated;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    refreshDashboardEditing();
}

// --- Editing ---------------------------------------------------------------

const DASHBOARD_GRIP_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><circle cx="4.5" cy="3" r="1.3"/><circle cx="9.5" cy="3" r="1.3"/><circle cx="4.5" cy="7" r="1.3"/><circle cx="9.5" cy="7" r="1.3"/><circle cx="4.5" cy="11" r="1.3"/><circle cx="9.5" cy="11" r="1.3"/></svg>';
const DASHBOARD_RESIZE_SVG = '<svg width="24" height="24" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M22 12L12 22M22 17l-5 5"/></svg>';

function dashboardWidgetTitle(id) {
    return DASHBOARD_WIDGET_BY_ID[id] ? DASHBOARD_WIDGET_BY_ID[id].title : id;
}

function editBarButton(act, glyph, label, extraClass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dashboard-edit-btn' + (extraClass ? ' ' + extraClass : '');
    b.dataset.act = act;
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
}

/** Add (or refresh) each widget's edit bar and resize handle. */
function decorateDashboardWidgets(layout, dev) {
    const grid = dashboardGrid();
    if (!grid) return;
    const phone = dev === 'phone';
    layout.forEach((item, idx) => {
        if (item.unknown) return;
        const el = grid.querySelector(`:scope > [data-widget-id="${item.id}"]`);
        if (!el) return;
        const title = dashboardWidgetTitle(item.id);
        el.querySelectorAll(':scope > .dashboard-edit-bar, :scope > .dashboard-resize').forEach(n => n.remove());

        const bar = document.createElement('div');
        bar.className = 'dashboard-edit-bar';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', `Layout controls for ${title}`);
        const grip = document.createElement('button');
        grip.type = 'button';
        grip.className = 'dashboard-grip';
        grip.dataset.act = 'drag';
        grip.setAttribute('aria-label', `Drag to move ${title}`);
        grip.title = `Drag to move ${title}`;
        grip.innerHTML = DASHBOARD_GRIP_SVG;
        const tools = document.createElement('span');
        tools.className = 'dashboard-edit-tools';
        const visible = layout.filter(i => !i.unknown && !i.hidden);
        const pos = visible.findIndex(i => i.id === item.id);
        const prev = editBarButton('prev', phone ? '↑' : '←', `Move ${title} earlier`);
        const next = editBarButton('next', phone ? '↓' : '→', `Move ${title} later`);
        prev.disabled = pos <= 0;
        next.disabled = pos === -1 || pos >= visible.length - 1;
        tools.append(prev, next);
        if (!phone) {
            const narrow = editBarButton('narrower', '−', `Make ${title} narrower`);
            const wide = editBarButton('wider', '+', `Make ${title} wider`);
            narrow.disabled = (item.w || 0) <= DASHBOARD_DEVICES[dev].minW;
            wide.disabled = (item.w || 0) >= DASHBOARD_DEVICES[dev].cols;
            tools.append(narrow, wide);
        }
        const shorter = editBarButton('shorter', '⇧', `Make ${title} shorter`);
        const taller = editBarButton('taller', '⇩', `Make ${title} taller`);
        shorter.disabled = item.h == null;
        taller.disabled = item.h != null && item.h >= DASHBOARD_MAX_ROWS;
        tools.append(shorter, taller, editBarButton('hide', '×', `Hide ${title}`));
        bar.append(grip, tools);
        el.insertBefore(bar, el.firstChild);

        if (!phone) {
            const handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'dashboard-resize';
            handle.dataset.act = 'resize';
            handle.setAttribute('aria-label', `Drag to resize ${title}`);
            handle.title = `Drag to resize ${title}`;
            handle.innerHTML = DASHBOARD_RESIZE_SVG;
            el.appendChild(handle);
        }
        el.dataset.dashboardIndex = String(idx);
    });
}

function undecorateDashboardWidgets() {
    const grid = dashboardGrid();
    if (!grid) return;
    grid.querySelectorAll('.dashboard-edit-bar, .dashboard-resize').forEach(n => n.remove());
}

function refreshDashboardTray(layout, dev) {
    const tray = document.getElementById('dashboardTray');
    if (!tray) return;
    tray.textContent = '';
    if (!dashboardState.editing) { tray.hidden = true; return; }
    tray.hidden = false;

    const note = document.createElement('p');
    note.className = 'dashboard-tray-note';
    note.id = 'dashboardEditNote';
    const phone = dev === 'phone';
    note.textContent = (phone
        ? 'Use the arrows to reorder and the height buttons to make a widget taller. '
        : 'Drag a handle to move a widget and its bottom-right corner to resize it, or use the buttons. ') +
        `This is the ${dev} layout; each screen size keeps its own.`;
    tray.appendChild(note);

    const hidden = layout.filter(i => !i.unknown && i.hidden);
    const row = document.createElement('div');
    row.className = 'dashboard-tray-row';
    if (hidden.length) {
        const lead = document.createElement('span');
        lead.textContent = 'Add a widget:';
        row.appendChild(lead);
        for (const item of hidden) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'dashboard-add-btn';
            b.dataset.act = 'add';
            b.dataset.widgetId = item.id;
            b.textContent = '+ ' + dashboardWidgetTitle(item.id);
            row.appendChild(b);
        }
    } else {
        const none = document.createElement('span');
        none.textContent = 'Every widget is on the dashboard.';
        row.appendChild(none);
    }
    tray.appendChild(row);
}

/** Bring the toolbar, edit bars and tray in line with the editing state. */
function refreshDashboardEditing() {
    const grid = dashboardGrid();
    const btn = document.getElementById('dashboardCustomizeBtn');
    const reset = document.getElementById('dashboardResetBtn');
    if (!grid) return;
    const dev = currentDashboardDevice();
    const layout = currentDashboardLayout();
    if (btn) {
        btn.textContent = dashboardState.editing ? 'Done' : 'Customise dashboard';
        btn.setAttribute('variant', dashboardState.editing ? 'primary' : 'secondary');
        btn.setAttribute('aria-pressed', dashboardState.editing ? 'true' : 'false');
    }
    if (reset) reset.hidden = !dashboardState.editing;
    if (dashboardState.editing) { grid.setAttribute('data-editing', ''); decorateDashboardWidgets(layout, dev); }
    else { grid.removeAttribute('data-editing'); undecorateDashboardWidgets(); }
    refreshDashboardTray(layout, dev);
}

function setDashboardEditing(on) {
    dashboardState.editing = !!on;
    refreshDashboardEditing();
    const btn = document.getElementById('dashboardCustomizeBtn');
    if (!on && btn && typeof btn.focus === 'function') btn.focus();
}

function focusDashboardControl(id, act, fallbackAct) {
    const grid = dashboardGrid();
    if (!grid) return;
    const el = grid.querySelector(`:scope > [data-widget-id="${id}"]`);
    if (!el) return;
    let target = el.querySelector(`[data-act="${act}"]:not(:disabled)`);
    if (!target && fallbackAct) target = el.querySelector(`[data-act="${fallbackAct}"]:not(:disabled)`);
    if (!target) target = el.querySelector('.dashboard-edit-bar button:not(:disabled)');
    if (target) target.focus();
}

function onDashboardClick(e) {
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b || !dashboardState.editing) return;
    const grid = dashboardGrid();
    if (!grid || !grid.contains(b)) {
        if (b.id === 'dashboardResetBtn' || (b.dataset.act === 'add' && b.closest('#dashboardTray'))) { /* handled below */ } else return;
    }
    const act = b.dataset.act;
    const dev = currentDashboardDevice();
    const layout = currentDashboardLayout();
    const widget = b.closest('[data-widget-id]');
    const id = b.dataset.widgetId || (widget && widget.dataset.widgetId);
    if (act === 'add') {
        commitDashboardLayout(setDashboardWidgetHidden(layout, id, false));
        return;
    }
    if (!id) return;
    let next = null;
    if (act === 'prev') next = moveDashboardWidget(layout, id, -1);
    else if (act === 'next') next = moveDashboardWidget(layout, id, 1);
    else if (act === 'narrower') next = stepDashboardWidgetWidth(layout, id, dev, -1);
    else if (act === 'wider') next = stepDashboardWidgetWidth(layout, id, dev, 1);
    else if (act === 'shorter') next = stepDashboardWidgetHeight(layout, id, -1);
    else if (act === 'taller') next = stepDashboardWidgetHeight(layout, id, 1);
    else if (act === 'hide') next = setDashboardWidgetHidden(layout, id, true);
    if (!next) return;
    commitDashboardLayout(next);
    // Keep focus on the same kind of control so the keyboard user can go on.
    const opposite = { prev: 'next', next: 'prev', narrower: 'wider', wider: 'narrower', shorter: 'taller', taller: 'shorter' };
    if (act !== 'hide') focusDashboardControl(id, act, opposite[act]);
    else { const first = grid.querySelector(':scope > [data-widget-id]:not([data-widget-hidden]) .dashboard-grip'); if (first) first.focus(); }
}

// --- Pointer drag: move by the grip, resize by the corner ------------------

function dashboardRowPx(grid) {
    const v = parseFloat(getComputedStyle(grid).getPropertyValue('--dashboard-row'));
    return Number.isFinite(v) && v > 0 ? v : 170;
}

function onDashboardPointerDown(e) {
    if (!dashboardState.editing) return;
    const handle = e.target.closest && e.target.closest('.dashboard-grip, .dashboard-resize');
    const grid = dashboardGrid();
    if (!handle || !grid || !grid.contains(handle)) return;
    e.preventDefault();
    const el = handle.closest('[data-widget-id]');
    const id = el.dataset.widgetId;
    const dev = currentDashboardDevice();
    const spec = DASHBOARD_DEVICES[dev];
    let layout = currentDashboardLayout();
    let over = null;
    let move;
    if (handle.classList.contains('dashboard-grip')) {
        el.classList.add('dashboard-dragging');
        move = ev => {
            const t = document.elementFromPoint(ev.clientX, ev.clientY);
            const o = t && t.closest ? t.closest('#dashboardWidgets > [data-widget-id]') : null;
            if (over && over !== o) over.classList.remove('dashboard-drop');
            over = o && o !== el ? o : null;
            if (over) over.classList.add('dashboard-drop');
        };
    } else {
        const rect = el.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
        const colW = (gridRect.width - gap * (spec.cols - 1)) / spec.cols;
        const rowH = dashboardRowPx(grid);
        const rowGap = parseFloat(getComputedStyle(grid).rowGap) || 0;
        move = ev => {
            // Relative to where the corner was grabbed, so the widget does not jump.
            const w = Math.round((rect.width + ev.clientX - e.clientX + gap) / (colW + gap));
            const h = Math.round((rect.height + ev.clientY - e.clientY + rowGap) / (rowH + rowGap));
            layout = setDashboardWidgetSpan(currentDashboardLayout(), id, dev, { w, h });
            // Live preview only; the plan text is written on release.
            const item = layout.find(i => i.id === id);
            el.style.setProperty('--dashboard-w', String(item.w));
            el.style.setProperty('--dashboard-h', String(item.h || 1));
            el.setAttribute('data-h', String(item.h || 1));
        };
    }
    const up = () => {
        window.removeEventListener('pointermove', move);
        el.classList.remove('dashboard-dragging');
        if (over) {
            over.classList.remove('dashboard-drop');
            commitDashboardLayout(moveDashboardWidgetBefore(currentDashboardLayout(), id, over.dataset.widgetId));
        } else if (handle.classList.contains('dashboard-resize')) {
            commitDashboardLayout(layout);
        }
        focusDashboardControl(id, handle.dataset.act === 'resize' ? 'resize' : 'drag');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
}

function initDashboardWidgets() {
    const btn = document.getElementById('dashboardCustomizeBtn');
    if (btn) btn.addEventListener('click', () => setDashboardEditing(!dashboardState.editing));
    const reset = document.getElementById('dashboardResetBtn');
    if (reset) reset.addEventListener('click', () => commitDashboardLayout(null));
    const view = document.getElementById('project-report-view');
    if (view) {
        view.addEventListener('click', onDashboardClick);
        view.addEventListener('pointerdown', onDashboardPointerDown);
        view.addEventListener('keydown', e => { if (e.key === 'Escape' && dashboardState.editing) setDashboardEditing(false); });
    }
    // A device change (rotate, resize across a breakpoint) swaps to that device's layout.
    document.addEventListener('layoutchange', () => {
        const editor = currentPlanEditor();
        if (dashboardGrid() && editor) applyDashboardFromPlan(editor.value);
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDashboardWidgets);
    else initDashboardWidgets();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DASHBOARD_WIDGETS, DASHBOARD_DEVICES, DASHBOARD_MAX_ROWS, defaultDashboardLayout, readDashboardEntries,
        resolveDashboardLayout, dashboardLayoutFromText, isDefaultDashboardLayout,
        formatDashboardBlock, setDashboardBlock, moveDashboardWidget,
        moveDashboardWidgetBefore, setDashboardWidgetHidden, setDashboardWidgetSpan,
        stepDashboardWidgetWidth, stepDashboardWidgetHeight,
    };
}
