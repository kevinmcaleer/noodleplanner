/**
 * plan-reports.js -- the Tasks by Assignment and Slippage reports (#776).
 *
 * Pure: tasks in, report out. No DOM, no globals, so it is unit-tested
 * directly (tests/test_plan_reports.mjs) and shared by the two report views
 * (views-reports.js) and the Analysis view's baseline insight
 * (getBaselineInsights in script.js), which used to do its own, calendar-day
 * version of the slippage sums.
 *
 * Tasks are shaped as /api/parse (and the browser engine) return them:
 * ISO `start` and exclusive `finish`, `duration_days` in working days,
 * `resources` as a comma list of display names, `percent`, `is_summary`,
 * `level`, `critical`. Baseline items are `{ name, start, finish, duration }`
 * as the ---baseline--- section stores them.
 *
 * Working days: variance is counted in working days, not calendar days. The
 * caller passes `isWorkingDay(dayNumber)` built from the plan's calendar
 * (engine/local-parse.js projectWorkingDay); without one, Monday to Friday.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.PlanReports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DAY_MS = 86400000;

    function dayOf(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return match ? Math.round(Date.UTC(+match[1], +match[2] - 1, +match[3]) / DAY_MS) : null;
    }

    function isoOf(day) {
        return new Date(day * DAY_MS).toISOString().slice(0, 10);
    }

    /** Monday-Friday: day 0 (1970-01-01) was a Thursday. */
    function weekday(day) {
        return ((day + 3) % 7 + 7) % 7 < 5;
    }

    /**
     * Signed working days from `a` to `b` (day numbers): positive when `b` is
     * later. Counts the working days in [earlier, later), so moving a finish
     * over a weekend adds nothing and moving it one working day adds one.
     */
    function workingDaysBetween(a, b, isWorkingDay = weekday) {
        if (a === null || b === null || a === b) return 0;
        const [from, to, sign] = a < b ? [a, b, 1] : [b, a, -1];
        let count = 0;
        for (let d = from; d < to; d++) if (isWorkingDay(d)) count++;
        return sign * count;
    }

    function percentOf(task) {
        const value = parseFloat(String(task.percent == null ? '' : task.percent).replace('%', ''));
        return Number.isFinite(value) ? value : 0;
    }

    /** The last day of work (finish is exclusive; a milestone's is its day). */
    function lastDay(task) {
        const finish = dayOf(task.finish);
        if (finish === null) return null;
        return task.duration_days === 0 ? finish : finish - 1;
    }

    // ----- Tasks by assignment ------------------------------------------------

    /** A resource entry's display name and share: "Alex Chen[50%]" -> 0.5. */
    function parseResource(entry) {
        const text = String(entry || '').trim().replace(/^@/, '');
        const match = /^(.*?)\s*\[(\d+(?:\.\d+)?)%\]$/.exec(text);
        return match ? { name: match[1].trim(), share: +match[2] / 100 } : { name: text, share: 1 };
    }

    /** The key two spellings of one person share: case and spacing ignored. */
    function resourceKey(name) {
        return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    /**
     * Group every (non-summary) task under each person it is assigned to.
     * A task with several people appears under each, marked shared; tasks
     * with nobody are the Unassigned group, which always comes first.
     *
     * options: { today (ISO), resourceMap: { shortname: full name },
     *            roles: { key: role } }. The browser engine reports
     *            resources by shortname and the server by full name; both
     *            are mapped to the full name, so `@alex` and "Alex Chen" are
     *            one person.
     * Returns [{ key, name, role, unassigned, tasks: [row], totals }], where
     * row = { task, share, shared, sharedWith, status, overdue } and
     * totals = { tasks, open, complete, workDays, nextDue, overdue }.
     */
    function tasksByAssignment(tasks, options = {}) {
        const today = dayOf(options.today) ?? dayOf(new Date().toISOString());
        const roles = options.roles || {};
        const names = {};
        Object.entries(options.resourceMap || {}).forEach(([short, full]) => {
            names[resourceKey(short)] = full;
        });
        const display = (name) => names[resourceKey(name)] || name;
        const groups = new Map();
        const group = (key, name, unassigned = false) => {
            if (!groups.has(key)) {
                groups.set(key, { key, name, role: roles[key] || '', unassigned, tasks: [] });
            }
            return groups.get(key);
        };

        for (const task of tasks || []) {
            if (task.is_summary) continue;
            const people = String(task.resources || '').split(',').map(parseResource)
                .filter(r => r.name && r.name !== '-')
                .map(r => ({ ...r, name: display(r.name) }));
            const done = percentOf(task) >= 100;
            const last = lastDay(task);
            const overdue = !done && last !== null && last < today;
            const status = done ? 'complete' : overdue ? 'overdue' : 'open';
            if (people.length === 0) {
                group('', 'Unassigned', true).tasks.push({ task, share: 1, shared: false, sharedWith: [], status, overdue });
                continue;
            }
            // one person listed twice on a task is still one assignment
            const unique = [];
            for (const person of people) {
                if (!unique.some(p => resourceKey(p.name) === resourceKey(person.name))) unique.push(person);
            }
            for (const person of unique) {
                const key = resourceKey(person.name);
                const g = group(key, person.name);
                g.tasks.push({
                    task,
                    share: person.share,
                    shared: unique.length > 1,
                    sharedWith: unique.filter(p => p !== person).map(p => p.name),
                    inherited: Boolean(task.inherited_resource),
                    status,
                    overdue,
                });
            }
        }

        const result = [...groups.values()].map(g => ({ ...g, totals: totalsFor(g.tasks, today) }));
        result.sort((a, b) => (b.unassigned - a.unassigned) || a.name.localeCompare(b.name));
        return result;
    }

    function totalsFor(rows, today) {
        let open = 0, complete = 0, overdue = 0, workDays = 0, nextDue = null;
        for (const row of rows) {
            if (row.status === 'complete') complete++;
            else open++;
            if (row.overdue) overdue++;
            workDays += (row.task.duration_days || 0) * row.share;
            const last = lastDay(row.task);
            if (row.status !== 'complete' && last !== null && last >= today && (nextDue === null || last < nextDue)) {
                nextDue = last;
            }
        }
        return {
            tasks: rows.length,
            open,
            complete,
            overdue,
            workDays: Math.round(workDays * 10) / 10,
            nextDue: nextDue === null ? null : isoOf(nextDue),
        };
    }

    /**
     * Groups after the view's filters: person (key), phase, status
     * ('open' | 'complete' | 'overdue'), and a date range the task must
     * overlap. Totals are recomputed over what is left; empty groups drop
     * out, except that Unassigned stays visible when it has tasks at all.
     */
    function filterAssignments(groups, filter = {}, today) {
        const from = dayOf(filter.from);
        const to = dayOf(filter.to);
        const todayDay = dayOf(today) ?? dayOf(new Date().toISOString());
        return groups
            .filter(g => !filter.person || g.key === filter.person)
            .map(g => {
                const rows = g.tasks.filter(row => {
                    const t = row.task;
                    if (filter.phase && (t.phase || '') !== filter.phase) return false;
                    if (filter.status && row.status !== filter.status &&
                        !(filter.status === 'open' && row.status === 'overdue')) return false;
                    const start = dayOf(t.start), last = lastDay(t);
                    if (from !== null && last !== null && last < from) return false;
                    if (to !== null && start !== null && start > to) return false;
                    return true;
                });
                return { ...g, tasks: rows, totals: totalsFor(rows, todayDay) };
            })
            .filter(g => g.tasks.length);
    }

    const ASSIGNMENT_SORTS = {
        name: (a, b) => a.name.localeCompare(b.name),
        tasks: (a, b) => b.totals.tasks - a.totals.tasks || a.name.localeCompare(b.name),
        overdue: (a, b) => b.totals.overdue - a.totals.overdue || a.name.localeCompare(b.name),
        work: (a, b) => b.totals.workDays - a.totals.workDays || a.name.localeCompare(b.name),
        nextDue: (a, b) => (a.totals.nextDue || '9999').localeCompare(b.totals.nextDue || '9999') || a.name.localeCompare(b.name),
    };

    /** Sort groups; Unassigned stays first whatever the sort. */
    function sortAssignments(groups, by = 'name') {
        const compare = ASSIGNMENT_SORTS[by] || ASSIGNMENT_SORTS.name;
        return [...groups].sort((a, b) => (b.unassigned - a.unassigned) || compare(a, b));
    }

    // ----- Slippage -------------------------------------------------------------

    /**
     * Compare the current schedule with a baseline.
     *
     * Tasks are matched to baseline entries by name; where a name occurs more
     * than once, the n-th occurrence matches the n-th. Variances are signed
     * working days (positive = later than baselined).
     *
     * Returns {
     *   rows:    [{ name, phase, level, summary, critical, baselineStart,
     *               baselineFinish, start, finish, startVariance,
     *               finishVariance, status }]   -- matched tasks, summaries
     *               included, sorted by finish variance, largest slip first
     *   added:   tasks with no baseline entry (leaves only)
     *   removed: baseline entries with no current task
     *   phases:  summary rows, each with slippedTasks and worstSlip
     *   critical: leaf rows on the critical path that have slipped
     *   project: { baselineFinish, finish, variance, status }
     *   counts:  { slipped, onTrack, pulledForward, added, removed }
     * }
     */
    function slippageReport(tasks, baselineItems, options = {}) {
        const isWorkingDay = options.isWorkingDay || weekday;
        const baseline = (baselineItems || []).filter(b => b && b.name);
        const byName = new Map();
        baseline.forEach(item => {
            if (!byName.has(item.name)) byName.set(item.name, []);
            byName.get(item.name).push(item);
        });
        const used = new Map();
        const take = (name) => {
            const list = byName.get(name);
            if (!list) return null;
            const index = used.get(name) || 0;
            used.set(name, index + 1);
            return list[index] || null;
        };

        const rows = [];
        const added = [];
        (tasks || []).forEach(task => {
            if (!task.name) return;
            const item = take(task.name);
            if (!item) {
                if (!task.is_summary) added.push(task);
                return;
            }
            const baselineStart = dayOf(item.start);
            const baselineFinish = dayOf(item.finish);
            const start = dayOf(task.start);
            const finish = dayOf(task.finish);
            const finishVariance = workingDaysBetween(baselineFinish, finish, isWorkingDay);
            rows.push({
                task,
                name: task.name,
                phase: task.phase || '',
                level: task.level || 0,
                summary: Boolean(task.is_summary),
                critical: Boolean(task.critical) && !task.is_summary,
                baselineStart: item.start || '',
                baselineFinish: item.finish || '',
                start: task.start || '',
                finish: task.finish || '',
                startVariance: workingDaysBetween(baselineStart, start, isWorkingDay),
                finishVariance,
                status: finishVariance > 0 ? 'slipped' : finishVariance < 0 ? 'pulled-forward' : 'on-track',
            });
        });
        const removed = [];
        byName.forEach((list, name) => {
            list.slice(used.get(name) || 0).forEach(item => removed.push(item));
        });

        rows.sort((a, b) => b.finishVariance - a.finishVariance || a.name.localeCompare(b.name));
        const leaves = rows.filter(r => !r.summary);

        // Phase roll-up: each summary row, with the slips beneath it
        const order = new Map((tasks || []).map((t, i) => [t, i]));
        const phases = rows.filter(r => r.summary).map(phase => {
            const at = order.get(phase.task);
            const under = [];
            for (let i = at + 1; i < tasks.length && (tasks[i].level || 0) > phase.level; i++) {
                if (!tasks[i].is_summary) under.push(tasks[i]);
            }
            const slips = leaves.filter(r => under.includes(r.task) && r.finishVariance > 0);
            return {
                ...phase,
                slippedTasks: slips.length,
                worstSlip: slips.reduce((m, r) => Math.max(m, r.finishVariance), 0),
            };
        }).sort((a, b) => (order.get(a.task) ?? 0) - (order.get(b.task) ?? 0));

        const maxDay = (list, get) => list.reduce((m, x) => {
            const d = dayOf(get(x));
            return d !== null && (m === null || d > m) ? d : m;
        }, null);
        const baselineEnd = maxDay(baseline, b => b.finish);
        const currentEnd = maxDay(tasks || [], t => t.finish);
        const projectVariance = workingDaysBetween(baselineEnd, currentEnd, isWorkingDay);

        return {
            rows,
            added,
            removed,
            phases,
            critical: leaves.filter(r => r.critical && r.finishVariance > 0),
            project: {
                baselineFinish: baselineEnd === null ? '' : isoOf(baselineEnd),
                finish: currentEnd === null ? '' : isoOf(currentEnd),
                variance: projectVariance,
                status: projectVariance > 0 ? 'slipped' : projectVariance < 0 ? 'pulled-forward' : 'on-track',
            },
            counts: {
                slipped: leaves.filter(r => r.status === 'slipped').length,
                onTrack: leaves.filter(r => r.status === 'on-track').length,
                pulledForward: leaves.filter(r => r.status === 'pulled-forward').length,
                added: added.length,
                removed: removed.length,
            },
        };
    }

    return {
        dayOf,
        isoOf,
        weekday,
        workingDaysBetween,
        parseResource,
        resourceKey,
        tasksByAssignment,
        filterAssignments,
        sortAssignments,
        slippageReport,
    };
});
