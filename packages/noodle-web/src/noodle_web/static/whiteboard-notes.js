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
 *      (wbDerivedPaletteColour(), drawing from WB_NOTE_PASTEL_COLOURS --
 *      the fixed pastel "post-it" palette issue #1017 introduced,
 *      dedicated to this file and not shared with the mind map's or the
 *      boards view's own palettes) -- always defined, so a note is never
 *      left uncoloured; "clear" in the menu means "fall back to this".
 *
 * A note's colour is manual, per-note shorthand: picking a swatch has no
 * semantic or conditional-formatting meaning, and is entirely unrelated
 * to the boards view's rule-based conditional formatting (kanban.js/
 * state.js's CF_PASTEL_COLOURS/CF_DARK_COLOURS, a different, rule-driven
 * system -- see #1017). It still writes into the plan's shared `Theme:`
 * front matter (tier 2 above), exactly as #849 did -- that storage/
 * precedence mechanism is unchanged; only the swatches offered changed.
 * An old colour value that doesn't match any current swatch (e.g. one
 * picked from #849's old MM_BRANCH_COLOURS/CF_* grids, or a hand-edited
 * hex) still renders exactly as stored -- rendering never requires a
 * value to match a known swatch, it just won't show as "selected" in
 * the menu until a new pick is made.
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

/** Two presses on the same note header within this window, and within
 * WB_HEADER_DOUBLE_PRESS_SLOP pixels, mean "rename" -- see
 * wbIsRepeatHeaderPress(). Matches the platform double-click default
 * rather than WB_TOUCH_LONG_PRESS_MS, which is a different gesture. */
const WB_HEADER_DOUBLE_PRESS_MS = 450;
const WB_HEADER_DOUBLE_PRESS_SLOP = 6;

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

/** Last header press, for the double-press rename gesture. See
 * wbIsRepeatHeaderPress(). */
let wbLastHeaderPress = null;

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
 * A fixed pastel "post-it" palette, dedicated to whiteboard notes (issue
 * #1017 -- supersedes #849/#840's choice of swatch source, not #849's
 * menu/interaction pattern itself, which is unchanged). Two soft shades
 * each of yellow, pink, green, blue and red -- genuinely pastel (high
 * lightness, low saturation) rather than the saturated hues elsewhere in
 * the app, so notes read like real paper stickies.
 *
 * Deliberately NOT mindmap.js's MM_BRANCH_COLOURS (the mind map's own
 * branch palette) and NOT kanban.js/state.js's CF_PASTEL_COLOURS /
 * CF_DARK_COLOURS (the boards view's rule-based *conditional formatting*
 * swatches -- "CF" == Conditional Formatting) -- #849 borrowed both of
 * those (see git history), which is exactly the coupling #1017 removes:
 * a note's colour is personal shorthand picked by hand, with no
 * relationship to the boards view's rule engine and no third system's
 * palette silently doubling as this one's. A colour picked here still
 * writes into the plan's `Theme:` front matter, same as #849 (see
 * wbApplyNoteColourToPlanText() below) -- that write path, and the
 * row-Colour -> Theme: -> derived-palette precedence built on it, is a
 * markdown-format/storage concern this issue does not touch, only which
 * swatches the menu *offers* changes.
 *
 * Contrast is verified by tests/test_whiteboard_note_colour.py's
 * TestNoteColourContrast against the real rendered header in both
 * themes; a swatch's raw value is never applied directly as a
 * background (wbUpdateNoteNode() always darkens it via wbShadeColour(_,
 * 0.3) first — see that call for why every pastel here still yields a
 * dark, legible header fill).
 */
const WB_NOTE_PASTEL_COLOURS = [
    '#FFF3B0', '#FCE38A', // yellow
    '#FFD6E0', '#F7A8B8', // pink
    '#CFF4D2', '#B8E6B8', // green
    '#C7E5FF', '#A9D6F5', // blue
    '#FFCBC1', '#FFAFA3', // red
];

/**
 * The swatch palette to offer -- see WB_NOTE_PASTEL_COLOURS above for why
 * this is its own fixed list rather than a reuse of some other system's
 * palette. Also backs tier 3 of the colour precedence
 * (wbDerivedPaletteColour() below), so a note that has never had a
 * colour picked still gets a soft, on-brand default instead of an
 * arbitrary saturated one.
 */
function wbPalette() {
    return WB_NOTE_PASTEL_COLOURS;
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
function wbBuildNoteViewModel(row, tasks, themeColours = {}, boardNames = null) {
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

    // A direct child that has a post-it of its own is shown as a *noodle*
    // to that note, not as a row inside this one -- otherwise the same
    // relationship would be drawn twice, once as a line and once as a
    // checklist item, and ticking the row would silently be a different
    // gesture from cutting the line. `boardNames` is the set of task names
    // with a row on the board; passing none (the default) keeps the old
    // "every direct child is a row" behaviour, which is what the pure unit
    // tests and any caller that doesn't care about the board exercise.
    const onBoard = boardNames instanceof Set
        ? boardNames
        : new Set((boardNames || []).map(n => String(n).toLowerCase()));

    const allChildren = wbDirectChildren(tasks, task.name).map(child => ({
        task: child,
        hasChildren: wbHasChildren(tasks, child.name),
        childCount: wbChildCount(tasks, child.name),
        complete: wbIsChildComplete(child),
        onBoard: onBoard.has(String(child.name).toLowerCase()),
    }));
    const children = allChildren.filter(c => !c.onBoard);
    const linkedChildren = allChildren.filter(c => c.onBoard);

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
        linkedChildren,
        // The note's own parent, when that parent is itself on the board --
        // i.e. the noodle arriving at this note. Drives the header's
        // "under X" caption and the `...` menu's Unlink item.
        linkedParent: (task.parent && onBoard.has(String(task.parent).toLowerCase()))
            ? task.parent
            : null,
        parentName: task.parent || null,
        progress: wbNoteProgress(tasks, task.name),
        resources: wbResourceList(task.resources),
        colour: resolvedColour.colour,
        colourSource: resolvedColour.source,
    };
}

