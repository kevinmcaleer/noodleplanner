/**
 * task-row-actions.js — Hover add-buttons, drag handles, and insert helpers
 * for the Gantt info table and Tasks table views.
 * Depends on: state.js (globals), editor-sync.js, script.js (openTaskForm, findTaskLineNumber)
 */

// ── Insert Task helpers ─────────────────────────────────────────────

/**
 * Insert a blank task above the given task index and open the form.
 */
function insertTaskAtPosition(task, position) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lineNumber = findTaskLineNumber(task);
    if (lineNumber < 1) return;

    const lines = editor.value.split('\n');
    const lineIdx = lineNumber - 1;

    // Match the indentation of the current task
    const currentLine = lines[lineIdx];
    const indentMatch = currentLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    const newTaskName = 'New Task';
    let insertIdx;
    if (position === 'above') {
        insertIdx = lineIdx;
    } else {
        // Insert below: skip past any children of the current task
        const taskIndent = currentLine.search(/\S/);
        insertIdx = lineIdx + 1;
        for (let i = lineIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const lineIndent = line.search(/\S/);
            if (lineIndent <= taskIndent) break;
            insertIdx = i + 1;
        }
    }
    lines.splice(insertIdx, 0, indent + newTaskName);

    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Open the task form for the new line (1-based)
    const newLineNumber = insertIdx + 1;
    setTimeout(() => {
        openTaskForm(newLineNumber);
        // Focus the contenteditable title and select all text so the user
        // can immediately start typing a replacement name.
        setTimeout(() => {
            const titleEl = document.getElementById('taskFormTitle');
            if (titleEl) {
                titleEl.focus();
                // Select all text so the first keystroke replaces "New Task"
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(titleEl);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 50);
    }, 100);
}

// ── Add-button creation ──────────────────────────────────────────────

/**
 * Create the circular + buttons that appear above/below a task row on hover.
 * Returns { above, below } DOM elements to be appended to the row.
 */
function createRowAddButtons(task, index) {
    const above = document.createElement('button');
    above.className = 'task-row-add-btn add-above';
    above.textContent = '+';
    above.title = 'Insert task above';
    above.setAttribute('aria-label', 'Insert task above ' + (task.name || 'task'));
    above.addEventListener('click', (e) => {
        e.stopPropagation();
        insertTaskAtPosition(task, 'above');
    });

    const below = document.createElement('button');
    below.className = 'task-row-add-btn add-below';
    below.textContent = '+';
    below.title = 'Insert task below';
    below.setAttribute('aria-label', 'Insert task below ' + (task.name || 'task'));
    below.addEventListener('click', (e) => {
        e.stopPropagation();
        insertTaskAtPosition(task, 'below');
    });

    return { above, below };
}

// ── Drag Handle ──────────────────────────────────────────────────────

/**
 * Create a drag-handle element (grip icon) for a task row.
 */
function createDragHandle() {
    const handle = document.createElement('span');
    handle.className = 'task-drag-handle';
    handle.textContent = '\u2630'; // ☰ hamburger / grip icon
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-label', 'Drag to reorder');
    handle.setAttribute('draggable', 'true');
    return handle;
}

// ── Drag-and-drop logic ──────────────────────────────────────────────

/** Currently dragged task row element */
let _dragSourceRow = null;

/**
 * Attach drag-and-drop listeners to a table row.
 * @param {HTMLTableRowElement} row - the <tr> for the task
 * @param {object} task - the task data object
 * @param {number} index - task index in ganttTasks / tasks array
 * @param {string} tableId - 'gantt' or 'tasks' to know which view to refresh
 */
function attachRowDragListeners(row, task, index, tableId) {
    const handle = row.querySelector('.task-drag-handle');
    if (!handle) return;

    // Only the handle initiates the drag (not the whole row)
    handle.addEventListener('dragstart', (e) => {
        _dragSourceRow = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        // Use the row as drag image for better visual feedback
        e.dataTransfer.setDragImage(row, 0, row.offsetHeight / 2);
    });

    // When dragging ends (drop or cancel)
    handle.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        _dragSourceRow = null;
        // Clean up all drag-over indicators in the table
        const tbody = row.parentElement;
        if (tbody) {
            tbody.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
                el.classList.remove('drag-over-above', 'drag-over-below');
            });
        }
    });

    // Row is a drop target
    row.addEventListener('dragover', (e) => {
        if (!_dragSourceRow || _dragSourceRow === row) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Show indicator above or below depending on mouse position
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        row.classList.toggle('drag-over-above', e.clientY < midY);
        row.classList.toggle('drag-over-below', e.clientY >= midY);
    });

    row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-above', 'drag-over-below');
    });

    row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over-above', 'drag-over-below');
        if (!_dragSourceRow || _dragSourceRow === row) return;

        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIndex = index;
        if (isNaN(fromIndex) || fromIndex === toIndex) return;

        // Determine insert position (above or below the target row)
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBelow = e.clientY >= midY;

        moveTaskInEditor(fromIndex, toIndex, insertBelow, tableId);
    });
}

