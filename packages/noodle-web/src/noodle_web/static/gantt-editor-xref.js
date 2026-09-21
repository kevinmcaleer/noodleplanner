/*
 * Two-way hover cross-reference between the Gantt view and the markdown
 * editor (#1271).
 *
 * Hovering a Gantt row highlights the markdown line that produced it and
 * scrolls that line into view; hovering a markdown line highlights that
 * task's Gantt info row *and* its bar row (they are separate elements in
 * separately scrolling containers) and scrolls both into view.
 *
 * Design notes, because several of these are not obvious from the code:
 *
 *  - The highlight colour is --np-xref-highlight, a token defined for both
 *    themes in visual-system.css. It is deliberately not the :hover shade
 *    (--np-paper) nor --np-info-tint.
 *
 *  - #planEditor is a transparent-text <textarea> over a pointer-events:none
 *    highlight layer, so a single line cannot be styled and the layer cannot
 *    receive the mouse. The highlight is therefore painted as a band in a
 *    third overlay inside .editor-area, sitting *under* the highlight layer,
 *    and the hover is detected by mapping clientY to a line ourselves. The
 *    band is offset by -editor.scrollTop, exactly as syncScroll() offsets the
 *    highlight layer, so the two cannot drift.
 *
 *  - Line numbers come in two flavours. data-line-number is the raw line in
 *    the plan text; data-visible-line is its position in the folded view.
 *    findTaskLineNumber() returns a RAW line, so everything here is keyed on
 *    raw lines and converted to a visible line only at the moment of drawing.
 *
 *  - Nothing here ever calls renderGanttChart(). Listeners are delegated.
 */
