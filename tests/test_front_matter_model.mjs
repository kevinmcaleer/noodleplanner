import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import planModelModule from '../packages/noodle-web/src/noodle_web/static/plan-model.js';
import frontMatterModule from '../packages/noodle-web/src/noodle_web/static/front-matter-model.js';

const { PlanModel } = planModelModule;
const FM = frontMatterModule;
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function parseFm(text) {
    const model = PlanModel.parse(text);
    const { present, rows, loc } = FM.parseFromLeading(model.leading);
    return { model, present, rows, loc };
}

function reserialize(model, loc, rows) {
    FM.applyToLeading(model.leading, loc, rows);
    return model.serialize();
}

test('every real plan front matter round-trips byte for byte unedited', () => {
    const paths = [
        ...readdirSync(join(repo, 'templates'), { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => join(repo, 'templates', entry.name, 'plan.md')),
        ...readdirSync(join(repo, 'tests', 'fixtures', 'roundtrip'))
            .filter(name => name.endsWith('.md'))
            .map(name => join(repo, 'tests', 'fixtures', 'roundtrip', name)),
    ];
    let checked = 0;
    for (const path of paths) {
        let text;
        try { text = readFileSync(path, 'utf8'); } catch { continue; }
        const { model, present, rows, loc } = parseFm(text);
        if (!present) continue;
        checked++;
        assert.equal(reserialize(model, loc, rows), text, path);
    }
    assert.ok(checked > 0, 'expected at least one fixture with front matter');
});

test('editing one scalar key leaves every other line byte-identical', () => {
    const text = [
        '---',
        '# a leading comment',
        'title: My Project',
        '',
        'sponsor: CEO   # exec sponsor',
        'status: Green',
        '---',
        '',
        'Phase',
        '  Task 1d',
        '',
    ].join('\n');
    const { model, rows, loc } = parseFm(text);
    const titleRow = rows.find(r => r.kind === 'kv' && r.key === 'title');
    FM.setScalarValue(titleRow, 'Renamed Project');
    const result = reserialize(model, loc, rows);
    const expected = text.replace('title: My Project', 'title: Renamed Project');
    assert.equal(result, expected);
});

test('editing a value preserves its trailing inline comment', () => {
    const text = '---\nsponsor: CEO   # exec sponsor\n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    const row = rows.find(r => r.kind === 'kv' && r.key === 'sponsor');
    FM.setScalarValue(row, 'CFO');
    const result = reserialize(model, loc, rows);
    assert.equal(result, '---\nsponsor: CFO   # exec sponsor\n---\nPhase\n  Task 1d\n');
});

test('unknown keys are preserved and remain editable, never dropped', () => {
    const text = '---\ntitle: My Project\nx-custom-field: some value\n---\nPhase\n  Task 1d\n';
    const { rows } = parseFm(text);
    const custom = rows.find(r => r.kind === 'kv' && r.key === 'x-custom-field');
    assert.ok(custom, 'unknown key must be parsed as a row');
    assert.equal(custom.value, 'some value');
    assert.equal(FM.schemaFor(custom.key), null);
});

test('duplicate keys are preserved as separate rows, not merged', () => {
    const text = '---\ntitle: First\ntitle: Second\n---\nPhase\n  Task 1d\n';
    const { rows } = parseFm(text);
    const titles = rows.filter(r => r.kind === 'kv' && r.key === 'title');
    assert.equal(titles.length, 2);
    assert.equal(titles[0].value, 'First');
    assert.equal(titles[1].value, 'Second');
});

test('empty values round-trip and can be filled in', () => {
    const text = '---\ntitle:\nsponsor: \n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    const title = rows.find(r => r.kind === 'kv' && r.key === 'title');
    const sponsor = rows.find(r => r.kind === 'kv' && r.key === 'sponsor');
    assert.equal(title.value, '');
    assert.equal(sponsor.value, '');
    assert.equal(reserialize(model, loc, rows), text);
    FM.setScalarValue(title, 'Now Set');
    assert.equal(reserialize(model, loc, rows).split('\n')[1], 'title: Now Set');
});

test('quoted string values decode and unedited lines stay byte-identical', () => {
    const text = '---\ntitle: "Quoted: Title # not a comment"\nsponsor: \'O\'\'Brien\'\n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    const title = rows.find(r => r.kind === 'kv' && r.key === 'title');
    const sponsor = rows.find(r => r.kind === 'kv' && r.key === 'sponsor');
    assert.equal(title.value, 'Quoted: Title # not a comment');
    assert.equal(sponsor.value, "O'Brien");
    assert.equal(reserialize(model, loc, rows), text);
});

test('unicode values round-trip unedited and survive editing', () => {
    const text = '---\ntitle: Café Résumé 🚀\n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    assert.equal(reserialize(model, loc, rows), text);
    const title = rows.find(r => r.kind === 'kv' && r.key === 'title');
    FM.setScalarValue(title, 'Café Édition Deux');
    assert.equal(reserialize(model, loc, rows), '---\ntitle: Café Édition Deux\n---\nPhase\n  Task 1d\n');
});

test('nested maps (dependencies) parse, edit and serialize without disturbing siblings', () => {
    const text = [
        '---',
        'title: Programme Child',
        'dependencies:',
        '  - from: Infra Project',
        '    task: Server Setup Complete',
        '    to_task: Backend Integration',
        '    type: FS',
        '    lag: 0',
        'sponsor: CEO',
        '---',
        'Phase',
        '  Task 1d',
        '',
    ].join('\n');
    const { model, rows, loc } = parseFm(text);
    const depRow = rows.find(r => r.kind === 'block' && r.key === 'dependencies');
    const entries = FM.DependencyList.parse(depRow.children);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].from, 'Infra Project');
    entries.push({ from: 'Design Project', task: 'Brand Guidelines Approved', to_task: 'UI Development', type: 'SS', lag: 2 });
    FM.setBlockChildTexts(depRow, FM.DependencyList.serialize(entries));
    const result = reserialize(model, loc, rows);
    assert.match(result, /title: Programme Child/);
    assert.match(result, /sponsor: CEO/);
    assert.match(result, /from: Design Project/);
    assert.match(result, /lag: 2/);
});

