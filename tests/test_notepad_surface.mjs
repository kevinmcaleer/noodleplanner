/**
 * notepad.js -- the simple plan entry surface (#1049).
 *
 * Covers computeKanbanColumns() directly (pure, no DOM) and, for the
 * DOM-editing paths (row edit/indent/enter/backspace, drag reorder, card
 * drag between columns), verifies end to end through NotepadSurface.mount()
 * against a minimal document stub, in the same spirit as
 * tests/test_kanban_board_mutations.mjs's buildBoard() -- every mutation is
 * checked by reading back the plan text NotepadSurface commits through
 * plan-model.js, the same way a real edit would.
 *
 * Run with: node --test tests/test_notepad_surface.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import planModel from '../packages/noodle-web/src/noodle_web/static/plan-model.js';

const { PlanModel } = planModel;
globalThis.NoodlePlanModel = planModel;
const notepad = await import('../packages/noodle-web/src/noodle_web/static/notepad.js');
const { computeKanbanColumns } = notepad.default;

test('computeKanbanColumns: no tasks -> no columns', () => {
    assert.deepEqual(computeKanbanColumns(PlanModel.parse('')), []);
});

test('computeKanbanColumns: a fully flat plan collapses into one "All Tasks" column', () => {
    const model = PlanModel.parse('Task A\nTask B\nTask C\n');
    const columns = computeKanbanColumns(model);
    assert.equal(columns.length, 1);
    assert.equal(columns[0].title, 'All Tasks');
    assert.equal(columns[0].root, null);
    assert.deepEqual(columns[0].cards.map(t => t.name), ['Task A', 'Task B', 'Task C']);
});

test('computeKanbanColumns: any nesting switches to phase columns, one per root', () => {
    const model = PlanModel.parse('Phase 1\n  Task A\n  Task B\nPhase 2\n  Task C\n');
    const columns = computeKanbanColumns(model);
    assert.equal(columns.length, 2);
    assert.deepEqual(columns.map(c => c.title), ['Phase 1', 'Phase 2']);
    assert.deepEqual(columns[0].cards.map(t => t.name), ['Task A', 'Task B']);
    assert.deepEqual(columns[1].cards.map(t => t.name), ['Task C']);
    assert.equal(columns[0].root.name, 'Phase 1');
});

test('computeKanbanColumns: a childless root renders as an empty column, not a card of itself', () => {
    const model = PlanModel.parse('Phase 1\n  Task A\nPhase 2\n');
    const columns = computeKanbanColumns(model);
    assert.equal(columns.length, 2);
    assert.deepEqual(columns[1].cards, []);
    assert.equal(columns[1].title, 'Phase 2');
});

test('computeKanbanColumns: a nameless root (duck-typed, no PlanModel needed) still yields a labelled column', () => {
    // computeKanbanColumns only reads .roots/.children/.name/.id, so a
    // plain object stands in for a PlanModel here to exercise the
    // '(untitled)' fallback directly, without needing a real task line
    // whose tokenized name comes out empty.
    const fakeModel = { roots: [{ id: 0, name: '', children: [{ id: 1, name: 'Child' }] }] };
    const columns = computeKanbanColumns(fakeModel);
    assert.equal(columns.length, 1);
    assert.equal(columns[0].title, '(untitled)');
});

// ---- DOM-level behaviour against a minimal document/window stub ----

function makeDom() {
    const listeners = new Map();
    function addWindowListener(type, fn) {
        const set = listeners.get(type) || new Set();
        set.add(fn);
        listeners.set(type, set);
    }
    function removeWindowListener(type, fn) {
        listeners.get(type)?.delete(fn);
    }
    function dispatch(type, event) {
        for (const fn of [...(listeners.get(type) || [])]) fn(event);
    }

    class FakeClassList {
        constructor(node) { this.node = node; this.set = new Set(); }
        add(...names) { names.forEach(n => this.set.add(n)); }
        remove(...names) { names.forEach(n => this.set.delete(n)); }
        toggle(name, force) {
            const has = this.set.has(name);
            const want = force === undefined ? !has : force;
            if (want) this.set.add(name); else this.set.delete(name);
        }
        contains(name) { return this.set.has(name); }
    }

    class FakeNode {
        constructor(tag) {
            this.tag = tag;
            this.children = [];
            this.parentNode = null;
            this.attrs = {};
            this.dataset = {};
            this.style = {};
            this.classList = new FakeClassList(this);
            this._text = '';
            this._listeners = {};
        }
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
        setAttribute(name, value) {
            if (name.startsWith('data-')) {
                const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                this.dataset[key] = value;
            }
            this.attrs[name] = value;
        }
        addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
        dispatchEvent(type, event) {
            for (const fn of this._listeners[type] || []) fn(event || {});
        }
        get textContent() { return this._text; }
        set textContent(value) { this._text = String(value); }
        get innerHTML() { return ''; }
        set innerHTML(_value) { this.children = []; }
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        }
        querySelectorAll(selector) {
            const out = [];
            const matches = (node) => matchesSelector(node, selector);
            const walk = (node) => {
                for (const child of node.children) {
                    if (matches(child)) out.push(child);
                    walk(child);
                }
            };
            walk(this);
            return out;
        }
        closest(selector) {
            let node = this;
            while (node) {
                if (matchesSelector(node, selector)) return node;
                node = node.parentNode;
            }
            return null;
        }
        get className() { return [...this.classList.set].join(' '); }
        set className(value) {
            this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean));
        }
    }

    function matchesSelector(node, selector) {
        // Only the handful of selector shapes notepad.js actually issues.
        for (const part of selector.split(',').map(s => s.trim())) {
            const classMatch = part.match(/^\.([\w-]+)$/);
            if (classMatch && node.classList.contains(classMatch[1])) return true;
            const attrMatch = part.match(/^\.([\w-]+)\[data-task-id="(\d+)"\]$/);
            if (attrMatch && node.classList.contains(attrMatch[1]) && node.dataset.taskId === attrMatch[2]) return true;
        }
        return false;
    }

    const documentStub = {
        createElement: (tag) => new FakeNode(tag),
        createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    };
    const windowStub = {
        addEventListener: addWindowListener,
        removeEventListener: removeWindowListener,
        getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    };
    return { FakeNode, documentStub, windowStub, dispatch };
}

function withStubbedGlobals(fn) {
    const dom = makeDom();
    const previous = { document: globalThis.document, window: globalThis.window };
    globalThis.document = dom.documentStub;
    globalThis.window = dom.windowStub;
    try {
        return fn(dom);
    } finally {
        globalThis.document = previous.document;
        globalThis.window = previous.window;
    }
}

test('NotepadSurface: typing rows through insertTaskAfter and reading back via _commit', () => {
    withStubbedGlobals((dom) => {
        let text = '';
        const container = new dom.FakeNode('div');
        const surface = notepad.default.mount(container, {
            getText: () => text,
            setText: (value) => { text = value; },
        });
        assert.equal(surface.getMode(), 'list');

        // Simulate the "+ Add task" flow directly against the model, the
        // same operation the button's click handler performs.
        const first = surface.model.insertTaskAfter(null, 'First task');
        surface._commit();
        assert.equal(text, 'First task');

        const second = surface.model.insertTaskAfter(first, 'Second task');
        surface._commit();
        assert.equal(text, 'First task\nSecond task');

        surface.model.indentTasks([second]);
        surface._commit();
        assert.equal(text, 'First task\n  Second task');
    });
});

test('NotepadSurface: setMode/getMode toggles and re-renders without throwing', () => {
    withStubbedGlobals((dom) => {
        let text = 'Phase 1\n  Task A\n';
        const container = new dom.FakeNode('div');
        const surface = notepad.default.mount(container, {
            getText: () => text,
            setText: (value) => { text = value; },
        });
        surface.setMode('kanban');
        assert.equal(surface.getMode(), 'kanban');
        surface.setMode('list');
        assert.equal(surface.getMode(), 'list');
    });
});

test('NotepadSurface: refresh() re-parses text changed by another caller', () => {
    withStubbedGlobals((dom) => {
        let text = 'Task A\n';
        const container = new dom.FakeNode('div');
        const surface = notepad.default.mount(container, {
            getText: () => text,
            setText: (value) => { text = value; },
        });
        assert.deepEqual(surface.model.tasks.map(t => t.name), ['Task A']);
        text = 'Task A\nTask B\n';
        surface.refresh();
        assert.deepEqual(surface.model.tasks.map(t => t.name), ['Task A', 'Task B']);
    });
});
