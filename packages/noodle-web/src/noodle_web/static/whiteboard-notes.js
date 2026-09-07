/**
 * Whiteboard post-it notes (issue #846).
 *
 * Renders each summary task that has a whiteboard row (see #844's
 * ---whiteboard--- back matter, read via extractWhiteboardFromPlanText() /
 * parseWhiteboardMarkdown() in script.js) as a post-it note on the
 * whiteboard canvas built by whiteboard.js (issue #845).
 *
 * Rendering technique: one SVG <foreignObject> per note, positioned via
 * the row's X/Y/Width/Height, containing a normal HTML <div> card. This
 * lives inside wbGroup (see whiteboard.js) so notes pan/zoom with the
 * dot-grid for free, and matches the `.wb-note` class + `data-wb-x/y/
 * width/height` dataset convention whiteboardZoomFit() already expects
 * (see the comment on that function in whiteboard.js).
 *
 * Data flow: this file never re-parses plan text itself -- that would be
 * exactly the kind of parallel/duplicate parsing implementation this repo
 * has been bitten by before. Instead, updateWhiteboardView(result, planText)
 * is wired into script.js's updateAllViews() viewUpdates list, so it is
 * handed the already-scheduled `result.tasks` (identical shape/values
 * Gantt and Kanban's phase rollups are computed from -- see
 * engine/scheduler.js's rollUp()) on every plan edit, whether or not the
 * whiteboard tab is currently visible. The most recent tasks/planText are
 * cached here so initWhiteboard() (called when the user switches to the
 * whiteboard tab) can render immediately without waiting for another edit.
 *
 * Direct-children lookup: each task in `result.tasks` carries a `.parent`
 * field (the exact string the engine's own childrenByParent map is keyed
 * by -- see scheduler.js). Direct children of a summary task are simply
 * `tasks.filter(t => t.parent === summaryTask.name)`; a child "has its own
 * children" when some other task's `.parent` equals *that* child's name.
 * This is deliberately the same relation the engine's rollUp() already
 * uses, so "direct children only" and the per-child percent this file
 * reads for the progress footer are guaranteed consistent with what Gantt
 * and Kanban show for the same tasks.
 *
 * Ticking a todo goes through the exact same commit path Kanban's
 * checkbox uses (see kanban.js quickSetPercent/commitMarkdown): rewrite
 * the task's own markdown line, set #planEditor.value once, dispatch one
 * 'input' event (undo snapshot + kanban editor sync + line numbers), then
 * call renderText() immediately so every view (including this one)
 * reflects the change without waiting for the 1s auto-render debounce.
 *
 * Note colour -- the `...` menu (issue #849) -- precedence rule, in order:
 *
 *   1. The whiteboard row's own `Colour` column (a per-board override --
 *      readable for backward compatibility with hand-edited plans, but
 *      the menu itself never writes it -- see wbSetNoteColour() below for
 *      why the dual "Theme vs. per-board" behaviour the issue offered was
 *      dropped in favour of always writing `Theme:`).
 *   2. The plan's `Theme:` front-matter entry for that summary task's
 *      name (kanban.js parsePlanThemeColours()/buildPlanTextWithThemeColours()
 *      -- the same block the Kanban board and mind map read/write, so a
 *      colour picked from any of the three views shows up in the other
 *      two). This is what the `...` menu writes.
 *   3. A palette colour derived from the task's position in `result.tasks`
 *      (wbDerivedPaletteColour(), reusing mindmap.js's MM_BRANCH_COLOURS --
 *      not a new palette) -- always defined, so a note is never left
 *      uncoloured; "clear" in the menu means "fall back to this".
 *
 * See wbResolveNoteColour() for the implementation and
 * docs/reference/plan-format.rst's "Whiteboard rows" section for the
 * user-facing writeup of the same rule.
 *
 * Drag/resize (issue #848): a note's header is the drag handle, its
 * bottom-right corner (`.wb-note-resize-handle`) is the resize handle.
 * Both follow the same shape: on pointerdown, capture the note's *current*
 * board rect straight off entry.fo's own x/y/width/height dataset (kept
 * current by wbUpdateNoteNode() on every render, so this never depends on
 * a possibly-stale view-model closure); on every pointermove, update only
 * that one <foreignObject>'s x/y (or width/height) attributes directly --
 * never wbRenderNotes() or wbUpdateNoteNode() -- so a drag frame's cost is
 * O(1) regardless of how many other notes exist on the board (the "100
 * notes stays smooth" acceptance criterion). Nothing is written to plan
 * text until pointerup, which is what makes "one commit per drag gesture"
 * true by construction rather than by debouncing a stream of writes: the
 * only markdown-affecting call in the whole gesture is the single
 * wbCommitNoteChange() at the end. wbCommitMarkdown() already no-ops when
 * the computed text is byte-identical to what's already in the editor
 * (see its own doc comment), so a zero-movement click still safely funnels
 * through the exact same path without producing a spurious write/undo
 * step when the note was already frontmost at its current position.
 *
 * Z-order (also #848): SVG paints siblings in document order, so "bring
 * to front" is just moving a note's <foreignObject> to be the last child
 * of the notes layer (wbRaiseNoteToFront()) -- done immediately on
 * pointerdown for instant visual feedback. That ordering is made to
 * survive a reload by writing the same "move this row to the end" rule
 * into the whiteboard table itself (wbMoveTaskToEnd()) as part of the
 * pointerup commit: wbRenderNotes() creates+appends brand-new note nodes
 * in row order on a fresh load, so the row written last renders (and
 * hence z-orders) last/frontmost, matching what the user last saw.
 *
 * Touch (#848): a tap on a note's header starts in a 'pending' phase (see
 * wbActiveDrag) that only escalates to an actual drag after a short
 * long-press delay, so a quick tap-and-lift (or a swipe that turns out to
 * be a pan attempt that started on top of a note) never moves anything --
 * see wbNoteHeaderTouchStart()/wbNoteDragTouchMove(). whiteboard.js's own
 * wbHandleTouchStart() is taught to step aside (return early) for any
 * touch that starts on a note (or any other in-canvas element), so canvas
 * panning/pinch-zoom never double-fires alongside a note drag.
 *
 * Task peek (issue #850): clicking a child row's count badge -- or the row
 * itself, for a child that has one -- no longer escalates straight to the
 * full task-details form. It opens task-peek.js's reusable TaskPeek
 * popover instead (see wbTogglePeekFor()/wbOpenChildPeek() below), rooted
 * at that child, listing *its* own direct children (name, assignee chips,
 * completion checkbox, and a further count badge for grandchildren-with-
 * children -- the peek is itself recursively drillable, with its own
 * breadcrumb). wbBuildPeekLevel() builds the peek's {task, children}
 * view-model for one level, reusing this file's existing
 * wbDirectChildren()/wbHasChildren()/wbChildCount()/wbIsChildComplete()/
 * wbResourceList() helpers rather than a second child-shape builder --
 * task-peek.js itself stays whiteboard-agnostic; this is the only file
 * that knows about wbLastTasks. "Open task details" -- reachable from the
 * peek's own header and, independently, from a new item on the note's
 * `...` menu (wbAppendOpenTaskMenuSection()) -- now escalates through
 * wbOpenChildTask() to openTaskFormByName() (the same task-details form
 * product views open), not the read-only Task Inspector that badge click
 * used to jump to directly.
 */

// ── Configuration ───────────────────────────────────────────────────────
const WB_NOTE_DEFAULT_WIDTH = 260;
const WB_NOTE_DEFAULT_HEIGHT = 220;
const WB_NOTE_MIN_WIDTH = 160;
const WB_NOTE_MIN_HEIGHT = 120;
// "Sensible maximum" per #848 -- generous enough for a note-with-many-
// subtasks to stretch out, but bounded so one runaway resize can't turn
// a note into something that dwarfs the rest of the board.
const WB_NOTE_MAX_WIDTH = 900;
const WB_NOTE_MAX_HEIGHT = 900;

// Screen-space pixels of pointer movement before a mousedown-on-header/
// resize-handle counts as an actual drag rather than a click (issue #848).
const WB_DRAG_MOVE_THRESHOLD = 3;
// Touch equivalent of the same idea, but generous: fat-finger jitter
// during the long-press window shouldn't cancel a real drag attempt.
const WB_TOUCH_CANCEL_THRESHOLD = 10;
// How long a touch must be held on a note's header before it escalates
// from "might be a tap" to "this is a drag" (issue #848's "long-press-
// and-drag on touch" requirement).
const WB_TOUCH_LONG_PRESS_MS = 350;

// Below this zoom level a note switches to a title-only card rather than
// trying to render illegible body/footer text (see whiteboardZoomFit()'s
// sibling wbApplyTransform() in whiteboard.js, which toggles the class
// this threshold drives).
const WB_NOTE_TITLE_ONLY_ZOOM = 0.4;

