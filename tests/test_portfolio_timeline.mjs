/**
 * Portfolio timeline markup (static/portfolio-timeline.js): the swimlane row
 * packing, the date-scale header, each project's SVG lane and the whole
 * markup the view and the PowerPoint export share (#1276).
 *
 * Classic script of top-level functions, lifted into a vm sandbox with
 * escapeHtml from state.js. The clock is pinned so the today marker is
 * deterministic.
 *
 * Run with: node --test tests/test_portfolio_timeline.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

process.env.TZ = 'UTC';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const source = readFileSync(join(staticDir, 'portfolio-timeline.js'), 'utf8');
const stateSrc = readFileSync(join(staticDir, 'state.js'), 'utf8');

function extract(src, name) {
    const start = src.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    return src.slice(start, src.indexOf('\n}\n', start) + 3);
}

const TODAY = new Date(2026, 5, 10);
class FakeDate extends Date {
    constructor(...args) { args.length ? super(...args) : super(TODAY); }
    static now() { return TODAY.getTime(); }
}

function load() {
    const sandbox = { Date: FakeDate, console, Math, String, Number, parseFloat, window: {} };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(extract(stateSrc, 'escapeHtml') + '\n' + source, sandbox);
    return sandbox;
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const d = (s) => new Date(s);
const ms = (s) => d(s).getTime();

function project(id, name, tasks, success = true) {
    return { project: { id, name }, parsedResult: { success, tasks } };
}

// ── assignSwimlanePhaseRows ─────────────────────────────────────────────

test('non-overlapping phases share row 0 in start order', () => {
    const { assignSwimlanePhaseRows } = load();
    const rows = plain(assignSwimlanePhaseRows([
        { name: 'B', start: '2026-03-01', finish: '2026-04-01' },
        { name: 'A', start: '2026-01-01', finish: '2026-02-01' },
    ], d('2026-01-01'), ms('2026-06-01') - ms('2026-01-01')));
    assert.deepEqual(rows.map((r) => [r.phase.name, r.row]), [['A', 0], ['B', 0]]);
    assert.equal(rows[0].startMs, ms('2026-01-01'));
    assert.equal(rows[0].endMs, ms('2026-02-01'));
});

test('overlapping phases are pushed to new rows, and rows are reused once free', () => {
    const { assignSwimlanePhaseRows } = load();
    const rows = plain(assignSwimlanePhaseRows([
        { name: 'A', start: '2026-01-01', finish: '2026-03-01' },
        { name: 'B', start: '2026-02-01', finish: '2026-04-01' },   // overlaps A → row 1
        { name: 'C', start: '2026-02-15', finish: '2026-05-01' },   // overlaps A and B → row 2
        { name: 'D', start: '2026-03-01', finish: '2026-03-15' },   // A ended → back on row 0
    ], d('2026-01-01'), 1));
    assert.deepEqual(rows.map((r) => [r.phase.name, r.row]), [['A', 0], ['B', 1], ['C', 2], ['D', 0]]);
});

test('a phase starting exactly when the previous one ends shares its row', () => {
    const { assignSwimlanePhaseRows } = load();
    const rows = plain(assignSwimlanePhaseRows([
        { name: 'A', start: '2026-01-01', finish: '2026-02-01' },
        { name: 'B', start: '2026-02-01', finish: '2026-03-01' },
    ], d('2026-01-01'), 1));
    assert.deepEqual(rows.map((r) => r.row), [0, 0]);
    assert.equal(assignSwimlanePhaseRows([], d('2026-01-01'), 1).length, 0);
});

// ── renderTimelineScale ─────────────────────────────────────────────────

test('the months scale emits one item per calendar month, clamped at the left edge', () => {
    const { renderTimelineScale } = load();
    const html = renderTimelineScale(d('2026-01-15'), d('2026-03-20'), 'months');
    assert.ok(html.startsWith('<div class="timeline-scale"><div class="timeline-project-label">Project</div>'));
    const items = html.match(/<div class="timeline-scale-item"[^>]*>[^<]*<\/div>/g);
    assert.deepEqual(items.map((i) => i.replace(/<[^>]+>/g, '')), ['Jan 2026', 'Feb 2026', 'Mar 2026']);
    // January started before the range: its left is clamped to 0.
    assert.match(items[0], /style="left:0%; width:/);
    assert.match(items[1], /style="left:(\d+(\.\d+)?)%; width:/);
    assert.ok(html.endsWith('</div></div>'));
});

test('the quarters and years scales label their periods', () => {
    const { renderTimelineScale } = load();
    const labels = (html) => html.match(/<div class="timeline-scale-item"[^>]*>([^<]*)<\/div>/g)
        .map((i) => i.replace(/<[^>]+>/g, ''));
    assert.deepEqual(labels(renderTimelineScale(d('2026-02-01'), d('2026-10-01'), 'quarters')),
        ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
    assert.deepEqual(labels(renderTimelineScale(d('2025-11-01'), d('2026-02-01'), 'years')),
        ['2025', '2026']);
});

test('an unknown scale renders an empty track', () => {
    const { renderTimelineScale } = load();
    const html = renderTimelineScale(d('2026-01-01'), d('2026-06-01'), 'weeks');
    assert.ok(!html.includes('timeline-scale-item'));
});

// ── renderProjectSwimlane ───────────────────────────────────────────────

const lane = {
    projectId: 'p1', projectName: 'Alpha <"&">',
    phases: [
        { name: 'Build', start: '2026-01-01', finish: '2026-04-01', percent: 50 },
        { name: 'Test', start: '2026-04-01', finish: '2026-07-01', percent: 100 },
    ],
    milestones: [{ name: 'Go <live>', finish: '2026-07-01', percent: 0 }],
    overallPercent: 60,
};

test('a swimlane escapes the project name and opens its dashboard on click', () => {
    const { renderProjectSwimlane } = load();
    const html = renderProjectSwimlane(lane, d('2026-01-01'), d('2026-07-01'));
    assert.ok(html.startsWith('<div class="timeline-project-row" onclick="openProjectDashboard(\'p1\')">'));
    assert.ok(html.includes('title="Alpha &lt;&quot;&amp;&quot;&gt;">Alpha &lt;&quot;&amp;&quot;&gt;</div>'));
    assert.ok(html.endsWith('</svg></div></div>'));
});

test('phase bars are positioned as percentages of the global range with progress overlays', () => {
    const { renderProjectSwimlane } = load();
    const html = renderProjectSwimlane(lane, d('2026-01-01'), d('2026-07-01'));
    const bars = html.match(/<rect [^>]*class="swimlane-phase-bar">/g);
    // Build: background + 50% overlay; Test: complete, background only.
    assert.equal(bars.length, 3);
    assert.match(bars[0], /x="0%" y="4" width="49\.7\d*%"/);
    assert.ok(bars[0].includes('opacity="0.7"'));
    assert.match(bars[1], /x="0%" y="4" width="24\.8\d*%"/);        // half of the bar
    assert.ok(bars[1].includes('fill="#4caf50" opacity="0.85"'));
    assert.ok(bars[2].includes('fill="#4caf50" opacity="0.9"'));   // complete
    assert.ok(html.includes('<title>Build (50% complete)</title>'));
    assert.ok(html.includes('<tspan>✓ Test</tspan>'));
    assert.ok(html.includes('<tspan>Build</tspan>'));
});

test('milestones sit on the backbone with an escaped title, and progress is drawn along it', () => {
    const { renderProjectSwimlane } = load();
    const html = renderProjectSwimlane(lane, d('2026-01-01'), d('2026-07-01'));
    // Both phases fit on one row: backbone at 1*(28+6)+4+16 = 54.
    assert.ok(html.includes('<line x1="0" y1="54" x2="100%" y2="54" stroke="#bbb"'));
    assert.ok(html.includes('<line x1="0" y1="54" x2="60%" y2="54" stroke="#4caf50"'));
    assert.ok(html.includes('<title>Overall progress: 60%</title>'));
    assert.match(html, /<circle cx="100%" cy="54" r="7" fill="#1976d2"[^>]*class="swimlane-milestone-dot"><title>Go &lt;live&gt; \(2026-07-01\)<\/title>/);
    assert.ok(html.includes('height="65"'));   // 54 + 7 + 4
});

test('overlapping phases raise the lane and narrow bars get no label', () => {
    const { renderProjectSwimlane } = load();
    const html = renderProjectSwimlane({
        projectId: 'p', projectName: 'P', overallPercent: 0, milestones: [],
        phases: [
            { name: 'Long', start: '2026-01-01', finish: '2026-12-01', percent: 0 },
            { name: 'Tiny', start: '2026-02-01', finish: '2026-02-03', percent: 0 },
        ],
    }, d('2026-01-01'), d('2026-12-01'));
    assert.ok(html.includes('y2="88"'));             // two rows: 2*34+4+16
    assert.ok(html.includes('<tspan>Long</tspan>'));
    assert.ok(!html.includes('<tspan>Tiny</tspan>'));
    assert.ok(html.includes('y="38"'));              // second row bar
    assert.ok(!html.includes('stroke="#4caf50"'));   // no progress line at 0%
});

// ── buildPortfolioTimelineMarkup ────────────────────────────────────────

test('one lane per project with date data, spanning the global range', () => {
    const { buildPortfolioTimelineMarkup } = load();
    const built = buildPortfolioTimelineMarkup([
        project('a', 'Alpha', [
            { name: 'Phase', is_summary: true, start: '2026-01-01', finish: '2026-03-01', percent: 0 },
            { name: 'Task', start: '2026-01-01', finish: '2026-03-01', percent: 40, duration_days: 10 },
        ]),
        project('b', 'Beta', [
            { name: 'Launch', duration_days: 0, start: '2026-08-01', finish: '2026-08-01', percent: 0 },
            { name: 'Other', start: '2026-05-01', finish: '2026-05-10', percent: 100, duration_days: 7 },
        ]),
        project('c', 'No dates', [{ name: 'x', duration_days: 3 }]),
        project('d', 'Failed', [{ name: 'Phase', is_summary: true, start: '2025-01-01', finish: '2025-02-01' }], false),
    ], 'months');
    assert.deepEqual(plain(built.timelines.map((t) => [t.projectName, t.phases.length, t.milestones.length, t.overallPercent])),
        [['Alpha', 1, 0, 40], ['Beta', 0, 1, 50]]);
    assert.equal(built.globalStart.toISOString().slice(0, 10), '2026-01-01');
    assert.equal(built.globalEnd.toISOString().slice(0, 10), '2026-08-01');
    assert.equal((built.html.match(/class="timeline-project-row"/g) || []).length, 2);
    assert.ok(built.html.startsWith('<div class="portfolio-timeline-wrapper"><div class="portfolio-timeline-container"'));
    assert.ok(built.html.includes('<div class="timeline-scale">'));
    // The pinned today (10 June) lies inside the range: a marker is drawn.
    assert.match(built.html, /<div class="portfolio-today-line" style="left: calc\(200px \+ \(100% - 200px\) \* 0\.7\d+\);"><\/div>/);
});

test('returns null when no project has phases or milestones', () => {
    const { buildPortfolioTimelineMarkup } = load();
    assert.equal(buildPortfolioTimelineMarkup([
        project('a', 'A', [{ name: 'leaf', start: '2026-01-01', finish: '2026-02-01', duration_days: 5 }]),
        { project: { id: 'b', name: 'B' }, parsedResult: null },
    ]), null);
    assert.equal(buildPortfolioTimelineMarkup([]), null);
});

test('no today marker outside the range, and the module scale is the default', () => {
    const { buildPortfolioTimelineMarkup } = load();
    const built = buildPortfolioTimelineMarkup([
        project('a', 'A', [{ name: 'P', is_summary: true, start: '2020-01-01', finish: '2020-06-01' }]),
    ]);
    assert.ok(!built.html.includes('portfolio-today-line'));
    assert.ok(built.html.includes('>Jan 2020</div>'));   // months by default
});
