/**
 * ribbon.js — page-level command ribbon (#833, #839).
 *
 * Renders the groups from ribbon-commands.js (a pure ES module, dynamically
 * imported so this file can stay a classic script like the rest of the app)
 * as a full-width Metro-style bar. The Edit/File/Format groups are always
 * shown; Mind Map / Board / Products groups appear only while that view is
 * active (#897) -- there is no separate tab strip to click between, since
 * .plan-subnav already owns view switching. "View-scoped" here means the
 * ribbon's own content follows the active view automatically.
 *
 * DOM + global-function wiring lives here; ribbon-commands.js stays pure
 * and framework-free so it can be unit-tested without a browser.
 */

let ribbonCommandsModule = null;

function loadRibbonCommands() {
    if (!ribbonCommandsModule) {
        ribbonCommandsModule = import('/static/ribbon-commands.js');
    }
    return ribbonCommandsModule;
}

/** Dispatch table the registry's `run(actions)` calls into. Every function
 * here is resolved lazily (looked up by name inside the closure, not at
 * definition time), so load order relative to the files that define these
 * globals does not matter. */
const RibbonActions = {
    undo: () => EditorUndoManager.undo(),
    redo: () => EditorUndoManager.redo(),
    outdent: () => outdentSelectedLines(),
    indent: () => indentSelectedLines(),
    linkTasks: () => linkSelectedTasks(),
    taskInspector: () => openTaskInspectorForCurrentLine(),
    uploadPlan: () => uploadPlanFile(),
    openLocal: () => openLocalPlanFile(),
    save: () => downloadMarkdown(),
    conditionalFormatting: () => openConditionalFormattingPanel(),
    refresh: () => renderText(),

    toggleGanttDependencies: () => toggleGanttCheckbox('ganttShowDependencies'),
    toggleGanttCriticalPath: () => toggleGanttCheckbox('ganttShowCriticalPath'),
    toggleGanttBaseline: () => toggleGanttCheckbox('ganttShowBaseline'),

    addRaidItem: () => addRaidItem(),
    addCommsItem: () => addCommsItem(),
    exportCommsToWord: () => exportCommsToWord(),

    mindmapZoomIn: () => mindmapZoomIn(),
    mindmapZoomOut: () => mindmapZoomOut(),
    mindmapZoomFit: () => mindmapZoomFit(),
    mindmapZoomReset: () => mindmapZoomReset(),
    mindmapExpandAll: () => mindmapExpandAll(),
    mindmapCollapseAll: () => mindmapCollapseAll(),

    switchKanbanView: (mode) => switchKanbanView(mode),
    toggleKanbanHideCompleted: () => toggleKanbanHideCompleted(!(kanbanBoard && kanbanBoard.hideCompleted)),
    toggleKanbanSortPriority: () => toggleKanbanPrioritySort(!(kanbanBoard && kanbanBoard.sortByPriority)),

    // Product views: PBS and Product Flow keep separate zoom/pan state and
    // (mostly) separate function names, so dispatch on the active view.
    productZoomIn: () => (getRibbonState().view === 'product-flow' ? productFlowZoomIn() : pbsZoomIn()),
    productZoomOut: () => (getRibbonState().view === 'product-flow' ? productFlowZoomOut() : pbsZoomOut()),
    productZoomFit: () => (getRibbonState().view === 'product-flow' ? productFlowZoomFit() : pbsZoomFit()),
    productZoomReset: () => (getRibbonState().view === 'product-flow' ? productFlowZoomReset() : pbsZoomReset()),
    productExpandAll: () => productFlowExpandAll(),
    productCollapseAll: () => productFlowCollapseAll(),
    productCopyImage: () => copySvgAsImage(
        getRibbonState().view === 'product-flow' ? 'productFlowContainer' : 'pbsContainer', null),
    productDownloadPng: () => downloadSvgAsImage(
        getRibbonState().view === 'product-flow' ? 'productFlowContainer' : 'pbsContainer', 'png', null),
    productDownloadSvg: () => downloadSvgAsImage(
        getRibbonState().view === 'product-flow' ? 'productFlowContainer' : 'pbsContainer', 'svg', null),
    // Shared toggle state (pbsRagMode) colours both PBS and Product Flow.
    productToggleRag: () => pbsToggleRagMode(null),
    productToggleCompleted: () => productFlowToggleCompleted(null),
};

/** Flip a Gantt view checkbox and fire a real 'change' event, reusing the
 * existing addEventListener('change', ...) wiring in views-gantt.js rather
 * than duplicating what it does. */
function toggleGanttCheckbox(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change'));
}

