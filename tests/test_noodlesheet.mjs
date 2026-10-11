// Unit tests for static/noodlesheet.js — the markdown-backed spreadsheet
// component behind the Budget and other table views.
//
// The module is a plain script ending in a bare `class NoodleSheet`, so the
// binding never lands on the sandbox object: the source is evaluated in a
// node:vm context with `;NoodleSheet` appended as the completion value.
// Rendering is stubbed out on the prototype so the data model, parsers and
// formula engine can be driven without a DOM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(here, '..', 'packages/noodle-web/src/noodle_web/static/noodlesheet.js'), 'utf8');

function load() {
    const sandbox = { console };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    const NoodleSheet = vm.runInContext(source + '\n;NoodleSheet', sandbox);
    // No DOM here: neutralise every renderer the model methods call.
    for (const m of ['render', 'renderGrid', 'renderTabs', 'renderFormulaBar', '_selectCell']) {
        NoodleSheet.prototype[m] = function () {};
    }
    return NoodleSheet;
}

const NoodleSheet = load();
const plain = (v) => JSON.parse(JSON.stringify(v));

const BUDGET_DBML = `Table budget {
  // a comment line that must be ignored
  id number
  description text
  estimate number [format: currency, min: 0]
  status enum('Open', "Closed")
  due date
  share number [format: percentage, max: 1]
}`;

const BUDGET_MD = [
    '| Id | Description | Estimate | Status | Due | Share |',
    '|----|-------------|----------|--------|-----|-------|',
    '| 1 | Laptops | 1200 | Open | 2026-01-10 | 0.5 |',
    '| 2 | Cables \\| adapters | 50 | Closed | 2026-02-01 | |',
    '| 3 | Consultant | =A1+B2 | Open | | 0.25 |',
].join('\n');

function sheet(opts = {}) {
    return new NoodleSheet({}, {
        sheets: [{ name: 'Budget', dbml: BUDGET_DBML, markdown: BUDGET_MD }],
        ...opts,
    });
}

// ── parseDbml ─────────────────────────────────────────────────────────

describe('parseDbml', () => {
    test('reads the table name, column types, enums and annotations', () => {
        const schema = plain(NoodleSheet.parseDbml(BUDGET_DBML));
        assert.equal(schema.tableName, 'budget');
        assert.deepEqual(schema.columns.map(c => [c.name, c.type]), [
            ['id', 'number'], ['description', 'text'], ['estimate', 'number'],
            ['status', 'enum'], ['due', 'date'], ['share', 'number'],
        ]);
        const est = schema.columns[2];
        assert.equal(est.format, 'currency');
        assert.equal(est.min, 0);
        assert.equal(est.max, null);
        assert.deepEqual(schema.columns[3].enumValues, ['Open', 'Closed']);
        assert.equal(schema.columns[5].max, 1);
    });

    test('derives display names and default widths from name and type', () => {
        const { columns } = NoodleSheet.parseDbml('Table t { unit_cost number\n start_date date\n note text }');
        assert.deepEqual(plain(columns.map(c => [c.displayName, c.width])), [
            ['Unit Cost', 100], ['Start Date', 120], ['Note', 150],
        ]);
    });

    test('ignores comment lines and lines with unknown types', () => {
        const { columns } = NoodleSheet.parseDbml('Table t {\n // x text\n a text\n b blob\n c TEXT\n}');
        assert.deepEqual(plain(columns.map(c => c.name)), ['a', 'c']);
        assert.equal(columns[1].type, 'text');
    });

    test('returns an empty schema when there is no Table block', () => {
        assert.deepEqual(plain(NoodleSheet.parseDbml('nothing here')), { tableName: '', columns: [] });
    });
});

// ── parseMdRow / parseMarkdown / generateMarkdown ────────────────────

