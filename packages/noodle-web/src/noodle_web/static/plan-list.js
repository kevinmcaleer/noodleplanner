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
 * ## Editing (#1385)
 *
 * On the Tasks view the list is `editable`:
 *
 *   - A quick-add field (<np-quick-add>) at its foot takes a task line in the
 *     plan's grammar -- "Design review @alex 2d 2026-10-02" -- previews what
 *     the tokenizer recognised, and inserts the line as it was typed, through
 *     PlanModel, as the last task of the open card (or at the end of the
 *     plan, for Ungrouped).
 *   - A row's menu -- its ⋯, a swipe left, a long-press -- offers Indent,
 *     Outdent, Move up, Move down, Duplicate and Delete; a swipe right ticks
 *     it; dragging it by its ⋯ moves it. Each is one PlanModel edit and one
 *     undo step.
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

    /**
     * One edit to the plan: `edit(model)` changes the editor's PlanModel and
     * returns whether it did. Committed as one undo step, then rendered at
     * once rather than after the editor's 1s debounce, so every view agrees.
     */
    function applyEdit(edit) {
        const editor = typeof document !== 'undefined' ? document.getElementById('planEditor') : null;
        if (!editor || !root.NoodlePlanModel) return false;
        const model = root.NoodlePlanModel.modelForEditor(editor);
        const before = editor.value;
        // A top-level const in editor-undo.js: a global binding, not a
        // property of the global object.
        const undo = typeof EditorUndoManager !== 'undefined' ? EditorUndoManager : null;
        let changed = false;
        try {
            changed = !!edit(model);
        } finally {
            // An edit that gave up part-way may have touched the cached
            // model; the text is the truth, so parse it afresh next time.
            if (!changed) editor._noodlePlanModel = null;
        }
        if (!changed) return false;
        if (undo) undo.captureImmediate(before);
        root.NoodlePlanModel.commitToEditor(editor, model);
        if (undo) undo.captureImmediate(editor.value);
        if (typeof editor._cancelPendingRender === 'function') editor._cancelPendingRender();
        if (typeof root.renderText === 'function') {
            Promise.resolve(root.renderText()).catch((error) => console.error('Plan list render failed:', error));
        }
        return editor.value !== before;
    }

    /** Mark `task` complete (100%) or not (0%) on its own line, as one undo step. */
    function setComplete(task, index, complete) {
        if (typeof root.updatePercentInLine !== 'function') return false;
        return applyEdit((model) => {
            const node = nodeFor(model, task, index);
            return !!node && model.updateLine(node, (line) =>
                root.updatePercentInLine(line, complete ? '100%' : '0%', node.indentText, node.name));
        });
    }

    // ── Quick-add ───────────────────────────────────────────────────────

    function tokenizer() {
        return typeof TaskLineTokenizer !== 'undefined' ? TaskLineTokenizer : null;
    }

    /**
     * What a quick-add line sets, as the editor would read it: the plan's own
     * tokenizer, the one PlanModel parses every line with.
     */
    function parseQuickAdd(text) {
        const t = tokenizer();
        const line = String(text || '');
        if (!t) return { name: line.trim() };
        const v = t.metadata(line).values;
        return {
            name: v.name,
            resources: v.resources,
            duration: v.duration,
            startDate: v.startDate,
            finishDate: v.finishDate,
            percent: v.percent,
            priority: v.priority,
        };
    }

    const CHIP_KINDS = {
        resource: 'Who', duration: 'Takes', percent: 'Done', label: 'Label', deadline: 'Deadline',
        comment: 'Note', bucket: 'Bucket', dependency: 'After', effort: 'Effort', product: 'Deliverable',
        recurrence: 'Repeats',
    };

    /** The chips <np-quick-add> shows: what the tokenizer recognised, in order. */
    function quickAddChips(text) {
        const t = tokenizer();
        if (!t) return [];
        const { tokens, values } = t.metadata(String(text || ''));
        const chips = [];
        if (values.name) chips.push({ kind: 'name', kindLabel: 'Task', label: values.name });
        let dates = 0;
        for (const token of tokens) {
            if (token.type === 'date') {
                chips.push({ kind: 'date', kindLabel: dates++ ? 'Finishes' : 'Starts', label: shortDate(token.text) });
            } else if (token.type === 'priority') {
                chips.push({ kind: 'priority', kindLabel: 'Priority', label: values.priority });
            } else if (CHIP_KINDS[token.type]) {
                chips.push({ kind: token.type, kindLabel: CHIP_KINDS[token.type], label: token.text });
            }
        }
        return chips;
    }

    /**
     * Add `text` -- a task line, as typed -- as the last task of `card`, or at
     * the end of the plan when `card` is Ungrouped or none.
     */
    function addTask(text, card) {
        const line = String(text || '').replace(/[\r\n]+/g, ' ').trim();
        if (!line) return false;
        return applyEdit((model) => {
            if (card && card.summary) {
                const parent = nodeFor(model, card.summary, card.index);
                if (!parent) return false;
                return !!model.insertTaskAfter(parent, parent.indent + 2, line);
            }
            const last = model.roots[model.roots.length - 1] || null;
            return !!model.insertTaskAfter(last, 0, line);
        });
    }

    // ── The row menu ────────────────────────────────────────────────────

    const ROW_ACTIONS = [
        { id: 'indent', label: 'Indent', help: 'Make it a subtask of the task above', icon: 'indent' },
        { id: 'outdent', label: 'Outdent', help: 'Move it out from under its summary', icon: 'outdent' },
        { id: 'move-up', label: 'Move up', icon: 'sort' },
        { id: 'move-down', label: 'Move down', icon: 'sort' },
        { id: 'duplicate', label: 'Duplicate', help: 'A copy, with its subtasks, just below', icon: 'doc' },
        { id: 'delete', label: 'Delete', icon: 'delete', destructive: true },
    ];

    function siblingsOf(model, node) {
        return node.parent ? node.parent.children : model.roots;
    }

    /** Which row actions `node` allows. */
    function rowActionState(model, node) {
        const siblings = siblingsOf(model, node);
        const i = siblings.indexOf(node);
        return {
            indent: i > 0,
            outdent: !!node.parent,
            'move-up': i > 0,
            'move-down': i >= 0 && i < siblings.length - 1,
            duplicate: true,
            // A summary's tasks go first, as they would in the editor.
            delete: !node.children.length,
        };
    }

    function copyName(model, name) {
        const taken = new Set(model.tasks.map((task) => task.name));
        let candidate = `${name} (copy)`;
        for (let n = 2; taken.has(candidate); n++) candidate = `${name} (copy ${n})`;
        return candidate;
    }

    /** Run row action `id` on `task`, as one undo step. */
    function runRowAction(id, task, index) {
        return applyEdit((model) => {
            const node = nodeFor(model, task, index);
            if (!node || !rowActionState(model, node)[id]) return false;
            const siblings = siblingsOf(model, node);
            const i = siblings.indexOf(node);
            switch (id) {
                // Structural, not textual: the row becomes the last subtask
                // of the one above, and an outdented row lands just after its
                // summary -- the rows around it stay where they were.
                case 'indent': return model.moveAsChild(node, siblings[i - 1], true);
                case 'outdent': return model.moveAfter(node, node.parent);
                case 'move-up': return model.moveBefore(node, siblings[i - 1]);
                case 'move-down': return model.moveAfter(node, siblings[i + 1]);
                case 'duplicate': {
                    const lines = model.cardTextFor(node).split('\n');
                    lines[0] = lines[0].replace(node.name, copyName(model, node.name));
                    return model.insertCardAfter(node, node.indent, lines.join('\n')).length > 0;
                }
                case 'delete': return model.removeTask(node);
                default: return false;
            }
        });
    }

    /** Move `task` before (or `after`) `target`, as one undo step. */
    function moveTask(task, index, target, targetIndex, after) {
        return applyEdit((model) => {
            const node = nodeFor(model, task, index);
            const anchor = nodeFor(model, target, targetIndex);
            if (!node || !anchor || node === anchor) return false;
            return after ? model.moveAfter(node, anchor) : model.moveBefore(node, anchor);
        });
    }

    let rowSheet = null;
    let rowSheetTask = null;

    function openRowMenu(row, opener) {
        const editor = document.getElementById('planEditor');
        if (!editor || !root.NoodlePlanModel) return;
        const model = root.NoodlePlanModel.modelForEditor(editor);
        const node = nodeFor(model, row.task, row.taskIndex);
        if (!node) return;
        if (!rowSheet) {
            rowSheet = document.createElement('np-action-sheet');
            rowSheet.id = 'planListSheet';
            document.body.appendChild(rowSheet);
            rowSheet.addEventListener('select', (event) => {
                const target = rowSheetTask;
                rowSheet.close();
                if (target) runRowAction(event.detail.id, target.task, target.taskIndex);
            });
        }
        rowSheetTask = row;
        const allowed = rowActionState(model, node);
        rowSheet.heading = row.name;
        rowSheet.label = `Actions for ${row.name}`;
        rowSheet.toolbar = [];
        rowSheet.sections = [{
            id: 'row',
            items: ROW_ACTIONS.map((action) => ({ ...action, disabled: !allowed[action.id] })),
        }];
        rowSheet.open(opener);
    }

    // ── Rendering ───────────────────────────────────────────────────────

    const mounts = new Map();

    // The card quick-add adds to: the one most recently opened, while it is
    // still open (#1385).
    let quickAddTarget = null;

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

        if (options.editable) note.setAttribute('editable', '');
        note.addEventListener('expandedchange', (event) => {
            if (event.detail.expanded) quickAddTarget = card.key;
            setCollapsed(card.key, !event.detail.expanded);
        });
        note.addEventListener('rowtoggle', (event) => setCollapsed(event.detail.row.name, event.detail.collapsed));
        note.addEventListener('rowactivate', (event) => {
            const { task, taskIndex } = event.detail.row;
            (options.onOpen || openTask)(task, taskIndex);
        });
        note.addEventListener('rowcomplete', (event) => {
            const { task, taskIndex } = event.detail.row;
            (options.onComplete || setComplete)(task, taskIndex, event.detail.complete);
        });
        note.addEventListener('rowmenu', (event) => openRowMenu(event.detail.row, event.detail.opener));
        note.addEventListener('rowmove', (event) => {
            const { row, target, after } = event.detail;
            moveTask(row.task, row.taskIndex, target.task, target.taskIndex, after);
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
        container._planListCards = cards;
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

    /** The open card quick-add adds to, or null for Ungrouped. */
    function quickAddCard(cards) {
        const open = (cards || []).filter((card) => !cardCollapsed(card, cards.length === 1));
        const chosen = open.find((card) => card.key === quickAddTarget) || open.find((card) => card.summary);
        return chosen && chosen.summary ? chosen : null;
    }

    function syncQuickAdd() {
        const field = document.getElementById('planQuickAdd');
        const list = document.getElementById('planList');
        if (!field || !list) return;
        field.hidden = list.hidden;
        if (field.hidden) return;
        const card = quickAddCard(list._planListCards);
        field.setAttribute('placeholder', card ? `Add a task to ${card.name}…` : 'Add a task…');
        field.setAttribute('label', card ? `Add a task to ${card.name}` : 'Add a task to the plan');
    }

    function wireQuickAdd() {
        const field = document.getElementById('planQuickAdd');
        if (!field || field._planListWired) return;
        field._planListWired = true;
        field.preview = quickAddChips;
        field.addEventListener('quickadd', (event) => {
            const list = document.getElementById('planList');
            if (!addTask(event.detail.text, quickAddCard(list && list._planListCards))) event.preventDefault();
        });
    }

    /** Called by updateTasksTable() with the tasks it drew. */
    function renderTasksView(tasks) {
        lastTasks = tasks || [];
        const list = document.getElementById('planList');
        if (!list) return;
        const phone = isPhone();
        list.hidden = !phone;
        if (phone) {
            wireQuickAdd();
            render(list, lastTasks, { editable: true });
        } else {
            mounts.delete(list);
        }
        syncQuickAdd();
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
        document.dispatchEvent(new CustomEvent('whiteboardmodechange', { detail: { mode } }));
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
            syncQuickAdd();
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
        whiteboardMode,
        openTask,
        setComplete,
        parseQuickAdd,
        quickAddChips,
        addTask,
        runRowAction,
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
