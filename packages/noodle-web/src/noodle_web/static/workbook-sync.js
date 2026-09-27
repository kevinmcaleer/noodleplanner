// Project workbook sync (#1138, part of the front-of-house Sync feature #913).
//
// The Report ribbon's Share > Excel exports the whole plan as one workbook.
// The people it goes to -- a network engineer with no MS Project licence,
// say -- mark tasks done and leave notes in it, and those edits have to come
// back into the plan. Before this, the only way back was the generic Excel
// import wizard, which rebuilds a plan from a spreadsheet rather than merging
// one into it. This is a real sync target instead, alongside the RAID
// workbook and MS Project targets (#868): link the workbook once, press Sync,
// review what changed, and the merged plan is written back to the same file.
//
// ## What syncs back, and what is export-only
//
// The workbook is a report, and most of it is computed: dates come out of the
// scheduler, durations and RAG from the dates, the EVM sheet from everything.
// Letting an edit to a computed cell "win" would mean inventing the plan text
// that produces it. So only two columns of the Tasks sheet are authoritative:
//
//   - `% Complete`, the one thing someone outside the PM role most often has
//     to report. Not for a summary task, whose percent is rolled up from its
//     children, nor for a task tracked by effort (`~2h/4h`), whose percent the
//     effort overrides (tokeniser.js).
//   - `Comment`, the task's quoted note.
//
// A row added to the Tasks sheet becomes a new task, placed after the row
// above it. A row deleted from it is offered as a removal, unticked by
// default. Everything else in the workbook, including its RAID Log sheet, is
// export-only: RAID items sync through their own workbook target
// ('raid-excel'), which is a different file with a different shape.
//
// ## Matching rows to tasks, and the three-way base
//
// Plan markdown has no persistent task id, so a task is identified by its name
// and its ancestors' names (msproject-task-diff.js does the same). That breaks
// the moment someone tidies the indentation in the Name column, so every
// workbook this writes also carries a hidden `_noodle_sync` sheet: one row per
// task with the row's ID, the task's path, and the percent and comment the
// file was written with. A row is matched through its ID first, and that sheet
// is the base of a real three-way diff. The base travels inside the file, so it
// is right even when the workbook was exported months ago or on another
// machine. A workbook without the sheet (the server-side exporter, or a copy
// saved by a tool that drops hidden sheets) falls back to the last-synced
// snapshot kept in localStorage, and failing that every difference is shown
// as a conflict, defaulting to the plan's value.

import { extractMetadata } from './engine/tokeniser.js';
import { extractTaskName } from './msproject-task-diff.js';

export const WORKBOOK_SYNC_SHEET = '_noodle_sync';
export const WORKBOOK_SYNC_HEADERS = ['ID', 'Path', '% Complete', 'Comment'];
export const WORKBOOK_SYNC_FIELDS = ['percent', 'comment'];
const PATH_SEP = ' › ';
const STORAGE_PREFIX = 'noodleplanner-workbook-sync:';

// ---------------------------------------------------------------------------
// Names and paths

/** A task name as both sides can compare it: case, spacing and underscores
 *  (the export writes `_` as a space) do not matter, a percent token does not
 *  belong to the name. */
