/**
 * dashboard-widgets.js — configurable dashboard widgets (issue #779).
 *
 * The project dashboard (`project-report` view) is a set of widgets, each a
 * child of #dashboardWidgets carrying a stable `data-widget-id`. The PM can
 * hide, show and reorder them, and resize them between a few sizes; the
 * arrangement is stored in the plan's front matter so it travels with the file:
 *
 *   dashboard:
 *     - {id: timeline, size: wide}
 *     - {id: task_completion, size: narrow}
 *     - {id: milestones, size: half}
 *     - {id: risks, size: half, hidden: true}
 *
 * Rules (all in the pure functions below, unit tested in
 * tests/test_dashboard_widgets.mjs):
 *   - No `dashboard:` key means the default layout; "Reset to default" removes it.
 *   - Hidden widgets stay in the list with `hidden: true`, so a widget that is
 *     absent from the list is a *new* one and is appended, visible, at the end.
 *   - An unknown id (written by a newer version) is never rendered, never an
 *     error, and is written back untouched so it survives a save.
 *
 * Pure layout logic first, DOM after. Loaded after settings.js.
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Column spans on the 12-column dashboard grid. */
const DASHBOARD_SIZES = ['full', 'wide', 'half', 'narrow'];

/**
 * Every dashboard widget: stable id, title, default size. The array order is
 * the default order. `title` is what the picker shows.
 */
const DASHBOARD_WIDGETS = [
    { id: 'timeline',        title: 'Timeline',        size: 'wide' },
    { id: 'task_completion', title: 'Task completion', size: 'narrow' },
    { id: 'milestones',      title: 'Milestones',      size: 'half' },
    { id: 'up_next',         title: 'Up Next',         size: 'half' },
    { id: 'highlights',      title: 'Latest Highlight', size: 'half' },
    { id: 'risks',           title: 'Risks & Issues',  size: 'half' },
    { id: 'budget',          title: 'Budget Summary',  size: 'half' },
    { id: 'actions',         title: 'Open Actions',    size: 'half' },
];

const DASHBOARD_WIDGET_BY_ID = Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w.id, w]));

function defaultDashboardLayout() {
    return DASHBOARD_WIDGETS.map(w => ({ id: w.id, size: w.size, hidden: false }));
}

// ---------------------------------------------------------------------------
// Front matter <-> layout (pure)
// ---------------------------------------------------------------------------

/** Location of the `dashboard:` block's lines inside a front-matter line array. */
function findDashboardBlock(fmLines) {
    let start = -1;
    for (let i = 0; i < fmLines.length; i++) {
        if (/^dashboard\s*:\s*$/i.test(fmLines[i])) { start = i; break; }
    }
    if (start === -1) return null;
    let end = start + 1;
    // The block is the indented / list lines that follow.
    while (end < fmLines.length && /^(\s+|-\s)/.test(fmLines[end]) && fmLines[end].trim() !== '') end++;
    return { start, end };
}

/** Parse one `- {id: x, size: half, hidden: true}` line, or null. */
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

/** Raw entries from plan text; null when there is no `dashboard:` block. */
function readDashboardEntries(planText) {
    const fm = String(planText || '').match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fm) return null;
    const lines = fm[1].split('\n');
    const block = findDashboardBlock(lines);
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
function resolveDashboardLayout(entries) {
    if (!entries) return defaultDashboardLayout();
    const seen = new Set();
    const out = [];
    for (const e of entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const def = DASHBOARD_WIDGET_BY_ID[e.id];
        if (!def) {
            out.push({ id: e.id, size: e.size || '', hidden: e.hidden === 'true', unknown: true });
            continue;
        }
        out.push({
            id: e.id,
            size: DASHBOARD_SIZES.includes(e.size) ? e.size : def.size,
            hidden: e.hidden === 'true',
        });
    }
    for (const w of DASHBOARD_WIDGETS) {
        if (!seen.has(w.id)) out.push({ id: w.id, size: w.size, hidden: false });
    }
    return out;
}

function dashboardLayoutFromText(planText) {
    return resolveDashboardLayout(readDashboardEntries(planText));
}

function isDefaultDashboardLayout(layout) {
    const def = defaultDashboardLayout();
    const known = layout.filter(i => !i.unknown);
    return layout.length === def.length && known.length === def.length &&
        def.every((d, i) => layout[i].id === d.id && layout[i].size === d.size && !layout[i].hidden);
}

