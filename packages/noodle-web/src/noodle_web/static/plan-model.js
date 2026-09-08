/**
 * Parse-once in-memory plan model (issue #905, sub-issues #914/#915/#916).
 *
 * NoodlePlanner has always treated a plan as text: reorder, rename, and
 * dependency lookup are all regex operations against the raw markdown
 * (root cause of #747, #748, #838 -- see those issues and #905 for the
 * full write-up). This module is the additive first step towards a real
 * in-memory object graph: it parses a plan's task outline into a tree of
 * `TaskNode`s exactly once (#914/#915), and can write that tree back to
 * markdown on request (#916).
 *
 * Scope, deliberately narrow (see #905's sub-issue breakdown):
 *  - This module is NOT wired into any existing view, editor, or Kanban
 *    code path. Nothing in the app depends on it yet. It is safe to load
 *    and safe to ignore.
 *  - It models the task outline only. Front matter and every back-matter
 *    section (---raid log---, ---comms---, ...) are captured verbatim as
 *    opaque text -- not modelled, but preserved exactly -- so the existing
 *    round-trip guarantee (docs/reference/plan-format.rst,
 *    tests/test_markdown_roundtrip.*) keeps holding for a parse->serialise
 *    pass with no edits.
 *  - Resolving a task's `dependencies` (and the `*` shorthand) into actual
 *    object references to predecessor nodes is #917's job, not this one --
 *    see the TaskNode `dependencies`/`hasStar` doc below for exactly what
 *    this module hands off. Likewise reorder (#918), rename (#919),
 *    successor lookup (#920), and retiring the regex operations this
 *    replaces (#921) are separate, later issues.
 *
 * JS-only, not ported to noodle_core/Python: every follow-on consumer
 * (#917-#921 -- Board view, drag/drop reorder, rename, dependency
 * highlighting) is browser/editor-side. The Python side already has its
 * own established models for what it actually does (FrontMatterParser,
 * scheduling_engine.py's task parsing) and neither needs nor is planned to
 * need a mutable task graph -- see the PR description for the full
 * reasoning. If a Python consumer materialises later, port then rather
 * than maintaining an unused parallel implementation now.
 *
 * ---------------------------------------------------------------------
 * The TaskNode shape
 * ---------------------------------------------------------------------
 * Tree links are object references (`parent`, `children`), not names or
 * indices -- the entire point of this model is that "where is this task"
 * and "what is this task called" stop being the same question.
 *
 *   id            Synthetic, human-debuggable identity: the chain of
 *                 ancestor names down to this node, joined by ' › ',
 *                 with a `#2`/`#3`... suffix disambiguating same-named
 *                 siblings under the same parent. Mirrors
 *                 msproject-task-diff.js's parseTaskOutline() key scheme
 *                 (same rationale: #838, duplicate sibling names must not
 *                 collide). NOT a stable identity across edits -- a
 *                 rename or move changes it, same limitation
 *                 msproject-task-diff.js documents for its keys. Tree
 *                 position/identity that survives an edit is real object
 *                 references (`parent`/`children`), which is what makes
 *                 this model worth having; `id` is a convenience label.
 *   name          The task's display name/description, with every
 *                 recognised inline token stripped out.
 *   indent        Leading-whitespace character count of the raw line
 *                 (matches scheduling_engine.py's
 *                 `len(line) - len(line.lstrip())`).
 *   lineIndex     0-based index into the *whole plan text's* lines
 *                 (`text.split("\n")`), so a consumer can map a node back
 *                 to an editor cursor position without re-scanning.
 *   raw           The exact original line text (no trailing newline).
 *                 Serialising an unedited node replays this verbatim,
 *                 which is what makes the round-trip guarantee absolute
 *                 rather than "as good as the formatter." See
 *                 `formatTaskLine` below for the field-based alternative
 *                 used when `raw` is absent (a node built from scratch).
 *   parent        The parent TaskNode, or null at the top level.
 *   children      Ordered array of child TaskNodes.
 *   isSummary     Live getter: true iff `children.length > 0`. Computed,
 *                 not cached, so it stays correct if a future consumer
 *                 (#918/#919) mutates `children`.
 *   duration      The full duration token as written, *including* its
 *                 unit letter (e.g. "5d", "2w", "0d"), or "" if absent.
 *                 Deliberately differs from task-tokenizer.js's
 *                 `metadata().duration`, which drops the unit character
 *                 (`text.slice(0, -1)`) -- fine for that module's use
 *                 (display only), but it would make `formatTaskLine`
 *                 unable to reconstruct the token at all. Same token,
 *                 captured without the information loss.
 *   startDate     First ISO date token on the line ("" if none).
 *   finishDate    Second ISO date token on the line ("" if none).
 *   percent       Percent-complete, as a numeric string without "%"
 *                 ("" if absent). Auto-derived from effort if the line
 *                 carries an effort token, same as task-tokenizer.js.
 *   resources     Array of `@name` resource tags (without the `@`).
 *   labels        Array of `#label` tags (without the `#`).
 *   comment       Double/smart-quoted note text, without the quotes ("").
 *                 A single-quoted note (`'...'`) is NOT recognised by this
 *                 grammar (task-tokenizer.js doesn't either) and stays
 *                 embedded in `name` -- an existing quirk, not new here.
 *   priority      "Low" | "Medium" | "Important" | "Urgent".
 *   bucket        `{Bucket}` tag content, without the braces ("").
 *   dependencies  Array of raw, UNRESOLVED dependency description
 *                 strings -- the content of `[depends ...]`, split on
 *                 commas and trimmed, exactly as written (so
 *                 "Wireframes:SS +2d" stays one string; the dependency
 *                 type/lag suffix is not parsed out). This does NOT
 *                 include the `*` shorthand's implied predecessor -- see
 *                 `hasStar` below for why. #917 is expected to turn each
 *                 string into a resolved `{ node, type, lag }` (or
 *                 similar) by matching against the tree this module
 *                 builds.
 *   hasStar       True if the line starts with the `*` "depends on the
 *                 previous task" shorthand.
 *   starLagLead   The `+Nd`/`-Nd` lag/lead immediately after a `*`, if
 *                 any ("" otherwise).
 *                 Deliberately NOT resolved to an actual predecessor
 *                 here: script.js's getPreviousTaskName() (the current
 *                 behaviour this needs to match) walks backwards through
 *                 the *raw line list*, skipping summaries, and is not
 *                 simply "the previous sibling" -- reproducing that
 *                 correctly needs the tree-edge walk #920 ("successor
 *                 lookup via edges") is explicitly chartered to build.
 *                 Re-deriving it here with different logic risks a
 *                 second, silently-diverging implementation of the same
 *                 rule. `hasStar`/`starLagLead` give #917/#920 everything
 *                 they need to resolve it correctly once, via the tree.
 *   recurrence    Lower-cased `[repeats ...]` content ("" if absent).
 *   productType   "internal" | "group" | "external" | undefined, from a
 *                 `$name` / `/$name` / `^$name` token. Same value as
 *                 task-tokenizer.js's `metadata().product_type`, just
 *                 camelCased for consistency with every other field here
 *                 (the only other naming difference from that function;
 *                 `duration`'s deviation above is a real value change).
 *   deliverable   The product/deliverable name after `$`, or undefined.
 *   effortCompleted, effortCompletedUnit, effortRemaining,
 *   effortRemainingUnit, effortTotal, effortTotalUnit
 *                 From a `~8h`/`~2d/5d`-style effort token, unit-per-value
 *                 (these already keep their unit in task-tokenizer.js, so
 *                 no deviation here).
 *
 * Everything else on a raw line that isn't one of the above tokens stays
 * folded into `name` (unmodelled but not lost -- and irrelevant to the
 * round-trip guarantee anyway, since serialisation replays `raw`).
 */