// ── Module state ─────────────────────────────────────────────────────────
// Cache of the most recently parsed tasks/planText (see file header) plus
// a map from summary task name -> the DOM we built for it last render, so
// re-renders update existing nodes in place instead of tearing everything
// down (which would lose in-note scroll position and cause flicker).
let wbLastTasks = [];
let wbLastPlanText = '';
let wbNoteNodes = new Map(); // summary task name -> { fo, refs: {...} }

// Colour-menu state (issue #849). Only one `...` menu is ever open at a
// time (matches mindmap.js's single mmColourPicker / status-bar.js's
// single statusBarHistoryPopup convention), so this is a single slot
// rather than a map.
let wbNoteMenuState = null; // { taskName, btn } while open, else null

// Swatch picks are applied to the note's DOM immediately (see
// wbApplyOptimisticNoteColour()) but the actual Markdown write is
// debounced -- this repo's established resourceDebounceTimer-style
// convention (script.js) -- so clicking through several swatches in a
// row collapses into one commit/one undo step. `wbPendingColourPicks`
// coalesces by task name so a rapid re-pick on the same note before the
// timer fires still only ever commits its latest value.
let wbColourCommitTimer = null;
const wbPendingColourPicks = new Map(); // taskName -> colour|null

// Optimistic overrides shown between a pick and its debounced commit
// landing (see wbApplyOptimisticNoteColour()/wbReconcileColourOverrides()).
// taskName -> colour|null (null = "picked default/clear").
const wbColourOverrides = new Map();

// ── Pure helpers (no DOM — unit tested directly) ───────────────────────

/**
 * Direct children of `parentName` within a flat `result.tasks` array,
 * in document order. Mirrors engine/scheduler.js's childrenByParent.
 */
function wbDirectChildren(tasks, parentName) {
    if (!tasks || !parentName) return [];
    return tasks.filter(t => t && t.parent === parentName);
}

/**
 * Whether `taskName` has any direct children of its own (i.e. whether a
 * row for it in a note body should render as a count badge instead of
 * being expanded -- the epic's "only shows one level deep" rule).
 */
function wbHasChildren(tasks, taskName) {
    if (!tasks || !taskName) return false;
    return tasks.some(t => t && t.parent === taskName);
}

/** Count of `taskName`'s direct children, for the "3 ▾" badge. */
function wbChildCount(tasks, taskName) {
    return wbDirectChildren(tasks, taskName).length;
}

/**
 * Whether a child row counts as "done" for the note's progress footer.
 * Leaf children carry their own percent; summary children already carry
 * the engine's rolled-up percent (see scheduler.js rollUp()) -- reading
 * `.percent` uniformly for both keeps this in lock-step with what Gantt
 * and Kanban display for the same task.
 */
function wbIsChildComplete(child) {
    const pct = parseFloat(child && child.percent);
    return !Number.isNaN(pct) && pct >= 100;
}

/**
 * { completed, total } across a summary task's direct children -- the
 * note footer's "4 / 7". Deliberately a completed-count fraction (matching
 * the issue's example) rather than the engine's average-percent rollup:
 * both are derived from the exact same per-child percent values, so they
 * never disagree about *which* children are done, they just summarise it
 * differently (count vs. average) for a todo-list-shaped footer.
 */
function wbNoteProgress(tasks, summaryTaskName) {
    const children = wbDirectChildren(tasks, summaryTaskName);
    const completed = children.filter(wbIsChildComplete).length;
    return { completed, total: children.length };
}

/** First-plus-last-initial (or first two letters) -- mirrors KanbanBoard.getInitials(). */
function wbGetInitials(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '?';
    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    } else if (words.length === 1 && words[0].length >= 2) {
        return words[0].substring(0, 2).toUpperCase();
    }
    return trimmed.substring(0, 1).toUpperCase();
}

/** Split a KanbanBoard-style "Alice, Bob" resources string into names. */
function wbResourceList(resources) {
    if (!resources) return [];
    return String(resources).split(',').map(r => r.trim()).filter(Boolean);
}

/**
 * WCAG relative luminance of a #RRGGBB colour (0 = black, 1 = white).
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function wbRelativeLuminance(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    if (!m) return null;
    const int = parseInt(m[1], 16);
    const rgb = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map(c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** WCAG contrast ratio between two #RRGGBB colours (1..21). */
function wbContrastRatio(hexA, hexB) {
    const lA = wbRelativeLuminance(hexA);
    const lB = wbRelativeLuminance(hexB);
    if (lA === null || lB === null) return null;
    const lighter = Math.max(lA, lB);
    const darker = Math.min(lA, lB);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pick whichever of a near-black / near-white text colour has the higher
 * WCAG contrast ratio against `bgHex`, checked against at least AA (4.5:1)
 * for normal text -- not "looks fine", an actual computed ratio. Returns
 * null for an empty/invalid colour so the caller falls back to the themed
 * `var(--np-*)` default instead (see wbNoteHeaderStyle()).
 */
function wbContrastTextColour(bgHex) {
    if (!bgHex) return null;
    const dark = '#161616';
    const light = '#fafafa';
    const ratioDark = wbContrastRatio(bgHex, dark);
    const ratioLight = wbContrastRatio(bgHex, light);
    if (ratioDark === null || ratioLight === null) return null;
    return ratioDark >= ratioLight ? dark : light;
}

/**
 * The swatch palette to offer, reusing mindmap.js's MM_BRANCH_COLOURS
 * rather than inventing a second one (per the issue's explicit "do not
 * invent a third palette" instruction -- the mind map's own is already
 * the second, alongside kanban.js's Theme: values). Falls back to a
 * literal copy of the same values only for this file's own vm-sandboxed
 * unit tests (test_whiteboard_notes.js loads whiteboard-notes.js alone,
 * without mindmap.js) -- the real app always has mindmap.js loaded first
 * (see index.html's <script> order), so the fallback never runs there.
 */
function wbPalette() {
    if (typeof MM_BRANCH_COLOURS !== 'undefined' && MM_BRANCH_COLOURS.length) {
        return MM_BRANCH_COLOURS;
    }
    return [
        '#4A90D9', '#D97B4A', '#5CB85C', '#D95B5B',
        '#9B6BBF', '#3DBFA8', '#D9A84A', '#5B8FD9',
        '#4ABF7F', '#D9534F', '#D9B84A', '#8E5BBF',
    ];
}

/**
 * Shade a #RRGGBB colour exactly like mindmap.js's mindmapShadeColour()
 * (factor < 1 darkens towards black by that fraction, factor > 1 blends
 * towards white) -- delegates to the real function when it's loaded (the
 * running app always has it, per index.html's <script> order); the body
 * below is an exact, kept-in-lockstep copy used only by this file's own
 * isolated unit tests. See the issue's "Contrast" section: a note's
 * header uses this same treatment mind map applies to its branch nodes'
 * fill, rather than painting the raw, sometimes-too-saturated swatch.
 */
function wbShadeColour(hex, factor) {
    if (typeof mindmapShadeColour === 'function') return mindmapShadeColour(hex, factor);

    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    if (factor > 1) {
        const blend = factor - 1;
        r = Math.round(r + (255 - r) * Math.min(blend, 1));
        g = Math.round(g + (255 - g) * Math.min(blend, 1));
        b = Math.round(b + (255 - b) * Math.min(blend, 1));
    } else {
        r = Math.round(r * factor);
        g = Math.round(g * factor);
        b = Math.round(b * factor);
    }

    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));

    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Tier 3 of the colour precedence (see file header): a palette colour
 * derived from `taskName`'s position in the flat `tasks` array (document
 * order), so it is stable across renders and independent of any colour
 * override. Falls back to the palette's first entry if the task can't be
 * found (should not happen in practice -- callers only reach this once a
 * matching task is already known to exist).
 */
function wbDerivedPaletteColour(tasks, taskName) {
    const palette = wbPalette();
    if (!tasks || !taskName) return palette[0];
    const key = String(taskName).toLowerCase();
    const index = tasks.findIndex(t => t && String(t.name).toLowerCase() === key);
    if (index === -1) return palette[0];
    return palette[index % palette.length];
}

/**
 * Tier 2: the plan's Theme: front-matter entry for `taskName`, or null.
 * `themeColours` is the { name: '#HEX' } map read by
 * kanban.js's parsePlanThemeColours() -- passed in rather than re-parsed
 * here so a render pass only ever parses the Theme: block once (see
 * wbRenderNotes()). Matched exactly (case-sensitive), matching how
 * kanban.js itself keys this map by literal phase/task name.
 */
function wbThemeColourFor(taskName, themeColours) {
    if (!taskName || !themeColours) return null;
    return themeColours[taskName] || null;
}

/**
 * Resolve one note's colour and which tier it came from -- the precedence
 * rule documented in this file's header: whiteboard row Colour -> Theme:
 * entry -> derived palette. Always returns a colour (tier 3 never fails),
 * so a note is never left uncoloured.
 *
 * @returns {{colour: string, source: 'row'|'theme'|'derived'}}
 */