/** wbBuildNoteViewModel() for every row, skipping orphans. */
function wbNoteViewModels(rows, tasks, themeColours = {}, boardNames = null) {
    const names = boardNames || new Set(
        (rows || []).map(r => r && r.task).filter(Boolean).map(n => String(n).toLowerCase())
    );
    return (rows || [])
        .map(row => wbBuildNoteViewModel(row, tasks, themeColours, names))
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

// ── Board membership pure helpers (issue #847 -- no DOM, unit tested) ───
//
// "Which summary tasks aren't on the board yet", "where does a new note
// go without overlapping anything", and "Phase › Sub-phase" path-building
// for the Add-note picker. Kept alongside the drag/resize pure helpers
// above for the same reason: no DOM, easy to hit from
// tests/test_whiteboard_notes.js's vm sandbox, and free of any dependency
// on wbLastTasks/wbLastPlanText module state so callers (and tests) always
// pass in exactly the data being reasoned about.

const WB_TASK_PATH_SEP = ' › '; // same glyph msproject-task-diff.js uses for the same idea

/** name -> first task with that name, in document order. `.parent` links
 * (and every other name-based lookup in this codebase, e.g.
 * wbBuildNoteViewModel's own task lookup) are name-only, so a lookup by
 * name alone can never be fully disambiguated when two tasks share a
 * name -- "first in document order" is simply a deterministic, consistent
 * choice for that inherent ambiguity, matching Array.find()'s own
 * first-match semantics used elsewhere in this file. */
function wbTasksByName(tasks) {
    const byName = new Map();
    (tasks || []).forEach(t => { if (t && t.name && !byName.has(t.name)) byName.set(t.name, t); });
    return byName;
}

/**
 * The ancestor chain for `task` (an actual task *object*, not just its
 * name) -- root-most phase first, immediate parent last -- excluding the
 * task itself, built by walking `.parent` links (the same relation
 * wbDirectChildren() uses; see scheduler.js). Starting from the object
 * itself (rather than re-resolving `task.name` back through `byName`)
 * matters: it's exactly what keeps two *same-named* summary tasks'
 * *own* paths correct (each walk starts from the right one), even though
 * resolving any single *ancestor* name past that point still shares the
 * whole codebase's inherent name-only-lookup limitation (the very
 * ambiguity #838 describes, and that this picker's path display exists to
 * make visible rather than to fully eliminate -- eliminating it would
 * need stable task IDs, out of scope here). A cycle-guard (visited-name
 * set) makes this safe against malformed data even though the engine
 * should never produce one.
 */
function wbAncestorNamesForTask(byName, task) {
    const chain = [];
    const visited = new Set();
    let current = task;
    while (current && current.parent && !visited.has(current.parent)) {
        visited.add(current.parent);
        chain.unshift(current.parent);
        current = byName.get(current.parent);
    }
    return chain;
}

/**
 * The ancestor chain for `taskName` -- for callers that only have a name,
 * not the task object itself (e.g. a caller working from a whiteboard
 * row's own `.task` string). Resolves `taskName` via wbTasksByName()'s
 * first-match rule; see wbAncestorNamesForTask() for why the *entries*
 * built by wbSummaryTaskEntries() below deliberately don't go through
 * this extra name round-trip for their own identity.
 */
function wbTaskAncestorNames(tasks, taskName) {
    const byName = wbTasksByName(tasks);
    return wbAncestorNamesForTask(byName, byName.get(taskName));
}

/**
 * "Phase › Sub-phase" display string for `taskName`'s ancestors (not
 * including itself) -- what the Add-note picker shows under a task's name
 * so two same-named summary tasks in different phases are tellable apart
 * (the ambiguity #838 describes). '' for a top-level task.
 */
function wbTaskAncestorPath(tasks, taskName) {
    return wbTaskAncestorNames(tasks, taskName).join(WB_TASK_PATH_SEP);
}

/**
 * Every task that can be put on the board, as a picker entry:
 * `{ name, path, isSummary }`, in `tasks`' own document order. Each
 * entry's path is built from *its own* task object (see
 * wbAncestorNamesForTask()), so two tasks that happen to share a name
 * still each get their own correct path.
 *
 * Originally summary tasks only (`is_summary === true`), because the board
 * could only ever *display* an existing phase. It now creates tasks too,
 * and every post-it starts life as a leaf -- so a picker that hid leaves
 * would refuse to re-add a note the user had just removed from the board.
 * Leaf and summary are still told apart (`isSummary`) so the picker can
 * group and label them; they are simply both offerable.
 */
function wbSummaryTaskEntries(tasks) {
    const byName = wbTasksByName(tasks);
    return (tasks || [])
        .filter(t => t && t.name)
        .map(t => ({
            name: t.name,
            path: wbAncestorNamesForTask(byName, t).join(WB_TASK_PATH_SEP),
            isSummary: !!t.is_summary,
        }));
}

/**
 * The Add-note picker's actual list: every summary task not already
 * represented by a whiteboard row (`rows` -- parseWhiteboardMarkdown()
 * output, or anything with a `.task` string per item), matched
 * case-insensitively like every other whiteboard row lookup in this file.
 */
function wbTasksNotOnBoard(tasks, rows) {
    const onBoard = new Set((rows || []).map(r => r && r.task && r.task.toLowerCase()).filter(Boolean));
    return wbSummaryTaskEntries(tasks).filter(entry => !onBoard.has(entry.name.toLowerCase()));
}

/**
 * Case-insensitive substring match against both a picker entry's name and
 * its parent path -- "Search filters the picker by name and by parent
 * path" (issue #847's acceptance criteria, verbatim). Blank/whitespace
 * query matches everything.
 */
function wbFilterPickerEntries(entries, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return entries || [];
    return (entries || []).filter(entry =>
        (entry.name && entry.name.toLowerCase().includes(q)) ||
        (entry.path && entry.path.toLowerCase().includes(q))
    );
}

/** Axis-aligned rectangle overlap, with an optional buffer `gap` treated
 * as also-forbidden (so two notes never end up touching edge-to-edge). */
function wbRectsOverlap(a, b, gap = 0) {
    return !(
        a.x + a.width + gap <= b.x ||
        b.x + b.width + gap <= a.x ||
        a.y + a.height + gap <= b.y ||
        b.y + b.height + gap <= a.y
    );
}

/**
 * The first free `width` x `height` rectangle for a new note: scans a
 * `width+gap` x `height+gap` grid anchored at `viewportRect`'s top-left,
 * left-to-right then top-to-bottom (a plain shelf-pack -- deliberately
 * not clever, just correct), rejecting any candidate that overlaps an
 * existing rect in `existingRects` (by `gap`) or falls outside
 * `viewportRect`. This is what makes a single add land "visible in the
 * current viewport, not overlapping an existing note" and a multi-add lay
 * out as "a tidy grid" (scanning in row-major order): the acceptance
 * criteria, verbatim.
 *
 * If the viewport is entirely full (every on-screen grid cell taken),
 * scanning continues downward past the viewport's bottom edge, so this
 * always terminates with a genuinely free rect rather than looping
 * forever or silently overlapping something -- the one case this can't
 * satisfy "visible in the current viewport" for, by construction (there's
 * nowhere left to put it), but it still never overlaps.
 */
function wbFindFreeSpacePosition(existingRects, viewportRect, width, height, gap = 24) {
    const vp = viewportRect || { x: 0, y: 0, width: 1200, height: 800 };
    const rects = existingRects || [];
    const startX = vp.x + gap;
    const startY = vp.y + gap;
    const colStep = width + gap;
    const rowStep = height + gap;
    const cols = Math.max(1, Math.floor((vp.width - gap) / colStep));
    const viewportRows = Math.max(1, Math.floor((vp.height - gap) / rowStep));
    const overflowRows = 500; // generous, finite safety cap once the viewport itself is full

    for (let row = 0; row < viewportRows + overflowRows; row++) {
        for (let col = 0; col < cols; col++) {
            const candidate = { x: startX + col * colStep, y: startY + row * rowStep, width, height };
            if (!rects.some(r => wbRectsOverlap(candidate, r, gap))) {
                return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
            }
        }
    }
    // Unreachable in practice (500 extra rows is thousands of notes deep),
    // but never leave the caller without a valid, non-overlapping answer.
    const bottom = rects.reduce((max, r) => Math.max(max, r.y + r.height), vp.y);
    return { x: Math.round(startX), y: Math.round(bottom + gap) };
}

/**
 * Whiteboard rows to *append* for adding `taskNames` (in that order):
 * each gets a fresh, non-overlapping position from wbFindFreeSpacePosition(),
 * computed against `existingItems` *plus* every row already produced
 * earlier in this same call -- which is what turns a batch add into "a
 * tidy grid" instead of every new note landing on top of the last one.
 *
 * Deliberately stateless/pure: it only ever looks at `existingItems` (the
 * whiteboard rows actually in the plan text right now) and never at any
 * previously-removed row for the same task name, which is exactly why
 * re-adding a previously-removed summary task gets a *fresh* free-space
 * placement rather than its old, possibly-stale position (issue #847's
 * acceptance criteria, verbatim) -- there is no cache here to be stale.
 *
 * Returns plain row objects shaped like parseWhiteboardMarkdown() output
 * (`colour`/`width`/`height` left at "use the default", `collapsed:
 * false`) ready to concat onto `existingItems` for a single
 * updatePlanWhiteboardText() call -- one Markdown commit for the whole
 * batch, per the acceptance criteria.
 */
function wbBuildAddNoteRows(existingItems, viewportRect, taskNames, options = {}) {
    const width = options.width || WB_NOTE_DEFAULT_WIDTH;
    const height = options.height || WB_NOTE_DEFAULT_HEIGHT;
    const gap = options.gap != null ? options.gap : 24;

    const rects = (existingItems || []).map(item => ({
        x: item.x || 0,
        y: item.y || 0,
        width: item.width || width,
        height: item.height || height,
    }));

    const rows = [];
    (taskNames || []).forEach(taskName => {
        const pos = wbFindFreeSpacePosition(rects, viewportRect, width, height, gap);
        rects.push({ x: pos.x, y: pos.y, width, height });
        rows.push({
            task: taskName, x: pos.x, y: pos.y,
            colour: '', width: null, height: null, collapsed: false,
        });
    });
    return rows;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        wbDirectChildren, wbHasChildren, wbChildCount, wbIsChildComplete,
        wbNoteProgress, wbGetInitials, wbResourceList, wbRelativeLuminance,
        wbContrastRatio, wbContrastTextColour, wbNoteZoomTier,
        wbBuildNoteViewModel, wbNoteViewModels, wbBuildPeekLevel,
        wbPalette, WB_NOTE_PASTEL_COLOURS, wbShadeColour, wbDerivedPaletteColour, wbThemeColourFor,
        wbResolveNoteColour,
        wbDragBoardDelta, wbClampNoteWidth, wbClampNoteHeight,
        wbExceedsMoveThreshold, wbMoveTaskToEnd,
        wbTaskAncestorNames, wbTaskAncestorPath, wbSummaryTaskEntries,
        wbTasksNotOnBoard, wbFilterPickerEntries, wbRectsOverlap,
        wbFindFreeSpacePosition, wbBuildAddNoteRows, wbInsertNewSummaryTaskLine,
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

    // Noodles and the floating outline panel are rendered from the exact
    // same rows/tasks this pass just used, in the same pass, so a note, the
    // noodle arriving at it, and its row in the outline can never disagree
    // about the hierarchy. Both are no-ops if their file isn't loaded.
    if (typeof wbRenderNoodles === 'function') wbRenderNoodles(rows, wbLastTasks);
    if (typeof wbRenderOutlinePanel === 'function') wbRenderOutlinePanel();

    // Empty state (issue #847): purposeful "what is this board for" copy
    // + Add note / Add all summary tasks, shown whenever nothing actually
    // rendered -- covers both a genuinely empty ---whiteboard--- section
    // and one that only has orphan rows (rows naming a task that no
    // longer exists), which is exactly right: an orphan-only board is, to
    // the user looking at it, indistinguishable from an empty one.
    wbUpdateEmptyState(viewModels.length > 0);
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

    // The noodle handle: drag from here to another note to make that note
    // a child of this one. Lives in the header rather than floating over
    // the card edge so it never sits on top of the note's own content.
    const linkHandle = document.createElementNS(XHTML_NS, 'button');
    linkHandle.setAttribute('class', 'wb-note-link-handle');
    linkHandle.setAttribute('type', 'button');
    linkHandle.setAttribute('title', 'Drag to another note to make it a subtask');
    linkHandle.setAttribute('aria-label', 'Draw a noodle to another note');
    linkHandle.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/>' +
        '<path d="M4 6 C4 11, 7 12, 10 12"/></svg>';
    linkHandle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const taskName = fo.dataset.wbTask;
        if (taskName && typeof wbBeginLinkDrag === 'function') {
            wbBeginLinkDrag(taskName, e.clientX, e.clientY);
        }
    });
    linkHandle.addEventListener('touchstart', (e) => {
        const taskName = fo.dataset.wbTask;
        if (taskName && typeof wbLinkHandleTouchStart === 'function') {
            wbLinkHandleTouchStart(e, taskName);
        }
    }, { passive: false });
    linkHandle.addEventListener('click', (e) => e.stopPropagation());

    header.appendChild(title);
    header.appendChild(linkHandle);
    header.appendChild(menuBtn);

    // A caption naming the note this one hangs off, when its parent is
    // also on the board -- the noodle says *that* there is a link, this
    // says which way round it goes without following the curve by eye.
    const parentCaption = document.createElementNS(XHTML_NS, 'div');
    parentCaption.setAttribute('class', 'wb-note-parent');

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
    card.appendChild(parentCaption);
    card.appendChild(body);
    card.appendChild(footer);
    card.appendChild(resizeHandle);
    fo.appendChild(card);

    const entry = {
        fo,
        refs: {
            card, header, title, menuBtn, linkHandle, parentCaption,
            body, footer, progress, avatars, resizeHandle,
        },
    };

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

    // Don't clobber a title the user is in the middle of retyping.
    if (!refs.title.isContentEditable) {
        wbSetText(refs.title, vm.task.name);
        refs.title.setAttribute('title', vm.task.name + ' — double-click to rename');
    }

    // "under Discovery" caption: only when the parent has a note of its
    // own, i.e. exactly when a noodle is drawn into this note.
    if (vm.linkedParent) {
        refs.parentCaption.textContent = 'under ' + vm.linkedParent;
        refs.parentCaption.setAttribute('title', 'Linked under ' + vm.linkedParent);
        refs.parentCaption.style.display = '';
    } else {
        refs.parentCaption.textContent = '';
        refs.parentCaption.style.display = 'none';
    }

    // Body: direct children only, one row each (empty state if none).
    // Children that have a post-it of their own are *not* listed here --
    // they are the noodles leaving this note (see wbBuildNoteViewModel()).
    // Save/restore scrollTop across the rebuild so an in-progress scroll
    // inside a long note survives a plan-text-driven re-render.
    const savedScrollTop = refs.body.scrollTop;
    refs.body.innerHTML = '';
    if (!vm.children.length) {
        const empty = document.createElementNS(XHTML_NS, 'div');
        empty.setAttribute('class', 'wb-note-empty');
        empty.textContent = vm.linkedChildren.length
            ? `${vm.linkedChildren.length} linked note${vm.linkedChildren.length === 1 ? '' : 's'}`
            : 'No subtasks yet';
        refs.body.appendChild(empty);
    } else {
        vm.children.forEach(childVm => {
            refs.body.appendChild(wbBuildChildRow(childVm));
        });
    }
    // A note that has both kinds gets a quiet footer line naming the ones
    // that left, so nothing a user typed into this note appears to vanish
    // when they noodle it out onto the board.
    if (vm.children.length && vm.linkedChildren.length) {
        const linked = document.createElementNS(XHTML_NS, 'div');
        linked.setAttribute('class', 'wb-note-linked-summary');
        linked.textContent = `+ ${vm.linkedChildren.length} linked note${vm.linkedChildren.length === 1 ? '' : 's'}`;
        linked.setAttribute('title', vm.linkedChildren.map(c => c.task.name).join(', '));
        refs.body.appendChild(linked);
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
    if (!layer || !entry || !entry.fo) return;
    // Already frontmost: skip the appendChild entirely. Re-appending an
    // element that is already the last child is not a no-op in the DOM --
    // it detaches and re-attaches the node, which cancels an in-progress
    // native double-click (see wbNoteHeaderMouseDown()'s own manual
    // double-click detection for why that matters here) and throws away
    // any running CSS animation on it.
    if (layer.lastElementChild === entry.fo) return;
    layer.appendChild(entry.fo);
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

    // Keep the noodles attached to this note glued to it as it moves.
    // Scoped to this one task's links so a drag frame stays O(1) in the
    // number of *other* notes on the board -- see whiteboard-noodles.js.
    if (typeof wbRefreshNoodleGeometry === 'function') {
        wbRefreshNoodleGeometry(fo.dataset.wbTask);
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

/**
 * Whether this press is the second of a double-press on the same note's
 * header -- the rename gesture. "Same" means the same note, within
 * WB_HEADER_DOUBLE_PRESS_MS, and without the pointer having wandered more
 * than a few pixels, so a quick drag-drag on two different notes (or a
 * deliberate reposition-then-reposition) is never mistaken for a rename.
 *
 * Records this press either way, so the *next* one can be compared
 * against it.
 */
function wbIsRepeatHeaderPress(entry, clientX, clientY) {
    const now = Date.now();
    const last = wbLastHeaderPress;
    wbLastHeaderPress = { entry, x: clientX, y: clientY, at: now };

    if (!last || last.entry !== entry) return false;
    if (now - last.at > WB_HEADER_DOUBLE_PRESS_MS) return false;
    return !wbExceedsMoveThreshold(last.x, last.y, clientX, clientY, WB_HEADER_DOUBLE_PRESS_SLOP);
}

// ── Mouse entry points (wired in wbCreateNoteNode()) ────────────────────

function wbNoteHeaderMouseDown(e, entry) {
    if (e.button !== 0 || wbActiveDrag) return;
    // Double-click-to-rename is detected here, from consecutive
    // mousedowns, rather than from a native 'dblclick' listener: the first
    // press of the pair raises the note to the front of the notes layer,
    // and moving a node in the DOM cancels the browser's own double-click
    // tracking, so a dblclick handler on the header would simply never
    // fire for any note that wasn't already frontmost. Detecting it
    // ourselves also gives touch the same gesture for free (see
    // wbNoteHeaderTouchStart()), which 'dblclick' does not.
    if (wbIsRepeatHeaderPress(entry, e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        wbBeginTitleEdit(entry);
        return;
    }
    // The menu button (issue #849, not this issue's to build or wire) is
    // a sibling inside the same header -- never hijack its own click.
    if (e.target && e.target.closest && e.target.closest('.wb-note-menu-btn')) return;
    // Nor the noodle handle, nor a title mid-rename: both are their own
    // gestures that happen to start inside the drag handle.
    if (e.target && e.target.closest && e.target.closest('.wb-note-link-handle')) return;
    if (e.target && e.target.isContentEditable) return;
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
    if (e.target && e.target.closest && e.target.closest('.wb-note-link-handle')) return;

    const touch = e.touches[0];
    // Double-tap the header to rename, the touch twin of the mouse
    // double-press (see wbIsRepeatHeaderPress()). Checked before the
    // long-press timer is armed so a rename never also starts a drag.
    if (wbIsRepeatHeaderPress(entry, touch.clientX, touch.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        wbBeginTitleEdit(entry);
        return;
    }
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
    wbAppendStructureMenuSection(list, taskName);
    wbAppendOpenTaskMenuSection(list, taskName);
    wbAppendRemoveMenuSection(list, taskName);

    return menu;
}

/**
 * The structure actions -- rename, and unlink from whatever note this one
 * currently hangs off. Both have direct gestures too (double-click the
 * title; click the noodle then its cut button), so these exist for
 * discoverability and for the cases where the gesture is awkward: a noodle
 * on a dense board can be genuinely hard to hit, and a title-only note at
 * low zoom has no room for an editable title.
 *
 * "Unlink" only appears when there *is* a noodle to cut -- a menu item
 * that is present but inert teaches the wrong thing about what the board
 * can do.
 */
function wbAppendStructureMenuSection(list, taskName) {
    // These carry .wb-note-menu-action, NOT .wb-note-menu-open-task: that
    // class identifies exactly one item ("Open task details") and is what
    // callers and tests select it by, so borrowing it for a second item
    // would silently make that selector ambiguous.
    const dividerLi = document.createElement('li');
    dividerLi.className = 'wb-note-menu-divider';
    dividerLi.setAttribute('role', 'separator');
    list.appendChild(dividerLi);

    const renameLi = document.createElement('li');
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'wb-note-menu-action';
    renameBtn.setAttribute('role', 'menuitem');
    renameBtn.textContent = 'Rename';
    renameBtn.title = 'Rename this task (or just double-click its title)';
    renameBtn.setAttribute('aria-label', `Rename ${taskName}`);
    renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        const entry = wbNoteNodes.get(taskName);
        if (entry) wbBeginTitleEdit(entry);
    });
    renameLi.appendChild(renameBtn);
    list.appendChild(renameLi);

    const task = (wbLastTasks || []).find(t => t && t.name === taskName);
    if (!task || !task.parent) return;

    const unlinkLi = document.createElement('li');
    const unlinkBtn = document.createElement('button');
    unlinkBtn.type = 'button';
    unlinkBtn.className = 'wb-note-menu-action';
    unlinkBtn.setAttribute('role', 'menuitem');
    unlinkBtn.textContent = `Unlink from "${task.parent}"`;
    unlinkBtn.title = 'Moves this task back to the top level of the plan; nothing is deleted';
    unlinkBtn.setAttribute('aria-label',
        `Unlink ${taskName} from ${task.parent}, moving it back to the top level`);
    unlinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbUnlinkNoteFromParent(taskName);
    });
    unlinkLi.appendChild(unlinkBtn);
    list.appendChild(unlinkLi);
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
 * Append issue #847's entire contribution to the note menu: a divider
 * (this is a destructive-ish, unrelated action, set apart from the colour
 * grid and the "Open task details" action above it) followed by a single
 * "Remove from board" action.
 *
 * Wording is deliberate, per the issue's explicit requirement that this
 * must never read as "delete the phase": the button says "from board" (not
 * "delete note"/"delete task"), and both its title tooltip and aria-label
 * spell out that the task and its subtasks are untouched -- this action
 * only ever calls wbRemoveNoteFromBoard(), which edits nothing but the
 * ---whiteboard--- table (see that function's own doc comment). No
 * confirmation dialog (the issue calls this out as "confirm-free but
 * undoable"): wbRemoveNoteFromBoard()'s single wbCommitMarkdown() call is
 * one ordinary undo step, exactly like every other whiteboard mutation.
 */
function wbAppendRemoveMenuSection(list, taskName) {
    const dividerLi = document.createElement('li');
    dividerLi.className = 'wb-note-menu-divider';
    dividerLi.setAttribute('role', 'separator');
    list.appendChild(dividerLi);

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-note-menu-remove';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = 'Remove from board';
    btn.title = 'Removes this note from the whiteboard only -- the task and its subtasks stay in your plan';
    btn.setAttribute('aria-label', 'Remove from board. This only removes the note; the task and its subtasks stay in your plan.');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbRemoveNoteFromBoard(taskName);
    });
    li.appendChild(btn);
    list.appendChild(li);

    // Now that a note can *create* a task, it needs a way to destroy one
    // too -- otherwise a mistyped post-it can only be taken off the board,
    // leaving the stray task behind in the plan with no note pointing at
    // it. Set apart from "Remove from board" by wording, styling and a
    // confirmation prompt (see wbDeleteNoteTask()), because these two
    // adjacent items are the one pair on this menu it would genuinely hurt
    // to confuse.
    const deleteLi = document.createElement('li');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'wb-note-menu-remove wb-note-menu-delete';
    deleteBtn.setAttribute('role', 'menuitem');
    deleteBtn.textContent = 'Delete task';
    deleteBtn.title = 'Deletes the task and its subtasks from the plan, not just this note';
    deleteBtn.setAttribute('aria-label',
        'Delete task. This removes the task and its subtasks from the plan, not just the note.');
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbDeleteNoteTask(taskName);
    });
    deleteLi.appendChild(deleteBtn);
    list.appendChild(deleteLi);
}

