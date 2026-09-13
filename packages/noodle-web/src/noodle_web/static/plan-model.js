/**
 * Parse-once, editable representation of a NoodlePlanner markdown plan.
 *
 * Markdown remains canonical: every byte is retained on parse and an
 * unchanged model serialises byte-for-byte.  Structural editor operations
 * work with TaskNode objects, rather than locating tasks with name regexes.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NoodlePlanModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const BACK_MATTER = /^---[a-z][a-z -]*---$/i;
    const DEPENDS = /\[depends\s*:?\s*([^\]]*)\]/i;
    const DEP_TYPE = /^(.+?):(FS|SS|FF|SF)$/i;
    const LAG = /^(.+?)\s+([+-]\d+[dwmy])$/i;
    const DELIVERABLE = /(?:^|\s)[/^]?\$([A-Za-z_][A-Za-z0-9_-]*)/;

    function splitPhysicalLines(text) {
        const lines = [];
        const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
        let match;
        while ((match = pattern.exec(text)) && (match[0] || pattern.lastIndex < text.length)) {
            lines.push({ text: match[1], eol: match[2] });
            if (!match[2]) break;
        }
        return lines;
    }

    function isTrailingOutlineSeparator(lines, index) {
        if (lines[index].text.trim() !== '---') return false;
        for (let next = index + 1; next < lines.length; next++) {
            if (!lines[next].text.trim()) continue;
            return BACK_MATTER.test(lines[next].text.trim());
        }
        return true;
    }

    function fallbackMetadata(line) {
        const protectedLine = line
            .replace(/\[depends\s*:?\s*[^\]]*\]/gi, '')
            .replace(/\[repeats\s+[^\]]*\]/gi, '')
            .replace(/\{[^}]*\}/g, '')
            .replace(/["\u201c][^"\u201d]*["\u201d]/g, '')
            .replace(/~\d+(?:\.\d+)?[hd](?:\/\d+(?:\.\d+)?[hd])?/gi, '')
            .replace(/(?<!\w)(?:!!!|!!|!)(?![\w"'])/g, '')
            .replace(/(?:^|\s)@[A-Za-z0-9_.-]+/g, ' ')
            .replace(/(?:^|\s)#[^\s]+/g, ' ')
            .replace(/(?:^|\s)[/^]?\$[A-Za-z_][A-Za-z0-9_-]*/g, ' ')
            .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
            .replace(/(?<!~)\b\d+(?:\.\d+)?[dwmy]\b/gi, '')
            .replace(/\b\d{1,3}%\b/g, '');
        return {
            name: protectedLine.replace(/^\s*\*(?:\s*[+-]\d+[dwmy])?/i, '').replace(/\s+/g, ' ').trim(),
        };
    }

    function taskMetadata(line) {
        if (typeof TaskLineTokenizer !== 'undefined') {
            return TaskLineTokenizer.metadata(line).values;
        }
        return fallbackMetadata(line);
    }

    function parseDependencySpec(spec) {
        let value = spec.trim();
        let lag = '';
        let type = 'FS';
        const lagMatch = LAG.exec(value);
        if (lagMatch) {
            value = lagMatch[1].trim();
            lag = lagMatch[2];
        }
        const typeMatch = DEP_TYPE.exec(value);
        if (typeMatch) {
            value = typeMatch[1].trim();
            type = typeMatch[2].toUpperCase();
        }
        return { rawName: value, type, lag };
    }

    class TaskNode {
        constructor(id, physical, indentText, content, metadata) {
            this.id = id;
            this.name = metadata.name;
            this.metadata = { ...metadata };
            this.indentText = indentText;
            this.indent = indentText.length;
            this.content = content;
            this.eol = physical.eol;
            this.parent = null;
            this.children = [];
            this.trailing = [];
            this.dependencies = [];
            this.successors = new Set();
            this.sequential = /^\*(?:\s*[+-]\d+[dwmy])?/i.test(content);
            const outsideDependencies = content.replace(/\[depends\s*:?\s*[^\]]*\]/gi, '');
            this.deliverable = (DELIVERABLE.exec(outsideDependencies) || [])[1] || null;
            this.originalName = this.name;
            this._nameDirty = false;
        }
    }

    class PlanModel {
        constructor(text) {
            this.originalText = String(text == null ? '' : text);
            this.leading = [];
            this.suffix = [];
            this.roots = [];
            this.tasks = [];
            this._parse();
        }

        static parse(text) { return new PlanModel(text); }

        _parse() {
            const physical = splitPhysicalLines(this.originalText);
            let inFrontMatter = physical.length > 0 && physical[0].text === '---';
            let frontMatterClosed = !inFrontMatter;
            let inSuffix = false;
            let previousTask = null;
            const stack = [];

            for (let index = 0; index < physical.length; index++) {
                const line = physical[index];
                if (inSuffix) { this.suffix.push(line); continue; }
                if (inFrontMatter) {
                    this.leading.push(line);
                    if (index > 0 && line.text === '---') {
                        inFrontMatter = false;
                        frontMatterClosed = true;
                    }
                    continue;
                }
                if (frontMatterClosed && BACK_MATTER.test(line.text.trim())) {
                    inSuffix = true;
                    this.suffix.push(line);
                    continue;
                }
                if (isTrailingOutlineSeparator(physical, index)) {
                    if (previousTask) previousTask.trailing.push(line);
                    else this.leading.push(line);
                    continue;
                }
                if (!line.text.trim() || line.text.trimStart().startsWith('//')) {
                    if (previousTask) previousTask.trailing.push(line);
                    else this.leading.push(line);
                    continue;
                }

                const indentText = (line.text.match(/^\s*/) || [''])[0];
                const content = line.text.slice(indentText.length);
                const metadata = taskMetadata(content);
                const node = new TaskNode(this.tasks.length, line, indentText, content, metadata);
                while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
                node.parent = stack.length ? stack[stack.length - 1] : null;
                (node.parent ? node.parent.children : this.roots).push(node);
                stack.push(node);
                this.tasks.push(node);
                previousTask = node;
            }
            this._resolveDependencies();
        }

        _resolveDependencies() {
            for (const task of this.tasks) {
                task.dependencies = [];
                task.successors.clear();
            }
            const byName = new Map();
            const byProduct = new Map();
            for (const task of this.tasks) {
                if (task.name) byName.set(task.name.toLowerCase(), task);
                if (task.deliverable) byProduct.set(task.deliverable.toLowerCase(), task);
            }
            for (let index = 0; index < this.tasks.length; index++) {
                const task = this.tasks[index];
                const block = DEPENDS.exec(task.content);
                const specs = block && block[1].trim()
                    ? block[1].split(',').map(parseDependencySpec)
                    : [];
                if (task.sequential && this.tasks[index - 1]) {
                    specs.unshift({ rawName: this.tasks[index - 1].name, type: 'FS', lag: '', shorthand: true });
                }
                for (const spec of specs) {
                    const key = spec.rawName.toLowerCase();
                    const target = spec.rawName.startsWith('$')
                        ? byProduct.get(spec.rawName.slice(1).toLowerCase()) || null
                        : byName.get(key) || null;
                    const edge = { ...spec, target, shorthand: Boolean(spec.shorthand) };
                    task.dependencies.push(edge);
                    if (target) target.successors.add(task);
                }
            }
        }

        taskAt(index) { return this.tasks[index] || null; }

        findById(id) { return this.tasks.find(task => task.id === id) || null; }

        findByName(name, level) {
            const wanted = String(name || '');
            return this.tasks.find(task => task.name === wanted &&
                (level == null || Math.floor(task.indent / 2) + 1 === level)) || null;
        }

        successorsOf(task) { return task ? Array.from(task.successors) : []; }

        findSuccessors(task) { return this.successorsOf(task); }

        rename(task, newName) {
            if (!task || !String(newName).trim()) return false;
            const oldName = task.name;
            // A name becomes one physical line via _serialiseContent/serialize;
            // an embedded newline would split it into extra lines that could be
            // mistaken for structure (e.g. a back-matter marker) on the next
            // parse, so collapse rather than pass it through.
            task.name = String(newName).replace(/[\r\n]+/g, ' ').trim();
            task.metadata.name = task.name;
            task._nameDirty = task.name !== task.originalName;
            this._renameThemeEntry(oldName, task.name);
            this._renameWhiteboardRows(oldName, task.name);
            return true;
        }

        _renameThemeEntry(oldName, newName) {
            let inTheme = false;
            for (const line of this.leading) {
                if (/^Theme:\s*$/.test(line.text)) { inTheme = true; continue; }
                if (!inTheme) continue;
                const entry = /^(\s*-\s*)(.*?)(\s*:\s*#[0-9a-f]{6}\s*)$/i.exec(line.text);
                if (entry) {
                    if (entry[2] === oldName) line.text = entry[1] + newName + entry[3];
                    continue;
                }
                if (/^\S/.test(line.text) && line.text.trim()) inTheme = false;
            }
        }

        _renameWhiteboardRows(oldName, newName) {
            let inWhiteboard = false;
            let taskColumn = -1;
            for (const line of this.suffix) {
                const marker = line.text.trim().toLowerCase();
                if (BACK_MATTER.test(marker)) {
                    inWhiteboard = marker === '---whiteboard---';
                    taskColumn = -1;
                    continue;
                }
                if (!inWhiteboard || !line.text.includes('|')) continue;
                const cells = line.text.split('|');
                if (taskColumn < 0) {
                    taskColumn = cells.findIndex(cell => cell.trim().toLowerCase() === 'task');
                    continue;
                }
                if (taskColumn >= cells.length || cells[taskColumn].trim() !== oldName) continue;
                const cell = cells[taskColumn];
                const leading = (cell.match(/^\s*/) || [''])[0];
                const trailing = (cell.match(/\s*$/) || [''])[0];
                cells[taskColumn] = leading + newName + trailing;
                line.text = cells.join('|');
            }
        }

        updateLine(task, updater) {
            if (!task || typeof updater !== 'function') return false;
            const fullLine = task.indentText + this._serialiseContent(task);
            const updated = updater(fullLine);
            if (typeof updated !== 'string') return false;
            const indent = (updated.match(/^\s*/) || [''])[0].length;
            task.indent = indent;
            task.indentText = updated.slice(0, indent);
            task.content = updated.slice(indent);
            const metadata = taskMetadata(task.content);
            task.metadata = { ...metadata };
            if (metadata.name) {
                task.name = metadata.name;
                task.originalName = metadata.name;
                task._nameDirty = false;
            }
            this._resolveDependencies();
            return true;
        }

        moveAsChild(task, target, afterChildren) {
            if (!task || !target || task === target || this._contains(task, target)) return false;
            const sequentialTargets = this._captureSequentialTargets();
            const hadFinalEol = this._hasFinalLineEnding();
            const oldPredecessor = this._predecessorOf(task);
            const oldList = task.parent ? task.parent.children : this.roots;
            const oldIndex = oldList.indexOf(task);
            if (oldIndex < 0) return false;
            oldList.splice(oldIndex, 1);
            this._dropTrailingBlankLines(task);
            if (oldPredecessor) this._dropTrailingBlankLines(oldPredecessor);
            task.parent = target;
            if (afterChildren) target.children.push(task);
            else target.children.unshift(task);
            this._setIndent(task, target.indent + 2);
            this._refreshTaskOrder();
            this._dropPredecessorBlankTrailing(task);
            this._normalisePhysicalLineEndings(hadFinalEol);
            this._expandBrokenSequentialLinks(sequentialTargets);
            this._resolveDependencies();
            return true;
        }

        moveBefore(task, target) { return this._moveBeside(task, target, false); }

        moveAfter(task, target) { return this._moveBeside(task, target, true); }

        moveAsRoot(task) {
            if (!task) return false;
            const sequentialTargets = this._captureSequentialTargets();
            const hadFinalEol = this._hasFinalLineEnding();
            const oldPredecessor = this._predecessorOf(task);
            const oldList = task.parent ? task.parent.children : this.roots;
            const oldIndex = oldList.indexOf(task);
            if (oldIndex < 0) return false;
            if (!task.parent && oldIndex === this.roots.length - 1) return false;
            oldList.splice(oldIndex, 1);
            this._dropTrailingBlankLines(task);
            if (oldPredecessor) this._dropTrailingBlankLines(oldPredecessor);
            task.parent = null;
            this.roots.push(task);
            this._setIndent(task, 0);
            this._refreshTaskOrder();
            this._dropPredecessorBlankTrailing(task);
            this._normalisePhysicalLineEndings(hadFinalEol);
            this._expandBrokenSequentialLinks(sequentialTargets);
            this._resolveDependencies();
            return true;
        }

        _moveBeside(task, target, after) {
            if (!task || !target || task === target || this._contains(task, target)) return false;
            const sequentialTargets = this._captureSequentialTargets();
            const hadFinalEol = this._hasFinalLineEnding();
            const oldPredecessor = this._predecessorOf(task);
            const oldList = task.parent ? task.parent.children : this.roots;
            const oldIndex = oldList.indexOf(task);
            if (oldIndex < 0) return false;
            oldList.splice(oldIndex, 1);

            const targetList = target.parent ? target.parent.children : this.roots;
            const targetIndex = targetList.indexOf(target);
            if (targetIndex < 0) {
                oldList.splice(oldIndex, 0, task);
                return false;
            }
            this._dropTrailingBlankLines(task);
            if (oldPredecessor) this._dropTrailingBlankLines(oldPredecessor);
            task.parent = target.parent;
            targetList.splice(targetIndex + (after ? 1 : 0), 0, task);
            this._setIndent(task, target.indent);
            this._refreshTaskOrder();
            this._dropPredecessorBlankTrailing(task);
            this._normalisePhysicalLineEndings(hadFinalEol);
            this._expandBrokenSequentialLinks(sequentialTargets);
            this._resolveDependencies();
            return true;
        }

        _captureSequentialTargets() {
            const targets = new Map();
            for (const task of this.tasks) {
                const edge = task.dependencies.find(dependency => dependency.shorthand);
                if (edge && edge.target) targets.set(task, edge.target);
            }
            return targets;
        }

        _expandBrokenSequentialLinks(targets) {
            for (const [task, predecessor] of targets) {
                const index = this.tasks.indexOf(task);
                if (index > 0 && this.tasks[index - 1] === predecessor) continue;

                const star = /^(\*)\s*([+-]\d+[dwmy])?\s*/i.exec(task.content);
                if (!star) continue;
                const dependency = predecessor.name + (star[2] ? ' ' + star[2] : '');
                let content = task.content.slice(star[0].length);
                const block = DEPENDS.exec(content);
                if (block) {
                    const separator = block[1].trim() ? ', ' : '';
                    const replacement = block[0].replace(
                        block[1],
                        block[1] + separator + dependency
                    );
                    content = content.slice(0, block.index) + replacement +
                        content.slice(block.index + block[0].length);
                } else {
                    content = content.trimEnd() + ' [depends: ' + dependency + ']';
                }
                task.content = content;
                task.sequential = false;
                task.metadata = { ...taskMetadata(content) };
            }
        }

        // insertTaskAfter()/removeTask() -- the notepad surface's own
        // structural operations -- live further down (after
        // _normalisePhysicalLineEndings()), where the #1049 implementation
        // that ships in main defines them; no separate copy needed here.

        /**
         * Check whether `task` could be made to depend on `predecessor`
         * (predecessor finishes before task starts, a plain FS link) --
         * without mutating anything. Used for live drag-hover feedback
         * (#1052), where re-checking on every pointer move must be cheap
         * and side-effect-free.
         *
         * Neither end may be a summary task (#1106): a task is classified
         * as a summary purely by whether it currently has any nested lines
         * (`.children.length` -- the same "has this task got children"
         * test engine/scheduler.js's buildTasks() and whiteboard-notes.js's
         * wbHasChildren() already use for the identical rule elsewhere),
         * so this reuses that existing signal rather than adding a second,
         * possibly-diverging notion of "is a summary task". Summary tasks
         * can't have dependencies of their own -- only their individual
         * leaf tasks can -- so both the old whole-card dependency link
         * (whiteboard-dep-noodles.js, now removed) and the new row-level
         * one (dragged from a checklist row) are refused here identically.
         */
        canAddDependency(task, predecessor) {
            if (!task || !predecessor) return { ok: false, reason: 'Pick two tasks to link.' };
            if (task === predecessor) return { ok: false, reason: 'A task cannot depend on itself.' };
            if (task.children.length || predecessor.children.length) {
                return { ok: false, reason: 'Only individual tasks can have dependencies, not summary tasks.' };
            }
            if (task.dependencies.some(edge => edge.target === predecessor)) {
                return { ok: false, reason: `"${task.name}" already depends on "${predecessor.name}".` };
            }
            if (this._wouldCreateCycle(task, predecessor)) {
                return { ok: false, reason: 'That would create a circular dependency.' };
            }
            return { ok: true, reason: '' };
        }

        /**
         * Would adding the edge predecessor -> task (task depends on
         * predecessor) close a cycle? True iff `predecessor` is already
         * reachable from `task` by following existing dependency edges
         * forward (task -> ... -> predecessor already exists, so the new
         * edge would complete a loop). Reuses the successors graph
         * _resolveDependencies() already builds -- no separate traversal
         * structure to keep in sync.
         */
        _wouldCreateCycle(task, predecessor) {
            const stack = [task];
            const visited = new Set();
            while (stack.length) {
                const current = stack.pop();
                if (current === predecessor) return true;
                if (visited.has(current)) continue;
                visited.add(current);
                for (const successor of current.successors) stack.push(successor);
            }
            return false;
        }

        /**
         * Make `task` depend on `predecessor` (a plain FS link), appending
         * to task's existing [depends: ...] block or creating one. Refuses
         * -- returns false, changes nothing -- for a self-dependency, a
         * duplicate, or one that would create a cycle (see
         * canAddDependency(), which this reuses for the check).
         */
        addDependency(task, predecessor) {
            if (!this.canAddDependency(task, predecessor).ok) return false;

            this.updateLine(task, (line) => {
                const block = DEPENDS.exec(line);
                if (block) {
                    const inner = block[1].trim();
                    const newInner = inner ? inner + ', ' + predecessor.name : predecessor.name;
                    const replacement = block[0].replace(block[1], newInner);
                    return line.slice(0, block.index) + replacement + line.slice(block.index + block[0].length);
                }
                return line.replace(/\s+$/, '') + ' [depends: ' + predecessor.name + ']';
            });
            return true;
        }

        /**
         * Remove task's dependency on predecessor. Only removes an
         * explicit [depends: ...] entry -- an implicit sequential (`*`)
         * dependency isn't stored as text to remove from, so it isn't
         * handled here; the caller would need to drop the `*` prefix
         * itself (a different edit, out of this method's scope).
         */
        removeDependency(task, predecessor) {
            if (!task || !predecessor) return false;
            const edge = task.dependencies.find(d => d.target === predecessor && !d.shorthand);
            if (!edge) return false;

            this.updateLine(task, (line) => {
                const block = DEPENDS.exec(line);
                if (!block) return line;
                const specs = block[1].split(',').map(s => s.trim()).filter(Boolean);
                const remaining = specs.filter(spec => {
                    const parsed = parseDependencySpec(spec);
                    const key = parsed.rawName.toLowerCase();
                    if (key.startsWith('$')) {
                        return !(predecessor.deliverable && key.slice(1) === predecessor.deliverable.toLowerCase());
                    }
                    return key !== predecessor.name.toLowerCase();
                });
                if (remaining.length) {
                    const replacement = block[0].replace(block[1], remaining.join(', '));
                    return line.slice(0, block.index) + replacement + line.slice(block.index + block[0].length);
                }
                // No specs left: drop the whole [depends: ...] block and
                // any single trailing/leading space it leaves behind.
                const before = line.slice(0, block.index);
                const after = line.slice(block.index + block[0].length);
                if (before.endsWith(' ') && !after.startsWith(' ')) return (before.slice(0, -1) + after).replace(/\s+$/, '');
                return (before + after).replace(/\s+$/, '');
            });
            return true;
        }

        /**
         * Serialise `task` and its whole subtree as a portable, self-
         * contained fragment (#1050 "cards"): each line is `task.content`
         * (no indentText from the source plan), indented purely relative to
         * `task` itself -- `task` sits at column 0, its children at column
         * 2, and so on -- so the fragment can be re-inserted at any depth
         * in a different plan via insertCardAfter() without carrying the
         * source plan's own absolute indentation along.
         */
        cardTextFor(task) {
            if (!task) return '';
            const lines = [];
            const baseIndent = task.indent;
            const walk = node => {
                const relative = Math.max(0, node.indent - baseIndent);
                lines.push(' '.repeat(relative) + node.content);
                node.children.forEach(walk);
            };
            walk(task);
            return lines.join('\n');
        }

        /**
         * Insert a card fragment (as produced by cardTextFor(), or any
         * outline text with the shallowest line at relative indent 0) as
         * new sibling tasks starting immediately after `afterTask`, at
         * `indent` (a `task.indent` value, matching insertTaskAfter()).
         * Each line becomes its own TaskNode via insertTaskAfter(),
         * chaining each newly inserted node as the anchor for the next --
         * the same placement rule a user gets by typing the lines in one
         * at a time -- so the fragment's own internal hierarchy (however
         * deep) is reconstructed relative to `indent`, not just appended
         * flat. Blank lines in the fragment are dropped. Returns the
         * inserted nodes in document order (empty array if `cardText` had
         * no non-blank lines).
         */
        insertCardAfter(afterTask, indent, cardText) {
            const rawLines = String(cardText || '').split(/\r\n|\n|\r/).filter(line => line.trim() !== '');
            if (!rawLines.length) return [];
            const parsedLines = rawLines.map(line => {
                const indentText = (line.match(/^\s*/) || [''])[0];
                return { indent: indentText.length, content: line.slice(indentText.length) };
            });
            const minIndent = Math.min(...parsedLines.map(line => line.indent));
            const baseIndent = Math.max(0, indent);
            const inserted = [];
            let anchor = afterTask;
            for (const line of parsedLines) {
                const relative = line.indent - minIndent;
                const node = this.insertTaskAfter(anchor, baseIndent + relative, line.content);
                inserted.push(node);
                anchor = node;
            }
            return inserted;
        }

        _preferredEol() {
            const physical = [];
            this.leading.forEach(line => physical.push(line));
            const collect = t => { physical.push(t); t.trailing.forEach(l => physical.push(l)); t.children.forEach(collect); };
            this.roots.forEach(collect);
            this.suffix.forEach(line => physical.push(line));
            return physical.find(line => line.eol)?.eol || '\n';
        }

        _hasFinalLineEnding() {
            return /(?:\r\n|\n|\r)$/.test(this.serialize());
        }

        _normalisePhysicalLineEndings(hadFinalEol) {
            const physical = [];
            this.leading.forEach(line => physical.push(line));
            const collect = task => {
                physical.push(task);
                task.trailing.forEach(line => physical.push(line));
                task.children.forEach(collect);
            };
            this.roots.forEach(collect);
            this.suffix.forEach(line => physical.push(line));
            if (!physical.length) return;

            const preferred = physical.find(line => line.eol)?.eol || '\n';
            for (let index = 0; index < physical.length - 1; index++) {
                if (!physical[index].eol) physical[index].eol = preferred;
            }
            const last = physical[physical.length - 1];
            last.eol = hadFinalEol ? (last.eol || preferred) : '';
        }

        /**
         * Insert a new task as a sibling immediately after `afterTask` (or as
         * the last root task when `afterTask` is null), at the given indent
         * depth (a `task.indent` value, i.e. spaces not outline levels).
         * The counterpart writers (notepad list surface, #1049; the "+ Add
         * Task" row helpers) create tasks this way instead of splicing raw
         * text, so a freshly-typed task gets exactly the same TaskNode
         * shape -- metadata, dependants, physical-line bookkeeping -- as one
         * parsed from a file.
         */
        insertTaskAfter(afterTask, indent, name) {
            const hadFinalEol = this._hasFinalLineEnding();
            indent = Math.max(0, indent);
            const indentText = ' '.repeat(indent);
            const content = String(name || '').replace(/[\r\n]+/g, ' ').trim();
            const physical = { text: indentText + content, eol: '' };
            const node = new TaskNode(this.tasks.length, physical, indentText, content, taskMetadata(content));

            if (!afterTask) {
                node.parent = null;
                this.roots.push(node);
            } else if (indent > afterTask.indent) {
                // Deeper than the anchor: nest as its last child.
                node.parent = afterTask;
                afterTask.children.push(node);
            } else {
                // Same depth or shallower: walk up to the ancestor-or-self of
                // afterTask that sits at (or just above) the requested depth,
                // and insert as its next sibling. Descendants of that
                // ancestor live in its own nested children array rather than
                // this list, so the new node lands after its whole subtree.
                let boundary = afterTask;
                while (boundary.parent && boundary.parent.indent >= indent) boundary = boundary.parent;
                node.parent = boundary.parent;
                const list = boundary.parent ? boundary.parent.children : this.roots;
                list.splice(list.indexOf(boundary) + 1, 0, node);
            }
            this._refreshTaskOrder();
            this._normalisePhysicalLineEndings(hadFinalEol);
            this._resolveDependencies();
            return node;
        }

        /**
         * Remove a leaf task (one with no children) from the document.  Any
         * blank/comment lines trailing it are folded onto the previous
         * physical line so deleting a task never silently drops content.
         * Refuses to remove a task that has children -- callers should
         * outdent or remove those first, the same way a user would have to
         * clear a summary row's children before deleting it.
         *
         * Also used to drop a phase header left with nothing under it once
         * its last task moved elsewhere, rather than leave a dead,
         * permanently empty column on the board (#1055, #1065).
         */
        removeTask(task) {
            if (!task || task.children.length) return false;
            const list = task.parent ? task.parent.children : this.roots;
            const index = list.indexOf(task);
            if (index < 0) return false;
            const hadFinalEol = this._hasFinalLineEnding();
            const order = this.tasks;
            const position = order.indexOf(task);
            list.splice(index, 1);
            if (task.trailing.length) {
                const previous = order[position - 1];
                if (previous) previous.trailing.push(...task.trailing);
                else this.leading.push(...task.trailing);
            }
            this._refreshTaskOrder();
            this._normalisePhysicalLineEndings(hadFinalEol);
            this._resolveDependencies();
            return true;
        }

        indentTasks(tasks) {
            const selected = new Set(tasks);
            const roots = tasks.filter(task => {
                for (let parent = task.parent; parent; parent = parent.parent) if (selected.has(parent)) return false;
                return true;
            });
            for (const task of roots) this._setIndent(task, task.indent + 2);
            this._rebuildHierarchyFromIndents();
            return tasks.length > 0;
        }

        outdentTasks(tasks) {
            const selected = new Set(tasks);
            const roots = tasks.filter(task => {
                for (let parent = task.parent; parent; parent = parent.parent) if (selected.has(parent)) return false;
                return true;
            });
            for (const task of roots) this._setIndent(task, Math.max(0, task.indent - 2));
            this._rebuildHierarchyFromIndents();
            return tasks.length > 0;
        }

        _rebuildHierarchyFromIndents() {
            this.roots = [];
            const stack = [];
            for (const task of this.tasks) {
                task.children = [];
                while (stack.length && stack[stack.length - 1].indent >= task.indent) stack.pop();
                task.parent = stack.length ? stack[stack.length - 1] : null;
                (task.parent ? task.parent.children : this.roots).push(task);
                stack.push(task);
            }
            this._resolveDependencies();
        }

        // A task's `trailing` lines are blank/comment lines that happened to
        // follow it at its *old* physical position. Blank ones are purely
        // cosmetic spacing between neighbours -- carrying them along on a
        // move re-homes them next to whatever now follows the task instead,
        // which reads as a stray/misplaced blank line rather than the
        // separator it used to be (#911). Non-blank trailing lines (e.g. a
        // `//` comment) are real content and stay with the task.
        _dropTrailingBlankLines(task) {
            task.trailing = task.trailing.filter(line => line.text.trim() !== '');
        }

        // The task immediately before `task` in the current serialization
        // order, or null if `task` is first. Read this.tasks *before*
        // mutating the tree for a move's old predecessor, or after
        // _refreshTaskOrder() for its new one.
        _predecessorOf(task) {
            const index = this.tasks.indexOf(task);
            return index > 0 ? this.tasks[index - 1] : null;
        }

        // The task now immediately before `task` in serialization order (if
        // any) used to be followed by something else -- its own blank
        // trailing lines represented that old gap, not this new one, so
        // they'd otherwise land as a stray blank line right before `task`
        // at its new position (#911). Call after _refreshTaskOrder() so
        // this.tasks reflects the post-move order.
        _dropPredecessorBlankTrailing(task) {
            const predecessor = this._predecessorOf(task);
            if (predecessor) this._dropTrailingBlankLines(predecessor);
        }

        _contains(ancestor, possibleChild) {
            for (let node = possibleChild; node; node = node.parent) if (node === ancestor) return true;
            return false;
        }

        _setIndent(task, indent) {
            const difference = indent - task.indent;
            const walk = node => {
                node.indent = Math.max(0, node.indent + difference);
                node.indentText = ' '.repeat(node.indent);
                node.children.forEach(walk);
            };
            walk(task);
        }

        _refreshTaskOrder() {
            const ordered = [];
            const walk = task => { ordered.push(task); task.children.forEach(walk); };
            this.roots.forEach(walk);
            ordered.forEach((task, index) => { task.id = index; });
            this.tasks = ordered;
        }

        _serialiseContent(task) {
            let content = task.content;
            if (task._nameDirty) {
                const star = /^(\*(?:\s*[+-]\d+[dwmy])?\s*)/i.exec(content);
                const offset = star ? star[0].length : 0;
                const oldAt = content.indexOf(task.originalName, offset);
                if (oldAt >= 0) {
                    content = content.slice(0, oldAt) + task.name + content.slice(oldAt + task.originalName.length);
                }
            }
            const block = DEPENDS.exec(content);
            if (block) {
                const explicit = task.dependencies.filter(edge => !edge.shorthand);
                let changed = false;
                const values = explicit.map(edge => {
                    let name = edge.rawName;
                    if (edge.target && edge.target._nameDirty && !name.startsWith('$')) {
                        name = edge.target.name;
                        changed = true;
                    }
                    const type = edge.type && edge.type !== 'FS' ? ':' + edge.type : '';
                    return name + type + (edge.lag ? ' ' + edge.lag : '');
                });
                if (changed) {
                    const replacement = block[0].replace(block[1], values.join(', '));
                    content = content.slice(0, block.index) + replacement + content.slice(block.index + block[0].length);
                }
            }
            return content;
        }

        serialize() {
            const output = [];
            const emitPhysical = line => output.push(line.text + line.eol);
            this.leading.forEach(emitPhysical);
            const emitTask = task => {
                output.push(task.indentText + this._serialiseContent(task) + task.eol);
                task.trailing.forEach(emitPhysical);
                task.children.forEach(emitTask);
            };
            this.roots.forEach(emitTask);
            this.suffix.forEach(emitPhysical);
            return output.join('');
        }

        serialise() { return this.serialize(); }

        toMarkdown() { return this.serialize(); }

        lineNumber(task) {
            if (!task) return -1;
            const before = [];
            const walk = node => {
                if (node === task) return true;
                before.push(node);
                for (const child of node.children) if (walk(child)) return true;
                return false;
            };
            let found = false;
            for (const rootTask of this.roots) { if (walk(rootTask)) { found = true; break; } }
            if (!found) return -1;
            let lines = this.leading.reduce((sum, line) => sum + (line.eol ? 1 : 0), 0) + 1;
            for (const node of before) lines += 1 + node.trailing.reduce((sum, line) => sum + (line.eol ? 1 : 0), 0);
            return lines;
        }
    }

    function modelForEditor(editor) {
        if (!editor) return null;
        if (!editor._noodlePlanModel || editor._noodlePlanModelText !== editor.value) {
            editor._noodlePlanModel = PlanModel.parse(editor.value);
            editor._noodlePlanModelText = editor.value;
        }
        return editor._noodlePlanModel;
    }

    function commitToEditor(editor, model) {
        if (!editor || !model) return false;
        editor.value = model.serialize();
        editor._noodlePlanModel = model;
        editor._noodlePlanModelText = editor.value;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    return { PlanModel, TaskNode, modelForEditor, commitToEditor };
});
