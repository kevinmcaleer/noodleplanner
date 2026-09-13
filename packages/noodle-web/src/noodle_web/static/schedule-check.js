/**
 * schedule-check.js — "show what breaks" for the wizard's Scheduling stage (#1054).
 *
 * #1054's Scheduling stage is the one piece of stage content that issue
 * owns outright: "run the scheduler against the entered deadlines and
 * surface the conflicts legibly". When the wizard shell first landed that
 * could not be done -- there was no deadline field at all (#877, not
 * started then), so the stage honestly said so in its own copy instead of
 * faking it. #877 has since landed: a task line can carry a `D2026-09-10`
 * deadline marker (noodle_core/metadata.py's _DEADLINE, mirrored in
 * engine/tokeniser.js), the task form writes one (script.js's
 * #taskDeadline), and both schedulers already colour a slipped task red
 * (exporters.calculate_rag_status / engine/scheduler.js's
 * calculateRagStatus). What was still missing is the consolidated view:
 * one place that answers "what breaks?" rather than a red row the user has
 * to go hunting for.
 *
 * This module is that view. It deliberately does not re-run or re-implement
 * any scheduling: the scheduler has already run server-side by the time
 * /api/parse returns, and every field this reads -- start, finish,
 * deadline, percent, loop_warning, circular_dependencies -- is part of that
 * result (plan_service.py's task payload). Recomputing dates here would be
 * a second, divergent scheduler; reading its output is the whole point.
 *
 * analyse() is pure and DOM-free so it can be tested directly
 * (tests/test_schedule_check.mjs); render() is the thin DOM half, the same
 * split cards.js and estimating.js use.
 */