function wbResolveNoteColour(row, task, tasks, themeColours) {
    const taskName = task && task.name;
    if (row && row.colour) {
        return { colour: row.colour.toUpperCase(), source: 'row' };
    }
    const themeColour = wbThemeColourFor(taskName, themeColours);
    if (themeColour) {
        return { colour: themeColour, source: 'theme' };
    }
    return { colour: wbDerivedPaletteColour(tasks, taskName), source: 'derived' };
}

/**
 * Zoom tier driving how much of a note's contents render: 'full' shows
 * header/body/footer, 'title-only' collapses to just the header. Also
 * true (unconditionally title-only) for a row explicitly marked
 * Collapsed=yes in the whiteboard back matter (see plan-format.rst) --
 * the same simplified card, just triggered by the user's own choice
 * rather than the zoom level.
 */
function wbNoteZoomTier(zoom, collapsed) {
    if (collapsed) return 'title-only';
    return zoom < WB_NOTE_TITLE_ONLY_ZOOM ? 'title-only' : 'full';
}

/**
 * Build the note view-model for one whiteboard row: the matching task
 * (case-insensitive, per plan-format.rst's Task-matching rule), its
 * direct children (each annotated with whether it has its own children
 * and, if so, how many), and the progress fraction. Returns null only for
 * a genuine orphan row (no task of that name exists at all) --
 * validateWhiteboardRows() already reports those as warnings elsewhere;
 * this just never renders them. A row matching a task with zero children
 * (whether or not the engine currently flags it is_summary -- see the
 * comment on the name lookup below) still builds a view model, so it
 * renders as an empty-state note rather than silently disappearing.
 *
 * `themeColours` (optional, defaults to {}) is the Theme: map used for
 * tier 2 of the colour precedence -- see wbResolveNoteColour(). Passing
 * none is equivalent to no Theme: entries existing, which is exactly
 * right for a caller (e.g. the existing unit tests) that only cares
 * about a note's children/progress, not its colour.
 */
function wbBuildNoteViewModel(row, tasks, themeColours = {}) {
    if (!row || !row.task || !tasks) return null;
    const key = row.task.toLowerCase();
    // Matched by name only, not is_summary: the outline parser
    // (engine/scheduler.js buildTasks()) classifies a task as a summary
    // purely by whether it currently has any nested lines, so a summary
    // task whose last child was just deleted is, for one moment, a leaf
    // with is_summary=false. A whiteboard row still names it, and the
    // acceptance criteria for #846 explicitly want that case to render
    // as an empty note rather than silently vanishing as an "orphan" --
    // matching on name alone handles both a real summary (children.length
    // > 0) and this transient empty-summary case identically.
    const task = tasks.find(t => t && String(t.name).toLowerCase() === key);
    if (!task) return null;

    const children = wbDirectChildren(tasks, task.name).map(child => ({
        task: child,
        hasChildren: wbHasChildren(tasks, child.name),
        childCount: wbChildCount(tasks, child.name),
        complete: wbIsChildComplete(child),
    }));

    // A pending, not-yet-committed swatch pick (see wbHandleNoteColourPick())
    // wins over the precedence rule so the note recolours the instant the
    // user clicks, even though the actual Markdown write is debounced.
    // wbColourOverrides is reconciled/cleared once the commit lands and a
    // fresh render agrees with it (see wbReconcileColourOverrides()).
    let resolvedColour;
    if (wbColourOverrides.has(task.name)) {
        const pending = wbColourOverrides.get(task.name);
        resolvedColour = pending
            ? { colour: pending.toUpperCase(), source: 'pending' }
            : { colour: wbDerivedPaletteColour(tasks, task.name), source: 'pending' };
    } else {
        resolvedColour = wbResolveNoteColour(row, task, tasks, themeColours);
    }

    return {
        row,
        task,
        children,
        progress: wbNoteProgress(tasks, task.name),
        resources: wbResourceList(task.resources),
        colour: resolvedColour.colour,
        colourSource: resolvedColour.source,
    };
}

/** wbBuildNoteViewModel() for every row, skipping orphans. */
function wbNoteViewModels(rows, tasks, themeColours = {}) {
    return (rows || [])
        .map(row => wbBuildNoteViewModel(row, tasks, themeColours))
        .filter(Boolean);
}

/**
 * Build the task-peek popover's (issue #850) view-model for one level: the
 * task named `taskName` plus its direct children, each annotated exactly
 * like a note's own body rows (see wbBuildNoteViewModel() above) --
 * hasChildren/childCount drive the drill-down badge, complete drives the
 * checkbox -- plus each child's own `resources`, since a peek row shows
 * *that child's* assignees (unlike a note's footer, which only shows the
 * summary task's own). Reuses wbDirectChildren()/wbHasChildren()/
 * wbChildCount()/wbIsChildComplete()/wbResourceList() rather than a second
 * child-shape builder, so a peek row and a note's own todo row can never
 * quietly disagree about what "has children" or "complete" means for the
 * same task.
 *
 * Returns null for an unknown task name (e.g. renamed/deleted out from
 * under an open peek) so callers -- task-peek.js's tpRender()/tpDrillInto()
 * -- can fail closed instead of rendering a stale level.
 */
function wbBuildPeekLevel(taskName, tasks) {
    if (!taskName || !tasks) return null;
    const key = String(taskName).toLowerCase();
    const task = tasks.find(t => t && String(t.name).toLowerCase() === key);
    if (!task) return null;

    const children = wbDirectChildren(tasks, task.name).map(child => ({
        task: child,
        hasChildren: wbHasChildren(tasks, child.name),
        childCount: wbChildCount(tasks, child.name),
        complete: wbIsChildComplete(child),
        resources: wbResourceList(child.resources),
    }));

    return { task, children };
}

// ── Drag/resize pure helpers (issue #848 -- no DOM, unit tested directly) ─

/**
 * Convert a screen-space pointer delta into a board-space delta by
 * dividing by the current zoom -- the exact rule the issue specifies so a
 * dragged note tracks the pointer exactly at every zoom level: the note
 * lives inside a `scale(zoom)` ancestor transform, so a `zoom`-fold
 * shrunk/grown board must move `1/zoom` as far in board units to cover
 * the same screen distance.
 */
function wbDragBoardDelta(startClientX, startClientY, clientX, clientY, zoom) {
    const z = (typeof zoom === 'number' && zoom > 0) ? zoom : 1;
    return {
        dx: (clientX - startClientX) / z,
        dy: (clientY - startClientY) / z,
    };
}

/** Clamp a resized width/height to this note's min (fits its header, per
 * #848) and a sensible max, rounded to a whole board unit. */
function wbClampNoteWidth(width) {
    return Math.round(Math.min(WB_NOTE_MAX_WIDTH, Math.max(WB_NOTE_MIN_WIDTH, width)));
}
function wbClampNoteHeight(height) {
    return Math.round(Math.min(WB_NOTE_MAX_HEIGHT, Math.max(WB_NOTE_MIN_HEIGHT, height)));
}

/**
 * Whether a screen-space pointer displacement exceeds `threshold` -- the
 * click-vs-drag (and touch tap-vs-long-press-cancel) disambiguation used
 * throughout the drag/resize handlers below.
 */
function wbExceedsMoveThreshold(startClientX, startClientY, clientX, clientY, threshold) {
    const dx = clientX - startClientX;
    const dy = clientY - startClientY;
    return Math.sqrt(dx * dx + dy * dy) > threshold;
}

/**
 * Move the row named `taskName` (case-insensitive) to the end of `items`,
 * i.e. "renders last" == "z-orders frontmost" once wbRenderNotes() creates
 * fresh note nodes in row order (see the file header comment on Z-order).
 * Returns { items, changed } rather than mutating in place, and `changed`
 * is false both when the task isn't found and when it's already last --
 * callers use that to avoid a spurious no-op markdown write.
 */
function wbMoveTaskToEnd(items, taskName) {
    const list = items || [];
    const key = String(taskName || '').toLowerCase();
    const idx = list.findIndex(it => it && String(it.task).toLowerCase() === key);
    if (idx === -1 || idx === list.length - 1) {
        return { items: list, changed: false };
    }
    const next = list.slice();
    const [item] = next.splice(idx, 1);
    next.push(item);
    return { items: next, changed: true };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        wbDirectChildren, wbHasChildren, wbChildCount, wbIsChildComplete,
        wbNoteProgress, wbGetInitials, wbResourceList, wbRelativeLuminance,
        wbContrastRatio, wbContrastTextColour, wbNoteZoomTier,
        wbBuildNoteViewModel, wbNoteViewModels, wbBuildPeekLevel,
        wbPalette, wbShadeColour, wbDerivedPaletteColour, wbThemeColourFor,
        wbResolveNoteColour,
        wbDragBoardDelta, wbClampNoteWidth, wbClampNoteHeight,
        wbExceedsMoveThreshold, wbMoveTaskToEnd,
    };
}

// ── DOM rendering ────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * Cache the latest tasks/planText and (re)render notes. Wired into
 * updateAllViews() via script.js's viewUpdates list, so this runs on
 * every plan edit regardless of which view is active; it is a cheap
 * no-op (just updates the cache) until the whiteboard canvas actually
 * exists (wbGroup is set by initWhiteboard() in whiteboard.js).
 */
