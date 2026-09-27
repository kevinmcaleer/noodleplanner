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

// back-matter-markers.js is a classic script, not a module: this import
// only runs it, publishing the canonical marker list on globalThis (where
// the host page's <script> tag has usually put it already).
import './back-matter-markers.js';

const RAID_LOG_START = '---raid log---';
const COMMS_START = '---comms---';
const LESSONS_START = '---lessons learned---';
const BASELINE_START = '---baseline---';
const WHITEBOARD_START = '---whiteboard---';
const PARKING_LOT_START = '---parking lot---';
const ESTIMATES_START = '---estimates---';

// Every back-matter section marker this module needs to avoid tripping
// over: the canonical list (back-matter-markers.js, which mirrors
// format_converter.py's ALL_SECTION_MARKERS). A section boundary is always
// "whichever other marker occurs next in the actual text", never just the
// ones that are supposed to come later in canonical order (see
// noodle-core's #978 fix) -- otherwise a section that's out of canonical
// position gets silently swallowed into its neighbour. This module's own
// copy of the list lacked ---estimates---, so estimate rows following the
// RAID log were parsed as RAID rows.
const ALL_SECTION_MARKERS = globalThis.NP_BACK_MATTER_MARKERS;

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

// ---------------------------------------------------------------------------
// #1036: the other two table sections
//
// #969 shipped RAID only and said so plainly -- benefits, comms and weekly
// updates were "left to a follow-up issue rather than claimed here", which
// #971's acceptance sweep turned into #1036. Benefits and comms are added
// here because they are structurally the *same thing* as RAID: a pipe table
// whose rows carry an `id` column, so they inherit RAID's stable-row-id
// property and need no `expect` staleness gate (see the row-identity note
// above).
//
// Weekly updates (`---highlights---`) are deliberately still not here. They
// are not a table at all -- `## <date> @<author>` headings followed by
// multi-line free text -- so they have no row id to address, and their
// content legitimately contains newlines, which means the newline-collapsing
// defence every field below relies on would destroy real content rather than
// protect it. Generalising breadth-first is what produced #1006; that section
// gets its own pass.
//
// Each schema below is the single place a section differs. Everything else
// -- parsing, serialising, splicing, op dispatch, conflict reporting -- is
// shared, so a fourth section is a schema plus its tests, not a fourth copy
// of the machinery.

const BENEFITS_START = '---benefits---';

/** Column aliases, in declaration order: each table header takes the first
 * alias that matches it, exactly as the RAID parser does. */
const SECTION_SCHEMAS = {
    raid: {
        marker: RAID_LOG_START,
        headers: RAID_HEADERS,
        // RAID keeps its bespoke parse/serialise pair: it carries the
        // conditional Escalated/Escalation Level columns (#736) and the
        // title/description fallback, neither of which generalises.
        bespoke: true,
    },

    benefits: {
        marker: BENEFITS_START,
        // Mirrors static/benefits.js's generateBenefitsMarkdown, which is
        // the canonical writer for this section, and
        // format_converter.py's parse_benefits_markdown on the read side.
        headers: [
            'ID', 'Type', 'Title', 'Description', 'Objective Type', 'Target Value',
            'Current Value', 'Target Date', 'Measurement', 'Linked To',
            'Contribution %', 'Status', 'Last Updated',
        ],
        fields: [
            'type', 'title', 'description', 'objective_type', 'target_value',
            'current_value', 'target_date', 'measurement_method', 'linked_to',
            'contribution_percent', 'status', 'last_updated',
        ],
        aliases: [
            ['objective type', 'objective_type'], ['target value', 'target_value'],
            ['current value', 'current_value'], ['target date', 'target_date'],
            ['measurement', 'measurement_method'], ['linked to', 'linked_to'],
            ['contribution', 'contribution_percent'], ['last updated', 'last_updated'],
            ['type', 'type'], ['title', 'title'], ['description', 'description'],
            ['status', 'status'],
        ],
        // Every benefits field is free text except the percentage. The
        // parser accepts any string for `type` and `status` (a benefits
        // taxonomy is a user's own vocabulary, unlike RAID's fixed five),
        // so validating them to an enum here would reject plans the
        // non-collab editor happily produces.
        numeric: { contribution_percent: { min: 0, max: 100 } },
        defaults: {
            type: '', title: '', description: '', objective_type: '', target_value: '',
            current_value: '', target_date: '', measurement_method: '', linked_to: '',
            contribution_percent: 0, status: '', last_updated: '',
        },
    },

    highlights: {
        marker: '---highlights---',
        // Not a table: entries, addressed positionally with an `expect`
        // gate. See applyHighlightsOp and the section note above.
        entries: true,
    },

    comms: {
        marker: COMMS_START,
        // Mirrors format_converter.py's generate_comms_plan_text.
        headers: ['ID', 'Activity', 'Audience', 'Content', 'Frequency', 'Channel', 'Owner', 'Status'],
        fields: ['activity', 'audience', 'content', 'frequency', 'channel', 'owner', 'status'],
        aliases: [
            ['activity', 'activity'], ['audience', 'audience'], ['content', 'content'],
            ['frequency', 'frequency'], ['channel', 'channel'], ['owner', 'owner'],
            ['status', 'status'],
        ],
        numeric: {},
        defaults: {
            activity: '', audience: '', content: '', frequency: '',
            channel: '', owner: '', status: '',
        },
    },
};

