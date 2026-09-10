/**
 * Whiteboard -> plan structure helpers.
 *
 * The whiteboard used to be a read-only projection: a note *was* an
 * existing summary task, and nothing you did on the board could create or
 * re-shape the plan's outline. These helpers are the inverse direction --
 * authoring the outline *from* the board:
 *
 *   - dropping a new post-it appends a brand-new top-level task
 *     (wbAppendTopLevelTask()),
 *   - dragging a noodle from note A to note B re-parents B's whole
 *     subtree underneath A (wbReparentTaskInPlanText()), and
 *   - "promoting" a free-form note (issue #1020) appends one brand-new
 *     child task under it (wbAppendChildTask()).
 *
 * Storage decision: a noodle has *no storage of its own*. A noodle from A
 * to B means exactly "B is indented under A in the plan outline", so the
 * set of noodles is derived from the task hierarchy the engine already
 * parses (see wbNoodleLinksFor() in whiteboard-noodles.js). Adding a
 * `Links` column to the ---whiteboard--- table would have created a second
 * source of truth for the same relationship, which could then disagree
 * with the outline -- the exact class of bug the repo's "never re-parse
 * plan text in a view" rule exists to prevent. It also keeps a plan a
 * single self-contained markdown file that still reads correctly in a
 * plain text editor, per epic #885's explicit constraint.
 *
 * Everything in this file is pure: it takes plan text in and returns plan
 * text out, touching no DOM and no module state, so it is unit-tested
 * directly by tests/test_whiteboard_structure.js. The DOM/commit side
 * lives in whiteboard-notes.js (wbCommitMarkdown()) and
 * whiteboard-noodles.js.
 *
 * Editing rule: every function here rewrites *only* the task-outline
 * region of the plan (see wbOutlineRegion()) and splices lines rather
 * than regenerating the file. Front matter, every back-matter section
 * (---highlights---, ---raid log---, ---whiteboard---, ...) and every
 * task line it isn't explicitly moving come back byte-for-byte identical.
 * This deliberately does *not* follow mindmap.js's mindmapSyncToEditor(),
 * which rebuilds the whole outline from its own tree and in doing so
 * drops any metadata its tree doesn't model ([depends ...], dates,
 * labels, buckets, priorities). A whiteboard edit must never silently
 * strip a field the user set in the Gantt or the task form.
 */

// ── Configuration ───────────────────────────────────────────────────────

/** Spaces per outline level, matching the rest of the app's plan text. */
const WB_INDENT_UNIT = '  ';

/**
 * Markers that end the task-outline region. Same list (and same purpose)
 * as script.js's getAllTaskNames() section tracking -- anything at or
 * after the first of these is back matter, never a task line.
 */
const WB_BACK_MATTER_MARKERS = [
    '---highlights---',
    '---end-highlights---',
    '---budget---',
    '---benefits---',
    '---raid log---',
    '---comms---',
    '---lessons learned---',
    '---baseline---',
    '---whiteboard---',
];

/** Fallback name for a brand-new post-it, before the user types one. */
const WB_NEW_NOTE_BASE_NAME = 'New idea';

// ── Line-level helpers ──────────────────────────────────────────────────

/**
 * The task name on a plan line, or '' if the line carries none (blank,
 * comment, separator, front-matter fence).
 *
 * Delegates to the shared TaskLineTokenizer grammar (task-tokenizer.js,
 * loaded before this file -- see index.html's <script> order) so a name is
 * stripped of @resources, durations, percents, [depends ...], "comments",
 * #labels and the rest by the exact same rules script.js's parseTaskLine()
 * uses. The fallback below is a deliberately blunt approximation used only
 * if the tokenizer isn't loaded; tests load the real tokenizer alongside
 * this file rather than relying on it.
 */
