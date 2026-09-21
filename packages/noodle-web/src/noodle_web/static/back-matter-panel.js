/**
 * back-matter-panel.js — collapsible raw-markdown panel for a plan's back
 * matter (#1203), styled and behaving like the front-matter panel (#780)
 * but sitting *below* the main plan editor textarea instead of above it.
 *
 * "Back matter" is everything from the first `---section---` marker line
 * (see NoodlePlanModel's BACK_MATTER regex) to the end of the document --
 * highlights, benefits, RAID log, comms, lessons learned, budget, and so
 * on all live in that one trailing block (`PlanModel.suffix`). Unlike front
 * matter this has no key/value schema, so the panel only ever shows the
 * raw markdown -- there is no structured mode to toggle to.
 *
 * Edits go through the SAME underlying text as `#planEditor` (via
 * NoodlePlanModel), so every existing consumer of the editor's value
 * (autosave, collab sync, undo history, exports) keeps working unchanged.
 *
 * Depends on: plan-model.js, section-folding.js (optional -- only to hide
 * the same sections in the editor above, see _syncEditorProjection)
 */
const BackMatterPanel = (function () {
    const UI_KEY = 'noodleplanner_backmatter_ui';

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

    function suffixToText(suffixLines) {
        if (!suffixLines.length) return '';
        return suffixLines.map(l => l.text).join('\n') + '\n';
    }

    function textToSuffixLines(text) {
        const lines = text.split('\n').map(t => ({ text: t, eol: '\n' }));
        if (lines.length && text.endsWith('\n')) lines.pop();
        return lines;
    }

    class BackMatterPanelInstance {
        constructor(editor, container) {
            this.editor = editor;
            this.container = container;
            this.present = false;
            this.rawText = '';
            this.commitTimer = null;
            this.pendingRawText = null;
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

        // Re-read the editor's current text and rebuild the panel. Use for
        // structural changes and whenever the document may have changed
        // outside this panel (typing in the raw textarea, switching
        // projects).
        refreshFromEditor() {
            this.uiState = this._loadState();
            const text = this.editor.value;
            const model = NoodlePlanModel.PlanModel.parse(text);
            this.present = model.suffix.length > 0;
            this.rawText = suffixToText(model.suffix);
            this.render();
            this._syncEditorProjection();
        }

        // #1278: while this panel is showing the back matter, the editor
        // above must not *also* show those sections as collapsible header
        // rows -- that duplication is what the issue reports. The front
        // matter panel does the same thing for the leading `---` block
        // (front-matter-panel.js's _syncEditorProjection).
        _syncEditorProjection() {
            if (typeof SectionFolding === 'undefined' || !SectionFolding.controllerFor) return;
            const controller = SectionFolding.controllerFor(this.editor);
            if (controller && typeof controller.setSectionsHidden === 'function') {
                controller.setSectionsHidden(this.present);
            }
        }

        get collapsed() {
            return this.uiState.collapsed === undefined ? true : !!this.uiState.collapsed;
        }

        setCollapsed(value) {
            this._saveState({ collapsed: value });
            this.render();
        }

        // Splice the raw text back into a FRESH parse of the editor's
        // current text (so concurrent edits to the task body aren't
        // clobbered), then hand the result back to the textarea exactly as
        // if the user had typed it -- every other listener on #planEditor
        // (autosave, collab sync, highlighting, undo) fires normally.
        commit(rawText) {
            const text = this.editor.value;
            const model = NoodlePlanModel.PlanModel.parse(text);
            if (!model.suffix.length) return;
            model.suffix = textToSuffixLines(typeof rawText === 'string' ? rawText : this.rawText);
            const newText = model.serialize();
            if (newText === text) return;
            const focused = document.activeElement;
            const hadFocusInPanel = focused && this.container.contains(focused);
            const selStart = hadFocusInPanel ? focused.selectionStart : null;
            const selEnd = hadFocusInPanel ? focused.selectionEnd : null;
            this.editor.value = newText;
            this.editor.dispatchEvent(new Event('input', { bubbles: true }));
            if (hadFocusInPanel && document.activeElement !== focused && this.container.contains(focused)) {
                focused.focus();
                if (selStart != null && typeof focused.setSelectionRange === 'function') {
                    focused.setSelectionRange(selStart, selEnd);
                }
            }
        }

        scheduleCommit(rawText) {
            this.pendingRawText = rawText;
            if (this.commitTimer) clearTimeout(this.commitTimer);
            this.commitTimer = setTimeout(() => {
                this.commit(this.pendingRawText);
                this.commitTimer = null;
            }, 400);
        }

        // ---- rendering ----

        render() {
            this.container.innerHTML = '';
            this.container.classList.add('fm-panel', 'bm-panel');
            if (!this.present) {
                this.container.style.display = 'none';
                return;
            }
            this.container.style.display = '';
            this.container.appendChild(this._renderHeader());
            if (!this.collapsed) {
                this.container.appendChild(this._renderRaw());
            }
        }

        _renderHeader() {
            const lineCount = this.rawText.split('\n').filter(l => l.trim()).length;
            const chevron = el('span', { className: 'fm-chevron', text: this.collapsed ? '▸' : '▾' });
            const title = el('span', { className: 'fm-title', text: 'Back Matter' });
            const badge = el('span', { className: 'fm-summary-count', text: `(${lineCount} line${lineCount === 1 ? '' : 's'})` });
            const summary = el('button', {
                className: 'fm-summary-toggle', type: 'button',
                'aria-expanded': String(!this.collapsed),
                title: this.collapsed ? 'Show the raw markdown for the back matter' : 'Hide the back matter',
                onclick: () => this.setCollapsed(!this.collapsed),
            }, [chevron, title, badge]);
            return el('div', { className: 'fm-panel-header' }, [summary]);
        }

        _renderRaw() {
            const textarea = el('textarea', {
                className: 'fm-raw-textarea bm-raw-textarea', spellcheck: 'false',
                oninput: () => this.scheduleCommit(textarea.value),
            });
            textarea.value = this.rawText;
            const wrap = el('div', { className: 'fm-raw-wrap' }, [textarea]);
            return el('div', { className: 'fm-panel-body' }, [wrap]);
        }
    }

    let instance = null;

    function init() {
        const editor = document.getElementById('planEditor');
        const container = document.getElementById('backMatterPanel');
        if (!editor || !container) return null;
        if (typeof NoodlePlanModel === 'undefined') {
            console.error('BackMatterPanel: required modules not loaded');
            return null;
        }
        instance = new BackMatterPanelInstance(editor, container);
        editor._updateBackMatterPanel = () => instance.refreshFromEditor();
        return instance;
    }

    return {
        init,
        get instance() { return instance; },
    };
})();