describe('markdown parsing', () => {
    test('parseMdRow strips the outer pipes and trims cells', () => {
        assert.deepEqual(plain(NoodleSheet.parseMdRow('|  a | b  |c|')), ['a', 'b', 'c']);
    });

    test('parseMdRow keeps escaped pipes inside a cell', () => {
        assert.deepEqual(plain(NoodleSheet.parseMdRow('| x \\| y | z |')), ['x | y', 'z']);
    });

    test('parseMdRow yields empty strings for empty cells', () => {
        assert.deepEqual(plain(NoodleSheet.parseMdRow('| | b | |')), ['', 'b', '']);
    });

    test('parseMarkdown maps header names onto the schema columns', () => {
        const { columns } = NoodleSheet.parseDbml(BUDGET_DBML);
        const rows = plain(NoodleSheet.parseMarkdown(BUDGET_MD, columns));
        assert.equal(rows.length, 3);
        assert.deepEqual(rows[0], {
            id: '1', description: 'Laptops', estimate: '1200', status: 'Open', due: '2026-01-10', share: '0.5',
        });
        assert.equal(rows[1].description, 'Cables | adapters');
        assert.equal(rows[1].share, '');
        assert.equal(rows[2].estimate, '=A1+B2');
    });

    test('parseMarkdown matches headers case-insensitively and by underscore', () => {
        const { columns } = NoodleSheet.parseDbml('Table t { unit_cost number\n note text }');
        const md = '| Note | UNIT COST |\n|---|---|\n| hi | 7 |';
        assert.deepEqual(plain(NoodleSheet.parseMarkdown(md, columns)), [{ unit_cost: '7', note: 'hi' }]);
    });

    test('parseMarkdown leaves columns missing from the header blank', () => {
        const { columns } = NoodleSheet.parseDbml('Table t { a text\n b text }');
        const md = '| A |\n|---|\n| 1 |';
        assert.deepEqual(plain(NoodleSheet.parseMarkdown(md, columns)), [{ a: '1', b: '' }]);
    });

    test('parseMarkdown returns no rows for empty, blank or header-only input', () => {
        const { columns } = NoodleSheet.parseDbml('Table t { a text }');
        assert.deepEqual(plain(NoodleSheet.parseMarkdown('', columns)), []);
        assert.deepEqual(plain(NoodleSheet.parseMarkdown('   \n', columns)), []);
        assert.deepEqual(plain(NoodleSheet.parseMarkdown('| A |', columns)), []);
        assert.deepEqual(plain(NoodleSheet.parseMarkdown('| A |\n|---|', columns)), []);
    });

    test('parseMarkdown skips blank lines and extra separator rows', () => {
        const { columns } = NoodleSheet.parseDbml('Table t { a text }');
        const md = '| A |\n|---|\n\n| 1 |\n|---|\n| 2 |';
        assert.deepEqual(plain(NoodleSheet.parseMarkdown(md, columns)).map(r => r.a), ['1', '2']);
    });

    test('generateMarkdown pads columns and escapes pipes', () => {
        const { columns } = NoodleSheet.parseDbml('Table t { a text\n b number }');
        const md = NoodleSheet.generateMarkdown(columns, [{ a: 'x|y', b: 1 }, { a: '', b: 22 }]);
        assert.deepEqual(md.split('\n'), [
            '| A    | B   |',
            '|------|-----|',
            '| x\\|y | 1   |',
            '|      | 22  |',
        ]);
    });

    test('generateMarkdown treats undefined cells as empty and widens to the longest value', () => {
        const { columns } = NoodleSheet.parseDbml('Table t { a text }');
        const md = NoodleSheet.generateMarkdown(columns, [{}, { a: 'longer value' }]);
        assert.equal(md.split('\n')[0], '| A            |');
        assert.equal(md.split('\n')[2], '|              |');
    });

    test('generateMarkdown returns an empty string with no columns', () => {
        assert.equal(NoodleSheet.generateMarkdown([], [{ a: 1 }]), '');
    });

    test('markdown round-trips through parse and generate', () => {
        const { columns } = NoodleSheet.parseDbml(BUDGET_DBML);
        const rows = NoodleSheet.parseMarkdown(BUDGET_MD, columns);
        const md = NoodleSheet.generateMarkdown(columns, rows);
        assert.deepEqual(plain(NoodleSheet.parseMarkdown(md, columns)), plain(rows));
        // and is stable on a second pass
        assert.equal(NoodleSheet.generateMarkdown(columns, NoodleSheet.parseMarkdown(md, columns)), md);
    });
});

