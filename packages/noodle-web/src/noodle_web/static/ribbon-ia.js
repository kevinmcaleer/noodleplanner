/**
 * ribbon-ia.js -- the command catalogue for the NoodlePlanner ribbon
 * (design handoff "Ribbon Toolbar (option 2a)", #833 follow-up).
 *
 * Ported verbatim from the design's ribbon-ia.json so the ribbon is built
 * from data rather than ~200 hand-written buttons, per that handoff's own
 * instruction. `icon` is a symbol id in the app's SVG sprite (index.html),
 * without the `icon-` prefix. A button tuple is `[icon, label]` or
 * `[icon, label, 'caret']` for a split/gallery button.
 *
 * Pure data: no DOM, no behaviour. ribbon.js resolves each label to a real
 * action and renders this against live state.
 *
 * A button tuple's third element can also be `'link:<url>'` (#909
 * ribbon-parity follow-up) -- this marks the button as a plain external
 * link rather than a command: ribbon.js renders it as an `<a target="_blank"
 * rel="noopener">` instead of a `<button>`, with no action resolution, no
 * active/stub state, and no re-render on click. Used for the "Docs" button.
 *
 * `TABS` is the Project-scope tab set (the original, unchanged). Portfolio
 * scope (#936) gets its own tab set, `PORTFOLIO_TABS`, surfacing the
 * already-shipped `portfolio*.js` views in the same shape. Programme scope
 * has no real functionality yet (programmes aren't built -- see #731/#910),
 * so `PROGRAMME_TABS` is a small, honestly-labelled placeholder whose
 * buttons are deliberate "not available yet" stubs rather than a ribbon
 * that pretends programme features exist. `tabsForScope()` is the single
 * place that picks which set renders for a given scope id.
 */

export const SCOPES = [
    { id: 'project', label: 'Project', icon: 'project-report', blurb: 'One plan: tasks, schedule, RAID, resources and reports.' },
    { id: 'programme', label: 'Programme', icon: 'board', blurb: 'A set of projects: master Gantt, cross-project dependencies, escalations, shared capacity.' },
    { id: 'portfolio', label: 'Portfolio', icon: 'chart', blurb: 'Investment level: weighting, gates, benefits roll-up, heat maps, assurance.' },
];

export const QUICK_ACTIONS = [
    { icon: 'save', label: 'Save' },
    { icon: 'refresh', label: 'Undo' },
    { icon: 'add', label: 'New task' },
    { icon: 'print', label: 'Print' },
    // Kept in the always-visible title bar (not tucked into a tab), matching
    // how prominently the old top nav placed its AI toggle button (#909
    // ribbon-parity follow-up).
    { icon: 'robot', label: 'AI Chat' },
    // #963: the foundational trigger for a live planning session (#766).
    // Title-bar quick action rather than a tab button -- it isn't scoped to
    // any one view, and starting a session is meant to be reachable no
    // matter what the PM is currently looking at.
    { icon: 'people', label: 'Start planning session' },
];

