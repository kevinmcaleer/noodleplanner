/**
 * gantt-editor-link.js -- two-way hover highlight between a Gantt row and
 * the markdown line it came from (#1271, under the #1264 Gantt epic).
 *
 * Hovering a Gantt row (either half) highlights the plan line that produced
 * it and scrolls the editor to it; hovering a plan line highlights that
 * task's Gantt row (both halves) and scrolls the Gantt to it. Nothing is
 * edited and nothing is re-rendered -- this module only adds and removes a
 * class and moves two scroll positions.
 *
 * The decisions the issue asked to be made explicit:
 *
 * - **Hover surface in the editor: the text, not just the gutter.** The
 *   epic's wording is "hovering over a line in the markdown editor", and a
 *   gutter-only target would be undiscoverable. The highlight layer is
 *   `pointer-events: none` and the textarea reports no per-line target, so
 *   the line is derived from `clientY` against the editor's own text
 *   metrics -- which is folding-correct for free, because the textarea's
 *   content *is* the folded projection. The gutter is wired as well, since
 *   it is the same calculation and costs nothing.
 *
 * - **A task whose line is inside a collapsed section: highlight the fold
 *   header.** Expanding a section on hover would move text under the
 *   pointer, and doing nothing leaves the hover looking broken. The fold
 *   header is where that line visibly lives while the section is closed, so
 *   that is what lights up. See `visibleLineForRawLine()`.
 *
 * - **A Gantt row hidden under a collapsed summary: highlight the nearest
 *   visible ancestor.** Same reasoning mirrored. Scrolling to a row with
 *   `display: none` would scroll to a zero-height target; the collapsed
 *   summary that swallowed it is the row the user can actually see. See
 *   `visibleRowIndex()`.
 *
 * - **Hover, not selection.** The epic asks for hover. `tr.selected` is left
 *   alone for a future click-to-select rather than repurposed here, so the
 *   two states can coexist.
 *
 * Cost: listeners are delegated on `#ganttInfoBody`, `#ganttBody`,
 * `#planEditor` and `#lineNumbers` -- four in total, regardless of how many
 * rows the plan has. The line->task mapping is built once per plan and
 * cached, rather than resolved per `mousemove`.
 */