test('list under a key (Resources, no indent) parses and round-trips', () => {
    const text = [
        '---',
        'title: Software Development Project',
        'Resources:',
        '- @dev: Lead Developer, Software Engineer',
        '- @qa: QA Engineer, Quality Assurance Specialist',
        'labels: [software, development, agile]',
        '---',
        'Phase',
        '  Task 1d',
        '',
    ].join('\n');
    const { model, rows, loc } = parseFm(text);
    assert.equal(reserialize(model, loc, rows), text);
    const resources = rows.find(r => r.kind === 'block' && r.key === 'resources');
    const entries = FM.ResourceList.parse(resources.children);
    assert.deepEqual(entries, [
        { shortName: 'dev', description: 'Lead Developer, Software Engineer' },
        { shortName: 'qa', description: 'QA Engineer, Quality Assurance Specialist' },
    ]);
    const labels = rows.find(r => r.kind === 'kv' && r.key === 'labels');
    assert.deepEqual(FM.FlowList.parse(labels.value), ['software', 'development', 'agile']);
});

test('named non-working-days list parses and serializes with ranges', () => {
    const text = [
        '---',
        'non-working-days:',
        '  - Christmas: 2026-12-25:2026-12-26',
        '  - New Year: 2027-01-01',
        '---',
        'Phase',
        '  Task 1d',
        '',
    ].join('\n');
    const { rows } = parseFm(text);
    const nwd = rows.find(r => r.kind === 'block' && r.key === 'non-working-days');
    const entries = FM.DateList.parse(nwd.children);
    assert.deepEqual(entries, [
        { name: 'Christmas', start: '2026-12-25', finish: '2026-12-26' },
        { name: 'New Year', start: '2027-01-01', finish: '' },
    ]);
});

test('calendars list (#1047, #1135) parses week pattern, hours and exceptions into flat fields', () => {
    const text = [
        '---',
        'calendar: Fortnight Ops',
        'calendars:',
        '- Standard: Mon-Fri',
        '- Night Shift: Sun-Thu hours 22:00-06:00',
        '- Fortnight Ops: [Mon-Fri; Mon-Wed] hours 08:00-16:30 exceptions [Christmas: 2026-12-25:2026-12-26]',
        '---',
        'Phase',
        '  Task 1d',
        '',
    ].join('\n');
    const { model, rows, loc } = parseFm(text);
    assert.equal(reserialize(model, loc, rows), text);

    const calendars = rows.find(r => r.kind === 'block' && r.key === 'calendars');
    const entries = FM.CalendarList.parse(calendars.children);
    assert.deepEqual(entries, [
        { name: 'Standard', pattern: 'Mon-Fri', hours: '', exceptions: '' },
        { name: 'Night Shift', pattern: 'Sun-Thu', hours: '22:00-06:00', exceptions: '' },
        { name: 'Fortnight Ops', pattern: '[Mon-Fri; Mon-Wed]', hours: '08:00-16:30', exceptions: 'Christmas: 2026-12-25:2026-12-26' },
    ]);

    const active = rows.find(r => r.kind === 'kv' && r.key === 'calendar');
    assert.equal(active.value, 'Fortnight Ops');
});

