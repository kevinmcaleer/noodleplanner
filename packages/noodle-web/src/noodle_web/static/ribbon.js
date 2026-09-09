/**
 * ribbon.js -- renders the ribbon from ribbon-ia.js (design handoff
 * "Ribbon Toolbar option 2a", #833 follow-up). Replaces the single-row
 * command bar from the first pass at #833/#839.
 *
 * DOM, state and action-wiring live here; ribbon-ia.js (the command
 * catalogue) and ribbon-layout.js (the overflow fit calculation) stay
 * pure and framework-free so they can be unit-tested without a browser.
 *
 * Every button calls the exact function its old toolbar/menu entry called
 * -- this is additive, not a rewrite of app behaviour. Buttons for
 * features that don't exist yet (Programme scope, card-level Kanban
 * actions, portfolio heat maps, etc.) render per the design but show a
 * "not available yet" toast rather than doing nothing silently.
 */

let iaModule = null;
function loadIA() {
    if (!iaModule) iaModule = import('/static/ribbon-ia.js');
    return iaModule;
}

// ---------------------------------------------------------------------------
// Persisted + in-memory state
// ---------------------------------------------------------------------------

const RIBBON_STATE_KEY = 'noodleplanner:ribbon-state';

function loadPersistedState() {
    try {
        const raw = localStorage.getItem(RIBBON_STATE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        return {};
    }
}

function savePersistedState() {
    try {
        localStorage.setItem(RIBBON_STATE_KEY, JSON.stringify({
            scope: ribbonState.scope,
            collapsed: ribbonState.collapsed,
            // #955: full-vs-simple is a per-browser display preference, same
            // category as scope/collapsed above -- never written into plan
            // text or front matter.
            density: ribbonState.density,
        }));
    } catch (error) {
        // localStorage unavailable (private mode, quota) -- state just won't persist.
    }
}

const persisted = loadPersistedState();
const ribbonState = {
    scope: persisted.scope || 'project',
    activeTab: 'home',
    collapsed: !!persisted.collapsed,
    // #955: 'full' (the original multi-row ribbon) or 'simple' (a single
    // dense row, closer to Office's "Simplified Ribbon"). Orthogonal to
    // `collapsed` -- see renderDisplayToggle()'s comment for how the two
    // compose.
    density: persisted.density === 'simple' ? 'simple' : 'full',
    morePopoverOpen: false,
    displayMenuOpen: false,
};

// ---------------------------------------------------------------------------
// Live app state the buttons' isActive/isEnabled and the action resolver read
// ---------------------------------------------------------------------------

function getLiveState() {
    const view = (typeof NavigationController !== 'undefined') ? NavigationController.getCurrentView() : null;
    return {
        view,
        canUndo: (typeof EditorUndoManager !== 'undefined') ? EditorUndoManager.canUndo() : false,
        canRedo: (typeof EditorUndoManager !== 'undefined') ? EditorUndoManager.canRedo() : false,
        kanbanViewMode: (typeof kanbanBoard !== 'undefined' && kanbanBoard) ? kanbanBoard.viewMode : null,
        ganttShowCriticalPath: !!document.getElementById('ganttShowCriticalPath')?.checked,
        ganttShowBaseline: !!document.getElementById('ganttShowBaseline')?.checked,
        ganttShowDependencies: !!document.getElementById('ganttShowDependencies')?.checked,
        isDark: document.documentElement.getAttribute('data-theme') === 'dark',
        // theme.js's currentThemeChoice ('light'|'dark'|'system') -- a plain
        // top-level `let` in a classic script, so it's readable here as a
        // shared global, same as NavigationController/EditorUndoManager above.
        themeChoice: (typeof currentThemeChoice !== 'undefined') ? currentThemeChoice : 'light',
    };
}

function notAvailable(label) {
    if (typeof showToast === 'function') showToast(`${label} isn't available yet`, 'info');
}

// ---------------------------------------------------------------------------
// Action resolution: label -> real function.
//
// The large majority of the ~200 buttons in the catalogue are view
// switches or already-existing editor/view functions, resolved by plain
// label. A handful of labels mean something different depending on which
// tab they're in (Track's RAID group's bare "Import"/"Export" are RAID's
// own Excel sync, not the plan-level import/export) -- those are resolved
// first, scoped by tab id, before falling back to the generic map.
// ---------------------------------------------------------------------------

const VIEW_FOR_LABEL = {
    Tasks: 'tasks', Board: 'kanban', Gantt: 'gantt', Timeline: 'timeline', Calendar: 'calendar',
    RAID: 'raid', 'RAID Log': 'raid', Actions: 'actions', Highlights: 'highlights', Lookahead: 'lookahead',
    Lessons: 'lessons', Budget: 'budget', EVM: 'evm', Benefits: 'benefits', Analysis: 'analysis',
    Resources: 'resources', Stakeholders: 'stakeholders', Timesheet: 'timesheet', Workload: 'user-workload',
    'Resource Sheet': 'resource-sheet', 'Comms Plan': 'comms', Report: 'project-report', 'Project Report': 'project-report',
    Dashboard: 'project-report',
    Milestones: 'milestones', 'Mind Map': 'mindmap', Whiteboard: 'whiteboard', PBS: 'pbs', Products: 'pbs',
    'Product Flow': 'product-flow', Deliverables: 'deliverables', Editor: 'editor',
    // #909 ribbon-parity follow-up: the old top nav's Tools > Syntax Guide item.
    'Syntax Guide': 'guide',
};

function switchView(view) {
    return () => switchToView(view);
}

/** Format-choice popovers for the caret Export/Import buttons -- these are
 * explicitly marked as split/gallery buttons in the design, not single
 * actions, so they open a small menu rather than picking one format. */
const EXPORT_FORMATS = [
    { label: 'Excel (.xlsx)', run: () => exportFile('excel', 'editor') },
    { label: 'CSV', run: () => exportFile('csv', 'editor') },
    { label: 'PDF', run: () => exportFile('pdf', 'editor') },
    { label: 'PowerPoint', run: () => exportReportPptx() },
    { label: 'MS Project (.mpp)', run: () => exportFile('mpp', 'editor') },
];
const IMPORT_FORMATS = [
    { label: 'Plan file (.md)', run: () => uploadPlanFile() },
    { label: 'Excel', run: () => triggerExcelUpload() },
    { label: 'MS Project', run: () => triggerMSProjectUpload() },
];
const RAID_EXPORT_FORMATS = [
    { label: 'Excel (.xlsx)', run: () => exportRaidExcel() },
    { label: 'Markdown (.md)', run: () => downloadRaidMarkdown() },
];
const RAID_IMPORT_FORMATS = [
    { label: 'Excel (.xlsx)', run: () => document.getElementById('raidXlUpload')?.click() },
    { label: 'Markdown (.md)', run: () => document.getElementById('raidMdUpload')?.click() },
];
const GANTT_SCALES = ['days', 'weeks', 'months', 'quarters', 'years'].map((scale) => ({
    label: scale.charAt(0).toUpperCase() + scale.slice(1),
    run: () => {
        const el = document.getElementById('ganttScale');
        if (!el) return;
        el.value = scale;
        el.dispatchEvent(new Event('change'));
    },
}));
const KANBAN_GROUP_MODES = ['phase', 'resource', 'progress', 'label', 'bucket'].map((mode) => ({
    label: mode.charAt(0).toUpperCase() + mode.slice(1),
    run: () => switchKanbanView(mode),
}));

/** Navigate to the portfolio view's `name` sub-view (portfolio.js's own
 * switchPortfolioView() -- Projects/Status/Team Allocation/Timeline/
 * Actions/Risks/Look-Ahead/Dependencies/Benefits/Lessons), switching into
 * the Portfolio view first if it isn't already current. */
function switchPortfolioSubview(name) {
    return () => {
        switchToView('portfolio');
        if (typeof switchPortfolioView === 'function') switchPortfolioView(name);
    };
}

/** Tab/context-scoped overrides, checked before the generic label map. */
function scopedAction(scopeId, label) {
    const table = {
        // Portfolio scope (#936) -- portfolio.js's own sub-nav, wired directly
        // rather than through VIEW_FOR_LABEL since these are sub-views within
        // the single "portfolio" NavigationController view, not separate views.
        'pf-home:Projects': switchPortfolioSubview('projects'),
        'pf-home:New Project': () => showCreateProjectDialog(),
        'pf-home:Import Project': () => showImportProjectDialog(),
        'pf-home:Status': switchPortfolioSubview('status'),
        'pf-home:Export Report': () => exportPortfolioReport(),
        'pf-home:Actions': switchPortfolioSubview('actions'),
        'pf-plan:Timeline': switchPortfolioSubview('timeline'),
        'pf-plan:Look-Ahead': switchPortfolioSubview('lookahead'),
        'pf-plan:Dependencies': switchPortfolioSubview('dependencies'),
        'pf-plan:Team Allocation': switchPortfolioSubview('resources'),
        'pf-plan:Level Team': () => {
            switchPortfolioSubview('resources')();
            if (typeof showLevellingSuggestions === 'function') showLevellingSuggestions();
        },
        'pf-track:Risks': switchPortfolioSubview('risks'),
        'pf-track:Benefits': switchPortfolioSubview('benefits'),
        'pf-track:Lessons': switchPortfolioSubview('lessons'),

        // Fixes for the pre-existing "portfolio" contextual tab (shown when
        // the Portfolio view is open, regardless of scope pill), found
        // during the #938 dead-button audit -- these labels were "known"
        // to the coverage test (they matched a generic table entry) but
        // resolved to the *wrong* thing, "Dependencies"/"Benefits" falling
        // through to project-scope handlers (a no-op gantt-checkbox toggle,
        // and a navigate-away-from-portfolio project view), and "Add
        // Project" was marked a stub even though showCreateProjectDialog()
        // already exists and is exactly what the button says. "Capacity"
        // now points at the Team Allocation view, the one place capacity
        // and workload are actually shown.
        'portfolio:Add Project': () => showCreateProjectDialog(),
        'portfolio:Dependencies': switchPortfolioSubview('dependencies'),
        'portfolio:Benefits': switchPortfolioSubview('benefits'),
        'portfolio:Capacity': switchPortfolioSubview('resources'),

        'raid:Import': () => openFormatMenu(RAID_IMPORT_FORMATS, 'Import'),
        'raid:Export': () => openFormatMenu(RAID_EXPORT_FORMATS, 'Export'),
        'raid:New Risk': () => addRaidItem(),
        'raid:New Issue': () => addRaidItem(),
        'raid:Assumption': () => addRaidItem(),
        'raid:Dependency': () => addRaidItem(),
        'lessons:New Lesson': () => addLessonsItem(),
        'stakeholders:Add Stakeholder': () => addStakeholderRow(),
        'stakeholders:Comms Plan': switchView('comms'),
        'resources:Add Resource': () => openResourceForm(),
        'resources:Timesheet': switchView('timesheet'),
        'resources:Workload': switchView('user-workload'),
        'kanban:Phase': () => switchKanbanView('phase'),
        'kanban:Resource': () => switchKanbanView('resource'),
        'kanban:Progress': () => switchKanbanView('progress'),
        'kanban:Label': () => switchKanbanView('label'),
        'kanban:Group by': () => openFormatMenu(KANBAN_GROUP_MODES, 'Group by'),
        'whiteboard:Mind Map': switchView('mindmap'),
        'whiteboard:Whiteboard': switchView('whiteboard'),
        'gantt:Day/Week/Month': () => openFormatMenu(GANTT_SCALES, 'Scale'),
    };
    return table[`${scopeId}:${label}`];
}

const LABEL_ACTIONS = {
    // Editor / structure
    Indent: () => indentSelectedLines(),
    Outdent: () => outdentSelectedLines(),
    Link: () => linkSelectedTasks(),
    'New Task': () => addNewTaskViaShortcut(),
    'New task': () => addNewTaskViaShortcut(),
    Details: () => openTaskInspectorForCurrentLine(),

    // File / save / print
    Save: () => downloadMarkdown(),
    'Open…': () => openLocalPlanFile(),
    Print: () => window.print(),
    Templates: () => openTemplatesModal(),
    Settings: () => openSettingsPanel(),
    Undo: () => EditorUndoManager.undo(),

    // Gantt toggles -- real checkboxes in the (hidden-when-inactive) gantt
    // view, flipped via a real 'change' event so views-gantt.js's own
    // addEventListener('change', ...) wiring does the actual work.
    'Critical Path': () => toggleGanttCheckbox('ganttShowCriticalPath'),
    Baseline: () => toggleGanttCheckbox('ganttShowBaseline'),
    Dependencies: () => toggleGanttCheckbox('ganttShowDependencies'),
    Deps: () => toggleGanttCheckbox('ganttShowDependencies'),
    Risk: () => addRaidItem(),
    Issue: () => addRaidItem(),

    'Dark Mode': () => setThemeChoice(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'),
    // #909 ribbon-parity follow-up -- old top nav's 3-way theme menu's third
    // option (follow the OS preference); see theme.js's resolveTheme().
    'System Theme': () => setThemeChoice('system'),
    // #909 ribbon-parity follow-up -- old top nav's AI button, when
    // unconfigured, opened this same modal (see ai-config.js's onAIButtonClick).
    'AI Settings': () => openAISettingsModal(),

    // Export/import formats named as individual buttons (Report > Share / Data)
    PDF: () => exportFile('pdf', 'editor'),
    Excel: () => exportFile('excel', 'editor'),
    PowerPoint: () => exportReportPptx(),
};

function toggleGanttCheckbox(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change'));
}

/**
 * Resolve a button to a runnable action, or null for a graceful "not
 * available yet" stub. `scopeId` is the contextual tab id when the button
 * lives in one, else the main tab id.
 */
function resolveAction(scopeId, label) {
    const scoped = scopedAction(scopeId, label);
    if (scoped) return scoped;

    if (label === 'Export' || label === 'Export…') return () => openFormatMenu(EXPORT_FORMATS, label);
    if (label === 'Import' || label === 'Import from Excel / MS Project') return () => openFormatMenu(IMPORT_FORMATS, label);

    if (VIEW_FOR_LABEL[label]) return switchView(VIEW_FOR_LABEL[label]);
    if (LABEL_ACTIONS[label]) return LABEL_ACTIONS[label];
    return null;
}

/** Labels whose action opens its own popover (a caret format menu) --
 * refreshRibbon() replaces .ribbon-tabstrip's innerHTML wholesale, which
 * would destroy that popover the instant it opened, so these must skip
 * the post-action refresh rather than re-render over their own menu. */
const OPENS_OWN_POPOVER = new Set(['Export', 'Export…', 'Import', 'Import from Excel / MS Project', 'Group by', 'Day/Week/Month']);

function runAction(scopeId, label) {
    const action = resolveAction(scopeId, label);
    if (action) {
        action();
        if (!OPENS_OWN_POPOVER.has(label)) refreshRibbon();
    } else {
        notAvailable(label);
    }
}

// ---------------------------------------------------------------------------
// Small popovers: caret format-choice menus (Import/Export) render as a
// `.ribbon-file-menu` -- the same look the old File dropdown used before
// #972 retired it in favour of File navigating straight to Backstage.
// ---------------------------------------------------------------------------

function closePopovers() {
    document.querySelectorAll('.ribbon-file-menu, .ribbon-more-popover, .ribbon-display-menu').forEach((el) => el.remove());
    ribbonState.morePopoverOpen = false;
    ribbonState.displayMenuOpen = false;
}

function openFormatMenu(formats, label) {
    closePopovers();
    const strip = document.querySelector('.ribbon-tabstrip');
    if (!strip) return;
    const menu = document.createElement('div');
    menu.className = 'ribbon-file-menu';
    menu.style.left = '8px';
    menu.innerHTML = formats.map((f, i) =>
        `<button type="button" class="ribbon-file-menu-item" data-format-index="${i}">
            <span class="ribbon-file-menu-item-label">${f.label}</span>
        </button>`
    ).join('');
    menu.addEventListener('click', (e) => {
        const btn = e.target.closest('.ribbon-file-menu-item');
        if (!btn) return;
        formats[Number(btn.dataset.formatIndex)].run();
        closePopovers();
    });
    strip.appendChild(menu);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function icon(name, size, extraStyle) {
    return `<svg width="${size}" height="${size}"${extraStyle ? ` style="${extraStyle}"` : ''}><use href="#icon-${name}"></use></svg>`;
}

function renderTitleBar(ia, live) {
    const scopePills = ia.SCOPES.map((s) => {
        const active = s.id === ribbonState.scope;
        return `<button type="button" class="ribbon-scope-btn${active ? ' active' : ''}" data-scope="${s.id}" title="${s.blurb}">
            ${icon(s.icon, 14)}${s.label}
        </button>`;
    }).join('');

    const quickActions = ia.QUICK_ACTIONS.map((q) => {
        const disabled = q.label === 'Undo' && !live.canUndo;
        return `<button type="button" class="ribbon-quick-btn" data-quick="${q.label}" title="${q.label}" aria-label="${q.label}" ${disabled ? 'disabled' : ''}>
            ${icon(q.icon, 16)}
        </button>`;
    }).join('');

    return `
        <img class="ribbon-mark" src="/static/icons/icon-192.png" alt="Noodle Planner">
        <div class="ribbon-scope-track" role="radiogroup" aria-label="Scope">${scopePills}</div>
        <span class="ribbon-titlebar-sep"></span>
        <div class="ribbon-quick-actions">${quickActions}</div>
        <span class="ribbon-doc-title" id="ribbonDocTitle"></span>
        <div class="ribbon-titlebar-spacer"></div>
        ${renderSearchBox()}
        <span class="ribbon-avatar" id="ribbonAvatar" aria-hidden="true"></span>
    `;
}

/**
 * The ribbon's search box (#909 ribbon-parity follow-up -- wires the
 * previously-decorative search button up to the project search that used to
 * live in the old top nav, views-search.js). A real `<input>`, not a button:
 * typing here jumps to the dedicated Search view (views-search.js's
 * "search" NavigationController entry, #searchViewInput) and mirrors the
 * query into it, reusing that view's existing debounced /api/search call
 * and grouped, click-to-open results -- see handleRibbonSearchInput() in
 * wireEvents() below. This box itself is destroyed and recreated by every
 * refreshRibbon() (innerHTML swap), so it hands off to the Search view's
 * own, DOM-stable input on the very first keystroke rather than trying to
 * keep typing in a node that won't survive the next render. */
function renderSearchBox() {
    return `
        <div class="ribbon-search-wrap">
            ${icon('search', 13)}
            <input type="search" class="ribbon-search-input" id="ribbonSearchInput"
                placeholder="Tell me what you want to do" aria-label="Search this project" autocomplete="off">
        </div>
    `;
}

const FILE_ACTIONS = {
    // Opens the full-screen Backstage shell (#943, full-screen #972) --
    // see backstage.js's enterBackstage(), which also remembers the view
    // to return to.
    Home: () => (typeof enterBackstage === 'function' ? enterBackstage() : switchToView('backstage')),
    // #938-style fix: a real function (portfolio.js's showCreateProjectDialog,
    // already used by the "+ New Project" button) existed for this the whole
    // time; it just wasn't wired here.
    'New plan': () => showCreateProjectDialog(),
    'Open…': () => openLocalPlanFile(),
    Save: () => downloadMarkdown(),
    'Import from Excel / MS Project': () => openFormatMenu(IMPORT_FORMATS, 'Import'),
    'Export…': () => openFormatMenu(EXPORT_FORMATS, 'Export'),
    Templates: () => openTemplatesModal(),
    Print: () => window.print(),
    Settings: () => openSettingsPanel(),
};

function renderTabStrip(ia, ctxTab) {
    const tabs = ia.tabsForScope(ribbonState.scope).map((t) => {
        const active = ribbonState.activeTab === t.id;
        return `<button type="button" class="ribbon-tab-btn${active ? ' active' : ''}" data-tab="${t.id}" role="tab" aria-selected="${active}">${t.label}</button>`;
    }).join('');

    let ctxHtml = '';
    if (ctxTab) {
        const active = ribbonState.activeTab === '__ctx';
        ctxHtml = `<button type="button" class="ribbon-tab-btn contextual${active ? ' active' : ''}" data-tab="__ctx"
            role="tab" aria-selected="${active}" style="border-bottom-color:${ctxTab.accent}">${ctxTab.label}</button>`;
    }

    return `
        <button type="button" class="ribbon-file-btn" data-action="open-backstage">File</button>
        ${tabs}${ctxHtml}
        <div class="ribbon-tabstrip-spacer"></div>
        <button type="button" class="ribbon-collapse-btn" data-action="toggle-collapse" title="${ribbonState.collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}">${ribbonState.collapsed ? '▼' : '▲'}</button>
    `;
}

/** `'link:<url>'` marks a button as a plain external link rather than a
 * command -- see the `link:` flag convention documented at the top of
 * ribbon-ia.js (#909 ribbon-parity follow-up, e.g. the "Docs" button). */
function linkHrefFor(flag) {
    return (typeof flag === 'string' && flag.startsWith('link:')) ? flag.slice(5) : null;
}

function renderButton(scopeId, tuple, kind) {
    const [iconName, label, flag] = tuple;
    if (kind === 'simple') return renderSimpleButton(scopeId, tuple);
    const size = kind === 'lg' ? 26 : 15;
    const cls = kind === 'lg' ? 'ribbon-lg-btn' : 'ribbon-sm-btn';
    const href = linkHrefFor(flag);
    if (href) {
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${cls}"
            title="${label}" aria-label="${label} (opens in a new tab)">
            ${icon(iconName, size)}${label}
        </a>`;
    }
    const live = getLiveState();
    const action = resolveAction(scopeId, label);
    const isActive = isButtonActive(scopeId, label, live);
    return `<button type="button" class="${cls}${isActive ? ' active' : ''}" data-scope-id="${scopeId}" data-label="${label}"
        title="${label}" aria-label="${label}" aria-pressed="${isActive}" ${action ? '' : 'data-stub="true"'}>
        ${icon(iconName, size)}${label}${flag === 'caret' ? '<span class="ribbon-caret">▼</span>' : ''}
    </button>`;
}

/**
 * The simple ribbon's (#955) compact button: same icon, action resolution
 * and active/stub state as the full ribbon's 'sm' button (renderButton
 * above) -- reusing resolveAction()/isButtonActive() directly is what
 * guarantees every command reachable in the full ribbon is *also* reachable
 * in simple mode, since both densities render off the exact same
 * ribbon-ia.js data and go through the exact same action tables.
 *
 * The label is always in the markup (title/aria-label too) so screen
 * readers and the "does it fit" measurement in applySimpleBody() both see
 * it; `.icon-only`, toggled by applySimpleBody()'s fitLabels() pass, is
 * what visually hides the `<span>` per the "icons, and text if it fits"
 * rule -- see ribbon-layout.js's fitLabels() for the exact decision.
 */
function renderSimpleButton(scopeId, tuple) {
    const [iconName, label, flag] = tuple;
    const inner = `${icon(iconName, 15)}<span class="ribbon-simple-btn-label">${label}</span>${flag === 'caret' ? '<span class="ribbon-caret">▼</span>' : ''}`;
    const href = linkHrefFor(flag);
    if (href) {
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="ribbon-simple-btn"
            title="${label}" aria-label="${label} (opens in a new tab)">${inner}</a>`;
    }
    const live = getLiveState();
    const action = resolveAction(scopeId, label);
    const isActive = isButtonActive(scopeId, label, live);
    return `<button type="button" class="ribbon-simple-btn${isActive ? ' active' : ''}" data-scope-id="${scopeId}" data-label="${label}"
        title="${label}" aria-label="${label}" aria-pressed="${isActive}" ${action ? '' : 'data-stub="true"'}>${inner}</button>`;
}

/** Buttons whose pressed state reflects real, currently-known app state. */
function isButtonActive(scopeId, label, live) {
    if (label === 'Critical Path') return live.ganttShowCriticalPath;
    if (label === 'Baseline') return live.ganttShowBaseline;
    if (label === 'Dependencies' || label === 'Deps') return live.ganttShowDependencies;
    if (label === 'Dark Mode') return live.isDark;
    if (label === 'System Theme') return live.themeChoice === 'system';
    if (scopeId === 'kanban') {
        if (label === 'Phase') return live.kanbanViewMode === 'phase';
        if (label === 'Resource') return live.kanbanViewMode === 'resource';
        if (label === 'Progress') return live.kanbanViewMode === 'progress';
        if (label === 'Label') return live.kanbanViewMode === 'label';
    }
    if (VIEW_FOR_LABEL[label]) return live.view === VIEW_FOR_LABEL[label];
    return false;
}

function renderGroup(scopeId, group, animate) {
    const lg = (group.lg || []).map((b) => renderButton(scopeId, b, 'lg')).join('');
    const cols = (group.cols || []).map((col) =>
        `<div class="ribbon-sm-col">${col.map((b) => renderButton(scopeId, b, 'sm')).join('')}</div>`
    ).join('');
    return `<div class="ribbon-group${animate ? ' ribbon-group-tab-in' : ''}" data-group="${group.name}">
        <div class="ribbon-group-row">${lg}${cols}</div>
        <div class="ribbon-group-caption">${group.name}${group.launcher ? '<span class="ribbon-launcher" title="More options">⌟</span>' : ''}</div>
    </div>`;
}

/**
 * Every tuple from a group's `lg` and `cols` (#955's simple ribbon), in the
 * same left-to-right reading order the full ribbon uses (large buttons
 * first, then each column top-to-bottom) -- flattened into one dense row
 * with no sub-rows and no caption (there's no room for one in a single
 * dense row, matching Office's own simplified ribbon; the group's
 * `launcher` flag is dropped for the same reason -- see renderGroup()'s
 * caption/launcher above, which this intentionally has no equivalent of).
 * This is the SAME group data the full ribbon renders, not a second,
 * parallel list -- see ribbon-ia.js's own top-of-file comment on why.
 */
function flattenGroupButtons(group) {
    return [...(group.lg || []), ...(group.cols || []).flatMap((col) => col)];
}

function renderSimpleGroup(scopeId, group, animate) {
    const buttons = flattenGroupButtons(group).map((b) => renderButton(scopeId, b, 'simple')).join('');
    return `<div class="ribbon-simple-group${animate ? ' ribbon-group-tab-in' : ''}" data-group="${group.name}">${buttons}</div>`;
}

/**
 * The "Ribbon Display Options" dropdown (#955), the control the issue asks
 * for -- Office's own name for the analogous control, though this app's
 * version only offers the two choices #955 actually asks for (Full/Simple),
 * not Office's separate auto-hide levels (that's `ribbon-collapse-btn` in
 * renderTabStrip(), a different, orthogonal control -- see its own comment
 * for exactly how the two compose).
 *
 * Placement: rendered as part of the ribbon BODY (not the tab strip), and
 * pinned to the body's bottom-right corner via CSS (`.ribbon-display-toggle`
 * -- order + margin-left:auto + align-self:flex-end). #955 literally says
 * "bottom right of the ribbon"; since the ribbon's three stacked bars put
 * the body at the bottom, that reads most naturally as the bottom-right
 * corner of the body, not the tab strip's already-occupied right-side slot
 * (File/tabs on the left, the collapse chevron on the right) where real
 * Office actually puts its Classic/Simplified toggle. Both readings are
 * defensible; this one follows the issue's literal wording.
 */
function renderDisplayToggle() {
    return `
        <div class="ribbon-display-toggle">
            <button type="button" class="ribbon-display-toggle-btn" data-action="toggle-display-menu"
                title="Ribbon Display Options" aria-label="Ribbon Display Options" aria-haspopup="true" aria-expanded="${ribbonState.displayMenuOpen}">
                ${icon('grid', 12)}<span class="ribbon-caret">▼</span>
            </button>
        </div>
    `;
}

function displayMenuItemsHtml() {
    const isSimple = ribbonState.density === 'simple';
    return `
        <button type="button" class="ribbon-display-menu-item${!isSimple ? ' selected' : ''}" data-density="full" role="menuitemradio" aria-checked="${!isSimple}">
            <span class="ribbon-display-menu-item-check">${!isSimple ? '✓' : ''}</span>Full Ribbon
        </button>
        <button type="button" class="ribbon-display-menu-item${isSimple ? ' selected' : ''}" data-density="simple" role="menuitemradio" aria-checked="${isSimple}">
            <span class="ribbon-display-menu-item-check">${isSimple ? '✓' : ''}</span>Simple Ribbon
        </button>
    `;
}

/**
 * The "Ribbon Display Options" menu's actual popover (#955) -- appended to
 * `.ribbon-shell`, like renderMorePopover()'s `.ribbon-more-popover`,
 * rather than nested inside renderDisplayToggle()'s own markup.
 *
 * Why: `.ribbon-body` has `overflow: hidden` (needed so a group that's
 * about to be pushed into "More" never visibly pokes out before
 * applyOverflow()/applySimpleBody() run on the next frame), which would
 * silently clip a popover nested inside it -- especially in simple
 * density's much shorter body, where the menu has nowhere near enough
 * headroom. Positioning it from the toggle button's real, measured rect
 * (same technique renderMorePopover() uses for its own "just under the
 * body" offset) keeps it correctly placed regardless of density or window
 * size, without being clipped by an ancestor it doesn't need to live inside.
 */
function renderDisplayMenu() {
    const shell = document.querySelector('.ribbon-shell');
    const toggleBtn = shell?.querySelector('.ribbon-display-toggle-btn');
    if (!shell || !toggleBtn) return;
    const menu = document.createElement('div');
    menu.className = 'ribbon-display-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Ribbon display');
    menu.innerHTML = displayMenuItemsHtml();

    const btnRect = toggleBtn.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    menu.style.right = `${Math.round(shellRect.right - btnRect.right)}px`;
    menu.style.bottom = `${Math.round(shellRect.bottom - btnRect.top)}px`;
    shell.appendChild(menu);
}

/** The tab set for the active scope pill (Project/Portfolio/Programme --
 * see ribbon-ia.js's tabsForScope()). */
function activeScopeTabs(ia) {
    return ia.tabsForScope(ribbonState.scope);
}

function activeTabData(ia, ctxTab) {
    const scopeTabs = activeScopeTabs(ia);
    if (ribbonState.activeTab === '__ctx' && ctxTab) return { id: ctxTab.id, groups: ctxTab.groups };
    return scopeTabs.find((t) => t.id === ribbonState.activeTab) || scopeTabs[0];
}

function renderRibbonBody(ia, ctxTab, animate) {
    const tab = activeTabData(ia, ctxTab);
    const groupsHtml = ribbonState.density === 'simple'
        ? tab.groups.map((g) => renderSimpleGroup(tab.id, g, animate)).join('')
        : tab.groups.map((g) => renderGroup(tab.id, g, animate)).join('');
    // The display-options dropdown renders in every density (and in both
    // scopes/tabs) so it's always reachable -- see renderDisplayToggle()'s
    // comment for why it lives here rather than the tab strip.
    return groupsHtml + renderDisplayToggle();
}

// ---------------------------------------------------------------------------
// Overflow ("» More")
// ---------------------------------------------------------------------------

// The display-options dropdown (renderDisplayToggle()) is always present
// once the body renders at all, in both densities -- its reserved width
// must always come out of the fit budget, unlike MORE_WIDTH/
// SIMPLE_MORE_WIDTH below, which only apply when a "More" tile actually
// appears. Kept a little generous versus the button's real measured width
// (see `.ribbon-display-toggle` in components.css) since a few px of extra
// whitespace before it is harmless, but it clipping under the body's
// overflow:hidden is not.
const DISPLAY_TOGGLE_WIDTH = 40;

function applyOverflow() {
    const body = document.querySelector('.ribbon-body');
    if (!body) return;
    body.querySelectorAll('.ribbon-more').forEach((el) => el.remove());

    const groups = Array.from(body.querySelectorAll(':scope > .ribbon-group'));
    if (groups.length === 0) return;

    const containerWidth = body.clientWidth - DISPLAY_TOGGLE_WIDTH;
    const widths = groups.map((el) => el.getBoundingClientRect().width);
    const MORE_WIDTH = 74;
    const { fitGroups } = ribbonLayoutModule;
    const { visible, overflow } = fitGroups(widths, containerWidth, MORE_WIDTH);

    if (overflow.length === 0) return;

    overflow.forEach((i) => { groups[i].style.display = 'none'; });

    const more = document.createElement('div');
    more.className = 'ribbon-more';
    const names = overflow.map((i) => groups[i].dataset.group).join(', ');
    more.innerHTML = `
        <button type="button" class="ribbon-more-btn" data-action="toggle-more" title="${names}">
            <span class="ribbon-more-chevron">»</span>More
        </button>
        <div class="ribbon-more-caption">${names}</div>
    `;
    body.appendChild(more);
}

/**
 * The simple ribbon's overflow (#955). Two passes, each reusing a pure
 * ribbon-layout.js function against real measured DOM widths, same split
 * as the full ribbon's applyOverflow() above:
 *
 *   1. fitLabels() -- shrink labels left-to-right until the whole row (every
 *      button, across every group) fits at full text, or everything left
 *      of the point it stopped fitting is icon-only. This is the common
 *      case: a single dense row usually resolves itself by losing labels
 *      long before whole subsections need to disappear.
 *   2. fitGroups() -- the SAME group-level "More" mechanism the full ribbon
 *      uses (adapted: measuring `.ribbon-simple-group` boxes instead of
 *      `.ribbon-group` ones, and a smaller MORE tile width to match the
 *      simple row's own compact "More" button). Only needed as a last
 *      resort -- a very narrow window, or a tab with many subsections --
 *      once even all-icon-only still doesn't fit.
 */
const SIMPLE_ICON_ONLY_WIDTH = 28; // matches `.ribbon-simple-btn.icon-only`'s fixed CSS width
const SIMPLE_MORE_WIDTH = 34; // matches `.ribbon-body-simple .ribbon-more`'s fixed CSS width

function applySimpleBody() {
    const body = document.querySelector('.ribbon-body');
    if (!body) return;
    body.querySelectorAll('.ribbon-more').forEach((el) => el.remove());

    const groups = Array.from(body.querySelectorAll(':scope > .ribbon-simple-group'));
    groups.forEach((g) => { g.style.display = ''; });
    const buttons = Array.from(body.querySelectorAll('.ribbon-simple-btn'));
    buttons.forEach((b) => b.classList.remove('icon-only'));
    if (groups.length === 0) return;

    const { fitLabels, fitGroups } = ribbonLayoutModule;
    const containerWidth = body.clientWidth - DISPLAY_TOGGLE_WIDTH;

    // Pass 1: per-button text-fit, densest pass first.
    const items = buttons.map((b) => ({ iconWidth: SIMPLE_ICON_ONLY_WIDTH, fullWidth: b.getBoundingClientRect().width }));
    const showLabel = fitLabels(items, containerWidth);
    buttons.forEach((b, i) => { if (!showLabel[i]) b.classList.add('icon-only'); });

    // Pass 2: fall back to "More" only if the row still doesn't fit once
    // every label is already gone.
    const widths = groups.map((el) => el.getBoundingClientRect().width);
    const { overflow } = fitGroups(widths, containerWidth, SIMPLE_MORE_WIDTH);
    if (overflow.length === 0) return;

    overflow.forEach((i) => { groups[i].style.display = 'none'; });

    const more = document.createElement('div');
    more.className = 'ribbon-more';
    const names = overflow.map((i) => groups[i].dataset.group).join(', ');
    more.innerHTML = `
        <button type="button" class="ribbon-more-btn" data-action="toggle-more" title="${names}" aria-label="More: ${names}">
            <span class="ribbon-more-chevron">»</span>
        </button>
    `;
    body.appendChild(more);
}

/** Runs whichever density's overflow pass applies -- see applyOverflow()/
 * applySimpleBody()'s own comments. Shared by refreshRibbon() and the
 * window resize handler so both densities stay correctly fitted. */
function applyBodyLayout() {
    if (ribbonState.density === 'simple') applySimpleBody();
    else applyOverflow();
}

let ribbonLayoutModule = null;
async function loadLayout() {
    if (!ribbonLayoutModule) ribbonLayoutModule = await import('/static/ribbon-layout.js');
    return ribbonLayoutModule;
}

function renderMorePopover(ia, ctxTab) {
    closePopovers();
    const tab = activeTabData(ia, ctxTab);
    const body = document.querySelector('.ribbon-body');
    // #955: simple mode's overflowed subsections are `.ribbon-simple-group`
    // boxes, not `.ribbon-group` ones -- but the popover itself always shows
    // the full-style rendering (renderGroup(), not renderSimpleGroup()) even
    // in simple mode: there's plenty of room in a flyout, so there's no
    // reason to also cram the popover's contents into the dense layout.
    const groupSelector = ribbonState.density === 'simple' ? '.ribbon-simple-group' : '.ribbon-group';
    const hiddenGroups = tab.groups.filter((g) => {
        const el = body.querySelector(`${groupSelector}[data-group="${CSS.escape(g.name)}"]`);
        return el && el.style.display === 'none';
    });
    const popover = document.createElement('div');
    popover.className = 'ribbon-more-popover';
    popover.innerHTML = hiddenGroups.map((g) => renderGroup(tab.id, g, false)).join('');
    const shell = document.querySelector('.ribbon-shell');
    if (shell && body) {
        // Simple density's body is much shorter than full density's fixed
        // 98px (see .ribbon-body-simple), so its "just under the body"
        // position differs too -- measure the real, current bottom of the
        // body rather than hardcoding a second magic offset alongside the
        // CSS `top: 137px` fallback (used only until this runs).
        const top = body.getBoundingClientRect().bottom - shell.getBoundingClientRect().top;
        popover.style.top = `${Math.round(top)}px`;
    }
    shell?.appendChild(popover);
}

// ---------------------------------------------------------------------------
// Full render + wiring
// ---------------------------------------------------------------------------

async function refreshRibbon() {
    const shell = document.getElementById('ribbonShell');
    if (!shell) return;
    const ia = await loadIA();
    await loadLayout();
    const live = getLiveState();

    // Issue #908/#932: the ribbon's scope always follows wherever the user
    // has actually landed, derived from the live view rather than trusted
    // to whichever call site last remembered to call setRibbonScope() --
    // see ribbon-ia.js's scopeForView() for why that mattered in practice
    // (opening a project straight from the portfolio table used to leave
    // stale portfolio-scope tabs showing). A scope that changes this way
    // gets the same tab-switch animation an explicit setRibbonScope() call
    // triggers, so landing at a new altitude reads as a real transition.
    const derivedScope = ia.scopeForView(live.view);
    if (derivedScope !== ribbonState.scope) {
        ribbonState.scope = derivedScope;
        ribbonState.animateTabSwitch = true;
    }

    const ctxTab = ia.contextualTabFor(live.view);
    const scopeTabs = activeScopeTabs(ia);

    // #1003: navigating to a view with a contextual tab (e.g. Gantt, Board)
    // used to steal focus by auto-switching the ribbon to that tab, even
    // when the user clicked a button elsewhere (Home's "Gantt" tile, a
    // breadcrumb, etc.) rather than the tab itself. The contextual tab is
    // still shown in the strip (renderTabStrip()'s ctxHtml, below) so it's
    // one click away -- it just no longer steals the currently active tab.
    // Only fall back away from '__ctx' when its view is no longer current,
    // so a user who *did* explicitly select the contextual tab isn't
    // bounced off it by every subsequent refresh.
    if (!ctxTab && ribbonState.activeTab === '__ctx') {
        ribbonState.activeTab = ribbonState.previousTab || scopeTabs[0].id;
    }
    // The active tab id may not exist in the current scope's tab set --
    // e.g. it just changed (Project's "plan" isn't a Portfolio tab id), or
    // persisted state from a previous session named a tab that scope no
    // longer has. Fall back to that scope's first tab rather than rendering
    // an empty/mismatched tab strip.
    if (ribbonState.activeTab !== '__ctx' && !scopeTabs.some((t) => t.id === ribbonState.activeTab)) {
        ribbonState.activeTab = scopeTabs[0].id;
    }
    if (ctxTab) ribbonState.previousTab = ribbonState.activeTab === '__ctx' ? ribbonState.previousTab : ribbonState.activeTab;

    const animate = ribbonState.animateTabSwitch;
    ribbonState.animateTabSwitch = false;

    const titleEl = shell.querySelector('.ribbon-titlebar');
    const tabstripEl = shell.querySelector('.ribbon-tabstrip');
    const bodyEl = shell.querySelector('.ribbon-body');

    if (titleEl) titleEl.innerHTML = renderTitleBar(ia, live);
    if (tabstripEl) tabstripEl.innerHTML = renderTabStrip(ia, ctxTab);
    if (bodyEl) {
        bodyEl.classList.toggle('ribbon-body-simple', ribbonState.density === 'simple');
        bodyEl.style.background = (ribbonState.activeTab === '__ctx' && ctxTab) ? ctxTab.tint : '';
        bodyEl.innerHTML = renderRibbonBody(ia, ctxTab, animate);
    }

    shell.classList.toggle('collapsed', ribbonState.collapsed);
    if (bodyEl) bodyEl.style.display = ribbonState.collapsed ? 'none' : '';

    updateDocTitleAndAvatar();
    if (!ribbonState.collapsed) requestAnimationFrame(applyBodyLayout);
}

function updateDocTitleAndAvatar() {
    const titleEl = document.getElementById('ribbonDocTitle');
    if (titleEl) titleEl.innerHTML = renderBreadcrumb();
    const avatarEl = document.getElementById('ribbonAvatar');
    if (avatarEl) avatarEl.textContent = '';
}

/**
 * Render the ribbon title bar's breadcrumb -- Portfolio › <Programme> ›
 * <Project> (issue #953), replacing the plain project-name label this used
 * to show. Rungs are computed by nav.js's computeBreadcrumbRungs() (pure
 * data, unit-tested separately); this just turns them into the clickable
 * buttons every other piece of ribbon chrome uses. See wireEvents() for the
 * click handling (.ribbon-breadcrumb-rung).
 */
function renderBreadcrumb() {
    const view = (typeof NavigationController !== 'undefined') ? NavigationController.getCurrentView() : null;
    const params = { view: view };
    if (view === 'programme') {
        params.programme = (typeof getCurrentPortfolioProgramme === 'function') ? getCurrentPortfolioProgramme() : null;
    } else {
        params.project = (typeof getActiveProjectForBreadcrumb === 'function') ? getActiveProjectForBreadcrumb() : null;
    }

    const rungs = (typeof computeBreadcrumbRungs === 'function') ? computeBreadcrumbRungs(params) : [];
    if (rungs.length === 0) return 'Untitled plan';

    return rungs.map((rung, i) => {
        const sep = i > 0 ? '<span class="ribbon-breadcrumb-sep">&rsaquo;</span>' : '';
        const label = escapeHtml(rung.label);
        if (rung.active) {
            return `${sep}<span class="ribbon-breadcrumb-rung active">${label}</span>`;
        }
        return `${sep}<button type="button" class="ribbon-breadcrumb-rung" data-rung-kind="${rung.kind}" data-rung-slug="${escapeHtml(rung.slug || '')}">${label}</button>`;
    }).join('');
}

/**
 * Set the ribbon's scope pill/tab-set without necessarily navigating
 * anywhere (issue #953) -- used by navigation helpers elsewhere (e.g.
 * programme.js's openProgramme()) that already know which altitude
 * they're landing on.
 */
function setRibbonScope(scopeId) {
    if (scopeId === ribbonState.scope) return;
    ribbonState.scope = scopeId;
    ribbonState.animateTabSwitch = true;
    savePersistedState();
}

function wireEvents(shell) {
    shell.addEventListener('click', (e) => {
        const rungBtn = e.target.closest('.ribbon-breadcrumb-rung[data-rung-kind]');
        if (rungBtn) {
            const kind = rungBtn.dataset.rungKind;
            if (kind === 'portfolio') {
                setRibbonScope('portfolio');
                switchToView('portfolio');
            } else if (kind === 'programme' && typeof openProgramme === 'function') {
                openProgramme(rungBtn.dataset.rungSlug);
            }
            refreshRibbon();
            return;
        }

        const scopeBtn = e.target.closest('.ribbon-scope-btn');
        if (scopeBtn) {
            const scopeId = scopeBtn.dataset.scope;
            if (scopeId !== ribbonState.scope) {
                ribbonState.scope = scopeId;
                ribbonState.animateTabSwitch = true;
                savePersistedState();
            }
            if (scopeId === 'portfolio') switchToView('portfolio');
            else if (scopeId === 'project') switchToView('editor');
            else if (typeof getCurrentPortfolioProgramme === 'function' && getCurrentPortfolioProgramme()) switchToView('programme');
            else notAvailable('Programme');
            refreshRibbon();
            return;
        }

        const quickBtn = e.target.closest('.ribbon-quick-btn');
        if (quickBtn && !quickBtn.disabled) {
            const label = quickBtn.dataset.quick;
            if (label === 'Save') downloadMarkdown();
            else if (label === 'Undo') EditorUndoManager.undo();
            else if (label === 'New task') addNewTaskViaShortcut();
            else if (label === 'Print') window.print();
            else if (label === 'AI Chat') { if (typeof onAIButtonClick === 'function') onAIButtonClick(); }
            else if (label === 'Start planning session') { if (typeof startCollabSession === 'function') startCollabSession(); }
            refreshRibbon();
            return;
        }

        const tabBtn = e.target.closest('.ribbon-tab-btn');
        if (tabBtn) {
            closePopovers();
            if (tabBtn.dataset.tab !== ribbonState.activeTab) ribbonState.animateTabSwitch = true;
            ribbonState.activeTab = tabBtn.dataset.tab;
            refreshRibbon();
            return;
        }

        if (e.target.closest('[data-action="open-backstage"]')) {
            closePopovers();
            FILE_ACTIONS.Home();
            return;
        }

        // `toggle-collapse` (▲/▼, in the tab strip) is Office's "auto-hide"/
        // "show tabs only" concept: it hides the whole body (whichever
        // density) leaving just the tab strip -- a visibility toggle, not a
        // density change. `toggle-display-menu` below (#955) is a different,
        // orthogonal axis: it swaps *how* the still-visible body renders
        // (full multi-row groups vs. one dense row). The two compose freely
        // -- collapsed hides a simple body exactly the same way it hides a
        // full one, and re-expanding shows whichever density was last
        // chosen -- rather than "simple" being a third state of collapse.
        if (e.target.closest('[data-action="toggle-collapse"]')) {
            ribbonState.collapsed = !ribbonState.collapsed;
            savePersistedState();
            refreshRibbon();
            return;
        }

        if (e.target.closest('[data-action="toggle-display-menu"]')) {
            const wasOpen = ribbonState.displayMenuOpen;
            closePopovers();
            ribbonState.displayMenuOpen = !wasOpen;
            // renderDisplayMenu() (a real popover appended to .ribbon-shell,
            // not part of the body's own innerHTML -- see its own comment on
            // why) only needs to run when opening; refreshRibbon() alone
            // already re-renders the toggle button's aria-expanded either way.
            //
            // The extra requestAnimationFrame here matters in simple density:
            // refreshRibbon() ends by scheduling applyBodyLayout() (which
            // runs applySimpleBody()'s label-shrink/overflow pass) on the
            // NEXT animation frame, not synchronously -- so measuring the
            // toggle button's position any earlier (e.g. straight off
            // refreshRibbon()'s own promise) can catch the row still in its
            // pre-fit, full-label width, which can push a `margin-left:auto`
            // toggle button far outside the viewport before the fit pass
            // pulls it back in. Queuing this rAF from inside refreshRibbon()'s
            // .then() (a microtask, so still before the next paint) lands it
            // in the SAME upcoming frame as applyBodyLayout()'s own rAF, and
            // requestAnimationFrame runs same-frame callbacks in request
            // order, so this always measures the toggle after it's settled.
            refreshRibbon().then(() => {
                if (!ribbonState.displayMenuOpen) return;
                requestAnimationFrame(renderDisplayMenu);
            });
            return;
        }

        const densityBtn = e.target.closest('.ribbon-display-menu-item');
        if (densityBtn) {
            const next = densityBtn.dataset.density === 'simple' ? 'simple' : 'full';
            // closePopovers() (not just setting the flag) is what actually
            // removes the .ribbon-display-menu DOM node -- it's a sibling of
            // the body appended straight to .ribbon-shell (see
            // renderDisplayMenu()'s comment), so refreshRibbon() alone,
            // which only re-renders the titlebar/tabstrip/body, would leave
            // a stale popover behind.
            closePopovers();
            if (next !== ribbonState.density) {
                ribbonState.density = next;
                savePersistedState();
            }
            refreshRibbon();
            return;
        }

        if (e.target.closest('[data-action="toggle-more"]')) {
            loadIA().then((ia) => renderMorePopover(ia, ia.contextualTabFor(getLiveState().view)));
            return;
        }

        const cmdBtn = e.target.closest('.ribbon-lg-btn, .ribbon-sm-btn, .ribbon-simple-btn');
        if (cmdBtn && cmdBtn.dataset.label) {
            runAction(cmdBtn.dataset.scopeId, cmdBtn.dataset.label);
            return;
        }
    });

    // Delegated (not bound to the specific node) because refreshRibbon()
    // recreates the title bar -- and this input -- on essentially every
    // ribbon interaction. See handleRibbonSearchInput() for why that's fine.
    shell.addEventListener('input', handleRibbonSearchInput);

    // A popover-opening button can live anywhere in the ribbon (the File
    // button in the tab strip, a caret button in the body) -- only a click
    // truly outside the whole ribbon should auto-close one.
    //
    // #955 bugfix, found while adding the display-options dropdown's own
    // Selenium coverage: a *trusted* click (a real pointer click -- WebDriver,
    // or a fast real user click) on a popover-opening button can have this
    // listener run AFTER that button's own click handler has already
    // re-rendered its container (e.g. refreshRibbon() replacing
    // .ribbon-tabstrip's innerHTML), detaching the original `e.target` from
    // the document before bubbling finishes. `e.target.closest(...)` walks
    // the LIVE tree, so on a detached node it always returns null -- making
    // this listener wrongly conclude the click was "outside" the ribbon and
    // close the very popover the click just opened. `e.composedPath()` is a
    // snapshot of the nodes the event actually passed through, taken at
    // dispatch time, so it stays correct even if the target is later
    // removed -- this affected the pre-existing File-menu button too, not
    // just the new display-options one.
    document.addEventListener('click', (e) => {
        if (!e.composedPath().includes(shell)) closePopovers();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closePopovers(); refreshRibbon(); }
    });

    // File shortcuts (#972): previously only documented as `kbd` hints on
    // the now-retired File dropdown's rows -- never actually bound to a key
    // handler -- so these must now work globally on their own, the same way
    // Cmd+S already does (script.js's own Ctrl+S handler, works from
    // anywhere including the editor). FILE_ACTIONS is the single shared
    // action map (see its own comment); Cmd+S stays owned by script.js.
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        const label = { n: 'New plan', o: 'Open…', p: 'Print' }[e.key.toLowerCase()];
        if (!label) return;
        e.preventDefault();
        FILE_ACTIONS[label]();
    });
}