/**
 * Append the colour section of the note menu: a "Default colour" action
 * (tier 3 of the precedence -- clears any row/Theme: override) followed
 * by a single labelled swatch grid drawing from wbPalette() -- the fixed
 * pastel "post-it" palette (WB_NOTE_PASTEL_COLOURS, issue #1017), as one
 * labelled <li> + a grid <li> so keyboard users can jump between items
 * with wbNoteMenuKeydown()'s Arrow/Home/End handling.
 *
 * #849 originally offered three grids here (a saturated "Palette" plus
 * the boards view's own "Pastel"/"Dark" conditional-formatting swatches,
 * CF_PASTEL_COLOURS/CF_DARK_COLOURS from kanban.js/state.js) -- #1017
 * replaced all three with this one dedicated pastel palette, precisely
 * so a note's colour stops borrowing another system's swatches. See
 * WB_NOTE_PASTEL_COLOURS's own doc comment for the full rationale.
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

    addSection('Colour', wbPalette());
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
 * The screen-space vertical band a note menu is allowed to occupy: below
 * the whiteboard canvas's own top edge (never the app's header/nav chrome
 * above it) and above the status bar's own top edge (never that chrome
 * either), each inset by `edgeGap`. Falls back to the bare viewport edges
 * if either landmark isn't in the DOM. Factored out of wbOpenNoteMenu()
 * because issue #847 made the menu taller (an extra "Remove from board"
 * section past #849's colour-only version), which made both the
 * flip-above-the-button case *and* the plain below-the-button case newly
 * able to reach into the app's own chrome on a short viewport -- see
 * wbOpenNoteMenu()'s own comment.
 */
