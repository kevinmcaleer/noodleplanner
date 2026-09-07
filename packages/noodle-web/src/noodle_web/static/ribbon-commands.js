/**
 * ribbon-commands.js — central command registry for the project ribbon
 * (#833, #891). Declarative data only: no DOM access, no globals. The
 * renderer (ribbon.js) asks this module which groups and commands apply to
 * the current state and draws them.
 *
 * A command is { id, label, icon, shortcut?, isVisible?(state), isEnabled?(state),
 * isActive?(state), run(actions) }. isVisible/isEnabled/isActive default to
 * true/true/false when omitted. `state` and `actions` are plain objects built
 * by ribbon.js -- see getRibbonState() there for the state shape.
 */

const GROUP_BY_MODES = [
    { mode: 'phase', label: 'Phase', icon: 'bi-diagram-3' },
    { mode: 'resource', label: 'Resource', icon: 'bi-people' },
    { mode: 'progress', label: 'Progress', icon: 'bi-percent' },
    { mode: 'label', label: 'Label', icon: 'bi-tags' },
    { mode: 'bucket', label: 'Bucket', icon: 'bi-box' },
];

const isProductView = (state) => state.view === 'pbs' || state.view === 'product-flow';

// Portfolio lists every project, with no single markdown editor to act on --
// the editor commands below don't make sense there.
const isProjectContext = (state) => state.view !== 'portfolio';