// The task-line grammar below is a deliberate, faithful duplicate of
// TaskLineTokenizer in static/task-tokenizer.js (same patterns, same
// order), not an import: that file is a plain global `<script>` (loaded
// for editor syntax highlighting), not an ES module, so it can't be
// imported into this one. msproject-task-diff.js's extractTaskName()
// already establishes this exact precedent, for the same reason -- see
// its header comment. tests/test_plan_model.mjs cross-checks this copy
// against the real TaskLineTokenizer (lifted from task-tokenizer.js) over
// the whole fixture corpus, to catch drift a plain code review might miss.
const TOKEN_PATTERNS = [
    ['comment', /["“][^"”]*["”]/g],
    ['dependency', /\[depends(?::\s*|\s+)[^\]]+\]/gi],
    ['recurrence', /\[repeats\s+[^\]]+\]/gi],
    ['bucket', /\{[^}]+\}/g],
];
const TOKEN_PATTERN = /~\d+(?:\.\d+)?[hd](?:\/\d+(?:\.\d+)?[hd])?|(?<![\w!])(!!!|!!|!)(?![\w!"'{])|@\w+|#\w+|[/^]?\$[A-Za-z_][A-Za-z0-9_-]*|\b\d+[dmwy]\b|(?<!\w)\d+%(?!\w)|\b\d{4}-\d{2}-\d{2}\b/g;

function addToken(tokens, line, type, start, end) {
    tokens.push({ type, start, end, text: line.slice(start, end) });
}

/** Faithful copy of TaskLineTokenizer.tokenize -- see the header comment above. */
export function tokenizeTaskLine(line) {
    const tokens = [];
    const protectedRanges = [];
    const trimmedStart = line.search(/\S/);
    if (trimmedStart !== -1 && line[trimmedStart] === '*') {
        addToken(tokens, line, 'star', trimmedStart, trimmedStart + 1);
        const lag = /^[+\-]\d+[dwmy]\b/.exec(line.slice(trimmedStart + 1).trimStart());
        if (lag) {
            const lagStart = line.indexOf(lag[0], trimmedStart + 1);
            addToken(tokens, line, 'star-lag', lagStart, lagStart + lag[0].length);
        }
    }

    for (const [type, pattern] of TOKEN_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line))) {
            addToken(tokens, line, type, match.index, match.index + match[0].length);
            protectedRanges.push([match.index, match.index + match[0].length]);
        }
    }

    TOKEN_PATTERN.lastIndex = 0;
    let match;
    while ((match = TOKEN_PATTERN.exec(line))) {
        const start = match.index;
        if (protectedRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd) ||
            tokens.some((token) => start >= token.start && start < token.end)) continue;
        const text = match[0];
        const type = text[0] === '~' ? 'effort'
            : text[0] === '!' ? 'priority'
                : text[0] === '@' ? 'resource'
                    : text[0] === '#' ? 'label'
                        : text.includes('$') ? 'product'
                            : text.endsWith('%') ? 'percent'
                                : /^\d{4}-/.test(text) ? 'date'
                                    : 'duration';
        addToken(tokens, line, type, start, start + text.length);
    }
    return tokens.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Faithful copy of TaskLineTokenizer.metadata's *token extraction*, with
 * one deliberate deviation: `duration` keeps its unit letter (see the
 * TaskNode doc above for why). Everything else matches field for field.
 */
