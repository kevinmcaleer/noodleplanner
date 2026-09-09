/**
 * notepad.js -- the notepad list surface (#1049, section A of #783's
 * "democratise planning" plan).
 *
 * A second, deliberately minimal way into a plan: type a line, press
 * Enter, get a task. `Tab` / `Shift+Tab` indent and outdent to build the
 * outline. Drag to reorder. No front matter, no syntax, no jargon on
 * screen -- but the Markdown underneath is still the same document, with
 * the same round-trip, because every mutation goes through plan-model.js
 * (NoodlePlanModel) rather than text-munging.
 *
 * `createNotepadSurface()` is the generic seam #1049 asks for: it takes a
 * container element and `{ getText, setText }` callbacks and knows
 * nothing about `#planEditor`, NavigationController, or Kanban -- so a
 * caller that supplies its own plan text and receives plan text back
 * (the collab post-it whiteboard / joiner interface, #970) can mount one
 * standalone, with no fork. The bottom of this file wires one such
 * surface into the app itself, as the "notepad" view.
 *
 * Kanban-mode decision (#1049 asks this to be made explicit): rather than
 * build a second, lighter grouping UI, "Kanban mode" here switches to the
 * app's *existing* Board view (kanban.js) -- already a lens over this
 * exact plan text, updated the same way (KanbanBoard.commitMarkdown()).
 * List and Board therefore always reflect each other immediately, in
 * both directions, for free: they already share one source of truth (the
 * `#planEditor` textarea), so there is nothing to keep in sync. Building
 * a second board implementation inside this surface would mean two
 * groupings of the same data to maintain, for no benefit over reusing the
 * one that already exists.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NoodleNotepad = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    function resolvePlanModel() {
        if (typeof NoodlePlanModel !== 'undefined') return NoodlePlanModel;
        if (typeof require === 'function') return require('./plan-model.js');
        return null;
    }

    /**
     * Create a notepad surface inside `container`.
     *
     * @param {HTMLElement} container
     * @param {object} options
     * @param {() => string} options.getText - returns the current plan Markdown.
     * @param {(text: string) => void} options.setText - called with the new plan
     *   Markdown whenever the surface changes the document.
     * @param {(text: string) => void} [options.onChange] - fired after setText,
     *   for callers that want a change notification separate from the write itself.
     * @param {() => void} [options.onSwitchToKanban] - if supplied, a "Board"
     *   button is shown; the generic surface has no idea what it does.
     * @param {string} [options.newTaskPlaceholder]
     */
    function createNotepadSurface(container, options) {
        const PlanModelApi = resolvePlanModel();
        const getText = options.getText;
        const setText = options.setText;
        const onChange = options.onChange || function () {};
        const onSwitchToKanban = options.onSwitchToKanban || null;
        const placeholder = options.newTaskPlaceholder || 'Type a task and press Enter…';

        let model = null;
        let lastText = null;
        // The single transient "next line" row. It has no backing TaskNode
        // until it is committed (Enter/blur with non-empty text) -- an empty
        // physical line does not parse as a task at all (see plan-model.js's
        // _parse()), so there is nothing sensible to create until then.
        //
        // `anchor` is held as a TaskNode *object reference*, not an id.
        // PlanModel reassigns every task's numeric `.id` by document
        // position after any structural mutation (insert/remove/reorder --
        // see _refreshTaskOrder()), so a previously-captured id number can
        // end up pointing at a different task the moment anything else in
        // the document shifts. An object reference has no such problem: it
        // stays valid across every mutation *this surface* makes (see
        // ensureModel() -- the model is only ever reparsed, invalidating
        // old references, when the text changed from outside this surface).
        let draft = { anchor: null, indent: 0 };
        let focusRequest = null; // { target: TaskNode|'draft', caret: number|null }
        // One-shot, like focusRequest: text to seed the next-rendered draft
        // row's input with, for a render triggered by something other than
        // the draft itself being committed (see handleIndent()).
        let pendingDraftText = null;

        function ensureModel() {
            const text = getText();
            if (model === null || text !== lastText) {
                model = PlanModelApi.PlanModel.parse(text);
                lastText = text;
            }
            return model;
        }

        function commit() {
            const text = model.serialize();
            lastText = text;
            setText(text);
            onChange(text);
        }

        function draftMaxIndent() {
            return draft.anchor ? draft.anchor.indent + 2 : 0;
        }

        function focusRow(request) {
            focusRequest = request;
            render();
        }

        // ── Row actions ──────────────────────────────────────────────

        function commitDraft(text) {
            const clean = String(text || '').trim();
            if (!clean) return null;
            const m = ensureModel();
            const node = m.insertTaskAfter(draft.anchor, draft.indent, clean);
            commit();
            // The draft always trails whichever task it most recently
            // became -- otherwise the next render would splice a fresh
            // empty draft back in *before* the task just created (both
            // still count as trailing the old anchor's subtree).
            draft = { anchor: node, indent: node.indent };
            return node;
        }

        /** Enter (or blur-with-changed-text) on a real task row: rename it. */
        function commitRename(task, text) {
            const clean = String(text || '').trim();
            if (!clean || clean === task.name) return task;
            const m = ensureModel();
            m.rename(task, clean);
            commit();
            return task;
        }

        function handleEnter(rowState, text) {
            if (rowState.isDraft) {
                const task = commitDraft(text); // repositions the draft after itself
                if (!task) return; // nothing typed -- no-op
            } else {
                const task = commitRename(rowState.task, text);
                draft = { anchor: task, indent: task.indent };
            }
            focusRow({ target: 'draft', caret: 0 });
        }

        /**
         * A blur that didn't change anything (the common case: the user
         * clicked or arrow-keyed to a different row) does no work at all --
         * no model mutation, no DOM rebuild -- so plain focus movement
         * between rows is never disturbed by a rebuild racing the browser's
         * own focus hand-off. `refocus`, when given, is where focus should
         * land *after* a rebuild that a real change does require.
         */
        function handleBlur(rowState, text, refocus) {
            let mutated = false;
            if (rowState.isDraft) {
                mutated = !!commitDraft(text);
            } else {
                const clean = String(text || '').trim();
                mutated = Boolean(clean) && clean !== rowState.task.name;
                if (mutated) commitRename(rowState.task, text);
            }
            if (!mutated) return;
            if (refocus) focusRow(refocus);
            else render();
        }

        function handleIndent(rowState, direction, text) {
            const m = ensureModel();
            if (rowState.isDraft) {
                // Tab/Shift+Tab re-renders (indentation changes the draft's
                // display position) -- carry forward whatever's already
                // typed via pendingDraftText, or it would vanish: the
                // rebuilt draft row otherwise always starts empty (see
                // buildRow()), since a draft isn't a TaskNode this text can
                // live in until it's committed.
                pendingDraftText = text;
                const next = draft.indent + (direction * 2);
                draft.indent = Math.max(0, Math.min(next, draftMaxIndent()));
                focusRow({ target: 'draft', caret: -1 });
                return;
            }
            // Sync any in-progress rename first -- otherwise indenting a
            // task mid-edit would re-render it back to its old name.
            const clean = String(text || '').trim();
            if (clean && clean !== rowState.task.name) m.rename(rowState.task, clean);
            if (direction > 0) m.indentTasks([rowState.task]);
            else m.outdentTasks([rowState.task]);
            commit();
            focusRow({ target: rowState.task, caret: null });
        }

        function handleBackspace(rowState) {
            const m = ensureModel();
            if (rowState.isDraft) {
                if (!draft.anchor) return; // nothing before the draft
                focusRow({ target: draft.anchor, caret: -1 });
                return;
            }
            const order = m.tasks;
            const index = order.indexOf(rowState.task);
            const previous = index > 0 ? order[index - 1] : null;
            if (!m.removeTask(rowState.task)) return; // has children -- refuse
            commit();
            if (previous) {
                focusRow({ target: previous, caret: -1 });
            } else {
                draft = { anchor: null, indent: 0 };
                focusRow({ target: 'draft', caret: 0 });
            }
        }

        function reorder(sourceTaskId, targetTaskId, insertBefore) {
            const m = ensureModel();
            const source = m.findById(sourceTaskId);
            const target = m.findById(targetTaskId);
            if (!source || !target || source === target) return;
            const moved = insertBefore ? m.moveBefore(source, target) : m.moveAfter(source, target);
            if (!moved) return;
            commit();
            render();
        }

        // ── Rendering ────────────────────────────────────────────────

        function indentPx(indent) {
            return 12 + (indent / 2) * 22;
        }

        function buildRow(rowState) {
            const row = document.createElement('div');
            row.className = 'notepad-row' + (rowState.isDraft ? ' notepad-row--draft' : '');
            row.setAttribute('role', 'listitem');
            row.style.paddingLeft = indentPx(rowState.indent) + 'px';
            if (!rowState.isDraft) {
                row.dataset.taskId = String(rowState.task.id);
                // Held for the blur handler's refocus lookup (below) --
                // object identity survives id renumbering, a captured
                // dataset id would not (see the `draft.anchor` comment above).
                row._notepadTask = rowState.task;
            }

            if (!rowState.isDraft) {
                const handle = document.createElement('span');
                handle.className = 'notepad-drag-handle';
                handle.setAttribute('draggable', 'true');
                handle.setAttribute('aria-label', 'Drag to reorder');
                handle.setAttribute('title', 'Drag to reorder');
                handle.textContent = '☰';
                row.appendChild(handle);
                attachDragHandlers(handle, row, rowState.task);
            } else {
                const spacer = document.createElement('span');
                spacer.className = 'notepad-drag-handle notepad-drag-handle--hidden';
                row.appendChild(spacer);
            }

            const bullet = document.createElement('span');
            bullet.className = 'notepad-bullet';
            row.appendChild(bullet);

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'notepad-input';
            input.value = rowState.isDraft ? (pendingDraftText != null ? pendingDraftText : '') : rowState.task.name;
            if (rowState.isDraft) input.placeholder = placeholder;
            input.setAttribute('aria-label', rowState.isDraft ? 'New task' : rowState.task.name);
            row.appendChild(input);

            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleEnter(rowState, input.value);
                } else if (event.key === 'Tab') {
                    event.preventDefault();
                    handleIndent(rowState, event.shiftKey ? -1 : 1, input.value);
                } else if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0) {
                    event.preventDefault();
                    handleBackspace(rowState);
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    const inputs = Array.from(container.querySelectorAll('.notepad-input'));
                    const index = inputs.indexOf(input) + (event.key === 'ArrowDown' ? 1 : -1);
                    if (index >= 0 && index < inputs.length) {
                        event.preventDefault();
                        inputs[index].focus();
                    }
                }
            });
            input.addEventListener('blur', event => {
                // A blur triggered by a key handler that is about to
                // re-render (Enter/Tab/Backspace) races the rebuild; those
                // paths already commit, so only commit here for a "plain"
                // blur (the user clicked/arrow-keyed/tabbed away).
                if (focusRequest) return;
                const movingTo = event.relatedTarget && event.relatedTarget.closest
                    ? event.relatedTarget.closest('.notepad-row')
                    : null;
                const refocus = movingTo && container.contains(movingTo)
                    ? { target: movingTo._notepadTask || 'draft', caret: null }
                    : null;
                handleBlur(rowState, input.value, refocus);
                // An emptied-out real task's rename is correctly refused
                // (renaming to blank isn't allowed), but that leaves this
                // node's input showing blank with nothing to trigger a
                // rebuild -- revert the visible text directly rather than
                // paying for a full render() just for this.
                if (!rowState.isDraft && !input.value.trim() && input.isConnected) {
                    input.value = rowState.task.name;
                }
            });

            if (focusRequest) {
                const wantsDraft = rowState.isDraft && focusRequest.target === 'draft';
                const wantsTask = !rowState.isDraft && focusRequest.target === rowState.task;
                if (wantsDraft || wantsTask) {
                    // render() resets the shared `focusRequest` variable to
                    // null right after scheduling this (so the *next*
                    // render starts clean) -- capture the caret now rather
                    // than reading focusRequest.caret inside the deferred
                    // callback, which would see null by the time it runs.
                    const caret = focusRequest.caret;
                    requestAnimationFrame(() => {
                        input.focus();
                        if (caret === -1) input.setSelectionRange(input.value.length, input.value.length);
                        else if (typeof caret === 'number') input.setSelectionRange(caret, caret);
                    });
                }
            }

            return row;
        }

        function isSelfOrDescendant(task, anchor) {
            for (let node = task; node; node = node.parent) if (node === anchor) return true;
            return false;
        }

        /**
         * Flatten the tree into display rows, splicing the draft in at
         * wherever it will actually land once committed: immediately after
         * the *whole* subtree of its anchor task (matching
         * PlanModel.insertTaskAfter()'s own placement rule -- see that
         * method's doc comment -- so the draft never visually jumps once
         * it becomes real).
         */
        function flattenRows() {
            const m = ensureModel();
            const rows = [];
            const walk = task => {
                rows.push({ isDraft: false, task, indent: task.indent });
                task.children.forEach(walk);
            };
            m.roots.forEach(walk);

            let insertIndex = rows.length;
            if (draft.anchor) {
                insertIndex = 0;
                for (let i = rows.length - 1; i >= 0; i--) {
                    if (isSelfOrDescendant(rows[i].task, draft.anchor)) { insertIndex = i + 1; break; }
                }
            }
            rows.splice(insertIndex, 0, { isDraft: true, indent: draft.indent });
            return rows;
        }

        function render() {
            const m = ensureModel();
            // A stale anchor -- the task it pointed at is gone, either
            // removed by this surface's own removeTask() (already handled
            // at the call site) or because getText() changed underneath us
            // and ensureModel() reparsed into all-new TaskNode objects --
            // falls back to "end of document" rather than silently
            // dropping the draft.
            if (draft.anchor && m.tasks.indexOf(draft.anchor) === -1) {
                draft = { anchor: null, indent: 0 };
            }
            const rowsEl = container.querySelector('.notepad-rows');
            rowsEl.innerHTML = '';
            const fragment = document.createDocumentFragment();
            flattenRows().forEach(rowState => fragment.appendChild(buildRow(rowState)));
            rowsEl.appendChild(fragment);
            focusRequest = null;
            pendingDraftText = null;
        }

        // ── Drag to reorder (mouse: native HTML5 DnD; touch: pointer events,
        // mirroring kanban.js's setupPointerCardDrag so both surfaces behave
        // the same way) ──────────────────────────────────────────────

        function clearDropIndicators() {
            container.querySelectorAll('.notepad-row.notepad-drop-before, .notepad-row.notepad-drop-after')
                .forEach(el => el.classList.remove('notepad-drop-before', 'notepad-drop-after'));
        }

        function attachDragHandlers(handle, row, task) {
            handle.addEventListener('dragstart', event => {
                row.classList.add('notepad-dragging');
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(task.id));
                event.dataTransfer.setDragImage(row, 0, row.offsetHeight / 2);
            });
            handle.addEventListener('dragend', () => {
                row.classList.remove('notepad-dragging');
                clearDropIndicators();
            });
            row.addEventListener('dragover', event => {
                if (event.dataTransfer.types.indexOf('text/plain') === -1) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const rect = row.getBoundingClientRect();
                const before = event.clientY < rect.top + rect.height / 2;
                clearDropIndicators();
                row.classList.add(before ? 'notepad-drop-before' : 'notepad-drop-after');
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('notepad-drop-before', 'notepad-drop-after');
            });
            row.addEventListener('drop', event => {
                event.preventDefault();
                clearDropIndicators();
                const sourceId = parseInt(event.dataTransfer.getData('text/plain'), 10);
                if (isNaN(sourceId) || sourceId === task.id) return;
                const rect = row.getBoundingClientRect();
                const before = event.clientY < rect.top + rect.height / 2;
                reorder(sourceId, task.id, before);
            });

            let gesture = null;
            handle.addEventListener('pointerdown', event => {
                if (event.pointerType === 'mouse') return;
                gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false };
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', event => {
                if (!gesture || event.pointerId !== gesture.pointerId) return;
                const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
                if (!gesture.dragging && distance < 8) return;
                gesture.dragging = true;
                event.preventDefault();
                row.classList.add('notepad-dragging');
                const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.notepad-row');
                clearDropIndicators();
                gesture.target = target && target !== row ? target : null;
                if (gesture.target) {
                    const rect = gesture.target.getBoundingClientRect();
                    gesture.before = event.clientY < rect.top + rect.height / 2;
                    gesture.target.classList.add(gesture.before ? 'notepad-drop-before' : 'notepad-drop-after');
                }
            });
            const finishPointer = event => {
                if (!gesture || event.pointerId !== gesture.pointerId) return;
                const completed = gesture;
                gesture = null;
                row.classList.remove('notepad-dragging');
                clearDropIndicators();
                if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
                if (event.type !== 'pointercancel' && completed.dragging && completed.target) {
                    const targetId = parseInt(completed.target.dataset.taskId, 10);
                    if (!isNaN(targetId)) reorder(task.id, targetId, completed.before);
                }
            };
            handle.addEventListener('pointerup', finishPointer);
            handle.addEventListener('pointercancel', finishPointer);
        }

        // ── Chrome (header + rows container) ────────────────────────

        container.innerHTML = '';
        container.classList.add('notepad-surface');
        if (onSwitchToKanban) {
            const header = document.createElement('div');
            header.className = 'notepad-toolbar';
            const hint = document.createElement('span');
            hint.className = 'notepad-hint';
            hint.textContent = 'Type a line, press Enter. Tab / Shift+Tab to indent.';
            header.appendChild(hint);
            const kanbanBtn = document.createElement('button');
            kanbanBtn.type = 'button';
            kanbanBtn.className = 'notepad-kanban-btn';
            kanbanBtn.textContent = 'Board view';
            kanbanBtn.addEventListener('click', onSwitchToKanban);
            header.appendChild(kanbanBtn);
            container.appendChild(header);
        }
        const rowsEl = document.createElement('div');
        rowsEl.className = 'notepad-rows';
        rowsEl.setAttribute('role', 'list');
        rowsEl.setAttribute('aria-label', 'Task list');
        container.appendChild(rowsEl);

        // The initial draft anchors after the last root-level task, if any,
        // so opening the surface always offers a ready-to-type line.
        function resetDraftToEnd() {
            const m = ensureModel();
            const last = m.tasks[m.tasks.length - 1] || null;
            draft = { anchor: last, indent: last ? last.indent : 0 };
        }

        resetDraftToEnd();
        render();

        return {
            /** Re-read getText() and rebuild the surface from scratch. */
            refresh() {
                model = null;
                lastText = null;
                resetDraftToEnd();
                render();
            },
            /** True while a row in this surface currently has focus. */
            hasFocus() {
                return container.contains(document.activeElement);
            },
            destroy() {
                container.innerHTML = '';
                container.classList.remove('notepad-surface');
            },
        };
    }

    return { createNotepadSurface };
});

