/**
 * Checklist rows on a whiteboard note: edit in place, and drag.
 *
 * A note's rows are its task's direct children. Until now the only things a
 * row did were tick, peek, assign and split -- renaming one meant the task
 * form, and moving one meant the outline panel. This file gives the row the
 * two gestures a post-it's items obviously want:
 *
 *   - **Double-click (double-tap) to rename.** The row's name becomes
 *     editable where it sits; Enter or blur commits through
 *     wbRenameNoteTask() -- the note title's own rename, so dependencies,
 *     whiteboard rows and inline tokens (`Design 3d @kev`) behave exactly as
 *     they do there -- and Escape puts the old name back.
 *
 *   - **Drag to move.** Press a row and move it:
 *       * between the rows of the same note, to re-order it;
 *       * between the rows of another note, to move it onto that note;
 *       * onto bare board, to lift it off as a note of its own -- top level,
 *         so no noodle ties it back to where it came from.
 *     A line shows where it will land; a note it cannot go on (a thought, or
 *     one of its own descendants) is outlined red; bare board turns the ghost
 *     into a little post-it. One wbCommitMarkdown() per drop, and the outline
 *     write is wbMoveRowInPlanText() (whiteboard-structure.js), so the task's
 *     subtree and every token on its lines travel with it.
 *
 * Both gestures are detected from the row's own presses, like the header's
 * rename (see wbIsRepeatHeaderPress() in whiteboard-notes.js): a mouse drag
 * starts once the pointer has moved a few pixels, a touch drag after a long
 * press, so a tap still ticks, peeks and scrolls exactly as before. Presses
 * on the row's controls -- checkbox, badges, date chip, people, scissors --
 * are theirs and never start either gesture.
 *
 * Wired from wbBuildChildRow() (whiteboard-notes.js), which calls
 * wbWireRowGestures() on every row it builds.
 */

/** Pixels a mouse must travel with the button down before a press is a drag. */
const WB_ROW_DRAG_THRESHOLD = 4;

/** Offset of the new note's top-left from the drop point, in board units. */
const WB_ROW_LIFT_OFFSET = 24;

/** Everything in a row that has a gesture of its own. */
const WB_ROW_CONTROL_SELECTOR = 'button, input, np-checkbox, np-resource-stack, .wb-note-cut, a';

let wbActiveRowDrag = null;
let wbLastRowPress = null;

function wbRowPressIsOnControl(target) {
    if (!target || !target.closest) return false;
    if (target.isContentEditable) return true;
    return !!target.closest(WB_ROW_CONTROL_SELECTOR);
}

/**
 * Whether this press is the second of a double-press on the same row. Keyed
 * on the task name rather than the element, because the first press of a
 * pair can re-render the note (a peek opening, a tick) and hand the second
 * press a fresh row for the same task.
 */
function wbIsRepeatRowPress(taskName, clientX, clientY) {
    const now = Date.now();
    const last = wbLastRowPress;
    wbLastRowPress = { taskName, x: clientX, y: clientY, at: now };
    if (!last || last.taskName !== taskName) return false;
    if (now - last.at > WB_HEADER_DOUBLE_PRESS_MS) return false;
    return !wbExceedsMoveThreshold(last.x, last.y, clientX, clientY, WB_HEADER_DOUBLE_PRESS_SLOP);
}

// ── Edit in place ────────────────────────────────────────────────────────

/**
 * Make `row`'s name editable where it sits. Enter or blur renames the task,
 * Escape abandons. The same commit path as renaming a note from its header.
 */
