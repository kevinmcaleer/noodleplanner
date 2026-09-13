/**
 * Whiteboard dependency noodles (#1052, reworked by #1106) -- the
 * drag-to-connect gesture itself (the row handle in whiteboard-notes.js,
 * and wbBeginRowDepDrag()/wbUpdateRowDepDrag()/wbEndRowDepDrag() in
 * whiteboard-dep-noodles.js, both DOM-dependent -- getBoundingClientRect(),
 * elementFromPoint()) is covered by manual/browser verification only (see
 * the PR: hovering a leaf checklist row reveals the handle, dragging it
 * onto another leaf row's checklist creates the dependency, a summary
 * child row or the note header never offers or accepts one, cycle
 * refusal, deletion), the same split test_notepad_surface.mjs and
 * test_highlight_toggles.mjs use for their own DOM-facing pieces.
 *
 * This file covers the derivable/pure link-listing logic and the
 * text-mutating commit paths (wbLinkDependency/wbCutDependencyNoodle),
 * lifted from the real source with the same vm-sandbox technique
 * test_kanban_board_mutations.mjs uses, so every mutation here is
 * verified by re-parsing the editor's resulting text -- the same way the
 * browser does after a drag or a Delete keypress. The "not summary
 * task/note level" rule itself lives in plan-model.js's
 * canAddDependency() (tested in test_plan_model.mjs) and is exercised
 * here only indirectly, through wbCanLinkDependency()/wbLinkDependency()
 * refusing a summary-task endpoint exactly like any other refusal.
 *
 * Run with: node --test tests/test_whiteboard_dep_noodles.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

/** Top-level `function name(` ... `\n}` declarations from a classic script. */
function liftFunctions(sandbox, file, names) {
    const source = readFileSync(join(staticDir, file), 'utf8');
    for (const name of names) {
        const start = source.indexOf(`\nfunction ${name}(`);
        assert.notEqual(start, -1, `${name} not found in ${file}`);
        const end = source.indexOf('\n}\n', start);
        assert.notEqual(end, -1, `${name} in ${file} has no closing brace at column 0`);
        vm.runInContext(source.slice(start, end + 3), sandbox);
    }
    return sandbox;
}

function makeEditorStub(initialValue) {
    return {
        value: initialValue,
        listeners: {},
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
        dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); return true; },
    };
}

