// Tests for the parse-once in-memory plan model (issue #905, sub-issues
// #914 node model / #915 parser / #916 serialiser).
//
// The single most important test here is the round-trip corpus check at
// the bottom: every fixture in tests/fixtures/roundtrip/ and
// tests/fixtures/conformance/ must come back byte-identical from
// parsePlan -> serializePlan with no edits. See plan-model.js's header
// comment for the design this is testing.
//
// Run with: node --test tests/test_plan_model.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import {
  parsePlan,
  serializePlan,
  formatTaskLine,
  tokenizeTaskLine,
  taskLineMetadata,
  TaskNode,
} from '../packages/noodle-web/src/noodle_web/static/plan-model.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const roundtripDir = join(repo, 'tests', 'fixtures', 'roundtrip');
const conformanceDir = join(repo, 'tests', 'fixtures', 'conformance');

// --- the real TaskLineTokenizer, lifted from the classic <script>, to
// cross-check plan-model.js's deliberately-duplicated copy for drift.
// Run with vm.runInThisContext (same realm as this module), NOT
// runInNewContext (a sandbox object) -- a different realm gives its
// plain objects/arrays a different Array/Object prototype than this
// module's, which trips assert.deepEqual's cross-realm guard even when
// the values are structurally identical. ---
const realTokenizerSource = readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8');
vm.runInThisContext(realTokenizerSource + '\nglobalThis.__RealTaskLineTokenizer = TaskLineTokenizer;');
const RealTaskLineTokenizer = globalThis.__RealTaskLineTokenizer;
delete globalThis.__RealTaskLineTokenizer;

// =====================================================================
// Grammar parity: plan-model.js's duplicated tokenizer must extract the
// same fields as the real TaskLineTokenizer (task-tokenizer.js), for
// every task line in the whole fixture corpus -- the one deliberate,
// documented exception being `duration`, which this module keeps its
// unit letter for (see plan-model.js's header comment).
// =====================================================================

function allTaskLines() {
  const lines = [];
  for (const dir of [roundtripDir, conformanceDir]) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const text = readFileSync(join(dir, name), 'utf8');
      const model = parsePlan(text);
      for (const node of model.nodes) lines.push({ file: name, raw: node.raw });
    }
  }
  return lines;
}

test('taskLineMetadata matches the real TaskLineTokenizer field-for-field (except two documented deviations)', () => {
  const lines = allTaskLines();
  assert.ok(lines.length > 50, 'expected a substantial number of task lines across the corpus');
  for (const { file, raw } of lines) {
    const mine = taskLineMetadata(raw);
    const real = RealTaskLineTokenizer.metadata(raw).values;
    for (const key of Object.keys(real)) {
      // deliberate deviations -- see plan-model.js's header doc
      if (key === 'duration') continue;
      if (key === 'product_type') { assert.equal(mine.productType, real.product_type, file); continue; }
      assert.deepEqual(mine[key], real[key], `${file}: ${JSON.stringify(raw)} field "${key}" diverged`);
    }
    // the duration deviation itself: same digits, unit letter kept (the
    // real tokenizer's `duration` has already dropped it)
    assert.equal(mine.duration.replace(/[dmwy]$/, ''), real.duration, `${file}: ${JSON.stringify(raw)} duration digits diverged`);
    if (mine.duration) assert.match(mine.duration, /^\d+[dmwy]$/, `${file}: ${JSON.stringify(raw)} duration missing unit letter`);
  }
});

test('tokenizeTaskLine matches the real tokenizer token-for-token', () => {
  const lines = allTaskLines();
  for (const { file, raw } of lines) {
    const mine = tokenizeTaskLine(raw);
    const real = RealTaskLineTokenizer.tokenize(raw);
    assert.deepEqual(mine, real, `${file}: ${JSON.stringify(raw)} tokens diverged`);
  }
});

// =====================================================================
// TaskNode / tree structure
// =====================================================================

test('TaskNode captures every inline token type', () => {
  const model = parsePlan('Task $deliverable 5d 2026-01-01 2026-01-10 40% @kev @adam !! ~2h/8h {Bucket} [depends Other:SS +1d, Another] [repeats weekly mon] #urgent "a note"\n');
  const node = model.nodes[0];
  assert.equal(node.name, 'Task');
  assert.equal(node.duration, '5d');
  assert.equal(node.startDate, '2026-01-01');
  assert.equal(node.finishDate, '2026-01-10');
  assert.deepEqual(node.resources, ['kev', 'adam']);
  assert.equal(node.priority, 'Important');
  assert.equal(node.effortCompleted, '2');
  assert.equal(node.effortCompletedUnit, 'h');
  assert.equal(node.effortTotal, '8');
  assert.equal(node.effortTotalUnit, 'h');
  assert.equal(node.bucket, 'Bucket');
  assert.deepEqual(node.dependencies, ['Other:SS +1d', 'Another']);
  assert.equal(node.recurrence, 'weekly mon');
  assert.deepEqual(node.labels, ['urgent']);
  assert.equal(node.comment, 'a note');
  assert.equal(node.productType, 'internal');
  assert.equal(node.deliverable, 'deliverable');
  // percent is overridden by the effort-derived value (25%), same as
  // TaskLineTokenizer.metadata -- the literal 40% token is consumed as
  // part of removable text either way.
  assert.equal(node.percent, '25');
});