/**
 * Hands the ribbon search box's first keystroke off to the real, DOM-stable
 * Search view input (#searchViewInput, views-search.js) rather than trying
 * to keep the user typing in a node refreshRibbon() is about to destroy:
 *   1. Navigate to the Search view if we're not already on it (idempotent
 *      once there -- see below).
 *   2. Copy what's been typed so far into #searchViewInput and focus it.
 *   3. Run the search via scheduleProjectSearch(), the exact debounced
 *      /api/search function views-search.js's own inputs call -- exposed
 *      on window for reuse rather than duplicated here (#909 ribbon-parity
 *      follow-up).
 * After step 2, the browser's focus is on #searchViewInput, so further
 * keystrokes land there directly through views-search.js's own listener and
 * never reach this handler again -- this only ever fires once per search.
 */
function handleRibbonSearchInput(e) {
    const el = e.target.closest('.ribbon-search-input');
    if (!el) return;
    const query = el.value;

    if (typeof NavigationController !== 'undefined' && NavigationController.getCurrentView() !== 'search') {
        // nav.js's global switchToView(viewName) -- not this file's own
        // switchView() helper (which returns a closure); calling that here
        // by mistake would throw.
        switchToView('search');
    }

    const viewInput = document.getElementById('searchViewInput');
    if (viewInput) {
        viewInput.value = query;
        viewInput.focus();
        // Move the caret to the end (setting .value already did this in most
        // browsers, but this matches views-search.js's own navigateToSearchView()).
        const v = viewInput.value;
        viewInput.value = '';
        viewInput.value = v;
    }
    if (typeof scheduleProjectSearch === 'function') scheduleProjectSearch(query);
}

