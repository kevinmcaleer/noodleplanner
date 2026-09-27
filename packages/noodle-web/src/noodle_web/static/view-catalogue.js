/**
 * view-catalogue.js -- what each view is called, and how it fares on a phone
 * (#1380, #1387, epic #1376).
 *
 * The phone layout replaces the ribbon with a navigation drawer and a strip
 * of view chips, and both need a list of every view with a name to show. The
 * *list* is not written here. Which views exist, and which group each is in,
 * is state.js's PLAN_VIEWS / TRACKING_VIEWS / RESOURCES_VIEWS -- the same
 * constants the router, docs/design/ui-structure.json and the old subnav were
 * built from -- plus portfolio.js's sub-views. This file adds only what those
 * constants cannot say: a label, an icon, and the view's phone tier.
 * tests/test_view_catalogue.mjs fails when a view is added to the router
 * without an entry here, and tests/ui/test_phone_shell.py checks the drawer
 * lists exactly the router's views.
 *
 * ## Tiers (#1387)
 *
 *   phone-first     designed for 390px; the drawer's chips strip.
 *   phone-readable  usable at 390px (stacked tables, lists).
 *   larger-screen   a canvas or a wide chart by nature. Still reachable, but
 *                   the drawer marks it and the view shows a dismissible
 *                   "Best on a larger screen" banner pointing at `nearest`,
 *                   the closest phone-first view.
 *
 * A classic script exposing `NoodleViewCatalogue`, like layout-mode.js,
 * loaded after state.js. tests/test_view_catalogue.mjs runs it in plain node
 * with state.js loaded first, so the two are checked against each other.
 */