function wbNoteMenuSafeBounds(edgeGap) {
    const doc = (typeof document !== 'undefined') ? document : null;
    const canvas = doc ? doc.getElementById('whiteboardContainer') : null;
    const statusBar = doc ? doc.querySelector('.status-bar') : null;
    const top = canvas ? canvas.getBoundingClientRect().top + edgeGap : edgeGap;
    const winHeight = (typeof window !== 'undefined') ? window.innerHeight : top + 600;
    const bottom = statusBar ? statusBar.getBoundingClientRect().top - edgeGap : winHeight - edgeGap;
    return { top, bottom };
}

/**
 * Open the `...` menu for one note, anchored under its button. Positions
 * like nav.js's positionNavMenu(), extended with a hard vertical safe
 * band (wbNoteMenuSafeBounds(): the canvas's own top edge down to the
 * status bar's own top edge) the menu must never cross, on either side of
 * the button:
 *
 *   - Below the button whenever that's the roomier (or only) side that
 *     fits within the safe band -- the default, matching #849.
 *   - Above the button otherwise, symmetrically bounded by the band's top.
 *   - Either way, the menu's own height is capped to whatever room that
 *     chosen side actually has (never past the button itself, never past
 *     the band edge); wb-note-menu's overflow-y:auto (views/whiteboard.css)
 *     makes any content that doesn't fit scroll, rather than the menu
 *     ever overflowing into the nav bar, the status bar, or its own
 *     trigger button (which would silently break the click-to-close
 *     toggle). This distinction matters because issue #847 made the menu
 *     taller (an extra "Remove from board" section past #849's
 *     colour-only version) than a naive "flip if it doesn't fit below,
 *     else give up" rule can safely handle on a short viewport.
 */