test('CalendarList serializes hours and exceptions in a fixed order and omits blank fields', () => {
    assert.deepEqual(
        FM.CalendarList.serialize([
            { name: 'Standard', pattern: 'Mon-Fri', hours: '', exceptions: '' },
            { name: 'Gulf', pattern: 'Sun-Thu', hours: '', exceptions: '2026-08-12' },
            { name: 'Night Shift', pattern: 'Sun-Thu', hours: '22:00-06:00', exceptions: '' },
        ]),
        [
            '- Standard: Mon-Fri',
            '- Gulf: Sun-Thu exceptions [2026-08-12]',
            '- Night Shift: Sun-Thu hours 22:00-06:00',
        ],
    );
});

test('CalendarList.serialize drops entries with no name or no pattern (unfilled new rows)', () => {
    assert.deepEqual(
        FM.CalendarList.serialize([
            { name: '', pattern: '', hours: '', exceptions: '' },
            { name: 'Standard', pattern: '', hours: '', exceptions: '' },
            { name: 'Standard', pattern: 'Mon-Fri', hours: '', exceptions: '' },
        ]),
        ['- Standard: Mon-Fri'],
    );
});

test('adding a new key appends it without disturbing existing lines', () => {
    const text = '---\ntitle: My Project\n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    let nextId = Math.max(...rows.map(r => r.id)) + 1;
    rows.push(FM.newKvRow(nextId++, 'sponsor', 'CEO'));
    const result = reserialize(model, loc, rows);
    assert.equal(result, '---\ntitle: My Project\nsponsor: CEO\n---\nPhase\n  Task 1d\n');
});

test('removing a key deletes only that line', () => {
    const text = '---\ntitle: My Project\nsponsor: CEO\nstatus: Green\n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    const sponsor = rows.find(r => r.kind === 'kv' && r.key === 'sponsor');
    FM.removeRow(rows, sponsor.id);
    const result = reserialize(model, loc, rows);
    assert.equal(result, '---\ntitle: My Project\nstatus: Green\n---\nPhase\n  Task 1d\n');
});

test('removing a block key removes its whole nested block', () => {
    const text = '---\ntitle: My Project\ndependencies:\n  - from: A\n    task: B\n    to_task: C\n    type: FS\n    lag: 0\nstatus: Green\n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    const deps = rows.find(r => r.kind === 'block' && r.key === 'dependencies');
    FM.removeRow(rows, deps.id);
    const result = reserialize(model, loc, rows);
    assert.equal(result, '---\ntitle: My Project\nstatus: Green\n---\nPhase\n  Task 1d\n');
});

test('reordering keys changes only their order', () => {
    const text = '---\ntitle: My Project\nsponsor: CEO\nstatus: Green\n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    const sponsor = rows.find(r => r.kind === 'kv' && r.key === 'sponsor');
    FM.moveRow(rows, sponsor.id, 1);
    const result = reserialize(model, loc, rows);
    assert.equal(result, '---\ntitle: My Project\nstatus: Green\nsponsor: CEO\n---\nPhase\n  Task 1d\n');
});

test('raw/structured round trip: reserializing without any edits is a no-op', () => {
    const text = readFileSync(join(repo, 'templates', 'software-development', 'plan.md'), 'utf8');
    const { model, rows, loc } = parseFm(text);
    assert.equal(reserialize(model, loc, rows), text);
});

test('a document with no front matter is reported absent, not invented', () => {
    const text = 'Phase\n  Task 1d\n';
    const { present } = parseFm(text);
    assert.equal(present, false);
});

test('countKeys ignores blank lines and comments', () => {
    const text = '---\n# comment\ntitle: A\n\nsponsor: B\n---\n';
    const { rows } = parseFm(text);
    assert.equal(FM.countKeys(rows), 2);
});

test('malformed / stray lines in front matter are preserved, not dropped', () => {
    const text = '---\ntitle: A\n:::not-a-key:::\nsponsor: B\n---\nPhase\n  Task 1d\n';
    const { model, rows, loc } = parseFm(text);
    assert.ok(rows.some(r => r.kind === 'raw' && r.raw[0].text === ':::not-a-key:::'));
    assert.equal(reserialize(model, loc, rows), text);
});