// ── Column name helpers ──────────────────────────────────────────────

describe('column name helpers', () => {
    const s = sheet();
    test('A, Z, AA, AZ, BA map to the expected indices and back', () => {
        for (const [name, idx] of [['A', 0], ['Z', 25], ['AA', 26], ['AZ', 51], ['BA', 52], ['ZZ', 701], ['AAA', 702]]) {
            assert.equal(s._colNameToIndex(name), idx, name);
            assert.equal(s._indexToColName(idx), name, String(idx));
        }
    });

    test('every index up to 1000 round-trips', () => {
        for (let i = 0; i < 1000; i++) {
            assert.equal(s._colNameToIndex(s._indexToColName(i)), i);
        }
    });
});

// ── Formula engine ───────────────────────────────────────────────────

describe('formula engine', () => {
    // Columns: A=id, B=description, C=estimate, D=status, E=due, F=share
    const s = sheet();
    const data = s.getActiveSheet();

    test('non-formula values pass through untouched', () => {
        assert.equal(s.evaluateFormula('42'), '42');
        assert.equal(s.evaluateFormula(''), '');
        assert.equal(s.evaluateFormula(null), null);
        assert.equal(s.evaluateFormula(7), 7);
    });

    test('cell references resolve and arithmetic respects precedence', () => {
        assert.equal(s.evaluateFormula('=C1+C2', data), 1250);
        assert.equal(s.evaluateFormula('=a1 + c2 * 2', data), 101);   // lower-case refs are upper-cased
        assert.equal(s.evaluateFormula('=(A1 + C2) * 2', data), 102);
        assert.equal(s.evaluateFormula('=C1/4', data), 300);
    });

    test('non-numeric and out-of-range references count as zero', () => {
        assert.equal(s.evaluateFormula('=B1+5', data), 5);     // "Laptops"
        assert.equal(s.evaluateFormula('=Z99+1', data), 1);
        assert.equal(s._getCellValue('Z99', data), '');
        assert.equal(s._getCellValue('A0', data), '');
        assert.equal(s._getCellValue('bogus', data), '');
    });

    test('formulas in referenced cells are evaluated recursively', () => {
        // C3 holds "=A1+B2" → 1 + 0
        assert.equal(s._getCellValue('C3', data), 1);
        assert.equal(s.evaluateFormula('=C3*10', data), 10);
    });

    test('division by zero yields Infinity rather than an error', () => {
        assert.equal(s.evaluateFormula('=C1/0', data), Infinity);
    });

    test('unsafe or malformed expressions return #ERR', () => {
        assert.equal(s.evaluateFormula('=alert(1)', data), '#ERR');
        assert.equal(s.evaluateFormula('=C1 + "x"', data), '#ERR');
        assert.equal(s.evaluateFormula('=(1+', data), '#ERR');
        assert.equal(s.evaluateFormula('=', data), '#ERR');
    });

    test('aggregates over a range skip non-numeric cells', () => {
        // Note: a range yields raw cell text, so the formula in C3 ("=A1+B2")
        // is NOT evaluated here, unlike a direct reference (see the recursive
        // test above). SUM therefore sees only C1 and C2.
        assert.equal(s.evaluateFormula('=SUM(C1:C3)', data), 1250);
        assert.equal(s.evaluateFormula('=AVERAGE(C1:C2)', data), 625);
        assert.equal(s.evaluateFormula('=MIN(C1:C3)', data), 50);
        assert.equal(s.evaluateFormula('=MAX(C1:C3)', data), 1200);
        // COUNT counts non-empty cells, including text and raw formula strings
        assert.equal(s.evaluateFormula('=COUNT(C1:C3)', data), 3);
        assert.equal(s.evaluateFormula('=COUNT(F1:F3)', data), 2);
        assert.equal(s.evaluateFormula('=COUNT(B1:B3)', data), 3);
    });

    test('aggregates over an empty range return zero', () => {
        assert.equal(s.evaluateFormula('=SUM(E3:E3)', data), 0);
        assert.equal(s.evaluateFormula('=AVERAGE(E3:E3)', data), 0);
        assert.equal(s.evaluateFormula('=MIN(E3:E3)', data), 0);
        assert.equal(s.evaluateFormula('=MAX(E3:E3)', data), 0);
        assert.equal(s.evaluateFormula('=COUNT(E3:E3)', data), 0);
    });

    test('_resolveRange walks rows then columns, clips to the sheet and accepts reversed bounds', () => {
        assert.deepEqual(plain(s._resolveRange('A1:C2', data)), ['1', 'Laptops', '1200', '2', 'Cables | adapters', '50']);
        assert.deepEqual(plain(s._resolveRange('C2:A1', data)), ['1', 'Laptops', '1200', '2', 'Cables | adapters', '50']);
        assert.deepEqual(plain(s._resolveRange('A3:A9', data)), ['3']);
        assert.deepEqual(plain(s._resolveRange('A1', data)), ['1']);
        // raw formula strings come back unevaluated from a range
        assert.deepEqual(plain(s._resolveRange('C3:C3', data)), ['=A1+B2']);
    });

    test('IF chooses a branch from numeric and string comparisons', () => {
        assert.equal(s.evaluateFormula('=IF(C1>1000,1,2)', data), 1);
        assert.equal(s.evaluateFormula('=IF(C1<1000,1,2)', data), 2);
        assert.equal(s.evaluateFormula('=IF(C1>=1200,C1,0)', data), 1200);
        assert.equal(s.evaluateFormula('=IF(C1<=1199,1,C2)', data), 50);
        assert.equal(s.evaluateFormula('=IF(A1=1,10,20)', data), 10);
        assert.equal(s.evaluateFormula('=IF(A1<>1,10,20)', data), 20);
        assert.equal(s.evaluateFormula('=IF(A1!=2,10,20)', data), 10);
        assert.equal(s.evaluateFormula('=IF(C1>C2,C1-C2,C2-C1)', data), 1150);
    });

    test('_evalCondition compares strings when either side is non-numeric', () => {
        assert.equal(s._evalCondition('D1=Open', data), true);
        assert.equal(s._evalCondition('D1=OPEN', data), false);    // case-sensitive
        assert.equal(s._evalCondition('D1=Closed', data), false);
        assert.equal(s._evalCondition('D1<>Closed', data), true);
        assert.equal(s._evalCondition('B1>A', data), true);
        assert.equal(s._evalCondition('nocomparison', data), false);
    });

    test('IF with a non-comparison condition takes the false branch', () => {
        assert.equal(s.evaluateFormula('=IF(C1,1,2)', data), 2);
    });

    test('IF string literals are upper-cased with the formula, so mixed-case cell text never matches', () => {
        // evaluateFormula upper-cases the whole expression before parsing;
        // the cell still holds "Open", so this comparison is "Open" = "OPEN".
        assert.equal(s.evaluateFormula('=IF(D1=Open,1,2)', data), 2);
    });
});