function updateWhiteboardView(result, planText) {
    wbLastTasks = (result && result.tasks) || [];
    wbLastPlanText = planText || '';
    wbRenderNotes();
}

/** Get-or-create the single <g> that holds all note foreignObjects. */
function wbNotesLayer() {
    if (typeof wbGroup === 'undefined' || !wbGroup) return null;
    let layer = wbGroup.querySelector('.wb-notes-layer');
    if (!layer) {
        layer = document.createElementNS(SVG_NS, 'g');
        layer.setAttribute('class', 'wb-notes-layer');
        wbGroup.appendChild(layer);
    }
    return layer;
}

/**
 * Render (or update in place) every note the current whiteboard rows and
 * tasks call for. Safe to call with no canvas built yet (no-op) and safe
 * to call repeatedly -- existing note DOM is diffed/updated rather than
 * torn down, so pan/zoom and in-note scroll position survive.
 */
function wbRenderNotes() {
    const layer = wbNotesLayer();
    if (!layer) return; // canvas not built yet (whiteboard tab never opened)

    const section = (typeof extractWhiteboardFromPlanText === 'function')
        ? extractWhiteboardFromPlanText(wbLastPlanText) : '';
    const rows = (typeof parseWhiteboardMarkdown === 'function' && section)
        ? parseWhiteboardMarkdown(section) : [];
    // Parsed once per render pass (not once per note) -- see
    // wbThemeColoursFromPlanText()'s doc comment.
    const themeColours = wbThemeColoursFromPlanText(wbLastPlanText);
    wbReconcileColourOverrides(rows, themeColours);
    const viewModels = wbNoteViewModels(rows, wbLastTasks, themeColours);
    const seen = new Set();

    viewModels.forEach(vm => {
        seen.add(vm.task.name);
        let entry = wbNoteNodes.get(vm.task.name);
        if (!entry) {
            entry = wbCreateNoteNode();
            layer.appendChild(entry.fo);
            wbNoteNodes.set(vm.task.name, entry);
        }
        wbUpdateNoteNode(entry, vm);
    });

    // Drop notes for summary tasks that no longer have a (valid) row.
    for (const [name, entry] of wbNoteNodes) {
        if (!seen.has(name)) {
            entry.fo.remove();
            wbNoteNodes.delete(name);
        }
    }
}

/** Build the static DOM skeleton for one note, cached refs for updates. */
function wbCreateNoteNode() {
    const fo = document.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('class', 'wb-note');

    const card = document.createElementNS(XHTML_NS, 'div');
    card.setAttribute('class', 'wb-note-card');

    const header = document.createElementNS(XHTML_NS, 'div');
    header.setAttribute('class', 'wb-note-header');

    const title = document.createElementNS(XHTML_NS, 'h3');
    title.setAttribute('class', 'wb-note-title');

    const menuBtn = document.createElementNS(XHTML_NS, 'button');
    menuBtn.setAttribute('class', 'wb-note-menu-btn');
    menuBtn.setAttribute('type', 'button');
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', 'Note options');
    menuBtn.textContent = '⋮'; // vertical ellipsis
    // Colour swatches are this button's contents for issue #849; two
    // later issues (#847 "Remove from board", #850 "Open task") add more
    // items to the same menu -- see wbBuildNoteMenu()'s doc comment for
    // the structure they extend. `fo` is read at click time (not closed
    // over an early vm) so this keeps working across re-renders that
    // reuse this same node for the same task.
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskName = fo.dataset.wbTask;
        if (!taskName) return;
        if (wbNoteMenuState && wbNoteMenuState.taskName === taskName) {
            wbCloseNoteMenu();
        } else {
            wbOpenNoteMenu(taskName, menuBtn);
        }
    });

    header.appendChild(title);
    header.appendChild(menuBtn);

    const body = document.createElementNS(XHTML_NS, 'div');
    body.setAttribute('class', 'wb-note-body');

    const footer = document.createElementNS(XHTML_NS, 'div');
    footer.setAttribute('class', 'wb-note-footer');

    const progress = document.createElementNS(XHTML_NS, 'span');
    progress.setAttribute('class', 'wb-note-progress');

    const avatars = document.createElementNS(XHTML_NS, 'div');
    avatars.setAttribute('class', 'wb-note-avatars');

    footer.appendChild(progress);
    footer.appendChild(avatars);

    // Resize handle (issue #848): a small grip in the bottom-right corner,
    // positioned by CSS (views/whiteboard.css), never by JS.
    const resizeHandle = document.createElementNS(XHTML_NS, 'div');
    resizeHandle.setAttribute('class', 'wb-note-resize-handle');
    resizeHandle.setAttribute('aria-hidden', 'true');

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    card.appendChild(resizeHandle);
    fo.appendChild(card);

    const entry = { fo, refs: { card, header, title, menuBtn, body, footer, progress, avatars, resizeHandle } };

    // Drag (header) and resize (corner handle) wiring -- issue #848. Both
    // read the note's *current* rect off entry.fo's own dataset at
    // pointerdown time (see wbNoteCurrentRect()) rather than closing over
    // this function's local `vm`, so they always act on up-to-date state
    // even after later re-renders update this same entry in place.
    header.addEventListener('mousedown', (e) => wbNoteHeaderMouseDown(e, entry));
    header.addEventListener('touchstart', (e) => wbNoteHeaderTouchStart(e, entry), { passive: false });
    resizeHandle.addEventListener('mousedown', (e) => wbNoteResizeMouseDown(e, entry));
    resizeHandle.addEventListener('touchstart', (e) => wbNoteResizeTouchStart(e, entry), { passive: false });

    return entry;
}

/** Escape helper for attribute-safe title text (native tooltip). */
function wbSetText(el, text) {
    el.textContent = text;
}

/** Update one note's DOM in place from its current view-model. */
function wbUpdateNoteNode(entry, vm) {
    const { fo, refs } = entry;
    const row = vm.row;
    const width = row.width || WB_NOTE_DEFAULT_WIDTH;
    const height = row.height || WB_NOTE_DEFAULT_HEIGHT;
    const w = Math.max(WB_NOTE_MIN_WIDTH, width);
    const h = Math.max(WB_NOTE_MIN_HEIGHT, height);

    // While this exact note is the live target of an in-progress drag or
    // resize (issue #848), its x/y/width/height are owned by the pointer
    // handlers below, not by whatever the plan text currently says -- a
    // re-render triggered mid-gesture by something unrelated (e.g. the
    // ordinary 1s auto-render debounce catching up on an earlier, separate
    // edit) must never snap the note back to its last-committed position
    // out from under the user's cursor.
    const draggingThis = typeof wbActiveDrag !== 'undefined' && wbActiveDrag && wbActiveDrag.entry === entry;
    if (!draggingThis) {
        fo.setAttribute('x', String(row.x || 0));
        fo.setAttribute('y', String(row.y || 0));
        fo.setAttribute('width', String(w));
        fo.setAttribute('height', String(h));
        // whiteboardZoomFit() (whiteboard.js) reads these dataset values to
        // frame the real note bounding box -- see that function's comment.
        fo.dataset.wbX = String(row.x || 0);
        fo.dataset.wbY = String(row.y || 0);
        fo.dataset.wbWidth = String(w);
        fo.dataset.wbHeight = String(h);
    }
    fo.dataset.wbTask = vm.task.name;

    entry.collapsed = !!row.collapsed;
    const zoom = (typeof wbZoom === 'number') ? wbZoom : 1;
    const tier = wbNoteZoomTier(zoom, entry.collapsed);
    refs.card.classList.toggle('wb-note-title-only', tier === 'title-only');

    // Header colour: vm.colour (see wbResolveNoteColour() / this file's
    // header for the row-Colour -> Theme: -> derived-palette precedence)
    // applies to the header strip/accent only, never the body -- body
    // text always sits on the themed var(--np-surface) background so it
    // is contrast-safe by construction for every possible note colour,
    // in both themes. The accent bar (--wb-note-accent) gets the full,
    // undiluted swatch colour (mirrors the mind map's node stroke); the
    // header's own background is the same colour softened via
    // wbShadeColour(colour, 0.3) -- the exact treatment mindmap.js
    // applies to its own (non-root) branch nodes' fill -- and the header
    // text colour is computed against *that* softened fill, per real WCAG
    // ratios, so the strip stays legible on every swatch in both themes.
    const headerFill = wbShadeColour(vm.colour, 0.3);
    refs.header.style.background = headerFill;
    refs.card.style.setProperty('--wb-note-accent', vm.colour);
    refs.header.style.color = wbContrastTextColour(headerFill) || '';

    wbSetText(refs.title, vm.task.name);
    refs.title.setAttribute('title', vm.task.name);

    // Body: direct children only, one row each (empty state if none).
    // Save/restore scrollTop across the rebuild so an in-progress scroll
    // inside a long note survives a plan-text-driven re-render.
    const savedScrollTop = refs.body.scrollTop;
    refs.body.innerHTML = '';
    if (!vm.children.length) {
        const empty = document.createElementNS(XHTML_NS, 'div');
        empty.setAttribute('class', 'wb-note-empty');
        empty.textContent = 'No subtasks yet';
        refs.body.appendChild(empty);
    } else {
        vm.children.forEach(childVm => {
            refs.body.appendChild(wbBuildChildRow(childVm));
        });
    }
    refs.body.scrollTop = savedScrollTop;

    // Footer: completed/total fraction + resource avatar chips.
    wbSetText(refs.progress, `${vm.progress.completed} / ${vm.progress.total}`);
    refs.avatars.innerHTML = '';
    vm.resources.slice(0, 6).forEach(resource => {
        const avatar = document.createElementNS(XHTML_NS, 'div');
        avatar.setAttribute('class', 'wb-note-avatar');
        avatar.setAttribute('title', resource);
        avatar.textContent = wbGetInitials(resource);
        refs.avatars.appendChild(avatar);
    });
}

