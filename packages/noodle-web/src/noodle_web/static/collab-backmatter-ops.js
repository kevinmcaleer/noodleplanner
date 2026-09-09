/**
 * collab-backmatter-ops.js -- extends #967's host-authoritative edit
 * protocol to the plan's back-matter sections (#969, part of the #766
 * collab-sessions epic).
 *
 * ## Scope: RAID/risk log only, deliberately
 *
 * #969 asks for live editing on four structurally different sections --
 * benefits realisation mapping, comms plan, risk/RAID log, and weekly
 * updates/highlights -- each with its own row shape and its own
 * parse/serialise pair in noodle-core/format_converter.py. Building and,
 * critically, *thoroughly testing* a table-injection-safe row-op path for
 * all four in one pass is exactly the kind of "generalise the op protocol
 * to more content" work that produced #967/#999's original newline
 * vulnerability and its #1007 follow-up fix. This module deliberately
 * covers only the RAID log:
 *
 *  - it already has rich, stable per-row identity (an `id` field minted by
 *    format_converter.py's `parse_raid_markdown`, not a document position)
 *    from #736's escalation work, which is exactly the kind of stable
 *    reference #967 had to invent staleness handling to work around for
 *    tasks;
 *  - its parse/serialise round trip (`parse_raid_markdown` /
 *    `generate_raid_log_text` / `update_plan_raid_log`) is mature and
 *    already pipe/newline-escaping disciplined (see `escapeCell` below).
 *
 * The op protocol below (`backmatter_op`, `section`, row-id addressing,
 * add/edit/delete) is written to extend cleanly to benefits, comms and
 * weekly updates -- each would need only its own parse/serialise pair
 * (mirroring `parseRaidTable` / `serializeRaidTable` / `spliceRaidSection`)
 * and a small dispatch by `op.section` in `applyBackmatterOp` -- but that
 * wiring, and the testing it deserves, is left to a follow-up issue rather
 * than claimed here. See the #969 PR description for the explicit
 * per-section coverage statement.
 *
 * ## Row identity, and why this needs no `expect` field
 *
 * #967's task ops carry `expect` (the task name the sender last saw)
 * because task ids are positions in document order -- they shift under
 * concurrent structural edits, so an id alone cannot prove the op still
 * targets what the sender thinks it does. RAID rows have no such problem:
 * `parse_raid_markdown` assigns each row a real, stable `id` (the table's
 * ID column, or the next unused integer) that survives edits to *other*
 * rows untouched. A `row_id` that still exists in the current document is
 * therefore already proof the op targets the right row -- no separate
 * staleness token is needed, only an existence check (`unknown_row`).
 *
 * ## Conflict resolution
 *
 * Identical rule to #967: the host applies ops in the single order they
 * arrive on its socket, so last write wins deterministically, and a
 * displaced edit is reported rather than silently dropped -- see
 * `describeBackmatterConflict` below, the RAID-row counterpart of
 * collab-ops.js's `describeConflict`. Conflict *tracking* (who last
 * touched which row, and how recently) reuses collab-ops.js's
 * `createConflictTracker` directly rather than re-implementing it: it is
 * already keyed by an arbitrary string, so a RAID `row_id` works exactly
 * like a task name did, provided the host keeps a *separate* tracker
 * instance for rows (a task id and a row id are different id spaces, and
 * sharing one tracker would let a coincidentally-matching id cross-report
 * conflicts between an unrelated task and row).
 *
 * ## Table injection (the #1007 vulnerability class, for tables)
 *
 * A markdown table is more fragile than the single-line task text #967
 * edits: an unescaped `|` in a cell splits it into extra columns, and an
 * unescaped newline ends the row (and starts a new one, or a bare line
 * that breaks the table) early. `format_converter.py`'s
 * `generate_raid_log_text` already escapes both (`escape_pipe`: `|` ->
 * `\|`, and collapses embedded newlines to spaces) for the normal
 * (non-collab) editing path, and `parse_raid_markdown` reverses the pipe
 * escaping on read. This module applies the same two defences at the same
 * two points, ported faithfully to JS (`escapeCell` / `unescapeCell`)
 * -- plus, matching collab-ops.js's `add_task`/`rename` handling of
 * untrusted joiner input, every free-text field is newline-collapsed a
 * second time as soon as it comes off the wire in `sanitizeText`, before
 * it is even stored on the in-memory row. That is defence in depth: the
 * op payload can never carry a raw newline into a row, and even if it
 * somehow did, serialisation would still neutralise it.
 *
 * Two gaps worth flagging (not fixed in noodle-core/script.js, out of
 * scope for #969, but both closed within *this* module):
 *
 *  - `generate_raid_log_text`'s `escape_pipe` collapses `\n` but not a
 *    lone `\r`, so a `\r`-only line ending could in principle survive
 *    into a table cell via the *non-collab* editing path. This module's
 *    own `sanitizeText`/`escapeCell` collapse `\r` too.
 *  - format_converter.py's `_next_marker_idx` (and script.js's ported
 *    equivalent) finds a section marker with a plain substring search
 *    (`text.find(marker, from_idx)`), not anchored to a whole line. A
 *    RAID cell is free text, so a value that simply *contains* the
 *    literal characters `---whiteboard---` -- with no embedded newline
 *    needed at all -- makes the *next* op's re-parse of the document
 *    truncate the table at that substring and splice the remainder in
 *    as a bogus section. Found by this issue's own manual verification
 *    step (see the PR description), not by the automated tests initially
 *    written for it -- a reminder that a passing test suite proves the
 *    cases it thought to cover, not the vulnerability class in general.
 *    `indexOfMarkerLine` below fixes this *for the collab-op path* by
 *    requiring a marker to be the entire trimmed content of its own
 *    line before it counts, mirroring plan-model.js's already-safe
 *    `BACK_MATTER` regex. The equivalent gap in the non-collab
 *    Python/script.js serialisers remains open -- worth a follow-up.
 */

