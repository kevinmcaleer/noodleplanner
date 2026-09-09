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
        { type: 'backmatter_op', section: 'comms', op: 'add_row', fields: {} },
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
    assert.equal(isBackmatterOp({ type: 'backmatter_op', section: 'benefits', op: 'add_row' }), false);
    assert.equal(isBackmatterOp({ type: 'plan_op', op: 'add_row' }), false);
});

test('an unchanged RAID log round-trips byte for byte', () => {
    const rejected = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 99, fields: { status: 'closed' } }));
    assert.equal(rejected.ok, false);
    const applied = applyBackmatterOp(PLAN, op({ op: 'edit_row', row_id: 1, fields: { status: RAID_ITEMS[0].status } }));
    assert.equal(applied.text, PLAN, 'setting a field to the value it already had changes nothing');
});