/** Everything the registry's isVisible/isEnabled/isActive predicates read. */
function getRibbonState() {
    const view = (typeof NavigationController !== 'undefined') ? NavigationController.getCurrentView() : null;
    return {
        view,
        canUndo: (typeof EditorUndoManager !== 'undefined') ? EditorUndoManager.canUndo() : false,
        canRedo: (typeof EditorUndoManager !== 'undefined') ? EditorUndoManager.canRedo() : false,
        kanbanViewMode: (typeof kanbanBoard !== 'undefined' && kanbanBoard) ? kanbanBoard.viewMode : null,
        kanbanHideCompleted: (typeof kanbanBoard !== 'undefined' && kanbanBoard) ? !!kanbanBoard.hideCompleted : false,
        kanbanSortPriority: (typeof kanbanBoard !== 'undefined' && kanbanBoard) ? !!kanbanBoard.sortByPriority : false,
        pbsRagMode: (typeof pbsRagMode !== 'undefined') ? pbsRagMode : false,
        productFlowHideCompleted: (typeof pfHideCompleted !== 'undefined') ? pfHideCompleted : false,
        ganttShowDependencies: !!document.getElementById('ganttShowDependencies')?.checked,
        ganttShowCriticalPath: !!document.getElementById('ganttShowCriticalPath')?.checked,
        ganttShowBaseline: !!document.getElementById('ganttShowBaseline')?.checked,
    };
}

function groupHtml(group, mod, state) {
    const buttons = group.commands.map((cmd) => {
        const enabled = mod.isCommandEnabled(cmd, state);
        const active = mod.isCommandActive(cmd, state);
        const title = cmd.shortcut ? `${cmd.label} (${cmd.shortcut})` : cmd.label;
        return `<button type="button" class="ribbon-cmd-btn${active ? ' active' : ''}"
            data-ribbon-cmd="${cmd.id}" title="${title}" aria-label="${title}" aria-pressed="${active}"
            ${enabled ? '' : 'disabled'}>
            <i class="bi ${cmd.icon}" aria-hidden="true"></i>
            <span class="ribbon-cmd-label">${cmd.label}</span>
        </button>`;
    }).join('');
    return `<div class="ribbon-group" data-ribbon-group="${group.id}">
        <div class="ribbon-group-buttons">${buttons}</div>
        <div class="ribbon-group-label">${group.label}</div>
    </div>`;
}

async function renderRibbon() {
    const container = document.getElementById('commandRibbon');
    if (!container) return;

    const mod = await loadRibbonCommands();
    const state = getRibbonState();
    const groups = mod.visibleGroups(state);

    container.innerHTML = groups.map((g) => groupHtml(g, mod, state)).join('');

    container.querySelectorAll('.ribbon-cmd-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.ribbonCmd;
            const group = groups.find((g) => g.commands.some((c) => c.id === id));
            const cmd = group && group.commands.find((c) => c.id === id);
            if (!cmd) return;
            cmd.run(RibbonActions);
            refreshRibbon();
        });
    });
}

/** Re-render (used after a click, a view switch, or a state change). */
function refreshRibbon() {
    renderRibbon();
}

/**
 * Wrap every registered view's activate() so the ribbon refreshes exactly
 * when a view actually becomes current (#897). This is NOT the same moment
 * navigateTo() returns: a Portfolio<->Project context switch runs its
 * activate() ~150ms later, inside performTransitionedSwitch's setTimeout
 * (see NavigationController in script.js) -- wrapping navigateTo() itself
 * would refresh one view too early for every such switch.
 */
function wrapViewActivations() {
    if (typeof NavigationController === 'undefined') return;
    const registry = NavigationController.getRegistry();
    Object.keys(registry).forEach((viewName) => {
        const hooks = registry[viewName];
        if (!hooks || hooks.__ribbonWrapped) return;
        const originalActivate = hooks.activate;
        hooks.activate = function (...args) {
            const result = originalActivate.apply(this, args);
            refreshRibbon();
            return result;
        };
        hooks.__ribbonWrapped = true;
    });
}

function initRibbon() {
    renderRibbon();
    wrapViewActivations();

    // Undo/redo enabled state changes on every keystroke; a full re-render
    // on each one would be wasteful, so patch just those two buttons.
    if (typeof EditorUndoManager !== 'undefined' && !EditorUndoManager.__ribbonWrapped) {
        const originalRefreshButtons = EditorUndoManager.refreshButtons;
        EditorUndoManager.refreshButtons = function (...args) {
            originalRefreshButtons.apply(EditorUndoManager, args);
            const container = document.getElementById('commandRibbon');
            if (!container) return;
            const undoBtn = container.querySelector('[data-ribbon-cmd="undo"]');
            const redoBtn = container.querySelector('[data-ribbon-cmd="redo"]');
            if (undoBtn) undoBtn.disabled = !EditorUndoManager.canUndo();
            if (redoBtn) redoBtn.disabled = !EditorUndoManager.canRedo();
        };
        EditorUndoManager.__ribbonWrapped = true;
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initRibbon);
}