/**
 * Toggle every note's title-only-vs-full class for the current zoom level
 * without touching row content -- called on every pan/zoom tick (see
 * wbApplyTransform() in whiteboard.js) so the degrade-below-~40% rule
 * reacts live as the user zooms, independent of any plan-text re-render.
 */
function wbUpdateNoteZoomTiers() {
    const zoom = (typeof wbZoom === 'number') ? wbZoom : 1;
    wbNoteNodes.forEach(entry => {
        const tier = wbNoteZoomTier(zoom, entry.collapsed);
        entry.refs.card.classList.toggle('wb-note-title-only', tier === 'title-only');
    });
}

// ── Drag / resize interaction (issue #848) ──────────────────────────────
//
// See the file header comment for the overall design. Summary: exactly
// one gesture (drag-a-note, resize-a-note, or a touch long-press building
// up to either) is tracked at a time in the module-level `wbActiveDrag`;
// every pointermove while it is active writes straight to the one
// <foreignObject> involved (never a full re-render); pointerup performs
// the single markdown commit for the whole gesture, or none at all if
// nothing actually changed (wbCommitMarkdown()'s own no-op guard).

let wbActiveDrag = null;

/** Current zoom, defensively defaulting to 1 if whiteboard.js hasn't run yet. */
function wbCurrentZoom() {
    return (typeof wbZoom === 'number' && wbZoom > 0) ? wbZoom : 1;
}

/**
 * A note's current board rect, read off its own <foreignObject> dataset
 * (kept current by wbUpdateNoteNode() every render) rather than any
 * possibly-stale closed-over view-model.
 */
function wbNoteCurrentRect(entry) {
    const fo = entry.fo;
    return {
        x: parseFloat(fo.dataset.wbX || fo.getAttribute('x') || '0') || 0,
        y: parseFloat(fo.dataset.wbY || fo.getAttribute('y') || '0') || 0,
        width: parseFloat(fo.dataset.wbWidth || fo.getAttribute('width') || String(WB_NOTE_DEFAULT_WIDTH)) || WB_NOTE_DEFAULT_WIDTH,
        height: parseFloat(fo.dataset.wbHeight || fo.getAttribute('height') || String(WB_NOTE_DEFAULT_HEIGHT)) || WB_NOTE_DEFAULT_HEIGHT,
    };
}

/**
 * Bring a note to the front for the remainder of this session by moving
 * its <foreignObject> to be the last child of the notes layer -- SVG
 * paints siblings in document order, so this alone is "raise to front".
 * Called immediately on pointerdown (both for an actual drag and for a
 * plain click) for instant feedback, well before any markdown commit.
 */
function wbRaiseNoteToFront(entry) {
    const layer = wbNotesLayer();
    if (layer && entry && entry.fo) layer.appendChild(entry.fo);
}

/** Global cursor feedback for the duration of a drag/resize gesture. */
function wbSetDragCursor(kind) {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.style.cursor = kind || '';
    document.body.classList.toggle('wb-note-drag-active', !!kind);
}

function wbBeginDrag(type, entry, clientX, clientY, touchId) {
    const rect = wbNoteCurrentRect(entry);
    wbRaiseNoteToFront(entry);
    wbActiveDrag = {
        phase: 'active',
        type, // 'move' | 'resize'
        entry,
        touchId: (touchId === undefined) ? null : touchId,
        startClientX: clientX,
        startClientY: clientY,
        startX: rect.x,
        startY: rect.y,
        startWidth: rect.width,
        startHeight: rect.height,
        moved: false,
    };
    wbSetDragCursor(type === 'resize' ? 'nwse-resize' : 'grabbing');
}

/** Apply the live pointer position to the dragged/resized note's DOM only. */
function wbUpdateNoteDragFromClient(clientX, clientY) {
    const drag = wbActiveDrag;
    if (!drag || drag.phase !== 'active') return;
    if (!drag.moved && wbExceedsMoveThreshold(drag.startClientX, drag.startClientY, clientX, clientY, WB_DRAG_MOVE_THRESHOLD)) {
        drag.moved = true;
    }
    const { dx, dy } = wbDragBoardDelta(drag.startClientX, drag.startClientY, clientX, clientY, wbCurrentZoom());
    const fo = drag.entry.fo;
    if (drag.type === 'move') {
        const x = Math.round(drag.startX + dx);
        const y = Math.round(drag.startY + dy);
        fo.setAttribute('x', String(x));
        fo.setAttribute('y', String(y));
        fo.dataset.wbX = String(x);
        fo.dataset.wbY = String(y);
    } else if (drag.type === 'resize') {
        const width = wbClampNoteWidth(drag.startWidth + dx);
        const height = wbClampNoteHeight(drag.startHeight + dy);
        fo.setAttribute('width', String(width));
        fo.setAttribute('height', String(height));
        fo.dataset.wbWidth = String(width);
        fo.dataset.wbHeight = String(height);
    }
}

/**
 * The one markdown commit for an entire gesture: re-read the whiteboard
 * table fresh from #planEditor (never from a cached copy -- the row order
 * itself may have changed since this note was last rendered), apply
 * `mutateItemFn` to this note's own row (skip for a plain reorder-only
 * click), move that row to the end (front), and commit through the exact
 * same wbCommitMarkdown() path checkbox ticks use. wbCommitMarkdown()'s
 * own byte-identical-text guard makes this safe to call even when nothing
 * actually changed (a click that was already frontmost at its current
 * position) -- no write, no undo step, no-op.
 */
function wbCommitNoteChange(taskName, mutateItemFn) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName) return false;
    if (typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return false;
    }

    const planText = editor.value;
    const section = extractWhiteboardFromPlanText(planText);
    let items = parseWhiteboardMarkdown(section);
    const key = String(taskName).toLowerCase();
    const idx = items.findIndex(it => it && String(it.task).toLowerCase() === key);
    if (idx === -1) return false; // row vanished from underneath us -- nothing to persist

    if (typeof mutateItemFn === 'function') mutateItemFn(items[idx]);
    items = wbMoveTaskToEnd(items, taskName).items;

    const nextText = updatePlanWhiteboardText(planText, items);
    return wbCommitMarkdown(nextText);
}

/** End the active drag/resize gesture and commit its result (if any). */
function wbFinishDrag() {
    const drag = wbActiveDrag;
    if (!drag) return;
    wbActiveDrag = null;
    wbSetDragCursor('');

    const taskName = drag.entry.fo.dataset.wbTask;
    const rect = wbNoteCurrentRect(drag.entry);
    wbCommitNoteChange(taskName, (item) => {
        if (drag.type === 'move') {
            item.x = Math.round(rect.x);
            item.y = Math.round(rect.y);
        } else if (drag.type === 'resize') {
            item.width = Math.round(rect.width);
            item.height = Math.round(rect.height);
        }
    });
}

/** A touch lifted before its long-press timer escalated to a real drag: a plain tap. Raise to front only, never move. */
function wbFinishNoteTap(entry) {
    wbRaiseNoteToFront(entry);
    wbCommitNoteChange(entry.fo.dataset.wbTask, null);
}

function wbFindTouchById(touchList, id) {
    if (!touchList) return null;
    for (let i = 0; i < touchList.length; i++) {
        if (touchList[i].identifier === id) return touchList[i];
    }
    return null;
}

// ── Mouse entry points (wired in wbCreateNoteNode()) ────────────────────

function wbNoteHeaderMouseDown(e, entry) {
    if (e.button !== 0 || wbActiveDrag) return;
    // The menu button (issue #849, not this issue's to build or wire) is
    // a sibling inside the same header -- never hijack its own click.
    if (e.target && e.target.closest && e.target.closest('.wb-note-menu-btn')) return;
    e.preventDefault();
    e.stopPropagation(); // never let this fall through to canvas panning
    wbBeginDrag('move', entry, e.clientX, e.clientY);
}

function wbNoteResizeMouseDown(e, entry) {
    if (e.button !== 0 || wbActiveDrag) return;
    e.preventDefault();
    e.stopPropagation();
    wbBeginDrag('resize', entry, e.clientX, e.clientY);
}

