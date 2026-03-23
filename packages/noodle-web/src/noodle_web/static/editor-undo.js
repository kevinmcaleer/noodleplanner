/**
 * editor-undo.js — Undo/redo history manager for the plan editor.
 * Stores snapshots of editor content in sessionStorage so that history
 * persists within the browser session but NOT across sessions or in the
 * markdown file itself.
 *
 * Depends on: state.js (globals), editor.js (setupEditor)
 */

const EditorUndoManager = (function () {
    const STORAGE_KEY = 'noodle_undo_history';
    const REDO_KEY = 'noodle_redo_history';
    const MAX_HISTORY = 100; // cap to avoid unbounded growth

    let debounceTimer = null;
    const DEBOUNCE_MS = 600;

    // In-memory mirrors so we don't parse JSON on every keystroke
    let undoStack = [];
    let redoStack = [];

    // ------- persistence helpers -------

    function persist() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(undoStack));
            sessionStorage.setItem(REDO_KEY, JSON.stringify(redoStack));
        } catch (_) {
            // sessionStorage might be full – silently ignore
        }
    }

    function load() {
        try {
            const u = sessionStorage.getItem(STORAGE_KEY);
            const r = sessionStorage.getItem(REDO_KEY);
            undoStack = u ? JSON.parse(u) : [];
            redoStack = r ? JSON.parse(r) : [];
        } catch (_) {
            undoStack = [];
            redoStack = [];
        }
    }

    // ------- public API -------

    /**
     * Record a snapshot of the editor content.  Called on every editor input
     * event (debounced) so that trivial intermediate states are collapsed.
     */
    function pushSnapshot(content) {
        // Don't push duplicates
        if (undoStack.length > 0 && undoStack[undoStack.length - 1] === content) {
            return;
        }
        undoStack.push(content);
        if (undoStack.length > MAX_HISTORY) {
            undoStack.shift();
        }
        // Any new edit clears the redo stack
        redoStack = [];
        persist();
        refreshButtons();
    }

    /**
     * Schedule a snapshot after the debounce window.  Should be called on
     * every `input` event from the editor.
     */
    function scheduleSnapshot(content) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            pushSnapshot(content);
            debounceTimer = null;
        }, DEBOUNCE_MS);
    }

    /**
     * Immediately capture a snapshot (no debounce).
     * Use this for programmatic changes like indent/outdent/link that
     * should always be individually undoable.
     */
    function captureImmediate(content) {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        pushSnapshot(content);
    }

    function undo() {
        const editor = document.getElementById('planEditor');
        if (!editor || undoStack.length === 0) return;

        // The top of the undo stack is the *current* state; we need to pop
        // it and move to the previous one.
        const current = undoStack.pop();
        redoStack.push(current);

        if (undoStack.length === 0) {
            // Nothing left to undo
            persist();
            refreshButtons();
            return;
        }

        const previous = undoStack[undoStack.length - 1];
        editor.value = previous;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        persist();
        refreshButtons();
    }

    function redo() {
        const editor = document.getElementById('planEditor');
        if (!editor || redoStack.length === 0) return;

        const next = redoStack.pop();
        undoStack.push(next);
        editor.value = next;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        persist();
        refreshButtons();
    }

    function canUndo() {
        return undoStack.length > 1; // need at least 2: current + previous
    }

    function canRedo() {
        return redoStack.length > 0;
    }

    function refreshButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = !canUndo();
        if (redoBtn) redoBtn.disabled = !canRedo();
    }

    /**
     * Initialise: restore stacks from sessionStorage, seed the initial
     * snapshot if the undo stack is empty, and wire up keyboard shortcuts.
     */
    function init() {
        load();

        const editor = document.getElementById('planEditor');
        if (editor && editor.value) {
            // Seed with the initial content so the very first undo has
            // somewhere to return to.
            if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== editor.value) {
                undoStack.push(editor.value);
                persist();
            }
        }

        refreshButtons();

        // Global keyboard shortcut (works even when editor is not focused)
        document.addEventListener('keydown', function (e) {
            // Ctrl+Z  /  Cmd+Z  →  undo
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
                // Only intercept if the plan editor panel is visible
                const editorPanel = document.querySelector('.editor-panel');
                if (!editorPanel || editorPanel.offsetParent === null) return;
                e.preventDefault();
                undo();
            }
            // Ctrl+Shift+Z / Cmd+Shift+Z  or  Ctrl+Y / Cmd+Y  →  redo
            if (
                ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') ||
                ((e.ctrlKey || e.metaKey) && e.key === 'y')
            ) {
                const editorPanel = document.querySelector('.editor-panel');
                if (!editorPanel || editorPanel.offsetParent === null) return;
                e.preventDefault();
                redo();
            }
        });
    }

    return {
        init,
        scheduleSnapshot,
        captureImmediate,
        pushSnapshot,
        undo,
        redo,
        canUndo,
        canRedo,
        refreshButtons,
    };
})();