function wbOpenNoteMenu(taskName, btn) {
    wbCloseNoteMenu();

    const menu = wbBuildNoteMenu(taskName);
    document.body.appendChild(menu);

    const edgeGap = 8;
    const bounds = wbNoteMenuSafeBounds(edgeGap);
    const btnRect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let left = Math.min(btnRect.left, window.innerWidth - menuRect.width - edgeGap);
    left = Math.max(edgeGap, left);

    const spaceBelow = bounds.bottom - (btnRect.bottom + 4);
    const spaceAbove = (btnRect.top - 4) - bounds.top;

    let top;
    if (menuRect.height <= spaceBelow || spaceBelow >= spaceAbove) {
        top = btnRect.bottom + 4;
        menu.style.maxHeight = `${Math.max(80, Math.min(menuRect.height, spaceBelow))}px`;
    } else {
        const height = Math.max(80, Math.min(menuRect.height, spaceAbove));
        top = btnRect.top - 4 - height;
        menu.style.maxHeight = `${height}px`;
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

// ── Board membership: remove, empty state, Add-note picker (issue #847) ──
//
// Removing is a single row-delete + single wbCommitMarkdown() (see
// wbRemoveNoteFromBoard()). Adding (single or multi-select) goes through
// the same wbCommitAddNotes() regardless of whether it was triggered from
// the picker's "Add note" button or the empty state's "Add all summary
// tasks" shortcut, so both are guaranteed the "one Markdown commit, one
// undo step" acceptance criterion by construction -- there is only one
// code path that ever writes new rows.
//
// The picker itself (wbOpenAddNotePicker() and friends) follows the same
// "single floating element, appended to document.body, rebuilt on each
// open" convention as the `...` note menu above (see that section's
// header comment) -- open/close/Escape/outside-click all mirror
// wbOpenNoteMenu()/wbCloseNoteMenu()/wbNoteMenuOutsideClick()/
// wbNoteMenuKeydown(), just for a bigger dialog instead of a small popup.

/** The whiteboard rows currently in the plan text (see wbLastPlanText) --
 * the same read wbRenderNotes() itself does, factored out so the picker
 * and the remove/add commit paths don't each re-derive it separately. */
function wbCurrentWhiteboardItems() {
    if (typeof extractWhiteboardFromPlanText !== 'function' || typeof parseWhiteboardMarkdown !== 'function') {
        return [];
    }
    const section = extractWhiteboardFromPlanText(wbLastPlanText);
    return section ? parseWhiteboardMarkdown(section) : [];
}

/** Every summary task not currently on the board, right now. */
function wbSummaryTasksNotOnBoard() {
    return wbTasksNotOnBoard(wbLastTasks, wbCurrentWhiteboardItems());
}

/**
 * Delete every whiteboard row naming `taskName` (case-insensitive, so this
 * also cleans up an accidental duplicate row rather than leaving one
 * behind) and commit -- the entire "Remove from board" action. Only ever
 * calls updatePlanWhiteboardText(), which -- per its own doc comment --
 * rewrites nothing but the ---whiteboard--- section: the task outline,
 * every other back-matter section, and the front matter are byte-for-byte
 * untouched, which is the whole point (removing a note must never read as
 * deleting the task). Returns false (no-op, no commit) if there was
 * nothing to remove.
 */
function wbRemoveNoteFromBoard(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName) return false;
    if (typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return false;
    }

    const planText = editor.value;
    const section = extractWhiteboardFromPlanText(planText);
    const items = parseWhiteboardMarkdown(section);
    const key = String(taskName).toLowerCase();
    const next = items.filter(item => !(item && item.task && item.task.toLowerCase() === key));
    if (next.length === items.length) return false; // no matching row -- nothing to do

    const nextText = updatePlanWhiteboardText(planText, next);
    return wbCommitMarkdown(nextText);
}

/**
 * Add `taskNames` to the board: one free-space rect per name (via
 * wbBuildAddNoteRows(), scanning the *current* viewport -- see
 * whiteboard.js's wbCurrentViewportBoardRect()), appended to the current
 * rows, written and committed in a single call. This is the one and only
 * place new whiteboard rows get written, whether the caller is the
 * picker's multi-select "Add" button or the empty state's "Add all
 * summary tasks" shortcut -- see this section's header comment.
 */
function wbCommitAddNotes(taskNames) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    const names = (taskNames || []).filter(Boolean);
    if (!editor || !names.length) return false;
    if (typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return false;
    }

    const planText = editor.value;
    const section = extractWhiteboardFromPlanText(planText);
    const items = parseWhiteboardMarkdown(section);
    const viewport = (typeof wbCurrentViewportBoardRect === 'function') ? wbCurrentViewportBoardRect() : null;
    const newRows = wbBuildAddNoteRows(items, viewport, names, {
        width: WB_NOTE_DEFAULT_WIDTH,
        height: WB_NOTE_DEFAULT_HEIGHT,
    });

    const nextText = updatePlanWhiteboardText(planText, items.concat(newRows));
    return wbCommitMarkdown(nextText);
}

/** "Add all summary tasks": every not-yet-added summary task, in one
 * commit. False (no-op) if the board already includes every summary task
 * (including "there are no summary tasks at all yet").
 *
 * Deliberately still summary-only even though the picker now offers leaves
 * too (see wbSummaryTaskEntries()): this button means "lay my phases out",
 * and dumping every leaf task onto the canvas as well would bury them. */
function wbAddAllSummaryTasks() {
    const entries = wbSummaryTasksNotOnBoard().filter(entry => entry.isSummary);
    if (!entries.length) return false;
    return wbCommitAddNotes(entries.map(entry => entry.name));
}

/**
 * Insert a brand-new, top-level *summary* task named `taskName` at the end
 * of the plan's task outline -- i.e. after every existing outline line but
 * before the first back-matter section marker (Highlights, Budget,
 * Benefits, RAID log, Comms, Lessons learned, Baseline, Whiteboard --
 * the same marker list extractWhiteboardFromPlanText()/
 * updatePlanWhiteboardText() scan for), so the new task lands inside the
 * outline itself rather than inside, or after, some other back-matter
 * section.
 *
 * Pure text transform -- no DOM, no commit -- so
 * wbCreateAndAddSummaryTask() below can compose it with the whiteboard-row
 * edit into a single wbCommitMarkdown() call rather than two.
 */
function wbInsertNewSummaryTaskLine(planText, taskName) {
    const text = planText || '';
    const name = String(taskName || '').trim();
    if (!name) return text;

    const markers = [HIGHLIGHTS_START, BUDGET_START, BENEFITS_START, RAID_LOG_START,
                      COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START];
    let insertIdx = text.length;
    markers.forEach(marker => {
        const idx = text.indexOf(marker);
        if (idx !== -1 && idx < insertIdx) insertIdx = idx;
    });

    const before = text.substring(0, insertIdx).replace(/\n+$/, '');
    const after = text.substring(insertIdx);

    // The parent line plus one placeholder child ("New Task", 2-space
    // indented) -- not just a bare parent line -- because the outline
    // parser (engine/scheduler.js buildTasks()) only ever classifies a
    // task as a summary when it *has* a child; a childless bare line
    // parses as an ordinary leaf task instead. This is exactly the same
    // two-line shape KanbanBoard.addNewPhase()'s "drilling down" branch
    // (kanban.js) already writes to make a brand-new phase register as a
    // summary/column immediately, reused here so the task this creates is
    // a real summary task from the moment it's created, not a leaf that
    // only becomes one later if the user happens to add a child. The
    // placeholder is an ordinary task like any other -- rename it,
    // replace it, or add more children/delete it entirely from the task
    // outline exactly as with any other task.
    const newLines = name + '\n  New Task';

    // A blank-line separator before the new lines (when there's existing
    // outline content to separate them from) matches how top-level
    // phases/sections are conventionally spaced in a plan's outline (see
    // e.g. SAMPLE_PLAN in tests/test_whiteboard_board_membership.py) --
    // the new phase reads as its own top-level entry, not a continuation
    // of whatever came before it.
    let result = before ? before + '\n\n' + newLines : newLines;
    result = after ? result + '\n\n' + after.replace(/^\n+/, '') : result + '\n';
    return result;
}

/**
 * The Add-note picker's "create new" affordance's entire action: create a
 * brand-new top-level summary task named `taskName` in the outline (see
 * wbInsertNewSummaryTaskLine()) AND add it to the board as a note, as one
 * combined edit -- a single wbCommitMarkdown() call, so what the user
 * experiences as one action ("type a name, hit Create") is also one undo
 * step, matching wbCommitAddNotes()'s own "one Markdown commit" rule (see
 * this section's header comment). Mirrors wbCommitAddNotes() for the
 * row-building half (same free-space placement via wbBuildAddNoteRows(),
 * same updatePlanWhiteboardText() call) but folds the outline insertion
 * into the same text transform first instead of committing twice.
 *
 * Returns false (no-op, no commit) for a blank/whitespace-only name or a
 * name that already exists in the outline (case-insensitively) -- the
 * caller is expected to surface that back to the user rather than silently
 * create a confusing duplicate.
 */
function wbCreateAndAddSummaryTask(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    const name = String(taskName || '').trim();
    if (!editor || !name) return false;
    if (typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return false;
    }

    const key = name.toLowerCase();
    const duplicate = (wbLastTasks || []).some(t => t && t.name && t.name.toLowerCase() === key);
    if (duplicate) return false;

    const withNewTask = wbInsertNewSummaryTaskLine(editor.value, name);

    const section = extractWhiteboardFromPlanText(withNewTask);
    const items = parseWhiteboardMarkdown(section);
    const viewport = (typeof wbCurrentViewportBoardRect === 'function') ? wbCurrentViewportBoardRect() : null;
    const newRows = wbBuildAddNoteRows(items, viewport, [name], {
        width: WB_NOTE_DEFAULT_WIDTH,
        height: WB_NOTE_DEFAULT_HEIGHT,
    });

    const nextText = updatePlanWhiteboardText(withNewTask, items.concat(newRows));
    return wbCommitMarkdown(nextText);
}

// ── Empty state ──────────────────────────────────────────────────────────

/** Get-or-create the empty-state overlay inside #whiteboardContainer,
 * wiring its two actions once. Lives alongside (not inside) the SVG, so
 * it's ordinary HTML rather than another foreignObject. */
function wbEnsureEmptyStateEl() {
    const container = (typeof document !== 'undefined') ? document.getElementById('whiteboardContainer') : null;
    if (!container) return null;
    let el = container.querySelector('.wb-empty-state');
    if (el) return el;

    el = document.createElement('div');
    el.className = 'wb-empty-state';
    // Leads with starting from nothing, because that is now the primary
    // way to use this board: a post-it creates a task, and noodling two
    // together builds the plan's outline. Pulling existing tasks onto the
    // board is the secondary action it used to be the only one.
    el.innerHTML = [
        '<div class="wb-empty-state-inner">',
        '<h3 class="wb-empty-state-title">Nothing on the board yet</h3>',
        '<p class="wb-empty-state-body">Start with a post-it. Double-click anywhere (or press <kbd>n</kbd>) to add one &mdash; each post-it is a task in your plan. Drag a note\'s noodle handle onto another to make it a subtask, and the structure appears in the panel on the left.</p>',
        '<div class="wb-empty-state-actions">',
        '<button type="button" class="wb-empty-state-btn wb-empty-state-btn-primary" id="wbEmptyStateNewBtn">New post-it</button>',
        '<button type="button" class="wb-empty-state-btn" id="wbEmptyStateAddBtn">Add an existing task</button>',
        '<button type="button" class="wb-empty-state-btn" id="wbEmptyStateAddAllBtn">Add all summary tasks</button>',
        '</div>',
        '</div>',
    ].join('');
    container.appendChild(el);

    const newBtn = el.querySelector('#wbEmptyStateNewBtn');
    const addBtn = el.querySelector('#wbEmptyStateAddBtn');
    const addAllBtn = el.querySelector('#wbEmptyStateAddAllBtn');
    if (newBtn) newBtn.addEventListener('click', () => wbCreateNoteInViewportCentre());
    if (addBtn) addBtn.addEventListener('click', () => wbOpenAddNotePicker());
    if (addAllBtn) addAllBtn.addEventListener('click', () => wbAddAllSummaryTasks());

    return el;
}

