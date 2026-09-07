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
 */

export const SCOPES = [
    { id: 'project', label: 'Project', icon: 'project-report', blurb: 'One plan: tasks, schedule, RAID, resources and reports.' },
    { id: 'programme', label: 'Programme', icon: 'board', blurb: 'A set of projects: master Gantt, cross-project dependencies, escalations, shared capacity.' },
    { id: 'portfolio', label: 'Portfolio', icon: 'chart', blurb: 'Investment level: weighting, gates, benefits roll-up, heat maps, assurance.' },
];

export const FILE_MENU = [
    { icon: 'add', label: 'New plan', kbd: 'Cmd+N' },
    { icon: 'doc', label: 'Open…', kbd: 'Cmd+O' },
    { icon: 'save', label: 'Save', kbd: 'Cmd+S' },
    { icon: 'upload', label: 'Import from Excel / MS Project', kbd: '' },
    { icon: 'download', label: 'Export…', kbd: '' },
    { icon: 'grid', label: 'Templates', kbd: '' },
    { icon: 'print', label: 'Print', kbd: 'Cmd+P' },
    { icon: 'settings', label: 'Settings', kbd: '' },
];

export const QUICK_ACTIONS = [
    { icon: 'save', label: 'Save' },
    { icon: 'refresh', label: 'Undo' },
    { icon: 'add', label: 'New task' },
    { icon: 'print', label: 'Print' },
];

export const TABS = [
    {
        id: 'home', label: 'Home',
        groups: [
            { name: 'Plan', launcher: true, lg: [['task-list', 'New Task'], ['milestones', 'Milestone']], cols: [[['indent', 'Indent'], ['outdent', 'Outdent']], [['delete', 'Delete'], ['doc', 'Details']]] },
            { name: 'Views', lg: [['gantt-chart', 'Gantt'], ['board', 'Board']], cols: [[['timeline', 'Timeline'], ['calendar', 'Calendar']], [['task-list', 'Tasks'], ['grid', 'Sheet']]] },
            { name: 'Track', launcher: true, lg: [['raid-log', 'RAID']], cols: [[['check', 'Actions'], ['highlights', 'Highlights']], [['search', 'Lookahead'], ['warn', 'Escalations']]] },
            { name: 'Report', launcher: true, lg: [['project-report', 'Report']], cols: [[['download', 'Export', 'caret'], ['print', 'Print']], [['save', 'Save'], ['upload', 'Import', 'caret']]] },
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
            { name: 'Window', lg: [['settings', 'Settings']], cols: [[['refresh', 'Dark Mode'], ['search', 'Zoom', 'caret']]] },
        ],
    },
];

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