/** The block text for a layout, e.g. "dashboard:\n  - {id: x, size: half}\n". */
function formatDashboardBlock(layout) {
    let out = 'dashboard:\n';
    for (const i of layout) {
        const parts = [`id: ${i.id}`];
        if (i.size) parts.push(`size: ${i.size}`);
        if (i.hidden) parts.push('hidden: true');
        out += `  - {${parts.join(', ')}}\n`;
    }
    return out;
}

/**
 * Return `planText` with its `dashboard:` block set to `layout` (replacing in
 * place, so an unchanged layout is byte-identical), or removed when `layout`
 * is null or the default.
 */
function setDashboardBlock(planText, layout) {
    const text = String(planText || '');
    const wantBlock = layout && !isDefaultDashboardLayout(layout);
    const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fm) {
        return wantBlock ? '---\n' + formatDashboardBlock(layout) + '---\n' + text : text;
    }
    const lines = fm[1].split('\n');
    const block = findDashboardBlock(lines);
    const newLines = wantBlock ? formatDashboardBlock(layout).replace(/\n$/, '').split('\n') : [];
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

function setDashboardWidgetSize(layout, id, size) {
    if (!DASHBOARD_SIZES.includes(size)) return layout.map(i => ({ ...i }));
    return layout.map(i => (i.id === id ? { ...i, size } : { ...i }));
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function dashboardGrid() {
    return document.getElementById('dashboardWidgets');
}

/** Order, size and show/hide the widgets to match `layout`. */
function renderDashboardLayout(layout) {
    const grid = dashboardGrid();
    if (!grid) return;
    const custom = !isDefaultDashboardLayout(layout);
    if (custom) grid.setAttribute('data-custom', ''); else grid.removeAttribute('data-custom');
    let unknown = 0;
    for (const item of layout) {
        if (item.unknown) { unknown++; continue; }
        const el = grid.querySelector(`:scope > [data-widget-id="${item.id}"]`);
        if (!el) continue;
        grid.appendChild(el); // appending in layout order sorts the DOM
        el.setAttribute('data-size', item.size);
        if (item.hidden) el.setAttribute('data-widget-hidden', ''); else el.removeAttribute('data-widget-hidden');
    }
    // A quiet note, not an error, when the file names widgets this version lacks.
    grid.dataset.unknownWidgets = unknown ? String(unknown) : '';
    if (unknown) console.info(`[dashboard] ignoring ${unknown} unknown widget id(s) in front matter`);
}

function currentDashboardLayout() {
    const editor = (typeof getActiveEditor === 'function' ? getActiveEditor() : null) || document.getElementById('planEditor');
    return dashboardLayoutFromText(editor ? editor.value : '');
}

/** Apply the layout stored in the plan text (called whenever the report renders). */
function applyDashboardFromPlan(planText) {
    renderDashboardLayout(dashboardLayoutFromText(planText));
    refreshDashboardPanel();
}

/** Write a new layout to the plan's front matter and re-render. */
function commitDashboardLayout(layout) {
    const editor = (typeof getActiveEditor === 'function' ? getActiveEditor() : null) || document.getElementById('planEditor');
    if (!editor) return;
    const updated = setDashboardBlock(editor.value, layout);
    renderDashboardLayout(layout || defaultDashboardLayout());
    if (updated !== editor.value) {
        editor.value = updated;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    refreshDashboardPanel();
}

// --- Customise panel -------------------------------------------------------

function refreshDashboardPanel(focusSel) {
    const panel = document.getElementById('dashboardCustomizePanel');
    if (!panel || panel.hidden) return;
    const layout = currentDashboardLayout().filter(i => !i.unknown);
    const sizeLabels = { full: 'Full width', wide: 'Wide', half: 'Half', narrow: 'Narrow' };
    panel.textContent = '';

    const heading = document.createElement('h3');
    heading.className = 'dashboard-panel-title';
    heading.textContent = 'Dashboard widgets';
    panel.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'dashboard-panel-list';
    layout.forEach((item, idx) => {
        const def = DASHBOARD_WIDGET_BY_ID[item.id];
        const li = document.createElement('li');
        li.className = 'dashboard-panel-row';
        li.draggable = true;
        li.dataset.widgetId = item.id;

        const label = document.createElement('label');
        label.className = 'dashboard-panel-label';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !item.hidden;
        cb.setAttribute('data-act', 'toggle');
        cb.addEventListener('change', () => {
            commitDashboardLayout(setDashboardWidgetHidden(currentDashboardLayout(), item.id, !cb.checked));
        });
        label.append(cb, ' ', def.title);
        li.appendChild(label);

        const size = document.createElement('select');
        size.className = 'dashboard-panel-size';
        size.setAttribute('aria-label', `${def.title} size`);
        for (const s of DASHBOARD_SIZES) {
            const o = document.createElement('option');
            o.value = s; o.textContent = sizeLabels[s]; o.selected = s === item.size;
            size.appendChild(o);
        }
        size.addEventListener('change', () => {
            commitDashboardLayout(setDashboardWidgetSize(currentDashboardLayout(), item.id, size.value));
        });
        li.appendChild(size);

        for (const [dir, text, name] of [[-1, '↑', 'up'], [1, '↓', 'down']]) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'dashboard-panel-move';
            b.setAttribute('data-act', name);
            b.textContent = text;
            b.setAttribute('aria-label', `Move ${def.title} ${name}`);
            b.disabled = (dir < 0 && idx === 0) || (dir > 0 && idx === layout.length - 1);
            b.addEventListener('click', () => {
                commitDashboardLayout(moveDashboardWidget(currentDashboardLayout(), item.id, dir));
                const again = panel.querySelector(`[data-widget-id="${item.id}"] [data-act="${name}"]`);
                const fallback = panel.querySelector(`[data-widget-id="${item.id}"] [data-act="${name === 'up' ? 'down' : 'up'}"]`);
                const target = (again && !again.disabled) ? again : fallback;
                if (target) target.focus();
            });
            li.appendChild(b);
        }

        li.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', item.id);
            e.dataTransfer.effectAllowed = 'move';
        });
        li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('drop-target'); });
        li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
        li.addEventListener('drop', e => {
            e.preventDefault();
            li.classList.remove('drop-target');
            const dragged = e.dataTransfer.getData('text/plain');
            if (dragged) commitDashboardLayout(moveDashboardWidgetBefore(currentDashboardLayout(), dragged, item.id));
        });
        list.appendChild(li);
    });
    panel.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'dashboard-panel-actions';
    const reset = document.createElement('np-button');
    reset.setAttribute('variant', 'secondary');
    reset.setAttribute('size', 'small');
    reset.id = 'dashboardResetBtn';
    reset.textContent = 'Reset to default';
    reset.addEventListener('click', () => commitDashboardLayout(null));
    const done = document.createElement('np-button');
    done.setAttribute('variant', 'primary');
    done.setAttribute('size', 'small');
    done.id = 'dashboardDoneBtn';
    done.textContent = 'Done';
    done.addEventListener('click', () => toggleDashboardPanel(false));
    actions.append(reset, done);
    panel.appendChild(actions);

    if (focusSel) { const f = panel.querySelector(focusSel); if (f) f.focus(); }
}

function toggleDashboardPanel(open) {
    const panel = document.getElementById('dashboardCustomizePanel');
    const btn = document.getElementById('dashboardCustomizeBtn');
    if (!panel) return;
    const show = open === undefined ? panel.hidden : !!open;
    panel.hidden = !show;
    if (btn) btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) refreshDashboardPanel('[data-act="toggle"]');
    else if (btn) btn.focus();
}

function initDashboardWidgets() {
    const btn = document.getElementById('dashboardCustomizeBtn');
    if (btn) btn.addEventListener('click', () => toggleDashboardPanel());
    const panel = document.getElementById('dashboardCustomizePanel');
    if (panel) panel.addEventListener('keydown', e => { if (e.key === 'Escape') toggleDashboardPanel(false); });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDashboardWidgets);
    else initDashboardWidgets();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DASHBOARD_WIDGETS, DASHBOARD_SIZES, defaultDashboardLayout, readDashboardEntries,
        resolveDashboardLayout, dashboardLayoutFromText, isDefaultDashboardLayout,
        formatDashboardBlock, setDashboardBlock, moveDashboardWidget,
        moveDashboardWidgetBefore, setDashboardWidgetHidden, setDashboardWidgetSize,
    };
}