export function taskLineMetadata(line) {
    const tokens = tokenizeTaskLine(line);
    const values = {
        name: '', duration: '', startDate: '', finishDate: '', percent: '',
        resources: [], labels: [], comment: '', priority: 'Low', bucket: '',
        dependencies: [], recurrence: '', productType: undefined, deliverable: undefined,
        effortCompleted: '', effortCompletedUnit: 'h', effortRemaining: '',
        effortRemainingUnit: 'h', effortTotal: '', effortTotalUnit: 'h',
        hasStar: false, starLagLead: '',
    };
    const removable = new Array(line.length).fill(false);
    const dates = [];
    for (const token of tokens) {
        if (token.type !== 'star' && token.type !== 'star-lag') {
            for (let i = token.start; i < token.end; i++) removable[i] = true;
        }
        const text = token.text;
        if (token.type === 'star') values.hasStar = true;
        else if (token.type === 'star-lag') values.starLagLead = text;
        else if (token.type === 'comment' && !values.comment) values.comment = text.slice(1, -1);
        else if (token.type === 'bucket' && !values.bucket) values.bucket = text.slice(1, -1).trim();
        else if (token.type === 'priority') values.priority = text === '!!!' ? 'Urgent' : text === '!!' ? 'Important' : 'Medium';
        else if (token.type === 'recurrence' && !values.recurrence) values.recurrence = text.replace(/^\[repeats\s+|\]$/gi, '').trim().toLowerCase();
        else if (token.type === 'dependency') {
            const content = text.replace(/^\[depends(?::\s*|\s+)|\]$/gi, '');
            values.dependencies.push(...content.split(',').map((value) => value.trim()).filter(Boolean));
        } else if (token.type === 'resource') values.resources.push(text.slice(1));
        else if (token.type === 'label') values.labels.push(text.slice(1));
        else if (token.type === 'duration') values.duration = text; // unit kept -- see header doc
        else if (token.type === 'percent') values.percent = text.slice(0, -1);
        else if (token.type === 'date') dates.push(text);
        else if (token.type === 'product') {
            values.productType = text[0] === '/' ? 'group' : text[0] === '^' ? 'external' : 'internal';
            values.deliverable = text.replace(/^[/^]?\$/, '');
        } else if (token.type === 'effort' && !values.effortTotal) {
            const effort = /^~(\d+(?:\.\d+)?)([hd])(?:\/(\d+(?:\.\d+)?)([hd]))?$/.exec(text);
            if (effort[3] !== undefined) {
                values.effortCompleted = effort[1]; values.effortCompletedUnit = effort[2];
                values.effortTotal = effort[3]; values.effortTotalUnit = effort[4];
                values.effortRemaining = String(parseFloat(effort[3]) - parseFloat(effort[1]));
                values.effortRemainingUnit = effort[4];
            } else {
                values.effortCompleted = '0'; values.effortCompletedUnit = effort[2];
                values.effortTotal = effort[1]; values.effortTotalUnit = effort[2];
                values.effortRemaining = effort[1]; values.effortRemainingUnit = effort[2];
            }
        }
    }
    if (values.effortTotal) {
        const completed = parseFloat(values.effortCompleted) * (values.effortCompletedUnit === 'd' ? 8 : 1);
        const total = parseFloat(values.effortTotal) * (values.effortTotalUnit === 'd' ? 8 : 1);
        values.percent = String(Math.max(0, Math.min(100, Math.round(completed / total * 100))));
    }
    values.startDate = dates[0] || '';
    values.finishDate = dates[1] || '';
    values.name = line.split('').filter((_, index) => !removable[index]).join('')
        .replace(/^\s*\*(?:\s*[+\-]\d+[dwmy])?/, '').replace(/\s+/g, ' ').trim();
    return values;
}