export function normalizeTaskName(name) {
    return String(name || '')
        .replace(/_/g, ' ')
        .replace(/\s*\b\d{1,3}%/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Give each item of an outline a path key: its ancestors' names and its own,
 * with `#2`, `#3`... on a repeated name under the same parent. `depthOf(item)`
 * is any number that grows with nesting (an indent, a level).
 */
function assignPaths(items, depthOf, nameOf) {
    const stack = []; // { depth, path }
    const seen = new Map(); // parentPath -> Map(name -> count)
    for (const item of items) {
        const depth = depthOf(item);
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
        const parentPath = stack.length ? stack[stack.length - 1].path : '';
        const name = normalizeTaskName(nameOf(item));
        if (!seen.has(parentPath)) seen.set(parentPath, new Map());
        const counts = seen.get(parentPath);
        const n = (counts.get(name) || 0) + 1;
        counts.set(name, n);
        const segment = n > 1 ? `${name}#${n}` : name;
        item.parentPath = parentPath;
        item.path = parentPath ? parentPath + PATH_SEP + segment : segment;
        stack.push({ depth, path: item.path });
    }
    return items;
}

function lastSegment(path) {
    const i = path.lastIndexOf(PATH_SEP);
    return i === -1 ? path : path.slice(i + PATH_SEP.length);
}

function parentOf(path) {
    const i = path.lastIndexOf(PATH_SEP);
    return i === -1 ? '' : path.slice(0, i);
}

// ---------------------------------------------------------------------------
// The plan side

function normalizePercent(value) {
    if (value === '' || value === null || value === undefined) return 0;
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

/**
 * The task outline of a plan body (front matter and back-matter sections
 * already stripped), one node per task line, with the values that sync.
 */
export function parsePlanTasks(bodyText) {
    const lines = String(bodyText || '').split('\n');
    const nodes = [];
    lines.forEach((raw, lineIndex) => {
        if (!raw.trim() || raw.trimStart().startsWith('//')) return;
        const indent = raw.length - raw.trimStart().length;
        const meta = extractMetadata(raw.trim());
        nodes.push({
            raw, lineIndex, indent,
            name: extractTaskName(raw),
            percent: normalizePercent(meta.percent),
            comment: meta.comment || '',
            effortTracked: meta.effort_completed !== undefined && meta.effort_total !== undefined,
            isSummary: false,
        });
    });
    nodes.forEach((node, i) => {
        const next = nodes[i + 1];
        node.isSummary = Boolean(next && next.indent > node.indent);
    });
    return assignPaths(nodes, (n) => n.indent, (n) => n.name);
}

// ---------------------------------------------------------------------------
// Writing the hidden sheet

/**
 * One row per exported task, in Tasks-sheet order: the row ID, the task's
 * path, and the values the workbook was written with. `tasks` are the parse
 * result's tasks, the same list buildTaskRows() writes.
 */
export function buildSyncRows(tasks) {
    const items = (tasks || []).map((task, index) => ({
        id: index + 1,
        level: Number(task.level || 0),
        name: task.name || '',
        percent: normalizePercent(task.percent),
        comment: task.comment || '',
    }));
    assignPaths(items, (t) => t.level, (t) => t.name);
    return items.map(({ id, path, percent, comment }) => ({ id, path, percent, comment }));
}

export function addSyncSheet(workbook, tasks) {
    const worksheet = workbook.addWorksheet(WORKBOOK_SYNC_SHEET);
    // veryHidden: not even listed in Excel's Unhide dialog. The sheet is
    // NoodlePlanner's memory of what it wrote, not something to edit.
    worksheet.state = 'veryHidden';
    worksheet.addRow(WORKBOOK_SYNC_HEADERS);
    for (const row of buildSyncRows(tasks)) worksheet.addRow([row.id, row.path, row.percent, row.comment]);
    return worksheet;
}

// ---------------------------------------------------------------------------
// Reading a workbook back

/** A cell's value as plain text, whatever ExcelJS hands back for it. */
function cellText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
        if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
        if ('result' in value) return cellText(value.result);
        if ('text' in value) return cellText(value.text);
        if (value instanceof Date) return value.toISOString().slice(0, 10);
        return '';
    }
    return String(value);
}

/**
 * A `% Complete` cell as 0-100. Typing `50%` into a General cell makes Excel
 * store 0.5 with a percent format, so a percent-formatted number is scaled.
 * Returns null for something that is not a percent at all.
 */
export function percentFromCell(value, numFmt = '') {
    if (value && typeof value === 'object' && 'result' in value) value = value.result;
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') {
        return normalizePercent(String(numFmt).includes('%') ? value * 100 : value);
    }
    const m = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(cellText(value));
    return m ? normalizePercent(parseFloat(m[1])) : null;
}

function headerIndex(worksheet) {
    const index = {};
    worksheet.getRow(1).eachCell((cell, col) => {
        index[cellText(cell.value).trim().toLowerCase()] = col;
    });
    return index;
}