const RAID_LOG_START = '---raid log---';
const COMMS_START = '---comms---';
const LESSONS_START = '---lessons learned---';
const BASELINE_START = '---baseline---';
const WHITEBOARD_START = '---whiteboard---';
const PARKING_LOT_START = '---parking lot---';

// Every back-matter section marker this module needs to avoid tripping
// over -- mirrors format_converter.py's ALL_SECTION_MARKERS. A section
// boundary is always "whichever other marker occurs next in the actual
// text", never just the ones that are supposed to come later in canonical
// order (see noodle-core's #978 fix) -- otherwise a section that's out of
// canonical position gets silently swallowed into its neighbour.
const ALL_SECTION_MARKERS = [
    '---highlights---', '---end-highlights---', '---budget---', '---benefits---',
    RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START,
    PARKING_LOT_START,
];

/** Index of `marker` where it is the *entire* trimmed content of its own
 * physical line, at or after `fromIdx` -- never a substring embedded
 * inside another line. -1 if no such line exists.
 *
 * This closes a real gap that a naive `text.indexOf(marker)` (what
 * format_converter.py's `_next_marker_idx` actually does) has: a RAID
 * cell is free text, so a joiner-supplied owner/description/etc could
 * legitimately *contain* the literal characters "---whiteboard---" as
 * part of an ordinary single-line value, with no embedded newline at
 * all. sanitizeText's newline-collapsing stops a crafted value from
 * *becoming* its own line, but does nothing to stop a substring match
 * against a marker that already appears mid-line -- found by manual
 * verification of this feature (a value containing that exact substring
 * caused the next op's re-parse to truncate the RAID table right at the
 * embedded text and splice the remainder in as a bogus section). Every
 * marker lookup in this module goes through this function specifically
 * so that only a line that really is just the marker, not a table row
 * that happens to quote it, is ever treated as a section boundary --
 * mirrors how plan-model.js's BACK_MATTER regex already requires a whole
 * trimmed line to match, for the same reason. */
