/**
 * collab-ops.js -- the host-authoritative edit protocol for #967 (part of
 * the #766 collab-sessions epic).
 *
 * ## Concurrency model
 *
 * #766 weighed a CRDT-over-text design against host-authoritative ops and
 * explicitly recommended the latter, so this module implements ops only.
 * Joiners never edit a plan directly. They send an *intent* ("set task 3 to
 * 75%"), the host applies it to its own authoritative Markdown document,
 * and the host broadcasts the resulting snapshot to everyone. There is
 * exactly one writer, so there is no merge algorithm to get wrong.
 *
 * ## Conflict resolution (the concrete, documented rule)
 *
 * The host applies ops strictly in the order they arrive on its socket.
 * That is a single, total order -- the host is one JavaScript event loop --
 * so **last write wins**, deterministically, with no tie to break.
 *
 * Two people editing *different* tasks therefore never lose an edit: each
 * op names its own task and neither overwrites the other.
 *
 * Two people editing the *same* task resolve to whichever op the host
 * received second, and that is made *visible* rather than silent:
 * `applyPlanOp` returns the previous value it displaced, and
 * `describeConflict` turns that into the "X also edited this" notice both
 * clients show. Losing an edit invisibly is the failure mode the issue
 * calls out, so a superseded edit is always reported.
 *
 * ## Staleness
 *
 * Task ids are positions in document order, so they shift when tasks are
 * added, moved or removed. Every op therefore carries `expect`: the task
 * name the sender believed it was editing. If the task at that id no
 * longer has that name, the op is rejected as stale rather than applied to
 * the wrong task -- the sender simply retries against the next snapshot.
 * This is what makes an id-based protocol safe under concurrent structural
 * edits.
 *
 * ## Why the parsing here is deliberately self-contained
 *
 * Structure (hierarchy, moves, serialisation, rename-with-dependency
 * fixups) comes from plan-model.js, the repo's canonical Markdown model.
 * Percent, however, is read and written here rather than through
 * `task.metadata.percent`. That field only exists when
 * static/task-tokenizer.js has been loaded as a classic script and made a
 * global; where it hasn't, plan-model.js silently degrades to a name-only
 * fallback parse. Owning the percent token here means these ops behave
 * identically either way, instead of depending on load order elsewhere in
 * the page.
 *
 * Markdown remains canonical throughout: every op is a text-in/text-out
 * transformation, so nothing here introduces a second source of truth.
 */

/** Quoted spans are free text -- a "50%" inside a comment is prose, not the
 * task's progress. Blank them out (preserving length, so indices still line
 * up with the original string) before looking for real tokens. Mirrors the
 * `comment` pattern in task-tokenizer.js. */