/**
 * The Tasks sheet and hidden base sheet of a plan workbook (an ExcelJS
 * Workbook). Throws when there is no Tasks sheet, so the RAID workbook, say,
 * is refused rather than read as an empty plan.
 */
export function readWorkbookTasks(workbook) {
    const sheet = workbook.getWorksheet('Tasks');
    if (!sheet) throw new Error('This workbook has no Tasks sheet. Link the project workbook that Report > Share > Excel exports.');
    const col = headerIndex(sheet);
    for (const header of ['task name', '% complete']) {
        if (!col[header]) throw new Error(`The Tasks sheet has no "${header}" column.`);
    }
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const rawName = cellText(row.getCell(col['task name']).value);
        if (!rawName.trim()) return;
        const idText = col.id ? cellText(row.getCell(col.id).value).trim() : '';
        const percentCell = row.getCell(col['% complete']);
        rows.push({
            rowNumber,
            id: /^\d+$/.test(idText) ? Number(idText) : null,
            name: rawName.trim(),
            depth: rawName.length - rawName.trimStart().length,
            percent: percentFromCell(percentCell.value, percentCell.numFmt),
            comment: col.comment ? cellText(row.getCell(col.comment).value).trim() : '',
        });
    });
    assignPaths(rows, (r) => r.depth, (r) => r.name);

    let base = null;
    const hidden = workbook.getWorksheet(WORKBOOK_SYNC_SHEET);
    if (hidden) {
        base = [];
        hidden.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const id = Number(cellText(row.getCell(1).value));
            if (!Number.isInteger(id)) return;
            base.push({
                id,
                path: cellText(row.getCell(2).value),
                percent: normalizePercent(row.getCell(3).value),
                comment: cellText(row.getCell(4).value),
            });
        });
    }
    return { rows, base };
}

// ---------------------------------------------------------------------------
// The diff

/**
 * Compare the plan's tasks with a workbook's. `base` is the rows the workbook
 * was written with (its hidden sheet, or the stored snapshot), or null.
 *
 * Returns { entries, unmatched }. Each entry is one of:
 *   - updated:  only the workbook changed a field since the base
 *   - conflict: both changed it, differently (or there is no base to tell)
 *   - added:    a row with no task, and no id the base knows
 *   - removed:  a base row the workbook no longer has, whose task still exists
 * `unmatched` counts rows skipped because the task they came from has since
 * been deleted or renamed in the plan, which is the plan's change to keep.
 */
export function diffWorkbookTasks(localBody, workbookRead, fallbackBase = null) {
    const local = parsePlanTasks(localBody);
    const byPath = new Map(local.map((n) => [n.path, n]));
    const base = workbookRead.base || fallbackBase || null;
    const baseById = new Map((base || []).map((b) => [b.id, b]));
    const entries = [];
    let unmatched = 0;
    const seenIds = new Set();
    // A workbook row's path, as the plan's path: a row matched by id keeps
    // the plan's path even if its name or indent was edited in Excel, and a
    // new row under it hangs off that.
    const resolved = new Map();
    let previousPath = null;

    for (const row of workbookRead.rows) {
        const baseRow = row.id !== null ? baseById.get(row.id) : undefined;
        if (baseRow) seenIds.add(row.id);
        const parentPath = row.parentPath ? (resolved.get(row.parentPath) ?? row.parentPath) : '';
        const ownPath = parentPath ? parentPath + PATH_SEP + lastSegment(row.path) : lastSegment(row.path);
        const path = baseRow ? baseRow.path : ownPath;
        resolved.set(row.path, path);
        const node = byPath.get(path);

        if (!node) {
            if (baseRow) {
                unmatched++;
            } else {
                entries.push({
                    kind: 'added', key: 'row:' + row.rowNumber, path, name: row.name,
                    parentPath, afterPath: previousPath,
                    external: { percent: row.percent ?? 0, comment: row.comment },
                });
                previousPath = path;
            }
            continue;
        }
        previousPath = node.path;

        const fields = [];
        for (const field of WORKBOOK_SYNC_FIELDS) {
            if (field === 'percent' && (node.isSummary || node.effortTracked || row.percent === null)) continue;
            const mine = node[field];
            const theirs = row[field];
            if (mine === theirs) continue;
            const was = baseRow ? baseRow[field] : undefined;
            if (baseRow && theirs === was) continue; // only the plan moved on
            const conflict = !baseRow || mine !== was;
            fields.push({ field, local: mine, external: theirs, base: was, conflict });
        }
        if (fields.length) {
            entries.push({
                kind: fields.some((f) => f.conflict) ? 'conflict' : 'updated',
                key: 'task:' + node.path, path: node.path, name: node.name, fields,
            });
        }
    }

    // A base row that is gone from the workbook: someone deleted it there.
    if (workbookRead.base || fallbackBase) {
        for (const b of base) {
            if (seenIds.has(b.id)) continue;
            const node = byPath.get(b.path);
            if (!node) continue;
            const descendants = local.filter((n) => n.path.startsWith(node.path + PATH_SEP)).length;
            entries.push({ kind: 'removed', key: 'task:' + node.path, path: node.path, name: node.name, descendantCount: descendants });
        }
    }
    return { entries, unmatched, hasBase: Boolean(base) };
}