/**
 * Move a task line in the editor from one position to another.
 * @param {number} fromIndex - source task index in ganttTasks
 * @param {number} toIndex - target task index in ganttTasks
 * @param {boolean} insertBelow - if true, insert after target; otherwise before
 * @param {string} tableId - 'gantt' or 'tasks'
 */
function moveTaskInEditor(fromIndex, toIndex, insertBelow, tableId) {
    const editor = document.getElementById('planEditor');
    if (!editor || !ganttTasks) return;

    const sourceTask = ganttTasks[fromIndex];
    const targetTask = ganttTasks[toIndex];
    if (!sourceTask || !targetTask) return;

    const srcLine = findTaskLineNumber(sourceTask);
    let dstLine = findTaskLineNumber(targetTask);
    if (srcLine < 1 || dstLine < 1) return;

    const lines = editor.value.split('\n');
    const srcIdx = srcLine - 1;

    // Find the range of lines to move (task + all its children based on indent).
    // Only include child lines that are more deeply indented than the source task.
    const srcIndent = lines[srcIdx].search(/\S/);
    let srcEndIdx = srcIdx;
    for (let i = srcIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue; // skip blank lines when deciding extent
        const indent = line.search(/\S/);
        if (indent <= srcIndent) break;
        srcEndIdx = i;
    }

    // Extract the lines to move
    const movedLines = lines.splice(srcIdx, srcEndIdx - srcIdx + 1);

    // Re-find the target line (indices may have shifted after splice)
    dstLine = findTaskLineNumber(targetTask);
    if (dstLine < 1) {
        // Restore if we can't find target
        lines.splice(srcIdx, 0, ...movedLines);
        return;
    }
    let dstIdx = dstLine - 1;

    // If inserting below, find the end of the target task's children
    if (insertBelow) {
        const dstIndent = lines[dstIdx].search(/\S/);
        for (let i = dstIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue; // skip blank lines
            const indent = line.search(/\S/);
            if (indent <= dstIndent) break;
            dstIdx = i;
        }
        dstIdx += 1; // Insert after the last child
    }

    lines.splice(dstIdx, 0, ...movedLines);

    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Re-render views
    setTimeout(() => renderText(), 10);
}

// ── Attach to rows ───────────────────────────────────────────────────

/**
 * Add hover add-buttons and a drag handle to a Gantt info row.
 * Call this from renderGanttRows() after creating the <tr>.
 */
function addRowInteractions(row, task, index, tableId) {
    // Add drag handle into the done/piechart cell
    const doneCell = row.querySelector('.gantt-done-cell');
    if (doneCell) {
        const handle = createDragHandle();
        doneCell.insertBefore(handle, doneCell.firstChild);
    }

    // Add hover + buttons
    const btns = createRowAddButtons(task, index);
    row.appendChild(btns.above);
    row.appendChild(btns.below);

    // Attach drag-and-drop listeners
    attachRowDragListeners(row, task, index, tableId);
}