// ---------------------------------------------------------------------------
// #1036: weekly updates (---highlights---)
//
// The one section that is not a table. Entries are `## <date> @<author>`
// headings over multi-line free text, which changes two things fundamentally
// from every other section here:
//
//  - **No row id.** Entries are addressed by position, so an op must carry
//    `expect` (the "<date> @<author>" the sender last saw) exactly as #967's
//    task ops do -- otherwise a concurrent add or delete silently shifts
//    every later index and an op lands on the wrong entry.
//  - **Newlines are content.** Every other field in this module is
//    newline-collapsed, which is the whole defence against a joiner forging
//    a section marker. Doing that here would destroy the thing being edited.
//    Instead `sanitizeEntryContent` *neutralises* the two line shapes that
//    carry structural meaning -- a bare section marker, and a `## ` heading
//    -- by indenting them, so they survive as visible text but can never be
//    re-parsed as structure.

const HIGHLIGHTS_START = '---highlights---';
const HIGHLIGHTS_END = '---end-highlights---';
const HIGHLIGHT_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+@(\S+)\s*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse the highlights block into positional entries. JS port of
 * format_converter.py's `_parse_highlights_section`, so a block written by
 * the non-collab editor and one written here parse identically. */
export function parseHighlights(text) {
    const entries = [];
    let current = null;
    for (const line of String(text == null ? '' : text).split('\n')) {
        const stripped = line.trim();
        if (!stripped && current === null) continue;
        if (stripped === HIGHLIGHTS_END) break;

        const heading = HIGHLIGHT_HEADING.exec(stripped);
        if (heading) {
            if (current) { current.content = current.content.trim(); entries.push(current); }
            current = { date: heading[1], author: heading[2], content: '' };
            continue;
        }
        if (current) current.content += `${line.replace(/\s+$/, '')}\n`;
    }
    if (current) { current.content = current.content.trim(); entries.push(current); }
    return entries.map((entry, index) => ({ ...entry, id: index }));
}

/** Serialise entries back into a highlights block, mirroring
 * `generate_highlights_text`. */
export function serializeHighlights(entries) {
    if (!entries || entries.length === 0) return '';
    const lines = [];
    for (const entry of entries) {
        lines.push(`## ${entry.date} @${entry.author}`);
        lines.push(String(entry.content == null ? '' : entry.content).replace(/\s+$/, ''));
        lines.push('');
    }
    return lines.join('\n').replace(/\s+$/, '');
}

/** Normalise entry content, or return null if any line would be re-read as
 * structure rather than text.
 *
 * Indenting such a line is *not* a defence, which is worth stating plainly
 * because it looks like one: both `_parse_highlights_section` and this
 * module's `parseHighlights` call `.trim()` on a line before matching, and
 * `indexOfMarkerLine` matches a marker as a line's entire *trimmed*
 * content -- so ` ## 2026-01-01 @mallory` parses exactly like the
 * unindented version. (Found by this file's own injection tests, which
 * failed against a first cut that tried precisely that.)
 *
 * So the op is rejected instead. The alternative -- escaping or stripping
 * the offending line -- would silently alter what someone wrote, and for a
 * weekly update, quietly changing the words is a worse failure than
 * refusing the edit and saying so. */