export function defaultWorkbookSyncChoice(kind) {
    if (kind === 'updated' || kind === 'added') return 'accept';
    if (kind === 'conflict') return 'keep-mine';
    return 'reject'; // a deleted spreadsheet row is as often a filter or a slip as a decision
}

// ---------------------------------------------------------------------------
// Editing task lines

// Mask quoted comments and `@res[50%]` allocations with same-length filler so
// a search for the task's own percent token cannot land inside either.
function maskLine(line) {
    return line
        .replace(/!?"[^"]*"|!?'[^']*'/g, (m) => ' '.repeat(m.length))
        .replace(/@[^\s[]+\[\d+%\]/g, (m) => ' '.repeat(m.length));
}

/** Set a task line's percent complete, rewriting its token or adding one. */
export function setLinePercent(line, percent) {
    const value = normalizePercent(percent);
    const masked = maskLine(line);
    const token = /\b(\d{1,3})%/.exec(masked);
    if (token) {
        const start = token.index;
        return line.slice(0, start) + value + '%' + line.slice(start + token[0].length);
    }
    const legacy = /\bp(\d{1,3})\b/.exec(masked);
    if (legacy) {
        return line.slice(0, legacy.index) + value + '%' + line.slice(legacy.index + legacy[0].length);
    }
    if (value === 0) return line;
    return line.replace(/\s*$/, '') + ' ' + value + '%';
}

/** Set a task line's comment, rewriting its quoted note, adding or removing one. */
export function setLineComment(line, comment) {
    const text = String(comment || '').replace(/"/g, '”').replace(/\s+/g, ' ').trim();
    const quoted = /(!?)"[^"]+"|(!?)'[^']+'/.exec(line);
    if (quoted) {
        if (!text) return (line.slice(0, quoted.index).replace(/\s+$/, '') + line.slice(quoted.index + quoted[0].length)).replace(/\s+$/, '');
        const bang = quoted[1] || quoted[2] || '';
        return line.slice(0, quoted.index) + bang + '"' + text + '"' + line.slice(quoted.index + quoted[0].length);
    }
    if (!text) return line;
    return line.replace(/\s*$/, '') + ' "' + text + '"';
}

function detectIndentStep(nodes) {
    for (let i = 1; i < nodes.length; i++) {
        if (nodes[i].indent > nodes[i - 1].indent) return nodes[i].indent - nodes[i - 1].indent;
    }
    return 2;
}

/**
 * Apply the chosen entries to a plan body and return the new body. `choices`
 * maps an entry's key to accept/reject (updated, added, removed) or
 * keep-mine/keep-theirs (conflict).
 */
export function applyWorkbookTaskDiff(localBody, diff, choices) {
    const lines = String(localBody || '').split('\n');
    const nodes = parsePlanTasks(localBody);
    const byPath = new Map(nodes.map((n) => [n.path, n]));
    const step = detectIndentStep(nodes);
    const taking = (entry) => {
        const c = choices[entry.key];
        return entry.kind === 'conflict' ? c === 'keep-theirs' : c === 'accept';
    };

    // Field edits first: they change lines in place.
    for (const entry of diff.entries) {
        if ((entry.kind !== 'updated' && entry.kind !== 'conflict') || !taking(entry)) continue;
        const node = byPath.get(entry.path);
        if (!node) continue;
        let line = lines[node.lineIndex];
        for (const f of entry.fields) {
            line = f.field === 'percent' ? setLinePercent(line, f.external) : setLineComment(line, f.external);
        }
        lines[node.lineIndex] = line;
    }

    // Then build the result as a list of rows, so insertions and removals do
    // not shift each other's indices.
    const rows = lines.map((text, i) => ({ text, node: nodes.find((n) => n.lineIndex === i) || null, removed: false }));
    const subtreeEnd = (row) => {
        let i = rows.indexOf(row);
        const indent = row.node ? row.node.indent : row.indent;
        let end = i;
        for (let j = i + 1; j < rows.length; j++) {
            const r = rows[j];
            const rIndent = r.node ? r.node.indent : r.indent;
            if (!r.text.trim()) continue;
            if (rIndent === undefined || rIndent <= indent) break;
            end = j;
        }
        return end;
    };

    for (const entry of diff.entries) {
        if (entry.kind !== 'removed' || !taking(entry)) continue;
        const node = byPath.get(entry.path);
        const row = node && rows.find((r) => r.node === node);
        if (!row) continue;
        const end = subtreeEnd(row);
        for (let j = rows.indexOf(row); j <= end; j++) rows[j].removed = true;
    }

    const rowByPath = new Map(rows.filter((r) => r.node).map((r) => [r.node.path, r]));
    for (const entry of diff.entries) {
        if (entry.kind !== 'added' || !taking(entry)) continue;
        const parent = entry.parentPath ? rowByPath.get(entry.parentPath) : null;
        if (entry.parentPath && (!parent || parent.removed)) continue;
        const parentIndent = parent ? (parent.node ? parent.node.indent : parent.indent) : null;
        const indent = parent ? parentIndent + step : 0;
        let text = ' '.repeat(indent) + entry.name.trim();
        text = setLinePercent(text, entry.external.percent);
        text = setLineComment(text, entry.external.comment);
        const row = { text, node: null, indent, removed: false };

        // Right after the row above it in the workbook: straight after its
        // parent when that is the row above (a first child), otherwise after
        // the subtree of whichever ancestor-or-self of the row above is its
        // sibling -- inserting after a deeper row would adopt that row's
        // later siblings as its own children. Failing both, at the end of
        // its parent, or of the outline.
        let at = null;
        let p = entry.afterPath;
        while (p) {
            const r = rowByPath.get(p);
            if (p === entry.parentPath) { if (r && !r.removed) at = rows.indexOf(r) + 1; break; }
            if (parentOf(p) === entry.parentPath) { if (r && !r.removed) at = subtreeEnd(r) + 1; break; }
            p = parentOf(p);
        }
        if (at === null && parent) at = subtreeEnd(parent) + 1;
        if (at === null) {
            at = rows.length;
            while (at > 0 && !rows[at - 1].text.trim()) at--;
        }
        rows.splice(at, 0, row);
        rowByPath.set(entry.path, row);
    }

    return rows.filter((r) => !r.removed).map((r) => r.text).join('\n');
}

// ---------------------------------------------------------------------------
// The stored snapshot: the base when a workbook has lost its hidden sheet.

export function getWorkbookSyncState(projectId) {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + (projectId || 'default'));
        return raw ? JSON.parse(raw) : null;
    } catch (_error) {
        return null;
    }
}

export function setWorkbookSyncState(projectId, state) {
    try {
        localStorage.setItem(STORAGE_PREFIX + (projectId || 'default'), JSON.stringify(state));
    } catch (error) {
        console.warn('Failed to persist project workbook sync state:', error);
    }
}

export function clearWorkbookSyncState(projectId) {
    try {
        localStorage.removeItem(STORAGE_PREFIX + (projectId || 'default'));
    } catch (_error) { /* nothing to clear */ }
}