test('deliverable sigils map to product types', () => {
  const model = parsePlan('A $internal 1d\nB /$grouped 1d\nC ^$external 1d\n');
  assert.equal(model.nodes[0].productType, 'internal');
  assert.equal(model.nodes[1].productType, 'group');
  assert.equal(model.nodes[2].productType, 'external');
});

test('star shorthand is captured raw, not resolved', () => {
  const model = parsePlan('A 1d\n*B 2d\n*+3d C 2d\n');
  assert.equal(model.nodes[0].hasStar, false);
  assert.equal(model.nodes[1].hasStar, true);
  assert.equal(model.nodes[1].starLagLead, '');
  assert.equal(model.nodes[2].hasStar, true);
  assert.equal(model.nodes[2].starLagLead, '+3d');
  assert.equal(model.nodes[2].name, 'C');
  // deliberately not resolved into a predecessor reference -- see
  // plan-model.js's TaskNode.hasStar doc
  assert.deepEqual(model.nodes[2].dependencies, []);
});

test('indent/parent-child tree structure for a nested outline', () => {
  const text = [
    'Phase 1',
    '  Task A 1d',
    '  Task B 2d',
    '    Subtask B1 1d',
    'Phase 2',
    '  Task C 1d',
  ].join('\n') + '\n';
  const model = parsePlan(text);
  assert.equal(model.roots.length, 2);
  const [phase1, phase2] = model.roots;
  assert.equal(phase1.name, 'Phase 1');
  assert.equal(phase1.children.length, 2);
  assert.equal(phase1.isSummary, true);
  const [taskA, taskB] = phase1.children;
  assert.equal(taskA.name, 'Task A');
  assert.equal(taskA.isSummary, false);
  assert.equal(taskA.parent, phase1);
  assert.equal(taskB.children.length, 1);
  assert.equal(taskB.isSummary, true);
  assert.equal(taskB.children[0].name, 'Subtask B1');
  assert.equal(taskB.children[0].parent, taskB);
  assert.equal(phase2.name, 'Phase 2');
  assert.equal(phase2.children[0].name, 'Task C');

  // ids: ancestor chain joined by ' › '
  assert.equal(phase1.id, 'Phase 1');
  assert.equal(taskA.id, 'Phase 1 › Task A');
  assert.equal(taskB.children[0].id, 'Phase 1 › Task B › Subtask B1');
});

test('isSummary stays live if children are mutated after the fact', () => {
  const model = parsePlan('A 1d\n');
  const node = model.nodes[0];
  assert.equal(node.isSummary, false);
  node.children.push(new TaskNode('  fake child', 1));
  assert.equal(node.isSummary, true);
});

test('duplicate sibling names are disambiguated in id, matching #838\'s fix elsewhere', () => {
  const text = 'Phase\n  Design\n    Wireframe 2d\n  Design\n    Wireframe 1d\n';
  const model = parsePlan(text);
  const designs = model.roots[0].children;
  assert.equal(designs.length, 2);
  assert.equal(designs[0].id, 'Phase › Design');
  assert.equal(designs[1].id, 'Phase › Design#2');
  assert.equal(designs[0].children[0].id, 'Phase › Design › Wireframe');
  assert.equal(designs[1].children[0].id, 'Phase › Design#2 › Wireframe');
});

test('blank lines and // comment lines are preserved but not modelled as tasks', () => {
  const text = '// a leading comment\n\nA 1d\n\n// another comment\nB 2d\n';
  const model = parsePlan(text);
  assert.equal(model.nodes.length, 2);
  // text.split('\n') on a trailing-newline string yields a final '' entry
  // -- that's a real (blank) line in the model too, so round-tripping the
  // trailing newline works.
  assert.equal(model.lines.length, 7);
  assert.equal(model.lines[0].kind, 'comment');
  assert.equal(model.lines[1].kind, 'blank');
  assert.equal(model.lines[2].kind, 'task');
  assert.equal(model.lines[3].kind, 'blank');
  assert.equal(model.lines[4].kind, 'comment');
  assert.equal(model.lines[5].kind, 'task');
  assert.equal(model.lines[6].kind, 'blank');
  assert.equal(serializePlan(model), text);
});