function indexOfMarkerLine(text, marker, fromIdx) {
    let searchFrom = fromIdx;
    while (searchFrom <= text.length) {
        const idx = text.indexOf(marker, searchFrom);
        if (idx === -1) return -1;
        const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
        let lineEnd = text.indexOf('\n', idx + marker.length);
        if (lineEnd === -1) lineEnd = text.length;
        if (text.slice(lineStart, lineEnd).trim() === marker) return idx;
        searchFrom = idx + marker.length;
    }
    return -1;
}

function nextMarkerIdx(text, fromIdx, exclude) {
    let endIdx = text.length;
    for (const marker of ALL_SECTION_MARKERS) {
        if (exclude.includes(marker)) continue;
        const idx = indexOfMarkerLine(text, marker, fromIdx);
        if (idx !== -1 && idx < endIdx) endIdx = idx;
    }
    return endIdx;
}

/** Raw text of the section starting at `startMarker`, up to whichever
 * other marker occurs next (or EOF). Empty string if the marker is
 * absent. Mirrors format_converter.py's extract_raid_log/extract_comms_
 * plan/etc, which all share this exact shape (modulo the line-anchoring
 * fix above). */
function extractSection(text, startMarker) {
    const startIdx = indexOfMarkerLine(text, startMarker, 0);
    if (startIdx === -1) return '';
    const afterStart = startIdx + startMarker.length;
    const endIdx = nextMarkerIdx(text, afterStart, [startMarker]);
    return text.slice(afterStart, endIdx).trim();
}

function stripTrailingBareSeparator(text) {
    let stripped = text.replace(/\n+$/, '');
    const lines = stripped.split('\n');
    while (lines.length && lines[lines.length - 1].trim() === '---') lines.pop();
    return lines.join('\n').replace(/\n+$/, '');
}

/** `text` with the `startMarker` section removed, preserving whatever
 * actually follows it (any other section, regardless of canonical
 * order). Mirrors format_converter.py's strip_raid_log/strip_comms/etc
 * (modulo the line-anchoring fix above). */
function stripSection(text, startMarker) {
    const startIdx = indexOfMarkerLine(text, startMarker, 0);
    if (startIdx === -1) return text;
    const before = stripTrailingBareSeparator(text.slice(0, startIdx));
    const endIdx = nextMarkerIdx(text, startIdx, [startMarker]);
    if (endIdx < text.length) return before + '\n\n' + text.slice(endIdx);
    return before;
}

/** Collapse embedded newlines in untrusted free text before it ever
 * reaches a row -- the same discipline collab-ops.js's add_task/rename
 * apply to a task line, extended here to every RAID text field. */
