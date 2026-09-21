const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'section-folding.js'),
    'utf8'
);

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Event: function Event(type) { this.type = type; },
    localStorage: {
        _data: Object.create(null),
        getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
        setItem(key, value) { this._data[key] = String(value); },
        removeItem(key) { delete this._data[key]; },
    },
    getComputedStyle() {
        return { lineHeight: '21', fontSize: '14', paddingTop: '15', paddingLeft: '15', paddingRight: '15' };
    },
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox);

const SF = sandbox.SectionFolding;
let failures = 0;

function assert(condition, message) {
    if (!condition) {
        failures++;
        console.error('FAIL:', message);
    } else {
        console.log('PASS:', message);
    }
}

function equal(actual, expected, message) {
    if (actual !== expected) {
        failures++;
        console.error('FAIL:', message, '\n expected:', expected, '\n actual:  ', actual);
    } else {
        console.log('PASS:', message);
    }
}

const DESCRIPTORS = [
    { startMarker: '---highlights---', label: 'Highlights', endMarkers: ['---end-highlights---'], countRows: SF.countHighlightEntries, countNoun: 'entry' },
    { startMarker: '---budget---', label: 'Budget', countRows: SF.countMarkdownTableRows },
    { startMarker: '---benefits---', label: 'Benefits', countRows: SF.countMarkdownTableRows },
    { startMarker: '---raid log---', label: 'RAID log', countRows: SF.countMarkdownTableRows },
    { startMarker: '---comms---', label: 'Comms', countRows: SF.countMarkdownTableRows },
    { startMarker: '---lessons learned---', label: 'Lessons learned', countRows: SF.countMarkdownTableRows },
    { startMarker: '---baseline---', label: 'Baseline', countRows: SF.countMarkdownTableRows },
    { startMarker: '---whiteboard---', label: 'Whiteboard', countRows: SF.countMarkdownTableRows },
    { startMarker: '---parking lot---', label: 'Parking lot', countRows: SF.countMarkdownTableRows },
    { startMarker: '---estimates---', label: 'Estimates', countRows: SF.countMarkdownTableRows },
];

const PLAN = [
    'Project X',
    '  Build feature @Alice 3d',
    '',
    '---highlights---',
    '- Kick-off done',
    '- First demo landed',
    '---end-highlights---',
    '---raid log---',
    '| ID | Type | Title   | Status |',
    '|----|------|---------|--------|',
    '| 1  | Risk | Vendor  | Open   |',
    '| 2  | Issue| Browser | Closed |',
    '---comms---',
    '| ID | Activity    | Status  |',
    '|----|-------------|---------|',
    '| 7  | Stand-up    | Active  |',
    '---baseline---',
    '| ID | Task  | Start      | Finish     |',
    '|----|-------|------------|------------|',
    '| 4  | Build | 2026-01-01 | 2026-01-09 |',
    ''
].join('\n');

(function rowCountTests() {
    equal(SF.countMarkdownTableRows([
        '| ID | Name |',
        '|----|------|',
        '| 1  | A    |',
        '| 2  | B    |'
    ]), 2, 'counts markdown data rows');
    equal(SF.countHighlightEntries(['- One', '', '- Two']), 2, 'counts highlight entries');
})();

(function persistenceTests() {
    const parsed = SF.parseStoredState(JSON.stringify({ defaultExpanded: true, overrides: { '---raid log---': false } }));
    equal(parsed.defaultExpanded, true, 'reads default-expanded preference');
    equal(SF.isExpanded(parsed, '---raid log---'), false, 'reads per-section override');
    equal(SF.isExpanded(parsed, '---comms---'), true, 'falls back to default-expanded when no override exists');

    const collapsedDefault = { defaultExpanded: false, overrides: {} };
    const changed = SF.setExpanded(collapsedDefault, '---raid log---', true);
    equal(SF.isExpanded(changed, '---raid log---'), true, 'stores explicit expansion override');
    equal(Object.prototype.hasOwnProperty.call(changed.overrides, '---raid log---'), true, 'retains override when it differs from default');
    const reset = SF.setExpanded(changed, '---raid log---', false);
    equal(Object.prototype.hasOwnProperty.call(reset.overrides, '---raid log---'), false, 'removes override when it matches the default again');
})();

(function projectionTests() {
    const projection = SF.buildProjection(PLAN, DESCRIPTORS, { defaultExpanded: false, overrides: {} });
    equal(projection.sections.length, 4, 'finds every back-matter section instance in the sample plan');
    assert(projection.displayText.includes('Highlights (2 entries)'), 'collapsed projection pluralises entry counts sensibly');
    assert(projection.displayText.includes('RAID log (2 rows)'), 'collapsed projection shows RAID row count in the header');
    assert(!projection.displayText.includes('| 1  | Risk | Vendor'), 'collapsed projection hides RAID table rows from the display text');
    equal(projection.sections.find((section) => section.marker === '---raid log---').expanded, false, 'projection reports collapsed section state');
    equal(SF.findSectionStartLine(PLAN, '---raid log---', DESCRIPTORS), 8, 'finds the raid section marker line');
    equal(SF.findTableRowLine(PLAN, '---raid log---', '2', DESCRIPTORS), 12, 'finds a specific table row inside a folded section');
    equal(SF.visibleLineFromRawLine(projection, 12), 5, 'maps a hidden raw row onto the section header line');
})();