export const TABS = [
    {
        id: 'home', label: 'Home',
        groups: [
            { name: 'Plan', launcher: true, lg: [['project-report', 'Dashboard'], ['task-list', 'New Task'], ['milestones', 'Milestone']], cols: [[['indent', 'Indent'], ['outdent', 'Outdent']], [['delete', 'Delete'], ['doc', 'Details']]] },
            { name: 'Views', lg: [['gantt-chart', 'Gantt'], ['board', 'Board']], cols: [[['timeline', 'Timeline'], ['calendar', 'Calendar']], [['task-list', 'Tasks'], ['grid', 'Sheet']]] },
            { name: 'Track', launcher: true, lg: [['raid-log', 'RAID']], cols: [[['check', 'Actions'], ['highlights', 'Highlights']], [['search', 'Lookahead'], ['warn', 'Escalations']]] },
            { name: 'Report', launcher: true, cols: [[['download', 'Export', 'caret'], ['print', 'Print']], [['save', 'Save'], ['upload', 'Import', 'caret']]] },
        ],
    },
    {
        id: 'plan', label: 'Plan',
        groups: [
            { name: 'Structure', launcher: true, lg: [['task-list', 'Tasks'], ['board', 'PBS']], cols: [[['indent', 'Indent'], ['outdent', 'Outdent']], [['link', 'Link'], ['unlink', 'Unlink']]] },
            { name: 'Schedule', launcher: true, lg: [['gantt-chart', 'Gantt']], cols: [[['calendar', 'Calendars'], ['clock', 'Durations']], [['target', 'Critical Path'], ['clock', 'Baseline']]] },
            { name: 'Deliverables', lg: [['doc', 'Products']], cols: [[['board', 'Product Flow'], ['grid', 'Deliverables']]] },
            { name: 'Model', lg: [['bulb', 'Mind Map']], cols: [[['grid', 'Whiteboard'], ['timeline', 'Timeline']]] },
        ],
    },
    {
        id: 'track', label: 'Track',
        groups: [
            { name: 'RAID', launcher: true, lg: [['raid-log', 'RAID Log']], cols: [[['flag', 'Risk'], ['warn', 'Issue']], [['doc', 'Assumption'], ['link', 'Dependency']]] },
            { name: 'Progress', lg: [['highlights', 'Highlights']], cols: [[['check', 'Actions'], ['search', 'Lookahead']], [['chart', 'Analysis'], ['bulb', 'Lessons']]] },
            { name: 'Cost', launcher: true, lg: [['money', 'Budget']], cols: [[['chart', 'EVM'], ['refresh', 'Forecast']]] },
            { name: 'Benefits', lg: [['target', 'Benefits']], cols: [[['chart', 'Realisation'], ['doc', 'Profiles']]] },
        ],
    },
    {
        id: 'resources', label: 'Resources',
        groups: [
            { name: 'People', launcher: true, lg: [['resources', 'Resources'], ['people', 'Stakeholders']], cols: [[['money', 'Rates'], ['calendar', 'Calendars']], [['pin', 'Skills'], ['clock', 'Availability']]] },
            { name: 'Effort', launcher: true, lg: [['clock', 'Timesheet']], cols: [[['chart', 'Workload'], ['refresh', 'Level']], [['warn', 'Overallocation'], ['grid', 'Resource Sheet']]] },
            { name: 'Comms', lg: [['doc', 'Comms Plan']], cols: [[['people', 'Influence'], ['print', 'Print']]] },
        ],
    },
    {
        id: 'report', label: 'Report',
        groups: [
            { name: 'Reports', launcher: true, lg: [['project-report', 'Project Report'], ['highlights', 'Highlights']], cols: [[['chart', 'Analysis'], ['milestones', 'Milestones']], [['money', 'Budget'], ['target', 'Benefits']]] },
            { name: 'Share', lg: [['download', 'Export']], cols: [[['print', 'Print'], ['doc', 'PDF']], [['grid', 'Excel'], ['board', 'PowerPoint']]] },
            { name: 'Data', lg: [['upload', 'Import']], cols: [[['save', 'Save'], ['refresh', 'Sync']]] },
        ],
    },
    {
        id: 'view', label: 'View',
        groups: [
            { name: 'Layout', lg: [['grid', 'Split View']], cols: [[['task-list', 'Editor'], ['doc', 'Preview']]] },
            { name: 'Show', launcher: true, lg: [['filter', 'Filter']], cols: [[['sort', 'Sort'], ['pin', 'Group']], [['milestones', 'Milestones'], ['link', 'Deps']]] },
            // "System Theme" (#909 ribbon-parity follow-up) replicates the old
            // top nav's 3-way Light/Dark/System theme menu's third option --
            // see setThemeChoice('system') in theme.js. "AI Settings" opens the
            // same modal the old nav's AI button opened when unconfigured;
            // grouped here with the app's other configuration/meta controls
            // (Settings, theme, zoom) rather than with any one project view.
            { name: 'Window', lg: [['settings', 'Settings']], cols: [[['refresh', 'Dark Mode'], ['monitor', 'System Theme']], [['search', 'Zoom', 'caret'], ['robot', 'AI Settings']]] },
            // "Help" (#909 ribbon-parity follow-up): the old top nav's Tools >
            // Syntax Guide item and its standalone Docs link, which had no
            // ribbon equivalent before this. Docs is a plain external link, not
            // a command -- see the 'link:' button-flag convention below.
            { name: 'Help', cols: [[['doc', 'Syntax Guide'], ['external', 'Docs', 'link:https://docs.noodleplanner.com']]] },
        ],
    },
];

