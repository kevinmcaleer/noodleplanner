/**
 * plan-list.js -- the plan as a stack of note cards (#1384, epic #1376).
 *
 * Two asks in the epic describe one surface: "a simple task list -- the Gantt
 * without the Gantt bars" and "the whiteboard note, which should just show
 * the high-level tasks and let the user expand them". This is both. Each
 * top-level summary task is a card -- an <np-note stacked>, the whiteboard's
 * own note component -- that shows the summary collapsed (progress, start ->
 * finish, RAG, who is on it, "N tasks · M done") and its task rows expanded.
 * Top-level tasks with no summary collect in an "Ungrouped" card.
 *
 * It is the Tasks view on a phone (the table stays on a tablet and a
 * desktop), and the whiteboard's Cards there: on a phone the whiteboard view
 * offers Cards or Canvas (remembered per browser), and starts on Cards. That
 * matters most for a planning session's /join page, which draws the host's
 * whiteboard for a guest who is quite likely holding a phone.
 *
 * ## Data
 *
 * The scheduler's tasks, as every view gets them (updateTasksTable(tasks)):
 * pre-order, `level` 1 at the top, `is_summary`, `percent`, `start`,
 * `finish`, `rag`, `resources` (a comma list) and `_uid`, the PlanModel id.
 * groups() and visibleRows() are pure, and tests/test_plan_list.mjs runs
 * them in plain node.
 *
 * ## Writes
 *
 * Ticking a row writes 100% (or 0%) onto that task's own line through
 * PlanModel -- found by `_uid`, not by name -- as one undo step, then renders
 * at once, the way a whiteboard note's checkbox does. Tapping a row opens the
 * task's detail sheet (#1383).
 *
 * ## Collapse
 *
 * Which cards (and nested summaries) are open is NoodleSummaryCollapse's
 * (summary-collapse.js), per project, and the Gantt reads the same store: a
 * summary closed on one is closed on the other. A card nobody has opened or
 * closed yet starts closed -- the high-level view first -- unless it is the
 * plan's only card. A nested summary starts open, as it does on the Gantt.
 *
 * A classic script exposing `NoodlePlanList`.
 */
