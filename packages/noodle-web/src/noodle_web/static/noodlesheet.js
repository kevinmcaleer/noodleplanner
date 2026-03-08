/**
 * NoodleSheet - A reusable spreadsheet component with markdown storage and DBML schema.
 *
 * Usage:
 *   const sheet = new NoodleSheet(containerEl, {
 *     sheets: [{ name: 'Budget', dbml: '...', markdown: '...' }],
 *     onChange: (sheetIndex, markdown) => { ... }
 *   });
 */

class NoodleSheet {
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.getElementById(container)
            : container;
        this.options = options;
        this.sheets = [];
        this.activeSheetIndex = 0;
        this.selection = { row: -1, col: -1 };
        this.selectionEnd = null; // for range selection: { row, col }
        this.editing = false;
        this.editCell = null;
        this.sortColumn = -1;
        this.sortAsc = true;
        this.sortedIndices = null; // maps display index to data index
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndo = 50;
        this.showTotals = options.showTotals !== false;
        this._resizing = null;

        if (options.sheets) {
            options.sheets.forEach(s => this.addSheet(s.name, s.dbml, s.markdown));
        }

        this.render();

        if (this.sheets.length > 0) {
            this.activateSheet(0);
        }
    }

    // ── DBML Parsing ──────────────────────────────────────────────────

    static parseDbml(dbml) {
        const columns = [];
        const tableMatch = dbml.match(/Table\s+(\w+)\s*\{([^}]*)\}/s);
        if (!tableMatch) return { tableName: '', columns };

        const tableName = tableMatch[1];
        const body = tableMatch[2];
        const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));

        for (const line of lines) {
            const match = line.match(/^(\w+)\s+(text|number|date|enum)\s*(?:\(([^)]*)\))?\s*(?:\[([^\]]*)\])?/i);
            if (!match) continue;

            const name = match[1];
            const type = match[2].toLowerCase();
            const enumValues = match[3]
                ? match[3].split(',').map(v => v.trim().replace(/^['"]|['"]$/g, ''))
                : [];

            // Parse annotations like [format: currency, min: 0, max: 100]
            const annotations = {};
            if (match[4]) {
                match[4].split(',').forEach(pair => {
                    const [key, ...valParts] = pair.split(':');
                    if (key && valParts.length > 0) {
                        annotations[key.trim().toLowerCase()] = valParts.join(':').trim().replace(/^['"]|['"]$/g, '');
                    }
                });
            }

            columns.push({
                name,
                displayName: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                type,
                enumValues,
                format: annotations.format || null,
                min: annotations.min !== undefined ? parseFloat(annotations.min) : null,
                max: annotations.max !== undefined ? parseFloat(annotations.max) : null,
                width: type === 'date' ? 120 : type === 'number' ? 100 : 150
            });
        }

        return { tableName, columns };
    }

    // ── Markdown Parsing ──────────────────────────────────────────────

    static parseMarkdown(markdown, columns) {
        const rows = [];
        if (!markdown || !markdown.trim()) return rows;

        const lines = markdown.split('\n').filter(l => l.trim());
        if (lines.length < 2) return rows;

        // First line is header, second is separator
        const headerCells = NoodleSheet.parseMdRow(lines[0]);
        const colMap = {};
        headerCells.forEach((h, i) => {
            const normalized = h.trim().toLowerCase().replace(/\s+/g, '_');
            colMap[normalized] = i;
        });

        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.match(/^\|[\s-|]+\|$/)) continue;

            const cells = NoodleSheet.parseMdRow(line);
            const row = {};

            columns.forEach(col => {
                const idx = colMap[col.name.toLowerCase()];
                const val = idx !== undefined && idx < cells.length ? cells[idx].trim() : '';
                row[col.name] = val;
            });

            rows.push(row);
        }

        return rows;
    }

    static parseMdRow(line) {
        let trimmed = line.trim();
        if (trimmed.startsWith('|')) trimmed = trimmed.substring(1);
        if (trimmed.endsWith('|')) trimmed = trimmed.substring(0, trimmed.length - 1);
        return trimmed.split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());
    }

    // ── Markdown Generation ───────────────────────────────────────────

    static generateMarkdown(columns, rows) {
        if (columns.length === 0) return '';

        const headers = columns.map(c => c.displayName);
        const dataRows = rows.map(r =>
            columns.map(c => {
                const val = r[c.name] !== undefined ? String(r[c.name]) : '';
                return val.replace(/\|/g, '\\|');
            })
        );

        // Calculate column widths
        const widths = headers.map((h, i) => {
            let max = h.length;
            dataRows.forEach(r => { if (r[i].length > max) max = r[i].length; });
            return Math.max(max, 3);
        });

        const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));

        const headerLine = '| ' + headers.map((h, i) => pad(h, widths[i])).join(' | ') + ' |';
        const sepLine = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
        const bodyLines = dataRows.map(r =>
            '| ' + r.map((cell, i) => pad(cell, widths[i])).join(' | ') + ' |'
        );

        return [headerLine, sepLine, ...bodyLines].join('\n');
    }

    // ── Formula Engine ────────────────────────────────────────────────

    evaluateFormula(formula, sheetData) {
        if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
            return formula;
        }

        const expr = formula.substring(1).trim().toUpperCase();
        const sheet = sheetData || this.getActiveSheet();

        try {
            return this._evalExpression(expr, sheet);
        } catch {
            return '#ERR';
        }
    }

    _evalExpression(expr, sheet) {
        // Handle IF(condition, true_val, false_val)
        const ifMatch = expr.match(/^IF\((.+),(.+),(.+)\)$/);
        if (ifMatch) {
            const condition = this._evalCondition(ifMatch[1].trim(), sheet);
            const trueExpr = ifMatch[2].trim();
            const falseExpr = ifMatch[3].trim();
            return condition
                ? this._evalExpression(trueExpr, sheet)
                : this._evalExpression(falseExpr, sheet);
        }

        // Handle aggregate functions
        const funcMatch = expr.match(/^(SUM|COUNT|AVERAGE|MIN|MAX)\((.+)\)$/);
        if (funcMatch) {
            const func = funcMatch[1];
            const rangeValues = this._resolveRange(funcMatch[2], sheet);
            const nums = rangeValues.map(v => parseFloat(v)).filter(n => !isNaN(n));

            switch (func) {
                case 'SUM': return nums.reduce((a, b) => a + b, 0);
                case 'COUNT': return rangeValues.filter(v => v !== '' && v !== undefined).length;
                case 'AVERAGE': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
                case 'MIN': return nums.length ? Math.min(...nums) : 0;
                case 'MAX': return nums.length ? Math.max(...nums) : 0;
            }
        }

        // Basic arithmetic with cell references
        let resolved = expr.replace(/[A-Z]+\d+/g, ref => {
            const val = this._getCellValue(ref, sheet);
            const num = parseFloat(val);
            return isNaN(num) ? '0' : String(num);
        });

        // Only allow safe arithmetic characters
        if (/^[\d\s+\-*/().]+$/.test(resolved)) {
            return Function('"use strict"; return (' + resolved + ')')();
        }

        return '#ERR';
    }

    _evalCondition(condExpr, sheet) {
        // Support simple comparisons: A1>100, A1=B1, A1<>0
        const compMatch = condExpr.match(/^(.+?)\s*(>=|<=|<>|!=|>|<|=)\s*(.+)$/);
        if (!compMatch) return false;

        let left = compMatch[1].trim();
        const op = compMatch[2];
        let right = compMatch[3].trim();

        // Resolve cell references
        if (/^[A-Z]+\d+$/.test(left)) left = String(this._getCellValue(left, sheet));
        if (/^[A-Z]+\d+$/.test(right)) right = String(this._getCellValue(right, sheet));

        const lNum = parseFloat(left);
        const rNum = parseFloat(right);
        const useNum = !isNaN(lNum) && !isNaN(rNum);

        switch (op) {
            case '>': return useNum ? lNum > rNum : left > right;
            case '<': return useNum ? lNum < rNum : left < right;
            case '>=': return useNum ? lNum >= rNum : left >= right;
            case '<=': return useNum ? lNum <= rNum : left <= right;
            case '=': return useNum ? lNum === rNum : left === right;
            case '<>': case '!=': return useNum ? lNum !== rNum : left !== right;
            default: return false;
        }
    }

    _resolveRange(rangeExpr, sheet) {
        // Single range like A1:A10
        const rangeMatch = rangeExpr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
        if (!rangeMatch) {
            // Single cell reference
            return [this._getCellValue(rangeExpr.trim(), sheet)];
        }

        const col1 = this._colNameToIndex(rangeMatch[1]);
        const row1 = parseInt(rangeMatch[2]) - 1;
        const col2 = this._colNameToIndex(rangeMatch[3]);
        const row2 = parseInt(rangeMatch[4]) - 1;

        const values = [];
        for (let r = Math.min(row1, row2); r <= Math.max(row1, row2); r++) {
            for (let c = Math.min(col1, col2); c <= Math.max(col1, col2); c++) {
                if (r < sheet.rows.length && c < sheet.columns.length) {
                    const colName = sheet.columns[c].name;
                    values.push(sheet.rows[r][colName] || '');
                }
            }
        }
        return values;
    }

    _getCellValue(ref, sheet) {
        const match = ref.match(/^([A-Z]+)(\d+)$/);
        if (!match) return '';
        const col = this._colNameToIndex(match[1]);
        const row = parseInt(match[2]) - 1;
        if (row < 0 || row >= sheet.rows.length || col < 0 || col >= sheet.columns.length) return '';
        const val = sheet.rows[row][sheet.columns[col].name] || '';
        // Recursively evaluate if it's a formula
        if (typeof val === 'string' && val.startsWith('=')) {
            return this.evaluateFormula(val, sheet);
        }
        return val;
    }

    _colNameToIndex(name) {
        let idx = 0;
        for (let i = 0; i < name.length; i++) {
            idx = idx * 26 + (name.charCodeAt(i) - 64);
        }
        return idx - 1;
    }

    _indexToColName(idx) {
        let name = '';
        idx++;
        while (idx > 0) {
            idx--;
            name = String.fromCharCode(65 + (idx % 26)) + name;
            idx = Math.floor(idx / 26);
        }
        return name;
    }

    // ── Sheet Management ──────────────────────────────────────────────

    addSheet(name, dbml, markdown) {
        const schema = NoodleSheet.parseDbml(dbml);
        const rows = NoodleSheet.parseMarkdown(markdown || '', schema.columns);

        this.sheets.push({
            name: name || schema.tableName || 'Sheet ' + (this.sheets.length + 1),
            dbml,
            columns: schema.columns,
            tableName: schema.tableName,
            rows
        });
    }

    getActiveSheet() {
        return this.sheets[this.activeSheetIndex] || null;
    }

    activateSheet(index) {
        if (index < 0 || index >= this.sheets.length) return;
        this.activeSheetIndex = index;
        this.selection = { row: -1, col: -1 };
        this.editing = false;
        this.renderGrid();
        this.renderTabs();
        this.renderFormulaBar();
    }

    // ── Undo/Redo ──────────────────────────────────────────────────────

    _saveSnapshot() {
        const sheet = this.getActiveSheet();
        if (!sheet) return;
        const snapshot = JSON.stringify(sheet.rows);
        // Avoid duplicate consecutive snapshots
        if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) return;
        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
        this.redoStack = [];
    }

    undo() {
        const sheet = this.getActiveSheet();
        if (!sheet || this.undoStack.length === 0) return;
        this.redoStack.push(JSON.stringify(sheet.rows));
        sheet.rows = JSON.parse(this.undoStack.pop());
        this.renderGrid();
        this.renderFormulaBar();
        this._fireChange();
    }

    redo() {
        const sheet = this.getActiveSheet();
        if (!sheet || this.redoStack.length === 0) return;
        this.undoStack.push(JSON.stringify(sheet.rows));
        sheet.rows = JSON.parse(this.redoStack.pop());
        this.renderGrid();
        this.renderFormulaBar();
        this._fireChange();
    }

    // ── Data Operations ───────────────────────────────────────────────

    addRow(data) {
        const sheet = this.getActiveSheet();
        if (!sheet) return;
        this._saveSnapshot();
        const row = {};
        sheet.columns.forEach(c => { row[c.name] = (data && data[c.name]) || ''; });
        sheet.rows.push(row);
        this.renderGrid();
        this._fireChange();
    }

    deleteRow(rowIndex) {
        const sheet = this.getActiveSheet();
        if (!sheet || rowIndex < 0 || rowIndex >= sheet.rows.length) return;
        this._saveSnapshot();
        sheet.rows.splice(rowIndex, 1);
        if (this.selection.row >= sheet.rows.length) {
            this.selection.row = sheet.rows.length - 1;
        }
        this.renderGrid();
        this._fireChange();
    }

    setCellValue(row, col, value) {
        const sheet = this.getActiveSheet();
        if (!sheet || row < 0 || row >= sheet.rows.length) return;
        if (col < 0 || col >= sheet.columns.length) return;
        this._saveSnapshot();
        sheet.rows[row][sheet.columns[col].name] = value;
        this.renderGrid();
        this._fireChange();
    }

    getMarkdown(sheetIndex) {
        const idx = sheetIndex !== undefined ? sheetIndex : this.activeSheetIndex;
        const sheet = this.sheets[idx];
        if (!sheet) return '';
        return NoodleSheet.generateMarkdown(sheet.columns, sheet.rows);
    }

    loadMarkdown(markdown, sheetIndex) {
        const idx = sheetIndex !== undefined ? sheetIndex : this.activeSheetIndex;
        const sheet = this.sheets[idx];
        if (!sheet) return;
        sheet.rows = NoodleSheet.parseMarkdown(markdown, sheet.columns);
        this.renderGrid();
    }

    // ── Rendering ─────────────────────────────────────────────────────

    render() {
        this.container.innerHTML = '';
        this.container.classList.add('noodlesheet');

        // Toolbar
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'ns-toolbar';
        this.toolbar.innerHTML = `
            <button class="ns-toolbar-btn" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo">&#x21A9;</button>
            <button class="ns-toolbar-btn" data-action="redo" title="Redo (Ctrl+Y)" aria-label="Redo">&#x21AA;</button>
            <span class="ns-toolbar-sep"></span>
            <button class="ns-toolbar-btn" data-action="add-row" title="Add row" aria-label="Add row">+ Row</button>
            <button class="ns-toolbar-btn" data-action="delete-row" title="Delete selected row" aria-label="Delete row">- Row</button>
            <span class="ns-toolbar-sep"></span>
            <button class="ns-toolbar-btn" data-action="copy" title="Copy table to clipboard" aria-label="Copy table">Copy</button>
            <button class="ns-toolbar-btn" data-action="paste" title="Paste from clipboard (Ctrl+V)" aria-label="Paste">Paste</button>
            <span class="ns-toolbar-sep"></span>
            <button class="ns-toolbar-btn" data-action="find" title="Find & Replace (Ctrl+F)" aria-label="Find and Replace">Find</button>
            <span class="ns-toolbar-sep"></span>
            <button class="ns-toolbar-btn" data-action="export-csv" title="Export as CSV" aria-label="Export CSV">CSV</button>
        `;
        this.toolbar.addEventListener('click', e => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'add-row') this.addRow();
            else if (action === 'delete-row' && this.selection.row >= 0) this.deleteRow(this.selection.row);
            else if (action === 'copy') this._copyToClipboard();
            else if (action === 'paste') this._pasteFromClipboard();
            else if (action === 'undo') this.undo();
            else if (action === 'redo') this.redo();
            else if (action === 'find') this._toggleFindBar();
            else if (action === 'export-csv') this.exportCsv();
        });
        this.container.appendChild(this.toolbar);

        // Find bar (hidden by default)
        this.findBar = document.createElement('div');
        this.findBar.className = 'ns-find-bar';
        this.findBar.style.display = 'none';
        this.findBar.innerHTML = `
            <input type="text" class="ns-find-input" placeholder="Find..." aria-label="Find text">
            <input type="text" class="ns-replace-input" placeholder="Replace..." aria-label="Replace text">
            <button class="ns-toolbar-btn ns-find-btn" data-find="prev" title="Previous" aria-label="Find previous">&#x25B2;</button>
            <button class="ns-toolbar-btn ns-find-btn" data-find="next" title="Next" aria-label="Find next">&#x25BC;</button>
            <button class="ns-toolbar-btn ns-find-btn" data-find="replace" title="Replace" aria-label="Replace">Replace</button>
            <button class="ns-toolbar-btn ns-find-btn" data-find="replace-all" title="Replace All" aria-label="Replace all">All</button>
            <span class="ns-find-count"></span>
            <button class="ns-toolbar-btn ns-find-btn" data-find="close" title="Close" aria-label="Close find bar">&#x2715;</button>
        `;
        this.container.appendChild(this.findBar);

        this.findInput = this.findBar.querySelector('.ns-find-input');
        this.replaceInput = this.findBar.querySelector('.ns-replace-input');
        this.findCountEl = this.findBar.querySelector('.ns-find-count');
        this._findMatches = [];
        this._findMatchIndex = -1;

        this.findInput.addEventListener('input', () => this._findAll());
        this.findInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); this._findNext(); }
            if (e.key === 'Escape') { e.preventDefault(); this._closeFindBar(); }
        });
        this.replaceInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); this._replaceOne(); }
            if (e.key === 'Escape') { e.preventDefault(); this._closeFindBar(); }
        });
        this.findBar.addEventListener('click', e => {
            const btn = e.target.closest('[data-find]');
            if (!btn) return;
            const action = btn.dataset.find;
            if (action === 'next') this._findNext();
            else if (action === 'prev') this._findPrev();
            else if (action === 'replace') this._replaceOne();
            else if (action === 'replace-all') this._replaceAll();
            else if (action === 'close') this._closeFindBar();
        });

        // Formula bar
        this.formulaBar = document.createElement('div');
        this.formulaBar.className = 'ns-formula-bar';
        this.formulaBar.innerHTML = `
            <span class="ns-cell-ref" aria-label="Cell reference"></span>
            <span class="ns-fx-label">fx</span>
            <input type="text" class="ns-formula-input" aria-label="Formula input" placeholder="Enter value or formula (e.g. =SUM(A1:A10))">
        `;
        this.container.appendChild(this.formulaBar);

        this.formulaInput = this.formulaBar.querySelector('.ns-formula-input');
        this.cellRefDisplay = this.formulaBar.querySelector('.ns-cell-ref');

        this.formulaInput.addEventListener('keydown', e => this._onFormulaKeydown(e));
        this.formulaInput.addEventListener('blur', () => this._commitFormulaEdit());

        // Grid container
        this.gridContainer = document.createElement('div');
        this.gridContainer.className = 'ns-grid-container';
        this.gridContainer.setAttribute('tabindex', '0');
        this.gridContainer.setAttribute('role', 'grid');
        this.gridContainer.setAttribute('aria-label', 'Spreadsheet');
        this.container.appendChild(this.gridContainer);

        this.gridContainer.addEventListener('keydown', e => this._onGridKeydown(e));
        this.gridContainer.addEventListener('contextmenu', e => this._onContextMenu(e));

        // Context menu
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'ns-context-menu';
        this.contextMenu.style.display = 'none';
        this.contextMenu.setAttribute('role', 'menu');
        document.body.appendChild(this.contextMenu);
        document.addEventListener('click', () => this._hideContextMenu());

        // Tab bar
        this.tabBar = document.createElement('div');
        this.tabBar.className = 'ns-tab-bar';
        this.container.appendChild(this.tabBar);
    }

    renderFormulaBar() {
        const sheet = this.getActiveSheet();
        if (this.selection.row >= 0 && this.selection.col >= 0 && sheet) {
            const colName = this._indexToColName(this.selection.col);
            this.cellRefDisplay.textContent = colName + (this.selection.row + 1);
            const val = sheet.rows[this.selection.row]?.[sheet.columns[this.selection.col]?.name] || '';
            this.formulaInput.value = val;
        } else {
            this.cellRefDisplay.textContent = '';
            this.formulaInput.value = '';
        }
    }

    renderGrid() {
        const sheet = this.getActiveSheet();
        if (!sheet) {
            this.gridContainer.innerHTML = '<div class="ns-empty">No sheet selected</div>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'ns-table';
        table.setAttribute('role', 'grid');

        // Header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        // Row number header (corner cell)
        const cornerTh = document.createElement('th');
        cornerTh.className = 'ns-corner';
        cornerTh.setAttribute('aria-label', 'Row number column');
        headerRow.appendChild(cornerTh);

        // Column letter headers
        sheet.columns.forEach((col, i) => {
            const th = document.createElement('th');
            th.className = 'ns-col-header';
            th.setAttribute('scope', 'col');
            if (col.width) {
                th.style.width = col.width + 'px';
                th.style.minWidth = col.width + 'px';
                th.style.maxWidth = col.width + 'px';
            }

            const letterSpan = document.createElement('div');
            letterSpan.className = 'ns-col-letter';
            letterSpan.textContent = this._indexToColName(i);

            const nameSpan = document.createElement('div');
            nameSpan.className = 'ns-col-name';
            nameSpan.textContent = col.displayName;
            nameSpan.title = col.displayName;

            // Sort indicator
            if (this.sortColumn === i) {
                const sortSpan = document.createElement('span');
                sortSpan.className = 'ns-sort-indicator';
                sortSpan.textContent = this.sortAsc ? ' \u25B2' : ' \u25BC';
                nameSpan.appendChild(sortSpan);
            }

            th.appendChild(letterSpan);
            th.appendChild(nameSpan);

            // Click to sort
            th.addEventListener('click', (e) => {
                if (!e.target.closest('.ns-resize-handle')) {
                    this.sortByColumn(i);
                }
            });
            th.style.cursor = 'pointer';

            // Resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'ns-resize-handle';
            resizeHandle.addEventListener('mousedown', (e) => this._initResize(e, i));
            resizeHandle.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this._autoFitColumn(i);
            });
            th.appendChild(resizeHandle);

            if (this._isCellInSelection(-1, i) || this.selection.col === i) {
                th.classList.add('ns-selected-col');
            }
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body rows
        const tbody = document.createElement('tbody');
        const displayRows = sheet.rows.length || 1;

        for (let r = 0; r < displayRows; r++) {
            const tr = document.createElement('tr');

            // Row number
            const rowNumTd = document.createElement('td');
            rowNumTd.className = 'ns-row-num';
            rowNumTd.textContent = r + 1;
            if (this.selection.row === r) rowNumTd.classList.add('ns-selected-row');
            tr.appendChild(rowNumTd);

            // Data cells
            sheet.columns.forEach((col, c) => {
                const td = document.createElement('td');
                td.className = 'ns-cell';
                td.dataset.row = r;
                td.dataset.col = c;
                td.setAttribute('role', 'gridcell');

                if (r < sheet.rows.length) {
                    const rawVal = sheet.rows[r][col.name] || '';
                    if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
                        const computed = this.evaluateFormula(rawVal, sheet);
                        td.textContent = typeof computed === 'number'
                            ? this._formatNumber(computed, col.type, col.format)
                            : computed;
                        td.classList.add('ns-formula-cell');
                        td.title = rawVal;
                    } else {
                        td.textContent = col.type === 'number' && rawVal !== ''
                            ? this._formatNumber(parseFloat(rawVal), col.type, col.format)
                            : rawVal;
                    }

                    if (col.type === 'number') td.classList.add('ns-num');

                    // Conditional formatting for numbers with min/max
                    if (col.type === 'number' && rawVal !== '') {
                        const numVal = parseFloat(rawVal);
                        if (!isNaN(numVal)) {
                            if (col.min !== null && numVal < col.min) td.classList.add('ns-val-low');
                            if (col.max !== null && numVal > col.max) td.classList.add('ns-val-high');
                        }
                    }

                    // Find match highlighting
                    if (this._isFindMatch(r, c)) {
                        td.classList.add('ns-find-match');
                    }
                }

                if (this.selection.row === r && this.selection.col === c) {
                    td.classList.add('ns-selected');
                }
                if (this._isCellInSelection(r, c) && !(this.selection.row === r && this.selection.col === c)) {
                    td.classList.add('ns-in-range');
                }

                td.addEventListener('mousedown', e => {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this._extendSelection(r, c);
                    } else {
                        this._selectCell(r, c);
                    }
                });
                td.addEventListener('dblclick', () => this._startEdit(r, c));

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        }

        // Add empty rows for minimum display
        const minRows = 10;
        for (let r = displayRows; r < minRows; r++) {
            const tr = document.createElement('tr');
            const rowNumTd = document.createElement('td');
            rowNumTd.className = 'ns-row-num';
            rowNumTd.textContent = r + 1;
            tr.appendChild(rowNumTd);

            sheet.columns.forEach((_, c) => {
                const td = document.createElement('td');
                td.className = 'ns-cell ns-empty-cell';
                td.dataset.row = r;
                td.dataset.col = c;
                td.setAttribute('role', 'gridcell');
                td.addEventListener('mousedown', e => {
                    e.preventDefault();
                    this._selectCell(r, c);
                });
                td.addEventListener('dblclick', () => {
                    // Auto-add rows if editing beyond current data
                    const sheet = this.getActiveSheet();
                    while (sheet.rows.length <= r) {
                        const newRow = {};
                        sheet.columns.forEach(col => { newRow[col.name] = ''; });
                        sheet.rows.push(newRow);
                    }
                    this.renderGrid();
                    this._startEdit(r, c);
                });
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }

        table.appendChild(tbody);

        // Totals row
        if (this.showTotals && sheet.rows.length > 0) {
            const hasNumberCol = sheet.columns.some(c => c.type === 'number');
            if (hasNumberCol) {
                const tfoot = document.createElement('tfoot');
                const footRow = document.createElement('tr');
                footRow.className = 'ns-totals-row';

                const footLabel = document.createElement('td');
                footLabel.className = 'ns-row-num ns-totals-label';
                footLabel.textContent = '\u03A3';
                footLabel.title = 'Totals';
                footRow.appendChild(footLabel);

                sheet.columns.forEach(col => {
                    const td = document.createElement('td');
                    td.className = 'ns-cell ns-totals-cell';
                    if (col.type === 'number') {
                        td.classList.add('ns-num');
                        const sum = sheet.rows.reduce((acc, r) => {
                            const val = parseFloat(r[col.name]);
                            return acc + (isNaN(val) ? 0 : val);
                        }, 0);
                        td.textContent = this._formatNumber(sum, 'number', col.format);
                        td.title = `Sum of ${col.displayName}`;
                    }
                    footRow.appendChild(td);
                });

                tfoot.appendChild(footRow);
                table.appendChild(tfoot);
            }
        }

        this.gridContainer.innerHTML = '';
        this.gridContainer.appendChild(table);
    }

    renderTabs() {
        this.tabBar.innerHTML = '';

        this.sheets.forEach((sheet, i) => {
            const tab = document.createElement('button');
            tab.className = 'ns-tab' + (i === this.activeSheetIndex ? ' ns-tab-active' : '');
            tab.textContent = sheet.name;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', i === this.activeSheetIndex ? 'true' : 'false');
            tab.addEventListener('click', () => this.activateSheet(i));
            tab.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this._renameTabInline(i, tab);
            });
            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._showTabContextMenu(e, i);
            });
            this.tabBar.appendChild(tab);
        });

        // Add sheet button
        const addBtn = document.createElement('button');
        addBtn.className = 'ns-tab ns-tab-add';
        addBtn.textContent = '+';
        addBtn.title = 'Add sheet';
        addBtn.setAttribute('aria-label', 'Add new sheet');
        addBtn.addEventListener('click', () => this._promptAddSheet());
        this.tabBar.appendChild(addBtn);
    }

    // ── Cell Selection & Editing ──────────────────────────────────────

    _selectCell(row, col) {
        if (this.editing) this._commitEdit();
        this.selection = { row, col };
        this.selectionEnd = null;
        this.renderGrid();
        this.renderFormulaBar();
        this.gridContainer.focus();
    }

    _startEdit(row, col) {
        const sheet = this.getActiveSheet();
        if (!sheet || row >= sheet.rows.length || col >= sheet.columns.length) return;

        this._selectCell(row, col);
        this.editing = true;

        const td = this.gridContainer.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
        if (!td) return;

        const column = sheet.columns[col];
        const currentVal = sheet.rows[row][column.name] || '';

        td.innerHTML = '';
        td.classList.add('ns-editing');

        let editor;
        if (column.type === 'enum' && column.enumValues.length > 0) {
            editor = document.createElement('select');
            editor.className = 'ns-cell-editor';

            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '';
            editor.appendChild(emptyOpt);

            column.enumValues.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                if (v === currentVal) opt.selected = true;
                editor.appendChild(opt);
            });

            editor.addEventListener('change', () => {
                this._commitEdit(editor.value);
            });
        } else if (column.type === 'date') {
            editor = document.createElement('input');
            editor.type = 'date';
            editor.className = 'ns-cell-editor';
            editor.value = currentVal;
        } else {
            editor = document.createElement('input');
            editor.type = column.type === 'number' ? 'text' : 'text';
            editor.className = 'ns-cell-editor';
            editor.value = currentVal;
        }

        editor.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this._commitEdit(editor.value);
                this._moveSelection(1, 0);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                this._commitEdit(editor.value);
                this._moveSelection(0, e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this._cancelEdit();
            }
        });

        editor.addEventListener('blur', e => {
            // Ignore blur if focus is moving to another cell or the formula bar
            setTimeout(() => {
                if (this.editing) this._commitEdit(editor.value);
            }, 100);
        });

        this.editCell = { row, col, editor };
        td.appendChild(editor);
        editor.focus();
        if (editor.select) editor.select();
    }

    _commitEdit(value) {
        if (!this.editing || !this.editCell) return;
        const { row, col } = this.editCell;
        const sheet = this.getActiveSheet();
        if (value !== undefined) {
            this._saveSnapshot();
            sheet.rows[row][sheet.columns[col].name] = value;
        }
        this.editing = false;
        this.editCell = null;
        this.renderGrid();
        this.renderFormulaBar();
        this._fireChange();
    }

    _cancelEdit() {
        this.editing = false;
        this.editCell = null;
        this.renderGrid();
        this.renderFormulaBar();
    }

    _moveSelection(dRow, dCol) {
        const sheet = this.getActiveSheet();
        if (!sheet) return;
        let newRow = this.selection.row + dRow;
        let newCol = this.selection.col + dCol;

        // Wrap columns
        if (newCol >= sheet.columns.length) {
            newCol = 0;
            newRow++;
        } else if (newCol < 0) {
            newCol = sheet.columns.length - 1;
            newRow--;
        }

        // Auto-add row if tabbing past last row
        if (newRow >= sheet.rows.length) {
            this.addRow();
            newRow = sheet.rows.length - 1;
        }

        if (newRow < 0) newRow = 0;

        this._selectCell(newRow, newCol);
    }

    // ── Keyboard Handling ─────────────────────────────────────────────

    _onGridKeydown(e) {
        if (this.editing) return;

        const sheet = this.getActiveSheet();
        if (!sheet) return;

        // Ctrl/Cmd shortcuts
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' || e.key === 'Z') {
                e.preventDefault();
                if (e.shiftKey) this.redo(); else this.undo();
                return;
            }
            if (e.key === 'y' || e.key === 'Y') {
                e.preventDefault();
                this.redo();
                return;
            }
            if (e.key === 'c' || e.key === 'C') {
                e.preventDefault();
                this._copySelection();
                return;
            }
            if (e.key === 'v' || e.key === 'V') {
                e.preventDefault();
                this._pasteFromClipboard();
                return;
            }
            if (e.key === 'a' || e.key === 'A') {
                e.preventDefault();
                this._selectAll();
                return;
            }
            if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                this._toggleFindBar();
                return;
            }
        }

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                if (e.shiftKey) {
                    this._extendSelection(this.selection.row - 1, this.selection.col);
                } else if (this.selection.row > 0) {
                    this._selectCell(this.selection.row - 1, this.selection.col);
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (e.shiftKey) {
                    this._extendSelection(
                        Math.min((this.selectionEnd?.row ?? this.selection.row) + 1, sheet.rows.length - 1),
                        this.selection.col
                    );
                } else {
                    this._selectCell(Math.min(this.selection.row + 1, sheet.rows.length - 1), this.selection.col);
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (e.shiftKey) {
                    this._extendSelection(this.selection.row, (this.selectionEnd?.col ?? this.selection.col) - 1);
                } else if (this.selection.col > 0) {
                    this._selectCell(this.selection.row, this.selection.col - 1);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (e.shiftKey) {
                    this._extendSelection(
                        this.selection.row,
                        Math.min((this.selectionEnd?.col ?? this.selection.col) + 1, sheet.columns.length - 1)
                    );
                } else if (this.selection.col < sheet.columns.length - 1) {
                    this._selectCell(this.selection.row, this.selection.col + 1);
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (this.selection.row >= 0 && this.selection.col >= 0) {
                    this._startEdit(this.selection.row, this.selection.col);
                }
                break;
            case 'Tab':
                e.preventDefault();
                this._moveSelection(0, e.shiftKey ? -1 : 1);
                break;
            case 'Delete':
            case 'Backspace':
                e.preventDefault();
                this._clearSelection();
                break;
            default:
                // Start editing on any printable key
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && this.selection.row >= 0) {
                    this._startEdit(this.selection.row, this.selection.col);
                }
                break;
        }
    }

    _onFormulaKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this._commitFormulaEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.renderFormulaBar();
            this.gridContainer.focus();
        }
    }

    _commitFormulaEdit() {
        const sheet = this.getActiveSheet();
        if (!sheet || this.selection.row < 0 || this.selection.col < 0) return;
        if (this.selection.row >= sheet.rows.length) return;

        const val = this.formulaInput.value;
        sheet.rows[this.selection.row][sheet.columns[this.selection.col].name] = val;
        this.renderGrid();
        this._fireChange();
    }

    // ── Helpers ───────────────────────────────────────────────────────

    _formatNumber(num, type, format) {
        if (isNaN(num)) return '';
        if (format === 'currency') {
            return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (format === 'percentage') {
            return (num * 100).toFixed(1) + '%';
        }
        if (type === 'number') {
            return num % 1 === 0 ? num.toLocaleString() : num.toLocaleString(undefined, { maximumFractionDigits: 2 });
        }
        return String(num);
    }

    _fireChange() {
        if (this.options.onChange) {
            const md = this.getMarkdown();
            this.options.onChange(this.activeSheetIndex, md);
        }
    }

    _promptAddSheet() {
        const name = prompt('Sheet name:');
        if (!name) return;
        const dbml = prompt('DBML schema (or leave empty for default):', `Table ${name.toLowerCase().replace(/\s+/g, '_')} {\n  column1 text\n  column2 number\n}`);
        if (dbml === null) return;
        this.addSheet(name, dbml || `Table sheet {\n  column1 text\n}`, '');
        this.activateSheet(this.sheets.length - 1);
        this.renderTabs();
    }

    _renameTabInline(index, tabEl) {
        const sheet = this.sheets[index];
        if (!sheet) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ns-tab-rename';
        input.value = sheet.name;
        input.setAttribute('aria-label', 'Rename sheet');

        const commit = () => {
            const newName = input.value.trim();
            if (newName) this.renameSheet(index, newName);
            this.renderTabs();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); this.renderTabs(); }
        });

        tabEl.textContent = '';
        tabEl.appendChild(input);
        input.focus();
        input.select();
    }

    _showTabContextMenu(e, index) {
        const items = [
            { label: 'Rename', action: () => {
                const tab = this.tabBar.children[index];
                if (tab) this._renameTabInline(index, tab);
            }},
            { label: 'Delete', action: () => {
                if (this.sheets.length <= 1) return;
                if (confirm(`Delete sheet "${this.sheets[index].name}"?`)) {
                    this.deleteSheet(index);
                }
            }, disabled: this.sheets.length <= 1 }
        ];

        this.contextMenu.innerHTML = '';
        items.forEach(item => {
            const el = document.createElement('button');
            el.className = 'ns-ctx-item';
            el.textContent = item.label;
            el.setAttribute('role', 'menuitem');
            if (item.disabled) {
                el.disabled = true;
            } else {
                el.addEventListener('click', () => {
                    item.action();
                    this._hideContextMenu();
                });
            }
            this.contextMenu.appendChild(el);
        });

        this.contextMenu.style.display = 'block';
        this.contextMenu.style.left = e.clientX + 'px';
        this.contextMenu.style.top = (e.clientY - this.contextMenu.offsetHeight - 5) + 'px';

        // Adjust if menu would go off-screen
        const rect = this.contextMenu.getBoundingClientRect();
        if (rect.top < 0) {
            this.contextMenu.style.top = e.clientY + 'px';
        }
    }

    // ── Range Selection ───────────────────────────────────────────────

    _extendSelection(row, col) {
        const sheet = this.getActiveSheet();
        if (!sheet) return;
        row = Math.max(0, Math.min(row, sheet.rows.length - 1));
        col = Math.max(0, Math.min(col, sheet.columns.length - 1));
        this.selectionEnd = { row, col };
        this.renderGrid();
        this.renderFormulaBar();
    }

    _getSelectionRange() {
        if (!this.selectionEnd) {
            return {
                startRow: this.selection.row, endRow: this.selection.row,
                startCol: this.selection.col, endCol: this.selection.col
            };
        }
        return {
            startRow: Math.min(this.selection.row, this.selectionEnd.row),
            endRow: Math.max(this.selection.row, this.selectionEnd.row),
            startCol: Math.min(this.selection.col, this.selectionEnd.col),
            endCol: Math.max(this.selection.col, this.selectionEnd.col)
        };
    }

    _isCellInSelection(row, col) {
        if (this.selection.row < 0) return false;
        const range = this._getSelectionRange();
        return row >= range.startRow && row <= range.endRow
            && col >= range.startCol && col <= range.endCol;
    }

    _selectAll() {
        const sheet = this.getActiveSheet();
        if (!sheet || sheet.rows.length === 0) return;
        this.selection = { row: 0, col: 0 };
        this.selectionEnd = { row: sheet.rows.length - 1, col: sheet.columns.length - 1 };
        this.renderGrid();
        this.renderFormulaBar();
    }

    _clearSelection() {
        const sheet = this.getActiveSheet();
        if (!sheet || this.selection.row < 0) return;
        this._saveSnapshot();
        const range = this._getSelectionRange();
        for (let r = range.startRow; r <= range.endRow; r++) {
            for (let c = range.startCol; c <= range.endCol; c++) {
                if (r < sheet.rows.length && c < sheet.columns.length) {
                    sheet.rows[r][sheet.columns[c].name] = '';
                }
            }
        }
        this.renderGrid();
        this._fireChange();
    }

    _copySelection() {
        const sheet = this.getActiveSheet();
        if (!sheet || this.selection.row < 0) return;
        const range = this._getSelectionRange();
        const lines = [];
        for (let r = range.startRow; r <= range.endRow; r++) {
            const cells = [];
            for (let c = range.startCol; c <= range.endCol; c++) {
                cells.push(r < sheet.rows.length ? (sheet.rows[r][sheet.columns[c].name] || '') : '');
            }
            lines.push(cells.join('\t'));
        }
        navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    }

    _pasteFromClipboard() {
        const sheet = this.getActiveSheet();
        if (!sheet || this.selection.row < 0 || this.selection.col < 0) return;

        navigator.clipboard.readText().then(text => {
            if (!text) return;
            this._saveSnapshot();
            const lines = text.split('\n').filter(l => l.length > 0);
            const startRow = this.selection.row;
            const startCol = this.selection.col;

            lines.forEach((line, ri) => {
                const cells = line.split('\t');
                const rowIdx = startRow + ri;

                // Auto-expand rows
                while (rowIdx >= sheet.rows.length) {
                    const newRow = {};
                    sheet.columns.forEach(c => { newRow[c.name] = ''; });
                    sheet.rows.push(newRow);
                }

                cells.forEach((val, ci) => {
                    const colIdx = startCol + ci;
                    if (colIdx < sheet.columns.length) {
                        sheet.rows[rowIdx][sheet.columns[colIdx].name] = val.trim();
                    }
                });
            });

            this.renderGrid();
            this._fireChange();
        }).catch(() => {});
    }

    // ── Column Sorting ────────────────────────────────────────────────

    sortByColumn(colIndex) {
        const sheet = this.getActiveSheet();
        if (!sheet) return;

        if (this.sortColumn === colIndex) {
            this.sortAsc = !this.sortAsc;
        } else {
            this.sortColumn = colIndex;
            this.sortAsc = true;
        }

        const colName = sheet.columns[colIndex].name;
        const colType = sheet.columns[colIndex].type;

        this._saveSnapshot();
        sheet.rows.sort((a, b) => {
            let va = a[colName] || '';
            let vb = b[colName] || '';

            // Empty values always sort to the bottom
            if (va === '' && vb === '') return 0;
            if (va === '') return 1;
            if (vb === '') return -1;

            if (colType === 'number') {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            } else if (colType === 'date') {
                va = new Date(va).getTime() || 0;
                vb = new Date(vb).getTime() || 0;
            } else {
                va = va.toLowerCase();
                vb = vb.toLowerCase();
            }

            if (va < vb) return this.sortAsc ? -1 : 1;
            if (va > vb) return this.sortAsc ? 1 : -1;
            return 0;
        });

        this.renderGrid();
        this._fireChange();
    }

    // ── Find & Replace ─────────────────────────────────────────────────

    _toggleFindBar() {
        if (this.findBar.style.display === 'none') {
            this.findBar.style.display = 'flex';
            this.findInput.focus();
            this.findInput.select();
        } else {
            this._closeFindBar();
        }
    }

    _closeFindBar() {
        this.findBar.style.display = 'none';
        this._findMatches = [];
        this._findMatchIndex = -1;
        this.findCountEl.textContent = '';
        this.renderGrid();
        this.gridContainer.focus();
    }

    _findAll() {
        const query = this.findInput.value.toLowerCase();
        this._findMatches = [];
        this._findMatchIndex = -1;

        if (!query) {
            this.findCountEl.textContent = '';
            this.renderGrid();
            return;
        }

        const sheet = this.getActiveSheet();
        if (!sheet) return;

        sheet.rows.forEach((row, r) => {
            sheet.columns.forEach((col, c) => {
                const val = (row[col.name] || '').toLowerCase();
                if (val.includes(query)) {
                    this._findMatches.push({ row: r, col: c });
                }
            });
        });

        this.findCountEl.textContent = this._findMatches.length + ' found';

        if (this._findMatches.length > 0) {
            this._findMatchIndex = 0;
            this._goToMatch();
        }

        this.renderGrid();
    }

    _findNext() {
        if (this._findMatches.length === 0) return;
        this._findMatchIndex = (this._findMatchIndex + 1) % this._findMatches.length;
        this._goToMatch();
    }

    _findPrev() {
        if (this._findMatches.length === 0) return;
        this._findMatchIndex = (this._findMatchIndex - 1 + this._findMatches.length) % this._findMatches.length;
        this._goToMatch();
    }

    _goToMatch() {
        const match = this._findMatches[this._findMatchIndex];
        if (!match) return;
        this._selectCell(match.row, match.col);
        this.findCountEl.textContent = `${this._findMatchIndex + 1}/${this._findMatches.length}`;
    }

    _replaceOne() {
        if (this._findMatches.length === 0 || this._findMatchIndex < 0) return;
        const match = this._findMatches[this._findMatchIndex];
        const sheet = this.getActiveSheet();
        if (!sheet) return;

        const query = this.findInput.value;
        const replacement = this.replaceInput.value;
        const colName = sheet.columns[match.col].name;
        const currentVal = sheet.rows[match.row][colName] || '';

        this._saveSnapshot();
        sheet.rows[match.row][colName] = currentVal.replace(new RegExp(this._escapeRegex(query), 'i'), replacement);

        this._findAll();
        this._fireChange();
    }

    _replaceAll() {
        if (this._findMatches.length === 0) return;
        const sheet = this.getActiveSheet();
        if (!sheet) return;

        const query = this.findInput.value;
        const replacement = this.replaceInput.value;
        const regex = new RegExp(this._escapeRegex(query), 'gi');

        this._saveSnapshot();
        let count = 0;
        sheet.rows.forEach(row => {
            sheet.columns.forEach(col => {
                const val = row[col.name] || '';
                if (regex.test(val)) {
                    row[col.name] = val.replace(regex, replacement);
                    count++;
                }
                regex.lastIndex = 0;
            });
        });

        this.findCountEl.textContent = `${count} replaced`;
        this._findMatches = [];
        this._findMatchIndex = -1;
        this.renderGrid();
        this._fireChange();
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _isFindMatch(row, col) {
        return this._findMatches.some(m => m.row === row && m.col === col);
    }

    // ── Auto-fit Column ─────────────────────────────────────────────────

    _autoFitColumn(colIndex) {
        const sheet = this.getActiveSheet();
        if (!sheet) return;

        const col = sheet.columns[colIndex];

        // Measure content widths using a hidden canvas for text measurement
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = '13px "Segoe UI", Calibri, Arial, sans-serif';

        let maxWidth = ctx.measureText(col.displayName).width + 24; // header + padding
        sheet.rows.forEach(row => {
            const val = row[col.name] || '';
            const w = ctx.measureText(val).width + 16;
            if (w > maxWidth) maxWidth = w;
        });

        col.width = Math.max(60, Math.min(Math.ceil(maxWidth), 400));
        this.renderGrid();
    }

    // ── CSV Export ────────────────────────────────────────────────────

    exportCsv() {
        const sheet = this.getActiveSheet();
        if (!sheet) return;

        const headers = sheet.columns.map(c => this._csvEscape(c.displayName));
        const rows = sheet.rows.map(r =>
            sheet.columns.map(c => this._csvEscape(r[c.name] || '')).join(',')
        );

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (sheet.name || 'sheet') + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    _csvEscape(val) {
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    // ── Column Resizing ───────────────────────────────────────────────

    _initResize(e, colIndex) {
        e.preventDefault();
        e.stopPropagation();

        const sheet = this.getActiveSheet();
        if (!sheet) return;

        const th = e.target.closest('th');
        const startX = e.clientX;
        const startWidth = th.offsetWidth;

        const onMouseMove = (moveEvt) => {
            const delta = moveEvt.clientX - startX;
            const newWidth = Math.max(40, startWidth + delta);
            sheet.columns[colIndex].width = newWidth;
            th.style.width = newWidth + 'px';
            th.style.minWidth = newWidth + 'px';
            th.style.maxWidth = newWidth + 'px';

            // Apply to all cells in the column
            const cells = this.gridContainer.querySelectorAll(`td[data-col="${colIndex}"]`);
            cells.forEach(td => {
                td.style.width = newWidth + 'px';
                td.style.minWidth = newWidth + 'px';
                td.style.maxWidth = newWidth + 'px';
            });
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
        };

        document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    // ── Public API ────────────────────────────────────────────────────

    getRows(sheetIndex) {
        const idx = sheetIndex !== undefined ? sheetIndex : this.activeSheetIndex;
        return this.sheets[idx]?.rows || [];
    }

    getColumns(sheetIndex) {
        const idx = sheetIndex !== undefined ? sheetIndex : this.activeSheetIndex;
        return this.sheets[idx]?.columns || [];
    }

    getSheetCount() {
        return this.sheets.length;
    }

    renameSheet(index, name) {
        if (this.sheets[index]) {
            this.sheets[index].name = name;
            this.renderTabs();
        }
    }

    deleteSheet(index) {
        if (this.sheets.length <= 1) return;
        this.sheets.splice(index, 1);
        if (this.activeSheetIndex >= this.sheets.length) {
            this.activeSheetIndex = this.sheets.length - 1;
        }
        this.activateSheet(this.activeSheetIndex);
    }

    // ── Context Menu ──────────────────────────────────────────────────

    _onContextMenu(e) {
        e.preventDefault();
        const td = e.target.closest('td[data-row]');
        if (!td) return;

        const row = parseInt(td.dataset.row);
        const col = parseInt(td.dataset.col);
        this._selectCell(row, col);

        const sheet = this.getActiveSheet();
        const items = [
            { label: 'Insert row above', action: () => this._insertRow(row) },
            { label: 'Insert row below', action: () => this._insertRow(row + 1) },
            { label: 'Delete row', action: () => this.deleteRow(row), disabled: row >= sheet.rows.length },
            { type: 'separator' },
            { label: 'Clear cell', action: () => this.setCellValue(row, col, '') },
            { label: 'Copy table', action: () => this._copyToClipboard() }
        ];

        this.contextMenu.innerHTML = '';
        items.forEach(item => {
            if (item.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'ns-ctx-sep';
                this.contextMenu.appendChild(sep);
                return;
            }
            const el = document.createElement('button');
            el.className = 'ns-ctx-item';
            el.textContent = item.label;
            el.setAttribute('role', 'menuitem');
            if (item.disabled) {
                el.disabled = true;
            } else {
                el.addEventListener('click', () => {
                    item.action();
                    this._hideContextMenu();
                });
            }
            this.contextMenu.appendChild(el);
        });

        this.contextMenu.style.display = 'block';
        this.contextMenu.style.left = e.clientX + 'px';
        this.contextMenu.style.top = e.clientY + 'px';

        // Keep menu within viewport
        const rect = this.contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.contextMenu.style.left = (e.clientX - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            this.contextMenu.style.top = (e.clientY - rect.height) + 'px';
        }
    }

    _hideContextMenu() {
        if (this.contextMenu) {
            this.contextMenu.style.display = 'none';
        }
    }

    _insertRow(atIndex) {
        const sheet = this.getActiveSheet();
        if (!sheet) return;
        this._saveSnapshot();
        const newRow = {};
        sheet.columns.forEach(c => { newRow[c.name] = ''; });

        // Expand rows if needed
        while (sheet.rows.length < atIndex) {
            const emptyRow = {};
            sheet.columns.forEach(c => { emptyRow[c.name] = ''; });
            sheet.rows.push(emptyRow);
        }

        sheet.rows.splice(atIndex, 0, newRow);
        this._selectCell(atIndex, this.selection.col >= 0 ? this.selection.col : 0);
        this._fireChange();
    }

    // ── Clipboard ─────────────────────────────────────────────────────

    _copyToClipboard() {
        const sheet = this.getActiveSheet();
        if (!sheet) return;

        const headers = sheet.columns.map(c => c.displayName);
        const rows = sheet.rows.map(r =>
            sheet.columns.map(c => r[c.name] || '')
        );

        const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');

        navigator.clipboard.writeText(tsv).then(() => {
            const btn = this.toolbar.querySelector('[data-action="copy"]');
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            }
        }).catch(() => {});
    }

    destroy() {
        if (this.contextMenu && this.contextMenu.parentNode) {
            this.contextMenu.parentNode.removeChild(this.contextMenu);
        }
    }
}
