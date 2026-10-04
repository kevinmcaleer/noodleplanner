/**
 * template-card.js -- the portrait template card's picture (#945).
 *
 * A template card in Backstage shows the *shape of the work*, not a generic
 * document icon: what tells two plans apart at a glance is not their
 * milestone dates but how many phases they have, whether the effort sits at
 * the front or the back, and how many parallel streams there are. A software
 * deployment and an office move must not look the same.
 *
 * So the card is a stack of labelled rows, one per top-level summary task,
 * with a bar for the amount of work in that phase and a bubble for each
 * milestone (a zero-duration task) to its right. Vertical space is cheap for
 * stacked text, which is why the card is portrait: a landscape timeline has
 * nowhere to hang readable labels, and a line with three or four bubbles
 * looks like every other line with three or four bubbles.
 *
 * It is another lens on the parse-once plan model (plan-model.js), like the
 * Board and the Mind Map: walk the roots, count the leaves. There is no
 * separate parse and no pattern-matching on the plan text.
 *
 *   - templateSkeletonFromPlan(text)  plan text -> { phases, tasks, milestones }
 *   - templateCardShapeHtml(skeleton) skeleton  -> the card's inner HTML
 *
 * Both are pure; backstage.js fetches the templates and puts the HTML on the
 * cards. A classic script that also exports for node tests, like
 * back-matter-markers.js.
 */
(function (root) {
    'use strict';

    /** Rows drawn before the rest collapse into "+N more". */
    const MAX_ROWS = 7;
    /** Milestone bubbles drawn on a row before they collapse into "+N". */
    const MAX_BUBBLES = 5;
    /** A bar is never thinner than this share of the track, so a phase with
     * a single task is still visible beside a long one. */
    const MIN_BAR_PERCENT = 12;

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** A zero-duration task: `0days`, `0d` and so on. The tokenizer reports
     * the digits of the duration, so zero is the string "0". */
    function isMilestone(task) {
        return !!task && !!task.metadata && task.metadata.duration === '0';
    }

    /** Every task under `task` that has no children of its own. */
    function leavesUnder(task) {
        if (!task.children.length) return [task];
        return task.children.reduce((all, child) => all.concat(leavesUnder(child)), []);
    }

    /**
     * The skeleton of a plan: one phase per top-level summary task, with the
     * number of work tasks (leaves that are not milestones) under it and the
     * names of its milestones. A top-level task with no children is not a
     * phase -- a plan of nothing but those has no skeleton to draw, and the
     * card falls back to its counts.
     *
     * @param {string} planText
     * @returns {{phases: Array<{title: string, work: number, milestones: string[]}>,
     *            tasks: number, milestones: number}}
     */
    function templateSkeletonFromPlan(planText) {
        const model = root.NoodlePlanModel.PlanModel.parse(planText);
        const phases = model.roots
            .filter(node => node.children.length > 0)
            .map(node => {
                const leaves = leavesUnder(node);
                const milestones = leaves.filter(isMilestone).map(leaf => leaf.name);
                return {
                    title: node.name,
                    work: leaves.length - milestones.length,
                    milestones,
                };
            });
        const leaves = model.tasks.filter(task => !task.children.length);
        return {
            phases,
            tasks: leaves.length,
            milestones: leaves.filter(isMilestone).length,
        };
    }

    function bubblesHtml(milestones) {
        const shown = milestones.slice(0, MAX_BUBBLES);
        const more = milestones.length - shown.length;
        return shown.map(name => `<i class="backstage-card-bubble" title="${escapeHtml(name)}"></i>`).join('') +
            (more > 0 ? `<span class="backstage-card-more">+${more}</span>` : '');
    }

    function rowHtml(phase, maxWork) {
        const share = maxWork > 0 ? Math.round((phase.work / maxWork) * 100) : 0;
        const width = Math.max(MIN_BAR_PERCENT, share);
        return `<span class="backstage-card-row">` +
            `<span class="backstage-card-label">${escapeHtml(phase.title)}</span>` +
            `<span class="backstage-card-line">` +
            `<span class="backstage-card-track"><span class="backstage-card-bar" style="--backstage-card-bar:${width}%"></span></span>` +
            `<span class="backstage-card-bubbles">${bubblesHtml(phase.milestones)}</span>` +
            `</span></span>`;
    }

    /**
     * The inner HTML of a card: the stacked rows, and a one-line summary
     * underneath. Decorative -- the card button carries the template's name
     * and the summary is repeated there as text -- so it is aria-hidden.
     */
    function templateCardShapeHtml(skeleton) {
        const phases = (skeleton && skeleton.phases) || [];
        const tasks = skeleton ? skeleton.tasks : 0;
        const milestones = skeleton ? skeleton.milestones : 0;
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        if (!phases.length) {
            return `<span class="backstage-card-shape backstage-card-shape-empty" aria-hidden="true">` +
                `<span class="backstage-card-summary">${escapeHtml(plural(tasks, 'task'))}</span></span>`;
        }
        const maxWork = phases.reduce((max, phase) => Math.max(max, phase.work), 0);
        const shown = phases.slice(0, MAX_ROWS);
        const hidden = phases.length - shown.length;
        const summary = `${plural(phases.length, 'phase')} · ${plural(milestones, 'milestone')}`;
        return `<span class="backstage-card-shape" aria-hidden="true">` +
            shown.map(phase => rowHtml(phase, maxWork)).join('') +
            (hidden > 0 ? `<span class="backstage-card-more-rows">+${hidden} more</span>` : '') +
            `<span class="backstage-card-summary">${escapeHtml(summary)}</span></span>`;
    }

    const api = { templateSkeletonFromPlan, templateCardShapeHtml };
    Object.assign(root, api);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