(function leadingFrontMatterProjectionTests() {
    const plan = '---\ntitle: Hidden metadata\nstatus: Green\n---\nPhase\n  Task 1d\n';
    const structured = SF.buildProjection(plan, DESCRIPTORS, { defaultExpanded: false, overrides: {} }, { hideLeadingFrontMatter: true });
    equal(structured.displayText, 'Phase\n  Task 1d\n', 'structured mode hides the complete leading front matter from the editor projection');
    const edited = SF.applyVisibleEdit(structured, structured.displayText.replace('Task', 'Renamed task'));
    assert(edited.rawText.startsWith('---\ntitle: Hidden metadata\nstatus: Green\n---\n'), 'editing the structured projection preserves hidden front matter');

    const raw = SF.buildProjection(plan, DESCRIPTORS, { defaultExpanded: false, overrides: {} }, { hideLeadingFrontMatter: false });
    equal(raw.displayText, plan, 'raw mode projects the complete markdown file');

    const withBackMatter = plan + '---whiteboard---\n| Task | X |\n|---|---|\n| Task | 20 |\n';
    const completeRaw = SF.buildProjection(withBackMatter, DESCRIPTORS, { defaultExpanded: false, overrides: {} }, { disableSectionFolding: true });
    equal(completeRaw.displayText, withBackMatter, 'raw mode leaves back matter expanded as part of the complete markdown file');
    equal(completeRaw.sections.length, 0, 'raw mode creates no folding overlays');
})();

(function malformedSectionTests() {
    const malformed = 'Tasks\n---raid log---\n| ID | Type |\n| 1 | partial only';
    const projection = SF.buildProjection(malformed, DESCRIPTORS, { defaultExpanded: false, overrides: {} });
    equal(projection.sections.length, 1, 'parses a truncated section without crashing');
    equal(projection.sections[0].count, 0, 'gives malformed markdown tables a safe zero-row count');

    const none = SF.buildProjection('Tasks only\n  Build 2d\n', DESCRIPTORS, { defaultExpanded: false, overrides: {} });
    equal(none.sections.length, 0, 'plans with no back matter produce no fold sections');
})();

(function roundTripTests() {
    const collapsed = SF.buildProjection(PLAN, DESCRIPTORS, { defaultExpanded: false, overrides: {} });
    const unchanged = SF.applyVisibleEdit(collapsed, collapsed.displayText);
    equal(unchanged.rawText, PLAN, 'folding alone leaves the authoritative markdown byte-identical');

    const expandedState = SF.setExpanded({ defaultExpanded: false, overrides: {} }, '---raid log---', true);
    const expanded = SF.buildProjection(PLAN, DESCRIPTORS, expandedState);
    equal(expanded.sections.find((section) => section.marker === '---raid log---').expanded, true, 'projection reports expanded section state');
    const editedDisplay = expanded.displayText.replace('Vendor', 'Vendor Partner');
    const edited = SF.applyVisibleEdit(expanded, editedDisplay);
    assert(edited.rawText.includes('| 1  | Risk | Vendor Partner  | Open   |'), 'editing an expanded section updates the underlying markdown');
    assert(edited.rawText.includes('---comms---\n| ID | Activity'), 'editing one expanded section preserves neighbouring sections verbatim');

    const collapsedAgain = SF.buildProjection(edited.rawText, DESCRIPTORS, { defaultExpanded: false, overrides: {} });
    assert(collapsedAgain.displayText.includes('RAID log (2 rows)'), 'edited markdown can be re-folded after a round trip');
})();