function sanitizeText(value) {
    return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

/** Table-cell escaping matching format_converter.py's escape_pipe, plus
 * collapsing `\r` (a gap in the Python/script.js version -- see the
 * module docstring) since sanitizeText already guarantees no bare `\n`
 * reaches here. */
function escapeCell(value) {
    return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function unescapeCell(value) {
    return String(value == null ? '' : value).replace(/\\\|/g, '|');
}

const RAID_HEADERS = [
    'ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner',
    'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status',
    'Priority', 'Target Date',
];

const VALID_RAID_TYPES = new Set(['risk', 'action', 'issue', 'decision', 'dependency']);
const VALID_RAID_STATUSES = new Set(['open', 'closed', 'transferred']);
const VALID_ESCALATION_LEVELS = new Set(['project', 'programme', 'board']);

/** Split one markdown table row into cells on unescaped `|`, matching
 * format_converter.py's parse_row (regex-split on `|` not preceded by
 * `\`, then drop the leading/trailing empty cells the outer pipes leave
 * behind). */
function splitRow(line) {
    const parts = line.split(/(?<!\\)\|/);
    if (parts.length && parts[0].trim() === '') parts.shift();
    if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
    return parts.map((cell) => cell.trim());
}

/** Parse a RAID markdown table into row objects. JS port of
 * format_converter.py's parse_raid_markdown -- see that function's
 * docstring for the two table formats (simple and full) it accepts and
 * the title/description fallback mapping, faithfully mirrored here so a
 * plan hand-edited or produced by the non-collab editor parses
 * identically either way. */
export function parseRaidTable(text) {
    const lines = String(text == null ? '' : text)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (lower.includes('|') && ['id', 'title', 'type', 'description'].some((kw) => lower.includes(kw))) {
            headerIndex = i;
            break;
        }
    }
    if (headerIndex === -1) return [];

    const headers = splitRow(lines[headerIndex]).map((h) => h.toLowerCase());

    // Declaration order matters here exactly as it does in the Python
    // dict this mirrors: each header column takes the *first* alias that
    // matches it, so "target date" and "date" both resolving to
    // target_date only differ in which one wins when a table has both.
    const standardAliases = [
        ['id', 'id'], ['type', 'type'], ['raised by', 'raised_by'], ['owner', 'owner'],
        ['mitigation actions', 'mitigation_actions'], ['impact', 'impact'], ['likelihood', 'likelihood'],
        ['score', 'score'], ['status', 'status'], ['priority', 'priority'],
        ['target date', 'target_date'], ['date', 'target_date'],
        ['escalated', 'escalated'], ['escalation level', 'escalation_level'],
    ];
    const colMap = {};
    headers.forEach((header, idx) => {
        for (const [alias, field] of standardAliases) {
            if (header.includes(alias)) { colMap[field] = idx; break; }
        }
    });

    let hasTitleCol = false;
    let hasDescCol = false;
    headers.forEach((header, idx) => {
        if (header.includes('title') && !('title' in colMap)) { colMap.title = idx; hasTitleCol = true; }
        if (header.includes('description') && !('description' in colMap)) { colMap.description = idx; hasDescCol = true; }
    });
    if (!hasTitleCol && hasDescCol && !('title' in colMap)) colMap.title = colMap.description;

    const items = [];
    let maxIdSeen = 0;

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('|')) continue;
        if (line.replace(/[|\- ]/g, '') === '') continue;
        if (line.trimStart().startsWith('//')) continue;

        const cells = splitRow(line);
        if (!cells.length) continue;

        const getCell = (field, fallback = '') => {
            const idx = colMap[field];
            if (idx !== undefined && idx < cells.length) return unescapeCell(cells[idx]);
            return fallback;
        };

        const itemType = getCell('type', 'risk').toLowerCase();
        let itemStatus = getCell('status', 'open').toLowerCase();
        if (itemStatus.includes('transferred')) itemStatus = 'transferred';

        let impact;
        let likelihood;
        let score;
        const scoreStr = getCell('score', '');
        if (scoreStr && Number.isFinite(Number(scoreStr))) {
            score = Math.trunc(Number(scoreStr));
            impact = Math.max(1, Math.min(5, Math.trunc(Number(getCell('impact', '3')) || 3)));
            likelihood = Math.max(1, Math.min(5, Math.trunc(Number(getCell('likelihood', '3')) || 3)));
        } else {
            impact = Math.max(1, Math.min(5, Math.trunc(Number(getCell('impact', '3')) || 3)));
            likelihood = Math.max(1, Math.min(5, Math.trunc(Number(getCell('likelihood', '3')) || 3)));
            score = impact * likelihood;
        }

        const idStr = getCell('id', '');
        let itemId = Number.isFinite(Number(idStr)) && idStr !== '' ? Math.trunc(Number(idStr)) : maxIdSeen + 1;
        if (!Number.isFinite(itemId)) itemId = maxIdSeen + 1;
        maxIdSeen = Math.max(maxIdSeen, itemId);

        const escalated = ['yes', 'true', '1'].includes(getCell('escalated', '').trim().toLowerCase());
        let escalationLevel = getCell('escalation_level', '').trim().toLowerCase();
        if (!VALID_ESCALATION_LEVELS.has(escalationLevel)) escalationLevel = 'project';

        items.push({
            id: itemId,
            type: VALID_RAID_TYPES.has(itemType) ? itemType : 'risk',
            title: getCell('title', ''),
            description: getCell('description', ''),
            raised_by: getCell('raised_by', ''),
            owner: getCell('owner', ''),
            mitigation_actions: getCell('mitigation_actions', ''),
            impact,
            likelihood,
            score,
            status: VALID_RAID_STATUSES.has(itemStatus) ? itemStatus : 'open',
            priority: getCell('priority', ''),
            target_date: getCell('target_date', ''),
            escalated,
            escalation_level: escalationLevel,
        });
    }

    // De-dupe by (type, title, description), matching parse_raid_markdown
    // -- guards against the same row appearing twice in hand-edited text.
    const seen = new Set();
    const unique = [];
    for (const item of items) {
        const key = JSON.stringify([item.type, item.title, item.description]);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
    }
    return unique;
}