function wbBeginRowEdit(row) {
    if (!row) return false;
    const label = row.querySelector('.wb-note-row-name');
    const originalName = row.dataset.wbRowTask;
    if (!label || !originalName || label.isContentEditable) return false;

    // A double-click on a summary row has already opened its peek with the
    // first click; renaming is what was meant.
    if (typeof TaskPeek !== 'undefined' && TaskPeek && TaskPeek.isOpenFor &&
        TaskPeek.isOpenFor(originalName)) {
        TaskPeek.close();
    }
    wbLastRowPress = null;

    label.contentEditable = 'true';
    label.spellcheck = false;
    label.classList.add('editing');
    row.classList.add('wb-note-row-editing');
    label.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(label);
    selection.removeAllRanges();
    selection.addRange(range);

    let settled = false;
    const finish = (commit) => {
        if (settled) return;
        settled = true;
        label.contentEditable = 'false';
        label.classList.remove('editing');
        row.classList.remove('wb-note-row-editing');
        label.removeEventListener('keydown', onKeydown);
        label.removeEventListener('blur', onBlur);
        label.removeEventListener('paste', onPaste);

        const typed = label.textContent.replace(/\s+/g, ' ').trim();
        if (!commit || !typed || typed === originalName) {
            label.textContent = originalName;
            return;
        }
        if (!wbRenameNoteTask(originalName, typed)) label.textContent = originalName;
    };

    const onKeydown = (e) => {
        e.stopPropagation(); // canvas shortcuts must not fire while typing
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    // A task name is one line of plain text: paste it as such.
    const onPaste = (e) => {
        const text = e.clipboardData && e.clipboardData.getData('text/plain');
        if (typeof text !== 'string') return;
        e.preventDefault();
        document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
    };

    label.addEventListener('keydown', onKeydown);
    label.addEventListener('blur', onBlur);
    label.addEventListener('paste', onPaste);
    return true;
}

// ── Drag ─────────────────────────────────────────────────────────────────

function wbRowDragSourceNote(row) {
    const fo = row && row.closest && row.closest('.wb-note');
    return (fo && fo.dataset.wbTask) || '';
}

/** The rows of a note that are actually showing, excluding `exceptName`. */
function wbVisibleRowsOf(entry, exceptName) {
    const body = entry && entry.refs && entry.refs.body;
    if (!body) return [];
    const bodyRect = body.getBoundingClientRect();
    if (!bodyRect.height) return [];
    return Array.from(body.querySelectorAll('.wb-note-row[data-wb-row-task]')).filter(row => {
        if (row.dataset.wbRowTask === exceptName) return false;
        const r = row.getBoundingClientRect();
        return r.height > 0 && r.bottom > bodyRect.top && r.top < bodyRect.bottom;
    });
}

/**
 * Where a drop at this client point would put `taskName`, as
 * `{ kind, ... }` -- a wbMoveRowInPlanText() target plus what the drop
 * indicator needs:
 *
 *   `{ kind: 'row', note, ref, before, row }`  between rows of `note`
 *   `{ kind: 'note', note }`                   onto a note with no rows showing
 *   `{ kind: 'top' }`                          bare board: a note of its own
 *   `{ kind: 'invalid', note }`                a note it cannot go on
 *   `null`                                     off the board: no drop
 */
function wbRowDropTargetAt(taskName, clientX, clientY) {
    if (typeof wbSvg === 'undefined' || !wbSvg) return null;
    const board = wbSvg.getBoundingClientRect();
    if (clientX < board.left || clientX > board.right ||
        clientY < board.top || clientY > board.bottom) return null;
    if (typeof wbPointOverParkingLotPanel === 'function' &&
        wbPointOverParkingLotPanel(clientX, clientY)) return null;

    const noteName = (typeof wbNoteAt === 'function') ? wbNoteAt(clientX, clientY, null) : null;
    if (!noteName) return { kind: 'top' };

    // A thought is not a task and has no rows; a descendant would make a loop.
    const key = String(noteName).toLowerCase();
    const invalid = wbIsThoughtNote(noteName) ||
        key === String(taskName).toLowerCase() ||
        (typeof wbDescendantNames === 'function' && wbDescendantNames(wbLastTasks, taskName).has(key));
    if (invalid) return { kind: 'invalid', note: noteName };

    const entry = wbNoteNodes.get(noteName);
    const rows = wbVisibleRowsOf(entry, taskName);
    if (!rows.length) return { kind: 'note', note: noteName };

    for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) {
            return { kind: 'row', note: noteName, ref: row.dataset.wbRowTask, before: true, row };
        }
    }
    const last = rows[rows.length - 1];
    return { kind: 'row', note: noteName, ref: last.dataset.wbRowTask, before: false, row: last };
}

