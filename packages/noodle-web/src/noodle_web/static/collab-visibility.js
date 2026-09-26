/**
 * collab-visibility.js -- the host's "hide this from collaborators" eye for
 * planning sessions.
 *
 * The host of a live session can hide parts of the plan's task structure
 * from everyone who has joined: a hidden task, and everything beneath it,
 * is neither sent to joiners nor changeable by them. The state is
 * deliberately memory-only -- it lives for one session on the host's page
 * and is never written to the plan, the project record, localStorage or
 * the server -- so ending the session (or reloading) forgets it.
 *
 * ## Where the hiding happens
 *
 * On the host, before anything is encrypted. The relay only ever carries
 * ciphertext, and a joiner's page is not trusted to hide anything it has
 * been sent, so the only way to keep a task private is never to send it.
 * `redactPlanText` turns the host's plan into the one joiners are shown:
 *
 *   - hidden task lines are removed, with their subtasks and the blank or
 *     `//` lines that belong to them;
 *   - a visible task's `[depends ...]` loses the entries that name a hidden
 *     task, so a dependency cannot leak its name;
 *   - `---whiteboard---` and `---baseline---` rows naming a hidden task,
 *     front-matter `Theme:` entries for one, and HTML-comment payloads in
 *     those two sections mentioning one are dropped.
 *
 * Every rule is line-local: a line is dropped or rewritten, never moved.
 * That is what lets `restoreHidden` put a joiner's edit back together.
 *
 * ## Visibility rules
 *
 * State is `{ hideAll, overrides }`: `overrides` maps a lower-cased task
 * name (the same key the Plan structure panel already uses for collapsed
 * rows) to `true` (hidden) or `false` (shown). A task with no override
 * inherits from its parent, and a top-level task from `hideAll`. A task is
 * shared only when it *and every ancestor* is shown -- a child cannot be
 * sent without the parent line that gives it its place in the outline.
 *
 * "Hide everything, then unhide what should be seen" is `hideAll` plus
 * `false` overrides. Unhiding a task whose ancestor is hidden reveals the
 * path down to it and pins that ancestor's other children hidden, so
 * showing one task never shows its siblings -- see `toggleTask`.
 *
 * Names are the key because they are what the plan itself uses to refer
 * to a task. Two tasks with the same name share one setting. A rename --
 * by the host typing, or by a joiner -- carries the setting across; see
 * `reconcileRenames`.
 *
 * ## Joiner edits
 *
 * A joiner sends back an edited copy of the redacted text. `restoreHidden`
 * three-way merges it (collab-merge.js) with the redacted text as the base
 * and the host's full plan as the other side. Hidden lines exist only on
 * the host's side, so a merge can never alter them; a merge that cannot
 * place the joiner's change without overlapping them fails. The result is
 * then checked: every hidden subtree must come through verbatim and under
 * the same parent. Anything else is refused with reason `protected`.
 *
 * A classic script exposing `NoodleCollabVisibility`, and a CommonJS module
 * for tests/test_collab_visibility.mjs. Needs plan-model.js and
 * collab-merge.js loaded first (as globals, or via require in Node).
 */
