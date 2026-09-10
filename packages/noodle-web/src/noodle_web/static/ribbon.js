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
            // #1027: a single three-way display preference -- 'tabs' (just
            // the tab strip), 'simple' (one dense row) or 'full' (the
            // original multi-row ribbon) -- replacing the old orthogonal
            // `collapsed`+`density` pair (see resolveDisplayMode() below for
            // how a persisted copy of either old shape migrates). Per-browser
            // display preference, same category the old fields were -- never
            // written into plan text or front matter.
            displayMode: ribbonState.displayMode,
        }));
    } catch (error) {
        // localStorage unavailable (private mode, quota) -- state just won't persist.
    }
}

/**
 * #1027: fold the pre-#1027 `collapsed` (boolean) + `density` ('full'|
 * 'simple') pair into the new single `displayMode` ('tabs'|'simple'|'full').
 * A browser that persisted state under the old shape (or nothing at all)
 * still gets a sensible mode on first load under the new code; a value
 * already in the new shape is trusted as-is (validated against the three
 * known modes so unrecognised garbage falls back rather than wedging the
 * ribbon into an unrenderable state).
 */
function resolveDisplayMode(persisted) {
    if (persisted.displayMode === 'tabs' || persisted.displayMode === 'simple' || persisted.displayMode === 'full') {
        return persisted.displayMode;
    }
    if (persisted.collapsed) return 'tabs';
    if (persisted.density === 'simple') return 'simple';
    return 'full';
}

