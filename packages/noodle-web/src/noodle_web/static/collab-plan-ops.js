/**
 * collab-plan-ops.js -- the host-authoritative live plan-editing protocol
 * for collab sessions (#967, part of the #766 epic). Builds on #963's
 * relay, #964's end-to-end encryption, #965's lifecycle handling and #966's
 * presence panel; this is the "real editing" piece those exist to carry.
 *
 * Per #766's own recommendation, this is host-authoritative ops, NOT a
 * CRDT: a joiner sends a small, explicit intent ("set task X to 50%"), the
 * host applies it to its own authoritative in-memory plan (the same
 * #989/#905 parse-once `PlanModel` -- see plan-model.js -- the host's own
 * `#planEditor` already uses for local edits), then broadcasts the
 * resulting state to everyone, including the sender, so every client's UI
 * reflects the authoritative result rather than an optimistic local guess.
 *
 * This module is pure logic with no DOM/WebSocket/crypto dependencies of
 * its own -- collab-session.js (host) wires it to the live `#planEditor`
 * and the `enc` frames from collab-crypto.js; collab_join.html (joiner)
 * builds ops from its minimal task-list UI and renders the snapshots this
 * module produces. That split is what makes the functions below testable
 * head-on (tests/test_collab_plan_ops.mjs) without a browser.
 *
 * ---------------------------------------------------------------------
 * WIRE FORMAT (the contract between host and joiner code -- read this
 * before changing shape)
 * ---------------------------------------------------------------------
 *
 * Both message kinds below travel exclusively as the JSON *plaintext*
 * inside an already-encrypted `{"type": "enc", ...}` envelope (see
 * collab-crypto.js's `encryptMessage`/`decryptMessage`) -- there is no new
 * top-level WebSocket frame type here, and the relay (app.py /
 * collab_session.py) never parses either of these; it only ever sees
 * ciphertext, exactly as before. The `"kind"` field is what lets the same
 * `enc` channel eventually carry other encrypted payload shapes too (e.g.
 * a future #969 back-matter op) without breaking this one.
 *
 * 1. Joiner -> host: a `plan_op` (an edit *intent*, not yet applied):
 *
 *      {
 *        "kind": "plan_op",
 *        "op_id": "<opaque per-message string, for logging/dedup only>",
 *        "op": "add_task" | "set_name" | "set_progress" | "mark_complete" | "reorder_task",
 *        "actor": "<the joiner's display name, as given at join time>",
 *        "task": { "name": "...", "level": 2 },   // the target task (all ops but add_task)
 *        "value": 50,                             // set_progress: 0-100
 *        "parent": { "name": "...", "level": 1 } | null,  // add_task: where to add
 *        "position": "top" | "bottom",            // add_task: default "bottom"
 *        "name": "New Task",                      // add_task / set_name: the new text
 *        "direction": "up" | "down"                // reorder_task
 *      }
 *
 *    Only the fields relevant to `op` are meaningful; others are ignored.
 *
 * 2. Host -> every joiner (including the original sender): a fresh
 *    `plan_snapshot` of the *entire* current task outline, sent after
 *    admission (so a newly-joined or rejoined participant starts
 *    populated, not empty -- #967's "new joiner catch-up" requirement) and
 *    again after every change to the host's plan, whether that change came
 *    from an applied `plan_op` or the host's own local typing:
 *
 *      {
 *        "kind": "plan_snapshot",
 *        "tasks": [
 *          { "name": "...", "level": 1, "indent": 0, "percent": 40, "is_summary": true },
 *          ...
 *        ],
 *        "conflict": null | {
 *          "task": { "name": "...", "level": 2 },
 *          "previous_actor": "Alice",
 *          "actor": "Bob",
 *          "message": "Bob also edited this -- showing the latest version."
 *        }
 *      }
 *
 * A DELIBERATE CHOICE, DOCUMENTED: a full snapshot is broadcast after every
 * change rather than a computed diff. A modest plan's outline serialises to
 * at most a few KB, well within the "under a second on a LAN" latency
 * budget the issue sets, and it sidesteps an entire class of "did the
 * diff apply cleanly against what this joiner already has" bugs a partial
 * update would risk -- simpler and more robust, at the cost of a few extra
 * KB per edit. #968/#969 can revisit this if a much larger plan ever makes
 * it worth optimising.
 *
 * TASK IDENTITY: ops and snapshots identify a task by `{name, level}`
 * (`level` = 1 + floor(indent / 2), the exact scheme plan-model.js's own
 * `findByName(name, level)` already uses, and the same one
 * `findTaskLineNumber` in script.js relies on elsewhere in this app) --
 * not a numeric `TaskNode.id`, which is just a position in tree-walk order
 * and gets reassigned by plan-model.js's `_refreshTaskOrder()` on every
 * structural edit (add/reorder/indent), making it unstable across the very
 * concurrent edits this protocol exists to handle. `{name, level}` is not
 * perfectly unique either (two sibling tasks could share a name), but it's
 * the same, already-serviceable identification scheme the rest of the app
 * already lives with -- see findTaskLineNumber's `model.findByName` call --
 * so this protocol doesn't invent a new one.
 *
 * CONFLICT RESOLUTION: last-write-wins, always -- the host applies
 * incoming ops (and its own local edits) strictly in the order it
 * observes them (a single WebSocket message loop is naturally
 * serialised; see collab-session.js's use of `host_send_lock`'s
 * counterpart on the receive side), so "last write" has an unambiguous
 * meaning. `ConflictTracker` below only decides whether to *surface a
 * notice* -- it remembers the most recent actor to touch each task and,
 * if a different actor touches the same task again within
 * `CONFLICT_WINDOW_MS`, the next snapshot broadcast carries a `conflict`
 * block so every client can show "X also edited this -- showing the
 * latest version." The resolution itself (which edit "won") is never in
 * question: it's always whichever one the host applied most recently,
 * which is always what's in the outgoing snapshot.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.CollabPlanOps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // How recently a *different* actor must have edited the same task for
    // the next edit to be flagged as a conflict rather than an ordinary
    // sequential change. 5s comfortably covers "two people editing the
    // same task within the same few seconds", the scenario the issue's own
    // acceptance criteria describes, without flagging every re-edit of a
    // task someone touched a while ago.
    const CONFLICT_WINDOW_MS = 5000;

    // Matches a bare, unlabelled percent token the same way task-tokenizer.js's
    // grammar does ((?<!\w) / (?!\w) so "50%" isn't mistaken for part of a
    // longer token) -- duplicated here, deliberately: this module must work
    // even when task-tokenizer.js/TaskLineTokenizer isn't loaded (e.g. the
    // pure Node test environment, or a future joiner-only page that never
    // loads the full editor stack), so it never asks plan-model.js's
    // TaskLineTokenizer-or-fallback metadata for `percent` -- it reads the
    // task's own raw text directly instead.
    const PERCENT_RE = /(?<!\w)(\d{1,3})%(?!\w)/;

    function getPlanModel() {
        if (typeof NoodlePlanModel !== 'undefined') return NoodlePlanModel;
        return null;
    }

    function taskLevel(indent) {
        return Math.floor(indent / 2) + 1;
    }

    function taskRef(task) {
        return { name: task.name, level: taskLevel(task.indent) };
    }

    function taskKey(ref) {
        return `${ref.level}::${ref.name}`;
    }

    function findTask(model, ref) {
        if (!ref || !ref.name) return null;
        return model.findByName(ref.name, ref.level) || null;
    }

    function clampPercent(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return null;
        return Math.max(0, Math.min(100, Math.round(num)));
    }

    function extractPercent(content) {
        const match = PERCENT_RE.exec(String(content == null ? '' : content));
        return match ? clampPercent(match[1]) : 0;
    }

    function setPercentOnTask(model, task, percent) {
        return model.updateLine(task, (fullLine) => {
            if (PERCENT_RE.test(fullLine)) return fullLine.replace(PERCENT_RE, percent + '%');
            return fullLine.replace(/\s*$/, '') + ' ' + percent + '%';
        });
    }

    /**
     * Apply one decrypted `plan_op` to `text` (the full plan markdown),
     * returning `{ok: true, text: <new markdown>}` on success or
     * `{ok: false, text: <unchanged input>, error: <string>}` on failure
     * (unknown op, target task not found, invalid value, etc). Never
     * throws -- a malformed or stale op is just a no-op the caller can log
     * and drop, same as any other best-effort relay traffic in this epic.
     */
    function applyPlanOp(text, op) {
        const PlanModelLib = getPlanModel();
        if (!PlanModelLib) return { ok: false, text, error: 'plan model unavailable' };
        if (!op || typeof op !== 'object' || typeof op.op !== 'string') {
            return { ok: false, text, error: 'invalid op' };
        }

        const model = PlanModelLib.PlanModel.parse(text);
        let applied = false;

        switch (op.op) {
            case 'add_task': {
                const parent = op.parent ? findTask(model, op.parent) : null;
                if (op.parent && !parent) return { ok: false, text, error: 'parent task not found' };
                const node = model.addTask(op.name, parent, op.position);
                applied = Boolean(node);
                break;
            }
            case 'set_name': {
                const task = findTask(model, op.task);
                if (!task) return { ok: false, text, error: 'task not found' };
                applied = model.rename(task, op.name != null ? op.name : op.value);
                break;
            }
            case 'set_progress':
            case 'mark_complete': {
                const task = findTask(model, op.task);
                if (!task) return { ok: false, text, error: 'task not found' };
                const percent = op.op === 'mark_complete' ? 100 : clampPercent(op.value);
                if (percent === null) return { ok: false, text, error: 'invalid percent value' };
                applied = setPercentOnTask(model, task, percent);
                break;
            }
            case 'reorder_task': {
                const task = findTask(model, op.task);
                if (!task) return { ok: false, text, error: 'task not found' };
                applied = model.reorderSibling(task, op.direction);
                break;
            }
            default:
                return { ok: false, text, error: 'unknown op type: ' + op.op };
        }

        if (!applied) return { ok: false, text, error: 'op did not apply' };
        return { ok: true, text: model.serialize() };
    }

    /**
     * Build the plain-JSON task list a `plan_snapshot` message carries,
     * from the full plan markdown. Deliberately flat and minimal -- just
     * enough for #967's minimal joiner UI (name, nesting level/indent for
     * display, current percent, and whether a task has children so the
     * joiner can render summary rows differently) -- not a full mirror of
     * every field the main app's task form supports.
     */
    function buildPlanSnapshot(text) {
        const PlanModelLib = getPlanModel();
        if (!PlanModelLib) return [];
        const model = PlanModelLib.PlanModel.parse(text);
        return model.tasks.map((task) => ({
            name: task.name,
            level: taskLevel(task.indent),
            indent: task.indent,
            percent: extractPercent(task.content),
            is_summary: task.children.length > 0,
        }));
    }

    /**
     * Which tasks changed `percent` between two `buildPlanSnapshot()`
     * results, keyed by `{name, level}`. Used by collab-session.js to
     * attribute the host's own *local* editor typing to a task for
     * `ConflictTracker` purposes (a joiner's edit has an explicit
     * `op.task`; the host just typing in `#planEditor` doesn't, so this is
     * how the host side notices which task it just touched). Renames
     * aren't tracked here -- a name change moves a task to a new
     * `{name, level}` key, which this diff sees as one task disappearing
     * and another appearing, not as a change to a stable identity; that's
     * an accepted limitation of identifying tasks by name (see this
     * module's docstring), not something this function tries to paper
     * over.
     */
    function diffChangedTasks(prevSnapshot, nextSnapshot) {
        const prevByKey = new Map((prevSnapshot || []).map((task) => [taskKey(task), task]));
        const changed = [];
        for (const task of nextSnapshot || []) {
            const before = prevByKey.get(taskKey(task));
            if (before && before.percent !== task.percent) {
                changed.push({ name: task.name, level: task.level });
            }
        }
        return changed;
    }

    /**
     * Tracks the most recent actor to edit each task (by `{name, level}`)
     * so the host can flag "X also edited this" when a different actor
     * touches the same task again shortly after. See this module's
     * docstring for why this only ever affects whether a notice is shown,
     * never which edit wins (that's always simply "whichever one the host
     * just applied", i.e. last-write-wins by construction).
     */
    class ConflictTracker {
        constructor(windowMs) {
            this.windowMs = typeof windowMs === 'number' ? windowMs : CONFLICT_WINDOW_MS;
            this._lastEdit = new Map();
        }

        /**
         * Record that `actor` edited the task named by `ref` at `now`
         * (milliseconds; defaults to `Date.now()`, overridable so tests
         * don't need to sleep). Returns a conflict descriptor
         * `{task, previous_actor, actor, message}` if a different actor
         * edited the same task within `windowMs` beforehand, else `null`.
         */
        record(ref, actor, now) {
            const at = typeof now === 'number' ? now : Date.now();
            const key = taskKey(ref);
            const previous = this._lastEdit.get(key);
            this._lastEdit.set(key, { actor, at });
            if (previous && previous.actor !== actor && at - previous.at <= this.windowMs) {
                return {
                    task: { name: ref.name, level: ref.level },
                    previous_actor: previous.actor,
                    actor,
                    message: `${actor} also edited this — showing the latest version.`,
                };
            }
            return null;
        }
    }

    return {
        CONFLICT_WINDOW_MS,
        taskLevel,
        taskRef,
        taskKey,
        findTask,
        clampPercent,
        extractPercent,
        applyPlanOp,
        buildPlanSnapshot,
        diffChangedTasks,
        ConflictTracker,
    };
});