/** Render RAID rows back into a markdown table. JS port of
 * format_converter.py's generate_raid_log_text, including its rule that
 * the Escalated/Escalation Level columns only appear when at least one
 * row actually uses them -- so a plan with nothing escalated serialises
 * with the same column set it always has, unaffected by this feature. */
export function serializeRaidTable(items) {
    if (!items || items.length === 0) return '';

    const includeEscalation = items.some(
        (item) => item.escalated || (item.escalation_level && item.escalation_level !== 'project'),
    );
    const headers = includeEscalation ? RAID_HEADERS.concat(['Escalated', 'Escalation Level']) : RAID_HEADERS;

    const rows = items.map((item) => {
        const row = [
            escapeCell(item.id),
            escapeCell(item.type),
            escapeCell(item.title),
            escapeCell(item.description),
            escapeCell(item.raised_by),
            escapeCell(item.owner),
            escapeCell(item.mitigation_actions),
            escapeCell(item.impact),
            escapeCell(item.likelihood),
            escapeCell(item.score),
            escapeCell(item.status),
            escapeCell(item.priority),
            escapeCell(item.target_date),
        ];
        if (includeEscalation) {
            row.push(escapeCell(item.escalated ? 'yes' : 'no'));
            row.push(escapeCell(item.escalation_level || 'project'));
        }
        return row;
    });

    const widths = headers.map((h) => h.length);
    rows.forEach((row) => row.forEach((cell, i) => { widths[i] = Math.max(widths[i], cell.length); }));

    const pad = (str, width) => str + ' '.repeat(Math.max(0, width - str.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|';

    return [formatRow(headers), separator, ...rows.map(formatRow)].join('\n');
}

/** Splice a freshly-serialised RAID table into `planText`, preserving
 * every other section byte-for-byte and in whatever order it actually
 * appears (not just canonical order -- see the #978 note above). JS port
 * of format_converter.py's update_plan_raid_log. */
export function spliceRaidSection(planText, items) {
    const text = String(planText == null ? '' : planText);
    const commsText = extractSection(text, COMMS_START);
    const lessonsText = extractSection(text, LESSONS_START);
    const baselineText = extractSection(text, BASELINE_START);
    const whiteboardText = extractSection(text, WHITEBOARD_START);
    const parkingLotText = extractSection(text, PARKING_LOT_START);

    let base = stripSection(text, RAID_LOG_START);
    base = stripSection(base, COMMS_START);
    base = stripSection(base, LESSONS_START);
    base = stripSection(base, BASELINE_START);
    base = stripSection(base, WHITEBOARD_START);
    base = stripSection(base, PARKING_LOT_START);
    base = base.replace(/\n+$/, '');

    const table = serializeRaidTable(items);
    let result = base;
    if (table) result = result.replace(/\n+$/, '') + '\n\n' + RAID_LOG_START + '\n' + table;
    if (commsText) result = result.replace(/\n+$/, '') + '\n\n' + COMMS_START + '\n' + commsText;
    if (lessonsText) result = result.replace(/\n+$/, '') + '\n\n' + LESSONS_START + '\n' + lessonsText;
    if (baselineText) result = result.replace(/\n+$/, '') + '\n\n' + BASELINE_START + '\n' + baselineText;
    if (whiteboardText) result = result.replace(/\n+$/, '') + '\n\n' + WHITEBOARD_START + '\n' + whiteboardText;
    if (parkingLotText) result = result.replace(/\n+$/, '') + '\n\n' + PARKING_LOT_START + '\n' + parkingLotText;
    return result;
}

/** Build the snapshot the host broadcasts after every applied RAID op (or
 * any other change to the plan text -- see collab-session.js). Row shape
 * matches the item objects parseRaidTable/serializeRaidTable already use,
 * so the joiner UI, this module and format_converter.py all agree on
 * what a RAID row looks like. */
export function buildRaidSnapshot(planText, rev) {
    return {
        type: 'raid_snapshot',
        section: 'raid',
        rev,
        items: parseRaidTable(extractSection(String(planText == null ? '' : planText), RAID_LOG_START)),
    };
}

const VALID_BACKMATTER_OPS = new Set(['add_row', 'edit_row', 'delete_row']);
const VALID_ROW_FIELDS = new Set([
    'type', 'title', 'description', 'raised_by', 'owner', 'mitigation_actions',
    'impact', 'likelihood', 'score', 'status', 'priority', 'target_date',
    'escalated', 'escalation_level',
]);
const FREE_TEXT_FIELDS = new Set([
    'title', 'description', 'raised_by', 'owner', 'mitigation_actions', 'priority', 'target_date',
]);

/** True if `value` is structurally a well-formed back-matter edit intent
 * for a section this module supports. Shape only -- see collab-ops.js's
 * isPlanOp, which this mirrors. */
export function isBackmatterOp(value) {
    return Boolean(value)
        && typeof value === 'object'
        && value.type === 'backmatter_op'
        && value.section === 'raid'
        && VALID_BACKMATTER_OPS.has(value.op);
}

function reject(reason) {
    return { ok: false, reason };
}

/** Merge `fields` (untrusted, from the wire) into a row object, applying
 * the same validation the parser applies to a hand-typed table: free text
 * is newline-collapsed, enums fall back rather than admit a junk value,
 * numbers are clamped. Returns null (instead of a merged row) if a field
 * that must be one of a fixed set was given something else -- callers
 * turn that into an `invalid` rejection, the same way applyPlanOp rejects
 * a non-finite set_percent value. */
function mergeFields(row, fields) {
    const next = { ...row };
    for (const key of Object.keys(fields || {})) {
        if (!VALID_ROW_FIELDS.has(key)) continue;
        const value = fields[key];

        if (FREE_TEXT_FIELDS.has(key)) {
            next[key] = sanitizeText(value);
            continue;
        }
        if (key === 'type') {
            const type = String(value == null ? '' : value).toLowerCase();
            if (!VALID_RAID_TYPES.has(type)) return null;
            next.type = type;
            continue;
        }
        if (key === 'status') {
            const status = String(value == null ? '' : value).toLowerCase();
            if (!VALID_RAID_STATUSES.has(status)) return null;
            next.status = status;
            continue;
        }
        if (key === 'escalation_level') {
            const level = String(value == null ? '' : value).toLowerCase();
            if (!VALID_ESCALATION_LEVELS.has(level)) return null;
            next.escalation_level = level;
            continue;
        }
        if (key === 'escalated') {
            next.escalated = Boolean(value);
            continue;
        }
        if (key === 'impact' || key === 'likelihood') {
            const num = Number(value);
            if (!Number.isFinite(num)) return null;
            next[key] = Math.max(1, Math.min(5, Math.round(num)));
            continue;
        }
        if (key === 'score') {
            const num = Number(value);
            if (!Number.isFinite(num)) return null;
            next.score = Math.round(num);
        }
    }
    // A direct 'score' in `fields` is honoured as given (mirrors the
    // parser: a table with a Score column trusts it over recomputing).
    // Otherwise, editing impact or likelihood recomputes score the same
    // way a fresh row does, so the two never silently drift apart.
    if (!('score' in (fields || {})) && (('impact' in (fields || {})) || ('likelihood' in (fields || {})))) {
        next.score = next.impact * next.likelihood;
    }
    return next;
}

/**
 * Apply one joiner's RAID edit intent to the host's authoritative plan
 * text. Same contract as collab-ops.js's applyPlanOp: never throws on bad
 * input, returns `{ok: true, text, previous}` (`previous` being the full
 * row an edit/delete displaced, for the conflict notice and for
 * describeBackmatterConflict) or `{ok: false, reason}` for
 * `invalid` / `unknown_row`.
 */
export function applyBackmatterOp(planText, op) {
    if (!isBackmatterOp(op)) return reject('invalid');

    const text = String(planText == null ? '' : planText);
    const items = parseRaidTable(extractSection(text, RAID_LOG_START));

    if (op.op === 'add_row') {
        const merged = mergeFields(
            { type: 'risk', title: '', description: '', raised_by: '', owner: '', mitigation_actions: '',
              impact: 3, likelihood: 3, score: 9, status: 'open', priority: '', target_date: '',
              escalated: false, escalation_level: 'project' },
            op.fields,
        );
        if (!merged) return reject('invalid');
        const nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
        merged.id = nextId;
        const nextItems = items.concat([merged]);
        return { ok: true, text: spliceRaidSection(text, nextItems), previous: null };
    }

    const rowId = Number(op.row_id);
    const index = items.findIndex((item) => item.id === rowId);
    if (index === -1) return reject('unknown_row');

    if (op.op === 'delete_row') {
        const previous = items[index];
        const nextItems = items.slice(0, index).concat(items.slice(index + 1));
        return { ok: true, text: spliceRaidSection(text, nextItems), previous };
    }

    // edit_row
    const previous = items[index];
    const merged = mergeFields(previous, op.fields);
    if (!merged) return reject('invalid');
    merged.id = previous.id;
    const nextItems = items.slice();
    nextItems[index] = merged;
    return { ok: true, text: spliceRaidSection(text, nextItems), previous };
}

/**
 * The visible half of the RAID conflict rule -- the row counterpart of
 * collab-ops.js's describeConflict. Only `edit_row` displaces a value in
 * a way worth reporting (`add_row` can't conflict, and a `delete_row`
 * racing another op surfaces as that op's own `unknown_row` rejection).
 * Returns null when nothing the op actually changed was overwritten, so
 * re-applying the same values (two people agreeing) is not reported.
 */
export function describeBackmatterConflict(op, previous, byDisplayName) {
    if (op.op !== 'edit_row' || !previous) return null;
    const fields = op.fields || {};
    const changed = Object.keys(fields).some((key) => {
        if (!VALID_ROW_FIELDS.has(key)) return false;
        if (FREE_TEXT_FIELDS.has(key)) return sanitizeText(fields[key]) !== String(previous[key] || '');
        return String(fields[key]) !== String(previous[key]);
    });
    if (!changed) return null;
    const who = String(byDisplayName || 'Someone').trim() || 'Someone';
    const what = previous.title || previous.description || `row ${previous.id}`;
    return `${who} also edited "${what}" — some changes may have been overwritten.`;
}