/** Show the empty state iff there are no rendered notes right now. */
function wbUpdateEmptyState(hasNotes) {
    const el = wbEnsureEmptyStateEl();
    if (!el) return;
    el.classList.toggle('wb-empty-state-hidden', !!hasNotes);
}

// ── Add-note picker ──────────────────────────────────────────────────────

// Only one picker is ever open at a time (matches wbNoteMenuState's single
// slot above). { entries: [{name, path}], selected: Set<name>, query }
// while open, else null.
let wbAddPickerState = null;

/**
 * Open the Add-note picker: a modal dialog listing every summary task not
 * already on the board (see wbSummaryTasksNotOnBoard()), each showing its
 * "Phase › Sub-phase" parent path so same-named tasks in different phases
 * are tellable apart, with a search box and multi-select checkboxes, plus
 * a "+ New phase" create-new-task affordance (see wbBuildCreateSection()
 * below) that stays available whether or not there's anything left to
 * pick -- so a brainstorming session is never blocked on "does a phase
 * for this already exist?" Building the entry list fresh on open (not
 * cached) means it can never go stale across repeated opens in one
 * session.
 */
function wbOpenAddNotePicker() {
    wbCloseAddNotePicker();

    wbAddPickerState = {
        entries: wbSummaryTasksNotOnBoard(),
        selected: new Set(),
        query: '',
        creatingOpen: false,
    };

    const overlay = document.createElement('div');
    overlay.id = 'wbAddNoteOverlay';
    overlay.className = 'wb-add-note-overlay';
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) wbCloseAddNotePicker();
    });

    const dialog = document.createElement('div');
    dialog.id = 'wbAddNoteDialog';
    dialog.className = 'wb-add-note-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'wbAddNoteTitle');
    dialog.addEventListener('mousedown', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'wb-add-note-header';
    const title = document.createElement('h2');
    title.id = 'wbAddNoteTitle';
    title.className = 'wb-add-note-title';
    title.textContent = 'Add notes to whiteboard';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wb-add-note-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => wbCloseAddNotePicker());
    header.appendChild(title);
    header.appendChild(closeBtn);

    const search = document.createElement('input');
    search.type = 'search';
    search.id = 'wbAddNoteSearch';
    search.className = 'wb-add-note-search';
    search.placeholder = 'Search by name or phase…';
    search.setAttribute('aria-label', 'Search summary tasks not yet on the board');
    search.addEventListener('input', () => {
        wbAddPickerState.query = search.value;
        wbRenderAddNoteList();
    });

    const list = document.createElement('ul');
    list.id = 'wbAddNoteList';
    list.className = 'wb-add-note-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-multiselectable', 'true');
    list.setAttribute('aria-label', 'Summary tasks not on the board');

    const createSection = wbBuildCreateSection();

    const footer = document.createElement('div');
    footer.className = 'wb-add-note-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'wb-add-note-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => wbCloseAddNotePicker());
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.id = 'wbAddNoteSubmit';
    submitBtn.className = 'wb-add-note-submit';
    submitBtn.textContent = 'Add note';
    submitBtn.disabled = true;
    submitBtn.addEventListener('click', () => wbSubmitAddNotePicker());
    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);

    dialog.appendChild(header);
    dialog.appendChild(search);
    dialog.appendChild(list);
    dialog.appendChild(createSection);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    wbRenderAddNoteList();
    document.addEventListener('keydown', wbAddNotePickerKeydown, true);

    // The dead-end case (nothing left to pick) forces the create form
    // open in place of the list/search -- see wbRenderAddNoteList() --
    // so the create input, not the now-hidden search box, is what should
    // actually get the picker's opening focus.
    if (!wbAddPickerState.entries.length) {
        const createInput = document.getElementById('wbAddNoteCreateInput');
        if (createInput) createInput.focus();
    } else {
        search.focus();
    }
}

/**
 * Build the picker's "create a new summary task" affordance: a collapsed
 * "+ New phase" toggle button plus the (initially hidden) name input +
 * "Create and add" button it reveals, wired to wbSubmitCreateSummaryTask().
 * Kept as one self-contained block -- appended as a sibling of #wbAddNoteList
 * rather than inserted inside it -- both because it needs to survive
 * wbRenderAddNoteList()'s `list.innerHTML = ''` rebuilds on every keystroke
 * in the search box, and because it is deliberately a separate, secondary
 * action from the list's checkbox multi-select rather than another kind of
 * row in it (see wbRenderAddNoteList()'s doc comment for how the two ends
 * -- the always-available toggle here and the forced-open dead-end case --
 * share this exact same form).
 */
function wbBuildCreateSection() {
    const section = document.createElement('div');
    section.id = 'wbAddNoteCreate';
    section.className = 'wb-add-note-create';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'wbAddNoteCreateToggle';
    toggle.className = 'wb-add-note-create-toggle';
    toggle.textContent = '+ New phase';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'wbAddNoteCreateForm');
    toggle.addEventListener('click', () => wbToggleCreateSummaryTaskForm());

    const intro = document.createElement('p');
    intro.id = 'wbAddNoteCreateIntro';
    intro.className = 'wb-add-note-create-intro';
    intro.hidden = true;

    const form = document.createElement('div');
    form.id = 'wbAddNoteCreateForm';
    form.className = 'wb-add-note-create-form';
    form.hidden = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'wbAddNoteCreateInput';
    input.className = 'wb-add-note-create-input';
    input.placeholder = 'New phase name…';
    input.setAttribute('aria-label', 'New summary task name');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            wbSubmitCreateSummaryTask();
        }
    });
    input.addEventListener('input', () => {
        const errorEl = document.getElementById('wbAddNoteCreateError');
        if (errorEl && !errorEl.hidden) { errorEl.hidden = true; errorEl.textContent = ''; }
    });

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.id = 'wbAddNoteCreateBtn';
    createBtn.className = 'wb-add-note-create-btn';
    createBtn.textContent = 'Create and add';
    createBtn.addEventListener('click', () => wbSubmitCreateSummaryTask());

    form.appendChild(input);
    form.appendChild(createBtn);

    const error = document.createElement('p');
    error.id = 'wbAddNoteCreateError';
    error.className = 'wb-add-note-create-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;

    section.appendChild(toggle);
    section.appendChild(intro);
    section.appendChild(form);
    section.appendChild(error);
    return section;
}

/** Close the picker, if open, and return focus to the toolbar/empty-state
 * button that opened it (whichever exists). */
function wbCloseAddNotePicker() {
    const overlay = document.getElementById('wbAddNoteOverlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', wbAddNotePickerKeydown, true);
    wbAddPickerState = null;

    const returnFocusBtn = document.getElementById('whiteboardAddNoteBtn') || document.getElementById('wbEmptyStateAddBtn');
    if (returnFocusBtn) returnFocusBtn.focus();
}

/**
 * Rebuild the picker's <ul> from the current search query + selection.
 *
 * The true dead-end case -- `entries` itself is empty, i.e. there is
 * nothing left to pick no matter what's typed in search -- hides the now-
 * pointless search box and list entirely and forces the create-new-task
 * form (see wbBuildCreateSection()/wbShowCreateSummaryTaskForm()) open in
 * their place, instead of the old non-actionable "Every summary task is
 * already on the board" message. That's different from a *search*
 * producing no matches (there's still something to pick, the query just
 * doesn't match it), which keeps its own, unrelated, already-correct
 * "No summary tasks match your search" message untouched.
 */
function wbRenderAddNoteList() {
    const list = document.getElementById('wbAddNoteList');
    const search = document.getElementById('wbAddNoteSearch');
    if (!list || !wbAddPickerState) return;

    const deadEnd = wbAddPickerState.entries.length === 0;
    list.hidden = deadEnd;
    if (search) search.hidden = deadEnd;

    if (deadEnd) {
        list.innerHTML = '';
        wbShowCreateSummaryTaskForm({ forced: true });
    } else {
        const filtered = wbFilterPickerEntries(wbAddPickerState.entries, wbAddPickerState.query);
        list.innerHTML = '';
        if (!filtered.length) {
            const empty = document.createElement('li');
            empty.className = 'wb-add-note-empty';
            empty.setAttribute('role', 'presentation');
            empty.textContent = 'No summary tasks match your search';
            list.appendChild(empty);
        } else {
            filtered.forEach(entry => list.appendChild(wbBuildAddNoteListItem(entry)));
        }
    }
    wbUpdateAddNoteSubmitState();
}

