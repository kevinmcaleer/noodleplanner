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
        this.editing = false;
        this.editCell = null;

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
            const match = line.match(/^(\w+)\s+(text|number|date|enum)\s*(?:\(([^)]*)\))?/i);
            if (!match) continue;

            const name = match[1];
            const type = match[2].toLowerCase();
            const enumValues = match[3]
                ? match[3].split(',').map(v => v.trim().replace(/^['"]|['"]$/g, ''))
                : [];

            columns.push({
                name,
                displayName: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                type,
                enumValues,
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
        // Handle SUM, COUNT, AVERAGE functions
        const funcMatch = expr.match(/^(SUM|COUNT|AVERAGE)\((.+)\)$/);
        if (funcMatch) {
            const func = funcMatch[1];
            const rangeValues = this._resolveRange(funcMatch[2], sheet);
            const nums = rangeValues.map(v => parseFloat(v)).filter(n => !isNaN(n));

            switch (func) {
                case 'SUM': return nums.reduce((a, b) => a + b, 0);
                case 'COUNT': return rangeValues.filter(v => v !== '' && v !== undefined).length;
                case 'AVERAGE': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
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

    // ── Data Operations ───────────────────────────────────────────────

    addRow(data) {
        const sheet = this.getActiveSheet();
        if (!sheet) return;
        const row = {};
        sheet.columns.forEach(c => { row[c.name] = (data && data[c.name]) || ''; });
        sheet.rows.push(row);
        this.renderGrid();
        this._fireChange();
    }

    deleteRow(rowIndex) {
        const sheet = this.getActiveSheet();
        if (!sheet || rowIndex < 0 || rowIndex >= sheet.rows.length) return;
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
            <button class="ns-toolbar-btn" data-action="add-row" title="Add row" aria-label="Add row">+ Row</button>
            <button class="ns-toolbar-btn" data-action="delete-row" title="Delete selected row" aria-label="Delete row">- Row</button>
            <span class="ns-toolbar-sep"></span>
            <button class="ns-toolbar-btn" data-action="copy" title="Copy table to clipboard" aria-label="Copy table">Copy</button>
        `;
        this.toolbar.addEventListener('click', e => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'add-row') this.addRow();
            else if (action === 'delete-row' && this.selection.row >= 0) this.deleteRow(this.selection.row);
            else if (action === 'copy') this._copyToClipboard();
        });
        this.container.appendChild(this.toolbar);

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

            const letterSpan = document.createElement('div');
            letterSpan.className = 'ns-col-letter';
            letterSpan.textContent = this._indexToColName(i);

            const nameSpan = document.createElement('div');
            nameSpan.className = 'ns-col-name';
            nameSpan.textContent = col.displayName;
            nameSpan.title = col.displayName;

            th.appendChild(letterSpan);
            th.appendChild(nameSpan);

            if (this.selection.col === i) th.classList.add('ns-selected-col');
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
                            ? this._formatNumber(computed, col.type)
                            : computed;
                        td.classList.add('ns-formula-cell');
                        td.title = rawVal;
                    } else {
                        td.textContent = col.type === 'number' && rawVal !== ''
                            ? this._formatNumber(parseFloat(rawVal), col.type)
                            : rawVal;
                    }

                    if (col.type === 'number') td.classList.add('ns-num');
                }

                if (this.selection.row === r && this.selection.col === c) {
                    td.classList.add('ns-selected');
                }

                td.addEventListener('mousedown', e => {
                    e.preventDefault();
                    this._selectCell(r, c);
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
                this._commitEdit(editor.value);
                this._moveSelection(1, 0);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                this._commitEdit(editor.value);
                this._moveSelection(0, e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
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

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                if (this.selection.row > 0) this._selectCell(this.selection.row - 1, this.selection.col);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this._selectCell(Math.min(this.selection.row + 1, sheet.rows.length - 1), this.selection.col);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (this.selection.col > 0) this._selectCell(this.selection.row, this.selection.col - 1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (this.selection.col < sheet.columns.length - 1)
                    this._selectCell(this.selection.row, this.selection.col + 1);
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
                if (this.selection.row >= 0 && this.selection.col >= 0) {
                    this.setCellValue(this.selection.row, this.selection.col, '');
                }
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

    _formatNumber(num, type) {
        if (isNaN(num)) return '';
        if (type === 'number') {
            return num % 1 === 0 ? String(num) : num.toFixed(2);
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