function wbNoteDragMouseMove(e) {
    if (!wbActiveDrag || wbActiveDrag.touchId !== null) return;
    wbUpdateNoteDragFromClient(e.clientX, e.clientY);
}

function wbNoteDragMouseUp(e) {
    if (!wbActiveDrag || wbActiveDrag.touchId !== null) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    wbFinishDrag();
}

// ── Touch entry points ───────────────────────────────────────────────────
//
// A note's header starts in a 'pending' phase rather than dragging
// immediately: only a sustained hold (WB_TOUCH_LONG_PRESS_MS) escalates it
// to an actual drag (wbActiveDrag.phase = 'active'), so a quick tap never
// moves the note and a swipe that turns out to be an attempted pan/scroll
// started on top of a note is abandoned rather than dragging by accident.
// The resize handle has no such ambiguity (there is nothing else a touch
// on that specific small corner grip could mean), so it goes straight to
// 'active'.

function wbNoteHeaderTouchStart(e, entry) {
    if (wbActiveDrag || e.touches.length !== 1) return;
    if (e.target && e.target.closest && e.target.closest('.wb-note-menu-btn')) return;

    const touch = e.touches[0];
    const rect = wbNoteCurrentRect(entry);
    wbActiveDrag = {
        phase: 'pending',
        type: 'move',
        entry,
        touchId: touch.identifier,
        startClientX: touch.clientX,
        startClientY: touch.clientY,
        startX: rect.x,
        startY: rect.y,
        startWidth: rect.width,
        startHeight: rect.height,
        moved: false,
        longPressTimer: setTimeout(() => {
            if (!wbActiveDrag || wbActiveDrag.entry !== entry) return;
            wbActiveDrag.phase = 'active';
            wbActiveDrag.longPressTimer = null;
            wbRaiseNoteToFront(entry);
            wbSetDragCursor('grabbing');
        }, WB_TOUCH_LONG_PRESS_MS),
    };
}

function wbNoteResizeTouchStart(e, entry) {
    if (wbActiveDrag || e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    wbBeginDrag('resize', entry, touch.clientX, touch.clientY, touch.identifier);
}

function wbNoteDragTouchMove(e) {
    const drag = wbActiveDrag;
    if (!drag || drag.touchId === null) return;
    const touch = wbFindTouchById(e.touches, drag.touchId);
    if (!touch) return;

    if (drag.phase === 'pending') {
        if (wbExceedsMoveThreshold(drag.startClientX, drag.startClientY, touch.clientX, touch.clientY, WB_TOUCH_CANCEL_THRESHOLD)) {
            // Moved too far before the long-press fired -- most likely the
            // user meant to pan/scroll, not drag this note. Abandon the
            // gesture with no side effects at all (no move, no reorder).
            if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
            wbActiveDrag = null;
        }
        return; // never move the note during the pending phase
    }

    e.preventDefault();
    wbUpdateNoteDragFromClient(touch.clientX, touch.clientY);
}

function wbNoteDragTouchEnd(e) {
    const drag = wbActiveDrag;
    if (!drag || drag.touchId === null) return;
    if (wbFindTouchById(e.touches, drag.touchId)) return; // a different touch ended

    if (drag.phase === 'pending') {
        if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
        wbActiveDrag = null;
        wbFinishNoteTap(drag.entry);
        return;
    }
    wbFinishDrag();
}

if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', wbNoteDragMouseMove);
    window.addEventListener('mouseup', wbNoteDragMouseUp);
    window.addEventListener('touchmove', wbNoteDragTouchMove, { passive: false });
    window.addEventListener('touchend', wbNoteDragTouchEnd);
    window.addEventListener('touchcancel', wbNoteDragTouchEnd);
}

/** Build one child-task row for a note body. */
function wbBuildChildRow(childVm) {
    const child = childVm.task;
    const row = document.createElementNS(XHTML_NS, 'div');
    row.setAttribute('class', 'wb-note-row');

    const checkbox = document.createElementNS(XHTML_NS, 'input');
    checkbox.setAttribute('type', 'checkbox');
    checkbox.setAttribute('class', 'wb-note-checkbox');
    const isComplete = childVm.complete;
    if (isComplete) checkbox.setAttribute('checked', 'checked');
    checkbox.checked = isComplete;
    checkbox.title = isComplete ? 'Mark as incomplete' : 'Mark as complete';
    checkbox.setAttribute('aria-label', `Mark "${child.name}" as ${isComplete ? 'incomplete' : 'complete'}`);
    checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        const checked = checkbox.checked;
        if (checked && typeof spawnConfetti === 'function') {
            spawnConfetti(checkbox);
        }
        wbToggleChildComplete(child, checked);
    });
    row.appendChild(checkbox);

    if (child.deliverable) {
        const badge = document.createElementNS(XHTML_NS, 'span');
        badge.setAttribute('class', 'wb-note-deliverable-badge');
        badge.setAttribute('title', `Deliverable: ${child.deliverable}`);
        badge.textContent = '$';
        row.appendChild(badge);
    }

    const name = document.createElementNS(XHTML_NS, 'span');
    name.setAttribute('class', 'wb-note-row-name');
    name.textContent = child.name;
    name.setAttribute('title', child.name);
    row.appendChild(name);

    if (childVm.hasChildren) {
        const badge = document.createElementNS(XHTML_NS, 'button');
        badge.setAttribute('type', 'button');
        badge.setAttribute('class', 'wb-note-count-badge');
        badge.setAttribute('aria-haspopup', 'dialog');
        badge.setAttribute('aria-expanded', 'false');
        badge.textContent = `${childVm.childCount} ▾`;
        badge.setAttribute('aria-label', `${child.name} has ${childVm.childCount} subtasks. Peek subtasks.`);
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            wbTogglePeekFor(child.name, badge);
        });
        row.appendChild(badge);

        // The badge's own click already stopPropagation()s, so this row-
        // level listener only ever fires for a click on the row's own
        // name/blank area -- the issue's "click a todo's child-count
        // badge, or the todo row itself" affordance.
        row.classList.add('wb-note-row-drillable');
        row.addEventListener('click', () => wbTogglePeekFor(child.name, badge));
    }

    return row;
}

/**
 * Toggle the task-peek popover (issue #850, task-peek.js) for `taskName`,
 * anchored near `anchorEl` (the badge, or row, that was clicked). Clicking
 * the badge/row for whichever task's peek is already open closes it again
 * -- mirrors the `...` menu's own open/close toggle (wbOpenNoteMenu()/
 * wbCloseNoteMenu()); otherwise it opens (or re-roots, if a different
 * task's peek was open) a fresh peek listing that task's own direct
 * children.
 */
function wbTogglePeekFor(taskName, anchorEl) {
    if (typeof TaskPeek === 'undefined' || !TaskPeek) {
        wbOpenChildTask(taskName); // peek component not loaded in this build -- escalate straight to details
        return;
    }
    if (TaskPeek.isOpenFor(taskName)) {
        TaskPeek.close();
        return;
    }
    wbOpenChildPeek(taskName, anchorEl);
}

/**
 * Build the peek's root level for `taskName` from the current wbLastTasks
 * and open it. The popover is anchored to the note *card* containing
 * `anchorEl` (not the badge/row itself), so it reads as attached to the
 * whole note -- the issue's "anchored to the note" wording -- while
 * `anchorEl` (the actual badge/row clicked) is still what gets focus back
 * on close. Wires the peek's callbacks to this file's own existing commit
 * paths: onToggle -> wbToggleChildComplete() (the exact same percent-
 * writing path a note's own checkbox uses), onOpenDetails ->
 * wbOpenChildTask() (the same "open the task-details form" escalation the
 * note `...` menu's new item uses -- see wbAppendOpenTaskMenuSection()).
 */
function wbOpenChildPeek(taskName, anchorEl) {
    if (typeof TaskPeek === 'undefined' || !TaskPeek) return;
    const level = wbBuildPeekLevel(taskName, wbLastTasks);
    if (!level) return;

    const card = (anchorEl && anchorEl.closest) ? anchorEl.closest('.wb-note-card') : null;

    TaskPeek.open({
        anchorEl: card || anchorEl,
        triggerEl: anchorEl,
        level,
        resolveLevel: (name) => wbBuildPeekLevel(name, wbLastTasks),
        onToggle: (task, checked) => wbToggleChildComplete(task, checked),
        onOpenDetails: (task) => wbOpenChildTask(task.name),
    });
}

/**
 * Escalate to the existing task-details FORM for `taskName` (issue #850)
 * -- the same editable form product views open via openTaskFormByName()
 * (see views-products.js's switchProductToTaskForm(), views-search.js,
 * views-tables.js), not the read-only Task Inspector this function used
 * to jump to directly before the peek existed. Reused as-is from both
 * entry points this issue adds: the peek's own "Open task details" header
 * button (task-peek.js) and the note `...` menu's new "Open task details"
 * item (wbAppendOpenTaskMenuSection() below) -- neither builds a second
 * way to open that form. Falls back to the Task Inspector, then a
 * console.log no-op, if neither is available in this build.
 */
