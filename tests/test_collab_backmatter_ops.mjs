/**
 * Proof for #969's extension of #967's host-authoritative edit protocol to
 * the RAID/risk log (static/collab-backmatter-ops.js).
 *
 * #969 names four back-matter sections (benefits, comms, risk/RAID,
 * weekly updates); this module -- and this test file -- deliberately
 * cover RAID only. See collab-backmatter-ops.js's module docstring for
 * why, and the #969 PR description for the explicit per-section coverage
 * statement.
 *
 * Mirrors test_collab_ops.mjs's structure and rigor:
 *
 *  - add/edit/delete round-trip correctly through parse -> apply ->
 *    serialise, and leave every *other* section of the plan untouched
 *  - a crafted row value with embedded pipes/newlines cannot corrupt the
 *    table structure or leak into an adjacent row/section (the #1007-style
 *    regression, adapted for markdown tables)
 *  - two participants editing the same row resolve last-write-wins,
 *    visibly
 *  - an op naming a row that no longer exists is rejected, not misapplied
 *
 * Run with: node --test tests/test_collab_backmatter_ops.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    parseRaidTable,
    serializeRaidTable,
    spliceRaidSection,
    buildRaidSnapshot,
    applyBackmatterOp,
    describeBackmatterConflict,
    isBackmatterOp,
    buildSectionSnapshot,
    EDITABLE_SECTIONS,
} = await import('../packages/noodle-web/src/noodle_web/static/collab-backmatter-ops.js');

function op(fields) {
    return { type: 'backmatter_op', section: 'raid', ...fields };
}

const BASE_TASKS = [
    'Phase 1',
    '  Design API @alice 3d 50%',
    '  Build API @bob 5d 10%',
    'Phase 2',
    '  Ship it @carol 1d',
].join('\n');

const RAID_ITEMS = [
    {
        id: 1, type: 'risk', title: 'Server outage', description: 'Prod server may fail',
        raised_by: 'Alice', owner: 'Bob', mitigation_actions: 'Add failover',
        impact: 4, likelihood: 2, score: 8, status: 'open', priority: 'High',
        target_date: '2026-01-01', escalated: false, escalation_level: 'project',
    },
    {
        id: 2, type: 'action', title: 'Order hardware', description: 'Need a spare NIC',
        raised_by: 'Bob', owner: 'Carol', mitigation_actions: '',
        impact: 2, likelihood: 3, score: 6, status: 'open', priority: 'Medium',
        target_date: '', escalated: false, escalation_level: 'project',
    },
];

// A plan with tasks, a RAID log, and back-matter sections on both sides of
// it in the canonical write order -- so any splice bug that swallows a
// neighbour, or reorders sections, shows up immediately.
const PLAN = spliceRaidSection(
    `${BASE_TASKS}\n\n---comms---\nWeekly stakeholder update, Mondays.\n\n---lessons learned---\nKeep the retro short.`,
    RAID_ITEMS,
);

test('the RAID section round-trips through parse -> serialise unchanged', () => {
    const table = serializeRaidTable(RAID_ITEMS);
    assert.deepEqual(parseRaidTable(table), RAID_ITEMS);
});

test('a snapshot lists every RAID row', () => {
    const snapshot = buildRaidSnapshot(PLAN, 1);
    assert.equal(snapshot.type, 'raid_snapshot');
    assert.equal(snapshot.section, 'raid');
    assert.deepEqual(snapshot.items.map((i) => i.title), ['Server outage', 'Order hardware']);
});

test('applying a RAID op never disturbs the tasks or the other back-matter sections', () => {
    const result = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 1, fields: { status: 'closed' } }));
    assert.equal(result.ok, true);
    assert.ok(result.text.includes(BASE_TASKS), 'the task outline is byte-identical');
    assert.ok(result.text.includes('Weekly stakeholder update, Mondays.'), 'comms section survived');
    assert.ok(result.text.includes('Keep the retro short.'), 'lessons learned section survived');
    assert.ok(result.text.indexOf('---comms---') < result.text.indexOf('---lessons learned---'));
});

test('add_row appends a new row with a host-assigned id', () => {
    const result = applyBackmatterOp(PLAN, op({
        op: 'add_row', fields: { title: 'New risk', description: 'Just spotted', type: 'risk' },
    }));
    assert.equal(result.ok, true);
    const snapshot = buildRaidSnapshot(result.text, 1);
    assert.equal(snapshot.items.length, 3);
    assert.equal(snapshot.items[2].title, 'New risk');
    assert.equal(snapshot.items[2].id, 3, 'the new row gets the next unused id, not a client-chosen one');
    assert.equal(snapshot.items[2].type, 'risk');
    assert.equal(snapshot.items[2].status, 'open', 'a fresh row defaults to open');
});

test('edit_row merges only the given fields, leaving the rest of the row alone', () => {
    const result = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 2, fields: { owner: 'Dave' } }));
    assert.equal(result.ok, true);
    const snapshot = buildRaidSnapshot(result.text, 1);
    const row = snapshot.items.find((i) => i.id === 2);
    assert.equal(row.owner, 'Dave');
    assert.equal(row.title, 'Order hardware', 'untouched fields survive the edit');
    assert.equal(row.description, 'Need a spare NIC');
});

test('editing impact or likelihood recomputes score, matching a fresh parse', () => {
    const result = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 1, fields: { impact: 5, likelihood: 5 } }));
    assert.equal(result.ok, true);
    const row = buildRaidSnapshot(result.text, 1).items.find((i) => i.id === 1);
    assert.equal(row.score, 25);
});

test('delete_row removes exactly that row and nothing else', () => {
    const result = applyBackmatterOp(PLAN, op({ op: 'delete_row', row_id: 1 }));
    assert.equal(result.ok, true);
    const snapshot = buildRaidSnapshot(result.text, 1);
    assert.deepEqual(snapshot.items.map((i) => i.id), [2]);
});

test('deleting the only row removes the RAID section entirely, not an empty table', () => {
    const onlyOneItem = spliceRaidSection(BASE_TASKS, [RAID_ITEMS[0]]);
    const result = applyBackmatterOp(onlyOneItem, op({ op: 'delete_row', row_id: 1 }));
    assert.equal(result.ok, true);
    assert.equal(result.text.includes('---raid log---'), false);
});

// -- the #1007-style table-injection regression, adapted for RAID rows -----

test('a title containing a pipe cannot fabricate an extra table column', () => {
    const result = applyBackmatterOp(PLAN, op({
        op: 'add_row', fields: { title: 'Sneaky | Closed | 99', description: 'x' },
    }));
    assert.equal(result.ok, true);
    const snapshot = buildRaidSnapshot(result.text, 1);
    const row = snapshot.items[snapshot.items.length - 1];
    // The pipe survived as literal text in one cell, not as a column
    // separator -- status is still the row's real (default) status, not
    // "Closed" smuggled in from the crafted title.
    assert.equal(row.title, 'Sneaky | Closed | 99');
    assert.equal(row.status, 'open');
    assert.equal(snapshot.items.length, 3, 'no phantom row was created');
});

test('a description containing an embedded newline cannot forge a new table row or section marker', () => {
    const result = applyBackmatterOp(PLAN, op({
        op: 'add_row',
        fields: {
            title: 'Injected',
            description: 'line one\n| 999 | risk | Forged | forged | | | | 1 | 1 | 1 | open | | |\n---whiteboard---\npwned',
        },
    }));
    assert.equal(result.ok, true);
    // The forged row never becomes a real, separately-parsed row: the
    // newline was collapsed before the value ever reached a table cell.
    const snapshot = buildRaidSnapshot(result.text, 1);
    assert.equal(snapshot.items.some((i) => i.title === 'Forged'), false);
    assert.equal(snapshot.items.length, 3);
    // Nor did it fabricate a new section marker as its own physical line.
    assert.equal(result.text.split('\n').some((line) => line.trim() === '---whiteboard---'), false);
    // The RAID table itself still has exactly the right number of rows --
    // a broken split would show up as a header/separator/row count drift.
    const raidSection = result.text.slice(
        result.text.indexOf('---raid log---') + '---raid log---'.length,
        result.text.indexOf('---comms---'),
    );
    const tableLines = raidSection.trim().split('\n');
    assert.equal(tableLines.length, 2 + snapshot.items.length, 'header + separator + one line per row');
});

test('a single-line field that merely contains a marker substring is not mistaken for a section boundary', () => {
    // Regression for a real bug found during this issue's own manual
    // verification: no embedded newline is needed at all here -- a value
    // that simply *contains* the literal text of another section's
    // marker, entirely on one line, must not truncate the table on a
    // later re-parse of the document. See collab-backmatter-ops.js's
    // module docstring (indexOfMarkerLine) for the full story.
    const withMarkerText = applyBackmatterOp(PLAN, op({
        op: 'add_row', fields: { title: 'Vendor issue', owner: 'Carol ---whiteboard--- pwned' },
    }));
    assert.equal(withMarkerText.ok, true);

    // A second, unrelated op is what actually re-parses the whole
    // document -- the bug only showed up on this second pass.
    const second = applyBackmatterOp(withMarkerText.text, op({ op: 'edit_row', row_id: 1, fields: { status: 'closed' } }));
    assert.equal(second.ok, true);

    const snapshot = buildRaidSnapshot(second.text, 2);
    assert.equal(snapshot.items.length, 3, 'no row was lost or split in two');
    const row = snapshot.items.find((i) => i.title === 'Vendor issue');
    assert.equal(row.owner, 'Carol ---whiteboard--- pwned', 'the full field survives, not truncated at the embedded marker text');
    assert.equal(second.text.split('\n').some((line) => line.trim() === '---whiteboard---'), false, 'no bogus section was fabricated');
});

test('a row containing an escaped-looking pipe sequence round-trips as literal text', () => {
    const result = applyBackmatterOp(PLAN, op({
        op: 'add_row', fields: { title: 'literal \\| backslash-pipe', description: '' },
    }));
    assert.equal(result.ok, true);
    const snapshot = buildRaidSnapshot(result.text, 1);
    const row = snapshot.items[snapshot.items.length - 1];
    assert.equal(row.title, 'literal \\| backslash-pipe');
});

// -- row identity: a stable id, not a document position ---------------------

test('row ids stay stable across an unrelated row being deleted', () => {
    const afterDelete = applyBackmatterOp(PLAN, op({ op: 'delete_row', row_id: 1 })).text;
    const result = applyBackmatterOp(afterDelete, op({ op: 'edit_row', row_id: 2, fields: { status: 'closed' } }));
    assert.equal(result.ok, true, 'row 2 is still addressable by the same id after row 1 was removed');
    assert.equal(buildRaidSnapshot(result.text, 1).items[0].status, 'closed');
});

test('an op naming a row id that no longer exists is rejected, not misapplied', () => {
    const result = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 99, fields: { status: 'closed' } }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_row');
    // The document is untouched.
    assert.equal(buildRaidSnapshot(PLAN, 1).items.length, 2);
});

test('delete_row on an already-deleted row is rejected, not a silent no-op', () => {
    const first = applyBackmatterOp(PLAN, op({ op: 'delete_row', row_id: 1 }));
    const second = applyBackmatterOp(first.text, op({ op: 'delete_row', row_id: 1 }));
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'unknown_row');
});

// -- conflict resolution: same rule as #967, applied to rows -----------------

test('two participants editing the same row resolve last-write-wins', () => {
    const first = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 1, fields: { status: 'closed' } }));
    const second = applyBackmatterOp(first.text, op({ op: 'edit_row', row_id: 1, fields: { status: 'transferred' } }));
    assert.equal(second.ok, true);
    assert.equal(buildRaidSnapshot(second.text, 1).items[0].status, 'transferred', 'the later op wins');
});

test('a superseded row edit is reported, not lost silently', () => {
    const result = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 1, fields: { status: 'closed' } }));
    const notice = describeBackmatterConflict(
        op({ op: 'edit_row', row_id: 1, fields: { status: 'closed' } }),
        result.previous,
        'Bob',
    );
    assert.match(notice, /Bob also edited/);
});

test('agreeing on the same field value is not reported as a conflict', () => {
    const previous = RAID_ITEMS[0];
    const notice = describeBackmatterConflict(
        op({ op: 'edit_row', row_id: 1, fields: { status: previous.status } }),
        previous,
        'Bob',
    );
    assert.equal(notice, null);
});

test('add_row and delete_row never produce a conflict notice', () => {
    assert.equal(describeBackmatterConflict(op({ op: 'add_row', fields: {} }), RAID_ITEMS[0], 'Bob'), null);
    assert.equal(describeBackmatterConflict(op({ op: 'delete_row', row_id: 1 }), RAID_ITEMS[0], 'Bob'), null);
});

// -- malformed input ----------------------------------------------------

test('malformed ops are rejected rather than throwing', () => {
    for (const bad of [
        null,
        undefined,
        'not an object',
        {},
        { type: 'backmatter_op', section: 'raid' },
        // #1036 made comms a real section, so an unsupported one is now
        // weekly updates rather than comms.
        { type: 'backmatter_op', section: 'highlights', op: 'add_row', fields: {} },
        { type: 'backmatter_op', section: 'raid', op: 'drop_database' },
        { type: 'plan_op', section: 'raid', op: 'add_row', fields: {} },
        op({ op: 'edit_row', row_id: 1, fields: { type: 'not_a_real_type' } }),
        op({ op: 'edit_row', row_id: 1, fields: { status: 'not_a_real_status' } }),
        op({ op: 'edit_row', row_id: 1, fields: { impact: 'abc' } }),
    ]) {
        const result = applyBackmatterOp(PLAN, bad);
        assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    }
});

test('isBackmatterOp accepts only the three real RAID row ops', () => {
    for (const kind of ['add_row', 'edit_row', 'delete_row']) {
        assert.equal(isBackmatterOp(op({ op: kind })), true);
    }
    assert.equal(isBackmatterOp(op({ op: 'reformat_everything' })), false);
    assert.equal(isBackmatterOp({ type: 'plan_op', op: 'add_row' }), false);
    // #1036 added benefits and comms; weekly updates (---highlights---) is
    // still not a supported section, and must still be refused.
    assert.equal(isBackmatterOp({ type: 'backmatter_op', section: 'benefits', op: 'add_row' }), true);
    assert.equal(isBackmatterOp({ type: 'backmatter_op', section: 'comms', op: 'add_row' }), true);
    assert.equal(isBackmatterOp({ type: 'backmatter_op', section: 'highlights', op: 'add_row' }), false);
    assert.equal(isBackmatterOp({ type: 'backmatter_op', section: 'budget', op: 'add_row' }), false);
});

test('an unchanged RAID log round-trips byte for byte', () => {
    const rejected = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 99, fields: { status: 'closed' } }));
    assert.equal(rejected.ok, false);
    const applied = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 1, fields: { status: RAID_ITEMS[0].status } }));
    assert.equal(applied.text, PLAN, 'setting a field to the value it already had changes nothing');
});

// ===========================================================================
// #1036: benefits and comms
//
// Both are id-keyed pipe tables, structurally the same as the RAID log, so
// they share its machinery. These tests exercise them through the same
// public op surface a joiner uses, and re-run the injection class that
// #1006 found in the task ops -- generalising an op protocol to more content
// is exactly the work that produced that hole.
// ===========================================================================

const SECTIONED_PLAN = [
    'Phase 1',
    '  Design API 50%',
    '',
    '---benefits---',
    '# Benefits Map',
    '',
    '| ID | Type | Title | Description | Status |',
    '|----|------|-------|-------------|--------|',
    '| 1  | Cash | Lower hosting spend | Move off the old cluster | open |',
    '',
    '---raid log---',
    '',
    '| ID | Type | Title | Description | Owner | Status |',
    '|----|------|-------|-------------|-------|--------|',
    '| 1  | risk | Vendor delay | Kit may slip | Dana | open |',
    '',
    '---comms---',
    '',
    '| ID | Activity | Audience | Content | Frequency | Channel | Owner | Status |',
    '|----|----------|----------|---------|-----------|---------|-------|--------|',
    '| 1  | Standup  | Team     | Progress | Daily    | Slack   | Dana  | active |',
    '',
].join('\n');

function sectionOp(section, fields) {
    return { type: 'backmatter_op', section, ...fields };
}

test('#1036: benefits and comms are editable sections, weekly updates is not', () => {
    assert.deepEqual(EDITABLE_SECTIONS.slice().sort(), ['benefits', 'comms', 'raid']);
});

test('#1036: a benefits snapshot reads the rows the host has', () => {
    const snapshot = buildSectionSnapshot(SECTIONED_PLAN, 4, 'benefits');
    assert.equal(snapshot.type, 'backmatter_snapshot');
    assert.equal(snapshot.section, 'benefits');
    assert.equal(snapshot.rev, 4);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].title, 'Lower hosting spend');
    assert.equal(snapshot.items[0].status, 'open');
});

test('#1036: a comms snapshot reads the rows the host has', () => {
    const snapshot = buildSectionSnapshot(SECTIONED_PLAN, 1, 'comms');
    assert.equal(snapshot.section, 'comms');
    assert.equal(snapshot.items[0].activity, 'Standup');
    assert.equal(snapshot.items[0].channel, 'Slack');
});

test('#1036: editing a benefits row leaves every other section untouched', () => {
    const result = applyBackmatterOp(SECTIONED_PLAN, sectionOp('benefits', {
        op: 'edit_row', row_id: 1, fields: { status: 'realised' },
    }));
    assert.equal(result.ok, true);
    assert.equal(buildSectionSnapshot(result.text, 1, 'benefits').items[0].status, 'realised');
    // The RAID and comms sections must be exactly as they were -- editing
    // one section must never rewrite a neighbour.
    assert.deepEqual(buildRaidSnapshot(result.text, 1).items, buildRaidSnapshot(SECTIONED_PLAN, 1).items);
    assert.deepEqual(
        buildSectionSnapshot(result.text, 1, 'comms').items,
        buildSectionSnapshot(SECTIONED_PLAN, 1, 'comms').items,
    );
    // And the task outline above the back matter is untouched.
    assert.ok(result.text.startsWith('Phase 1\n  Design API 50%'));
});

test('#1036: adding and deleting a comms row', () => {
    const added = applyBackmatterOp(SECTIONED_PLAN, sectionOp('comms', {
        op: 'add_row', fields: { activity: 'Steering update', audience: 'Sponsors', channel: 'Email' },
    }));
    assert.equal(added.ok, true);
    const items = buildSectionSnapshot(added.text, 1, 'comms').items;
    assert.equal(items.length, 2);
    assert.equal(items[1].activity, 'Steering update');
    assert.equal(items[1].id, 2, 'a new row takes the next unused id');

    const deleted = applyBackmatterOp(added.text, sectionOp('comms', { op: 'delete_row', row_id: 1 }));
    assert.equal(deleted.ok, true);
    const left = buildSectionSnapshot(deleted.text, 1, 'comms').items;
    assert.equal(left.length, 1);
    assert.equal(left[0].activity, 'Steering update');
});

test('#1036: an op naming a row that does not exist is rejected', () => {
    for (const section of ['benefits', 'comms']) {
        const result = applyBackmatterOp(SECTIONED_PLAN, sectionOp(section, {
            op: 'edit_row', row_id: 99, fields: { status: 'x' },
        }));
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'unknown_row');
    }
});

test('#1036: contribution_percent is clamped, not trusted', () => {
    const over = applyBackmatterOp(SECTIONED_PLAN, sectionOp('benefits', {
        op: 'edit_row', row_id: 1, fields: { contribution_percent: 5000 },
    }));
    assert.equal(buildSectionSnapshot(over.text, 1, 'benefits').items[0].contribution_percent, 100);

    const under = applyBackmatterOp(SECTIONED_PLAN, sectionOp('benefits', {
        op: 'edit_row', row_id: 1, fields: { contribution_percent: -20 },
    }));
    assert.equal(buildSectionSnapshot(under.text, 1, 'benefits').items[0].contribution_percent, 0);

    const nonsense = applyBackmatterOp(SECTIONED_PLAN, sectionOp('benefits', {
        op: 'edit_row', row_id: 1, fields: { contribution_percent: 'lots' },
    }));
    assert.equal(nonsense.ok, false);
});

// -- the #1006 injection class, re-run per section -------------------------

test('#1036: an embedded newline cannot forge a section marker', () => {
    for (const section of ['benefits', 'comms']) {
        const field = section === 'benefits' ? 'title' : 'activity';
        const result = applyBackmatterOp(SECTIONED_PLAN, sectionOp(section, {
            op: 'edit_row', row_id: 1, fields: { [field]: 'Innocent\n---raid log---\n| 9 | risk | Forged |' },
        }));
        assert.equal(result.ok, true);
        // No new physical line anywhere is a bare section marker beyond the
        // one the plan legitimately has.
        const markerLines = result.text.split('\n').filter((l) => l.trim() === '---raid log---');
        assert.equal(markerLines.length, 1, `${section}: forged a second RAID marker`);
        // And the real RAID log still has exactly its own row.
        const raid = buildRaidSnapshot(result.text, 1).items;
        assert.equal(raid.length, 1);
        assert.equal(raid[0].title, 'Vendor delay');
    }
});

test('#1036: an embedded pipe cannot split a row into extra columns', () => {
    const result = applyBackmatterOp(SECTIONED_PLAN, sectionOp('comms', {
        op: 'edit_row', row_id: 1, fields: { activity: 'Standup | Injected | Cells' },
    }));
    assert.equal(result.ok, true);
    const items = buildSectionSnapshot(result.text, 1, 'comms').items;
    assert.equal(items.length, 1, 'still one row');
    assert.equal(items[0].activity, 'Standup | Injected | Cells', 'the pipes survive as literal text');
    assert.equal(items[0].audience, 'Team', 'and the next column is not displaced');
});

test('#1036: a carriage return is collapsed like a newline', () => {
    const result = applyBackmatterOp(SECTIONED_PLAN, sectionOp('benefits', {
        op: 'edit_row', row_id: 1, fields: { title: 'Before\r---comms---\rAfter' },
    }));
    assert.equal(result.ok, true);
    assert.equal(result.text.split('\n').filter((l) => l.trim() === '---comms---').length, 1);
});

test('#1036: a section absent from the plan is created rather than lost', () => {
    const bare = 'Phase 1\n  Design API 50%\n';
    const result = applyBackmatterOp(bare, sectionOp('comms', {
        op: 'add_row', fields: { activity: 'Kickoff', audience: 'All' },
    }));
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('---comms---'));
    assert.equal(buildSectionSnapshot(result.text, 1, 'comms').items[0].activity, 'Kickoff');
    assert.ok(result.text.startsWith('Phase 1'), 'the outline is still first');
});

test('#1036: setting a field to what it already was changes nothing', () => {
    const applied = applyBackmatterOp(SECTIONED_PLAN, sectionOp('comms', {
        op: 'edit_row', row_id: 1, fields: { activity: 'Standup' },
    }));
    assert.equal(applied.ok, true);
    assert.equal(
        buildSectionSnapshot(applied.text, 1, 'comms').items[0].activity, 'Standup',
    );
    // Neighbouring sections still parse identically.
    assert.deepEqual(buildRaidSnapshot(applied.text, 1).items, buildRaidSnapshot(SECTIONED_PLAN, 1).items);
});