export const RIBBON_GROUPS = [
    // ---- Visible whenever a single project's editor is in view (#892) ----
    {
        id: 'edit',
        label: 'Edit',
        isVisible: isProjectContext,
        commands: [
            { id: 'undo', label: 'Undo', icon: 'bi-arrow-counterclockwise', shortcut: 'Ctrl+Z',
                isEnabled: (s) => s.canUndo, run: (a) => a.undo() },
            { id: 'redo', label: 'Redo', icon: 'bi-arrow-clockwise', shortcut: 'Ctrl+Shift+Z',
                isEnabled: (s) => s.canRedo, run: (a) => a.redo() },
            { id: 'outdent', label: 'Outdent', icon: 'bi-text-indent-left', shortcut: 'Cmd+[',
                run: (a) => a.outdent() },
            { id: 'indent', label: 'Indent', icon: 'bi-text-indent-right', shortcut: 'Cmd+]',
                run: (a) => a.indent() },
            { id: 'link-tasks', label: 'Link Tasks', icon: 'bi-link-45deg',
                run: (a) => a.linkTasks() },
            { id: 'task-inspector', label: 'Inspector', icon: 'bi-search',
                run: (a) => a.taskInspector() },
        ],
    },
    {
        id: 'file',
        label: 'File',
        isVisible: isProjectContext,
        commands: [
            { id: 'upload', label: 'Upload', icon: 'bi-upload', run: (a) => a.uploadPlan() },
            { id: 'open-local', label: 'Open', icon: 'bi-folder2-open', run: (a) => a.openLocal() },
            { id: 'save', label: 'Save', icon: 'bi-download', run: (a) => a.save() },
        ],
    },
    {
        id: 'format',
        label: 'Format',
        isVisible: isProjectContext,
        commands: [
            { id: 'conditional-formatting', label: 'Conditional Formatting', icon: 'bi-palette',
                run: (a) => a.conditionalFormatting() },
            { id: 'refresh', label: 'Refresh', icon: 'bi-arrow-clockwise', run: (a) => a.refresh() },
        ],
    },

    // ---- Gantt: contextual, only while that view is active (#896) ----
    {
        id: 'gantt-options',
        label: 'Gantt',
        isVisible: (s) => s.view === 'gantt' || s.view === 'tasks',
        commands: [
            { id: 'gantt-dependencies', label: 'Dependencies', icon: 'bi-diagram-2',
                isActive: (s) => s.ganttShowDependencies, run: (a) => a.toggleGanttDependencies() },
            { id: 'gantt-critical-path', label: 'Critical Path', icon: 'bi-flag',
                isActive: (s) => s.ganttShowCriticalPath, run: (a) => a.toggleGanttCriticalPath() },
            { id: 'gantt-baseline', label: 'Baseline', icon: 'bi-layers',
                isActive: (s) => s.ganttShowBaseline, run: (a) => a.toggleGanttBaseline() },
        ],
    },

    // ---- RAID log: contextual, only while that view is active (#896) ----
    {
        id: 'raid-actions',
        label: 'RAID Log',
        isVisible: (s) => s.view === 'raid',
        commands: [
            { id: 'raid-add-item', label: 'Add Item', icon: 'bi-plus-circle', run: (a) => a.addRaidItem() },
        ],
    },

    // ---- Comms plan: contextual, only while that view is active (#896) ----
    {
        id: 'comms-actions',
        label: 'Comms Plan',
        isVisible: (s) => s.view === 'comms',
        commands: [
            { id: 'comms-add-item', label: 'Add Item', icon: 'bi-plus-circle', run: (a) => a.addCommsItem() },
            { id: 'comms-export-word', label: 'Export Word', icon: 'bi-file-earmark-word', run: (a) => a.exportCommsToWord() },
        ],
    },

    // ---- Mind Map: contextual, only while that view is active (#893) ----
    {
        id: 'mindmap-view',
        label: 'Mind Map',
        isVisible: (s) => s.view === 'mindmap',
        commands: [
            { id: 'mindmap-zoom-in', label: 'Zoom In', icon: 'bi-zoom-in', run: (a) => a.mindmapZoomIn() },
            { id: 'mindmap-zoom-out', label: 'Zoom Out', icon: 'bi-zoom-out', run: (a) => a.mindmapZoomOut() },
            { id: 'mindmap-zoom-fit', label: 'Fit', icon: 'bi-arrows-fullscreen', run: (a) => a.mindmapZoomFit() },
            { id: 'mindmap-zoom-reset', label: 'Reset', icon: 'bi-aspect-ratio', run: (a) => a.mindmapZoomReset() },
        ],
    },
    {
        id: 'mindmap-structure',
        label: 'Structure',
        isVisible: (s) => s.view === 'mindmap',
        commands: [
            { id: 'mindmap-expand-all', label: 'Expand All', icon: 'bi-arrows-angle-expand',
                run: (a) => a.mindmapExpandAll() },
            { id: 'mindmap-collapse-all', label: 'Collapse All', icon: 'bi-arrows-angle-contract',
                run: (a) => a.mindmapCollapseAll() },
        ],
    },

    // ---- Board: contextual, only while that view is active (#894) ----
    {
        id: 'board-group-by',
        label: 'Group By',
        isVisible: (s) => s.view === 'kanban',
        commands: GROUP_BY_MODES.map(({ mode, label, icon }) => ({
            id: `kanban-group-${mode}`,
            label,
            icon,
            isActive: (s) => s.kanbanViewMode === mode,
            run: (a) => a.switchKanbanView(mode),
        })),
    },
    {
        id: 'board-options',
        label: 'Options',
        isVisible: (s) => s.view === 'kanban',
        commands: [
            { id: 'kanban-hide-completed', label: 'Hide Completed', icon: 'bi-eye-slash',
                isActive: (s) => s.kanbanHideCompleted, run: (a) => a.toggleKanbanHideCompleted() },
            { id: 'kanban-sort-priority', label: 'Sort by Priority', icon: 'bi-sort-down',
                isActive: (s) => s.kanbanSortPriority, run: (a) => a.toggleKanbanSortPriority() },
        ],
    },

    // ---- Product views: contextual, PBS and Product Flow (#895) ----
    {
        id: 'products-view',
        label: 'View',
        isVisible: isProductView,
        commands: [
            { id: 'product-zoom-in', label: 'Zoom In', icon: 'bi-zoom-in', run: (a) => a.productZoomIn() },
            { id: 'product-zoom-out', label: 'Zoom Out', icon: 'bi-zoom-out', run: (a) => a.productZoomOut() },
            { id: 'product-zoom-fit', label: 'Fit', icon: 'bi-arrows-fullscreen', run: (a) => a.productZoomFit() },
            { id: 'product-zoom-reset', label: 'Reset', icon: 'bi-aspect-ratio', run: (a) => a.productZoomReset() },
            // Product Flow only: PBS has no expand/collapse of its own.
            { id: 'product-expand-all', label: 'Expand All', icon: 'bi-arrows-angle-expand',
                isVisible: (s) => s.view === 'product-flow', run: (a) => a.productExpandAll() },
            { id: 'product-collapse-all', label: 'Collapse All', icon: 'bi-arrows-angle-contract',
                isVisible: (s) => s.view === 'product-flow', run: (a) => a.productCollapseAll() },
        ],
    },
    {
        id: 'products-export',
        label: 'Export',
        isVisible: isProductView,
        commands: [
            { id: 'product-copy-image', label: 'Copy Image', icon: 'bi-clipboard', run: (a) => a.productCopyImage() },
            { id: 'product-download-png', label: 'Download PNG', icon: 'bi-file-earmark-image', run: (a) => a.productDownloadPng() },
            { id: 'product-download-svg', label: 'Download SVG', icon: 'bi-filetype-svg', run: (a) => a.productDownloadSvg() },
        ],
    },
    {
        id: 'products-options',
        label: 'Options',
        isVisible: isProductView,
        commands: [
            { id: 'product-rag-toggle', label: 'Colour by RAG', icon: 'bi-circle-half',
                run: (a) => a.productToggleRag() },
            // Product Flow only: PBS has no completed-hiding toggle.
            { id: 'product-hide-completed', label: 'Hide Completed', icon: 'bi-eye-slash',
                isVisible: (s) => s.view === 'product-flow', run: (a) => a.productToggleCompleted() },
        ],
    },
];

export function isCommandVisible(cmd, state) {
    return cmd.isVisible ? !!cmd.isVisible(state) : true;
}

export function isCommandEnabled(cmd, state) {
    return cmd.isEnabled ? !!cmd.isEnabled(state) : true;
}

export function isCommandActive(cmd, state) {
    return cmd.isActive ? !!cmd.isActive(state) : false;
}

export function isGroupVisible(group, state) {
    return group.isVisible ? !!group.isVisible(state) : true;
}

/**
 * Groups (with their commands already filtered) that should render for the
 * given state: the group itself must be visible, and it must end up with at
 * least one visible command.
 */
export function visibleGroups(state) {
    return RIBBON_GROUPS
        .filter((group) => isGroupVisible(group, state))
        .map((group) => ({
            ...group,
            commands: group.commands.filter((cmd) => isCommandVisible(cmd, state)),
        }))
        .filter((group) => group.commands.length > 0);
}