(function (root) {
    // Severity order: what breaks the plan outright first, what merely
    // can't be placed last. Drives the sort and the badge colour.
    const SEVERITY = { breach: 0, conflict: 1, gap: 2 };

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

    /** Today as a plain ISO date string, in the user's own timezone. */
    function todayIso(now) {
        const date = now ? new Date(now) : new Date();
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    /**
     * Whole days from `from` to `to`, both plain ISO dates. Computed in UTC
     * so a DST boundary between the two can't round the answer off by one.
     */
    function daysBetween(from, to) {
        if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) return null;
        const start = Date.parse(`${from}T00:00:00Z`);
        const end = Date.parse(`${to}T00:00:00Z`);
        if (Number.isNaN(start) || Number.isNaN(end)) return null;
        return Math.round((end - start) / 86400000);
    }

    function percentOf(task) {
        const raw = task.percent;
        if (raw === undefined || raw === null || raw === '') return 0;
        const value = parseInt(raw, 10);
        return Number.isNaN(value) ? 0 : value;
    }

    function isSummary(task) {
        return !!(task.is_summary || task.summary);
    }

    function pluralDays(count) {
        return `${count} ${Math.abs(count) === 1 ? 'day' : 'days'}`;
    }

    /**
     * One deadline issue for a task, or null. Mirrors the precedence in
     * calculate_rag_status (exporters.py) / calculateRagStatus
     * (engine/scheduler.js) exactly, so this report and the red rows the
     * user sees in the Tasks view can never disagree: a deadline already in
     * the past on an incomplete task is reported as passed; otherwise a
     * finish beyond the deadline is reported as missed.
     */
    function deadlineIssue(task, today) {
        const deadline = task.deadline || '';
        if (!ISO_DATE.test(deadline)) return null;
        if (percentOf(task) === 100) return null;

        if (deadline < today) {
            return {
                kind: 'deadline-passed',
                severity: 'breach',
                task: task.name || task.key || '',
                deadline,
                finish: task.finish || '',
                days: daysBetween(deadline, today),
                message: `Deadline passed ${pluralDays(daysBetween(deadline, today))} ago `
                    + `(${deadline}) and the task is ${percentOf(task)}% complete.`,
            };
        }

        const finish = task.finish || '';
        if (ISO_DATE.test(finish) && finish > deadline) {
            return {
                kind: 'deadline-missed',
                severity: 'breach',
                task: task.name || task.key || '',
                deadline,
                finish,
                days: daysBetween(deadline, finish),
                message: `Scheduled to finish ${finish}, `
                    + `${pluralDays(daysBetween(deadline, finish))} past its deadline of ${deadline}.`,
            };
        }
        return null;
    }

    /**
     * A dependency the scheduler itself refused to honour. The scheduler
     * records these per task as loop_warning / circular_dependencies
     * (scheduling_engine.py, via detect_hierarchy_dependency_conflicts) --
     * they are the other way a plan "breaks" under a deadline, because a
     * link that was dropped means the dates downstream of it are optimistic.
     */
    function dependencyIssue(task) {
        const warning = task.loop_warning || '';
        const circular = Array.isArray(task.circular_dependencies) ? task.circular_dependencies : [];
        if (!warning && !circular.length) return null;
        return {
            kind: 'dependency-conflict',
            severity: 'conflict',
            task: task.name || task.key || '',
            deadline: task.deadline || '',
            finish: task.finish || '',
            days: null,
            message: warning
                || `Circular dependency through ${circular.join(', ')} -- the link was not scheduled.`,
        };
    }

    /**
     * A task the scheduler could not place at all. Only reported for tasks
     * that carry a deadline or a dependency, because an undated task is
     * perfectly normal in a plan someone is still writing -- it only
     * "breaks" once something is riding on it.
     */
    function unscheduledIssue(task) {
        if (isSummary(task)) return null;
        if (ISO_DATE.test(task.start || '') && ISO_DATE.test(task.finish || '')) return null;
        const depends = Array.isArray(task.depends) ? task.depends : [];
        if (!task.deadline && !depends.length) return null;
        return {
            kind: 'unscheduled',
            severity: 'gap',
            task: task.name || task.key || '',
            deadline: task.deadline || '',
            finish: task.finish || '',
            days: null,
            message: task.deadline
                ? 'Has a deadline but no scheduled dates -- give it a duration so the scheduler can place it.'
                : 'Has dependencies but no scheduled dates -- give it a duration so the scheduler can place it.',
        };
    }

    /**
     * What breaks, given the scheduler's own output.
     *
     * @param {Array<object>} tasks  tasks as /api/parse returns them
     * @param {object} [options]     { now } to pin "today" in tests
     * @returns {{issues: Array<object>, counts: object, withDeadlines: number,
     *            taskCount: number, ok: boolean, summary: string, today: string}}
     */
    function analyse(tasks, options) {
        const opts = options || {};
        const today = opts.today || todayIso(opts.now);
        const list = Array.isArray(tasks) ? tasks : [];
        const issues = [];

        for (const task of list) {
            if (!task) continue;
            // Summary tasks carry rolled-up dates, so a deadline on one is
            // reported against the summary itself; dependency conflicts and
            // scheduling gaps belong to the leaf that owns them.
            const deadline = deadlineIssue(task, today);
            if (deadline) issues.push(deadline);
            const dependency = dependencyIssue(task);
            if (dependency) issues.push(dependency);
            const unscheduled = unscheduledIssue(task);
            if (unscheduled) issues.push(unscheduled);
        }

        issues.sort((a, b) => {
            const bySeverity = SEVERITY[a.severity] - SEVERITY[b.severity];
            if (bySeverity) return bySeverity;
            const byDays = (b.days || 0) - (a.days || 0);
            if (byDays) return byDays;
            return String(a.task).localeCompare(String(b.task));
        });

        const counts = {};
        for (const issue of issues) counts[issue.kind] = (counts[issue.kind] || 0) + 1;

        const withDeadlines = list.filter(task => task && ISO_DATE.test(task.deadline || '')).length;

        return {
            issues,
            counts,
            withDeadlines,
            taskCount: list.length,
            today,
            ok: issues.length === 0,
            summary: summarise(issues, withDeadlines, list.length),
        };
    }

    function summarise(issues, withDeadlines, taskCount) {
        if (!taskCount) return 'No plan loaded yet — add some tasks first.';
        if (!issues.length) {
            if (!withDeadlines) return 'Nothing breaks. No deadlines set yet — add one to a task to check it.';
            return withDeadlines === 1
                ? 'Nothing breaks: the 1 deadline set is met.'
                : `Nothing breaks: all ${withDeadlines} deadlines are met.`;
        }
        const breaches = issues.filter(issue => issue.severity === 'breach').length;
        const rest = issues.length - breaches;
        if (breaches && rest) {
            return `${breaches} deadline${breaches === 1 ? '' : 's'} missed, `
                + `and ${rest} other problem${rest === 1 ? '' : 's'} in the schedule.`;
        }
        if (breaches) return `${breaches} deadline${breaches === 1 ? '' : 's'} missed.`;
        return `${rest} problem${rest === 1 ? '' : 's'} in the schedule.`;
    }

    // ---- DOM half ----

    const KIND_LABELS = {
        'deadline-passed': 'Deadline passed',
        'deadline-missed': 'Deadline missed',
        'dependency-conflict': 'Dependency conflict',
        unscheduled: 'Not scheduled',
    };

    function escapeCheckHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Render an analysis into `container`. `onSelect(taskName)` is called
     * when a row is clicked, so the host can take the user to the task --
     * the report says what breaks, the view it sits over is where it gets
     * fixed.
     */
    function render(container, analysis, options) {
        if (!container) return;
        const opts = options || {};
        const statusClass = analysis.ok ? 'ok' : 'breaks';
        const rows = analysis.issues.map((issue, index) => `
            <li class="schedule-check-issue ${escapeCheckHtml(issue.severity)}">
                <button type="button" class="schedule-check-issue-btn" data-issue-index="${index}">
                    <span class="schedule-check-issue-kind">${escapeCheckHtml(KIND_LABELS[issue.kind] || issue.kind)}</span>
                    <span class="schedule-check-issue-task">${escapeCheckHtml(issue.task)}</span>
                    <span class="schedule-check-issue-message">${escapeCheckHtml(issue.message)}</span>
                </button>
            </li>
        `).join('');

        container.innerHTML = `
            <div class="schedule-check">
                <div class="schedule-check-summary ${statusClass}">${escapeCheckHtml(analysis.summary)}</div>
                ${rows ? `<ul class="schedule-check-issues">${rows}</ul>` : ''}
                <button type="button" class="schedule-check-recheck">Re-check</button>
            </div>
        `;

        container.querySelectorAll('.schedule-check-issue-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const issue = analysis.issues[Number(btn.dataset.issueIndex)];
                if (issue && typeof opts.onSelect === 'function') opts.onSelect(issue.task, issue);
            });
        });
        const recheck = container.querySelector('.schedule-check-recheck');
        if (recheck) {
            recheck.addEventListener('click', () => {
                if (typeof opts.onRecheck === 'function') opts.onRecheck();
            });
        }
    }

    const api = {
        analyse, render, todayIso, daysBetween, summarise, KIND_LABELS,
        // exported for tests
        _deadlineIssue: deadlineIssue, _dependencyIssue: dependencyIssue, _unscheduledIssue: unscheduledIssue,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ScheduleCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