function wbOpenChildTask(taskName) {
    if (typeof openTaskFormByName === 'function') {
        openTaskFormByName(taskName);
    } else if (typeof openTaskInspectorByName === 'function') {
        openTaskInspectorByName(taskName);
    } else {
        console.log('[whiteboard] open task (no task form available):', taskName);
    }
}

/**
 * Write `checked`'s percent (100%/0%) onto childTask's own markdown line
 * and commit it through the exact same path Kanban's checkbox uses:
 * findTaskLineNumber() + updatePercentInLine() (script.js/editor-sync.js
 * globals, already used by the task inspector's own subtask checkboxes)
 * to locate/rewrite the line, then wbCommitMarkdown() to push it through
 * #planEditor the same way KanbanBoard.commitMarkdown() does.
 */
function wbToggleChildComplete(childTask, checked) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;
    if (typeof findTaskLineNumber !== 'function' || typeof updatePercentInLine !== 'function') return;

    const lineNumber = findTaskLineNumber({ name: childTask.name });
    if (lineNumber === -1) return;

    const lines = editor.value.split('\n');
    const line = lines[lineNumber - 1];
    if (!line) return;

    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
    const newPercent = checked ? '100%' : '0%';
    lines[lineNumber - 1] = updatePercentInLine(line, newPercent, indent, childTask.name);

    wbCommitMarkdown(lines.join('\n'));
}

/**
 * Commit new plan text through #planEditor -- mirrors
 * KanbanBoard.commitMarkdown() (kanban.js) exactly: write the value once,
 * sync the cached/stored project, dispatch a single 'input' event (undo
 * snapshot scheduling, line numbers, and the existing mainEditor<->
 * kanbanEditor sync listener all key off this), then call renderText()
 * immediately so every view -- Gantt, Kanban, the editor, and this note --
 * reflects the change without waiting for the 1s auto-render debounce.
 */
function wbCommitMarkdown(nextText) {
    const editor = document.getElementById('planEditor');
    if (!editor || nextText === editor.value) return false;

    editor.value = nextText;
    if (typeof getCurrentProjectId === 'function') {
        const projectId = getCurrentProjectId();
        if (projectId && typeof updateCachedProject === 'function') {
            updateCachedProject(projectId, { planText: nextText });
        } else if (projectId && typeof saveProject === 'function') {
            saveProject(projectId, { planText: nextText });
        }
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    if (typeof renderText === 'function') {
        Promise.resolve(renderText()).catch(error => {
            console.error('Whiteboard note update render failed:', error);
        });
    }
    return true;
}

// ── Note colour menu (issue #849) ───────────────────────────────────────
//
// A single floating popup, appended to document.body and rebuilt on each
// open -- follows status-bar.js's openStatusHistoryPopup()/
// closeStatusHistoryPopup()/handleStatusPopupOutsideClick()/
// handleStatusPopupEscape() convention (a single shared popup, torn down
// and rebuilt rather than nav.js's fixed-ID dropdown registry) since
// notes -- and therefore their menus -- are created/destroyed
// dynamically as whiteboard rows come and go, and because appending to
// document.body (rather than inside the note's own small SVG
// <foreignObject>) avoids the popup being clipped to the note's own
// width/height.

/**
 * Parse the Theme: front-matter block once per render pass (see
 * wbRenderNotes(), which calls this once and passes the result to every
 * note's view model rather than each note re-parsing it) -- reuses
 * kanban.js's parsePlanThemeColours() rather than a second parser;
 * guarded for this file's own vm-sandboxed unit tests, which load
 * whiteboard-notes.js alone.
 */
function wbThemeColoursFromPlanText(planText) {
    if (typeof parsePlanThemeColours === 'function') return parsePlanThemeColours(planText);
    return {};
}

/**
 * The current whiteboard row for `taskName`, or null. Reads the cached
 * wbLastPlanText (see updateWhiteboardView()) -- the same source
 * wbRenderNotes() itself reads -- so this always agrees with what's on
 * screen even when called outside a render pass (e.g. from the menu).
 */
function wbCurrentRowFor(taskName) {
    if (typeof extractWhiteboardFromPlanText !== 'function' || typeof parseWhiteboardMarkdown !== 'function') {
        return null;
    }
    const section = extractWhiteboardFromPlanText(wbLastPlanText);
    if (!section) return null;
    const key = String(taskName).toLowerCase();
    const rows = parseWhiteboardMarkdown(section);
    return rows.find(r => r && r.task && r.task.toLowerCase() === key) || null;
}

/**
 * The colour the menu should show as "selected" right now: a pending,
 * not-yet-committed pick if one exists (see wbColourOverrides), else the
 * real resolved colour (row -> Theme: -> derived palette).
 */
function wbCurrentNoteColour(taskName) {
    if (wbColourOverrides.has(taskName)) {
        const pending = wbColourOverrides.get(taskName);
        return pending ? pending.toUpperCase() : wbDerivedPaletteColour(wbLastTasks, taskName);
    }
    const row = wbCurrentRowFor(taskName);
    const key = String(taskName).toLowerCase();
    const task = (wbLastTasks || []).find(t => t && String(t.name).toLowerCase() === key);
    const themeColours = wbThemeColoursFromPlanText(wbLastPlanText);
    return wbResolveNoteColour(row, task, wbLastTasks, themeColours).colour;
}

/**
 * Drop any optimistic override whose desired outcome the *committed*
 * plan text now already produces -- called once per render pass (see
 * wbRenderNotes()), before view models are built, so a colour picked
 * while its debounced commit is still pending keeps showing until (and
 * exactly until) that commit lands and a real re-render agrees with it.
 * A task that no longer exists (deleted while a pick was pending) drops
 * its override unconditionally rather than holding on to it forever.
 */
function wbReconcileColourOverrides(rows, themeColours) {
    if (!wbColourOverrides.size) return;
    wbColourOverrides.forEach((desired, taskName) => {
        const key = String(taskName).toLowerCase();
        const task = (wbLastTasks || []).find(t => t && String(t.name).toLowerCase() === key);
        if (!task) {
            wbColourOverrides.delete(taskName);
            return;
        }
        const row = (rows || []).find(r => r && r.task && r.task.toLowerCase() === key);
        const committed = wbResolveNoteColour(row, task, wbLastTasks, themeColours).colour;
        const desiredResolved = desired ? desired.toUpperCase() : wbDerivedPaletteColour(wbLastTasks, task.name);
        if (committed === desiredResolved) wbColourOverrides.delete(taskName);
    });
}

/**
 * Build the `...` note menu's DOM: a <div role="menu"> wrapping a <ul>
 * that section-builders append <li> items to. THIS issue (#849) only
 * ever adds the colour section (wbAppendColourMenuSection() below) -- it
 * is deliberately structured so two later, separate issues can cleanly
 * add their own item without touching the colour section's DOM or this
 * function's body:
 *   - #847 "Remove from board": append one more <li> holding a
 *     <button role="menuitem"> to `list`, same shape as the "Default
 *     colour" button below; call wbCloseNoteMenu() from its handler.
 *   - #850 "Open task details": done -- see wbAppendOpenTaskMenuSection()
 *     below, reusing wbOpenChildTask() (defined earlier in this file).
 * Neither of those needs to know how many colour swatches exist, and
 * the colour section doesn't need to know they exist either -- they
 * only ever share `list`.
 */
function wbBuildNoteMenu(taskName) {
    const menu = document.createElement('div');
    menu.id = 'wbNoteMenu';
    menu.className = 'wb-note-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Note options');

    const list = document.createElement('ul');
    list.className = 'wb-note-menu-list';
    menu.appendChild(list);

    wbAppendColourMenuSection(list, taskName);
    wbAppendOpenTaskMenuSection(list, taskName);

    return menu;
}

/**
 * Append this issue's (#850) entire contribution to the note menu: a
 * single "Open task details" action, reusing wbOpenChildTask() (the same
 * escalation the peek's own header button calls) rather than building a
 * second way to open the task-details form.
 */
function wbAppendOpenTaskMenuSection(list, taskName) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-note-menu-open-task';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = 'Open task details';
    btn.setAttribute('aria-label', `Open task details for ${taskName}`);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbOpenChildTask(taskName);
    });
    li.appendChild(btn);
    list.appendChild(li);
}

/**
 * Append this issue's entire contribution to the note menu: a "Default
 * colour" action (tier 3 of the precedence -- clears any row/Theme:
 * override) followed by the mind map's own swatch grids (Palette ==
 * MM_BRANCH_COLOURS, Pastel == CF_PASTEL_COLOURS, Dark == CF_DARK_COLOURS
 * -- see the issue's "do not invent a third palette" instruction), each
 * as a labelled <li> + a grid <li> so keyboard users can jump between
 * items with wbNoteMenuKeydown()'s Arrow/Home/End handling.
 */