const LEVEL_SEP = ' › '; // matches msproject-task-diff.js's LEVEL_SEP

/** One task line -- see the module header for the full field reference. */
export class TaskNode {
    constructor(raw, lineIndex) {
        this.kind = 'task';
        this.raw = raw;
        this.lineIndex = lineIndex;
        this.indent = raw.length - raw.replace(/^\s*/, '').length;
        this.parent = null;
        this.children = [];
        this.id = '';
        Object.assign(this, taskLineMetadata(raw));
    }

    get isSummary() {
        return this.children.length > 0;
    }
}

/** A non-task line inside the task outline: blank, or a `//` line comment. */
function makeOutlineLine(raw, lineIndex, kind) {
    return { kind, raw, lineIndex };
}

/**
 * Build the task tree from the task-outline segment's lines. Mirrors
 * msproject-task-diff.js's parseTaskOutline() indent-stack approach and
 * its duplicate-sibling-name disambiguation (#838), adapted to build real
 * object links instead of string keys -- see that module for the
 * original, narrower-purpose version this generalises.
 *
 * Blank lines and `//`-prefixed comment lines are not tasks -- this
 * matches how both scheduling engines already treat them
 * (scheduling_engine.py and static/engine/scheduler.js both skip them),
 * not msproject-task-diff.js's more permissive parseTaskOutline (built
 * for a narrower diffing purpose, so it doesn't need to agree with the
 * scheduler on what counts as a task).
 */