(function (global) {
    'use strict';

    var ROW_CLASS = 'np-xref-highlight';
    var BAND_CLASS = 'editor-xref-band';
    var SCROLL_DEBOUNCE_MS = 60;
    // How long after a real user scroll we refuse to move that pane.
    var USER_SCROLL_GRACE_MS = 400;

    var bandEl = null;
    var activeSource = null;      // 'gantt' | 'editor' | null -- the loop guard
    var activeRawLine = -1;
    var activeTaskIndex = -1;
    var scrollTimer = null;
    var lineMapCache = null;      // { text, tasks, byLine: Map, byIndex: [] }
    var lastEditorUserScroll = 0;
    var lastGanttUserScroll = 0;
    var programmaticScroll = false;
    var coarsePointer = false;

    function el(id) { return document.getElementById(id); }
    function editorEl() { return el('planEditor'); }

    function ganttIsActive() {
        var view = el('gantt-view');
        return !!(view && view.classList.contains('active'));
    }

    function editorIsVisible() {
        var panel = document.querySelector('.editor-panel');
        return !!panel && !panel.classList.contains('collapsed');
    }

    // The feature is inert unless both halves are on screen. There is no
    // point highlighting a line nobody can see, and it keeps the mousemove
    // handler cheap when the Gantt is not the active tab.
    function enabled() {
        return !coarsePointer && ganttIsActive() && editorIsVisible() && !!editorEl();
    }

    function projection() {
        var editor = editorEl();
        if (!editor || typeof SectionFolding === 'undefined') return null;
        return SectionFolding.getProjection(editor);
    }

    // ---- line <-> task index -------------------------------------------

    function tasks() {
        return (typeof ganttTasks !== 'undefined' && ganttTasks) || [];
    }

    // findTaskLineNumber() resolves through NoodlePlanModel by _uid, with a
    // name match only as a fallback -- which is what keeps two tasks of the
    // same name from collapsing onto one line. Cached, because it is a model
    // lookup per task and this runs on mousemove.
    function lineMap() {
        var editor = editorEl();
        if (!editor) return null;
        var list = tasks();
        if (lineMapCache && lineMapCache.text === editor.value && lineMapCache.tasks === list) {
            return lineMapCache;
        }
        var byLine = new Map();
        var byIndex = [];
        for (var i = 0; i < list.length; i++) {
            var line = -1;
            try {
                line = typeof findTaskLineNumber === 'function' ? findTaskLineNumber(list[i]) : -1;
            } catch (err) {
                line = -1;
            }
            byIndex.push(line);
            // First task wins for a line; a line only ever produces one task.
            if (line > 0 && !byLine.has(line)) byLine.set(line, i);
        }
        lineMapCache = { text: editor.value, tasks: list, byLine: byLine, byIndex: byIndex };
        return lineMapCache;
    }

    function invalidate() { lineMapCache = null; }

    // ---- editor geometry ------------------------------------------------

    function metrics() {
        var editor = editorEl();
        if (!editor) return null;
        var style = global.getComputedStyle(editor);
        var lineHeight = parseFloat(style.lineHeight);
        if (!lineHeight || isNaN(lineHeight)) lineHeight = (parseFloat(style.fontSize) || 14) * 1.5;
        return { lineHeight: lineHeight, paddingTop: parseFloat(style.paddingTop) || 0 };
    }

    // Raw line -> the line actually on screen. Returns the visible line, or
    // the visible line of the *collapsed fold header* that swallowed it.
    //
    // Collapsed-section decision (open question 3): a hover never mutates the
    // document or the persisted fold state, so a task hidden inside a
    // collapsed section highlights that section's fold header rather than
    // expanding it. Expanding on hover would rewrite the textarea, move the
    // caret and persist a fold state the user never asked to change.
    function visibleLineForRaw(rawLine) {
        var proj = projection();
        if (!proj) return { line: rawLine, folded: false };
        var lines = proj.displayLines || [];
        for (var i = 0; i < lines.length; i++) {
            var rec = lines[i];
            if (rec.kind === 'header' && !rec.expanded && rec.section &&
                rawLine > rec.section.startLine && rawLine <= rec.section.endExclusiveLine) {
                return { line: i + 1, folded: true };
            }
            if (rec.rawLineNumber === rawLine && rec.kind !== 'header') {
                return { line: i + 1, folded: false };
            }
        }
        var mapped = SectionFolding.visibleLineFromRawLine(proj, rawLine);
        return { line: mapped || rawLine, folded: false };
    }

    // The mouse position inside .editor-area -> a RAW line number, or -1.
    function rawLineAtClientY(clientY) {
        var editor = editorEl();
        var m = metrics();
        if (!editor || !m) return -1;
        var rect = editor.getBoundingClientRect();
        var y = clientY - rect.top + editor.scrollTop - m.paddingTop;
        if (y < 0) return -1;
        var visibleLine = Math.floor(y / m.lineHeight) + 1;
        var proj = projection();
        if (!proj) {
            var total = editor.value.split('\n').length;
            return visibleLine >= 1 && visibleLine <= total ? visibleLine : -1;
        }
        var rec = (proj.displayLines || [])[visibleLine - 1];
        // A fold header is not a task line, so it maps to nothing.
        if (!rec || rec.kind === 'header') return -1;
        return rec.rawLineNumber || -1;
    }

    // ---- drawing --------------------------------------------------------

    function band() {
        if (bandEl && bandEl.isConnected) return bandEl;
        var editor = editorEl();
        if (!editor) return null;
        var area = editor.parentElement;
        if (!area) return null;
        bandEl = document.createElement('div');
        bandEl.className = BAND_CLASS;
        bandEl.setAttribute('aria-hidden', 'true');
        area.insertBefore(bandEl, area.firstChild);
        return bandEl;
    }

    function positionBand() {
        if (activeRawLine <= 0) return;
        var editor = editorEl();
        var m = metrics();
        var b = band();
        if (!editor || !m || !b) return;
        var visible = visibleLineForRaw(activeRawLine);
        b.style.height = m.lineHeight + 'px';
        b.style.top = (m.paddingTop + (visible.line - 1) * m.lineHeight - editor.scrollTop) + 'px';
        b.style.display = 'block';
    }

    function highlightGutter(rawLine) {
        var gutter = el('lineNumbers');
        if (!gutter) return;
        var previous = gutter.querySelectorAll('.' + ROW_CLASS);
        for (var i = 0; i < previous.length; i++) previous[i].classList.remove(ROW_CLASS);
        if (rawLine <= 0) return;
        var visible = visibleLineForRaw(rawLine);
        var target = gutter.querySelector('[data-visible-line="' + visible.line + '"]') ||
            gutter.querySelector('[data-line-number="' + rawLine + '"]');
        if (target) target.classList.add(ROW_CLASS);
    }

    function clearGanttRows() {
        var rows = document.querySelectorAll('#ganttInfoBody tr.' + ROW_CLASS + ', #ganttBody .gantt-bar-row.' + ROW_CLASS);
        for (var i = 0; i < rows.length; i++) rows[i].classList.remove(ROW_CLASS);
    }

    function ganttRowsFor(index) {
        var info = document.querySelector('#ganttInfoBody tr[data-task-index="' + index + '"]');
        var bar = document.querySelector('#ganttBody .gantt-bar-row[data-task-index="' + index + '"]');
        return { info: info, bar: bar };
    }

    function isHidden(node) {
        return !node || node.style.display === 'none' || !node.offsetParent && node.offsetHeight === 0;
    }

    // A row hidden under a collapsed summary has nothing to scroll to, so the
    // highlight falls back to the nearest visible row above it -- the summary
    // that is standing in for it. Scrolling to a zero-height row would look
    // like the feature had simply failed.
    function visibleStandIn(index) {
        for (var i = index; i >= 0; i--) {
            var rows = ganttRowsFor(i);
            if (rows.info && rows.info.style.display !== 'none') return i;
        }
        return -1;
    }

    // ---- scrolling ------------------------------------------------------

    function withProgrammaticScroll(fn) {
        programmaticScroll = true;
        try { fn(); } finally {
            global.setTimeout(function () { programmaticScroll = false; }, 0);
        }
    }

    function scheduleScroll(fn) {
        if (scrollTimer) global.clearTimeout(scrollTimer);
        scrollTimer = global.setTimeout(function () {
            scrollTimer = null;
            withProgrammaticScroll(fn);
        }, SCROLL_DEBOUNCE_MS);
    }

    function scrollEditorTo(rawLine) {
        var editor = editorEl();
        var m = metrics();
        if (!editor || !m) return;
        // Never move a pane the user is typing in or actively scrolling.
        if (document.activeElement === editor) return;
        if (Date.now() - lastEditorUserScroll < USER_SCROLL_GRACE_MS) return;
        var visible = visibleLineForRaw(rawLine);
        var top = (visible.line - 1) * m.lineHeight;
        var viewport = editor.clientHeight;
        if (top >= editor.scrollTop && top + m.lineHeight <= editor.scrollTop + viewport) {
            positionBand();
            return;
        }
        editor.scrollTop = Math.max(0, top - viewport / 2);
        // The same path syncScroll() listens on, so the highlight layer, the
        // fold overlay and the gutter all move with it.
        editor.dispatchEvent(new Event('scroll'));
        positionBand();
    }

    function scrollGanttTo(index) {
        if (Date.now() - lastGanttUserScroll < USER_SCROLL_GRACE_MS) return;
        var rows = ganttRowsFor(index);
        var tableSide = document.querySelector('#gantt-view .gantt-table-side');
        var chartSide = document.querySelector('#gantt-view .gantt-chart-side');
        [[rows.info, tableSide], [rows.bar, chartSide]].forEach(function (pair) {
            var node = pair[0];
            var pane = pair[1];
            if (!node || !pane || isHidden(node)) return;
            if (pane.contains(document.activeElement)) return;
            var nodeTop = node.offsetTop;
            var height = node.offsetHeight || 0;
            if (nodeTop >= pane.scrollTop && nodeTop + height <= pane.scrollTop + pane.clientHeight) return;
            pane.scrollTop = Math.max(0, nodeTop - pane.clientHeight / 2);
        });
    }

    // ---- the two directions ---------------------------------------------

    function clear() {
        activeSource = null;
        activeRawLine = -1;
        activeTaskIndex = -1;
        if (scrollTimer) { global.clearTimeout(scrollTimer); scrollTimer = null; }
        clearGanttRows();
        highlightGutter(-1);
        if (bandEl) bandEl.style.display = 'none';
    }

    function highlightFromGantt(index) {
        if (!enabled()) return;
        if (activeSource === 'gantt' && activeTaskIndex === index) return;
        var map = lineMap();
        if (!map) return;
        var rawLine = map.byIndex[index];
        clearGanttRows();
        var rows = ganttRowsFor(index);
        if (rows.info) rows.info.classList.add(ROW_CLASS);
        if (rows.bar) rows.bar.classList.add(ROW_CLASS);
        activeSource = 'gantt';
        activeTaskIndex = index;
        // A task with no resolvable line degrades silently: the Gantt row is
        // still highlighted, the editor simply has nothing to point at.
        activeRawLine = rawLine > 0 ? rawLine : -1;
        highlightGutter(activeRawLine);
        if (activeRawLine > 0) {
            positionBand();
            scheduleScroll(function () { scrollEditorTo(activeRawLine); });
        } else if (bandEl) {
            bandEl.style.display = 'none';
        }
    }

    function highlightFromEditor(rawLine) {
        if (!enabled()) return;
        if (activeSource === 'editor' && activeRawLine === rawLine) return;
        var map = lineMap();
        if (!map) return;
        var index = map.byLine.has(rawLine) ? map.byLine.get(rawLine) : -1;
        if (index === -1) {
            // Front matter, a blank line, a section header: highlight nothing.
            if (activeSource === 'editor') clear();
            return;
        }
        activeSource = 'editor';
        activeRawLine = rawLine;
        activeTaskIndex = index;
        highlightGutter(rawLine);
        positionBand();
        clearGanttRows();
        var target = ganttRowsFor(index);
        var scrollIndex = index;
        if (!target.info || target.info.style.display === 'none') {
            scrollIndex = visibleStandIn(index);
            if (scrollIndex !== -1) target = ganttRowsFor(scrollIndex);
        }
        if (target.info) target.info.classList.add(ROW_CLASS);
        if (target.bar) target.bar.classList.add(ROW_CLASS);
        if (scrollIndex !== -1) {
            var at = scrollIndex;
            scheduleScroll(function () { scrollGanttTo(at); });
        }
    }

    // ---- wiring ---------------------------------------------------------

    function rowIndexFrom(event, selector) {
        var node = event.target && event.target.closest ? event.target.closest(selector) : null;
        if (!node || !node.dataset || node.dataset.taskIndex === undefined) return -1;
        var index = parseInt(node.dataset.taskIndex, 10);
        return isNaN(index) ? -1 : index;
    }

    function wireGanttSide() {
        var info = el('ganttInfoBody');
        var bars = el('ganttBody');
        // Delegated, on the two containers -- not per row. addRowInteractions()
        // already does per-row work on every row; this must not add more.
        if (info && !info.dataset.xrefWired) {
            info.dataset.xrefWired = '1';
            info.addEventListener('mouseover', function (e) {
                var index = rowIndexFrom(e, 'tr[data-task-index]');
                if (index !== -1) highlightFromGantt(index);
            });
            info.addEventListener('mouseleave', clear);
        }
        if (bars && !bars.dataset.xrefWired) {
            bars.dataset.xrefWired = '1';
            bars.addEventListener('mouseover', function (e) {
                var index = rowIndexFrom(e, '.gantt-bar-row[data-task-index]');
                if (index !== -1) highlightFromGantt(index);
            });
            bars.addEventListener('mouseleave', clear);
        }
    }

    var lastX = null;
    var lastY = null;

    function wireEditorSide() {
        var editor = editorEl();
        if (!editor) return;
        var area = editor.parentElement;
        var gutter = el('lineNumbers');

        // Open question 1: the hover surface is the text area itself, not
        // only the gutter. The gutter is free but undiscoverable; the epic's
        // wording is "hovering over a line in the markdown editor". Both are
        // wired -- the gutter because it costs one more listener.
        if (area && !area.dataset.xrefWired) {
            area.dataset.xrefWired = '1';
            area.addEventListener('mousemove', function (e) {
                // Only a genuine pointer movement takes over from a Gantt
                // hover. This is the loop guard: a programmatic scroll cannot
                // manufacture movement, so it cannot bounce back.
                if (e.clientX === lastX && e.clientY === lastY) return;
                lastX = e.clientX;
                lastY = e.clientY;
                if (!enabled()) return;
                var raw = rawLineAtClientY(e.clientY);
                if (raw > 0) highlightFromEditor(raw);
                else if (activeSource === 'editor') clear();
            });
            area.addEventListener('mouseleave', function () {
                if (activeSource === 'editor') clear();
            });
        }

        if (gutter && !gutter.dataset.xrefWired) {
            gutter.dataset.xrefWired = '1';
            gutter.addEventListener('mouseover', function (e) {
                if (!enabled()) return;
                var node = e.target && e.target.closest ? e.target.closest('.line-number') : null;
                if (!node) return;
                if (node.dataset.foldHeader === 'true') return;
                var raw = parseInt(node.dataset.lineNumber, 10);
                if (raw > 0) highlightFromEditor(raw);
            });
            gutter.addEventListener('mouseleave', function () {
                if (activeSource === 'editor') clear();
            });
        }

        if (!editor.dataset.xrefWired) {
            editor.dataset.xrefWired = '1';
            // Keep the band in lockstep with the highlight layer, which
            // syncScroll() offsets by the same -scrollTop.
            editor.addEventListener('scroll', function () {
                if (!programmaticScroll) lastEditorUserScroll = Date.now();
                positionBand();
            });
            // No highlight survives an edit: the line map is stale the moment
            // the text changes.
            editor.addEventListener('input', function () { invalidate(); clear(); });
        }
    }

    function wireScrollGrace() {
        ['.gantt-table-side', '.gantt-chart-side'].forEach(function (selector) {
            var pane = document.querySelector('#gantt-view ' + selector);
            if (!pane || pane.dataset.xrefWired) return;
            pane.dataset.xrefWired = '1';
            pane.addEventListener('scroll', function () {
                if (!programmaticScroll) lastGanttUserScroll = Date.now();
            });
        });
    }

    function wireTouch() {
        // There is no hover on touch, and a tap leaves a mouseover behind with
        // no matching mouseout. Both are handled by treating a coarse pointer
        // as "feature off" and clearing whatever a synthesised hover left.
        if (global.matchMedia && global.matchMedia('(hover: none)').matches) {
            coarsePointer = true;
        }
        document.addEventListener('pointerdown', function (e) {
            if (e.pointerType && e.pointerType !== 'mouse') {
                coarsePointer = true;
                clear();
            }
        }, true);
    }

    function init() {
        wireTouch();
        wireEditorSide();
        wireGanttSide();
        wireScrollGrace();
    }

    // The Gantt bodies are rebuilt wholesale by renderGanttChart(), which
    // replaces neither #ganttInfoBody nor #ganttBody, so the delegated
    // listeners survive. refresh() exists for the panes, which are created
    // with the view.
    function refresh() {
        invalidate();
        clear();
        wireEditorSide();
        wireGanttSide();
        wireScrollGrace();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.GanttEditorXref = {
        init: init,
        refresh: refresh,
        clear: clear,
        invalidate: invalidate,
        // Exposed for tests and for anything that needs the mapping.
        rawLineForTaskIndex: function (index) {
            var map = lineMap();
            return map ? (map.byIndex[index] === undefined ? -1 : map.byIndex[index]) : -1;
        },
        taskIndexForRawLine: function (rawLine) {
            var map = lineMap();
            return map && map.byLine.has(rawLine) ? map.byLine.get(rawLine) : -1;
        },
        highlightFromGantt: highlightFromGantt,
        highlightFromEditor: highlightFromEditor,
        visibleLineForRaw: visibleLineForRaw,
        rawLineAtClientY: rawLineAtClientY,
        setCoarsePointer: function (value) { coarsePointer = !!value; },
        state: function () {
            return { source: activeSource, rawLine: activeRawLine, taskIndex: activeTaskIndex };
        },
    };
}(window));