function normaliseEntryContent(value) {
    const text = String(value == null ? '' : value).replace(/\r\n?/g, '\n');
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (ALL_SECTION_MARKERS.includes(trimmed) || trimmed === HIGHLIGHTS_END) return null;
        if (HIGHLIGHT_HEADING.test(trimmed)) return null;
    }
    return text.trim();
}

/** An author is a single `@`-prefixed token in the heading grammar, so
 * anything that would break that -- whitespace, a stray `@` -- is folded
 * rather than allowed to produce an entry the parser cannot read back. */
function sanitizeAuthor(value) {
    const cleaned = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').replace(/^@+/, '').trim();
    return cleaned.replace(/\s+/g, '-');
}

/** Splice a highlights block into `planText`.
 *
 * Highlights is the only section with a closing marker, and that needs
 * handling explicitly: `spliceSectionInPlace` ends a section at the *next*
 * marker line, which for this section is its own `---end-highlights---`.
 * So the old end marker sits outside the replaced range, in the tail, and
 * the freshly-serialised block brings another one -- leaving a duplicate
 * behind on every single op. (Found by live verification, not by the unit
 * tests, which asserted entry counts; `parseHighlights` stops at the first
 * end marker, so extra trailing ones are invisible to parsing while still
 * accumulating in the document.) Dropping any leading end marker off the
 * tail first is what keeps exactly one. */
function spliceHighlights(planText, entries) {
    const body = serializeHighlights(entries);
    const block = body ? `${body}\n${HIGHLIGHTS_END}` : '';
    const spliced = spliceSectionInPlace(planText, HIGHLIGHTS_START, block);
    const out = [];
    // When the last entry goes, `block` is empty and the section is removed
    // outright -- so there is nothing left for an end marker to close and
    // every one of them is orphaned. Otherwise keep exactly the one this
    // splice just wrote.
    let keptEnd = !block;
    for (const line of spliced.split('\n')) {
        if (line.trim() === HIGHLIGHTS_END) {
            if (keptEnd) continue;
            keptEnd = true;
        }
        out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Apply an op to the highlights section (#1036). */
function applyHighlightsOp(text, op) {
    const entries = parseHighlights(extractSection(text, HIGHLIGHTS_START));

    if (op.op === 'add_row') {
        const fields = op.fields || {};
        const date = String(fields.date == null ? '' : fields.date).trim();
        if (!ISO_DATE.test(date)) return reject('invalid');
        const author = sanitizeAuthor(fields.author);
        if (!author) return reject('invalid');
        const content = normaliseEntryContent(fields.content);
        if (content === null) return reject('invalid');
        const entry = { date, author, content };
        return { ok: true, text: spliceHighlights(text, entries.concat([entry])), previous: null };
    }

    const index = Number(op.row_id);
    const entry = entries[index];
    if (!entry) return reject('unknown_row');
    // Positional ids: `expect` is what stops an op landing on whoever moved
    // into this slot after a concurrent add or delete.
    if (typeof op.expect === 'string' && `${entry.date} @${entry.author}` !== op.expect) {
        return reject('stale');
    }

    if (op.op === 'delete_row') {
        const next = entries.slice(0, index).concat(entries.slice(index + 1));
        return { ok: true, text: spliceHighlights(text, next), previous: entry };
    }

    const fields = op.fields || {};
    const merged = { ...entry };
    if ('date' in fields) {
        const date = String(fields.date == null ? '' : fields.date).trim();
        if (!ISO_DATE.test(date)) return reject('invalid');
        merged.date = date;
    }
    if ('author' in fields) {
        const author = sanitizeAuthor(fields.author);
        if (!author) return reject('invalid');
        merged.author = author;
    }
    if ('content' in fields) {
        const content = normaliseEntryContent(fields.content);
        if (content === null) return reject('invalid');
        merged.content = content;
    }

    const next = entries.slice();
    next[index] = merged;
    return { ok: true, text: spliceHighlights(text, next), previous: entry };
}

/** Parse a generic id-keyed pipe table into row objects, using `schema`'s
 * aliases to map however the table's headers happen to be worded onto the
 * canonical field names. Rows without a usable id are skipped rather than
 * renumbered: an id is a joiner's only handle on a row, so inventing one
 * would let a later op address a row the sender never saw. */
function parseTable(text, schema) {
    const lines = String(text == null ? '' : text)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (lower.includes('|') && schema.aliases.some(([alias]) => lower.includes(alias))) {
            headerIndex = i;
            break;
        }
    }
    if (headerIndex === -1) return [];

    const headers = splitRow(lines[headerIndex]).map((h) => h.toLowerCase());
    const colMap = {};
    headers.forEach((header, idx) => {
        if (header.includes('id') && !('id' in colMap) && header.length <= 4) colMap.id = idx;
        for (const [alias, field] of schema.aliases) {
            if (header.includes(alias) && !(field in colMap)) { colMap[field] = idx; break; }
        }
    });

    const items = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('|')) continue;
        if (/^\|?[\s|:-]+\|?$/.test(line)) continue; // separator row
        const cells = splitRow(line);
        if (cells.length === 0) continue;

        const cell = (field) => {
            const idx = colMap[field];
            return idx === undefined || idx >= cells.length ? '' : unescapeCell(cells[idx]);
        };

        const rawId = cell('id');
        const id = Number.parseInt(rawId, 10);
        if (!Number.isFinite(id)) continue;

        const row = { id };
        for (const field of schema.fields) row[field] = cell(field);
        for (const field of Object.keys(schema.numeric)) {
            const num = Number(row[field]);
            row[field] = Number.isFinite(num) ? num : schema.defaults[field];
        }
        items.push(row);
    }
    return items;
}