function buildOutline(taskOutlineRaw, lineOffset) {
    const rawLines = taskOutlineRaw.split('\n');
    const lines = [];
    const roots = [];
    const nodes = [];
    const stack = []; // { indent, node }
    const childOccurrences = new Map(); // parentId -> Map(name -> count)

    rawLines.forEach((raw, i) => {
        const lineIndex = lineOffset + i;
        if (!raw.trim()) {
            lines.push(makeOutlineLine(raw, lineIndex, 'blank'));
            return;
        }
        if (raw.trimStart().startsWith('//')) {
            lines.push(makeOutlineLine(raw, lineIndex, 'comment'));
            return;
        }

        const node = new TaskNode(raw, lineIndex);
        while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
        const parent = stack.length ? stack[stack.length - 1].node : null;
        node.parent = parent;
        if (parent) parent.children.push(node);
        else roots.push(node);

        const parentId = parent ? parent.id : '';
        if (!childOccurrences.has(parentId)) childOccurrences.set(parentId, new Map());
        const counts = childOccurrences.get(parentId);
        const occurrence = (counts.get(node.name) || 0) + 1;
        counts.set(node.name, occurrence);
        const segment = occurrence > 1 ? `${node.name}#${occurrence}` : node.name;
        node.id = parentId ? parentId + LEVEL_SEP + segment : segment;

        lines.push(node);
        nodes.push(node);
        stack.push({ indent: node.indent, node });
    });

    return { lines, roots, nodes };
}

// Same generic back-matter marker already established for this exact
// purpose in static/engine/local-parse.js's planBody() (issue #844) --
// reused here rather than re-deriving a marker list, so a new back-matter
// section type needs no change in either place.
const BACK_MATTER_MARKER = /^---[a-z][a-z -]*---$/m;
const FRONT_MATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---/;

/**
 * Split plan text into front matter / task outline / back matter, each
 * captured as an exact substring. The split is a plain string partition
 * (`frontMatterRaw + taskOutlineRaw + backMatterRaw === text` always,
 * by construction -- see below), so nothing here can break byte-identical
 * round-tripping even in an edge case the marker regexes get "wrong".
 */
function splitPlanText(text) {
    let frontMatterRaw = '';
    let rest = text;
    const fm = FRONT_MATTER_BLOCK.exec(text);
    if (fm && fm.index === 0) {
        frontMatterRaw = fm[0];
        rest = text.slice(frontMatterRaw.length);
    }

    let taskOutlineRaw = rest;
    let backMatterRaw = '';
    const marker = BACK_MATTER_MARKER.exec(rest);
    if (marker) {
        taskOutlineRaw = rest.slice(0, marker.index);
        backMatterRaw = rest.slice(marker.index);
    }

    return { frontMatterRaw, taskOutlineRaw, backMatterRaw };
}

/**
 * Parse a plan's full markdown text into a PlanModel:
 *   { frontMatterRaw, taskOutlineRaw, backMatterRaw, lines, roots, nodes }
 *
 * - frontMatterRaw / backMatterRaw: opaque, verbatim text (front matter
 *   and every back-matter section are explicitly out of scope for deep
 *   parsing -- see #915).
 * - lines: every line of the task-outline segment, in document order --
 *   TaskNodes and blank/comment passthrough entries alike. This is what
 *   `serializePlan` replays; it is the reason serialisation is exact.
 * - roots / nodes: the task tree (top-level nodes) and a flat, document-
 *   order list of every TaskNode, for convenient traversal/lookup.
 */
