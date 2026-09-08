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
            task.name = String(newName).trim();
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
            const oldList = task.parent ? task.parent.children : this.roots;
            oldList.splice(oldList.indexOf(task), 1);
            task.parent = target;
            if (afterChildren) target.children.push(task);
            else target.children.unshift(task);
            this._setIndent(task, target.indent + 2);
            this._refreshTaskOrder();
            this._resolveDependencies();
            return true;
        }

        /**
         * Insert a brand new leaf task named `name` as a child of `parent`
         * (or a new root-level task when `parent` is null), at the top or
         * bottom of that list. Used by #967's host-authoritative op
         * protocol (collab-plan-ops.js) to apply a joiner's "add task"
         * intent without hand-rolling markdown text -- everything else in
         * that protocol goes through `updateLine`/`rename`/`reorderSibling`
         * below, this is the one case none of those cover (there was
         * previously no way to grow the tree, only rearrange/edit it).
         * Returns the new TaskNode, or null if `parent` isn't a task in
         * this model.
         */
        addTask(name, parent, position) {
            if (parent && !this.tasks.includes(parent)) return null;
            const taskName = String(name == null ? '' : name).trim() || 'New Task';
            const indentText = parent ? ' '.repeat(parent.indent + 2) : '';
            const node = new TaskNode(
                this.tasks.length,
                { text: indentText + taskName, eol: '\n' },
                indentText,
                taskName,
                { name: taskName }
            );
            node.parent = parent || null;
            const list = parent ? parent.children : this.roots;
            if (position === 'top') list.unshift(node);
            else list.push(node);
            this.tasks.push(node);
            this._refreshTaskOrder();
            this._resolveDependencies();
            return node;
        }

        /**
         * Move `task` up or down by one position among its current
         * siblings (same parent, or the root list). Returns false if
         * `task` is already at that end of the list -- a no-op, not an
         * error, since #967's reorder op treats "can't move further" the
         * same as any other harmless no-op.
         */
        reorderSibling(task, direction) {
            if (!task || (direction !== 'up' && direction !== 'down')) return false;
            const siblings = task.parent ? task.parent.children : this.roots;
            const index = siblings.indexOf(task);
            if (index < 0) return false;
            const swapWith = direction === 'up' ? index - 1 : index + 1;
            if (swapWith < 0 || swapWith >= siblings.length) return false;
            siblings[index] = siblings[swapWith];
            siblings[swapWith] = task;
            this._refreshTaskOrder();
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