// ── Sheet model ──────────────────────────────────────────────────────

describe('sheet model', () => {
    test('constructor loads sheets from options and parses their rows', () => {
        const s = sheet();
        assert.equal(s.getSheetCount(), 1);
        assert.equal(s.getActiveSheet().name, 'Budget');
        assert.equal(s.getRows().length, 3);
        assert.equal(s.getColumns().length, 6);
        assert.equal(s.activeSheetIndex, 0);
    });

    test('addSheet falls back to the table name, then a numbered name', () => {
        const s = new NoodleSheet({});
        s.addSheet('', 'Table people { name text }', '');
        s.addSheet(undefined, 'no table here', '');
        assert.deepEqual(plain(s.sheets.map(x => x.name)), ['people', 'Sheet 2']);
        assert.equal(s.getActiveSheet(), s.sheets[0]);
    });

    test('activateSheet ignores out-of-range indices and resets the selection', () => {
        const s = sheet();
        s.addSheet('Second', 'Table t { a text }', '');
        s.selection = { row: 1, col: 1 };
        s.activateSheet(5);
        assert.equal(s.activeSheetIndex, 0);
        assert.deepEqual(plain(s.selection), { row: 1, col: 1 });
        s.activateSheet(1);
        assert.equal(s.activeSheetIndex, 1);
        assert.deepEqual(plain(s.selection), { row: -1, col: -1 });
        s.activateSheet(-1);
        assert.equal(s.activeSheetIndex, 1);
    });

    test('getActiveSheet is null with no sheets and model ops are no-ops', () => {
        const s = new NoodleSheet({});
        assert.equal(s.getActiveSheet(), null);
        s.addRow({ a: 1 });
        s.deleteRow(0);
        s.setCellValue(0, 0, 'x');
        s.undo();
        s.redo();
        assert.equal(s.getMarkdown(), '');
        assert.deepEqual(plain(s.getRows()), []);
    });

    test('addRow fills every column, using supplied data where given', () => {
        const changes = [];
        const s = sheet({ onChange: (i, md) => changes.push([i, md]) });
        s.addRow({ description: 'New', estimate: 9, bogus: 'ignored' });
        const rows = plain(s.getRows());
        assert.equal(rows.length, 4);
        assert.deepEqual(rows[3], { id: '', description: 'New', estimate: 9, status: '', due: '', share: '' });
        assert.equal(changes.length, 1);
        assert.equal(changes[0][0], 0);
        assert.match(changes[0][1], /\| New/);
    });

    test('deleteRow removes the row, clamps the selection and respects readOnly', () => {
        const s = sheet();
        s.selection = { row: 2, col: 0 };
        s.deleteRow(2);
        assert.deepEqual(plain(s.getRows()).map(r => r.id), ['1', '2']);
        assert.equal(s.selection.row, 1);
        s.deleteRow(7);
        s.deleteRow(-1);
        assert.equal(s.getRows().length, 2);

        const ro = sheet({ readOnly: true });
        ro.deleteRow(0);
        assert.equal(ro.getRows().length, 3);
    });

    test('setCellValue writes by column index and ignores bad coordinates', () => {
        const s = sheet();
        s.setCellValue(1, 2, '75');
        assert.equal(s.getRows()[1].estimate, '75');
        s.setCellValue(9, 0, 'x');
        s.setCellValue(0, 9, 'x');
        s.setCellValue(-1, 0, 'x');
        assert.deepEqual(plain(s.getRows()).map(r => r.id), ['1', '2', '3']);
    });

    test('undo and redo walk the snapshot stacks', () => {
        const s = sheet();
        s.setCellValue(0, 1, 'first');
        s.setCellValue(0, 1, 'second');
        assert.equal(s.getRows()[0].description, 'second');
        s.undo();
        assert.equal(s.getRows()[0].description, 'first');
        s.undo();
        assert.equal(s.getRows()[0].description, 'Laptops');
        s.undo(); // nothing left
        assert.equal(s.getRows()[0].description, 'Laptops');
        s.redo();
        assert.equal(s.getRows()[0].description, 'first');
        s.redo();
        assert.equal(s.getRows()[0].description, 'second');
        s.redo(); // nothing left
        assert.equal(s.getRows()[0].description, 'second');
    });

    test('a new edit clears the redo stack and the undo stack is capped', () => {
        const s = sheet();
        s.setCellValue(0, 1, 'a');
        s.undo();
        assert.equal(s.redoStack.length, 1);
        s.setCellValue(0, 1, 'b');
        assert.equal(s.redoStack.length, 0);

        s.maxUndo = 3;
        for (let i = 0; i < 10; i++) s.setCellValue(0, 1, 'v' + i);
        assert.equal(s.undoStack.length, 3);
    });

    test('_saveSnapshot skips a duplicate of the last snapshot', () => {
        const s = sheet();
        s._saveSnapshot();
        s._saveSnapshot();
        assert.equal(s.undoStack.length, 1);
    });

    test('getMarkdown and loadMarkdown round-trip a sheet by index', () => {
        const s = sheet();
        s.addSheet('Second', 'Table t { a text\n b number }', '');
        s.loadMarkdown('| A | B |\n|---|---|\n| x | 1 |', 1);
        assert.deepEqual(plain(s.getRows(1)), [{ a: 'x', b: '1' }]);
        assert.equal(s.getMarkdown(1), '| A   | B   |\n|-----|-----|\n| x   | 1   |');
        assert.equal(s.getMarkdown(9), '');
        s.loadMarkdown('| A |\n|---|\n| only |');   // active sheet (index 0) gets replaced
        assert.equal(s.getRows().length, 1);
        assert.equal(s.getRows()[0].description, '');
        s.loadMarkdown('whatever', 9);              // out of range is a no-op
    });

    test('renameSheet and deleteSheet keep at least one sheet and a valid active index', () => {
        const s = sheet();
        s.renameSheet(0, 'Costs');
        assert.equal(s.sheets[0].name, 'Costs');
        s.renameSheet(4, 'nope');
        s.deleteSheet(0);
        assert.equal(s.getSheetCount(), 1);
        s.addSheet('Two', 'Table t { a text }', '');
        s.addSheet('Three', 'Table t { a text }', '');
        s.activateSheet(2);
        s.deleteSheet(2);
        assert.equal(s.activeSheetIndex, 1);
        assert.deepEqual(plain(s.sheets.map(x => x.name)), ['Costs', 'Two']);
    });

    test('_insertRow pads out to the index and inserts a blank row', () => {
        const s = sheet();
        s._insertRow(1);
        let rows = plain(s.getRows());
        assert.equal(rows.length, 4);
        assert.deepEqual(rows[1], { id: '', description: '', estimate: '', status: '', due: '', share: '' });
        assert.equal(rows[2].id, '2');
        s._insertRow(7);
        rows = plain(s.getRows());
        assert.equal(rows.length, 8);
        assert.equal(rows[7].id, '');
    });

    test('sortByColumn sorts by type, puts blanks last and toggles direction', () => {
        const s = sheet();
        s.setCellValue(2, 2, '300');
        s.sortByColumn(2);                      // estimate, numeric ascending
        assert.deepEqual(plain(s.getRows()).map(r => r.estimate), ['50', '300', '1200']);
        s.sortByColumn(2);                      // same column → descending
        assert.deepEqual(plain(s.getRows()).map(r => r.estimate), ['1200', '300', '50']);
        s.sortByColumn(5);                      // share: blank sorts to the bottom even ascending
        assert.deepEqual(plain(s.getRows()).map(r => r.share), ['0.25', '0.5', '']);
        s.sortByColumn(1);                      // text, case-insensitive
        assert.deepEqual(plain(s.getRows()).map(r => r.description), ['Cables | adapters', 'Consultant', 'Laptops']);
        s.sortByColumn(4);                      // date
        assert.deepEqual(plain(s.getRows()).map(r => r.due), ['2026-01-10', '2026-02-01', '']);
    });
});