export function parsePlan(text) {
    const source = String(text ?? '');
    const { frontMatterRaw, taskOutlineRaw, backMatterRaw } = splitPlanText(source);

    // How many lines precede the task outline, for TaskNode.lineIndex to
    // be a real index into source.split('\n') rather than into the
    // outline segment alone.
    const lineOffset = frontMatterRaw ? frontMatterRaw.split('\n').length - 1 : 0;

    const { lines, roots, nodes } = buildOutline(taskOutlineRaw, lineOffset);

    return { frontMatterRaw, taskOutlineRaw, backMatterRaw, lines, roots, nodes };
}

/**
 * Best-effort canonical line formatter: builds a task line from a node's
 * structured fields rather than replaying `raw`. This is what
 * `serializePlan` falls back to for a node with no captured `raw` (i.e.
 * one built programmatically rather than parsed) -- there is no such node
 * anywhere in this module yet, since nothing here mutates or creates
 * nodes, but #918/#919 will need exactly this kind of formatter once they
 * do.
 *
 * NOT asserted byte-identical to any particular original line: token
 * order, spacing, and quoting style vary across real plans (see
 * tests/fixtures/*.md) in ways a single canonical order cannot reproduce.
 * The round-trip guarantee this module is responsible for
 * (parse -> serialise with no edits is byte-identical) is carried by
 * `raw`, not by this function -- see the TaskNode doc for `raw`. Deciding
 * a real spacing/ordering policy for edited lines is left to #918/#919,
 * which are the first consumers that will actually need one.
 */
export function formatTaskLine(node) {
    const parts = [];
    if (node.hasStar) parts.push(node.starLagLead ? `*${node.starLagLead}` : '*');
    parts.push(node.name);
    if (node.duration) parts.push(node.duration);
    if (node.startDate) parts.push(node.startDate);
    if (node.finishDate) parts.push(node.finishDate);
    if (node.percent !== '') parts.push(`${node.percent}%`);
    for (const resource of node.resources) parts.push(`@${resource}`);
    if (node.priority === 'Urgent') parts.push('!!!');
    else if (node.priority === 'Important') parts.push('!!');
    else if (node.priority === 'Medium') parts.push('!');
    if (node.effortTotal) {
        parts.push(node.effortCompleted && node.effortCompleted !== '0'
            ? `~${node.effortCompleted}${node.effortCompletedUnit}/${node.effortTotal}${node.effortTotalUnit}`
            : `~${node.effortTotal}${node.effortTotalUnit}`);
    }
    if (node.deliverable) {
        const sigil = node.productType === 'group' ? '/$' : node.productType === 'external' ? '^$' : '$';
        parts.push(`${sigil}${node.deliverable}`);
    }
    if (node.bucket) parts.push(`{${node.bucket}}`);
    if (node.dependencies.length) parts.push(`[depends ${node.dependencies.join(', ')}]`);
    if (node.recurrence) parts.push(`[repeats ${node.recurrence}]`);
    for (const label of node.labels) parts.push(`#${label}`);
    if (node.comment) parts.push(`"${node.comment}"`);
    return ' '.repeat(node.indent) + parts.join(' ');
}

/**
 * Write a PlanModel back to markdown text.
 *
 * front matter (verbatim) + serialised task outline + back matter
 * (verbatim), in the plan's original section order -- the round-trip
 * guarantee this module is required to uphold (see tests/test_plan_model
 * .mjs, which checks this against the full tests/fixtures/roundtrip and
 * tests/fixtures/conformance corpus, byte-identical, with no edits).
 *
 * Each outline line is `raw` when present (every parsed node has one --
 * this is what makes the guarantee exact rather than approximate) and
 * `formatTaskLine(node)` otherwise.
 */
export function serializePlan(model) {
    const outline = model.lines
        .map((line) => (line.kind === 'task' ? (line.raw ?? formatTaskLine(line)) : line.raw))
        .join('\n');
    return model.frontMatterRaw + outline + model.backMatterRaw;
}
