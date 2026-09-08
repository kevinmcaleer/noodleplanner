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
    fileMenuOpen: false,
    morePopoverOpen: false,
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
// Small popovers: the File menu and caret format-choice menus share the
// same look (see .ribbon-file-menu), so both render through this.
// ---------------------------------------------------------------------------

function closePopovers() {
    document.querySelectorAll('.ribbon-file-menu, .ribbon-more-popover').forEach((el) => el.remove());
    ribbonState.fileMenuOpen = false;
    ribbonState.morePopoverOpen = false;
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
        <button type="button" class="ribbon-search" data-action="search">${icon('search', 13)}Tell me what you want to do</button>
        <span class="ribbon-avatar" id="ribbonAvatar" aria-hidden="true"></span>
    `;
}

function renderFileMenuItems(ia) {
    return ia.FILE_MENU.map((f, i) => `
        <button type="button" class="ribbon-file-menu-item" data-file-index="${i}">
            ${icon(f.icon, 15)}
            <span class="ribbon-file-menu-item-label">${f.label}</span>
            ${f.kbd ? `<span class="ribbon-file-menu-item-kbd">${f.kbd}</span>` : ''}
        </button>
    `).join('');
}

const FILE_ACTIONS = {
    'New plan': () => notAvailable('New plan'),
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
        <button type="button" class="ribbon-file-btn" data-action="toggle-file">File ▾</button>
        ${tabs}${ctxHtml}
        <div class="ribbon-tabstrip-spacer"></div>
        <button type="button" class="ribbon-collapse-btn" data-action="toggle-collapse" title="${ribbonState.collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}">${ribbonState.collapsed ? '▼' : '▲'}</button>
        ${ribbonState.fileMenuOpen ? `<div class="ribbon-file-menu" id="ribbonFileMenu">${renderFileMenuItems(ia)}</div>` : ''}
    `;
}

function renderButton(scopeId, tuple, kind) {
    const [iconName, label, flag] = tuple;
    const live = getLiveState();
    const action = resolveAction(scopeId, label);
    const isActive = isButtonActive(scopeId, label, live);
    const size = kind === 'lg' ? 26 : 15;
    const cls = kind === 'lg' ? 'ribbon-lg-btn' : 'ribbon-sm-btn';
    return `<button type="button" class="${cls}${isActive ? ' active' : ''}" data-scope-id="${scopeId}" data-label="${label}"
        title="${label}" aria-label="${label}" aria-pressed="${isActive}" ${action ? '' : 'data-stub="true"'}>
        ${icon(iconName, size)}${label}${flag === 'caret' ? '<span class="ribbon-caret">▼</span>' : ''}
    </button>`;
}

/** Buttons whose pressed state reflects real, currently-known app state. */
function isButtonActive(scopeId, label, live) {
    if (label === 'Critical Path') return live.ganttShowCriticalPath;
    if (label === 'Baseline') return live.ganttShowBaseline;
    if (label === 'Dependencies' || label === 'Deps') return live.ganttShowDependencies;
    if (label === 'Dark Mode') return live.isDark;
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
    return tab.groups.map((g) => renderGroup(tab.id, g, animate)).join('');
}

// ---------------------------------------------------------------------------
// Overflow ("» More")
// ---------------------------------------------------------------------------