/**
 * Portfolio scope (#936). Surfaces the already-built portfolio-level
 * views (portfolio.js's `switchPortfolioView()` sub-nav: Projects, Status,
 * Team Allocation, Timeline, Actions, Risks, Look-Ahead, Dependencies,
 * Benefits, Lessons) plus the two portfolio-wide dialogs (New Project,
 * Import Project) and the portfolio report export, all of which already
 * exist in portfolio*.js -- nothing here is new functionality, only new
 * ribbon entry points onto it.
 */
export const PORTFOLIO_TABS = [
    {
        id: 'pf-home', label: 'Home',
        groups: [
            // Status (the portfolio roll-up -- every project's RAG/completion
            // in one table) leads as the first, large icon on Home, the same
            // "Dashboard first" placement fix #909 made for project scope
            // (issue #933: "Home should lead with the portfolio roll-up as
            // its front door").
            { name: 'Portfolio', launcher: true, lg: [['project-report', 'Status'], ['portfolio', 'Projects']], cols: [[['add', 'New Project'], ['upload', 'Import Project']]] },
            { name: 'Report', lg: [['download', 'Export Report']], cols: [[['task-list', 'Actions']]] },
        ],
    },
    {
        id: 'pf-plan', label: 'Plan',
        groups: [
            { name: 'Schedule', launcher: true, lg: [['timeline', 'Timeline']], cols: [[['search', 'Look-Ahead'], ['link', 'Dependencies']]] },
            { name: 'Capacity', lg: [['resources', 'Team Allocation']], cols: [[['refresh', 'Level Team']]] },
        ],
    },
    {
        id: 'pf-track', label: 'Track',
        groups: [
            { name: 'RAID & Benefits', launcher: true, lg: [['flag', 'Risks']], cols: [[['target', 'Benefits'], ['bulb', 'Lessons']]] },
        ],
    },
];

/**
 * Programme scope (#936). Programmes -- a set of projects with a master
 * Gantt, cross-project dependencies, escalations and shared capacity --
 * are a detailed but not-yet-built epic (#731) with a competing,
 * also-not-built proposal (#910). Building this scope out today would mean
 * either faking functionality that doesn't exist, or silently reusing
 * Project scope's tabs under a "Programme" label that promises something
 * different (the scope pill's own blurb: "A set of projects: master Gantt,
 * cross-project dependencies, escalations, shared capacity") -- both are
 * more misleading than admitting the gap. So this is a deliberately small,
 * honestly-labelled placeholder: every button here is a reviewed stub (see
 * DELIBERATE_STUBS in tests/test_ribbon_action_coverage.mjs) that shows a
 * "not available yet" toast, same as any other not-yet-built button
 * elsewhere in the ribbon -- nothing here pretends to work.
 */
export const PROGRAMME_TABS = [
    {
        id: 'programme-home', label: 'Home',
        groups: [
            { name: 'Programme', lg: [['board', 'Programme View']], cols: [[['link', 'Cross-Project Links'], ['warn', 'Escalations']], [['resources', 'Shared Capacity']]] },
        ],
    },
];

