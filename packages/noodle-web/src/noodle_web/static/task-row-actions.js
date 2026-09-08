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

    // Structural edits use stable task identities.  This avoids the old
    // remove/re-find-by-name sequence, which selected the wrong duplicate
    // task and broke dependency references after a rename.
    if (typeof NoodlePlanModel === 'undefined') return;
    const model = NoodlePlanModel.modelForEditor(editor);
    const sourceNode = sourceTask._uid != null ? model.findById(sourceTask._uid) : model.taskAt(fromIndex);
    const targetNode = targetTask._uid != null ? model.findById(targetTask._uid) : model.taskAt(toIndex);
    if (model.moveAsChild(sourceNode, targetNode, insertBelow)) {
        NoodlePlanModel.commitToEditor(editor, model);
        setTimeout(() => renderText(), 10);
    }
}

// ── Attach to rows ───────────────────────────────────────────────────

/**
 * Add hover add-buttons and a drag handle to a Gantt info row.
 * Call this from renderGanttRows() after creating the <tr>.
 */
function addRowInteractions(row, task, index, tableId) {
    // Add drag handle in its own cell before the done/piechart cell
    const doneCell = row.querySelector('.gantt-done-cell');
    if (doneCell) {
        const handleCell = document.createElement('td');
        handleCell.className = 'task-drag-cell';
        const handle = createDragHandle();
        handleCell.appendChild(handle);
        row.insertBefore(handleCell, doneCell);
    }

    // Add hover + buttons to the ID cell (3rd cell: drag, done, ID)
    const btns = createRowAddButtons(task, index);
    const cells = row.querySelectorAll('td');
    const idCell = cells[2]; // drag=0, done=1, id=2
    if (idCell) {
        idCell.style.position = 'relative';
        idCell.appendChild(btns.above);
        idCell.appendChild(btns.below);
    }

    // Attach drag-and-drop listeners
    attachRowDragListeners(row, task, index, tableId);
}