function applyOverflow() {
    const body = document.querySelector('.ribbon-body');
    if (!body) return;
    body.querySelectorAll('.ribbon-more').forEach((el) => el.remove());

    const groups = Array.from(body.querySelectorAll(':scope > .ribbon-group'));
    if (groups.length === 0) return;

    const containerWidth = body.clientWidth;
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

let ribbonLayoutModule = null;
async function loadLayout() {
    if (!ribbonLayoutModule) ribbonLayoutModule = await import('/static/ribbon-layout.js');
    return ribbonLayoutModule;
}

function renderMorePopover(ia, ctxTab) {
    closePopovers();
    const tab = activeTabData(ia, ctxTab);
    const body = document.querySelector('.ribbon-body');
    const hiddenGroups = tab.groups.filter((g) => {
        const el = body.querySelector(`.ribbon-group[data-group="${CSS.escape(g.name)}"]`);
        return el && el.style.display === 'none';
    });
    const popover = document.createElement('div');
    popover.className = 'ribbon-more-popover';
    popover.innerHTML = hiddenGroups.map((g) => renderGroup(tab.id, g, false)).join('');
    document.querySelector('.ribbon-shell')?.appendChild(popover);
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
    const ctxTab = ia.contextualTabFor(live.view);
    const scopeTabs = activeScopeTabs(ia);

    if (ctxTab && ribbonState.activeTab !== '__ctx' && ribbonState.lastView !== live.view) {
        ribbonState.activeTab = '__ctx';
    } else if (!ctxTab && ribbonState.activeTab === '__ctx') {
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
    ribbonState.lastView = live.view;

    const animate = ribbonState.animateTabSwitch;
    ribbonState.animateTabSwitch = false;

    const titleEl = shell.querySelector('.ribbon-titlebar');
    const tabstripEl = shell.querySelector('.ribbon-tabstrip');
    const bodyEl = shell.querySelector('.ribbon-body');

    if (titleEl) titleEl.innerHTML = renderTitleBar(ia, live);
    if (tabstripEl) tabstripEl.innerHTML = renderTabStrip(ia, ctxTab);
    if (bodyEl) {
        bodyEl.style.background = (ribbonState.activeTab === '__ctx' && ctxTab) ? ctxTab.tint : '';
        bodyEl.innerHTML = renderRibbonBody(ia, ctxTab, animate);
    }

    shell.classList.toggle('collapsed', ribbonState.collapsed);
    if (bodyEl) bodyEl.style.display = ribbonState.collapsed ? 'none' : '';

    updateDocTitleAndAvatar();
    if (!ribbonState.collapsed) requestAnimationFrame(applyOverflow);
}

function updateDocTitleAndAvatar() {
    const titleEl = document.getElementById('ribbonDocTitle');
    if (titleEl) {
        const projectTitleEl = document.getElementById('projectBreadcrumbName');
        titleEl.textContent = (projectTitleEl && projectTitleEl.textContent.trim()) || 'Untitled plan';
    }
    const avatarEl = document.getElementById('ribbonAvatar');
    if (avatarEl) avatarEl.textContent = '';
}

function wireEvents(shell) {
    shell.addEventListener('click', (e) => {
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

        if (e.target.closest('[data-action="toggle-file"]')) {
            const wasOpen = ribbonState.fileMenuOpen;
            closePopovers();
            ribbonState.fileMenuOpen = !wasOpen;
            refreshRibbon();
            return;
        }

        if (e.target.closest('[data-action="toggle-collapse"]')) {
            ribbonState.collapsed = !ribbonState.collapsed;
            savePersistedState();
            refreshRibbon();
            return;
        }

        if (e.target.closest('[data-action="toggle-more"]')) {
            loadIA().then((ia) => renderMorePopover(ia, ia.contextualTabFor(getLiveState().view)));
            return;
        }

        if (e.target.closest('[data-action="search"]')) {
            notAvailable('Search');
            return;
        }

        const fileItem = e.target.closest('.ribbon-file-menu-item[data-file-index]');
        if (fileItem) {
            loadIA().then((ia) => {
                const entry = ia.FILE_MENU[Number(fileItem.dataset.fileIndex)];
                closePopovers();
                (FILE_ACTIONS[entry.label] || (() => notAvailable(entry.label)))();
                if (!OPENS_OWN_POPOVER.has(entry.label)) refreshRibbon();
            });
            return;
        }

        const cmdBtn = e.target.closest('.ribbon-lg-btn, .ribbon-sm-btn');
        if (cmdBtn && cmdBtn.dataset.label) {
            runAction(cmdBtn.dataset.scopeId, cmdBtn.dataset.label);
            return;
        }
    });

    // A popover-opening button can live anywhere in the ribbon (the File
    // button in the tab strip, a caret button in the body) -- only a click
    // truly outside the whole ribbon should auto-close one.
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#ribbonShell')) closePopovers();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closePopovers(); refreshRibbon(); }
    });
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
        resizeTimer = setTimeout(() => { if (!ribbonState.collapsed) applyOverflow(); }, 100);
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initRibbon);
}
