/**
 * table-catalogue.js -- the tables of the table views interface, and which
 * of the app's views belongs to each.
 *
 * The classic interface offers every view at once, on ribbon tabs. The table
 * views interface (table-shell.js, switched on by ui-mode.js) says instead
 * that a project is a handful of tables -- the plan, the RAID log, the
 * budget, the people -- and that Gantt, Board, Calendar and the rest are
 * *views* of one of them. This file is that grouping, and nothing else: the
 * views themselves are the router's, unchanged.
 *
 * A view's name inside its table can differ from its name in the classic
 * interface: under "Plan" the Tasks view is simply "Table", and under
 * "Resources" the Resource Table is "Table" too. Where no name is given here
 * the view catalogue's label is used.
 *
 * tests/test_table_catalogue.mjs checks that every view the router offers is
 * in exactly one table, or in EXCLUDED with a reason, so a view added to the
 * router cannot go missing from this interface.
 *
 * A classic script exposing `NoodleTableCatalogue`, loaded after
 * view-catalogue.js.
 */
(function (root) {
    'use strict';

    const TABLES = [
        {
            id: 'dashboard', label: 'Dashboard', icon: 'project-report', home: true,
            views: [
                { id: 'project-report', label: 'Dashboard' },
                { id: 'analysis', label: 'Analysis' },
            ],
        },
        {
            id: 'plan', label: 'Plan', icon: 'task-list',
            views: [
                { id: 'tasks', label: 'Table' },
                { id: 'gantt', label: 'Gantt' },
                { id: 'kanban', label: 'Board' },
                { id: 'calendar', label: 'Calendar' },
                { id: 'timeline', label: 'Timeline' },
                { id: 'milestones', label: 'Milestones' },
                { id: 'pbs', label: 'PBS' },
                { id: 'product-flow', label: 'Product Flow' },
                { id: 'mindmap', label: 'Mind Map' },
                { id: 'notepad', label: 'Outline' },
                { id: 'whiteboard', label: 'Whiteboard' },
                { id: 'deliverables', label: 'Deliverables' },
                { id: 'assignments', label: 'By Assignment' },
                { id: 'slippage', label: 'Slippage' },
            ],
        },
        {
            id: 'raid', label: 'RAID log', icon: 'raid-log',
            views: [
                { id: 'raid', label: 'Log' },
                { id: 'actions', label: 'Actions' },
                { id: 'escalations', label: 'Escalations' },
            ],
        },
        {
            id: 'highlights', label: 'Highlight reports', icon: 'highlights',
            views: [
                { id: 'highlights', label: 'Reports' },
                { id: 'lookahead', label: 'Look-Ahead' },
            ],
        },
        {
            id: 'lessons', label: 'Lessons learned', icon: 'bulb',
            views: [{ id: 'lessons', label: 'Log' }],
        },
        {
            id: 'budget', label: 'Budget', icon: 'money',
            views: [
                { id: 'budget', label: 'Budget' },
                { id: 'evm', label: 'EVM' },
                { id: 'forecast', label: 'Forecast' },
            ],
        },
        {
            id: 'benefits', label: 'Benefits', icon: 'benefits',
            views: [{ id: 'benefits', label: 'Benefits' }],
        },
        {
            id: 'resources', label: 'Resources', icon: 'resources',
            views: [
                { id: 'resources', label: 'Table' },
                { id: 'resource-sheet', label: 'Resource Sheet' },
                { id: 'user-workload', label: 'Workload' },
                { id: 'timesheet', label: 'Timesheet' },
            ],
        },
        {
            id: 'stakeholders', label: 'Stakeholders', icon: 'stakeholders',
            views: [
                { id: 'stakeholders', label: 'Stakeholders' },
                { id: 'comms', label: 'Comms Plan' },
            ],
        },
    ];

    // Router views that are deliberately not a view of any table.
    const EXCLUDED = {
        guide: 'Help, not project data: the sidebar links to it.',
    };

    function copy(table) {
        return {
            id: table.id,
            label: table.label,
            icon: table.icon,
            home: !!table.home,
            views: table.views.map(function (view) { return { id: view.id, label: view.label }; }),
        };
    }

    /** Every table, in sidebar order. */
    function tables() {
        return TABLES.map(copy);
    }

    function get(tableId) {
        const table = TABLES.find(function (t) { return t.id === tableId; });
        return table ? copy(table) : null;
    }

    /** The table a router view belongs to, or null (a shell, or excluded). */
    function tableForView(viewId) {
        const table = TABLES.find(function (t) {
            return t.views.some(function (view) { return view.id === viewId; });
        });
        return table ? copy(table) : null;
    }

    function viewsFor(tableId) {
        const table = get(tableId);
        return table ? table.views : [];
    }

    /** The view a table opens on when it has not been opened before. */
    function defaultView(tableId) {
        const views = viewsFor(tableId);
        return views.length ? views[0].id : null;
    }

    /** A view's name inside its table. */
    function viewLabel(viewId) {
        const table = tableForView(viewId);
        if (!table) return null;
        return table.views.find(function (view) { return view.id === viewId; }).label;
    }

    /** Every view id the tables cover, in order. */
    function allViews() {
        return TABLES.reduce(function (ids, table) {
            return ids.concat(table.views.map(function (view) { return view.id; }));
        }, []);
    }

    const api = {
        tables: tables,
        get: get,
        tableForView: tableForView,
        viewsFor: viewsFor,
        defaultView: defaultView,
        viewLabel: viewLabel,
        allViews: allViews,
        EXCLUDED: Object.assign({}, EXCLUDED),
    };

    root.NoodleTableCatalogue = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
