/**
 * plan-review.js -- the Analysis view's plan review (#782).
 *
 * The checks themselves live in noodle_core/plan_quality.py, served by
 * POST /api/analyse, so the web app, the CLI (`noodle analyze`) and the AI
 * tools all report the same findings. This file fetches the review, renders
 * it grouped by severity with a filter, links each finding to its line, and
 * applies one-click fixes (POST /api/analyse/fix) as a single undoable edit.
 *
 * The review is only fetched while the Analysis view is showing: each
 * render marks it stale, and showing the view (or a render while it is
 * shown) fetches it once, debounced.
 *
 * `filterFindings`, `groupFindings` and `currentLine` are pure and unit-tested
 * (tests/test_plan_review.mjs); the rest is DOM and covered by
 * tests/ui/test_plan_review.py.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.PlanReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SEVERITIES = ['error', 'warning', 'suggestion'];
    const LABELS = { error: 'Errors', warning: 'Warnings', suggestion: 'Suggestions' };
    const SINGULAR = { error: 'Error', warning: 'Warning', suggestion: 'Suggestion' };

    const state = {
        severity: 'all',
        query: '',
        review: null,
        planText: null,
        stale: true,
        reviewedText: null,
        timer: null,
        generation: 0,
        applying: false,
    };

    // ----- pure helpers ----------------------------------------------------

    /** Findings matching a severity ('all' for every one) and a free-text
     *  query over the title, message, task name and check id. */
    function filterFindings(findings, filter = {}) {
        const severity = filter.severity || 'all';
        const query = String(filter.query || '').trim().toLowerCase();
        return (findings || []).filter(f => {
            if (severity !== 'all' && f.severity !== severity) return false;
            if (!query) return true;
            return [f.title, f.message, f.task, f.check]
                .some(text => String(text || '').toLowerCase().includes(query));
        });
    }

    /** [{ severity, findings }] in severity order, empty groups dropped. */
    function groupFindings(findings) {
        return SEVERITIES
            .map(severity => ({ severity, findings: (findings || []).filter(f => f.severity === severity) }))
            .filter(group => group.findings.length);
    }

    // ----- fetching ---------------------------------------------------------

    function analysisVisible() {
        const view = typeof document !== 'undefined' && document.getElementById('analysis-view');
        return Boolean(view && view.classList.contains('active'));
    }

    /** Called on every render: remember the text, refresh if on screen. */
    function onPlanRendered(planText) {
        state.planText = planText;
        state.stale = true;
        if (analysisVisible()) schedule();
    }

    /** Called when the Analysis view is shown. */
    function onViewShown() {
        if (state.stale && state.planText !== null) schedule(0);
    }

    function schedule(delay = 300) {
        clearTimeout(state.timer);
        state.timer = setTimeout(refresh, delay);
    }

    function editorText() {
        const editor = typeof document !== 'undefined' && document.getElementById('planEditor');
        return editor ? editor.value : null;
    }

    async function refresh() {
        // Review what the editor holds now: the text a render was given can
        // already be out of date (the app writes `rag:` back into the front
        // matter after a render, without re-rendering).
        const planText = editorText() ?? state.planText;
        if (planText === null) return;
        const generation = ++state.generation;
        state.stale = false;
        setStatus('Reviewing the plan…');
        try {
            const response = await fetch('/api/analyse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan_text: planText }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const review = await response.json();
            if (generation !== state.generation) return;   // a newer review is on its way
            state.review = review;
            state.reviewedText = planText;
            render();
        } catch (error) {
            if (generation !== state.generation) return;
            state.stale = true;
            setStatus('The plan review is unavailable right now.');
            console.warn('[plan-review] review failed:', error);
        }
    }

    // ----- fixes -------------------------------------------------------------

    async function applyFix(finding) {
        const editor = document.getElementById('planEditor');
        if (!editor || !finding.fix_action || state.applying) return;
        state.applying = true;
        try {
            const response = await fetch('/api/analyse/fix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan_text: editor.value, action: currentAction(finding, editor.value) }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                notify(body.detail || 'That fix could not be applied.', 'warning');
                return;
            }
            // One undo step: the state before the fix is on the stack, then
            // the fixed text is.
            if (typeof EditorUndoManager !== 'undefined') EditorUndoManager.captureImmediate(editor.value);
            editor.value = body.plan_text;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof EditorUndoManager !== 'undefined') EditorUndoManager.captureImmediate(editor.value);
            notify(`Fixed: ${finding.title}. Undo (Ctrl+Z) reverses it.`, 'success');
            if (typeof renderText === 'function') renderText();
        } finally {
            state.applying = false;
        }
    }

    function notify(message, type) {
        if (typeof showStatusMessage === 'function') {
            showStatusMessage(message, type);
        } else if (typeof showToast === 'function') {
            showToast(message, type);
        }
    }

    /** The line a finding refers to in `text` now. If the plan has changed
     *  since the review, the nearest line mentioning the task stands in. */
    function currentLine(finding, text) {
        if (!finding.line || text === null || text === state.reviewedText || !finding.task) return finding.line;
        const lines = text.split('\n');
        const task = finding.task.toLowerCase();
        let best = finding.line;
        let bestDistance = Infinity;
        lines.forEach((line, i) => {
            const distance = Math.abs(i + 1 - finding.line);
            if (line.toLowerCase().includes(task) && distance < bestDistance) {
                best = i + 1;
                bestDistance = distance;
            }
        });
        return best;
    }

    /** The finding's fix, re-pointed at the task's current line. The server
     *  still checks the line holds the task before it edits anything. */
    function currentAction(finding, text) {
        const action = { ...finding.fix_action };
        if (action.line) action.line = currentLine(finding, text);
        return action;
    }

    function goToFinding(finding) {
        if (!finding.line) return;
        if (typeof goToEditorLine === 'function') goToEditorLine(currentLine(finding, editorText()));
    }

    // ----- rendering ------------------------------------------------------------

    function container() {
        return typeof document !== 'undefined' ? document.getElementById('planReview') : null;
    }

    function setStatus(text) {
        const root = container();
        if (!root) return;
        const status = root.querySelector('.plan-review-status');
        if (status) status.textContent = text;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function render() {
        const root = container();
        const review = state.review;
        if (!root || !review) return;

        const summary = root.querySelector('.plan-review-summary');
        summary.innerHTML = '';
        const score = el('div', `plan-review-score plan-review-score--${review.grade.toLowerCase().replace(/\s+/g, '-')}`);
        score.appendChild(el('span', 'plan-review-score-value', String(review.score)));
        score.appendChild(el('span', 'plan-review-score-grade', review.grade));
        score.title = 'Plan health: 100, less 15 per error, 5 per warning and 1 per suggestion ' +
            '(each kind of problem counted at most three times).';
        summary.appendChild(score);
        const counts = el('p', 'plan-review-counts');
        counts.textContent = review.findings.length
            ? SEVERITIES.map(s => `${review.counts[s]} ${review.counts[s] === 1 ? SINGULAR[s].toLowerCase() : LABELS[s].toLowerCase()}`).join(', ')
            : 'No problems found.';
        summary.appendChild(counts);

        // Filter chips, with live counts
        const chips = root.querySelector('.plan-review-filters');
        chips.innerHTML = '';
        [['all', 'All', review.findings.length]].concat(
            SEVERITIES.map(s => [s, LABELS[s], review.counts[s]])
        ).forEach(([value, label, count]) => {
            const chip = el('button', `plan-review-chip plan-review-chip--${value}`, `${label} (${count})`);
            chip.type = 'button';
            chip.dataset.severity = value;
            chip.setAttribute('aria-pressed', String(state.severity === value));
            chip.addEventListener('click', () => { state.severity = value; render(); });
            chips.appendChild(chip);
        });

        const list = root.querySelector('.plan-review-list');
        list.innerHTML = '';
        const visible = filterFindings(review.findings, state);
        setStatus(visible.length === review.findings.length ? ''
            : `Showing ${visible.length} of ${review.findings.length}.`);
        if (!review.findings.length) {
            list.appendChild(el('p', 'plan-review-empty', 'Every check passed. The plan is ready to share.'));
            return;
        }
        groupFindings(visible).forEach(group => {
            const section = el('section', `plan-review-group plan-review-group--${group.severity}`);
            section.appendChild(el('h4', 'plan-review-group-title', `${LABELS[group.severity]} (${group.findings.length})`));
            const items = el('ul', 'plan-review-items');
            group.findings.forEach(finding => items.appendChild(renderFinding(finding)));
            section.appendChild(items);
            list.appendChild(section);
        });
    }

    function renderFinding(finding) {
        const item = el('li', `plan-review-item plan-review-item--${finding.severity}`);
        item.dataset.check = finding.check;
        item.dataset.findingId = finding.id;

        const head = el('div', 'plan-review-item-head');
        head.appendChild(el('span', `plan-review-badge plan-review-badge--${finding.severity}`, SINGULAR[finding.severity]));
        head.appendChild(el('strong', 'plan-review-item-title', finding.title));
        if (finding.line) {
            const link = el('button', 'plan-review-line', `Line ${finding.line}${finding.task ? ` · ${finding.task}` : ''}`);
            link.type = 'button';
            link.title = 'Show this line in the editor';
            link.addEventListener('click', () => goToFinding(finding));
            head.appendChild(link);
        }
        item.appendChild(head);
        item.appendChild(el('p', 'plan-review-message', finding.message));

        const fix = el('p', 'plan-review-fix');
        fix.appendChild(el('span', 'plan-review-fix-label', 'How to fix: '));
        fix.appendChild(document.createTextNode(finding.fix + ' '));
        const docs = el('a', 'plan-review-docs', 'More about this check');
        docs.href = finding.docs;
        docs.target = '_blank';
        docs.rel = 'noopener';
        fix.appendChild(docs);
        item.appendChild(fix);

        if (finding.fix_action) {
            const button = el('button', 'plan-review-apply', 'Apply fix');
            button.type = 'button';
            button.addEventListener('click', () => applyFix(finding));
            item.appendChild(button);
        }
        return item;
    }

    /** Wire the search box once. */
    function init() {
        const root = container();
        if (!root || root.dataset.initialized) return;
        const search = root.querySelector('.plan-review-search');
        if (search) {
            search.addEventListener('input', () => { state.query = search.value; render(); });
        }
        root.dataset.initialized = 'true';
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }

    return {
        SEVERITIES,
        filterFindings,
        groupFindings,
        currentLine,
        onPlanRendered,
        onViewShown,
        refresh,
        applyFix,
        _state: state,
    };
});