function buildSandbox(planText) {
    const planModelSrc = readFileSync(join(staticDir, 'plan-model.js'), 'utf8');
    const tokenizerSrc = readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8');

    const editor = makeEditorStub(planText);
    const elements = { planEditor: editor };
    const flashMessages = [];
    const sandbox = {
        console,
        document: {
            getElementById: (id) => elements[id] || null,
            querySelector: () => null,
            querySelectorAll: () => [],
        },
        module: { exports: {} },
        wbFlashNoodleMessage: (text) => flashMessages.push(text),
        wbClearDepNoodleSelection: () => {},
        // Minimal stand-in for whiteboard-notes.js's real wbCommitMarkdown:
        // writes the new text and fires 'input', skipping the cache/save
        // side effects this test has no need to exercise.
        wbCommitMarkdown: (nextText) => {
            if (nextText === editor.value) return false;
            editor.value = nextText;
            editor.dispatchEvent({ type: 'input' });
            return true;
        },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(tokenizerSrc + '\nthis.TaskLineTokenizer = TaskLineTokenizer;', sandbox);
    vm.runInContext(planModelSrc, sandbox);
    liftFunctions(sandbox, 'whiteboard-dep-noodles.js', [
        'wbDepNoodleId', 'wbDepNoodleLinksFor', 'wbCanLinkDependency', 'wbLinkDependency', 'wbCutDependencyNoodle',
    ]);
    // whiteboard-noodles.js defines the module-level id separator these
    // functions close over.
    sandbox.WB_DEP_NOODLE_ID_SEP = '';
    return { sandbox, editor, flashMessages };
}

test('wbDepNoodleId is stable and separator-safe (mirrors WB_NOODLE_ID_SEP)', () => {
    const { sandbox } = buildSandbox('');
    const id1 = sandbox.wbDepNoodleId('Plan a', 'b');
    const id2 = sandbox.wbDepNoodleId('Plan', 'a b');
    assert.notEqual(id1, id2, 'a space separator would collide these two distinct pairs');
});

test('wbDepNoodleLinksFor: only explicit (non-shorthand) dependencies, regardless of board membership', () => {
    // #1106: this no longer takes a `rows` (whiteboard-row) argument or
    // filters by it -- a dependency now usually joins two checklist rows
    // *inside* other notes' bodies rather than two note cards of their
    // own, so "is either end actually visible on the board right now" is
    // resolved later, per edge, by wbLayoutDepNoodle() in the browser
    // (wbDepNoodleEndpointRectFor(), DOM-dependent, not unit-tested here)
    // -- this function only lists the plan's explicit dependency edges.
    const text = 'Phase\n  A 1d\n  B 1d [depends: A]\n  *C 1d\n';
    const { sandbox } = buildSandbox(text);
    const model = sandbox.NoodlePlanModel.PlanModel.parse(text);
    const links = sandbox.wbDepNoodleLinksFor(model);
    assert.equal(links.length, 1, 'the * shorthand dependency (C on B) must not render as a dependency noodle');
    assert.equal(links[0].from, 'A');
    assert.equal(links[0].to, 'B');
});

test('wbDepNoodleLinksFor: a dependency whose target no longer resolves is skipped', () => {
    const text = 'Phase\n  A 1d\n  B 1d [depends: A]\n';
    const { sandbox } = buildSandbox(text);
    const model = sandbox.NoodlePlanModel.PlanModel.parse(text);
    // Simulate a dangling reference the way a stale/hand-edited [depends]
    // block could produce it: null out the resolved target on B's own
    // edge so wbDepNoodleLinksFor() has nothing to draw for it.
    model.findByName('B').dependencies[0].target = null;
    const links = sandbox.wbDepNoodleLinksFor(model);
    // links is an Array from the vm sandbox's own realm -- spread it into
    // this realm before comparing, since deepStrictEqual also checks
    // [[Prototype]], which otherwise differs across realms.
    assert.deepEqual([...links], []);
});

test('wbCanLinkDependency: ok for a fresh link, refused for a duplicate or self-link', () => {
    const { sandbox } = buildSandbox('Phase\n  A 1d\n  B 1d\n');
    assert.equal(sandbox.wbCanLinkDependency('A', 'B').ok, true);
    assert.equal(sandbox.wbCanLinkDependency('A', 'A').ok, false);
});

test('wbCanLinkDependency refuses a summary task as either endpoint (#1106)', () => {
    // "Phase" has children (A, B), so it is a summary task -- neither the
    // old whole-card gesture nor the new row-level one may make it (or
    // anything else) depend on it, or make it depend on anything.
    const { sandbox } = buildSandbox('Phase\n  A 1d\n  B 1d\nOther 1d\n');
    const asPredecessor = sandbox.wbCanLinkDependency('Phase', 'Other');
    assert.equal(asPredecessor.ok, false);
    assert.match(asPredecessor.reason, /summary/);
    const asDependent = sandbox.wbCanLinkDependency('Other', 'Phase');
    assert.equal(asDependent.ok, false);
    assert.match(asDependent.reason, /summary/);
});

test('wbLinkDependency refuses a summary-task endpoint and writes nothing (#1106)', () => {
    const { sandbox, editor, flashMessages } = buildSandbox('Phase\n  A 1d\n  B 1d\nOther 1d\n');
    const before = editor.value;
    assert.equal(sandbox.wbLinkDependency('Phase', 'Other'), false);
    assert.equal(editor.value, before);
    assert.equal(flashMessages.length, 1);
    assert.match(flashMessages[0], /summary/);
});

test('wbLinkDependency writes a real [depends: ...] token and returns true', () => {
    const { sandbox, editor } = buildSandbox('Phase\n  A 1d\n  B 1d\n');
    assert.equal(sandbox.wbLinkDependency('A', 'B'), true);
    assert.equal(editor.value, 'Phase\n  A 1d\n  B 1d [depends: A]\n');
});

test('wbLinkDependency refuses and flashes a message rather than silently no-op-ing on a cycle', () => {
    const { sandbox, editor, flashMessages } = buildSandbox('Phase\n  A 1d\n  B 1d [depends: A]\n');
    const before = editor.value;
    assert.equal(sandbox.wbLinkDependency('B', 'A'), false);
    assert.equal(editor.value, before);
    assert.equal(flashMessages.length, 1);
    assert.match(flashMessages[0], /circular/);
});

test('wbLinkDependency refuses a duplicate with a clear reason', () => {
    const { sandbox, flashMessages } = buildSandbox('Phase\n  A 1d\n  B 1d [depends: A]\n');
    assert.equal(sandbox.wbLinkDependency('A', 'B'), false);
    assert.match(flashMessages[0], /already depends/);
});

test('wbCutDependencyNoodle removes the dependency and returns true', () => {
    const { sandbox, editor } = buildSandbox('Phase\n  A 1d\n  B 1d [depends: A]\n');
    assert.equal(sandbox.wbCutDependencyNoodle('A', 'B'), true);
    assert.equal(editor.value, 'Phase\n  A 1d\n  B 1d\n');
});

test('wbCutDependencyNoodle on a nonexistent link is a no-op returning false', () => {
    const { sandbox, editor } = buildSandbox('Phase\n  A 1d\n  B 1d\n');
    const before = editor.value;
    assert.equal(sandbox.wbCutDependencyNoodle('A', 'B'), false);
    assert.equal(editor.value, before);
});

test('link then cut round-trips back to the original text', () => {
    const original = 'Phase\n  A 1d\n  B 1d\n  C 1d\n';
    const { sandbox, editor } = buildSandbox(original);
    assert.equal(sandbox.wbLinkDependency('A', 'C'), true);
    assert.equal(sandbox.wbCutDependencyNoodle('A', 'C'), true);
    assert.equal(editor.value, original);
});