const persisted = loadPersistedState();
const ribbonState = {
    scope: persisted.scope || 'project',
    activeTab: 'home',
    displayMode: resolveDisplayMode(persisted),
    morePopoverOpen: false,
    displayMenuOpen: false,
    openGroupTrigger: null,
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
        highlightToggles: (typeof HighlightToggles !== 'undefined') ? HighlightToggles.getState() : null,
        editorVisible: !document.querySelector('.editor-panel')?.classList.contains('collapsed'),
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
    Tasks: 'tasks', Outline: 'notepad', Board: 'kanban', Gantt: 'gantt', Timeline: 'timeline', Calendar: 'calendar',
    RAID: 'raid', 'RAID Log': 'raid', Actions: 'actions', Highlights: 'highlights', Lookahead: 'lookahead',
    Lessons: 'lessons', Budget: 'budget', EVM: 'evm', Forecast: 'evm', Benefits: 'benefits', Analysis: 'analysis', Escalations: 'escalations',
    Resources: 'resources', Stakeholders: 'stakeholders', Timesheet: 'timesheet', Workload: 'user-workload',
    'Resource Sheet': 'resource-sheet', 'Comms Plan': 'comms', Report: 'project-report', 'Project Report': 'project-report',
    Dashboard: 'project-report',
    Milestones: 'milestones', 'Mind Map': 'mindmap', Whiteboard: 'whiteboard', PBS: 'pbs', Products: 'pbs',
    'Product Flow': 'product-flow', Deliverables: 'deliverables',
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
// Stage presets for the per-category highlight toggles (#1051), keyed to
// HighlightToggles.PRESETS. 'All' / 'Plain' are the always-on / no-
// highlighting bookends the issue requires; the rest are the DADESRC-stage
// presets (#783 D) the wizard shell (#1054) will later apply automatically.
const HIGHLIGHT_PRESETS = [
    { label: 'All', preset: 'all' },
    { label: 'Plain (no highlighting)', preset: 'plain' },
    { label: 'Design', preset: 'design' },
    { label: 'Add Tasks', preset: 'add-tasks' },
    { label: 'Dependencies', preset: 'dependencies' },
    { label: 'Estimating', preset: 'estimating' },
    { label: 'Scheduling', preset: 'scheduling' },
    { label: 'Risks', preset: 'risks' },
    { label: 'Comms', preset: 'comms' },
].map(({ label, preset }) => ({
    label,
    run: () => { if (typeof HighlightToggles !== 'undefined') HighlightToggles.applyPreset(preset); },
}));

const LABEL_HELP = {
    'Show Durations': 'Toggle duration syntax highlighting in the markdown editor',
    'Show Resources': 'Toggle resource syntax highlighting in the markdown editor',
    'Show Tags': 'Toggle tag syntax highlighting in the markdown editor',
    'Show Comments': 'Toggle comment syntax highlighting in the markdown editor',
    'Show Dependencies': 'Toggle dependency syntax highlighting in the markdown editor',
    'Highlight Preset': 'Choose a markdown editor syntax-highlighting preset',
    Editor: 'Show or hide the markdown editor panel',
};

function labelHelp(label) {
    return LABEL_HELP[label] || label;
}

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

        // #1113: the Track ribbon's RAID group buttons used to all fall back
        // to the generic "Risk" default (or, for Assumption/Dependency, do
        // nothing at all). openRaidFormWithType() already existed for
        // exactly this. The app's RAID types are risk/action/issue/decision/
        // dependency -- there's no dedicated "assumption" type, so the
        // Assumption button presets the closest existing one, Decision.
        'track:Risk': () => openRaidFormWithType('risk'),
        'track:Issue': () => openRaidFormWithType('issue'),
        'track:Assumption': () => openRaidFormWithType('decision'),
        'track:Dependency': () => openRaidFormWithType('dependency'),
        'track:Action': () => openRaidFormWithType('action'),
        // #1115: switch into the Benefits view's Tracking sub-view (Map is
        // the default; Realisation is the only reason this button existed).
        'track:Realisation': () => { switchToView('benefits'); if (typeof benSwitchView === 'function') benSwitchView('tracking'); },
        'lessons:New Lesson': () => addLessonsItem(),
        'stakeholders:Add Stakeholder': () => addStakeholderRow(),
        'stakeholders:Comms Plan': switchView('comms'),
        'resources:Add Resource': () => openResourceForm(),
        'resources:Timesheet': switchView('timesheet'),
        'resources:Workload': () => { window.onlyOverallocatedWorkload = false; switchToView('user-workload'); },
        'resources:Level': () => showLevellingSuggestions(),
        'resources:Clear Level': () => clearLevellingNow(),
        'resources:Overallocation': () => showOverallocationView(),
        'stakeholders:Influence': () => showInfluenceDiagram(),
        'kanban:Phase': () => switchKanbanView('phase'),
        'kanban:Resource': () => switchKanbanView('resource'),
        'kanban:Progress': () => switchKanbanView('progress'),
        'kanban:Label': () => switchKanbanView('label'),
        'kanban:Group by': () => openFormatMenu(KANBAN_GROUP_MODES, 'Group by'),
        'whiteboard:Mind Map': switchView('mindmap'),
        'whiteboard:Whiteboard': switchView('whiteboard'),
        // #1109: previously unwired -- opens the selected note's colour
        // panel (whiteboard-notes.js's wbOpenColourPanelForSelectedNote(),
        // the same `...` menu a note's own button opens). Reads
        // ribbonActionAnchor for the button to anchor the popover to,
        // same convention openFormatMenu() below uses.
        'whiteboard:Colour': () => { if (typeof wbOpenColourPanelForSelectedNote === 'function') wbOpenColourPanelForSelectedNote(ribbonActionAnchor); },
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
    // #1125: used to switch to a non-existent 'editor' view; now toggles the
    // markdown editor panel, same as the collapse arrow on its splitter.
    Editor: () => toggleMainEditor(),

    // File / save / print
    Save: () => downloadMarkdown(),
    'Open…': () => openLocalPlanFile(),
    Print: () => window.print(),
    Templates: () => openTemplatesModal(),
    Settings: () => openSettingsPanel(),
    Undo: () => EditorUndoManager.undo(),

    // Per-category syntax highlight toggles (#1051) -- see
    // highlight-toggles.js's own header comment for why flipping these can
    // never touch the editor's actual text or caret.
    'Show Durations': () => HighlightToggles.toggleCategory('duration'),
    'Show Resources': () => HighlightToggles.toggleCategory('resource'),
    'Show Tags': () => HighlightToggles.toggleCategory('tag'),
    'Show Comments': () => HighlightToggles.toggleCategory('comment'),
    'Show Dependencies': () => HighlightToggles.toggleCategory('dependency'),
    'Highlight Preset': () => openFormatMenu(HIGHLIGHT_PRESETS, 'Highlight Preset'),

    // The DADESRC guided flow shell (#1054): a persistent bar the shell
    // injects itself, not a ribbon popover, so nothing here needs
    // OPENS_OWN_POPOVER treatment.
    'Guided Plan': () => { if (typeof PlanWizard !== 'undefined') PlanWizard.open(); },

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
const OPENS_OWN_POPOVER = new Set(['Export', 'Export…', 'Import', 'Import from Excel / MS Project', 'Group by', 'Day/Week/Month', 'Highlight Preset']);

function runAction(scopeId, label, anchorEl = null) {
    ribbonActionAnchor = anchorEl;
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
// `.ribbon-file-menu` -- a name kept from #972 retiring the File dropdown
// that originally introduced the look; only that one caller remains.
// ---------------------------------------------------------------------------

function closePopovers() {
    document.querySelectorAll('.ribbon-file-menu, .ribbon-more-popover, .ribbon-display-menu, .ribbon-simple-group-popover').forEach((el) => el.remove());
    ribbonState.morePopoverOpen = false;
    ribbonState.displayMenuOpen = false;
    ribbonState.openGroupTrigger = null;
}

let ribbonActionAnchor = null;

function openFormatMenu(formats, label, anchorEl = ribbonActionAnchor) {
    closePopovers();
    const shell = document.querySelector('.ribbon-shell');
    if (!shell) return;
    const menu = document.createElement('div');
    menu.className = 'ribbon-file-menu';
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
    const anchor = anchorEl || Array.from(shell.querySelectorAll('[data-label]')).find((el) => el.dataset.label === label) || shell.querySelector('.ribbon-file-btn');
    const shellRect = shell.getBoundingClientRect();
    const anchorRect = anchor?.getBoundingClientRect();
    const menuWidth = 290;
    const desiredLeft = anchorRect ? anchorRect.left - shellRect.left : 8;
    const maxLeft = Math.max(8, shellRect.width - menuWidth - 8);
    menu.style.left = `${Math.round(Math.min(Math.max(8, desiredLeft), maxLeft))}px`;
    menu.style.top = `${Math.round(anchorRect ? anchorRect.bottom - shellRect.top : 34)}px`;
    shell.appendChild(menu);
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
    // Opens the Backstage shell (#943) -- see backstage.js.
    Home: () => switchToView('backstage'),
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
        <button type="button" class="ribbon-file-btn" data-action="open-backstage" title="Home" aria-label="Home">File</button>
        ${tabs}${ctxHtml}
        <div class="ribbon-tabstrip-spacer"></div>
        ${renderDisplaySelector()}
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
    const help = labelHelp(label);
    if (href) {
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${cls}"
            title="${help}" aria-label="${label} (opens in a new tab)">
            ${icon(iconName, size)}${label}
        </a>`;
    }
    const live = getLiveState();
    const action = resolveAction(scopeId, label);
    const isActive = isButtonActive(scopeId, label, live);
    return `<button type="button" class="${cls}${isActive ? ' active' : ''}" data-scope-id="${scopeId}" data-label="${label}"
        title="${help}" aria-label="${label}" aria-pressed="${isActive}" ${action ? '' : 'data-stub="true"'}>
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
    const help = labelHelp(label);
    if (href) {
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="ribbon-simple-btn"
            title="${help}" aria-label="${label} (opens in a new tab)">${inner}</a>`;
    }
    const live = getLiveState();
    const action = resolveAction(scopeId, label);
    const isActive = isButtonActive(scopeId, label, live);
    return `<button type="button" class="ribbon-simple-btn${isActive ? ' active' : ''}" data-scope-id="${scopeId}" data-label="${label}"
        title="${help}" aria-label="${label}" aria-pressed="${isActive}" ${action ? '' : 'data-stub="true"'}>${inner}</button>`;
}

/** Buttons whose pressed state reflects real, currently-known app state. */
function isButtonActive(scopeId, label, live) {
    if (label === 'Editor') return live.editorVisible;
    if (label === 'Critical Path') return live.ganttShowCriticalPath;
    if (label === 'Baseline') return live.ganttShowBaseline;
    if (label === 'Dependencies' || label === 'Deps') return live.ganttShowDependencies;
    if (label === 'Dark Mode') return live.isDark;
    if (label === 'System Theme') return live.themeChoice === 'system';
    if (label === 'Show Durations') return !!live.highlightToggles?.duration;
    if (label === 'Show Resources') return !!live.highlightToggles?.resource;
    if (label === 'Show Tags') return !!live.highlightToggles?.tag;
    if (label === 'Show Comments') return !!live.highlightToggles?.comment;
    if (label === 'Show Dependencies') return !!live.highlightToggles?.dependency;
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

/**
 * The simple ribbon's per-group markup (#955, extended by #1026). Buttons
 * live inside a `.ribbon-simple-group-buttons` wrapper rather than directly
 * in the group element so applySimpleBody()'s last-resort pass (#1026) can
 * collapse the whole group into its own `.ribbon-simple-group-trigger`
 * dropdown chip by toggling which of the two is shown -- never by
 * destroying and later trying to reconstruct the buttons' markup, which
 * would have no way to restore itself correctly on a later resize wider
 * (this function isn't re-invoked on resize; only the fit passes re-run).
 * `hidden` on the trigger keeps it out of the accessibility tree and tab
 * order until a group actually collapses.
 */
function renderSimpleGroup(scopeId, group, animate) {
    const buttons = flattenGroupButtons(group).map((b) => renderButton(scopeId, b, 'simple')).join('');
    const name = escapeHtml(group.name);
    return `<div class="ribbon-simple-group${animate ? ' ribbon-group-tab-in' : ''}" data-group="${name}">
        <div class="ribbon-simple-group-buttons">${buttons}</div>
        <button type="button" class="ribbon-simple-group-trigger" data-action="toggle-group-menu" data-group="${name}"
            title="${name}" aria-label="${name}" aria-haspopup="true" aria-expanded="false" hidden>${icon('grid', 12)}<span class="ribbon-caret">▼</span></button>
    </div>`;
}

/**
 * The combined ribbon display selector (#1027) -- replaces the two
 * previously-separate controls: the tab strip's own "collapse the ribbon"
 * chevron (▲/▼, Office's "auto-hide"/"show tabs only" concept) and the
 * "Ribbon Display Options" Full/Simple dropdown (#955) that used to live at
 * the ribbon body's bottom-right corner. One control, three mutually
 * exclusive modes (`ribbonState.displayMode`): "Just Tabs" (body hidden --
 * the old `collapsed`), "Simple Ribbon" and "Full Ribbon" (the old
 * `density`).
 *
 * Placement: the tab strip, in the collapse button's old slot -- not the
 * body's bottom-right corner #955 originally put the Full/Simple toggle in.
 * That corner lives inside `.ribbon-body`, which "Just Tabs" mode hides
 * entirely (`display: none`); the issue is explicit that the selector must
 * "keep the selector reachable so the user can return to either expanded
 * mode", so a control that vanishes exactly when its own "Just Tabs" choice
 * is active would defeat that requirement. The tab strip is the one bar that
 * stays visible in all three modes.
 *
 * "Remove the icon and any button border -- just show the dropdown arrow":
 * no icon, and `.ribbon-display-toggle-btn` in components.css drops the
 * border/background a plain caret would otherwise sit inside.
 */
function renderDisplaySelector() {
    return `
        <div class="ribbon-display-toggle">
            <button type="button" class="ribbon-display-toggle-btn" data-action="toggle-display-menu"
                title="Ribbon Display Options" aria-label="Ribbon Display Options" aria-haspopup="true" aria-expanded="${ribbonState.displayMenuOpen}">
                <span class="ribbon-caret">▼</span>
            </button>
        </div>
    `;
}

const DISPLAY_MODES = [
    { mode: 'tabs', label: 'Just Tabs' },
    { mode: 'simple', label: 'Simple Ribbon' },
    { mode: 'full', label: 'Full Ribbon' },
];

function displayMenuItemsHtml() {
    return DISPLAY_MODES.map(({ mode, label }) => {
        const selected = ribbonState.displayMode === mode;
        return `
        <button type="button" class="ribbon-display-menu-item${selected ? ' selected' : ''}" data-display-mode="${mode}" role="menuitemradio" aria-checked="${selected}">
            <span class="ribbon-display-menu-item-check">${selected ? '✓' : ''}</span>${label}
        </button>`;
    }).join('');
}

/**
 * The display-selector menu's actual popover (#1027, formerly #955's
 * Full/Simple-only version) -- appended to `.ribbon-shell`, like
 * renderMorePopover()'s `.ribbon-more-popover`, rather than nested inside
 * renderDisplaySelector()'s own markup.
 *
 * Why: `.ribbon-body` has `overflow: hidden` (needed so a group that's
 * about to be pushed into "More" never visibly pokes out before
 * applyOverflow()/applySimpleBody() run on the next frame), which would
 * silently clip a popover nested inside it. Positioning it from the toggle
 * button's real, measured rect (same technique renderMorePopover() uses)
 * keeps it correctly placed regardless of mode or window size, without being
 * clipped by an ancestor it doesn't need to live inside.
 *
 * Opens downward from the button's bottom edge, right-aligned to it: since
 * #1027 moved the trigger into the tab strip (near the top of the shell --
 * see renderDisplaySelector()'s comment for why), a menu that opened upward
 * from the old body-bottom placement would now push itself off the top of
 * the page.
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
    menu.style.top = `${Math.round(btnRect.bottom - shellRect.top)}px`;
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
    return ribbonState.displayMode === 'simple'
        ? tab.groups.map((g) => renderSimpleGroup(tab.id, g, animate)).join('')
        : tab.groups.map((g) => renderGroup(tab.id, g, animate)).join('');
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

    // #1027 moved the display-selector out of `.ribbon-body` and into the
    // tab strip, so the fit budget no longer needs to reserve width for it
    // here -- the full measured body width is available to the groups.
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

/**
 * The simple ribbon's responsive fallback (#955, extended by #1026). Two
 * passes, each reusing a pure ribbon-layout.js function against real
 * measured DOM widths:
 *
 *   1. fitLabels() -- shrink labels left-to-right until the whole row (every
 *      button, across every group) fits at full text, or everything left of
 *      the point it stopped fitting is icon-only. This is the common case:
 *      a single dense row usually resolves itself by losing labels long
 *      before whole subsections need to disappear -- and every command's
 *      icon stays visible either way; only its label is ever at risk.
 *   2. fitSimpleGroups() -- only once every label is already gone and the
 *      row *still* doesn't fit does a group collapse, and then into its own
 *      small, identifiable `.ribbon-simple-group-trigger` dropdown -- never
 *      into one shared "More" catch-all the way the full ribbon's own
 *      applyOverflow() does (see fitSimpleGroups()'s own comment in
 *      ribbon-layout.js for why that needed a different fit algorithm, not
 *      just fitGroups() reused with different constants). Only needed as a
 *      last resort -- a very narrow window, or a tab with many subsections.
 *
 * Idempotent and always re-derived from the DOM's current widths, not from
 * what a previous call decided -- both passes reset every group/button back
 * to its full, uncollapsed state before re-measuring (mirroring
 * applyOverflow()'s own stale-`.ribbon-more` cleanup), so a window resized
 * back wider correctly restores labels and groups a narrower pass
 * previously collapsed, whether this run started from this function's own
 * previous output or from a fresh renderRibbonBody() render.
 */
const SIMPLE_ICON_ONLY_WIDTH = 28; // matches `.ribbon-simple-btn.icon-only`'s fixed CSS width
const SIMPLE_GROUP_TRIGGER_WIDTH = 32; // matches `.ribbon-simple-group-trigger`'s fixed CSS width

function applySimpleBody() {
    const body = document.querySelector('.ribbon-body');
    if (!body) return;

    const groups = Array.from(body.querySelectorAll(':scope > .ribbon-simple-group'));
    groups.forEach((g) => {
        g.classList.remove('ribbon-simple-group-collapsed');
        const buttonsWrap = g.querySelector(':scope > .ribbon-simple-group-buttons');
        const trigger = g.querySelector(':scope > .ribbon-simple-group-trigger');
        if (buttonsWrap) buttonsWrap.style.display = '';
        if (trigger) { trigger.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    });
    const buttons = Array.from(body.querySelectorAll('.ribbon-simple-btn'));
    buttons.forEach((b) => b.classList.remove('icon-only'));
    if (groups.length === 0) return;

    const { fitLabels, fitSimpleGroups } = ribbonLayoutModule;
    // #1027 moved the display-selector out of `.ribbon-body` and into the
    // tab strip, so the fit budget no longer needs to reserve width for it.
    const containerWidth = body.clientWidth;

    // Pass 1: per-button text-fit, densest pass first.
    const items = buttons.map((b) => ({ iconWidth: SIMPLE_ICON_ONLY_WIDTH, fullWidth: b.getBoundingClientRect().width }));
    const showLabel = fitLabels(items, containerWidth);
    buttons.forEach((b, i) => { if (!showLabel[i]) b.classList.add('icon-only'); });

    // Pass 2: each group's width, now that pass 1 has settled every
    // button's label/icon-only state, decides which groups (if any) must
    // collapse into their own trigger.
    const widths = groups.map((el) => el.getBoundingClientRect().width);
    const { collapsed } = fitSimpleGroups(widths, containerWidth, SIMPLE_GROUP_TRIGGER_WIDTH);
    collapsed.forEach((i) => {
        const g = groups[i];
        g.classList.add('ribbon-simple-group-collapsed');
        const buttonsWrap = g.querySelector(':scope > .ribbon-simple-group-buttons');
        const trigger = g.querySelector(':scope > .ribbon-simple-group-trigger');
        if (buttonsWrap) buttonsWrap.style.display = 'none';
        if (trigger) trigger.hidden = false;
    });
}

/** Runs whichever density's overflow pass applies -- see applyOverflow()/
 * applySimpleBody()'s own comments. Shared by refreshRibbon() and the
 * window resize handler so both modes stay correctly fitted. */
function applyBodyLayout() {
    if (ribbonState.displayMode === 'simple') applySimpleBody();
    else applyOverflow();
}

let ribbonLayoutModule = null;
async function loadLayout() {
    if (!ribbonLayoutModule) ribbonLayoutModule = await import('/static/ribbon-layout.js');
    return ribbonLayoutModule;
}

/** The full ribbon's shared "More" flyout (#833). Simple mode has its own,
 * separate per-group popover (renderGroupPopover(), #1026) since #1026
 * replaced its group-level fallback with individual dropdowns rather than
 * one shared catch-all -- this is reached only via applyOverflow()'s
 * `.ribbon-more-btn`, which simple mode no longer ever renders. */
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
    const shell = document.querySelector('.ribbon-shell');
    if (shell && body) {
        const top = body.getBoundingClientRect().bottom - shell.getBoundingClientRect().top;
        popover.style.top = `${Math.round(top)}px`;
    }
    shell?.appendChild(popover);
}

/**
 * #1026: a single collapsed simple-ribbon group's own dropdown -- unlike
 * renderMorePopover() above (which can gather several hidden full-style
 * groups into one flyout), this always renders exactly the one group behind
 * the trigger that was clicked, in the full-style rendering (renderGroup(),
 * not renderSimpleGroup()) since there's plenty of room in a flyout and no
 * reason to cram its contents into the dense simple layout. Appended to
 * `.ribbon-shell` and positioned from the trigger's own measured rect for
 * the same reason renderDisplayMenu()/renderMorePopover() are: `.ribbon-body`
 * clips anything nested inside it via `overflow: hidden`.
 */
function renderGroupPopover(ia, ctxTab, groupName, triggerEl) {
    closePopovers();
    const tab = activeTabData(ia, ctxTab);
    const group = tab.groups.find((g) => g.name === groupName);
    if (!group) return;

    const popover = document.createElement('div');
    popover.className = 'ribbon-simple-group-popover';
    popover.setAttribute('role', 'menu');
    popover.setAttribute('aria-label', groupName);
    popover.innerHTML = renderGroup(tab.id, group, false);

    const shell = document.querySelector('.ribbon-shell');
    if (shell && triggerEl) {
        const btnRect = triggerEl.getBoundingClientRect();
        const shellRect = shell.getBoundingClientRect();
        // Right-align to the trigger, but never let the popover's right edge
        // run past the shell's -- fitSimpleGroups() only ever collapses
        // groups starting from the left, so the last (rightmost) trigger can
        // sit close enough to the shell's own right edge that a naive
        // right-align to the *trigger* would push the popover off-screen.
        const rightOffset = Math.max(0, Math.round(shellRect.right - btnRect.right));
        popover.style.right = `${rightOffset}px`;
        popover.style.top = `${Math.round(btnRect.bottom - shellRect.top)}px`;
    }
    shell?.appendChild(popover);
    ribbonState.openGroupTrigger = groupName;
    if (triggerEl) triggerEl.setAttribute('aria-expanded', 'true');
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
        bodyEl.classList.toggle('ribbon-body-simple', ribbonState.displayMode === 'simple');
        bodyEl.style.background = (ribbonState.activeTab === '__ctx' && ctxTab) ? ctxTab.tint : '';
        bodyEl.innerHTML = renderRibbonBody(ia, ctxTab, animate);
    }

    const collapsed = ribbonState.displayMode === 'tabs';
    shell.classList.toggle('collapsed', collapsed);
    if (bodyEl) bodyEl.style.display = collapsed ? 'none' : '';

    updateDocTitleAndAvatar();
    if (!collapsed) requestAnimationFrame(applyBodyLayout);
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

        // #972: `File` is a straight navigation into Backstage (Office's own
        // "File" tab behaviour), not a dropdown toggle -- see the retired
        // ribbon-file-menu markup this replaced, and FILE_ACTIONS.Home above.
        if (e.target.closest('[data-action="open-backstage"]')) {
            switchToView('backstage');
            return;
        }

        // #1027: `toggle-display-menu` opens the combined display selector
        // (renderDisplaySelector(), in the tab strip) -- its menu offers all
        // three modes (Just Tabs/Simple/Full), replacing the old separate
        // `toggle-collapse` chevron entirely.
        if (e.target.closest('[data-action="toggle-display-menu"]')) {
            const wasOpen = ribbonState.displayMenuOpen;
            closePopovers();
            ribbonState.displayMenuOpen = !wasOpen;
            // renderDisplayMenu() (a real popover appended to .ribbon-shell,
            // not part of the tab strip's own innerHTML -- see its own
            // comment on why) only needs to run when opening; refreshRibbon()
            // alone already re-renders the toggle button's aria-expanded
            // either way.
            //
            // The extra requestAnimationFrame here matters in simple mode:
            // refreshRibbon() ends by scheduling applyBodyLayout() (which
            // runs applySimpleBody()'s label-shrink/group-collapse pass) on
            // the NEXT animation frame, not synchronously. The toggle button
            // itself lives in the tab strip now (#1027), whose own layout
            // doesn't depend on that fit pass -- but the display MENU's
            // possible width still reacts to which mode ends up selected, so
            // this stays deferred a frame for the same "measure after things
            // have settled" safety applyOverflow()/applySimpleBody() callers
            // rely on elsewhere. Queuing this rAF from inside refreshRibbon()'s
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

        const displayModeBtn = e.target.closest('.ribbon-display-menu-item');
        if (displayModeBtn) {
            const next = displayModeBtn.dataset.displayMode;
            const isValidMode = DISPLAY_MODES.some((m) => m.mode === next);
            // closePopovers() (not just setting the flag) is what actually
            // removes the .ribbon-display-menu DOM node -- it's a sibling of
            // the body appended straight to .ribbon-shell (see
            // renderDisplayMenu()'s comment), so refreshRibbon() alone,
            // which only re-renders the titlebar/tabstrip/body, would leave
            // a stale popover behind.
            closePopovers();
            if (isValidMode && next !== ribbonState.displayMode) {
                ribbonState.displayMode = next;
                savePersistedState();
            }
            refreshRibbon();
            return;
        }

        // #1026: a collapsed simple-ribbon group's own dropdown trigger.
        const groupTriggerBtn = e.target.closest('.ribbon-simple-group-trigger');
        if (groupTriggerBtn) {
            const groupName = groupTriggerBtn.dataset.group;
            const wasOpenForThisGroup = ribbonState.openGroupTrigger === groupName;
            closePopovers();
            if (!wasOpenForThisGroup) {
                loadIA().then((ia) => renderGroupPopover(ia, ia.contextualTabFor(getLiveState().view), groupName, groupTriggerBtn));
            }
            return;
        }

        if (e.target.closest('[data-action="toggle-more"]')) {
            loadIA().then((ia) => renderMorePopover(ia, ia.contextualTabFor(getLiveState().view)));
            return;
        }

        const cmdBtn = e.target.closest('.ribbon-lg-btn, .ribbon-sm-btn, .ribbon-simple-btn');
        if (cmdBtn && cmdBtn.dataset.label) {
            runAction(cmdBtn.dataset.scopeId, cmdBtn.dataset.label, cmdBtn);
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
    window.addEventListener('editorPanelVisibilityChanged', () => refreshRibbon());

    // #972: New/Open/Print must keep working as real, global keyboard
    // shortcuts once the File dropdown (their only previous home, as
    // decorative `kbd` hints -- they were never actually bound to a
    // listener) is retired. Cmd/Ctrl+S already works from anywhere via its
    // own listener in script.js; these three go through the same
    // FILE_ACTIONS map the rail/File button use, so there is exactly one
    // place each command lives.
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === 'n') { e.preventDefault(); FILE_ACTIONS['New plan'](); }
        else if (key === 'o') { e.preventDefault(); FILE_ACTIONS['Open…'](); }
        else if (key === 'p') { e.preventDefault(); FILE_ACTIONS['Print'](); }
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
        resizeTimer = setTimeout(() => { if (ribbonState.displayMode !== 'tabs') applyBodyLayout(); }, 100);
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initRibbon);
}