function wbClearRowDropIndicator() {
    document.querySelectorAll('.wb-row-drop-before, .wb-row-drop-after').forEach(el => {
        el.classList.remove('wb-row-drop-before', 'wb-row-drop-after');
    });
    document.querySelectorAll('.wb-note-card.wb-row-drop-note, .wb-note-card.wb-link-target-invalid').forEach(el => {
        el.classList.remove('wb-row-drop-note', 'wb-link-target-invalid');
    });
}

function wbShowRowDropIndicator(drag, target) {
    wbClearRowDropIndicator();
    const ghost = drag.ghost;
    if (ghost) ghost.classList.toggle('wb-row-drag-ghost-lift', !!target && target.kind === 'top');
    if (!target) return;
    if (target.kind === 'row' && target.row) {
        target.row.classList.add(target.before ? 'wb-row-drop-before' : 'wb-row-drop-after');
        return;
    }
    const entry = (target.kind === 'note' || target.kind === 'invalid') && wbNoteNodes.get(target.note);
    const card = entry && entry.refs && entry.refs.card;
    if (card) card.classList.add(target.kind === 'invalid' ? 'wb-link-target-invalid' : 'wb-row-drop-note');
}

function wbCreateRowDragGhost(drag) {
    const ghost = document.createElement('div');
    ghost.className = 'wb-row-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.textContent = drag.taskName;
    const accent = drag.sourceCard &&
        drag.sourceCard.style.getPropertyValue('--wb-note-accent');
    if (accent) ghost.style.setProperty('--wb-row-ghost-accent', accent.trim());
    document.body.appendChild(ghost);
    return ghost;
}

function wbPlaceRowDragGhost(drag, clientX, clientY) {
    if (!drag.ghost) return;
    drag.ghost.style.transform = `translate(${Math.round(clientX + 12)}px, ${Math.round(clientY + 8)}px)`;
}

function wbActivateRowDrag(drag, clientX, clientY) {
    drag.phase = 'active';
    drag.ghost = wbCreateRowDragGhost(drag);
    if (drag.row) drag.row.classList.add('wb-note-row-dragging');
    if (typeof wbSetDragCursor === 'function') wbSetDragCursor('grabbing');
    document.body.classList.add('wb-row-drag-active');
    const selection = window.getSelection && window.getSelection();
    if (selection) selection.removeAllRanges();
    wbUpdateRowDrag(clientX, clientY);
}

function wbUpdateRowDrag(clientX, clientY) {
    const drag = wbActiveRowDrag;
    if (!drag || drag.phase !== 'active') return;
    wbPlaceRowDragGhost(drag, clientX, clientY);
    drag.target = wbRowDropTargetAt(drag.taskName, clientX, clientY);
    wbShowRowDropIndicator(drag, drag.target);
}

function wbTeardownRowDrag(drag) {
    wbClearRowDropIndicator();
    if (drag.ghost) drag.ghost.remove();
    if (drag.row) drag.row.classList.remove('wb-note-row-dragging');
    if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
    if (typeof wbSetDragCursor === 'function') wbSetDragCursor('');
    document.body.classList.remove('wb-row-drag-active');
}

/**
 * The click that follows a mouse drag's release lands on whatever row the
 * pointer ended on, and a row's click opens its peek. Swallow that one.
 */