(function (root) {
    'use strict';

    const VIEWS = {
        // Plan
        'project-report': { label: 'Dashboard', icon: 'project-report', tier: 'phone-first' },
        tasks: { label: 'Tasks', icon: 'task-list', tier: 'phone-first' },
        notepad: { label: 'Outline', icon: 'task-list', tier: 'phone-first' },
        gantt: { label: 'Gantt', icon: 'gantt-chart', tier: 'larger-screen', nearest: 'tasks' },
        kanban: { label: 'Board', icon: 'board', tier: 'phone-first' },
        calendar: { label: 'Calendar', icon: 'calendar', tier: 'phone-first' },
        milestones: { label: 'Milestones', icon: 'milestones', tier: 'phone-readable' },
        timeline: { label: 'Timeline', icon: 'timeline', tier: 'larger-screen', nearest: 'milestones' },
        mindmap: { label: 'Mind Map', icon: 'mind-map', tier: 'larger-screen', nearest: 'notepad' },
        whiteboard: { label: 'Whiteboard', icon: 'whiteboard', tier: 'larger-screen', nearest: 'whiteboard-cards' },
        pbs: { label: 'PBS', icon: 'pbs', tier: 'larger-screen', nearest: 'tasks' },
        deliverables: { label: 'Deliverables', icon: 'deliverables', tier: 'larger-screen', nearest: 'tasks' },
        'product-flow': { label: 'Product Flow', icon: 'pbs', tier: 'larger-screen', nearest: 'tasks' },
        benefits: { label: 'Benefits', icon: 'benefits', tier: 'phone-readable' },
        guide: { label: 'Syntax Guide', icon: 'milestones', tier: 'larger-screen', nearest: 'notepad' },
        assignments: { label: 'By Assignment', icon: 'people', tier: 'phone-readable' },
        slippage: { label: 'Slippage', icon: 'flag', tier: 'larger-screen', nearest: 'milestones' },
        // Tracking
        raid: { label: 'RAID Log', icon: 'raid-log', tier: 'phone-first' },
        actions: { label: 'Actions', icon: 'task-list', tier: 'phone-readable' },
        highlights: { label: 'Highlights', icon: 'highlights', tier: 'phone-readable' },
        lookahead: { label: 'Look-Ahead', icon: 'timeline', tier: 'phone-readable' },
        escalations: { label: 'Escalations', icon: 'warn', tier: 'phone-readable' },
        analysis: { label: 'Analysis', icon: 'milestones', tier: 'larger-screen', nearest: 'project-report' },
        budget: { label: 'Budget', icon: 'milestones', tier: 'phone-readable' },
        evm: { label: 'EVM', icon: 'evm', tier: 'larger-screen', nearest: 'project-report' },
        forecast: { label: 'Forecast', icon: 'chart', tier: 'larger-screen', nearest: 'project-report' },
        comms: { label: 'Comms Plan', icon: 'stakeholders', tier: 'phone-readable' },
        lessons: { label: 'Lessons Learned', icon: 'highlights', tier: 'phone-readable' },
        // Resources
        resources: { label: 'Resource Table', icon: 'resources', tier: 'phone-readable' },
        timesheet: { label: 'Timesheet', icon: 'calendar', tier: 'larger-screen', nearest: 'resources' },
        'user-workload': { label: 'Workload', icon: 'gantt-chart', tier: 'larger-screen', nearest: 'resources' },
        'resource-sheet': { label: 'Resource Sheet', icon: 'task-list', tier: 'larger-screen', nearest: 'resources' },
        stakeholders: { label: 'Stakeholders', icon: 'stakeholders', tier: 'phone-readable' },
    };

    // portfolio.js's sub-views, inside the one `portfolio` router view.
    const PORTFOLIO_VIEWS = [
        { id: 'projects', label: 'Projects', icon: 'chart', tier: 'phone-readable' },
        { id: 'status', label: 'Status', icon: 'project-report', tier: 'phone-readable' },
        { id: 'actions', label: 'Actions', icon: 'task-list', tier: 'phone-readable' },
        { id: 'risks', label: 'Risks', icon: 'raid-log', tier: 'phone-readable' },
        { id: 'lookahead', label: 'Look-Ahead', icon: 'timeline', tier: 'phone-readable' },
        { id: 'timeline', label: 'Timeline', icon: 'timeline', tier: 'larger-screen', nearest: 'portfolio:status' },
        { id: 'resources', label: 'Team Allocation', icon: 'resources', tier: 'larger-screen', nearest: 'portfolio:status' },
        { id: 'dependencies', label: 'Dependencies', icon: 'link', tier: 'larger-screen', nearest: 'portfolio:status' },
        { id: 'benefits', label: 'Benefits', icon: 'benefits', tier: 'larger-screen', nearest: 'portfolio:status' },
        { id: 'lessons', label: 'Lessons', icon: 'highlights', tier: 'larger-screen', nearest: 'portfolio:status' },
    ];

    // The chips under the phone app bar, in this order.
    const PHONE_FIRST = ['project-report', 'tasks', 'notepad', 'kanban', 'calendar', 'raid'];

    // Not views a person picks: shells and the router's own plumbing.
    const SHELLS = ['editor', 'upload', 'search', 'backstage', 'portfolio', 'programme', 'markdown'];

    // state.js's constants are script-scope `const`s: another classic script
    // can name them (as here), but they are not properties of `window`.
    function routerGroups() {
        /* global PLAN_VIEWS, TRACKING_VIEWS, RESOURCES_VIEWS */
        return {
            PLAN_VIEWS: typeof PLAN_VIEWS !== 'undefined' ? PLAN_VIEWS : [],
            TRACKING_VIEWS: typeof TRACKING_VIEWS !== 'undefined' ? TRACKING_VIEWS : [],
            RESOURCES_VIEWS: typeof RESOURCES_VIEWS !== 'undefined' ? RESOURCES_VIEWS : [],
        };
    }

    function entry(id) {
        const meta = VIEWS[id];
        return meta ? Object.assign({ id: id, scope: 'project' }, meta) : null;
    }

    /** The project views, grouped as the router groups them. */
    function groups() {
        const router = routerGroups();
        const tracking = router.TRACKING_VIEWS.slice();
        // Lessons Learned is a router view on the Track ribbon tab, but
        // TRACKING_VIEWS predates it (ui-structure.json reports it as
        // "wired in nav but not grouped"). It belongs with the other logs.
        if (tracking.indexOf('lessons') === -1) tracking.push('lessons');
        return [
            { id: 'plan', label: 'Plan', views: router.PLAN_VIEWS },
            { id: 'tracking', label: 'Tracking', views: tracking },
            { id: 'resources', label: 'Resources', views: router.RESOURCES_VIEWS },
        ].map(function (group) {
            const seen = {};
            return {
                id: group.id,
                label: group.label,
                views: group.views.filter(function (id) {
                    if (seen[id]) return false;
                    seen[id] = true;
                    return true;
                }).map(function (id) {
                    return entry(id) || { id: id, label: id, icon: 'task-list', tier: 'phone-readable', scope: 'project', unknown: true };
                }),
            };
        });
    }

    function portfolioViews() {
        return PORTFOLIO_VIEWS.map(function (view) {
            return Object.assign({ scope: 'portfolio' }, view, { key: 'portfolio:' + view.id });
        });
    }

    function phoneFirst() {
        return PHONE_FIRST.map(entry).filter(Boolean);
    }

    /** A view's entry by router id, or by `portfolio:<sub-view>`. */
    function get(id) {
        if (typeof id !== 'string') return null;
        if (id.indexOf('portfolio:') === 0) {
            const sub = id.slice('portfolio:'.length);
            return portfolioViews().find(function (v) { return v.id === sub; }) || null;
        }
        return entry(id);
    }

    function label(id) {
        const view = get(id);
        return view ? view.label : null;
    }

    const api = {
        VIEWS: VIEWS,
        PORTFOLIO_VIEWS: PORTFOLIO_VIEWS,
        PHONE_FIRST: PHONE_FIRST.slice(),
        SHELLS: SHELLS.slice(),
        groups: groups,
        portfolioViews: portfolioViews,
        phoneFirst: phoneFirst,
        get: get,
        label: label,
    };

    root.NoodleViewCatalogue = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