function wbAppendColourMenuSection(list, taskName) {
    const currentColour = wbCurrentNoteColour(taskName);

    const defaultLi = document.createElement('li');
    const defaultBtn = document.createElement('button');
    defaultBtn.type = 'button';
    defaultBtn.className = 'wb-note-menu-default';
    defaultBtn.setAttribute('role', 'menuitem');
    defaultBtn.textContent = 'Default colour';
    defaultBtn.setAttribute('aria-label', 'Use the default palette colour');
    defaultBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbHandleNoteColourPick(taskName, null);
    });
    defaultLi.appendChild(defaultBtn);
    list.appendChild(defaultLi);

    function addSection(label, colours) {
        if (!colours || !colours.length) return;

        const labelLi = document.createElement('li');
        labelLi.className = 'wb-note-menu-label';
        labelLi.setAttribute('role', 'presentation');
        labelLi.textContent = label;
        list.appendChild(labelLi);

        const gridLi = document.createElement('li');
        gridLi.setAttribute('role', 'presentation');
        const grid = document.createElement('div');
        grid.className = 'wb-note-menu-grid';
        colours.forEach(colour => {
            grid.appendChild(wbBuildColourSwatchButton(colour, taskName, currentColour));
        });
        gridLi.appendChild(grid);
        list.appendChild(gridLi);
    }

    addSection('Palette', wbPalette());
    addSection('Pastel', (typeof CF_PASTEL_COLOURS !== 'undefined') ? CF_PASTEL_COLOURS : []);
    addSection('Dark', (typeof CF_DARK_COLOURS !== 'undefined') ? CF_DARK_COLOURS : []);
}

/**
 * One colour swatch button inside the menu's grid -- a checkmark, shaded
 * per wbContrastTextColour() against the swatch itself (not the header's
 * softened fill: the swatch here shows its own true colour), marks
 * whichever swatch is currently selected.
 */
function wbBuildColourSwatchButton(colour, taskName, currentColour) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-note-menu-swatch';
    btn.setAttribute('role', 'menuitem');
    btn.style.background = colour;
    btn.title = colour;
    btn.setAttribute('aria-label', `Set note colour to ${colour}`);

    const selected = !!currentColour && currentColour.toUpperCase() === colour.toUpperCase();
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    if (selected) {
        btn.classList.add('selected');
        const check = document.createElement('span');
        check.className = 'wb-note-menu-swatch-check';
        check.textContent = '✓';
        check.style.color = wbContrastTextColour(colour) || '#161616';
        btn.appendChild(check);
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbHandleNoteColourPick(taskName, colour);
    });
    return btn;
}

/**
 * Open the `...` menu for one note, anchored under its button. Positions
 * like nav.js's positionNavMenu(): flip above the button instead of
 * below if there isn't room, clamp horizontally to the viewport.
 */
function wbOpenNoteMenu(taskName, btn) {
    wbCloseNoteMenu();

    const menu = wbBuildNoteMenu(taskName);
    document.body.appendChild(menu);

    const edgeGap = 8;
    const btnRect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = Math.min(btnRect.left, window.innerWidth - menuRect.width - edgeGap);
    left = Math.max(edgeGap, left);
    let top = btnRect.bottom + 4;
    if (top + menuRect.height > window.innerHeight - edgeGap) {
        top = Math.max(edgeGap, btnRect.top - menuRect.height - 4);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    btn.setAttribute('aria-expanded', 'true');
    wbNoteMenuState = { taskName, btn };

    document.addEventListener('mousedown', wbNoteMenuOutsideClick, true);
    document.addEventListener('keydown', wbNoteMenuKeydown, true);

    const first = menu.querySelector('[role="menuitem"]');
    if (first) first.focus();
}

/** Close the `...` menu, if one is open, and tear down its listeners. */
function wbCloseNoteMenu() {
    const menu = document.getElementById('wbNoteMenu');
    if (menu) menu.remove();
    document.removeEventListener('mousedown', wbNoteMenuOutsideClick, true);
    document.removeEventListener('keydown', wbNoteMenuKeydown, true);
    if (wbNoteMenuState && wbNoteMenuState.btn) {
        wbNoteMenuState.btn.setAttribute('aria-expanded', 'false');
    }
    wbNoteMenuState = null;
}

/** Outside click closes the menu -- mirrors status-bar.js's
 * handleStatusPopupOutsideClick() (mousedown, capture phase, so it beats
 * any click-driven UI already listening on click/bubble). */
function wbNoteMenuOutsideClick(e) {
    const menu = document.getElementById('wbNoteMenu');
    if (!menu) return;
    if (menu.contains(e.target)) return;
    if (wbNoteMenuState && wbNoteMenuState.btn && wbNoteMenuState.btn.contains(e.target)) return;
    wbCloseNoteMenu();
}

/**
 * Escape closes the menu and refocuses its `...` button; Arrow/Home/End
 * move focus between swatches -- mirrors nav.js's own
 * `[role="menuitem"]` keyboard handling for its dropdown menus.
 */
function wbNoteMenuKeydown(e) {
    const menu = document.getElementById('wbNoteMenu');
    if (!menu) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        const btn = wbNoteMenuState && wbNoteMenuState.btn;
        wbCloseNoteMenu();
        if (btn) btn.focus();
        return;
    }

    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        items[(index + 1 + items.length) % items.length].focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
        e.preventDefault();
        items[0].focus();
    } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1].focus();
    }
}

/**
 * Handle one swatch (or "Default colour") pick: close the menu and
 * refocus its button immediately, apply the colour to the note's DOM
 * immediately (via wbColourOverrides + a synchronous re-render -- see
 * wbBuildNoteViewModel()), but debounce the actual Markdown write (this
 * repo's resourceDebounceTimer-style convention, script.js) so clicking
 * through several swatches in a row still commits (and undoes) as one
 * step. `wbPendingColourPicks` coalesces by task name, so re-picking the
 * same note before the timer fires only ever commits its latest value.
 */
function wbHandleNoteColourPick(taskName, colourOrNull) {
    const openBtn = wbNoteMenuState && wbNoteMenuState.btn;
    wbCloseNoteMenu();
    if (openBtn) openBtn.focus();

    wbColourOverrides.set(taskName, colourOrNull);
    wbPendingColourPicks.set(taskName, colourOrNull);
    wbRenderNotes();

    if (wbColourCommitTimer) clearTimeout(wbColourCommitTimer);
    wbColourCommitTimer = setTimeout(() => {
        wbColourCommitTimer = null;
        wbFlushPendingColourPicks();
    }, 600);
}

/**
 * Rewrite one task's colour into `planText`: strip any pre-existing
 * whiteboard-row `Colour` value for that task (see this file's header
 * for why the menu normalises to a single source of truth -- the
 * Theme: block -- rather than the issue's optional per-board-only
 * write), then set or remove the `Theme:` entry via kanban.js's
 * buildPlanTextWithThemeColours(). Touches only those two things; every
 * other whiteboard row/column and front-matter key is left exactly as
 * it was.
 */
function wbApplyNoteColourToPlanText(planText, taskName, colourOrNull) {
    let result = planText;

    if (typeof extractWhiteboardFromPlanText === 'function' &&
        typeof parseWhiteboardMarkdown === 'function' &&
        typeof updatePlanWhiteboardText === 'function') {
        const section = extractWhiteboardFromPlanText(result);
        if (section) {
            const items = parseWhiteboardMarkdown(section);
            const key = String(taskName).toLowerCase();
            let changed = false;
            items.forEach(item => {
                if (item.task && item.task.toLowerCase() === key && item.colour) {
                    item.colour = '';
                    changed = true;
                }
            });
            if (changed) result = updatePlanWhiteboardText(result, items);
        }
    }

    if (typeof parsePlanThemeColours === 'function' && typeof buildPlanTextWithThemeColours === 'function') {
        const themeColours = parsePlanThemeColours(result);
        if (colourOrNull) {
            themeColours[taskName] = colourOrNull.toUpperCase();
        } else {
            delete themeColours[taskName];
        }
        result = buildPlanTextWithThemeColours(result, themeColours);
    }

    return result;
}

/**
 * Apply every coalesced pending pick to the live editor text and commit
 * once (see wbHandleNoteColourPick()'s doc comment for why this is
 * debounced). wbColourOverrides is left alone here -- it is reconciled
 * and cleared by wbReconcileColourOverrides() once the commit's
 * resulting re-render actually lands, not eagerly on this synchronous
 * return (wbCommitMarkdown()'s renderText() call is asynchronous).
 */
function wbFlushPendingColourPicks() {
    if (!wbPendingColourPicks.size) return;
    const editor = document.getElementById('planEditor');
    if (!editor) {
        wbPendingColourPicks.clear();
        return;
    }

    let planText = editor.value;
    wbPendingColourPicks.forEach((colourOrNull, taskName) => {
        planText = wbApplyNoteColourToPlanText(planText, taskName, colourOrNull);
    });
    wbPendingColourPicks.clear();
    wbCommitMarkdown(planText);
}