(function (global) {
    'use strict';

    function planModel() {
        let api = global.NoodlePlanModel;
        if (!api && typeof require === 'function') api = require('./plan-model.js');
        if (!api || typeof api.PlanModel !== 'function') {
            throw new Error('collab-visibility: plan-model.js must be loaded first');
        }
        return api.PlanModel;
    }

    function collabMerge() {
        let api = global.NoodleCollabMerge;
        if (!api && typeof require === 'function') api = require('./collab-merge.js');
        if (!api || typeof api.merge3 !== 'function') {
            throw new Error('collab-visibility: collab-merge.js must be loaded first');
        }
        return api;
    }

    const key = name => String(name == null ? '' : name).trim().toLowerCase();

    // ── State ────────────────────────────────────────────────────────────

    function createState() {
        return { hideAll: false, overrides: new Map() };
    }

    function cloneState(state) {
        return { hideAll: !!(state && state.hideAll), overrides: new Map(state ? state.overrides : []) };
    }

    /** True when nothing can be hidden, so the host can skip every step
     * below and share the plan exactly as it is. */
    function isTrivial(state) {
        if (!state) return true;
        if (state.hideAll) return false;
        for (const hidden of state.overrides.values()) if (hidden) return false;
        return true;
    }

    /** Drop overrides that can no longer matter, so the state stays small
     * and "nothing hidden" is exactly one shape. */
    function normalise(state) {
        return isTrivial(state) ? createState() : state;
    }

    // ── Classification ───────────────────────────────────────────────────

    function asModel(planOrModel) {
        if (planOrModel && Array.isArray(planOrModel.tasks) && Array.isArray(planOrModel.roots)) return planOrModel;
        return planModel().parse(String(planOrModel == null ? '' : planOrModel));
    }

    /** Whether `task`'s own setting (explicit or inherited) is hidden. */
    function ownHidden(task, state) {
        for (let node = task; node; node = node.parent) {
            const override = state.overrides.get(key(node.name));
            if (override !== undefined) return override;
        }
        return state.hideAll;
    }

    /** Whether `task` is shared with joiners: it and every ancestor shown. */
    function isShared(task, state) {
        for (let node = task; node; node = node.parent) {
            if (ownHidden(node, state)) return false;
        }
        return true;
    }

    /**
     * How each task looks to the host's eye controls, by lower-cased name:
     * `shown`, `hidden` (the topmost task of a hidden subtree), or
     * `inherited` (under a hidden ancestor, so not shared either way).
     */
    function statuses(planOrModel, state) {
        const result = new Map();
        if (!state) return result;
        const model = asModel(planOrModel);
        for (const task of model.tasks) {
            const name = key(task.name);
            if (!name || result.has(name)) continue;
            let status = 'shown';
            if (task.parent && !isShared(task.parent, state)) status = 'inherited';
            else if (!isShared(task, state)) status = 'hidden';
            result.set(name, status);
        }
        return result;
    }

    /** True when at least one task would be sent to joiners. */
    function anyShared(planOrModel, state) {
        const model = asModel(planOrModel);
        return model.tasks.some(task => isShared(task, state));
    }

    // ── Toggling ─────────────────────────────────────────────────────────

    /**
     * Flip one task's eye. A shared task becomes hidden (and with it its
     * subtree). A task that is not shared -- hidden itself, or under a
     * hidden ancestor -- is revealed, together with the path of ancestors
     * above it; each ancestor revealed on the way has its other children
     * pinned hidden first, so only the path is exposed, not its siblings.
     */
    function toggleTask(planOrModel, state, name) {
        const model = asModel(planOrModel);
        const wanted = key(name);
        const task = model.tasks.find(node => key(node.name) === wanted);
        const next = cloneState(state);
        if (!task) return next;

        if (isShared(task, next)) {
            next.overrides.set(wanted, true);
            return normalise(next);
        }

        const path = [];
        for (let node = task; node; node = node.parent) path.unshift(node);
        // Decided up front: revealing an ancestor changes what the nodes
        // below it inherit, and each unshared node on the path needs its
        // other children pinned hidden whether it is hidden itself or only
        // by inheritance.
        const wasShared = path.map(node => isShared(node, state));
        for (let index = 0; index < path.length; index++) {
            const node = path[index];
            const isTarget = index === path.length - 1;
            if (wasShared[index]) continue;
            if (!isTarget) {
                for (const child of node.children) {
                    if (child === path[index + 1]) continue;
                    const childKey = key(child.name);
                    if (!next.overrides.has(childKey)) next.overrides.set(childKey, true);
                }
            }
            next.overrides.set(key(node.name), false);
        }
        return normalise(next);
    }

    /** The top-level eye: hide everything if anything is shared, otherwise
     * share everything. Either way individual settings are cleared. */
    function toggleAll(planOrModel, state) {
        if (anyShared(planOrModel, state)) return { hideAll: true, overrides: new Map() };
        return createState();
    }

    // ── Renames ──────────────────────────────────────────────────────────

    /**
     * Pair the tasks of `oldText` and `newText` that are the same task under
     * a new name: aligned by name, a run of removed names replaced by the
     * same number of added ones at the same indents is read as renames.
     * Returns Map<oldKey, newKey>.
     */
    function renamePairs(oldModel, newModel) {
        const oldTasks = oldModel.tasks;
        const newTasks = newModel.tasks;
        const pairs = new Map();
        const hunks = collabMerge().diffHunks(
            oldTasks.map(task => key(task.name)),
            newTasks.map(task => key(task.name))
        );
        // diffHunks reports positions in the old list; walk both in step to
        // find where each hunk's added names start in the new list.
        let shift = 0;
        for (const hunk of hunks) {
            const removed = hunk.end - hunk.start;
            const added = hunk.lines.length;
            if (removed === added) {
                for (let offset = 0; offset < removed; offset++) {
                    const before = oldTasks[hunk.start + offset];
                    const after = newTasks[hunk.start + shift + offset];
                    if (before && after && before.indent === after.indent) {
                        pairs.set(key(before.name), key(after.name));
                    }
                }
            }
            shift += added - removed;
        }
        return pairs;
    }

    /**
     * Carry settings across renames between `oldText` and `newText`. With
     * `newTasksShown`, a task that is new in `newText` (and whose name no
     * existing task had) is pinned shown -- a joiner's new task must stay
     * on their board rather than vanishing into a hidden-by-default plan.
     * A setting is never carried onto a name that already has one or that
     * another task already used, so a rename cannot unhide a hidden task.
     */
    function reconcileRenames(oldText, newText, state, options) {
        if (isTrivial(state) || oldText === newText) return state;
        const oldModel = asModel(oldText);
        const newModel = asModel(newText);
        const next = cloneState(state);
        const oldNames = new Set(oldModel.tasks.map(task => key(task.name)));
        const newNames = new Set(newModel.tasks.map(task => key(task.name)));
        for (const [before, after] of renamePairs(oldModel, newModel)) {
            if (before === after || oldNames.has(after) || next.overrides.has(after)) continue;
            if (!next.overrides.has(before)) continue;
            next.overrides.set(after, next.overrides.get(before));
            if (!newNames.has(before)) next.overrides.delete(before);
        }
        if (options && options.newTasksShown) {
            for (const task of newModel.tasks) {
                const name = key(task.name);
                if (!name || oldNames.has(name) || next.overrides.has(name)) continue;
                next.overrides.set(name, false);
            }
        }
        return normalise(next);
    }

    // ── Redaction ────────────────────────────────────────────────────────

    const DEPENDS = /\[depends\s*:?\s*([^\]]*)\]/i;
    const BACK_MATTER = /^---[a-z][a-z -]*---$/i;
    const SCRUBBED_SECTIONS = new Set(['---whiteboard---', '---baseline---']);

    function dependencyName(spec) {
        return key(spec.trim()
            .replace(/\s+[+-]\d+[dwmy]$/i, '')
            .replace(/:(FS|SS|FF|SF)$/i, ''));
    }

    /** `content` without the `[depends ...]` entries that name a hidden task. */
    function scrubDependencies(content, hiddenNames) {
        const block = DEPENDS.exec(content);
        if (!block) return content;
        const specs = block[1].split(',');
        const kept = specs.filter(spec => !hiddenNames.has(dependencyName(spec)));
        if (kept.length === specs.length) return content;
        const before = content.slice(0, block.index);
        const after = content.slice(block.index + block[0].length);
        if (!kept.some(spec => spec.trim())) return (before.replace(/\s+$/, '') + after).replace(/\s+$/, '');
        return before + block[0].replace(block[1], kept.map(spec => spec.trim()).join(', ')) + after;
    }

    function mentionsHidden(text, hiddenNames) {
        const lower = text.toLowerCase();
        for (const name of hiddenNames) {
            if (lower.includes(`"${name}"`)) return true;
        }
        return false;
    }

    /** A back-matter or front-matter line that would give a hidden name away. */
    function leaksHiddenName(line, section, hiddenNames) {
        if (!SCRUBBED_SECTIONS.has(section)) return false;
        const trimmed = line.trim();
        if (trimmed.startsWith('<!--')) return mentionsHidden(trimmed, hiddenNames);
        if (!trimmed.includes('|')) return false;
        return trimmed.split('|').some(cell => hiddenNames.has(key(cell)));
    }

    function hiddenTaskSet(model, state) {
        return new Set(model.tasks.filter(task => !isShared(task, state)));
    }

    /** The lower-cased names of the `hidden` tasks. A name is only secret
     * if no shared task also carries it. */
    function secretNames(model, hidden) {
        const sharedNames = new Set(model.tasks.filter(task => !hidden.has(task)).map(task => key(task.name)));
        return new Set([...hidden].map(task => key(task.name)).filter(name => name && !sharedNames.has(name)));
    }

    /** The plan as joiners are allowed to see it. */
    function redactPlanText(planText, state) {
        const text = String(planText == null ? '' : planText);
        if (isTrivial(state)) return text;
        const model = asModel(text);
        const hidden = hiddenTaskSet(model, state);
        if (!hidden.size) return text;

        const hiddenNames = secretNames(model, hidden);

        const out = [];
        const emit = line => out.push(line.text + line.eol);
        let inTheme = false;
        for (const line of model.leading) {
            if (/^Theme:\s*$/.test(line.text)) { inTheme = true; emit(line); continue; }
            if (inTheme) {
                const entry = /^\s*-\s*(.*?)\s*:\s*#[0-9a-f]{6}\s*$/i.exec(line.text);
                if (entry) {
                    if (!hiddenNames.has(key(entry[1]))) emit(line);
                    continue;
                }
                if (/^\S/.test(line.text) && line.text.trim()) inTheme = false;
            }
            emit(line);
        }

        const emitTask = task => {
            if (hidden.has(task)) return;
            out.push(task.indentText + scrubDependencies(task.content, hiddenNames) + task.eol);
            task.trailing.forEach(emit);
            task.children.forEach(emitTask);
        };
        model.roots.forEach(emitTask);

        let section = '';
        for (const line of model.suffix) {
            const marker = line.text.trim().toLowerCase();
            if (BACK_MATTER.test(marker)) section = marker;
            else if (leaksHiddenName(line.text, section, hiddenNames)) continue;
            emit(line);
        }
        let result = out.join('');
        // A plan that ends without a newline must be shared the same way,
        // or dropping its last task leaves a line ending the joiner's edits
        // would then collide with in restoreHidden's merge.
        if (!/[\r\n]$/.test(text)) result = result.replace(/(\r\n|\n|\r)$/, '');
        return result;
    }

    // ── Joiner edits ─────────────────────────────────────────────────────

    /** Each hidden subtree's text and the name of the parent it hangs
     * from -- what a joiner's edit must leave exactly as it was. */
    function hiddenBlocks(model, state) {
        const blocks = [];
        const walk = (task, underHidden) => {
            const hidden = !isShared(task, state);
            if (hidden && !underHidden) {
                const lines = [];
                const collect = node => {
                    lines.push(node.indentText + node.content);
                    node.trailing.forEach(line => lines.push(line.text));
                    node.children.forEach(collect);
                };
                collect(task);
                blocks.push({ parent: task.parent ? key(task.parent.name) : null, text: lines.join('\n') });
            }
            task.children.forEach(child => walk(child, underHidden || hidden));
        };
        model.roots.forEach(task => walk(task, false));
        return blocks;
    }

    function blockSignature(block) {
        return `${block.parent === null ? '' : 'parent:' + block.parent}\u0000${block.text}`;
    }

    // ── The whiteboard table ──────────────────────────────────────────────
    //
    // A joiner's whiteboard edit (a pin, an unpin, a move) rewrites the whole
    // `---whiteboard---` table, re-padded to its widest cell. Line by line,
    // that one edit spans every row -- including the gaps where the host's
    // hidden rows sit -- so the merge below could never place it around them
    // and every pin was refused as `protected`. The section is
    // therefore merged as a table: the joiner's rows as they sent them, and
    // the hidden rows put back in.

    const WHITEBOARD = '---whiteboard---';

    function isWhiteboardMarker(line) {
        return line.trim().toLowerCase() === WHITEBOARD;
    }

    function isTableLine(line) {
        return line.trim().startsWith('|');
    }

    /**
     * Lift the whiteboard section's contents out of `text`. `rest` keeps the
     * marker on a line of its own, with one blank line before it (and one
     * after, when another section follows), so the three texts restoreHidden
     * merges agree on it however the joiner's copy was spaced. `body` is the
     * section's lines, or null when there is no section.
     */
    function liftWhiteboard(text) {
        const lines = text.split('\n');
        const start = lines.findIndex(isWhiteboardMarker);
        if (start === -1) return { rest: text, body: null };
        let end = start + 1;
        while (end < lines.length && !BACK_MATTER.test(lines[end].trim())) end++;
        let from = start;
        while (from > 0 && !lines[from - 1].trim()) from--;
        const body = lines.slice(start + 1, end);
        while (body.length && !body[body.length - 1].trim()) body.pop();
        const after = lines.slice(end);
        const rest = lines.slice(0, from).concat(from ? [''] : [], [lines[start]], after.length ? [''] : [], after);
        return { rest: rest.join('\n'), body };
    }

    /** Put `body` back under the whiteboard marker in `rest`, the merged
     * text. `finalNewline` is whether a section that ends the plan ends
     * with a newline. */
    function lowerWhiteboard(rest, body, finalNewline) {
        const lines = rest.split('\n');
        const at = lines.findIndex(isWhiteboardMarker);
        lines.splice(at + 1, 0, ...body);
        if (at + 1 + body.length < lines.length) return lines.join('\n');
        return lines.join('\n').replace(/\n+$/, '') + (finalNewline ? '\n' : '');
    }

    /**
     * `edited` with an empty whiteboard section where `sharedRest` (the
     * shared copy, lifted) has one: updatePlanWhiteboardText() drops the
     * section outright when the joiner unpins the last note they can see,
     * and the merge needs the marker on both sides to put the host's hidden
     * rows back under it. It goes before the section that followed it in
     * the shared copy, or at the end.
     */
    function withEmptyWhiteboard(edited, sharedRest) {
        const shared = sharedRest.split('\n');
        const next = shared.slice(shared.findIndex(isWhiteboardMarker) + 1).find(line => line.trim());
        const lines = edited.split('\n');
        let at = next ? lines.findIndex(line => line.trim().toLowerCase() === next.trim().toLowerCase()) : -1;
        if (at === -1) {
            at = lines.length;
            while (at > 0 && !lines[at - 1].trim()) at--;
        }
        lines.splice(at, 0, WHITEBOARD);
        return lines.join('\n');
    }

    /** A table row's cells, trimmed. An escaped `\|` is part of its cell. */
    function tableCells(line) {
        return line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1').split(/(?<!\\)\|/).map(cell => cell.trim());
    }

    /**
     * The joiner's whiteboard `body` with the host's `hidden` lines put back:
     * hidden rows after its last row, reshaped to its columns (a board with
     * a text object carries three more than one without), and anything else
     * -- an HTML comment -- at the end. A padded table is re-padded
     * around the new rows. When the joiner unpinned every note
     * they could see, the rows go under the header of the host's own table.
     */
    function withHiddenRows(body, hidden, fullBody) {
        const out = body.slice();
        // The app writes a padded table; one typed by hand is left as typed.
        const padded = new Set(out.filter(isTableLine).map(line => line.trimEnd().length)).size <= 1;
        const fullHeader = fullBody.find(isTableLine);
        const rows = hidden.filter(isTableLine);
        const others = hidden.filter(line => !isTableLine(line));
        let header = out.find(isTableLine);
        if (!header && rows.length) {
            const head = fullBody.filter(isTableLine).slice(0, 2);
            out.push(...head);
            header = head[0];
        }
        if (rows.length) {
            const from = tableCells(fullHeader).map(name => name.toLowerCase());
            const to = tableCells(header);
            const reshaped = rows.map(row => {
                const cells = tableCells(row);
                const byName = new Map(from.map((name, index) => [name, cells[index] || '']));
                return '| ' + to.map(name => byName.get(name.toLowerCase()) || '').join(' | ') + ' |';
            });
            let last = -1;
            out.forEach((line, index) => { if (isTableLine(line)) last = index; });
            out.splice(last + 1, 0, ...reshaped);
        }
        return (padded ? padTable(out) : out).concat(others);
    }

    /** `lines` with its table's columns padded to their widest cell, the
     * way generateWhiteboardText() (script.js) writes them. */
    function padTable(lines) {
        const isSeparator = cells => cells.every(cell => /^:?-+:?$/.test(cell));
        const rows = lines.map(line => (isTableLine(line) ? tableCells(line) : null));
        const widths = [];
        rows.forEach(cells => {
            if (!cells || isSeparator(cells)) return;
            cells.forEach((cell, index) => { widths[index] = Math.max(widths[index] || 0, cell.length); });
        });
        return lines.map((line, index) => {
            const cells = rows[index];
            if (!cells) return line;
            if (isSeparator(cells)) return '|' + widths.map(width => '-'.repeat(width + 2)).join('|') + '|';
            return '| ' + widths.map((width, i) => (cells[i] || '').padEnd(width)).join(' | ') + ' |';
        });
    }

    function sameLines(a, b) {
        if (a === null || b === null) return a === b;
        return a.length === b.length && a.every((line, index) => line === b[index]);
    }

    /**
     * Put a joiner's edit back together with the parts they cannot see.
     *
     * `fullText` is the host's plan, `sharedText` the redacted copy the
     * joiner edited (it must be `redactPlanText(fullText, state)`), and
     * `editedText` what they sent back. Returns `{ ok: true, text, state }`
     * -- `state` with any renames and new tasks from the edit carried in --
     * or `{ ok: false, reason: 'protected' }`.
     */
    function restoreHidden(fullText, sharedText, editedText, state) {
        const full = String(fullText == null ? '' : fullText);
        const shared = String(sharedText == null ? '' : sharedText);
        const edited = String(editedText == null ? '' : editedText);
        if (isTrivial(state)) return { ok: true, text: edited, state };
        if (edited === shared) return { ok: true, text: full, state };

        const fullBoard = liftWhiteboard(full);
        const model = asModel(full);
        const hiddenNames = secretNames(model, hiddenTaskSet(model, state));
        const leaks = line => leaksHiddenName(line, WHITEBOARD, hiddenNames);
        const hiddenLines = fullBoard.body ? fullBoard.body.filter(leaks) : [];
        if (!hiddenLines.length) return restoreOutline(full, shared, edited, state);

        // The board holds rows the joiner cannot see: merge everything else
        // line by line, and the table as a table.
        const sharedBoard = liftWhiteboard(shared);
        let editedBoard = liftWhiteboard(edited);
        const finalNewline = editedBoard.body ? /\n$/.test(edited) : /\n$/.test(full);
        if (!editedBoard.body && sharedBoard.body) {
            editedBoard = liftWhiteboard(withEmptyWhiteboard(edited, sharedBoard.rest));
        }
        let body;
        if (sameLines(sharedBoard.body, editedBoard.body)) {
            body = fullBoard.body;
        } else {
            // A row naming a hidden task is not the joiner's to write.
            if ((editedBoard.body || []).some(leaks)) return { ok: false, reason: 'protected' };
            body = withHiddenRows(editedBoard.body || [], hiddenLines, fullBoard.body);
        }
        const result = restoreOutline(fullBoard.rest, sharedBoard.rest, editedBoard.rest, state);
        if (!result.ok) return result;
        if (!result.text.split('\n').some(isWhiteboardMarker)) return { ok: false, reason: 'protected' };
        return { ...result, text: lowerWhiteboard(result.text, body, finalNewline) };
    }

    /** restoreHidden()'s line merge, and the check that it left every
     * hidden subtree exactly as it was. */
    function restoreOutline(full, shared, edited, state) {
        const merged = collabMerge().merge3(shared, edited, full);
        if (merged === null) return { ok: false, reason: 'protected' };

        const fullModel = asModel(full);
        const mergedModel = asModel(merged);
        const nextState = reconcileRenames(fullModel, mergedModel, state, { newTasksShown: true });
        const renames = renamePairs(fullModel, mergedModel);

        const expected = hiddenBlocks(fullModel, state).map(block => blockSignature({
            parent: block.parent === null ? null : (renames.get(block.parent) || block.parent),
            text: block.text,
        })).sort();
        const actual = hiddenBlocks(mergedModel, nextState).map(blockSignature).sort();
        if (expected.length !== actual.length || expected.some((sig, index) => sig !== actual[index])) {
            return { ok: false, reason: 'protected' };
        }
        return { ok: true, text: merged, state: nextState };
    }

    const api = {
        createState,
        isTrivial,
        statuses,
        anyShared,
        toggleTask,
        toggleAll,
        reconcileRenames,
        redactPlanText,
        restoreHidden,
    };
    global.NoodleCollabVisibility = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