// ── App wiring: NoodlePlanner's own "notepad" view ──────────────────────
// Everything above is the reusable, DOM-only-otherwise-generic surface;
// this is the one place that knows about #planEditor, NavigationController
// and the Board view -- exactly the kind of app-specific glue #1049 asks
// to be kept out of createNotepadSurface() itself, so a different host
// (the collab joiner, #970) isn't stuck with it.
if (typeof document !== 'undefined') {
    let appNotepadSurface = null;

    function ensureAppNotepadSurface() {
        if (appNotepadSurface) return appNotepadSurface;
        const container = document.getElementById('notepadContainer');
        const editor = document.getElementById('planEditor');
        if (!container || !editor) return null;

        appNotepadSurface = NoodleNotepad.createNotepadSurface(container, {
            getText: () => editor.value,
            setText: (text) => {
                editor.value = text;
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            },
            onSwitchToKanban: () => {
                if (typeof NavigationController !== 'undefined') NavigationController.navigateTo('kanban');
            },
        });

        // The plan editor and this view can be visible side by side (the
        // same split layout every other view already shares) -- keep the
        // list in sync with edits made directly in the raw editor, but
        // never while a row in this surface is itself mid-edit.
        editor.addEventListener('input', () => {
            const view = document.getElementById('notepad-view');
            const isVisible = view && view.classList.contains('active');
            if (isVisible && !appNotepadSurface.hasFocus()) appNotepadSurface.refresh();
        });

        return appNotepadSurface;
    }

    /** Called by nav.js's switchOutputTab() whenever the notepad view activates. */
    window.activateNotepadView = function activateNotepadView() {
        const surface = ensureAppNotepadSurface();
        if (surface) surface.refresh();
    };
}