test('lineIndex accounts for front matter lines preceding the outline', () => {
  const text = '---\ntitle: T\n---\nA 1d\n  B 2d\n';
  const model = parsePlan(text);
  assert.equal(model.nodes[0].lineIndex, 3);
  assert.equal(model.nodes[1].lineIndex, 4);
  assert.equal(text.split('\n')[model.nodes[0].lineIndex], 'A 1d');
  assert.equal(text.split('\n')[model.nodes[1].lineIndex], '  B 2d');
});

test('empty plan and single task edge cases', () => {
  const empty = parsePlan('');
  assert.deepEqual(empty.roots, []);
  assert.deepEqual(empty.nodes, []);

  const single = parsePlan('Only task 1d\n');
  assert.equal(single.nodes.length, 1);
  assert.equal(single.roots.length, 1);
  assert.equal(single.roots[0].name, 'Only task');
});

test('deeply nested outline builds a correct chain', () => {
  const depth = 8;
  const lines = [];
  for (let i = 0; i < depth; i++) lines.push('  '.repeat(i) + `Level ${i} 1d`);
  const model = parsePlan(lines.join('\n') + '\n');
  assert.equal(model.roots.length, 1);
  let node = model.roots[0];
  for (let i = 0; i < depth; i++) {
    assert.equal(node.name, `Level ${i}`);
    assert.equal(node.indent, i * 2);
    node = node.children[0];
  }
});

// =====================================================================
// formatTaskLine: canonical, best-effort, NOT the round-trip guarantee
// =====================================================================

test('formatTaskLine reconstructs a plausible line from fields', () => {
  const model = parsePlan('Task 5d @kev 40% !! #urgent "a note"\n');
  const node = model.nodes[0];
  const formatted = formatTaskLine(node);
  const reparsed = parsePlan(formatted + '\n').nodes[0];
  assert.equal(reparsed.name, node.name);
  assert.equal(reparsed.duration, node.duration);
  assert.deepEqual(reparsed.resources, node.resources);
  assert.equal(reparsed.percent, node.percent);
  assert.equal(reparsed.priority, node.priority);
  assert.deepEqual(reparsed.labels, node.labels);
  assert.equal(reparsed.comment, node.comment);
});

test('formatTaskLine preserves indent', () => {
  const model = parsePlan('Phase\n    Deep task 1d\n');
  const node = model.roots[0].children[0];
  assert.equal(formatTaskLine(node), '    Deep task 1d');
});

// =====================================================================
// Round-trip guarantee: the single most important test in this suite.
// parse -> serialise with NO edits must be byte-identical for every
// fixture in the real corpus (not fixtures invented for this task).
// =====================================================================

function corpusFiles() {
  const files = [];
  for (const dir of [roundtripDir, conformanceDir]) {
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith('.md')) files.push(join(dir, name));
    }
  }
  return files;
}

const corpus = corpusFiles();

test('round-trip corpus is non-trivial', () => {
  const roundtripCount = readdirSync(roundtripDir).filter((n) => n.endsWith('.md')).length;
  // The conformance corpus pairs each .md fixture with a .expected.json
  // (16 files total, 8 of them .md) -- see tests/test_engine_conformance.mjs.
  const conformanceCount = readdirSync(conformanceDir).filter((n) => n.endsWith('.md')).length;
  assert.equal(roundtripCount, 9, 'tests/fixtures/roundtrip should hold 9 fixtures');
  assert.equal(conformanceCount, 8, 'tests/fixtures/conformance should hold 8 .md fixtures');
});

for (const path of corpus) {
  test(`round-trip: ${path.replace(repo + '/', '')} is byte-identical after parse -> serialise with no edits`, () => {
    const text = readFileSync(path, 'utf8');
    const model = parsePlan(text);
    const out = serializePlan(model);
    assert.equal(out, text);
  });
}

test('round-trip holds even when the plan has no front matter', () => {
  const text = readFileSync(join(roundtripDir, 'no-front-matter.md'), 'utf8');
  const model = parsePlan(text);
  assert.equal(model.frontMatterRaw, '');
  assert.equal(serializePlan(model), text);
});

test('round-trip holds for a file with no trailing newline', () => {
  const text = readFileSync(join(roundtripDir, 'whitespace-edges.md'), 'utf8');
  assert.ok(!text.endsWith('\n'));
  const model = parsePlan(text);
  assert.equal(serializePlan(model), text);
});

test('front matter, task outline, and back matter concatenate back to the exact original text (split identity)', () => {
  for (const path of corpus) {
    const text = readFileSync(path, 'utf8');
    const model = parsePlan(text);
    assert.equal(model.frontMatterRaw + model.taskOutlineRaw + model.backMatterRaw, text, path);
  }
});