/**
 * Open the create-new-task form, either as the persistent "+ New phase"
 * toggle's voluntary action (`forced: false` -- the toggle itself hides,
 * an unlabelled form appears) or as the dead-end case's forced state
 * (`forced: true` -- the toggle hides since it'd be redundant, and an
 * intro line explains why the form is here instead of a picker list).
 * Idempotent: safe to call again while already open.
 */
function wbShowCreateSummaryTaskForm(options) {
    const forced = !!(options && options.forced);
    const toggle = document.getElementById('wbAddNoteCreateToggle');
    const intro = document.getElementById('wbAddNoteCreateIntro');
    const form = document.getElementById('wbAddNoteCreateForm');
    if (!form || !wbAddPickerState) return;

    form.hidden = false;
    wbAddPickerState.creatingOpen = true;
    if (toggle) {
        toggle.hidden = forced;
        toggle.setAttribute('aria-expanded', 'true');
    }
    if (intro) {
        intro.hidden = !forced;
        intro.textContent = forced
            ? 'Every summary task is already on the board — create a new one to add:'
            : '';
    }
}

/** The persistent "+ New phase" toggle's click handler: open the create
 * form if it's closed, or close it (and clear any error) if it's already
 * open. Never called for the forced-open dead-end case -- the toggle
 * itself is hidden then (see wbShowCreateSummaryTaskForm()) -- so this is
 * always a voluntary open/close. */
function wbToggleCreateSummaryTaskForm() {
    const toggle = document.getElementById('wbAddNoteCreateToggle');
    const form = document.getElementById('wbAddNoteCreateForm');
    if (!form || !wbAddPickerState) return;

    if (form.hidden) {
        wbShowCreateSummaryTaskForm({ forced: false });
        const input = document.getElementById('wbAddNoteCreateInput');
        if (input) input.focus();
        return;
    }

    form.hidden = true;
    wbAddPickerState.creatingOpen = false;
    const errorEl = document.getElementById('wbAddNoteCreateError');
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
    }
}

/**
 * The create-new-task form's submit action (the "Create and add" button,
 * or Enter in its name field): validate the typed name, then hand off to
 * wbCreateAndAddSummaryTask() for the actual outline-insert-plus-board-add
 * commit. A blank name or one that collides (case-insensitively) with an
 * existing task name in the plan shows an inline error instead of
 * submitting -- matching this form's own "plain text name only, stay in
 * the picker" brief rather than falling back to a browser `alert()`.
 * Closes the whole picker on success, exactly like
 * wbSubmitAddNotePicker()'s existing multi-select "Add note" path.
 */
function wbSubmitCreateSummaryTask() {
    const input = document.getElementById('wbAddNoteCreateInput');
    const errorEl = document.getElementById('wbAddNoteCreateError');
    if (!input || !wbAddPickerState) return;

    const name = input.value.trim();
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }

    if (!name) {
        if (errorEl) {
            errorEl.textContent = 'Enter a name for the new phase.';
            errorEl.hidden = false;
        }
        input.focus();
        return;
    }

    const key = name.toLowerCase();
    const duplicate = (wbLastTasks || []).some(t => t && t.name && t.name.toLowerCase() === key);
    if (duplicate) {
        if (errorEl) {
            errorEl.textContent = `"${name}" already exists in the plan.`;
            errorEl.hidden = false;
        }
        input.focus();
        input.select();
        return;
    }

    const created = wbCreateAndAddSummaryTask(name);
    if (!created) {
        if (errorEl) {
            errorEl.textContent = 'Could not create the new phase — try again.';
            errorEl.hidden = false;
        }
        return;
    }
    wbCloseAddNotePicker();
}

/** One picker row: a checkbox + name + (if any) "Phase › Sub-phase" path. */
function wbBuildAddNoteListItem(entry) {
    const li = document.createElement('li');
    li.className = 'wb-add-note-item';
    li.setAttribute('role', 'option');
    li.tabIndex = -1;
    li.dataset.taskName = entry.name;
    const selected = wbAddPickerState.selected.has(entry.name);
    li.setAttribute('aria-selected', selected ? 'true' : 'false');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'wb-add-note-checkbox';
    checkbox.checked = selected;
    checkbox.tabIndex = -1;
    checkbox.setAttribute('aria-hidden', 'true');
    li.appendChild(checkbox);

    const textWrap = document.createElement('div');
    textWrap.className = 'wb-add-note-item-text';
    const name = document.createElement('span');
    name.className = 'wb-add-note-item-name';
    name.textContent = entry.name;
    textWrap.appendChild(name);
    if (entry.path) {
        const path = document.createElement('span');
        path.className = 'wb-add-note-item-path';
        path.textContent = entry.path;
        textWrap.appendChild(path);
    }
    li.appendChild(textWrap);

    li.addEventListener('click', () => {
        wbToggleAddNoteSelection(entry.name);
        li.focus();
    });

    return li;
}

/** Toggle one entry's selection in place (no full list rebuild, so
 * keyboard focus on the row being toggled is never lost). */
function wbToggleAddNoteSelection(taskName) {
    if (!wbAddPickerState) return;
    if (wbAddPickerState.selected.has(taskName)) {
        wbAddPickerState.selected.delete(taskName);
    } else {
        wbAddPickerState.selected.add(taskName);
    }

    const list = document.getElementById('wbAddNoteList');
    const item = list && Array.from(list.children).find(li => li.dataset && li.dataset.taskName === taskName);
    if (item) {
        const selected = wbAddPickerState.selected.has(taskName);
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
        const checkbox = item.querySelector('.wb-add-note-checkbox');
        if (checkbox) checkbox.checked = selected;
    }
    wbUpdateAddNoteSubmitState();
}

/** Keep the "Add note(s)" button's enabled state + label (count) current. */
function wbUpdateAddNoteSubmitState() {
    const btn = document.getElementById('wbAddNoteSubmit');
    if (!btn || !wbAddPickerState) return;
    const count = wbAddPickerState.selected.size;
    btn.disabled = count === 0;
    btn.textContent = count > 1 ? `Add ${count} notes` : 'Add note';
}

/** All actual <li role="option"> rows currently rendered (excludes the
 * "no matches"/"nothing left" placeholder row, which isn't one). */
function wbAddNoteListItems() {
    const list = document.getElementById('wbAddNoteList');
    return list ? Array.from(list.querySelectorAll('.wb-add-note-item')) : [];
}

/**
 * Keyboard handling for the open picker -- mirrors wbNoteMenuKeydown()'s
 * conventions (Escape closes + refocuses the trigger; Arrow keys move
 * focus) adapted for a search box + listbox instead of a flat menu:
 * ArrowDown from the search field enters the list; ArrowUp from the
 * list's first row returns to the search field; Space/Enter toggles the
 * focused row's selection.
 */
function wbAddNotePickerKeydown(e) {
    if (!wbAddPickerState) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        wbCloseAddNotePicker();
        return;
    }

    const active = document.activeElement;

    // Inside the create-new-task form (the name input, its submit button,
    // or the "+ New phase" toggle): leave Arrow/Home/End alone so they
    // behave as ordinary text-field/button navigation instead of jumping
    // focus into the summary-task list below (Enter is handled by the
    // input's own keydown listener; see wbBuildCreateSection()).
    if (active && active.closest && active.closest('#wbAddNoteCreate')) return;

    const items = wbAddNoteListItems();
    const search = document.getElementById('wbAddNoteSearch');
    const onSearch = !!(search && active === search);
    const index = items.indexOf(active);

    if (e.key === 'ArrowDown') {
        if (!items.length) return;
        e.preventDefault();
        if (onSearch || index === -1) {
            items[0].focus();
        } else {
            items[(index + 1) % items.length].focus();
        }
    } else if (e.key === 'ArrowUp') {
        if (onSearch) return;
        e.preventDefault();
        if (index <= 0) {
            if (search) search.focus();
        } else {
            items[index - 1].focus();
        }
    } else if (e.key === 'Home' && !onSearch && items.length) {
        e.preventDefault();
        items[0].focus();
    } else if (e.key === 'End' && !onSearch && items.length) {
        e.preventDefault();
        items[items.length - 1].focus();
    } else if ((e.key === ' ' || e.key === 'Enter') && index !== -1) {
        e.preventDefault();
        wbToggleAddNoteSelection(items[index].dataset.taskName);
    }
}

/** The picker's "Add note"/"Add N notes" submit button. */
function wbSubmitAddNotePicker() {
    if (!wbAddPickerState || !wbAddPickerState.selected.size) return;
    const taskNames = Array.from(wbAddPickerState.selected);
    wbCloseAddNotePicker();
    wbCommitAddNotes(taskNames);
}

// ── Authoring: creating, naming and unfiling notes ──────────────────────
//
// The board used to be a curated *view* of tasks that already existed --
// the only way onto it was the Add-note picker, which could only offer
// summary tasks someone had already typed into the outline. These are the
// other direction: a post-it dropped on the canvas creates the task, and
// naming, unlinking or deleting it edits the plan.
//
// Every one of them is a single wbCommitMarkdown() call, so each is one
// undo step, exactly like a drag or a colour pick. Where a change touches
// both the outline and the ---whiteboard--- table (creating a note writes
// a task line *and* a row), the two edits are composed into one plan text
// before that single commit -- never committed separately, which would
// leave a half-created note behind if the second write failed and would
// cost the user two Ctrl+Z presses to undo one action.

