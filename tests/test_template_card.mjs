/**
 * The portrait template card (#945): template-card.js turns a plan into the
 * skeleton a card draws -- one row per top-level summary task, with its work
 * and its milestones -- and the skeleton into the card's HTML. Runs against
 * the real bundled templates (#946) so a card can never be drawn from a
 * shape the parser does not give it.
 *
 * Run with: node --test tests/test_template_card.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8') +
  '\nthis.TaskLineTokenizer = TaskLineTokenizer;', sandbox);
vm.runInContext(readFileSync(join(staticDir, 'plan-model.js'), 'utf8'), sandbox);
vm.runInContext(readFileSync(join(staticDir, 'template-card.js'), 'utf8'), sandbox);
const { templateSkeletonFromPlan, templateCardShapeHtml } = sandbox;

const j = (v) => JSON.parse(JSON.stringify(v));

test('a phase is a top-level summary task; milestones are its zero-duration leaves', () => {
  const skeleton = j(templateSkeletonFromPlan([
    'Build',
    '  Design 3d',
    '  Code 5d',
    '  Feature complete 0d',
    'Ship',
    '  Release 1d',
    '  Live 0days',
    '  Handed over 0d',
    '',
  ].join('\n')));
  assert.deepEqual(skeleton.phases, [
    { title: 'Build', work: 2, milestones: ['Feature complete'] },
    { title: 'Ship', work: 1, milestones: ['Live', 'Handed over'] },
  ]);
  assert.equal(skeleton.tasks, 6);
  assert.equal(skeleton.milestones, 3);
});

test('work counts leaves through nested summaries, not just direct children', () => {
  const skeleton = j(templateSkeletonFromPlan('Phase\n  Group\n    A 1d\n    B 1d\n  C 1d\n'));
  assert.equal(skeleton.phases[0].work, 3);
});

test('a plan with no summary tasks has no phases and falls back to its task count', () => {
  const skeleton = j(templateSkeletonFromPlan('A 1d\nB 1d\nC 0d\n'));
  assert.deepEqual(skeleton.phases, []);
  assert.equal(skeleton.tasks, 3);
  assert.match(templateCardShapeHtml(skeleton), /3 tasks/);
});

test('front matter and back matter are not tasks', () => {
  const skeleton = j(templateSkeletonFromPlan(
    '---\ntitle: T\n---\nPhase\n  A 1d\n\n---whiteboard---\n| Task | X |\n|---|---|\n| A | 1 |\n'));
  assert.equal(skeleton.tasks, 1);
});

test('the card has a row per phase, a bubble per milestone, and escapes names', () => {
  const html = templateCardShapeHtml(j(templateSkeletonFromPlan('<b>Phase</b>\n  Do it 2d\n  Done 0d\n')));
  assert.equal((html.match(/backstage-card-row"/g) || []).length, 1);
  assert.equal((html.match(/backstage-card-bubble"/g) || []).length, 1);
  assert.ok(!html.includes('<b>'), 'task names are escaped');
  assert.match(html, /&lt;b&gt;Phase&lt;\/b&gt;/);
  assert.match(html, /1 phase · 1 milestone</);
});

test('rows and bubbles are capped with a "+N" overflow', () => {
  const phases = Array.from({ length: 10 }, (_, i) => `Phase ${i}\n  Task ${i} 1d\n`).join('');
  const html = templateCardShapeHtml(j(templateSkeletonFromPlan(phases)));
  assert.equal((html.match(/backstage-card-row"/g) || []).length, 7);
  assert.match(html, /\+3 more/);

  const miles = 'Phase\n  Work 1d\n' + Array.from({ length: 8 }, (_, i) => `  M${i} 0d\n`).join('');
  const many = templateCardShapeHtml(j(templateSkeletonFromPlan(miles)));
  assert.equal((many.match(/backstage-card-bubble"/g) || []).length, 5);
  assert.match(many, />\+3</);
});

test('the busiest phase gets the longest bar and no bar is thinner than the minimum', () => {
  const html = templateCardShapeHtml(j(templateSkeletonFromPlan(
    'Big\n' + '  T 1d\n'.repeat(20) + 'Tiny\n  T 1d\n')));
  const widths = [...html.matchAll(/--backstage-card-bar:(\d+)%/g)].map(m => Number(m[1]));
  assert.deepEqual(widths, [100, 12]);
});

test('every bundled template draws a card, and no two templates draw the same one', () => {
  const dir = join(repo, 'templates');
  const shapes = new Map();
  for (const id of readdirSync(dir)) {
    const planPath = join(dir, id, 'plan.md');
    if (!existsSync(planPath)) continue;
    const skeleton = j(templateSkeletonFromPlan(readFileSync(planPath, 'utf8')));
    assert.ok(skeleton.phases.length >= 2, `${id} should have at least two phases`);
    const html = templateCardShapeHtml(skeleton);
    for (const other of shapes.values()) assert.notEqual(html, other, `${id} looks like another template`);
    shapes.set(id, html);
  }
  assert.ok(shapes.size >= 6);
  assert.ok(shapes.has('software-deployment'));
});