function wbTaskNameFromLine(line) {
    if (typeof line !== 'string') return '';
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed === '---') return '';
    if (trimmed.startsWith('#')) return '';
    if (trimmed.includes('===')) return '';
    if (trimmed.startsWith('|')) return '';

    if (typeof TaskLineTokenizer !== 'undefined' && TaskLineTokenizer &&
        typeof TaskLineTokenizer.metadata === 'function') {
        return TaskLineTokenizer.metadata(line).values.name || '';
    }

    return trimmed
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/"[^"]*"/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/[@#]\w+/g, ' ')
        .replace(/\b\d+[dwmy]\b/g, ' ')
        .replace(/\b\d+%/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Indentation width of a line, in characters. 0 for a blank line. */
function wbLineIndent(line) {
    if (typeof line !== 'string') return 0;
    const idx = line.search(/\S/);
    return idx === -1 ? 0 : idx;
}

/** Re-indent a line to exactly `indent` spaces, keeping its content. */
function wbSetLineIndent(line, indent) {
    if (typeof line !== 'string' || !line.trim()) return line;
    return ' '.repeat(Math.max(0, indent)) + line.trimStart();
}

// ── Outline region + parsing ────────────────────────────────────────────

/**
 * The half-open [start, end) line range of the task outline: everything
 * after the front matter's closing `---` and before the first back-matter
 * marker. A plan with neither still returns the whole file, which is
 * correct -- a bare list of tasks is a valid plan.
 */
function wbOutlineRegion(lines) {
    const all = lines || [];
    let start = 0;

    // Front matter only counts when the very first non-blank line opens it.
    let firstContent = 0;
    while (firstContent < all.length && !String(all[firstContent]).trim()) firstContent++;
    if (firstContent < all.length && String(all[firstContent]).trim() === '---') {
        for (let i = firstContent + 1; i < all.length; i++) {
            if (String(all[i]).trim() === '---') { start = i + 1; break; }
        }
    }

    let end = all.length;
    for (let i = start; i < all.length; i++) {
        if (WB_BACK_MATTER_MARKERS.includes(String(all[i]).trim())) { end = i; break; }
    }
    return { start, end: Math.max(start, end) };
}

/**
 * Parse the outline into `{ index, indent, name }` entries, one per task
 * line, in document order. `index` is the absolute line index in `lines`,
 * so callers can splice against it directly.
 */
function wbParseOutline(planText) {
    const lines = String(planText == null ? '' : planText).split('\n');
    const { start, end } = wbOutlineRegion(lines);
    const entries = [];
    for (let i = start; i < end; i++) {
        const name = wbTaskNameFromLine(lines[i]);
        if (!name) continue;
        entries.push({ index: i, indent: wbLineIndent(lines[i]), name });
    }
    return { lines, start, end, entries };
}

/**
 * Find one outline entry by task name, case-insensitively (the same
 * matching rule whiteboard rows use -- see plan-format.rst). Returns the
 * entry's position within `entries` (not its line index), or -1.
 */
function wbFindOutlineIndex(entries, name) {
    if (!name) return -1;
    const key = String(name).toLowerCase();
    return (entries || []).findIndex(e => e && String(e.name).toLowerCase() === key);
}

/**
 * The last line index belonging to the entry at `entryPos` -- itself plus
 * every more-deeply-indented line that follows, i.e. its whole subtree.
 * Blank lines inside the subtree are included; trailing blank lines after
 * it are not, so a move never drags a paragraph break around with it.
 */
function wbSubtreeEndIndex(parsed, entryPos) {
    const { lines, end, entries } = parsed;
    const entry = entries[entryPos];
    if (!entry) return -1;

    let last = entry.index;
    for (let i = entry.index + 1; i < end; i++) {
        const line = lines[i];
        if (!String(line).trim()) continue;            // blank: undecided, keep looking
        if (wbLineIndent(line) <= entry.indent) break;  // sibling or shallower: subtree over
        last = i;
    }
    return last;
}

/** Every task name in the plan outline, in document order. */
function wbOutlineTaskNames(planText) {
    return wbParseOutline(planText).entries.map(e => e.name);
}

/**
 * A name not already used by any task, derived from `base`: 'New idea',
 * then 'New idea 2', 'New idea 3', ... Names collide case-insensitively
 * because that is how whiteboard rows and dependencies match them.
 */
function wbUniqueTaskName(existingNames, base) {
    const wanted = String(base || WB_NEW_NOTE_BASE_NAME).trim() || WB_NEW_NOTE_BASE_NAME;
    const taken = new Set((existingNames || []).map(n => String(n).toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let n = 2; n < 10000; n++) {
        const candidate = `${wanted} ${n}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${wanted} ${Date.now()}`;
}

// ── Hierarchy queries (over the engine's flat task list) ────────────────

/**
 * Direct children of `parentName` in a flat `result.tasks` array. Keyed on
 * the engine's own `.parent` field, exactly like whiteboard-notes.js's
 * wbDirectChildren() -- kept as a separate copy here only so this file
 * stays loadable on its own in tests; the two must agree by construction
 * because they read the identical field.
 */
function wbStructureChildren(tasks, parentName) {
    if (!tasks || !parentName) return [];
    return tasks.filter(t => t && t.parent === parentName);
}

/**
 * Every descendant name of `rootName`, as a lower-cased Set. Depth-capped
 * defensively so a malformed cyclic `.parent` chain can never hang the UI.
 */
function wbDescendantNames(tasks, rootName) {
    const found = new Set();
    if (!tasks || !rootName) return found;
    let frontier = [rootName];
    for (let depth = 0; depth < 64 && frontier.length; depth++) {
        const next = [];
        frontier.forEach(name => {
            wbStructureChildren(tasks, name).forEach(child => {
                const key = String(child.name).toLowerCase();
                if (found.has(key)) return;
                found.add(key);
                next.push(child.name);
            });
        });
        frontier = next;
    }
    return found;
}

/**
 * Whether a noodle from `parentName` to `childName` is legal, and if not,
 * why -- the message is shown to the user, so it explains the rule in
 * board language ("note"), not outline language.
 *
 * Illegal cases, in the order a user is most likely to hit them:
 *   - linking a note to itself;
 *   - linking a note to one of its own descendants, which would detach
 *     that whole branch from the plan into a cycle;
 *   - a link that already exists (a no-op, reported rather than silently
 *     committing an identical plan).
 *
 * @returns {{ok: boolean, reason: string}}
 */
function wbCanLinkNotes(tasks, parentName, childName) {
    if (!parentName || !childName) return { ok: false, reason: 'Pick two notes to link.' };
    if (String(parentName).toLowerCase() === String(childName).toLowerCase()) {
        return { ok: false, reason: 'A note cannot be linked to itself.' };
    }
    const child = (tasks || []).find(t => t && String(t.name).toLowerCase() === String(childName).toLowerCase());
    if (child && child.parent === parentName) {
        return { ok: false, reason: `"${childName}" is already under "${parentName}".` };
    }
    if (wbDescendantNames(tasks, childName).has(String(parentName).toLowerCase())) {
        return { ok: false, reason: `"${parentName}" already sits under "${childName}" — that would make a loop.` };
    }
    return { ok: true, reason: '' };
}

// ── Plan-text edits ─────────────────────────────────────────────────────

/**
 * Append `name` as a new top-level task at the end of the outline.
 *
 * Placed at the end of the outline region (not the end of the file) so a
 * plan with back matter still gets a valid task line, and separated from
 * whatever precedes it only if that line isn't already blank -- the goal
 * is a diff of exactly one added line wherever possible.
 *
 * Returns the plan text unchanged if `name` is empty.
 */
function wbAppendTopLevelTask(planText, name) {
    const clean = String(name || '').trim();
    if (!clean) return planText;

    const text = String(planText == null ? '' : planText);
    const lines = text.split('\n');
    const { start, end } = wbOutlineRegion(lines);

    // Insert after the last non-blank outline line, so a new task never
    // lands in the blank gap that separates the outline from back matter.
    let insertAt = start;
    let foundContent = false;
    for (let i = end - 1; i >= start; i--) {
        if (String(lines[i]).trim()) { insertAt = i + 1; foundContent = true; break; }
    }

    lines.splice(insertAt, 0, clean);

    // An outline that was entirely blank (a brand-new, empty plan) would
    // otherwise gain a stray trailing blank line per task added; consume
    // one of the blanks the new line displaced instead.
    if (!foundContent && end > start && !String(lines[insertAt + 1] || '').trim()) {
        lines.splice(insertAt + 1, 1);
    }

    return lines.join('\n');
}

/**
 * Append `name` as a brand-new task, last child of `parentName`, in the
 * outline -- the write behind issue #1020's "promote to task": turning a
 * free-form note's own loose comment text into a real child task is
 * exactly what flips wbIsFreeformNote() (whiteboard-notes.js) to false and
 * makes the note render as a checklist on the very next render pass, per
 * #1015's already-landed free-form/checklist split -- so this only ever
 * needs to add the one line, not build a second rendering path.
 *
 * Insertion point and target indent mirror wbReparentTaskInPlanText()'s
 * own "last child" placement below (wbSubtreeEndIndex() + one
 * WB_INDENT_UNIT deeper than the parent), so a promoted note's new child
 * lands exactly where dragging a noodle onto it would have put an
 * existing task.
 *
 * Returns `planText` unchanged if `name` is empty or `parentName` can't be
 * found in the outline -- the caller (wbPromoteFreeformNote(),
 * whiteboard-notes.js) treats either as a no-op, not an error.
 */
function wbAppendChildTask(planText, parentName, name) {
    const clean = String(name || '').trim();
    const text = String(planText == null ? '' : planText);
    if (!clean) return text;

    const parsed = wbParseOutline(text);
    const parentPos = wbFindOutlineIndex(parsed.entries, parentName);
    if (parentPos === -1) return text;

    const insertAt = wbSubtreeEndIndex(parsed, parentPos) + 1;
    const targetIndent = parsed.entries[parentPos].indent + WB_INDENT_UNIT.length;

    const lines = parsed.lines.slice();
    lines.splice(insertAt, 0, wbSetLineIndent(clean, targetIndent));
    return lines.join('\n');
}

/**
 * Move `childName` (and its whole subtree) to sit under `parentName` as
 * that parent's last child -- or, when `parentName` is null/'', back out
 * to the end of the outline as a top-level task. This is the single write
 * behind both drawing and deleting a noodle.
 *
 * The subtree keeps its internal shape: every moved line is shifted by the
 * same delta, so a three-deep branch stays three deep relative to its new
 * parent. Nothing else in the file is touched.
 *
 * No-ops (returning the input unchanged, so wbCommitMarkdown() skips the
 * write and no undo step is created) when the child or parent can't be
 * found, when the move would be a cycle, or when the child already sits
 * where it is being asked to go.
 */
function wbReparentTaskInPlanText(planText, childName, parentName) {
    const text = String(planText == null ? '' : planText);
    if (!childName) return text;

    const parsed = wbParseOutline(text);
    const { entries } = parsed;
    const childPos = wbFindOutlineIndex(entries, childName);
    if (childPos === -1) return text;

    const wantsTopLevel = !parentName;
    const parentPos = wantsTopLevel ? -1 : wbFindOutlineIndex(entries, parentName);
    if (!wantsTopLevel && parentPos === -1) return text;
    if (parentPos === childPos) return text;

    const childEntry = entries[childPos];
    const childEnd = wbSubtreeEndIndex(parsed, childPos);

    // Refuse to bury a parent inside its own subtree -- that would delete
    // both from the outline's point of view (the moved block would contain
    // its own destination).
    if (!wantsTopLevel) {
        const parentEntry = entries[parentPos];
        if (parentEntry.index >= childEntry.index && parentEntry.index <= childEnd) return text;
    }

    const lines = parsed.lines.slice();
    const block = lines.slice(childEntry.index, childEnd + 1);
    const targetIndent = wantsTopLevel
        ? 0
        : entries[parentPos].indent + WB_INDENT_UNIT.length;

    // Already in the right place? Same indent *and* the immediately
    // preceding task line is the intended parent (or, for a top-level
    // move, it is already top-level).
    if (childEntry.indent === targetIndent) {
        if (wantsTopLevel) return text;
        const prevTask = entries.slice(0, childPos).reverse()
            .find(e => e.indent < childEntry.indent);
        if (prevTask && prevTask.name === entries[parentPos].name) return text;
    }

    lines.splice(childEntry.index, block.length);

    // Re-parse after the removal: line indices below the cut have shifted,
    // and the parent's own subtree extent may have changed if the child
    // came out of it.
    const afterCut = wbParseOutline(lines.join('\n'));
    let insertAt;
    if (wantsTopLevel) {
        insertAt = afterCut.start;
        for (let i = afterCut.end - 1; i >= afterCut.start; i--) {
            if (String(afterCut.lines[i]).trim()) { insertAt = i + 1; break; }
        }
    } else {
        const newParentPos = wbFindOutlineIndex(afterCut.entries, parentName);
        if (newParentPos === -1) return text; // parent vanished with the cut -- bail, unchanged
        insertAt = wbSubtreeEndIndex(afterCut, newParentPos) + 1;
    }

    const indentDelta = targetIndent - childEntry.indent;
    const reindented = indentDelta === 0
        ? block
        : block.map(line => (String(line).trim()
            ? wbSetLineIndent(line, Math.max(0, wbLineIndent(line) + indentDelta))
            : line));

    // Drop blank lines from the tail of the moved block so re-parenting
    // doesn't accumulate empty lines in the middle of the outline.
    while (reindented.length > 1 && !String(reindented[reindented.length - 1]).trim()) {
        reindented.pop();
    }

    const out = afterCut.lines.slice();
    out.splice(insertAt, 0, ...reindented);
    return out.join('\n');
}

/**
 * Move `taskName` (and its whole subtree) to sit immediately before or
 * after `referenceName`, at the reference's own outline depth -- i.e. as
 * its new previous/next sibling, under the reference's own parent (or
 * top-level, if the reference is top-level).
 *
 * This is the write behind reordering a row in the floating structure
 * panel (see wbOutlineRowDropped() in whiteboard-outline.js). Unlike
 * wbReparentTaskInPlanText(), which always lands a task as its new
 * parent's *last* child, this places it at an exact position relative to
 * a sibling -- and, because the target depth always matches whatever
 * depth the reference sits at, dragging a nested task next to a
 * top-level one un-nests it for free, with no separate "outdent" gesture
 * needed. Reparenting under an unrelated task (the "drag under and to
 * the right" gesture) is a different write -- wbReparentTaskInPlanText()
 * -- since that changes depth relative to a *new parent*, not a sibling.
 *
 * No-ops, returning `planText` unchanged, when: the task or reference
 * can't be found, they are the same task, the move would bury the
 * reference inside the subtree being moved (a cycle), or the move would
 * produce byte-for-byte identical text (already exactly there).
 */
function wbMoveTaskInPlanText(planText, taskName, referenceName, before) {
    const text = String(planText == null ? '' : planText);
    if (!taskName || !referenceName) return text;
    if (String(taskName).toLowerCase() === String(referenceName).toLowerCase()) return text;

    const parsed = wbParseOutline(text);
    const { entries } = parsed;
    const taskPos = wbFindOutlineIndex(entries, taskName);
    const refPos = wbFindOutlineIndex(entries, referenceName);
    if (taskPos === -1 || refPos === -1) return text;

    const taskEntry = entries[taskPos];
    const taskEnd = wbSubtreeEndIndex(parsed, taskPos);
    const refEntry = entries[refPos];

    // Refuse to move a task next to one of its own descendants -- the
    // reference (and the insertion point it defines) would be inside the
    // very subtree being cut.
    if (refEntry.index >= taskEntry.index && refEntry.index <= taskEnd) return text;

    const lines = parsed.lines.slice();
    const block = lines.slice(taskEntry.index, taskEnd + 1);
    lines.splice(taskEntry.index, block.length);

    // Re-parse after the cut: line indices below it have shifted.
    const afterCut = wbParseOutline(lines.join('\n'));
    const newRefPos = wbFindOutlineIndex(afterCut.entries, referenceName);
    if (newRefPos === -1) return text; // reference vanished with the cut -- bail, unchanged
    const newRefEntry = afterCut.entries[newRefPos];

    const insertAt = before
        ? newRefEntry.index
        : wbSubtreeEndIndex(afterCut, newRefPos) + 1;

    const indentDelta = newRefEntry.indent - taskEntry.indent;
    const reindented = indentDelta === 0
        ? block
        : block.map(line => (String(line).trim()
            ? wbSetLineIndent(line, Math.max(0, wbLineIndent(line) + indentDelta))
            : line));

    while (reindented.length > 1 && !String(reindented[reindented.length - 1]).trim()) {
        reindented.pop();
    }

    const out = afterCut.lines.slice();
    out.splice(insertAt, 0, ...reindented);
    const result = out.join('\n');

    // Dropping a task right back where it already was is a no-op -- avoid
    // manufacturing a spurious undo step out of a drag that changed nothing.
    return result === text ? text : result;
}

/**
 * Rename a task in the outline (the line itself), leaving every other
 * token on that line untouched -- only the name run is replaced.
 *
 * Dependency references and whiteboard rows are *not* updated here: the
 * caller (wbRenameNoteTask() in whiteboard-notes.js) chains this with
 * script.js's existing updateDependencyReferences() and
 * renamePlanWhiteboardTask() so there is one implementation of each rule
 * rather than a second copy living in the whiteboard.
 */
function wbRenameTaskInPlanText(planText, oldName, newName) {
    const text = String(planText == null ? '' : planText);
    const clean = String(newName || '').trim();
    if (!oldName || !clean || oldName === clean) return text;

    const parsed = wbParseOutline(text);
    const pos = wbFindOutlineIndex(parsed.entries, oldName);
    if (pos === -1) return text;

    const idx = parsed.entries[pos].index;
    const line = parsed.lines[idx];

    // Replace only the first occurrence of the old name as it appears in
    // the line, so `Design @adam 5d` -> `Wireframes @adam 5d` and the
    // metadata survives. Falls back to rebuilding indent + name when the
    // name isn't found verbatim (e.g. it was split by an inline token).
    const at = line.indexOf(oldName);
    parsed.lines[idx] = at === -1
        ? wbSetLineIndent(clean, parsed.entries[pos].indent)
        : line.slice(0, at) + clean + line.slice(at + oldName.length);

    return parsed.lines.join('\n');
}

/**
 * Delete a task and its whole subtree from the outline. Used by the
 * board's "Delete task" action, which is deliberately distinct from
 * "Remove from board" (that one only drops the ---whiteboard--- row --
 * see wbRemoveNoteFromBoard()).
 */
function wbDeleteTaskFromPlanText(planText, taskName) {
    const text = String(planText == null ? '' : planText);
    if (!taskName) return text;

    const parsed = wbParseOutline(text);
    const pos = wbFindOutlineIndex(parsed.entries, taskName);
    if (pos === -1) return text;

    const start = parsed.entries[pos].index;
    const end = wbSubtreeEndIndex(parsed, pos);
    const lines = parsed.lines.slice();
    lines.splice(start, end - start + 1);
    return lines.join('\n');
}

// ── Outline tree (for the floating structure panel) ─────────────────────

/**
 * Build the nested tree the outline panel renders, from the engine's flat
 * `result.tasks`. Each node is `{ name, task, depth, children, onBoard }`.
 *
 * Roots are tasks with no `.parent`. Reads only `.parent`/`.name`, the
 * same relation the notes and the noodles derive from, so the panel can
 * never show a hierarchy that disagrees with the noodles drawn next to it.
 *
 * `boardNames` is the set of task names that currently have a note (any
 * iterable of names, matched case-insensitively) -- it drives the panel's
 * "on the board" dot and nothing else.
 */
function wbBuildOutlineTree(tasks, boardNames) {
    const all = (tasks || []).filter(t => t && t.name);
    const onBoard = new Set(Array.from(boardNames || []).map(n => String(n).toLowerCase()));
    const byParent = new Map();
    const roots = [];

    all.forEach(task => {
        const parent = task.parent || '';
        if (!parent) { roots.push(task); return; }
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(task);
    });

    const build = (task, depth, seen) => {
        const key = String(task.name).toLowerCase();
        // Guard against a cyclic .parent chain (see wbDescendantNames()).
        const children = (depth < 32 && !seen.has(key))
            ? (byParent.get(task.name) || []).map(child => build(child, depth + 1, new Set(seen).add(key)))
            : [];
        return {
            name: task.name,
            task,
            depth,
            children,
            onBoard: onBoard.has(key),
        };
    };

    return roots.map(task => build(task, 0, new Set()));
}

/**
 * Flatten an outline tree to the rows actually rendered, honouring
 * `collapsedNames` (a Set of lower-cased names whose children are hidden)
 * and an optional `query` filter.
 *
 * Filtering rule: a node is kept when it matches the query *or* has a
 * matching descendant, and while a query is active collapse is ignored --
 * a search that hid its own results behind a collapsed parent would be
 * useless. Each row carries `hasChildren`/`collapsed` so the caller can
 * draw the chevron without re-walking the tree.
 */
function wbFlattenOutline(tree, collapsedNames, query) {
    const collapsed = collapsedNames || new Set();
    const needle = String(query || '').trim().toLowerCase();
    const rows = [];

    const matches = (node) => !needle || String(node.name).toLowerCase().includes(needle);
    const subtreeMatches = (node) => matches(node) || node.children.some(subtreeMatches);

    const walk = (node) => {
        if (needle && !subtreeMatches(node)) return;
        const isCollapsed = !needle && collapsed.has(String(node.name).toLowerCase());
        rows.push({
            name: node.name,
            task: node.task,
            depth: node.depth,
            onBoard: node.onBoard,
            hasChildren: node.children.length > 0,
            collapsed: isCollapsed,
            matched: !!needle && matches(node),
        });
        if (!isCollapsed) node.children.forEach(walk);
    };

    (tree || []).forEach(walk);
    return rows;
}
