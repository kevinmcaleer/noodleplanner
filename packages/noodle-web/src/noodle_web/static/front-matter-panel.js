/**
 * front-matter-panel.js — collapsible, Obsidian-style key/value editor for
 * a plan's YAML front matter. Sits above the main plan editor textarea and
 * edits the SAME underlying text (via NoodlePlanModel + NoodleFrontMatter),
 * so every existing consumer of `#planEditor`'s value (autosave, collab
 * sync, undo history, exports) keeps working unchanged -- this panel is a
 * second view onto the same source of truth, not a separate buffer.
 *
 * Depends on: plan-model.js, front-matter-model.js, project-storage.js
 */

const FrontMatterPanel = (function () {
    const UI_KEY = 'noodleplanner_frontmatter_ui';
    const COLLAPSE_LINE_THRESHOLD = 10;

    function loadUiState() {
        try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch (e) { return {}; }
    }

    function saveUiState(state) {
        try { localStorage.setItem(UI_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
    }

    function currentProjectId() {
        if (typeof getCurrentProjectId === 'function') {
            const id = getCurrentProjectId();
            if (id) return id;
        }
        return '__no_project__';
    }

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (k === 'className') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
            else if (v !== null && v !== undefined) node.setAttribute(k, v);
        }
        for (const child of children || []) {
            if (child == null) continue;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return node;
    }

    class FrontMatterPanelInstance {
        constructor(editor, container) {
            this.editor = editor;
            this.container = container;
            this.rows = [];
            this.present = false;
            this.loc = { present: false };
            this.commitTimer = null;
            this.uiState = this._loadState();
            this.refreshFromEditor();
        }

        _loadState() {
            const all = loadUiState();
            return all[currentProjectId()] || {};
        }

        _saveState(patch) {
            const all = loadUiState();
            const id = currentProjectId();
            all[id] = Object.assign({}, all[id], patch);
            saveUiState(all);
            this.uiState = all[id];
        }

        // Re-read the editor's current text and rebuild the row model +
        // the whole panel DOM. Use for structural changes and whenever the
        // document may have changed outside this panel (typing in the raw
        // textarea, switching projects).
        refreshFromEditor() {
            this.uiState = this._loadState();
            const text = this.editor.value;
            const model = NoodlePlanModel.PlanModel.parse(text);
            const parsed = NoodleFrontMatter.parseFromLeading(model.leading);
            this.present = parsed.present;
            this.rows = parsed.rows;
            this.loc = parsed.loc;
            if (this.uiState.collapsed === undefined) {
                const bodyLines = this.present ? (this.loc.footerIndex - this.loc.headerIndex - 1) : 0;
                this.collapsedDefault = bodyLines > COLLAPSE_LINE_THRESHOLD;
            }
            this.render();
        }

        get collapsed() {
            return this.uiState.collapsed === undefined ? !!this.collapsedDefault : !!this.uiState.collapsed;
        }

        get mode() {
            return this.uiState.mode === 'raw' ? 'raw' : 'structured';
        }

        setCollapsed(value) {
            this._saveState({ collapsed: value });
            this.render();
        }

        setMode(mode) {
            this._saveState({ mode });
            this.render();
        }

        // Splice the in-memory rows back into a FRESH parse of the editor's
        // current text (so concurrent edits to the task body aren't
        // clobbered), then hand the result back to the textarea exactly as
        // if the user had typed it -- every other listener on #planEditor
        // (autosave, collab sync, highlighting, undo) fires normally.
        commit() {
            const text = this.editor.value;
            const model = NoodlePlanModel.PlanModel.parse(text);
            const parsed = NoodleFrontMatter.parseFromLeading(model.leading);
            if (!parsed.present) return;
            NoodleFrontMatter.applyToLeading(model.leading, parsed.loc, this.rows);
            const newText = model.serialize();
            if (newText === text) return;
            const focused = document.activeElement;
            const hadFocusInPanel = focused && this.container.contains(focused);
            const selStart = hadFocusInPanel ? focused.selectionStart : null;
            const selEnd = hadFocusInPanel ? focused.selectionEnd : null;
            this.editor.value = newText;
            this.editor.dispatchEvent(new Event('input', { bubbles: true }));
            // Restore focus/caret into whichever of our own inputs the user
            // was typing in -- dispatching 'input' can trigger listeners
            // elsewhere that touch focus, but our own commit never rebuilds
            // this DOM node, so it's usually already fine; this is a safety
            // net for callers that do re-render around a commit.
            if (hadFocusInPanel && document.activeElement !== focused && this.container.contains(focused)) {
                focused.focus();
                if (selStart != null && typeof focused.setSelectionRange === 'function') {
                    focused.setSelectionRange(selStart, selEnd);
                }
            }
        }

        scheduleCommit() {
            if (this.commitTimer) clearTimeout(this.commitTimer);
            this.commitTimer = setTimeout(() => {
                this.commit();
                this.updateSummary();
                this.commitTimer = null;
            }, 400);
        }

        updateSummary() {
            const badge = this.container.querySelector('.fm-summary-count');
            if (badge) badge.textContent = `(${NoodleFrontMatter.countKeys(this.rows)} keys)`;
        }

        nextRowId() {
            return this.rows.length ? Math.max(...this.rows.map(r => r.id)) + 1 : 1;
        }

        // ---- structural mutations (always re-render) ----

        addKey(keyName, kind) {
            const id = this.nextRowId();
            let row;
            if (kind === 'resource-list' || kind === 'dependency-list' || kind === 'date-list') {
                row = NoodleFrontMatter.newBlockRow(id, keyName, []);
            } else {
                row = NoodleFrontMatter.newKvRow(id, keyName, '');
            }
            this.rows.push(row);
            this.commit();
            this.render();
            this._focusRow(id);
        }

        removeKey(id) {
            NoodleFrontMatter.removeRow(this.rows, id);
            this.commit();
            this.render();
        }

        moveKey(id, delta) {
            NoodleFrontMatter.moveRow(this.rows, id, delta);
            this.commit();
            this.render();
        }

        addFrontMatter() {
            // No front matter block exists yet -- create an empty one.
            const text = this.editor.value;
            const eol = /\r\n/.test(text.slice(0, 200)) ? '\r\n' : '\n';
            this.editor.value = `---${eol}---${eol}` + text;
            this.editor.dispatchEvent(new Event('input', { bubbles: true }));
            this.refreshFromEditor();
            this.setCollapsed(false);
        }

        _focusRow(id) {
            requestAnimationFrame(() => {
                const input = this.container.querySelector(`[data-row-id="${id}"] input, [data-row-id="${id}"] textarea, [data-row-id="${id}"] select`);
                if (input) input.focus();
            });
        }

        // ---- rendering ----

        render() {
            this.container.innerHTML = '';
            this.container.classList.add('fm-panel');
            if (!this.present) {
                this.container.appendChild(this._renderAbsent());
                return;
            }
            this.container.appendChild(this._renderHeader());
            if (!this.collapsed) {
                this.container.appendChild(this.mode === 'raw' ? this._renderRaw() : this._renderStructured());
            }
        }

        _renderAbsent() {
            return el('div', { className: 'fm-panel-absent' }, [
                el('span', { text: 'This plan has no front matter.' }),
                el('button', {
                    className: 'toolbar-btn fm-add-frontmatter-btn', type: 'button', text: '+ Add front matter',
                    onclick: () => this.addFrontMatter(),
                }),
            ]);
        }

        _renderHeader() {
            const count = NoodleFrontMatter.countKeys(this.rows);
            const chevron = el('span', { className: 'fm-chevron', text: this.collapsed ? '▸' : '▾' });
            const title = el('span', { className: 'fm-title', text: 'Front matter' });
            const badge = el('span', { className: 'fm-summary-count', text: `(${count} key${count === 1 ? '' : 's'})` });
            const summary = el('button', {
                className: 'fm-summary-toggle', type: 'button',
                'aria-expanded': String(!this.collapsed),
                onclick: () => this.setCollapsed(!this.collapsed),
            }, [chevron, title, badge]);

            const controls = [];
            if (!this.collapsed) {
                controls.push(this._renderModeToggle());
                if (this.mode === 'structured') controls.push(this._renderAddKeyControl());
            }
            const header = el('div', { className: 'fm-panel-header' }, [summary, el('div', { className: 'fm-panel-controls' }, controls)]);
            return header;
        }

        _renderModeToggle() {
            const structuredBtn = el('button', {
                className: 'fm-mode-btn' + (this.mode === 'structured' ? ' active' : ''), type: 'button', text: 'Structured',
                onclick: () => this.setMode('structured'),
            });
            const rawBtn = el('button', {
                className: 'fm-mode-btn' + (this.mode === 'raw' ? ' active' : ''), type: 'button', text: 'Raw',
                onclick: () => this.setMode('raw'),
            });
            return el('div', { className: 'fm-mode-toggle' }, [structuredBtn, rawBtn]);
        }

        _renderAddKeyControl() {
            const select = el('select', { className: 'fm-add-key-select' }, [
                el('option', { value: '', text: '+ Add key…' }),
                ...NoodleFrontMatter.SCHEMA
                    .filter(s => !this.rows.some(r => (r.kind === 'kv' || r.kind === 'block') && r.key === s.key))
                    .map(s => el('option', { value: s.key, text: s.label })),
                el('option', { value: '__custom__', text: 'Custom key…' }),
            ]);
            select.addEventListener('change', () => {
                const value = select.value;
                if (!value) return;
                if (value === '__custom__') {
                    const name = prompt('New key name:');
                    select.value = '';
                    if (name && name.trim()) this.addKey(name.trim(), 'text');
                    return;
                }
                const schema = NoodleFrontMatter.schemaFor(value);
                select.value = '';
                this.addKey(schema ? schema.key : value, schema ? schema.kind : 'text');
            });
            return select;
        }

        _renderRaw() {
            const bodyLines = NoodleFrontMatter.serializeRows(this.rows, '\n');
            const text = bodyLines.map(l => l.text).join('\n') + (bodyLines.length ? '\n' : '');
            const warnings = this._collectWarnings();
            const textarea = el('textarea', {
                className: 'fm-raw-textarea', spellcheck: 'false',
                oninput: () => {
                    const lines = textarea.value.split('\n').map(t => ({ text: t, eol: '\n' }));
                    if (lines.length && textarea.value.endsWith('\n')) lines.pop();
                    this.rows = NoodleFrontMatter.parseBody(lines);
                    this.scheduleCommit();
                    this._renderWarningsOnly();
                },
            });
            textarea.value = text;
            const wrap = el('div', { className: 'fm-raw-wrap' }, [textarea]);
            const warnBox = el('div', { className: 'fm-warnings' });
            this._renderWarningsInto(warnBox, warnings);
            const container = el('div', { className: 'fm-panel-body' }, [warnBox, wrap]);
            return container;
        }

        _renderWarningsOnly() {
            const warnBox = this.container.querySelector('.fm-warnings');
            if (warnBox) this._renderWarningsInto(warnBox, this._collectWarnings());
        }

        _collectWarnings() {
            return this.rows
                .filter(r => r.kind === 'raw' && r.raw[0].text.trim() !== '')
                .map(r => `Line not recognised as "key: value" and left as-is: ${r.raw[0].text}`);
        }

        _renderWarningsInto(box, warnings) {
            box.innerHTML = '';
            if (!warnings.length) return;
            box.appendChild(el('div', { className: 'fm-warning-title', text: '⚠ Some lines could not be parsed as front matter and were preserved untouched, not dropped:' }));
            for (const w of warnings) box.appendChild(el('div', { className: 'fm-warning-line', text: w }));
        }

        _renderStructured() {
            const list = el('div', { className: 'fm-row-list' });
            const editable = this.rows.filter(r => r.kind === 'kv' || r.kind === 'block');
            editable.forEach((row, idx) => {
                list.appendChild(this._renderRow(row, idx === 0, idx === editable.length - 1));
            });
            if (!editable.length) {
                list.appendChild(el('div', { className: 'fm-empty-hint', text: 'No keys yet — use "Add key" above.' }));
            }
            const warnings = this._collectWarnings();
            const warnBox = el('div', { className: 'fm-warnings' });
            this._renderWarningsInto(warnBox, warnings);
            return el('div', { className: 'fm-panel-body' }, [warnBox, list]);
        }

        _renderRow(row, isFirst, isLast) {
            const schema = NoodleFrontMatter.schemaFor(row.key);
            const reorder = el('div', { className: 'fm-row-reorder' }, [
                el('button', { className: 'fm-row-btn fm-row-move-up', type: 'button', text: '▲', disabled: isFirst ? '' : null, title: 'Move up', onclick: () => this.moveKey(row.id, -1) }),
                el('button', { className: 'fm-row-btn fm-row-move-down', type: 'button', text: '▼', disabled: isLast ? '' : null, title: 'Move down', onclick: () => this.moveKey(row.id, 1) }),
            ]);
            const keyLabel = schema
                ? el('span', { className: 'fm-row-key', text: schema.label, title: schema.description || '' })
                : this._renderEditableKey(row);
            const widget = this._renderWidget(row, schema);
            const remove = el('button', { className: 'fm-row-btn fm-row-remove', type: 'button', text: '🗑️', title: 'Remove key', onclick: () => this.removeKey(row.id) });
            const rowEl = el('div', { className: 'fm-row', 'data-row-id': String(row.id) }, [reorder, keyLabel, widget, remove]);
            if (schema && schema.description) rowEl.title = schema.description;
            return rowEl;
        }

        _renderEditableKey(row) {
            const input = el('input', { type: 'text', className: 'fm-row-key fm-row-key-input', value: row.displayKey || row.key });
            input.value = row.displayKey || row.key;
            input.addEventListener('change', () => {
                const value = input.value.trim();
                if (!value) { input.value = row.displayKey || row.key; return; }
                row.displayKey = value;
                row.rawKey = value;
                row.key = value.toLowerCase();
                if (row.kind === 'kv') NoodleFrontMatter.markDirty(row); else row.dirty = true;
                this.scheduleCommit();
                this.updateSummary();
            });
            return input;
        }

        _renderWidget(row, schema) {
            const kind = schema ? schema.kind : (row.kind === 'block' ? 'block-raw' : 'text');
            if (row.kind === 'kv' && kind === 'select') return this._renderSelectWidget(row, schema);
            if (row.kind === 'kv' && kind === 'flow-list') return this._renderFlowListWidget(row);
            if (row.kind === 'kv') return this._renderTextWidget(row);
            if (row.kind === 'block' && NoodleFrontMatter.LIST_KINDS[kind]) return this._renderListWidget(row, NoodleFrontMatter.LIST_KINDS[kind], kind);
            return this._renderBlockRawWidget(row);
        }

        _renderTextWidget(row) {
            const input = el('input', { type: 'text', className: 'fm-value-input' });
            input.value = row.value;
            input.addEventListener('input', () => {
                NoodleFrontMatter.setScalarValue(row, input.value);
                this.scheduleCommit();
            });
            return input;
        }

        _renderSelectWidget(row, schema) {
            const options = schema.options.slice();
            if (row.value && !options.includes(row.value)) options.push(row.value);
            const select = el('select', { className: 'fm-value-select' }, [
                el('option', { value: '', text: '(none)' }),
                ...options.map(o => el('option', { value: o, text: o })),
            ]);
            select.value = row.value || '';
            select.addEventListener('change', () => {
                NoodleFrontMatter.setScalarValue(row, select.value);
                this.commit();
                this.updateSummary();
            });
            return select;
        }

        _renderFlowListWidget(row) {
            const items = NoodleFrontMatter.FlowList.parse(row.value);
            const wrap = el('div', { className: 'fm-tag-list' });
            const renderTags = () => {
                wrap.innerHTML = '';
                items.forEach((item, i) => {
                    wrap.appendChild(el('span', { className: 'fm-tag' }, [
                        item,
                        el('button', {
                            className: 'fm-tag-remove', type: 'button', text: '×', title: 'Remove',
                            onclick: () => { items.splice(i, 1); commitTags(); renderTags(); },
                        }),
                    ]));
                });
                const input = el('input', { type: 'text', className: 'fm-tag-input', placeholder: 'Add label…' });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        const value = input.value.trim();
                        if (value) { items.push(value); commitTags(); renderTags(); }
                        input.value = '';
                    }
                });
                input.addEventListener('blur', () => {
                    const value = input.value.trim();
                    if (value) { items.push(value); commitTags(); renderTags(); input.value = ''; }
                });
                wrap.appendChild(input);
            };
            const commitTags = () => {
                NoodleFrontMatter.setScalarValue(row, NoodleFrontMatter.FlowList.serialize(items));
                this.scheduleCommit();
            };
            renderTags();
            return wrap;
        }

        _renderListWidget(row, listKind, kindName) {
            const sourceLines = (row.dirty && row.childTexts) ? this._childTextsAsLines(row) : row.children;
            const entries = listKind.parse(sourceLines);
            const wrap = el('div', { className: 'fm-list-widget' });
            const fields = kindName === 'resource-list' ? ['shortName', 'description']
                : kindName === 'dependency-list' ? ['from', 'task', 'to_task', 'type', 'lag']
                : ['name', 'start', 'finish'];
            const labels = kindName === 'resource-list' ? { shortName: '@shortname', description: 'Description' }
                : kindName === 'dependency-list' ? { from: 'From project', task: 'Source task', to_task: 'This task', type: 'Type', lag: 'Lag (days)' }
                : { name: 'Name', start: 'Start (YYYY-MM-DD)', finish: 'Finish (optional)' };

            const commitEntries = () => {
                NoodleFrontMatter.setBlockChildTexts(row, listKind.serialize(entries));
                this.scheduleCommit();
                this.updateSummary();
            };

            const renderEntries = () => {
                wrap.innerHTML = '';
                entries.forEach((entry, idx) => {
                    const entryEl = el('div', { className: 'fm-list-entry' });
                    fields.forEach(f => {
                        const input = el('input', { type: 'text', className: 'fm-list-field', placeholder: labels[f] });
                        input.value = entry[f] == null ? '' : entry[f];
                        input.addEventListener('input', () => { entry[f] = input.value; commitEntries(); });
                        entryEl.appendChild(input);
                    });
                    entryEl.appendChild(el('button', {
                        className: 'fm-row-btn fm-row-remove', type: 'button', text: '🗑️', title: 'Remove entry',
                        onclick: () => { entries.splice(idx, 1); commitEntries(); renderEntries(); },
                    }));
                    wrap.appendChild(entryEl);
                });
                wrap.appendChild(el('button', {
                    className: 'toolbar-btn fm-add-entry-btn', type: 'button', text: '+ Add entry',
                    onclick: () => {
                        const blank = {};
                        fields.forEach(f => { blank[f] = f === 'type' ? 'FS' : (f === 'lag' ? 0 : ''); });
                        entries.push(blank);
                        commitEntries();
                        renderEntries();
                    },
                }));
            };
            renderEntries();
            return wrap;
        }

        _childTextsAsLines(row) {
            return (row.childTexts || []).map(t => ({ text: t, eol: '\n' }));
        }

        _renderBlockRawWidget(row) {
            const textarea = el('textarea', { className: 'fm-block-raw-textarea', spellcheck: 'false' });
            textarea.value = (row.childTexts || row.children.map(c => c.text)).join('\n');
            textarea.addEventListener('input', () => {
                NoodleFrontMatter.setBlockChildTexts(row, textarea.value.split('\n'));
                this.scheduleCommit();
            });
            return textarea;
        }
    }

    let instance = null;

    function init() {
        const editor = document.getElementById('planEditor');
        const container = document.getElementById('frontMatterPanel');
        if (!editor || !container) return null;
        if (typeof NoodleFrontMatter === 'undefined' || typeof NoodlePlanModel === 'undefined') {
            console.error('FrontMatterPanel: required modules not loaded');
            return null;
        }
        instance = new FrontMatterPanelInstance(editor, container);
        editor._updateFrontMatterPanel = () => instance.refreshFromEditor();
        return instance;
    }

    return {
        init,
        get instance() { return instance; },
    };
})();