/** Serialise rows back into a padded markdown table, escaping every cell
 * the same way RAID's serialiser does. */
function serializeTable(items, schema) {
    if (!items || items.length === 0) return '';
    const rows = items.map((item) => [escapeCell(item.id)].concat(
        schema.fields.map((field) => escapeCell(item[field])),
    ));
    const widths = schema.headers.map((h) => h.length);
    rows.forEach((row) => row.forEach((c, i) => { widths[i] = Math.max(widths[i], c.length); }));

    const pad = (str, width) => str + ' '.repeat(Math.max(0, width - str.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|';
    return [formatRow(schema.headers), separator, ...rows.map(formatRow)].join('\n');
}

/** Replace one section's table in `planText`, leaving every other section
 * byte-for-byte where it already is. Unlike spliceRaidSection (which
 * rebuilds the tail in canonical order, as format_converter.py does), this
 * edits in place -- the section being replaced is the only thing that
 * moves, so a plan whose sections are in an unusual order keeps it. */
function spliceSectionInPlace(planText, marker, body) {
    const text = String(planText == null ? '' : planText);
    const start = indexOfMarkerLine(text, marker, 0);

    if (start === -1) {
        if (!body) return text;
        return text.replace(/\n+$/, '') + '\n\n' + marker + '\n' + body;
    }

    const afterMarker = start + marker.length;
    let end = text.length;
    for (const other of ALL_SECTION_MARKERS) {
        const idx = indexOfMarkerLine(text, other, afterMarker);
        if (idx !== -1 && idx < end) end = idx;
    }

    const head = text.slice(0, start).replace(/\n+$/, '');
    const tail = text.slice(end).replace(/^\n+/, '');
    const rebuilt = body ? `${head}\n\n${marker}\n${body}` : head;
    return tail ? `${rebuilt.replace(/\n+$/, '')}\n\n${tail}` : rebuilt;
}

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
    // Estimates (#1053) is canonically last. Left out here, it would stay
    // in `base` and the RAID log and everything after it would be
    // re-appended below it. (format_converter.py's update_plan_raid_log has
    // the same gap.)
    const estimatesText = extractSection(text, ESTIMATES_START);

    let base = stripSection(text, RAID_LOG_START);
    base = stripSection(base, COMMS_START);
    base = stripSection(base, LESSONS_START);
    base = stripSection(base, BASELINE_START);
    base = stripSection(base, WHITEBOARD_START);
    base = stripSection(base, PARKING_LOT_START);
    base = stripSection(base, ESTIMATES_START);
    base = base.replace(/\n+$/, '');

    const table = serializeRaidTable(items);
    let result = base;
    if (table) result = result.replace(/\n+$/, '') + '\n\n' + RAID_LOG_START + '\n' + table;
    if (commsText) result = result.replace(/\n+$/, '') + '\n\n' + COMMS_START + '\n' + commsText;
    if (lessonsText) result = result.replace(/\n+$/, '') + '\n\n' + LESSONS_START + '\n' + lessonsText;
    if (baselineText) result = result.replace(/\n+$/, '') + '\n\n' + BASELINE_START + '\n' + baselineText;
    if (whiteboardText) result = result.replace(/\n+$/, '') + '\n\n' + WHITEBOARD_START + '\n' + whiteboardText;
    if (parkingLotText) result = result.replace(/\n+$/, '') + '\n\n' + PARKING_LOT_START + '\n' + parkingLotText;
    if (estimatesText) result = result.replace(/\n+$/, '') + '\n\n' + ESTIMATES_START + '\n' + estimatesText;
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

/** Snapshot for any editable back-matter section (#1036). RAID keeps
 * `buildRaidSnapshot` and its `raid_snapshot` frame type for compatibility
 * with the joiner already shipped in #969; the generic sections use one
 * `backmatter_snapshot` type carrying the section name, so adding a
 * section needs no new frame type. */
export function buildSectionSnapshot(planText, rev, section) {
    const schema = SECTION_SCHEMAS[section];
    if (!schema) return null;
    if (schema.bespoke) return buildRaidSnapshot(planText, rev);
    if (schema.entries) {
        return {
            type: 'backmatter_snapshot',
            section,
            rev,
            items: parseHighlights(
                extractSection(String(planText == null ? '' : planText), schema.marker),
            ),
        };
    }
    return {
        type: 'backmatter_snapshot',
        section,
        rev,
        items: parseTable(
            extractSection(String(planText == null ? '' : planText), schema.marker), schema,
        ),
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
        && typeof value.section === 'string'
        && Object.prototype.hasOwnProperty.call(SECTION_SCHEMAS, value.section)
        && VALID_BACKMATTER_OPS.has(value.op);
}

/** The sections a joiner may edit live. Exported so the joiner UI and its
 * tests agree with this module about what exists, rather than each keeping
 * its own list that can drift. */
export const EDITABLE_SECTIONS = Object.keys(SECTION_SCHEMAS);

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
/** Merge untrusted `fields` into a generic table row (#1036).
 *
 * Free text is newline-collapsed and pipe-escaped on serialise, exactly as
 * RAID's does -- these sections carry the same injection risk, since a
 * joiner-supplied cell is spliced into a pipe- and line-delimited table.
 * Numeric fields are clamped rather than rejected so a slider that
 * overshoots does not bounce the whole op. */
function mergeSectionFields(row, fields, schema) {
    const next = { ...row };
    for (const key of Object.keys(fields || {})) {
        if (!schema.fields.includes(key)) continue;
        if (key in schema.numeric) {
            const num = Number(fields[key]);
            if (!Number.isFinite(num)) return null;
            const { min, max } = schema.numeric[key];
            next[key] = Math.max(min, Math.min(max, Math.round(num)));
            continue;
        }
        next[key] = sanitizeText(fields[key]);
    }
    return next;
}

/** Apply an op to one of the generic id-keyed table sections (#1036). */
function applySectionOp(text, op, schema) {
    const body = extractSection(text, schema.marker);
    const items = parseTable(body, schema);

    if (op.op === 'add_row') {
        const merged = mergeSectionFields({ ...schema.defaults }, op.fields, schema);
        if (!merged) return reject('invalid');
        merged.id = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
        return {
            ok: true,
            text: spliceSectionInPlace(text, schema.marker, serializeTable(items.concat([merged]), schema)),
            previous: null,
        };
    }

    const rowId = Number(op.row_id);
    const index = items.findIndex((item) => item.id === rowId);
    if (index === -1) return reject('unknown_row');

    if (op.op === 'delete_row') {
        const previous = items[index];
        const nextItems = items.slice(0, index).concat(items.slice(index + 1));
        return {
            ok: true,
            text: spliceSectionInPlace(text, schema.marker, serializeTable(nextItems, schema)),
            previous,
        };
    }

    const previous = items[index];
    const merged = mergeSectionFields(previous, op.fields, schema);
    if (!merged) return reject('invalid');
    merged.id = previous.id;
    const nextItems = items.slice();
    nextItems[index] = merged;
    return {
        ok: true,
        text: spliceSectionInPlace(text, schema.marker, serializeTable(nextItems, schema)),
        previous,
    };
}

export function applyBackmatterOp(planText, op) {
    if (!isBackmatterOp(op)) return reject('invalid');

    const text = String(planText == null ? '' : planText);
    const schema = SECTION_SCHEMAS[op.section];
    if (schema.entries) return applyHighlightsOp(text, op);
    if (!schema.bespoke) return applySectionOp(text, op, schema);

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