/** Which tab set renders for a given scope id (the ribbon-scope-btn value). */
export function tabsForScope(scopeId) {
    if (scopeId === 'portfolio') return PORTFOLIO_TABS;
    if (scopeId === 'programme') return PROGRAMME_TABS;
    return TABS;
}

/**
 * The ribbon scope a given NavigationController view id belongs at --
 * issue #908/#932's "the ribbon below is level-aware: its tabs are
 * contextual to wherever you've landed". This is the single source of
 * truth ribbon.js's refreshRibbon() derives ribbonState.scope from on
 * every render, rather than relying only on call sites remembering to
 * call setRibbonScope() -- a path that opened a project without going
 * through one of those call sites (e.g. straight from the portfolio
 * projects table) used to leave the ribbon showing the wrong altitude's
 * tabs until something else happened to change scope. Mirrors
 * NavigationController's own contextOf() in script.js, which the same
 * issue's transition-fade logic keys off of.
 */
export function scopeForView(view) {
    if (view === 'portfolio' || view === 'backstage') return 'portfolio';
    if (view === 'programme') return 'programme';
    return 'project';
}

export const CONTEXTUAL_TABS = [
    {
        id: 'raid', label: 'RAID Log', icon: 'raid-log', accent: '#c21d1d', accentToken: '--np-red', tint: '#faeaea', onAccent: '#ffffff',
        trigger: 'RAID Log view open',
        groups: [
            { name: 'Entries', launcher: true, lg: [['flag', 'New Risk'], ['warn', 'New Issue']], cols: [[['doc', 'Assumption'], ['link', 'Dependency']], [['target', 'Escalate'], ['check', 'Close']]] },
            { name: 'Score', cols: [[['chart', 'Probability'], ['chart', 'Impact']], [['grid', 'Heat Map'], ['flag', 'RAG']]] },
            { name: 'Data', cols: [[['filter', 'Filter'], ['sort', 'Sort']], [['upload', 'Import'], ['download', 'Export']]] },
        ],
    },
    {
        id: 'lessons', label: 'Lessons Learned', icon: 'bulb', accent: '#ffd641', accentToken: '--np-yellow', tint: '#fff8e0', onAccent: '#02384d',
        trigger: 'Lessons view open',
        groups: [
            { name: 'Lessons', launcher: true, lg: [['bulb', 'New Lesson'], ['check', 'Review']], cols: [[['sort', 'Categorise'], ['pin', 'Tag']], [['link', 'Link to Risk'], ['people', 'Owner']]] },
            { name: 'Share', cols: [[['upload', 'Publish'], ['download', 'Export']], [['print', 'Print'], ['project-report', 'Report']]] },
        ],
    },
    {
        id: 'gantt', label: 'Gantt Tools', icon: 'gantt-chart', accent: '#108bb9', accentToken: '--np-blue', tint: '#e6f3f9', onAccent: '#ffffff',
        trigger: 'Gantt view open',
        groups: [
            { name: 'Schedule', launcher: true, lg: [['link', 'Link'], ['unlink', 'Unlink']], cols: [[['indent', 'Indent'], ['outdent', 'Outdent']], [['target', 'Critical Path'], ['clock', 'Baseline']]] },
            { name: 'Zoom', cols: [[['calendar', 'Day/Week/Month', 'caret'], ['search', 'Fit']], [['clock', 'Today'], ['target', 'Go to Task']]] },
            { name: 'Show', cols: [[['timeline', 'Slack'], ['milestones', 'Milestones']], [['link', 'Deps'], ['chart', 'Progress']]] },
        ],
    },
    {
        id: 'kanban', label: 'Board Tools', icon: 'board', accent: '#1c9e41', accentToken: '--np-green', tint: '#e8f7ec', onAccent: '#ffffff',
        trigger: 'Kanban board open',
        groups: [
            { name: 'Cards', launcher: true, lg: [['add', 'Add Card']], cols: [[['doc', 'Edit'], ['delete', 'Delete']], [['people', 'Assign'], ['pin', 'Label']]] },
            { name: 'Columns', cols: [[['add', 'Add Column'], ['doc', 'Rename']], [['sort', 'Group by', 'caret'], ['target', 'WIP Limit']]] },
            { name: 'View', cols: [[['board', 'Phase'], ['resources', 'Resource']], [['chart', 'Progress'], ['pin', 'Label']]] },
        ],
    },
    {
        id: 'resources', label: 'Resource Tools', icon: 'resources', accent: '#ff7b01', accentToken: '--np-orange', tint: '#fff1e2', onAccent: '#3a1c00',
        trigger: 'Resources, Timesheet, Workload or Resource Sheet open',
        groups: [
            { name: 'People', launcher: true, lg: [['people', 'Add Resource']], cols: [[['money', 'Rates'], ['calendar', 'Calendar']], [['pin', 'Skills'], ['clock', 'Availability']]] },
            { name: 'Effort', cols: [[['clock', 'Timesheet'], ['chart', 'Workload']], [['refresh', 'Level'], ['warn', 'Overallocation']]] },
        ],
    },
    {
        id: 'stakeholders', label: 'Stakeholders', icon: 'people', accent: '#02384d', accentToken: '--np-dark-blue', tint: '#e4edf1', onAccent: '#ffffff',
        trigger: 'Stakeholder register open',
        groups: [
            { name: 'Register', launcher: true, lg: [['people', 'Add Stakeholder']], cols: [[['chart', 'Influence'], ['target', 'Interest']], [['doc', 'Comms Plan'], ['people', 'Owner']]] },
            { name: 'Map', cols: [[['grid', 'Grid'], ['chart', 'Heat']], [['download', 'Export'], ['print', 'Print']]] },
        ],
    },
    {
        id: 'whiteboard', label: 'Whiteboard', icon: 'grid', accent: '#1c9e41', accentToken: '--np-green', tint: '#eaf6ee', onAccent: '#ffffff',
        trigger: 'Whiteboard or Mind Map open',
        groups: [
            { name: 'Draw', launcher: true, lg: [['doc', 'Note'], ['grid', 'Shape']], cols: [[['link', 'Connector'], ['doc', 'Text']], [['pin', 'Colour'], ['delete', 'Delete']]] },
            { name: 'Arrange', cols: [[['grid', 'Align'], ['sort', 'Distribute']], [['link', 'Group'], ['pin', 'Lock']]] },
            { name: 'Convert', cols: [[['task-list', 'To Tasks'], ['board', 'To PBS']]] },
        ],
    },
    {
        id: 'portfolio', label: 'Portfolio Tools', icon: 'chart', accent: '#02384d', accentToken: '--np-dark-blue', tint: '#e4edf1', onAccent: '#ffffff',
        trigger: 'Portfolio dashboard open',
        groups: [
            { name: 'Portfolio', launcher: true, lg: [['board', 'Add Programme']], cols: [[['add', 'Add Project'], ['chart', 'Weighting']], [['refresh', 'Rebaseline'], ['save', 'Snapshot']]] },
            { name: 'Analyse', cols: [[['grid', 'Heat Map'], ['link', 'Dependencies']], [['resources', 'Capacity'], ['target', 'Benefits']]] },
        ],
    },
];

/** view id (NavigationController) -> contextual tab id. */
export const CONTEXT_FOR_VIEW = {
    raid: 'raid',
    lessons: 'lessons',
    gantt: 'gantt',
    kanban: 'kanban',
    resources: 'resources',
    timesheet: 'resources',
    'user-workload': 'resources',
    'resource-sheet': 'resources',
    stakeholders: 'stakeholders',
    whiteboard: 'whiteboard',
    mindmap: 'whiteboard',
    portfolio: 'portfolio',
};

export function contextualTabFor(view) {
    const id = CONTEXT_FOR_VIEW[view];
    return id ? CONTEXTUAL_TABS.find((c) => c.id === id) || null : null;
}