function wbSwallowNextClick() {
    const swallow = (e) => {
        e.stopPropagation();
        e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    // A release outside any element never produces that click; don't leave
    // the trap armed for the user's next real one.
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

function wbFinishRowDrag(clientX, clientY) {
    const drag = wbActiveRowDrag;
    if (!drag) return;
    wbActiveRowDrag = null;
    const wasActive = drag.phase === 'active';
    const target = wasActive ? wbRowDropTargetAt(drag.taskName, clientX, clientY) : null;
    wbTeardownRowDrag(drag);
    if (!wasActive) return;
    if (!drag.touch) wbSwallowNextClick();
    if (target) wbDropRow(drag.taskName, target, clientX, clientY);
}

function wbCancelRowDrag() {
    const drag = wbActiveRowDrag;
    if (!drag) return;
    wbActiveRowDrag = null;
    wbTeardownRowDrag(drag);
    if (drag.phase === 'active' && !drag.touch) wbSwallowNextClick();
}

/**
 * Commit a row drop. Returns whether anything was written.
 *
 * `{ kind: 'top' }` also writes a ---whiteboard--- row for the lifted task
 * at the drop point, in the same commit, so it lands as a note exactly where
 * it was let go.
 */
function wbDropRow(taskName, target, clientX, clientY) {
    const editor = document.getElementById('planEditor');
    if (!editor || !taskName || !target || target.kind === 'invalid') return false;
    if (typeof wbMoveRowInPlanText !== 'function') return false;

    const planText = editor.value;
    let next = wbMoveRowInPlanText(planText, taskName, target);
    if (next === planText) return false;

    if (target.kind === 'top') {
        if (typeof extractWhiteboardFromPlanText !== 'function' ||
            typeof parseWhiteboardMarkdown !== 'function' ||
            typeof updatePlanWhiteboardText !== 'function') {
            return false;
        }
        const at = wbBoardPointFromClient(clientX, clientY) || { x: 0, y: 0 };
        const x = Math.round(at.x - WB_ROW_LIFT_OFFSET);
        const y = Math.round(at.y - WB_ROW_LIFT_OFFSET);
        const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(next));
        const key = String(taskName).toLowerCase();
        const existing = items.find(it => it && String(it.task).toLowerCase() === key);
        if (existing) {
            existing.x = x;
            existing.y = y;
        } else {
            items.push({
                task: taskName,
                x, y,
                colour: '',
                width: WB_NOTE_DEFAULT_WIDTH,
                height: WB_NOTE_DEFAULT_HEIGHT,
                collapsed: false,
            });
        }
        next = updatePlanWhiteboardText(next, items);
    }

    if (!wbCommitMarkdown(next)) return false;
    if (target.kind === 'top' && typeof wbWhenNoteRendered === 'function') {
        wbWhenNoteRendered(taskName, () => wbSetSelectedNote(taskName));
    }
    return true;
}

// ── Entry points ─────────────────────────────────────────────────────────

function wbRowMouseDown(e, row) {
    if (e.button !== 0 || e.shiftKey) return;
    if (wbActiveRowDrag || (typeof wbActiveDrag !== 'undefined' && wbActiveDrag)) return;
    if (wbRowPressIsOnControl(e.target)) return;
    const taskName = row.dataset.wbRowTask;
    if (!taskName) return;

    if (wbIsRepeatRowPress(taskName, e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        wbBeginRowEdit(row);
        return;
    }

    const fo = row.closest('.wb-note');
    wbActiveRowDrag = {
        phase: 'pending',
        touch: false,
        taskName,
        row,
        sourceNote: wbRowDragSourceNote(row),
        sourceCard: fo && fo.querySelector('.wb-note-card'),
        startX: e.clientX,
        startY: e.clientY,
        ghost: null,
        target: null,
    };
}

function wbRowTouchStart(e, row) {
    if (e.touches.length !== 1) return;
    if (wbActiveRowDrag || (typeof wbActiveDrag !== 'undefined' && wbActiveDrag)) return;
    if (wbRowPressIsOnControl(e.target)) return;
    const taskName = row.dataset.wbRowTask;
    if (!taskName) return;
    const touch = e.touches[0];

    if (wbIsRepeatRowPress(taskName, touch.clientX, touch.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        wbBeginRowEdit(row);
        return;
    }

    const fo = row.closest('.wb-note');
    const drag = {
        phase: 'pending',
        touch: true,
        touchId: touch.identifier,
        taskName,
        row,
        sourceNote: wbRowDragSourceNote(row),
        sourceCard: fo && fo.querySelector('.wb-note-card'),
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        ghost: null,
        target: null,
    };
    // Long press, as for a note's header: a quick tap or a scroll of the
    // note's body must never pick the row up.
    drag.longPressTimer = setTimeout(() => {
        if (wbActiveRowDrag !== drag) return;
        drag.longPressTimer = null;
        wbActivateRowDrag(drag, drag.lastX, drag.lastY);
    }, WB_TOUCH_LONG_PRESS_MS);
    wbActiveRowDrag = drag;
}

/** Hook a freshly built checklist row up to both gestures. */
function wbWireRowGestures(row) {
    if (!row || row.dataset.wbRowGestures) return;
    row.dataset.wbRowGestures = 'true';
    row.addEventListener('mousedown', (e) => wbRowMouseDown(e, row));
    row.addEventListener('touchstart', (e) => wbRowTouchStart(e, row), { passive: false });
}

function wbRowDragMouseMove(e) {
    const drag = wbActiveRowDrag;
    if (!drag || drag.touch) return;
    if (drag.phase === 'pending') {
        if (!wbExceedsMoveThreshold(drag.startX, drag.startY, e.clientX, e.clientY, WB_ROW_DRAG_THRESHOLD)) return;
        wbActivateRowDrag(drag, e.clientX, e.clientY);
    }
    e.preventDefault();
    wbUpdateRowDrag(e.clientX, e.clientY);
}

function wbRowDragMouseUp(e) {
    const drag = wbActiveRowDrag;
    if (!drag || drag.touch) return;
    wbFinishRowDrag(e.clientX, e.clientY);
}

function wbRowDragTouchMove(e) {
    const drag = wbActiveRowDrag;
    if (!drag || !drag.touch) return;
    const touch = wbFindTouchById(e.touches, drag.touchId);
    if (!touch) return;
    drag.lastX = touch.clientX;
    drag.lastY = touch.clientY;
    if (drag.phase === 'pending') {
        if (wbExceedsMoveThreshold(drag.startX, drag.startY, touch.clientX, touch.clientY, WB_TOUCH_CANCEL_THRESHOLD)) {
            wbCancelRowDrag(); // a scroll, not a drag
        }
        return;
    }
    e.preventDefault();
    wbUpdateRowDrag(touch.clientX, touch.clientY);
}

function wbRowDragTouchEnd(e) {
    const drag = wbActiveRowDrag;
    if (!drag || !drag.touch) return;
    if (wbFindTouchById(e.touches, drag.touchId)) return; // a different finger
    const touch = wbFindTouchById(e.changedTouches, drag.touchId);
    if (e.type === 'touchcancel' || !touch) { wbCancelRowDrag(); return; }
    wbFinishRowDrag(touch.clientX, touch.clientY);
}

if (typeof window !== 'undefined' && !globalThis.__wbRowDragWired) {
    globalThis.__wbRowDragWired = true;
    window.addEventListener('mousemove', wbRowDragMouseMove);
    window.addEventListener('mouseup', wbRowDragMouseUp);
    window.addEventListener('touchmove', wbRowDragTouchMove, { passive: false });
    window.addEventListener('touchend', wbRowDragTouchEnd);
    window.addEventListener('touchcancel', wbRowDragTouchEnd);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && wbActiveRowDrag) wbCancelRowDrag();
    }, true);
}