function maskQuoted(line) {
    return line.replace(/["“][^"”]*["”]/g, (match) => ' '.repeat(match.length));
}

// Same shape as task-tokenizer.js's percent token, anchored so "100%" in
// "v2.100%x" is not mistaken for progress.
const PERCENT_TOKEN = /(?<!\w)(\d{1,3})%(?!\w)/;

/** Read a task line's percent complete, or null when it carries none. */
export function readPercent(line) {
    const match = PERCENT_TOKEN.exec(maskQuoted(String(line)));
    if (!match) return null;
    return Number(match[1]);
}

/** Return `line` with its percent set to `value`, replacing the existing
 * token in place when there is one (so surrounding metadata keeps its
 * position) and appending otherwise. */
export function writePercent(line, value) {
    const text = String(line);
    const percent = Math.max(0, Math.min(100, Math.round(Number(value))));
    const match = PERCENT_TOKEN.exec(maskQuoted(text));
    if (match) {
        const start = match.index;
        const end = start + match[0].length;
        return text.slice(0, start) + `${percent}%` + text.slice(end);
    }
    return `${text.replace(/\s+$/, '')} ${percent}%`;
}

function loadPlanModel() {
    const model = globalThis.NoodlePlanModel;
    if (!model || typeof model.PlanModel !== 'function') {
        throw new Error('collab-ops: plan-model.js must be loaded before applying ops');
    }
    return model.PlanModel;
}

/**
 * Build the snapshot the host broadcasts after every applied op.
 *
 * `id` is the task's index in document order. It is only meaningful within
 * this `rev` -- see the staleness note in the module docstring for why that
 * is safe.
 */
export function buildPlanSnapshot(planText, rev) {
    const PlanModel = loadPlanModel();
    const model = new PlanModel(String(planText == null ? '' : planText));
    return {
        type: 'plan_snapshot',
        rev,
        plan_text: String(planText == null ? '' : planText),
        tasks: model.tasks.map((task, index) => {
            const line = task.indentText + task.content;
            const percent = readPercent(line);
            return {
                id: index,
                name: task.name,
                indent: task.indent,
                percent,
                done: percent === 100,
                has_children: task.children.length > 0,
            };
        }),
    };
}

const VALID_OPS = new Set(['set_percent', 'rename', 'add_task', 'move']);

/** True if `op` is structurally a well-formed edit intent. Shape only --
 * whether it still applies to the current document is `applyPlanOp`'s job. */
export function isPlanOp(value) {
    return Boolean(value) && typeof value === 'object' && value.type === 'plan_op' && VALID_OPS.has(value.op);
}

function reject(reason) {
    return { ok: false, reason };
}

/**
 * Apply one joiner's edit intent to the host's authoritative plan text.
 *
 * Returns `{ok: true, text, previous}` -- `previous` being the value this
 * op displaced, which is what lets the host tell everyone an edit was
 * superseded instead of losing it silently -- or `{ok: false, reason}` for
 * an op that no longer applies (`stale`, `unknown_task`, `invalid`).
 *
 * Never throws on bad input: ops arrive from the network, and a malformed
 * one must be rejected, not allowed to take down the host's session.
 */
export function applyPlanOp(planText, op) {
    if (!isPlanOp(op)) return reject('invalid');

    const PlanModel = loadPlanModel();
    const model = new PlanModel(String(planText == null ? '' : planText));

    if (op.op === 'add_task') {
        // op.name is untrusted joiner input spliced straight into a single
        // document line by addTask(); an embedded newline could forge a
        // back-matter marker (e.g. "---whiteboard---") and corrupt the rest
        // of the host's document on the next parse, so collapse it here.
        const name = String(op.name == null ? '' : op.name).replace(/[\r\n]+/g, ' ').trim();
        if (!name) return reject('invalid');
        return addTask(model, op, name);
    }

    const task = model.tasks[op.id];
    if (!task) return reject('unknown_task');
    // The staleness gate: ids are positional, so without this an op could
    // silently land on whichever task happens to occupy that slot now.
    if (typeof op.expect === 'string' && task.name !== op.expect) return reject('stale');

    if (op.op === 'set_percent') {
        const value = Number(op.value);
        if (!Number.isFinite(value)) return reject('invalid');
        const line = task.indentText + task.content;
        const previous = readPercent(line);
        model.updateLine(task, (current) => writePercent(current, value));
        return { ok: true, text: model.serialize(), previous };
    }

    if (op.op === 'rename') {
        // Same untrusted-input risk as add_task's name, above.
        const value = String(op.value == null ? '' : op.value).replace(/[\r\n]+/g, ' ').trim();
        if (!value) return reject('invalid');
        const previous = task.name;
        if (!model.rename(task, value)) return reject('invalid');
        return { ok: true, text: model.serialize(), previous };
    }

    // move
    const target = model.tasks[op.target_id];
    if (!target) return reject('unknown_task');
    if (task === target) return reject('invalid');
    let moved = false;
    if (op.position === 'child') moved = model.moveAsChild(task, target, true);
    else if (op.position === 'before') moved = model.moveBefore(task, target);
    else if (op.position === 'after') moved = model.moveAfter(task, target);
    else return reject('invalid');
    // moveAsChild refuses to move a task into its own subtree, which would
    // otherwise detach that whole branch from the document.
    if (!moved) return reject('invalid');
    return { ok: true, text: model.serialize(), previous: null };
}

/** Insert a new task, either as the last child of `parent_id` or at the end
 * of the plan. Done as a text splice because plan-model.js models an
 * existing document rather than growing one. */
function addTask(model, op, name) {
    const text = model.serialize();
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const lines = text.split(/\r\n|\n/);
    const hadTrailingBlank = lines.length > 0 && lines[lines.length - 1] === '';
    if (hadTrailingBlank) lines.pop();

    if (op.parent_id == null) {
        lines.push(name);
        return { ok: true, text: lines.join(eol) + (hadTrailingBlank ? eol : ''), previous: null };
    }

    const parent = model.tasks[op.parent_id];
    if (!parent) return reject('unknown_task');
    if (typeof op.expect === 'string' && parent.name !== op.expect) return reject('stale');

    // Insert after the parent's entire subtree, so the new task becomes its
    // last child rather than displacing existing descendants.
    let last = parent;
    const walk = (node) => { last = node; node.children.forEach(walk); };
    parent.children.forEach(walk);
    const at = model.lineNumber(last);
    if (at < 1) return reject('unknown_task');

    const indent = ' '.repeat(parent.indent + 2);
    lines.splice(at, 0, indent + name);
    return { ok: true, text: lines.join(eol) + (hadTrailingBlank ? eol : ''), previous: null };
}

/** How recently someone else must have touched a task for the next edit to
 * count as having raced them. Long enough to cover "we were both looking at
 * this task just now", short enough that editing a task someone finished
 * with minutes ago is not called a conflict. */
export const CONFLICT_WINDOW_MS = 10000;

/**
 * Decides which edits actually raced another participant.
 *
 * Without this, *every* edit that changes a value would produce an "X also
 * edited this" notice -- including a single person quietly working through
 * a plan on their own -- and a notice that fires constantly is one people
 * stop reading. `record` reports the other participant only when someone
 * *else* edited the same task within the window.
 */
export function createConflictTracker(windowMs = CONFLICT_WINDOW_MS) {
    const lastEdit = new Map();
    return {
        /** Note that `by` just edited `taskName`; returns the display name
         * of the different participant they raced, or null. */
        record(taskName, by, now = Date.now()) {
            const key = String(taskName);
            const prior = lastEdit.get(key);
            lastEdit.set(key, { by, at: now });
            if (!prior || prior.by === by) return null;
            return now - prior.at <= windowMs ? prior.by : null;
        },
        /** Forget everything -- a new session starts with no history. */
        reset() {
            lastEdit.clear();
        },
    };
}

/**
 * The visible half of the conflict rule. Given the value an op displaced
 * and who sent it, produce the notice every client shows -- or null when
 * nothing was actually overwritten.
 *
 * `previous` is compared against the incoming value so that re-applying the
 * same value (two people agreeing) is not reported as a conflict. Callers
 * should also gate on `createConflictTracker` so that an ordinary solo edit
 * is not announced as one.
 */
export function describeConflict(op, previous, byDisplayName) {
    if (previous == null || previous === '') return null;
    if (op.op !== 'set_percent' && op.op !== 'rename') return null;
    const incoming = op.op === 'set_percent' ? Number(op.value) : String(op.value).trim();
    const before = op.op === 'set_percent' ? Number(previous) : String(previous);
    if (incoming === before) return null;
    const who = String(byDisplayName || 'Someone').trim() || 'Someone';
    const what = op.op === 'set_percent' ? `${before}%` : `"${before}"`;
    return `${who} also edited this — was ${what}.`;
}