(function (root) {
    'use strict';

    const UNGROUPED = 'Ungrouped';
    // The Ungrouped card is not a task, so it has a key no task name can
    // reach through the store's lower-casing.
    const UNGROUPED_KEY = '(ungrouped card)';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function percentOf(task) {
        const value = parseFloat(task && task.percent);
        return Number.isFinite(value) ? value : 0;
    }

    function isDone(task) {
        return percentOf(task) >= 100;
    }

    function resourcesOf(task) {
        const raw = task && task.resources;
        const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
        return list.map((name) => String(name).trim().replace(/^@/, '')).filter(Boolean);
    }

    /** "2026-03-05" -> "5 Mar"; anything else as given. */
    function shortDate(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        if (!match) return iso ? String(iso) : '';
        return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]}`;
    }

    function unique(values) {
        return [...new Set(values)];
    }

    function colourOf(rag) {
        return rag && typeof ragStatusToColour === 'function' ? ragStatusToColour(rag) : '';
    }

    /**
     * A card's RAG. The scheduler gives each task one and a summary none, so a
     * card takes the worst of its unfinished tasks', in the scheduler's own
     * words: overdue, then behind, else on track (or not started, if nothing
     * has begun) -- and Complete once every task is done.
     */
    function cardRag(leaves) {
        if (!leaves.length) return '';
        if (leaves.every((row) => isDone(row.task))) return 'Complete';
        const colours = leaves.filter((row) => !isDone(row.task)).map((row) => colourOf(row.task.rag));
        if (colours.includes('red')) return 'Task Overdue';
        if (colours.includes('amber')) return 'Behind Schedule';
        if (leaves.every((row) => percentOf(row.task) === 0)) return 'Not Started';
        return 'On Track';
    }

    /** A card's summary line, from its rows (and its summary task, if any). */
    function withStats(card) {
        const leaves = card.rows.filter((row) => !row.task.is_summary);
        const starts = card.rows.map((row) => row.task.start).filter(Boolean).sort();
        const finishes = card.rows.map((row) => row.task.finish).filter(Boolean).sort();
        const summary = card.summary;
        const hasOwnPercent = summary && summary.percent !== undefined && summary.percent !== null && summary.percent !== '';
        const percent = hasOwnPercent
            ? percentOf(summary)
            : (leaves.length ? leaves.reduce((sum, row) => sum + percentOf(row.task), 0) / leaves.length : 0);
        return {
            ...card,
            total: leaves.length,
            done: leaves.filter((row) => isDone(row.task)).length,
            start: (summary && summary.start) || starts[0] || '',
            finish: (summary && summary.finish) || finishes[finishes.length - 1] || '',
            percent,
            rag: (summary && summary.rag) || cardRag(leaves),
            resources: unique(leaves.flatMap((row) => resourcesOf(row.task))),
        };
    }

    /**
     * The scheduler's tasks as cards: one per top-level summary, holding every
     * task under it in order, then one "Ungrouped" card for the top-level
     * tasks that are not summaries. Each row is `{ task, index, depth,
     * childCount, indeterminate }`, `index` being the task's place in `tasks`
     * and `depth` 0 for the summary's own children.
     */
    function groups(tasks) {
        const cards = [];
        let current = null;
        let ungrouped = null;
        const loose = () => {
            if (!ungrouped) ungrouped = { key: UNGROUPED_KEY, name: UNGROUPED, summary: null, index: -1, rows: [] };
            return ungrouped;
        };
        (tasks || []).forEach((task, index) => {
            const level = Number(task.level) || 1;
            if (level <= 1) {
                if (task.is_summary) {
                    current = { key: task.name, name: task.name, summary: task, index, rows: [] };
                    cards.push(current);
                } else {
                    current = null;
                    loose().rows.push({ task, index, depth: 0 });
                }
            } else if (current) {
                current.rows.push({ task, index, depth: level - 2 });
            } else {
                loose().rows.push({ task, index, depth: 0 });
            }
        });
        if (ungrouped) cards.push(ungrouped);

        for (const card of cards) {
            card.rows.forEach((row, i) => {
                if (!row.task.is_summary) return;
                const children = [];
                for (let j = i + 1; j < card.rows.length && card.rows[j].depth > row.depth; j++) {
                    if (card.rows[j].depth === row.depth + 1) children.push(card.rows[j]);
                }
                const done = children.filter((child) => isDone(child.task)).length;
                row.childCount = children.length;
                row.indeterminate = done > 0 && done < children.length;
            });
        }
        return cards.map(withStats);
    }

    /**
     * The rows a card shows: all of them, less those under a nested summary
     * that is collapsed. `isCollapsed(name)` answers for a nested summary.
     */
    function visibleRows(card, isCollapsed) {
        const out = [];
        let hiddenBelow = Infinity;
        for (const row of card.rows) {
            if (row.depth > hiddenBelow) continue;
            hiddenBelow = Infinity;
            const collapsed = !!row.task.is_summary && !!isCollapsed(row.task.name);
            out.push({ ...row, collapsed });
            if (collapsed) hiddenBelow = row.depth;
        }
        return out;
    }

    // ── Collapse ────────────────────────────────────────────────────────

    function store() {
        return root.NoodleSummaryCollapse || null;
    }

    function cardCollapsed(card, onlyCard) {
        const s = store();
        return s ? s.isCollapsed(card.key, !onlyCard) : !onlyCard;
    }

    function rowCollapsed(name) {
        const s = store();
        return s ? s.isCollapsed(name, false) : false;
    }

    function setCollapsed(key, collapsed) {
        const s = store();
        if (s) s.set(key, collapsed);
    }

    // ── Writes ──────────────────────────────────────────────────────────

    function nodeFor(model, task, index) {
        return task && task._uid != null ? model.findById(task._uid) : model.taskAt(index);
    }

    /** Open `task`'s detail sheet. */
    function openTask(task, index) {
        const editor = typeof document !== 'undefined' ? document.getElementById('planEditor') : null;
        if (editor && root.NoodlePlanModel && typeof root.openTaskForm === 'function') {
            const model = root.NoodlePlanModel.modelForEditor(editor);
            const node = nodeFor(model, task, index);
            if (node) {
                root.openTaskForm(model.lineNumber(node));
                return true;
            }
        }
        if (typeof root.openTaskFormByName === 'function') {
            root.openTaskFormByName(task.name);
            return true;
        }
        return false;
    }

    /** Mark `task` complete (100%) or not (0%) on its own line, as one undo step. */
    function setComplete(task, index, complete) {
        const editor = typeof document !== 'undefined' ? document.getElementById('planEditor') : null;
        if (!editor || !root.NoodlePlanModel || typeof root.updatePercentInLine !== 'function') return false;
        const model = root.NoodlePlanModel.modelForEditor(editor);
        const node = nodeFor(model, task, index);
        if (!node) return false;
        // A top-level const in editor-undo.js: a global binding, not a
        // property of the global object.
        const undo = typeof EditorUndoManager !== 'undefined' ? EditorUndoManager : null;
        if (undo) undo.captureImmediate(editor.value);
        const changed = model.updateLine(node, (line) =>
            root.updatePercentInLine(line, complete ? '100%' : '0%', node.indentText, node.name));
        if (!changed) return false;
        root.NoodlePlanModel.commitToEditor(editor, model);
        if (undo) undo.captureImmediate(editor.value);
        // Render now rather than after the editor's 1s debounce, so the tick
        // and every view agree at once.
        if (typeof editor._cancelPendingRender === 'function') editor._cancelPendingRender();
        if (typeof root.renderText === 'function') {
            Promise.resolve(root.renderText()).catch((error) => console.error('Plan list render failed:', error));
        }
        return true;
    }

    // ── Rendering ───────────────────────────────────────────────────────

    const mounts = new Map();

    function rowModel(row) {
        const task = row.task;
        const summary = !!task.is_summary;
        return {
            name: task.name,
            complete: isDone(task),
            percent: task.percent,
            hasChildren: summary,
            childCount: row.childCount || 0,
            indeterminate: !!row.indeterminate,
            readOnly: summary,
            collapsed: row.collapsed,
            resources: resourcesOf(task),
            finish: shortDate(task.finish),
            depth: row.depth,
            task,
            taskIndex: row.index,
        };
    }

    /** Where focus is inside `container`, so a re-render can put it back. */
    function describeFocus(container) {
        const active = document.activeElement;
        if (!active || !container.contains(active)) return null;
        const note = active.closest('np-note');
        const row = active.closest('.wb-note-row');
        const part = ['.wb-note-expand', '.wb-note-row-name', 'np-checkbox', '.wb-note-count-badge']
            .find((selector) => active.matches(selector)) || null;
        return {
            card: note ? note.getAttribute('task') : null,
            row: row ? row.dataset.wbRowTask : null,
            part,
        };
    }

    function restoreFocus(container, focus) {
        if (!focus || !focus.part) return;
        const note = [...container.querySelectorAll('np-note')].find((n) => n.getAttribute('task') === focus.card);
        if (!note) return;
        const scope = focus.row
            ? [...note.querySelectorAll('.wb-note-row')].find((r) => r.dataset.wbRowTask === focus.row)
            : note;
        const target = scope && scope.querySelector(focus.part);
        if (target) target.focus({ preventScroll: true });
    }

    function buildCard(card, onlyCard, options) {
        const note = document.createElement('np-note');
        note.setAttribute('stacked', '');
        note.setAttribute('task', card.name);
        note.dataset.card = card.summary ? 'summary' : 'ungrouped';
        note.toggleAttribute('collapsed', cardCollapsed(card, onlyCard));
        note.summary = {
            percent: card.percent,
            start: shortDate(card.start),
            finish: shortDate(card.finish),
            rag: card.rag,
            ragColour: colourOf(card.rag),
            resources: card.resources,
            total: card.total,
            done: card.done,
        };
        note.rows = visibleRows(card, rowCollapsed).map(rowModel);

        note.addEventListener('expandedchange', (event) => setCollapsed(card.key, !event.detail.expanded));
        note.addEventListener('rowtoggle', (event) => setCollapsed(event.detail.row.name, event.detail.collapsed));
        note.addEventListener('rowactivate', (event) => {
            const { task, taskIndex } = event.detail.row;
            (options.onOpen || openTask)(task, taskIndex);
        });
        note.addEventListener('rowcomplete', (event) => {
            const { task, taskIndex } = event.detail.row;
            (options.onComplete || setComplete)(task, taskIndex, event.detail.complete);
        });
        return note;
    }

    /**
     * Render `tasks` into `container` as cards. `options.onOpen(task, index)`
     * and `options.onComplete(task, index, complete)` replace opening the
     * task form and writing the plan -- a page without the editor (/join)
     * passes its own.
     */
    function render(container, tasks, options) {
        if (!container) return;
        const opts = options || {};
        mounts.set(container, { tasks, options: opts });
        const focus = describeFocus(container);
        const cards = groups(tasks);
        if (!cards.length) {
            const empty = document.createElement('p');
            empty.className = 'plan-list-empty';
            empty.textContent = opts.emptyText || 'No tasks yet. Tap + to add one.';
            container.replaceChildren(empty);
            return;
        }
        container.replaceChildren(...cards.map((card) => buildCard(card, cards.length === 1, opts)));
        restoreFocus(container, focus);
    }

    // ── The Tasks view on a phone ───────────────────────────────────────

    let lastTasks = [];

    function isPhone() {
        return !!(root.NoodleLayout && root.NoodleLayout.isPhone());
    }

    /** Called by updateTasksTable() with the tasks it drew. */
    function renderTasksView(tasks) {
        lastTasks = tasks || [];
        const list = document.getElementById('planList');
        if (!list) return;
        const phone = isPhone();
        list.hidden = !phone;
        if (phone) render(list, lastTasks);
        else mounts.delete(list);
    }

    // ── The whiteboard's Cards on a phone ───────────────────────────────

    const WHITEBOARD_MODE_KEY = 'noodleplanner:whiteboard-phone-mode';
    const WHITEBOARD_MODES = [{ id: 'cards', label: 'Cards' }, { id: 'canvas', label: 'Canvas' }];
    let whiteboardTasks = [];
    let whiteboardOptions = {};

    function whiteboardMode() {
        try {
            return root.localStorage.getItem(WHITEBOARD_MODE_KEY) === 'canvas' ? 'canvas' : 'cards';
        } catch (_) {
            return 'cards';
        }
    }

    function syncWhiteboard() {
        const view = document.getElementById('whiteboard-view');
        const cards = document.getElementById('whiteboardCards');
        const chips = document.getElementById('whiteboardModeChips');
        if (!view || !cards) return;
        const phone = isPhone();
        const mode = phone ? whiteboardMode() : 'canvas';
        view.dataset.wbMode = mode;
        if (chips) {
            if (!chips.views || !chips.views.length) chips.views = WHITEBOARD_MODES;
            chips.hidden = !phone;
            chips.setAttribute('active', mode);
        }
        cards.hidden = mode !== 'cards';
        if (mode === 'cards') render(cards, whiteboardTasks, whiteboardOptions);
        else mounts.delete(cards);
    }

    /** Show the whiteboard as `mode` ('cards' or 'canvas') on a phone. */
    function setWhiteboardMode(mode) {
        try {
            root.localStorage.setItem(WHITEBOARD_MODE_KEY, mode === 'canvas' ? 'canvas' : 'cards');
        } catch (_) { /* storage unavailable: the choice lasts for the page */ }
        syncWhiteboard();
        // The canvas measured itself while it was hidden; fit it now it shows.
        if (mode === 'canvas' && typeof root.whiteboardZoomFit === 'function') {
            requestAnimationFrame(() => root.whiteboardZoomFit());
        }
    }

    /** Called by updateWhiteboardView() with the tasks the board drew. */
    function renderWhiteboardCards(tasks) {
        whiteboardTasks = tasks || [];
        syncWhiteboard();
    }

    /** A page without the editor (/join) says how a row opens and ticks. */
    function configureWhiteboardCards(options) {
        whiteboardOptions = options || {};
        syncWhiteboard();
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('select', (event) => {
            if (event.target && event.target.id === 'whiteboardModeChips') setWhiteboardMode(event.detail.id);
        });

        // A collapse made anywhere -- a card here, the Gantt's triangle --
        // shows on every list on the page.
        document.addEventListener('summarycollapsechange', () => {
            for (const [container, { tasks, options }] of mounts) {
                if (container.isConnected) render(container, tasks, options);
                else mounts.delete(container);
            }
        });
        document.addEventListener('layoutchange', () => {
            if (document.getElementById('planList')) renderTasksView(lastTasks);
            syncWhiteboard();
        });
    }

    root.NoodlePlanList = {
        UNGROUPED,
        UNGROUPED_KEY,
        groups,
        visibleRows,
        shortDate,
        render,
        renderTasksView,
        renderWhiteboardCards,
        configureWhiteboardCards,
        setWhiteboardMode,
        openTask,
        setComplete,
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