(function () {
    'use strict';

    var LINKED_ROW_CLASS = 'gantt-linked-row';
    var LINKED_LINE_CLASS = 'gantt-linked-line';
    var OVERLAY_ID = 'editorLinkOverlay';

    // Which pane the pointer is in. The guard against the two directions
    // feeding each other: a Gantt hover scrolls the editor, and that scroll
    // must not be read back as an editor hover that scrolls the Gantt back
    // to where it started. Only the pane named here may drive.
    var activeSource = null;

    // Scrolling a pane the user is working in is disorienting, so a pane
    // that has been scrolled by hand very recently is left alone.
    var USER_SCROLL_GRACE_MS = 400;
    var lastUserScroll = { editor: 0, gantt: 0 };
    var programmaticScroll = { editor: false, gantt: false };

    // The editor line the pointer was last seen on. Module-scoped rather
    // than closed over by the mousemove handler because clear() has to reset
    // it: without that, leaving the gutter and returning to the same line in
    // the text would be read as "no change" and the highlight would not come
    // back.
    var lastEditorLine = -1;

    // Cached raw-line -> gantt task index map, rebuilt when the plan changes.
    var lineToTask = null;
    var lineToTaskStamp = null;

    function el(id) { return document.getElementById(id); }

    function tasks() {
        // `ganttTasks` is a top-level `let` in state.js, so it is a global
        // lexical binding rather than a property of window.
        return typeof ganttTasks !== 'undefined' && ganttTasks ? ganttTasks : [];
    }

    function taskLineNumber(task) {
        if (typeof findTaskLineNumber !== 'function') return -1;
        return findTaskLineNumber(task);
    }

    /** Hover is a pointer gesture. On a touch screen there is no hover, and
     * a synthesised one leaves a highlight stuck after the finger lifts. */
    function hoverCapable() {
        if (typeof window.matchMedia !== 'function') return true;
        try {
            return window.matchMedia('(hover: hover)').matches;
        } catch (err) {
            return true;
        }
    }

    /** The feature is inert unless both panes are actually on screen. */
    function isActive() {
        var ganttView = document.getElementById('gantt-view');
        if (!ganttView || !ganttView.classList.contains('active')) return false;
        var panel = document.querySelector('.editor-panel');
        if (!panel || panel.classList.contains('collapsed')) return false;
        return true;
    }

    // ── Editor geometry ──────────────────────────────────────────────────
    //
    // Everything below measures the highlight layer rather than the
    // textarea. The two carry identical text metrics by contract (see the
    // shared-properties block in views/gantt.css), and the layer is what
    // paints the glyphs the band has to line up with.

    function metrics() {
        var editor = el('planEditor');
        var layer = el('highlightLayer');
        if (!editor || !layer) return null;
        var style = window.getComputedStyle(layer);
        var lineHeight = parseFloat(style.lineHeight);
        if (!lineHeight || isNaN(lineHeight)) lineHeight = parseFloat(style.fontSize) * 1.5;
        var paddingTop = parseFloat(style.paddingTop) || 0;
        if (!lineHeight || isNaN(lineHeight)) return null;
        return { editor: editor, lineHeight: lineHeight, paddingTop: paddingTop };
    }

    /** Which visible (projected) line is under `clientY`, 1-based, or -1. */
    function visibleLineAtClientY(clientY) {
        var m = metrics();
        if (!m) return -1;
        var rect = m.editor.getBoundingClientRect();
        var y = clientY - rect.top + m.editor.scrollTop - m.paddingTop;
        if (y < 0) return -1;
        var line = Math.floor(y / m.lineHeight) + 1;
        var gutter = el('lineNumbers');
        var count = gutter ? gutter.querySelectorAll('.line-number').length : 0;
        if (count && line > count) return -1;
        return line;
    }

    /** The gutter row for a visible line, which carries both line numbers. */
    function gutterRowForVisibleLine(visibleLine) {
        var gutter = el('lineNumbers');
        if (!gutter || visibleLine < 1) return null;
        return gutter.querySelector('.line-number[data-visible-line="' + visibleLine + '"]')
            || gutter.children[visibleLine - 1]
            || null;
    }

    /**
     * Map a *raw* plan line (what findTaskLineNumber returns) to the visible
     * line showing it. `data-line-number` and `data-visible-line` are not
     * interchangeable -- section folding is exactly why editor.js writes
     * both -- so the gutter is asked rather than assumed.
     *
     * When the raw line is inside a collapsed section it has no gutter row of
     * its own. The decision recorded at the top of this file applies: fall
     * back to the fold header standing in for that section, which is the last
     * header row at or before the raw line.
     */
    function visibleLineForRawLine(rawLine) {
        var gutter = el('lineNumbers');
        if (!gutter || !(rawLine > 0)) return { visibleLine: -1, folded: false };

        var exact = gutter.querySelector('.line-number[data-line-number="' + rawLine + '"]');
        if (exact) {
            return {
                visibleLine: parseInt(exact.dataset.visibleLine, 10) || -1,
                folded: exact.dataset.foldHeader === 'true',
            };
        }

        var rows = gutter.querySelectorAll('.line-number[data-fold-header="true"]');
        var best = null;
        for (var i = 0; i < rows.length; i++) {
            var n = parseInt(rows[i].dataset.lineNumber, 10);
            if (n > 0 && n <= rawLine) best = rows[i]; else if (n > rawLine) break;
        }
        if (!best) return { visibleLine: -1, folded: false };
        return { visibleLine: parseInt(best.dataset.visibleLine, 10) || -1, folded: true };
    }

    // ── The line -> task map ─────────────────────────────────────────────

    /** A cheap stamp that changes whenever the plan or the chart does. */
    function planStamp() {
        var editor = el('planEditor');
        var text = editor ? editor.value : '';
        return text.length + ':' + tasks().length;
    }

    function taskIndexForRawLine(rawLine) {
        var stamp = planStamp();
        if (!lineToTask || lineToTaskStamp !== stamp) {
            lineToTask = new Map();
            var list = tasks();
            for (var i = 0; i < list.length; i++) {
                var ln = taskLineNumber(list[i]);
                // findTaskLineNumber() resolves through NoodlePlanModel by
                // `_uid`, so two tasks with the same name land on their own
                // lines rather than both on the first. First writer wins for
                // the pathological case where they truly collide.
                if (ln > 0 && !lineToTask.has(ln)) lineToTask.set(ln, i);
            }
            lineToTaskStamp = stamp;
        }
        return lineToTask.has(rawLine) ? lineToTask.get(rawLine) : -1;
    }

    function invalidate() {
        lineToTask = null;
        lineToTaskStamp = null;
    }

    // ── Gantt rows ───────────────────────────────────────────────────────

    function rowsForIndex(index) {
        var infoBody = el('ganttInfoBody');
        var barBody = el('ganttBody');
        var sel = '[data-task-index="' + index + '"]';
        return {
            info: infoBody ? infoBody.querySelector('tr' + sel) : null,
            bar: barBody ? barBody.querySelector('.gantt-bar-row' + sel) : null,
        };
    }

    function rowIsVisible(row) {
        return !!row && row.style.display !== 'none';
    }

    /**
     * The index of the row that will actually be on screen for `index`.
     * A row under a collapsed summary carries `display: none`; scrolling to
     * it would scroll to a zero-height target, so walk back to the nearest
     * visible row -- the collapsed summary that swallowed it. Returns -1 if
     * nothing above it is visible either.
     */
    function visibleRowIndex(index) {
        for (var i = index; i >= 0; i--) {
            var rows = rowsForIndex(i);
            if (rowIsVisible(rows.info) || rowIsVisible(rows.bar)) return i;
        }
        return -1;
    }

    // ── Applying and clearing the highlight ──────────────────────────────

    function clearGanttHighlight() {
        var nodes = document.querySelectorAll('.' + LINKED_ROW_CLASS);
        for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove(LINKED_ROW_CLASS);
    }

    function clearEditorHighlight() {
        var overlay = el(OVERLAY_ID);
        if (overlay) overlay.innerHTML = '';
        var lines = document.querySelectorAll('#lineNumbers .' + LINKED_LINE_CLASS);
        for (var i = 0; i < lines.length; i++) lines[i].classList.remove(LINKED_LINE_CLASS);
    }

    function clear() {
        clearGanttHighlight();
        clearEditorHighlight();
        activeSource = null;
        lastEditorLine = -1;
    }

    function highlightGanttRows(index) {
        clearGanttHighlight();
        if (index < 0) return false;
        var rows = rowsForIndex(index);
        var hit = false;
        if (rows.info) { rows.info.classList.add(LINKED_ROW_CLASS); hit = true; }
        if (rows.bar) { rows.bar.classList.add(LINKED_ROW_CLASS); hit = true; }
        return hit;
    }

    function ensureOverlay() {
        var overlay = el(OVERLAY_ID);
        if (overlay) return overlay;
        var area = document.querySelector('.editor-area');
        if (!area) return null;
        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'editor-link-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        // Before the highlight layer, so it paints beneath it even without
        // the z-index (which is there anyway).
        area.insertBefore(overlay, area.firstChild);
        syncOverlay();
        return overlay;
    }

    /** Keep the overlay in the same plane as the text. Called from
     * editor.js's syncScroll(), which is the one path that is guaranteed to
     * fire for every way the editor can scroll. */
    function syncOverlay(scrollTop, scrollLeft) {
        var overlay = el(OVERLAY_ID);
        if (!overlay) return;
        var editor = el('planEditor');
        var top = typeof scrollTop === 'number' ? scrollTop : (editor ? editor.scrollTop : 0);
        var left = typeof scrollLeft === 'number' ? scrollLeft : (editor ? editor.scrollLeft : 0);
        overlay.style.transform = 'translate(' + (-left) + 'px, ' + (-top) + 'px)';
    }

    function highlightEditorLine(visibleLine) {
        clearEditorHighlight();
        if (!(visibleLine > 0)) return false;
        var m = metrics();
        var overlay = ensureOverlay();
        if (!m || !overlay) return false;

        var band = document.createElement('div');
        band.className = 'editor-link-band';
        band.style.top = (m.paddingTop + (visibleLine - 1) * m.lineHeight) + 'px';
        band.style.height = m.lineHeight + 'px';
        overlay.appendChild(band);
        syncOverlay();

        var gutterRow = gutterRowForVisibleLine(visibleLine);
        if (gutterRow) gutterRow.classList.add(LINKED_LINE_CLASS);
        return true;
    }

    // ── Scrolling ────────────────────────────────────────────────────────

    function userIsBusyWith(pane) {
        return (Date.now() - lastUserScroll[pane]) < USER_SCROLL_GRACE_MS;
    }

    function scrollEditorToLine(visibleLine) {
        var m = metrics();
        if (!m || !(visibleLine > 0)) return;
        // Never move a pane the user is typing in or scrolling.
        if (document.activeElement === m.editor) return;
        if (userIsBusyWith('editor')) return;

        var top = m.paddingTop + (visibleLine - 1) * m.lineHeight;
        var viewTop = m.editor.scrollTop;
        var viewBottom = viewTop + m.editor.clientHeight;
        if (top >= viewTop + m.lineHeight && top + m.lineHeight <= viewBottom - m.lineHeight) return;

        // The flag is only raised when the scroll position genuinely moves.
        // Raising it for a no-op assignment fires no scroll event to lower it
        // again, and the flag would then swallow the user's next real scroll.
        var want = Math.max(0, top - (m.editor.clientHeight / 2) + (m.lineHeight / 2));
        if (Math.round(want) === Math.round(m.editor.scrollTop)) return;
        programmaticScroll.editor = true;
        m.editor.scrollTop = want;
    }

    function scrollGanttToRow(index) {
        if (index < 0) return;
        if (userIsBusyWith('gantt')) return;
        var rows = rowsForIndex(index);
        var tableSide = document.querySelector('#gantt-view .gantt-table-side');
        var chartSide = document.querySelector('#gantt-view .gantt-chart-side');

        // The two halves scroll separately, so both are moved -- and each is
        // moved from its own row, because the two containers do not share an
        // origin.
        pairScroll(tableSide, rows.info);
        pairScroll(chartSide, rows.bar);
    }

    function pairScroll(container, row) {
        if (!container || !rowIsVisible(row)) return;
        if (document.activeElement && container.contains(document.activeElement)) return;
        var cRect = container.getBoundingClientRect();
        var rRect = row.getBoundingClientRect();
        if (rRect.top >= cRect.top && rRect.bottom <= cRect.bottom) return;
        var want = container.scrollTop
            + (rRect.top - cRect.top) - (container.clientHeight / 2) + (rRect.height / 2);
        want = Math.max(0, want);
        if (Math.round(want) === Math.round(container.scrollTop)) return;
        programmaticScroll.gantt = true;
        container.scrollTop = want;
    }

    // ── Direction: Gantt -> editor ───────────────────────────────────────

    function onGanttHover(index) {
        if (!isActive()) return;
        if (activeSource === 'editor') return;
        activeSource = 'gantt';

        highlightGanttRows(index);

        var list = tasks();
        var task = list[index];
        if (!task) { clearEditorHighlight(); return; }

        var rawLine = taskLineNumber(task);
        if (!(rawLine > 0)) {
            // No resolvable line (a rolled-up or synthetic row): degrade
            // silently, leaving the Gantt half highlighted.
            clearEditorHighlight();
            return;
        }

        var mapped = visibleLineForRawLine(rawLine);
        if (!(mapped.visibleLine > 0)) { clearEditorHighlight(); return; }
        highlightEditorLine(mapped.visibleLine);
        scrollEditorToLine(mapped.visibleLine);
    }

    // ── Direction: editor -> Gantt ───────────────────────────────────────

    function onEditorHover(visibleLine) {
        if (!isActive()) return;
        if (activeSource === 'gantt') return;

        if (!(visibleLine > 0)) { clear(); return; }
        var gutterRow = gutterRowForVisibleLine(visibleLine);
        if (!gutterRow) { clear(); return; }

        // A fold header is not a task line.
        if (gutterRow.dataset.foldHeader === 'true') { clear(); return; }

        var rawLine = parseInt(gutterRow.dataset.lineNumber, 10);
        var index = taskIndexForRawLine(rawLine);
        if (index < 0) {
            // Front matter, a blank line, a section header: nothing to link.
            clear();
            return;
        }

        activeSource = 'editor';
        highlightEditorLine(visibleLine);

        var target = visibleRowIndex(index);
        if (target < 0) { clearGanttHighlight(); return; }
        highlightGanttRows(target);
        scrollGanttToRow(target);
    }

    // ── Wiring ───────────────────────────────────────────────────────────

    function rowIndexFromEvent(event, selector) {
        var node = event.target && event.target.closest ? event.target.closest(selector) : null;
        if (!node) return -1;
        var raw = parseInt(node.dataset.taskIndex, 10);
        return isNaN(raw) ? -1 : raw;
    }

    function init() {
        if (!hoverCapable()) return;

        var infoBody = el('ganttInfoBody');
        var barBody = el('ganttBody');
        var editor = el('planEditor');
        var gutter = el('lineNumbers');

        if (infoBody) {
            infoBody.addEventListener('mouseover', function (event) {
                var index = rowIndexFromEvent(event, 'tr[data-task-index]');
                if (index >= 0) onGanttHover(index);
            });
            infoBody.addEventListener('mouseleave', clear);
        }

        if (barBody) {
            barBody.addEventListener('mouseover', function (event) {
                var index = rowIndexFromEvent(event, '.gantt-bar-row[data-task-index]');
                if (index >= 0) onGanttHover(index);
            });
            barBody.addEventListener('mouseleave', clear);
        }

        if (editor) {
            editor.addEventListener('mousemove', function (event) {
                var line = visibleLineAtClientY(event.clientY);
                // Only act when the pointer crosses into a different line --
                // a mousemove fires per pixel, and the work below is not
                // free.
                if (line === lastEditorLine) return;
                lastEditorLine = line;
                onEditorHover(line);
            });
            editor.addEventListener('mouseleave', clear);
            editor.addEventListener('scroll', function () {
                if (programmaticScroll.editor) { programmaticScroll.editor = false; return; }
                lastUserScroll.editor = Date.now();
            });
            // A re-render of the editor (any edit) rebuilds the gutter and
            // moves every line, so no highlight may survive it.
            editor.addEventListener('input', function () { invalidate(); clear(); });
        }

        if (gutter) {
            gutter.addEventListener('mouseover', function (event) {
                var row = event.target && event.target.closest ? event.target.closest('.line-number') : null;
                if (!row) return;
                onEditorHover(parseInt(row.dataset.visibleLine, 10));
            });
            gutter.addEventListener('mouseleave', clear);
        }

        ['.gantt-table-side', '.gantt-chart-side'].forEach(function (selector) {
            var pane = document.querySelector('#gantt-view ' + selector);
            if (!pane) return;
            pane.addEventListener('scroll', function () {
                if (programmaticScroll.gantt) { programmaticScroll.gantt = false; return; }
                lastUserScroll.gantt = Date.now();
            });
        });

        // A tap must not leave a highlight behind on a device that also
        // reports hover (a touchscreen laptop).
        document.addEventListener('touchstart', clear, { passive: true });
    }

    window.GanttEditorLink = {
        init: init,
        clear: clear,
        invalidate: invalidate,
        syncOverlay: syncOverlay,
        // Exposed for tests; not part of the page's own call graph.
        _internals: {
            visibleLineAtClientY: visibleLineAtClientY,
            visibleLineForRawLine: visibleLineForRawLine,
            taskIndexForRawLine: taskIndexForRawLine,
            visibleRowIndex: visibleRowIndex,
            onGanttHover: onGanttHover,
            onEditorHover: onEditorHover,
            isActive: isActive,
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