/** Every navigation goes through NavigationController.navigateTo(); wrap
 * each registered view's activate() (not navigateTo itself) so the ribbon
 * refreshes at the moment a view actually becomes current -- a Portfolio
 * <-> Project context switch runs activate() ~150ms later inside
 * performTransitionedSwitch's setTimeout (see script.js), so wrapping
 * navigateTo() would refresh one view too early. */
function wrapViewActivations() {
    if (typeof NavigationController === 'undefined') return;
    const registry = NavigationController.getRegistry();
    Object.keys(registry).forEach((viewName) => {
        const hooks = registry[viewName];
        if (!hooks || hooks.__ribbonWrapped) return;
        const original = hooks.activate;
        hooks.activate = function (...args) {
            const result = original.apply(this, args);
            refreshRibbon();
            return result;
        };
        hooks.__ribbonWrapped = true;
    });
}

function wrapUndoRedoRefresh() {
    if (typeof EditorUndoManager === 'undefined' || EditorUndoManager.__ribbonWrapped) return;
    const original = EditorUndoManager.refreshButtons;
    EditorUndoManager.refreshButtons = function (...args) {
        original.apply(EditorUndoManager, args);
        const undoBtn = document.querySelector('.ribbon-quick-btn[data-quick="Undo"]');
        if (undoBtn) undoBtn.disabled = !EditorUndoManager.canUndo();
    };
    EditorUndoManager.__ribbonWrapped = true;
}

function wireGanttCheckboxSync() {
    ['ganttShowCriticalPath', 'ganttShowBaseline', 'ganttShowDependencies'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.ribbonSynced) {
            el.addEventListener('change', () => refreshRibbon());
            el.dataset.ribbonSynced = 'true';
        }
    });
}

function initRibbon() {
    const shell = document.getElementById('ribbonShell');
    if (!shell) return;
    shell.innerHTML = `
        <div class="ribbon-titlebar"></div>
        <div class="ribbon-tabstrip"></div>
        <div class="ribbon-body"></div>
    `;
    wireEvents(shell);
    refreshRibbon().then(() => {
        wrapViewActivations();
        wrapUndoRedoRefresh();
        wireGanttCheckboxSync();
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (!ribbonState.collapsed) applyBodyLayout(); }, 100);
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initRibbon);
}