(function typingKeystrokeTests() {
    // Regression test for a bug where the cursor translation after an edit
    // landed before the just-typed text instead of after it, so each new
    // keystroke was inserted ahead of the previous ones (typing "test"
    // produced "tset"). This drives the same applyVisibleEdit /
    // translateEditedVisibleOffset pair the live editor's `input` handler
    // uses, one character at a time, mimicking real native textarea typing.
    function typeString(startRawText, descriptors, state, text, startVisibleCaret) {
        let projection = SF.buildProjection(startRawText, descriptors, state);
        let visibleCaret = typeof startVisibleCaret === 'number' ? startVisibleCaret : projection.displayText.length;
        for (const ch of text) {
            const before = projection.displayText;
            const newVisibleText = before.slice(0, visibleCaret) + ch + before.slice(visibleCaret);
            const applied = SF.applyVisibleEdit(projection, newVisibleText);
            assert(!applied.blocked, 'typing "' + text + '" is not blocked by a synthetic range');
            const newVisibleCaret = visibleCaret + 1;
            const rawCaret = SF.translateEditedVisibleOffset(projection, applied.diff, newVisibleCaret);
            projection = SF.buildProjection(applied.rawText, descriptors, state);
            visibleCaret = SF.visibleOffsetFromRawOffset(projection, rawCaret, 'start');
        }
        return projection.rawText;
    }

    equal(typeString('', [], { defaultExpanded: false, overrides: {} }, 'test'), 'test',
        'typing "test" into an empty plain editor produces "test", not "tset"');

    equal(typeString('line one\n', [], { defaultExpanded: false, overrides: {} }, 'more'), 'line one\nmore',
        'typing after existing text appends in order instead of reversing');

    // Type right after "Project X" (well before any collapsed section, so the
    // edit doesn't touch a synthetic range and isn't blocked).
    const introCaret = 'Project X'.length;
    const withSections = typeString(PLAN, DESCRIPTORS, { defaultExpanded: false, overrides: {} }, '!!!', introCaret);
    equal(withSections, 'Project X!!!' + PLAN.slice('Project X'.length),
        'typed characters land in order (not reversed) when typing near folded back matter');

    // A newline is also the separator immediately before a collapsed header.
    // A text-only common-prefix diff can therefore slide an Enter press from
    // the task area onto the synthetic header and reject it. Supply the same
    // post-input caret hint as the live textarea and verify that repeated
    // Enter presses create editable task lines before back matter.
    let rawWithNewLines = PLAN;
    let newLineProjection = SF.buildProjection(rawWithNewLines, DESCRIPTORS, { defaultExpanded: false, overrides: {} });
    let newLineCaret = newLineProjection.displayText.indexOf('Highlights (2 entries)') - 1;
    for (let press = 0; press < 2; press++) {
        const visibleWithNewLine = newLineProjection.displayText.slice(0, newLineCaret) + '\n' +
            newLineProjection.displayText.slice(newLineCaret);
        const applied = SF.applyVisibleEdit(newLineProjection, visibleWithNewLine, {
            selectionStart: newLineCaret + 1,
            selectionEnd: newLineCaret + 1,
        });
        assert(!applied.blocked, 'Enter above collapsed back matter is not mistaken for a header edit');
        rawWithNewLines = applied.rawText;
        const rawCaret = SF.translateEditedVisibleOffset(newLineProjection, applied.diff, newLineCaret + 1);
        newLineProjection = SF.buildProjection(rawWithNewLines, DESCRIPTORS, { defaultExpanded: false, overrides: {} });
        newLineCaret = SF.visibleOffsetFromRawOffset(newLineProjection, rawCaret, 'start');
    }
    assert(rawWithNewLines.includes('  Build feature @Alice 3d\n\n\n\n---highlights---'),
        'repeated Enter presses append blank task lines before back matter without changing its contents');
})();

// #1278: in the structured view the Back Matter panel below the editor
// already shows every one of these sections, so the editor must not also
// show them as collapsible header rows. Hiding them is a projection-only
// change -- the raw text is untouched, and a caret anywhere in the hidden
// range still maps to a sensible visible position.
(function hiddenSectionTests() {
    const state = { defaultExpanded: false, overrides: {} };
    const hidden = SF.buildProjection(PLAN, DESCRIPTORS, state, { hideSections: true });

    equal(hidden.sectionsHidden, true, 'the projection reports that sections are hidden');
    equal(hidden.displayLines.some((line) => line.kind === 'header'), false,
        'no back-matter header row is projected into the editor');
    equal(hidden.displayText.includes('Highlights'), false, 'the Highlights section is gone from the editor');
    equal(hidden.displayText.includes('RAID log'), false, 'the RAID log section is gone from the editor');
    equal(hidden.displayText.includes('---whiteboard---'), false, 'no raw section marker leaks through');
    equal(hidden.displayText, 'Project X\n  Build feature @Alice 3d\n', 'only the task body remains visible');
    equal(hidden.rawText, PLAN, 'the underlying plan text is untouched');
    equal(hidden.sections.length, 4, 'the sections are still known to the controller, just not shown');
    equal(hidden.sections.every((section) => section.hidden && !section.expanded), true,
        'every section reports itself hidden and not expanded');

    // A caret inside the hidden block maps forward to a real visible
    // position rather than off the end of the projection.
    const rawInHighlights = PLAN.indexOf('- First demo landed');
    const visible = SF.visibleOffsetFromRawOffset(hidden, rawInHighlights, 'start');
    assert(visible >= 0 && visible <= hidden.displayText.length,
        'a caret in a hidden section maps inside the visible text');

    // Editing the visible body still rewrites only the visible body.
    const edited = SF.applyVisibleEdit(hidden, hidden.displayText.replace('Project X', 'Project Y'), null);
    assert(!edited.blocked, 'editing the task body above hidden back matter is never blocked');
    equal(edited.rawText, PLAN.replace('Project X', 'Project Y'),
        'the edit rewrites only the task body, leaving every hidden section intact');

    // Without the flag nothing changes: the default view still folds.
    const folded = SF.buildProjection(PLAN, DESCRIPTORS, state);
    equal(folded.sectionsHidden, false, 'the default projection still folds rather than hides');
    equal(folded.displayText.includes('Highlights (2 entries)'), true,
        'the default projection still shows the collapsible header row');
})();

if (failures) process.exit(1);
console.log('\nAll tests passed.');