// ── Formatting helpers ───────────────────────────────────────────────

describe('formatting helpers', () => {
    const s = sheet();

    test('_formatNumber handles currency, percentage, integers, decimals and NaN', () => {
        assert.equal(s._formatNumber(NaN, 'number', null), '');
        assert.equal(s._formatNumber(1234.5, 'number', 'currency'), (1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        assert.equal(s._formatNumber(0.256, 'number', 'percentage'), '25.6%');
        assert.equal(s._formatNumber(1200, 'number', null), (1200).toLocaleString());
        assert.equal(s._formatNumber(3.14159, 'number', null), (3.14159).toLocaleString(undefined, { maximumFractionDigits: 2 }));
        assert.equal(s._formatNumber(7, 'text', null), '7');
    });

    test('_csvEscape quotes commas, quotes and newlines', () => {
        assert.equal(s._csvEscape('plain'), 'plain');
        assert.equal(s._csvEscape('a,b'), '"a,b"');
        assert.equal(s._csvEscape('say "hi"'), '"say ""hi"""');
        assert.equal(s._csvEscape('two\nlines'), '"two\nlines"');
        assert.equal(s._csvEscape(5), '5');
    });

    test('_escapeRegex neutralises metacharacters', () => {
        assert.equal(s._escapeRegex('a.b*c?'), 'a\\.b\\*c\\?');
        assert.equal(new RegExp(s._escapeRegex('(1+1)')).test('x(1+1)y'), true);
    });
});