/**
 * Create a brand-new post-it centred on the board point (x, y): a new
 * top-level task in the outline plus a whiteboard row positioning it,
 * committed together. The new note's title goes straight into edit mode
 * so naming it is part of the same gesture.
 *
 * Placement: centred on the point asked for, unless that would overlap an
 * existing note, in which case it falls back to the same free-space scan
 * the Add-note picker uses (wbFindFreeSpacePosition()) so notes never
 * stack invisibly on top of each other.
 */
function wbCreateNoteAt(boardX, boardY) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor) return null;
    if (typeof wbAppendTopLevelTask !== 'function' ||
        typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return null;
    }

    const planText = editor.value;
    const existingNames = (typeof wbOutlineTaskNames === 'function')
        ? wbOutlineTaskNames(planText)
        : (wbLastTasks || []).map(t => t && t.name).filter(Boolean);
    const name = wbUniqueTaskName(existingNames, WB_NEW_NOTE_BASE_NAME);

    const width = WB_NOTE_DEFAULT_WIDTH;
    const height = WB_NOTE_DEFAULT_HEIGHT;

    const withTask = wbAppendTopLevelTask(planText, name);
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(withTask));

    let x = Math.round(boardX - width / 2);
    let y = Math.round(boardY - height / 2);
    const existingRects = items.map(item => ({
        x: item.x || 0,
        y: item.y || 0,
        width: item.width || WB_NOTE_DEFAULT_WIDTH,
        height: item.height || WB_NOTE_DEFAULT_HEIGHT,
    }));
    const wanted = { x, y, width, height };
    const clashes = existingRects.some(rect => wbRectsOverlap(wanted, rect, 8));
    if (clashes && typeof wbFindFreeSpacePosition === 'function' &&
        typeof wbCurrentViewportBoardRect === 'function') {
        const free = wbFindFreeSpacePosition(existingRects, wbCurrentViewportBoardRect(), width, height);
        if (free) { x = Math.round(free.x); y = Math.round(free.y); }
    }

    items.push({ task: name, x, y, colour: '', width, height, collapsed: false });

    if (!wbCommitMarkdown(updatePlanWhiteboardText(withTask, items))) return null;

    // The commit's renderText() is async, so the note's DOM does not exist
    // yet. Poll briefly for it rather than guessing a delay -- a slow
    // render must still land in "type the name straight away", and a
    // render that never happens must not leave a dangling timer.
    let attempts = 0;
    const focusWhenReady = () => {
        const entry = wbNoteNodes.get(name);
        if (entry) { wbBeginTitleEdit(entry); return; }
        if (++attempts < 20) setTimeout(focusWhenReady, 50);
    };
    setTimeout(focusWhenReady, 50);

    return name;
}

/** wbCreateNoteAt() for a client-space point (a canvas double-click). */
function wbCreateNoteAtClientPoint(clientX, clientY) {
    if (typeof wbClientToBoard !== 'function') return null;
    const point = wbClientToBoard(clientX, clientY);
    return wbCreateNoteAt(point.x, point.y);
}

/** wbCreateNoteAt() for the middle of whatever is currently on screen --
 * the toolbar's "New note" button and the `n` keyboard shortcut. */
function wbCreateNoteInViewportCentre() {
    if (typeof wbCurrentViewportBoardRect !== 'function') return null;
    const rect = wbCurrentViewportBoardRect();
    return wbCreateNoteAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

/**
 * Put one note's title into inline edit mode: the whole name selected, so
 * typing replaces it. Enter or blur commits, Escape reverts.
 *
 * contentEditable rather than swapping in an <input> so the text keeps its
 * exact position, font and colour while being edited -- a note's title
 * jumping half a pixel as you click it reads as a glitch on a surface that
 * is meant to feel like paper.
 */
function wbBeginTitleEdit(entry) {
    if (!entry || !entry.refs || !entry.refs.title) return;
    const title = entry.refs.title;
    if (title.isContentEditable) return;

    const originalName = entry.fo.dataset.wbTask || title.textContent;
    title.contentEditable = 'true';
    title.spellcheck = false;
    title.classList.add('editing');
    title.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(title);
    selection.removeAllRanges();
    selection.addRange(range);

    let settled = false;
    const finish = (commit) => {
        if (settled) return;
        settled = true;
        title.contentEditable = 'false';
        title.classList.remove('editing');
        title.removeEventListener('keydown', onKeydown);
        title.removeEventListener('blur', onBlur);

        const typed = title.textContent.replace(/\s+/g, ' ').trim();
        if (!commit || !typed || typed === originalName) {
            title.textContent = originalName;
            return;
        }
        if (!wbRenameNoteTask(originalName, typed)) title.textContent = originalName;
    };

    const onKeydown = (e) => {
        e.stopPropagation(); // canvas shortcuts must not fire while typing
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);

    title.addEventListener('keydown', onKeydown);
    title.addEventListener('blur', onBlur);
}

/**
 * Rename the task behind a note, in one commit: the outline line itself,
 * every `[depends ...]` that referenced the old name, and the note's own
 * whiteboard row. Chains script.js's existing updateDependencyReferences()
 * and renamePlanWhiteboardTask() rather than reimplementing either, so a
 * rename from the board behaves identically to one from the task form.
 *
 * Refused (with a message, not silently) when another task already has
 * that name: whiteboard rows, dependencies and Theme: colours all key on
 * the name, so two tasks sharing one would make those references
 * ambiguous.
 */
function wbRenameNoteTask(oldName, newName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !oldName || !newName || oldName === newName) return false;
    if (typeof wbRenameTaskInPlanText !== 'function') return false;

    const clash = (wbLastTasks || []).some(t =>
        t && t.name && t.name !== oldName &&
        String(t.name).toLowerCase() === String(newName).toLowerCase());
    if (clash) {
        if (typeof wbFlashNoodleMessage === 'function') {
            wbFlashNoodleMessage(`Another task is already called "${newName}".`);
        }
        return false;
    }

    let next = wbRenameTaskInPlanText(editor.value, oldName, newName);
    if (next === editor.value) return false;

    if (typeof updateDependencyReferences === 'function') {
        const lines = next.split('\n');
        updateDependencyReferences(lines, oldName, newName);
        next = lines.join('\n');
    }
    if (typeof renamePlanWhiteboardTask === 'function') {
        next = renamePlanWhiteboardTask(next, oldName, newName);
    }

    // The note's DOM is keyed by task name; re-key it now so the in-flight
    // render updates the existing node instead of building a second one
    // and leaving the old one behind until the next pass sweeps it.
    const entry = wbNoteNodes.get(oldName);
    if (entry) {
        wbNoteNodes.delete(oldName);
        wbNoteNodes.set(newName, entry);
        entry.fo.dataset.wbTask = newName;
    }

    return wbCommitMarkdown(next);
}

/**
 * Cut the noodle arriving at this note: move the task back out to the top
 * level of the plan. Same write as clicking a selected noodle's cut
 * button -- offered on the note's own `...` menu too, since the noodle
 * itself can be hard to hit on a dense board.
 */
function wbUnlinkNoteFromParent(taskName) {
    const task = (wbLastTasks || []).find(t => t && t.name === taskName);
    if (!task || !task.parent) return false;
    if (typeof wbCutNoodle !== 'function') return false;
    return wbCutNoodle(task.parent, taskName);
}

/**
 * Delete the task behind a note, subtree and all, and take its row off the
 * board. Deliberately distinct from "Remove from board", which only drops
 * the row -- and deliberately confirmed, because unlike every other board
 * action this one destroys plan content that the board is not the only
 * view of.
 */
function wbDeleteNoteTask(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName) return false;
    if (typeof wbDeleteTaskFromPlanText !== 'function') return false;

    const childCount = wbChildCount(wbLastTasks, taskName);
    const detail = childCount
        ? ` and its ${childCount} subtask${childCount === 1 ? '' : 's'}`
        : '';
    if (typeof confirm === 'function' &&
        !confirm(`Delete "${taskName}"${detail} from the plan?\n\nThis removes the task itself, not just its note.`)) {
        return false;
    }

    let next = wbDeleteTaskFromPlanText(editor.value, taskName);
    if (next === editor.value) return false;

    // Take the (now orphaned) whiteboard row with it, in the same commit.
    if (typeof extractWhiteboardFromPlanText === 'function' &&
        typeof parseWhiteboardMarkdown === 'function' &&
        typeof updatePlanWhiteboardText === 'function') {
        const gone = new Set([String(taskName).toLowerCase()]);
        wbDescendantNames(wbLastTasks, taskName).forEach(n => gone.add(n));
        const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(next))
            .filter(item => !(item && item.task && gone.has(String(item.task).toLowerCase())));
        next = updatePlanWhiteboardText(next, items);
    }

    return wbCommitMarkdown(next);
}
