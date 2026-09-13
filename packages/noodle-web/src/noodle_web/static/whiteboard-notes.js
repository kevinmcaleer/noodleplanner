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
 *
 * Nested subtasks several layers deep (issue #1016, part of #885): #850's
 * peek above already IS the generic, multi-level mechanism -- confirmed by
 * reading task-peek.js's tpPushLevel()/tpPopToIndex()/tpDrillInto() (a
 * plain, uncapped stack of {task, children} levels with a breadcrumb) and
 * wbBuildPeekLevel() (which only ever answers "does *this* task have
 * children", for whatever task name it's asked about) before writing a
 * single line for #1016. Neither has, or ever had, any notion of "level 0
 * vs level 1" to remove: a child row's drill-down badge already shows
 * whenever *that* child has its own children, at any depth, because
 * wbBuildPeekLevel(name, wbLastTasks) is called fresh every time
 * tpDrillInto() asks for a new level via the resolveLevel callback (see
 * wbOpenChildPeek() below) -- it was never wired to only ever be called
 * once. #1016 is therefore a verification-and-regression-test issue, not
 * an implementation one: tests/test_task_peek.py's TestPeekDeepNesting
 * drills four levels deep with no code change required, and
 * TestPeekPlanTextRerender locks in that the breadcrumb stack survives an
 * ordinary plan-text auto-render while several levels in (it already did,
 * because the popover lives in document.body, decoupled from the note
 * cards that re-render rebuilds in place -- see wbUpdateNoteNode()).
 *
 * Free-form notes (issue #1015, the other half of #846's checklist post-it,
 * per #885): a note's task is looked up purely by name (see
 * wbBuildNoteViewModel()'s own comment on this), so nothing about a
 * whiteboard row itself ever required its task to have children -- a note
 * for a childless task has always been a legal, if slightly odd, thing to
 * render. What #846 never distinguished is that a childless note is a
 * *different kind of thought* from a checklist: "a sticky thought, no
 * checklist, no tasks underneath" per the issue, matching #885's "everything
 * starts loose and earns structure only when it proves it deserves it."
 * wbIsFreeformNote() is the single predicate this file uses to tell the two
 * apart -- true iff the task has zero direct children *at all* (counting
 * ones already drawn as noodles to their own notes, not just this note's
 * own visible rows, since a child noodled elsewhere still means real
 * checklist structure exists in the outline even though this note's body
 * doesn't draw it) -- and wbUpdateNoteNode() uses it to switch a note
 * between two renderings: checklist (unchanged from #846: child rows,
 * progress footer) and free-form (this note's own `comment` field --
 * task-details form's "Comment" textarea, the same single-line free-text
 * already round-tripped through the task's own outline line by
 * script.js's saveTask()/openTaskForm() -- shown as the note's body if set,
 * blank otherwise; no footer). No new ---whiteboard--- column and no new
 * "kind" of stored object: a free-form note is simply what a checklist
 * note with zero children already was, rendered honestly instead of as an
 * empty checklist. See this file's own note on the architectural choice in
 * the #1015 PR description for why a second, task-less note type (a
 * `Text` column, closer to #1018's free-floating text) was rejected.
 *
 * Creation defaults to free-form, per #885's "nothing is mandatory; nothing
 * prompts for detail": both ways to make a brand-new note --
 * wbCreateNoteAt() (canvas double-click / `n` / the toolbar's "New post-it",
 * via whiteboard-structure.js's wbAppendTopLevelTask()) and
 * wbCreateAndAddSummaryTask() (the Add-note picker's "+ New phase" form,
 * via wbInsertNewSummaryTaskLine() below) -- write a bare, childless task
 * line, so a brand-new note is free-form until the user gives it its first
 * child (from the task form, the outline, or noodling an existing note
 * under it), at which point it renders as a checklist automatically on the
 * very next render pass, with no separate "convert to checklist" action
 * anywhere. wbInsertNewSummaryTaskLine() used to also write a "New Task"
 * placeholder child so the new line would parse as a summary task
 * immediately; that placeholder is exactly the "forced checklist
 * structure" #1015 asks not to impose, so it is gone.
 *
 * Promote to task (issue #1020, part of #885, building on #1015 above): a
 * free-form note's own task is *already* a real outline task per #1015 --
 * there is no "create a task that didn't exist before" step. What a
 * free-form note is missing is structure, so "promote to task" here means
 * turning its loose `comment` text into one real child task
 * (wbPromoteFreeformNote(), reached from the note `...` menu's "Promote to
 * task" item -- wbAppendPromoteMenuSection() -- shown only when
 * wbIsFreeformNote() is true). Adding that child is exactly what flips
 * wbIsFreeformNote() to false and switches the note to checklist rendering
 * on the very next render pass -- no new rendering path needed, reusing
 * #1015's split as-is. The child line itself is written by
 * whiteboard-structure.js's wbAppendChildTask() (last child, same
 * insertion point wbReparentTaskInPlanText() uses for a noodle drop), and
 * named via wbSanitiseChildTaskName() + wbUniqueTaskName() so a long,
 * multi-line, or quote-containing comment can't corrupt the outline the
 * way #1006 found collab-ops.js's untrusted rename/add_task input could.
 * A blank free-form note (no comment to promote) falls back to a
 * `prompt()`, same "cancelled or blank -> silent no-op" shape as
 * kanban.js's addNewPhase(). One wbCommitMarkdown() call either way, so
 * promotion is a single undo step like every other whiteboard mutation.
 *
 * Free-floating text objects (issue #1018, part of #885): a second, wholly
 * separate canvas object type living alongside post-it notes -- bare text
 * at a position, no card, no border, no background, not backed by a task
 * at all. Explicitly distinct from #1015's free-form note above: a
 * free-form note is still a post-it (a bordered `.wb-note-card`, backed by
 * a real task in the outline, with a title/menu/footer that just happen to
 * be visually minimal because it has no children) -- a text object has
 * none of that. It is rendered as its own `.wb-text-object`
 * <foreignObject> (wbRenderTextObjects()/wbCreateTextObjectNode()/
 * wbUpdateTextObjectNode()), sharing the same notes layer (so it pans/
 * zooms/z-orders alongside post-its) but never touching `wbNoteNodes`,
 * `wbBuildNoteViewModel()`, or the task outline.
 *
 * Storage: see script.js's "Whiteboard back matter" header comment for the
 * full rationale -- a text object is a second row shape (`{ kind: 'text',
 * id, text, x, y }`) in the *same* ---whiteboard--- table post-it rows use
 * (Kind/Id/Text columns), not a second section, precisely because every
 * existing whiteboard mutation already rewrites the *entire* table from
 * `items` on every commit (wbCommitNoteChange() et al.) -- a separate
 * section would be silently wiped by the next unrelated post-it drag.
 * `id` (wbGenerateTextObjectId()) stands in for a post-it row's Task as
 * this row's unique key, since a text object has no task name to key off.
 *
 * Interaction: deliberately a smaller, parallel implementation of #848's
 * drag machinery (wbActiveTextDrag/wbBeginTextDrag()/
 * wbUpdateTextDragFromClient()/wbFinishTextDrag()) rather than a
 * generalisation of wbActiveDrag itself -- text objects have no resize
 * handle, no z-order-to-front commit, no noodles, so folding them into the
 * note drag state machine would mean threading a `kind` branch through
 * code that already carries a lot of state for a feature this one doesn't
 * need. A click that doesn't move past WB_DRAG_MOVE_THRESHOLD selects the
 * object (wbSetSelectedText(), a solid outline -- move mode); only the
 * *second* such click, within the same double-click window #848's note
 * header rename already uses, enters inline edit (wbBeginTextObjectEdit(),
 * a fainter dashed outline instead -- issue #1105's explicit ask for
 * single-click-to-select/drag vs. double-click-to-edit, kept as two
 * visually distinct modes so a drag's own initial mousedown is never
 * mistaken for "start editing"). No resize: per the issue, bare text has
 * no fixed box to resize -- it simply grows/shrinks with its own content
 * (`.wb-text-object` renders with `overflow: visible` over a generous
 * fixed <foreignObject> box rather than a content-fitted one, since SVG
 * foreignObject sizing requires an explicit width/height).
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
const WB_LAYOUT_GAP_COMPACT = 8;
const WB_LAYOUT_GAP_DEFAULT = 24;
const WB_LAYOUT_GAP_COMFY = 56;

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

// Issue #1018: a text object's <foreignObject> box. Generous and fixed
// (SVG foreignObject sizing needs an explicit width/height) but rendered
// with `overflow: visible` and an inner element that only occupies as
// much of that box as its own text needs -- see views/whiteboard.css's
// `.wb-text-object`/`.wb-text-object-content` -- so in practice the object
// reads as "however big its text is", not as a fixed box.
const WB_TEXT_DEFAULT_WIDTH = 320;
const WB_TEXT_DEFAULT_HEIGHT = 120;

// ── Module state ─────────────────────────────────────────────────────────
// Cache of the most recently parsed tasks/planText (see file header) plus
// a map from summary task name -> the DOM we built for it last render, so
// re-renders update existing nodes in place instead of tearing everything
// down (which would lose in-note scroll position and cause flicker).
let wbLastTasks = [];
let wbLastPlanText = '';
let wbNoteNodes = new Map(); // summary task name -> { fo, refs: {...} }

// Issue #1018: same idea as wbNoteNodes, keyed by a text object's own
// generated `id` (never a task name) instead of a task name.
let wbTextNodes = new Map(); // text-object id -> { fo, refs: {...} }

// The "selected" note (issue #1109): the summary task name of whichever
// note the user last picked up (dragged, resized or tapped -- see every
// wbRaiseNoteToFront() call site) or explicitly cleared by clicking bare
// canvas (whiteboard.js's wbHandleMouseDown(), mirroring how that same
// click already clears the selected noodle). This exists so the ribbon's
// whiteboard "Colour" button -- previously an unwired stub -- has
// something to act on without requiring a note's own `...` menu.
let wbSelectedNoteTask = null;

/** Select (or, with a falsy name, deselect) one note, updating the
 * `.wb-note-selected` class on its card. A no-op when the same note is
 * already selected, so re-raising an already-frontmost note on repeated
 * clicks doesn't thrash the class. */
function wbSetSelectedNote(taskName) {
    const next = taskName || null;
    if (wbSelectedNoteTask === next) return;
    const prevEntry = wbSelectedNoteTask ? wbNoteNodes.get(wbSelectedNoteTask) : null;
    if (prevEntry && prevEntry.refs && prevEntry.refs.card) {
        prevEntry.refs.card.classList.remove('wb-note-selected');
    }
    wbSelectedNoteTask = next;
    const nextEntry = next ? wbNoteNodes.get(next) : null;
    if (nextEntry && nextEntry.refs && nextEntry.refs.card) {
        nextEntry.refs.card.classList.add('wb-note-selected');
    }
}

function wbClearNoteSelection() {
    wbSetSelectedNote(null);
}

/** The selected note's task name, or null -- self-healing against a
 * selection left dangling by the note having been removed from the board
 * since (wbRenderNotes()' sweep deletes straight from wbNoteNodes without
 * going through wbSetSelectedNote()). */
function wbGetSelectedNoteTask() {
    if (wbSelectedNoteTask && !wbNoteNodes.has(wbSelectedNoteTask)) {
        wbSelectedNoteTask = null;
    }
    return wbSelectedNoteTask;
}

// The "selected" text object (issue #1105), the same idea as
// wbSelectedNoteTask just above but keyed by a text object's own generated
// `id` instead of a task name: whichever object a plain click (no
// movement, and not the second click of a double-click) last landed on, or
// explicitly cleared by clicking bare canvas / Escape (whiteboard.js's
// wbHandleMouseDown()/wbHandleKeyDown()). A solid accent outline
// (`.wb-text-object-content.selected`) is the "picked up, ready to drag"
// affordance -- deliberately distinct from the dashed muted outline
// `.editing` shows, so the two modes the issue asks for ("selection
// outline vs. edit border") never look the same.
let wbSelectedTextId = null;

/** Select (or, with a falsy id, deselect) one text object, updating the
 * `.wb-text-object-content.selected` class on its content div. A no-op
 * when the same object is already selected. */
function wbSetSelectedText(id) {
    const next = id || null;
    if (wbSelectedTextId === next) return;
    const prevEntry = wbSelectedTextId ? wbTextNodes.get(wbSelectedTextId) : null;
    if (prevEntry && prevEntry.refs && prevEntry.refs.content) {
        prevEntry.refs.content.classList.remove('selected');
    }
    wbSelectedTextId = next;
    const nextEntry = next ? wbTextNodes.get(next) : null;
    if (nextEntry && nextEntry.refs && nextEntry.refs.content) {
        nextEntry.refs.content.classList.add('selected');
    }
}

function wbClearTextSelection() {
    wbSetSelectedText(null);
}

// Colour-menu state (issue #849). Only one `...` menu is ever open at a
// time (matches mindmap.js's single mmColourPicker / status-bar.js's
// single statusBarHistoryPopup convention), so this is a single slot
// rather than a map.
let wbNoteMenuState = null; // { taskName, btn } while open, else null
let wbCoachingMenuState = null; // { taskName, trigger, popup }
let wbSmartMenuState = null; // { taskName, trigger, popup } for date/resource bubbles

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

// ── Natural-language smart tags (#878) ────────────────────────────────

const WB_MONTHS = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
    april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
    august: 8, aug: 8, september: 9, sept: 9, sep: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function wbIsoDate(year, month, day) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Find explicit dates people naturally put in sticky-note prose. The
 * reference year is injected for deterministic tests and yearless dates. */
function wbDetectNaturalDates(value, referenceDate = new Date()) {
    const text = String(value || '');
    const found = [];
    const patterns = [
        { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, parts: m => [+m[1], +m[2], +m[3]] },
        { re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/gi,
            parts: m => [m[3] ? +m[3] : referenceDate.getFullYear(), WB_MONTHS[m[2].toLowerCase()], +m[1]] },
        { re: /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi,
            parts: m => [m[3] ? +m[3] : referenceDate.getFullYear(), WB_MONTHS[m[1].toLowerCase()], +m[2]] },
        { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, parts: m => [+m[3], +m[2], +m[1]] },
    ];
    for (const pattern of patterns) {
        pattern.re.lastIndex = 0;
        let match;
        while ((match = pattern.re.exec(text))) {
            if (found.some(item => match.index >= item.start && match.index < item.end)) continue;
            const [year, month, day] = pattern.parts(match);
            const date = wbIsoDate(year, month, day);
            if (date) found.push({ raw: match[0], date, start: match.index, end: match.index + match[0].length });
        }
    }
    return found.sort((a, b) => a.start - b.start);
}

function wbTaskDateSuggestions(task) {
    const text = `${task && task.name || ''} ${task && task.comment || ''}`;
    const attached = new Set([
        task && (task.startDate || task.start),
        task && (task.finishDate || task.finish),
        task && task.deadline,
    ].filter(Boolean).map(value => String(value).slice(0, 10)));
    return wbDetectNaturalDates(text).filter(item => !attached.has(item.date));
}

function wbReplaceTokenRanges(line, tokens, replacement = '') {
    let result = String(line || '');
    [...tokens].sort((a, b) => b.start - a.start).forEach(token => {
        result = result.slice(0, token.start) + replacement + result.slice(token.end);
    });
    return result.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, '');
}

/** Apply a confirmed suggestion to the canonical task syntax. */
function wbApplyDateChoiceToLine(line, kind, date) {
    const parsed = TaskLineTokenizer.tokenize(String(line || ''));
    const dates = parsed.filter(token => token.type === 'date');
    if (kind === 'deadline') {
        // Canonical deadline syntax is the D-prefixed token (D2026-09-10),
        // the form engine/tokeniser.js and metadata.py both parse and
        // exporters.calculate_rag_status compares against.
        const without = String(line || '').replace(/\s*\bD\d{4}-\d{2}-\d{2}\b/g, '');
        return `${without.trimEnd()} D${date}`;
    }
    if (kind === 'milestone') {
        const removable = parsed.filter(token => token.type === 'date' || token.type === 'duration');
        return `${wbReplaceTokenRanges(line, removable).trimEnd()} 0d ${date}`;
    }
    if (kind === 'start') {
        if (dates[0]) return String(line).slice(0, dates[0].start) + date + String(line).slice(dates[0].end);
        return `${String(line).trimEnd()} ${date}`;
    }
    if (kind === 'finish') {
        if (dates[1]) return String(line).slice(0, dates[1].start) + date + String(line).slice(dates[1].end);
        if (dates[0]) return `${String(line).trimEnd()} ${date}`;
        return `${String(line).trimEnd()} ${date} ${date}`;
    }
    return line;
}

function wbApplyDateChoiceToPlanText(planText, taskName, kind, date) {
    if (typeof NoodlePlanModel === 'undefined') return planText;
    const model = NoodlePlanModel.PlanModel.parse(planText);
    const task = model.tasks.find(node => String(node.name || '').toLowerCase() === String(taskName || '').toLowerCase());
    if (!task) return planText;
    model.updateLine(task, line => wbApplyDateChoiceToLine(line, kind, date));
    return model.serialize();
}

function wbResourceOptionsFromPlanText(planText) {
    const result = [];
    const match = /^---\s*$([\s\S]*?)^---\s*$/m.exec(String(planText || ''));
    if (!match) return result;
    const re = /^\s*-\s*@([A-Za-z0-9_]+):\s*([^,\n]+)(?:,\s*([^\n]+))?/gm;
    let item;
    while ((item = re.exec(match[1]))) result.push({ shortname: item[1], name: item[2].trim(), role: (item[3] || '').trim() });
    return result;
}

function wbApplyResourceToLine(line, shortname, assigned) {
    const token = `@${shortname}`;
    const resources = TaskLineTokenizer.tokenize(String(line || '')).filter(item =>
        item.type === 'resource' && item.text.slice(1).toLowerCase() === String(shortname).toLowerCase());
    const result = wbReplaceTokenRanges(line, resources);
    return assigned ? `${result.trimEnd()} ${token}` : result;
}

function wbApplyResourceToPlanText(planText, taskName, shortname, assigned) {
    if (typeof NoodlePlanModel === 'undefined') return planText;
    const model = NoodlePlanModel.PlanModel.parse(planText);
    const task = model.tasks.find(node => String(node.name || '').toLowerCase() === String(taskName || '').toLowerCase());
    if (!task) return planText;
    model.updateLine(task, line => wbApplyResourceToLine(line, shortname, assigned));
    return model.serialize();
}

// ── Facilitator coaching (#875) ───────────────────────────────────────

const WB_ACTIVITY_VERBS = new Set([
    'approve', 'build', 'configure', 'coordinate', 'create', 'deploy',
    'design', 'develop', 'draft', 'implement', 'install', 'manage',
    'migrate', 'prepare', 'produce', 'review', 'run', 'update',
]);

/** A deliberately small, explainable language heuristic. It only suggests;
 * it never changes a task. "Test plan" is explicitly kept as a product-like
 * noun phrase while "test the plan" remains an activity-shaped phrase. */
function wbActivityLanguageHint(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const words = text.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
    if (!words.length) return null;
    const first = words[0];
    if (/^[a-z]{4,}ing$/.test(first)) {
        return { kind: 'gerund', word: first };
    }
    if (first === 'test') {
        const second = words[1] || '';
        if (!['a', 'an', 'the', 'this', 'that', 'our', 'their'].includes(second)) return null;
        return { kind: 'verb', word: first };
    }
    return WB_ACTIVITY_VERBS.has(first) ? { kind: 'verb', word: first } : null;
}

function wbTaskPlanningType(task) {
    const labels = String((task && task.labels) || '').split(',')
        .map(label => label.trim().toLowerCase()).filter(Boolean);
    if (labels.includes('product')) return 'product';
    if (labels.includes('activity')) return 'activity';
    return null;
}

/** Replace only unquoted #activity/#product tokens, preserving comments. */
function wbReplacePlanningTypeToken(line, type) {
    const wanted = type === 'activity' || type === 'product' ? type : null;
    const segments = String(line || '').split(/("[^"]*")/g);
    for (let i = 0; i < segments.length; i += 2) {
        segments[i] = segments[i].replace(/(^|\s)#(?:activity|product)(?=\s|$)/gi, '$1')
            .replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, '');
    }
    let result = segments.join('');
    if (wanted) result += ` #${wanted}`;
    return result;
}

function wbApplyPlanningTypeToPlanText(planText, taskName, type) {
    if (typeof NoodlePlanModel === 'undefined') return planText;
    const model = NoodlePlanModel.PlanModel.parse(planText);
    const key = String(taskName || '').toLowerCase();
    const task = model.tasks.find(node => String(node.name || '').toLowerCase() === key);
    if (!task) return planText;
    model.updateLine(task, line => wbReplacePlanningTypeToken(line, type));
    return model.serialize();
}

function wbAddNamedDependencyToPlanText(planText, taskName, predecessorName) {
    if (typeof NoodlePlanModel === 'undefined') return planText;
    const model = NoodlePlanModel.PlanModel.parse(planText);
    const key = String(taskName || '').toLowerCase();
    const task = model.tasks.find(node => String(node.name || '').toLowerCase() === key);
    if (!task) return planText;
    model.updateLine(task, line => {
        const block = /\[depends\s*:?[\s]*([^\]]*)\]/i.exec(line);
        if (!block) return `${line} [depends ${predecessorName}]`;
        const current = block[1].trim();
        const replacement = `[depends ${current ? `${current}, ` : ''}${predecessorName}]`;
        return line.slice(0, block.index) + replacement + line.slice(block.index + block[0].length);
    });
    return model.serialize();
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
 * themes: the raw swatch value fills the whole card as-is (issue #1103),
 * and wbUpdateNoteNode() picks the note's one text colour against that
 * raw fill via wbContrastTextColour() (a real WCAG check), rather than
 * darkening the fill itself first.
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
 * isolated unit tests. Not used by note rendering itself (issue #1103
 * fills a note with its raw swatch colour, not a shaded one -- see
 * wbUpdateNoteNode()); kept as a shared colour-math helper.
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
        // Issue #1162's resource-assign bubble shows a child row's own
        // current assignees (not the summary task's, unlike the note
        // footer's avatars) -- same shape as wbBuildPeekLevel()'s own
        // per-child `resources`, so the bubble and the peek can never
        // disagree about who a child is assigned to.
        resources: wbResourceList(child.resources),
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

/**
 * Whether a note's view model should render as a free-form note (issue
 * #1015) rather than a checklist: true iff its task has literally zero
 * direct children of its own -- not merely zero *visible* body rows.
 * A task whose every child has already been noodled out onto its own note
 * (all of them in `vm.linkedChildren`, `vm.children` itself empty) still
 * counts as a checklist: the checklist structure is real in the outline,
 * this note's body just doesn't draw it (see wbBuildNoteViewModel()'s
 * children/linkedChildren split). Equivalent to `vm.progress.total === 0`
 * (wbNoteProgress() sums both groups), spelled out as its own named
 * predicate so the rendering code in wbUpdateNoteNode() -- and any test
 * asserting this rule -- reads as English rather than leaning on an
 * incidental property of how progress happens to be computed.
 */
function wbIsFreeformNote(vm) {
    return !!(vm && vm.progress) && vm.progress.total === 0;
}

/** Cap length for a task name built from free text (issue #1020's
 * "promote to task" -- see wbSanitiseChildTaskName() below): long enough
 * to stay legible as a single outline line, short enough that promoting a
 * whole paragraph of comment text doesn't produce one unreadable task. */
const WB_PROMOTED_TASK_NAME_MAX = 80;

/**
 * Turn arbitrary free text -- a free-form note's own `comment`, or
 * whatever the user types into the "name this task" prompt when there is
 * no comment to promote (see wbPromoteFreeformNote() below) -- into a
 * single valid outline task name:
 *
 *   - embedded newlines collapsed to a space, the same defence #1006
 *     applied to collab-ops.js's add_task/rename ops: `comment` is a
 *     <textarea> value (task-details form's "Comment" field) and can
 *     already contain them, and an unescaped newline surviving into a
 *     spliced-in outline line would split it into extra physical lines
 *     that could be mistaken for structure -- or, worse, a back-matter
 *     marker -- on the plan's next parse;
 *   - double quotes replaced with single quotes, since `"` is both the
 *     outline's own comment delimiter and the one character
 *     parseFromLine()'s (script.js) name regex treats as a hard
 *     terminator -- a literal `"` surviving into the name would silently
 *     truncate it on the next parse;
 *   - whitespace runs collapsed to one space and trimmed, matching
 *     wbBeginTitleEdit()'s own typed-name normalisation;
 *   - capped to WB_PROMOTED_TASK_NAME_MAX characters (an ellipsis marks
 *     the cut).
 *
 * Returns '' for text that sanitises down to nothing (blank/whitespace
 * comment), which wbPromoteFreeformNote() treats as "nothing to promote".
 */
function wbSanitiseChildTaskName(text) {
    let name = String(text || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/"/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    if (name.length > WB_PROMOTED_TASK_NAME_MAX) {
        name = name.slice(0, WB_PROMOTED_TASK_NAME_MAX).trim() + '…';
    }
    return name;
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
 * A short, opaque id for a brand-new text object (issue #1018) -- stands
 * in for a post-it row's Task as the whiteboard row's unique key (see
 * script.js's "Whiteboard back matter" header comment). Not a UUID: just
 * distinct enough that two objects created back-to-back never collide,
 * and short enough to keep the ---whiteboard--- table's Id column narrow.
 */
function wbGenerateTextObjectId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

/**
 * Reposition whiteboard note rows for a named layout mode.
 *
 * Only rows with a Task are repositioned; free-floating text rows (`kind:
 * "text"`) are preserved as-is. Returns a fresh items array.
 */
function wbLayoutRows(items, tasks, mode, options = {}) {
    const list = (items || []).map(item => (item && typeof item === 'object') ? { ...item } : item);
    const notes = [];
    const noteIndexes = [];
    list.forEach((item, idx) => {
        if (item && item.task) {
            notes.push(item);
            noteIndexes.push(idx);
        }
    });
    if (!notes.length) return list;

    const key = String(mode || 'tidy').toLowerCase();
    const viewport = options.viewportRect || { x: 0, y: 0, width: 1200, height: 800 };
    const gap = options.gap != null ? options.gap : WB_LAYOUT_GAP_DEFAULT;
    const standardSize = !!options.standardSize;
    const width = options.width || WB_NOTE_DEFAULT_WIDTH;
    const height = options.height || WB_NOTE_DEFAULT_HEIGHT;
    const maxWidth = notes.reduce((max, row) => Math.max(max, row.width || width), width);
    const maxHeight = notes.reduce((max, row) => Math.max(max, row.height || height), height);
    const minX = viewport.x || 0;
    const minY = viewport.y || 0;
    const maxStartX = minX + Math.max(0, (viewport.width || 1200) - maxWidth);
    const maxStartY = minY + Math.max(0, (viewport.height || 800) - maxHeight);
    const startX = Math.round(Math.min(Math.max(minX + gap, minX), maxStartX));
    const startY = Math.round(Math.min(Math.max(minY + gap, minY), maxStartY));
    const rowStep = maxHeight + gap;
    const colStep = maxWidth + gap;
    const availableWidth = Math.max(0, (viewport.width || 1200) - maxWidth);
    const columns = Math.max(1, Math.floor(availableWidth / colStep) + 1);

    const taskOrder = new Map();
    const byName = new Map();
    (tasks || []).forEach((task, idx) => {
        if (!task || !task.name) return;
        const taskKey = String(task.name).toLowerCase();
        if (!taskOrder.has(taskKey)) taskOrder.set(taskKey, idx);
        if (!byName.has(taskKey)) byName.set(taskKey, task);
    });
    const orderOf = (taskName, fallback) => taskOrder.has(taskName) ? taskOrder.get(taskName) : fallback;

    function topRootKeyFor(taskName) {
        let currentKey = taskName;
        let current = byName.get(currentKey);
        const seen = new Set();
        while (current && current.parent) {
            const parentKey = String(current.parent).toLowerCase();
            if (seen.has(parentKey)) break;
            seen.add(parentKey);
            const parent = byName.get(parentKey);
            if (!parent) break;
            current = parent;
            currentKey = parentKey;
        }
        return currentKey;
    }

    function depthFor(taskName) {
        let depth = 0;
        let current = byName.get(taskName);
        const seen = new Set();
        while (current && current.parent) {
            const parentKey = String(current.parent).toLowerCase();
            if (seen.has(parentKey)) break;
            seen.add(parentKey);
            if (!byName.has(parentKey)) break;
            depth += 1;
            current = byName.get(parentKey);
        }
        return depth;
    }

    function dependencyDepthFor(taskName, cache, visiting) {
        if (cache.has(taskName)) return cache.get(taskName);
        if (visiting.has(taskName)) return 0;
        visiting.add(taskName);
        const task = byName.get(taskName);
        let depth = 0;
        const deps = (task && Array.isArray(task.dependencies)) ? task.dependencies : [];
        deps.forEach(edge => {
            if (!edge || !edge.target || !edge.target.name) return;
            const parentKey = String(edge.target.name).toLowerCase();
            if (!byName.has(parentKey)) return;
            const parentDepth = dependencyDepthFor(parentKey, cache, visiting);
            depth = Math.max(depth, parentDepth + 1);
        });
        visiting.delete(taskName);
        cache.set(taskName, depth);
        return depth;
    }

    const placed = new Array(notes.length);

    if (key === 'hierarchy') {
        const grouped = new Map();
        let maxDepth = 0;
        notes.forEach((row, idx) => {
            const taskKey = String(row.task).toLowerCase();
            const rootKey = topRootKeyFor(taskKey);
            if (!grouped.has(rootKey)) grouped.set(rootKey, []);
            const depth = depthFor(taskKey);
            maxDepth = Math.max(maxDepth, depth);
            grouped.get(rootKey).push({ row, idx, depth, order: orderOf(taskKey, idx) });
        });
        const rootOrder = Array.from(grouped.keys()).sort((a, b) => orderOf(a, Number.MAX_SAFE_INTEGER) - orderOf(b, Number.MAX_SAFE_INTEGER));
        const indentStep = Math.round((maxWidth + gap) * 0.7);
        const rootStride = Math.max(colStep * 2, (maxDepth + 1) * indentStep + colStep);
        rootOrder.forEach((rootKey, rootIndex) => {
            const groupRows = grouped.get(rootKey).sort((a, b) => a.order - b.order);
            groupRows.forEach((entry, rowIndex) => {
                placed[entry.idx] = {
                    x: startX + rootIndex * rootStride + entry.depth * indentStep,
                    y: startY + rowIndex * rowStep,
                };
            });
        });
    } else if (key === 'flow') {
        const depthCache = new Map();
        const levels = new Map();
        notes.forEach((row, idx) => {
            const taskKey = String(row.task).toLowerCase();
            const level = dependencyDepthFor(taskKey, depthCache, new Set());
            if (!levels.has(level)) levels.set(level, []);
            levels.get(level).push({ row, idx, order: orderOf(taskKey, idx) });
        });
        Array.from(levels.keys()).sort((a, b) => a - b).forEach(level => {
            const levelRows = levels.get(level).sort((a, b) => a.order - b.order);
            levelRows.forEach((entry, rowIndex) => {
                placed[entry.idx] = {
                    x: startX + level * colStep,
                    y: startY + rowIndex * rowStep,
                };
            });
        });
    } else {
        notes.forEach((_, idx) => {
            const row = Math.floor(idx / columns);
            const col = idx % columns;
            placed[idx] = {
                x: startX + col * colStep,
                y: startY + row * rowStep,
            };
        });
    }

    notes.forEach((row, idx) => {
        const pos = placed[idx] || { x: row.x || 0, y: row.y || 0 };
        row.x = Math.round(pos.x);
        row.y = Math.round(pos.y);
        if (standardSize) {
            row.width = width;
            row.height = height;
        }
    });

    return list;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        wbDirectChildren, wbHasChildren, wbChildCount, wbIsChildComplete,
        wbNoteProgress, wbGetInitials, wbResourceList, wbRelativeLuminance,
        wbContrastRatio, wbContrastTextColour, wbNoteZoomTier,
        wbBuildNoteViewModel, wbNoteViewModels, wbBuildPeekLevel, wbIsFreeformNote,
        wbSanitiseChildTaskName,
        wbPalette, WB_NOTE_PASTEL_COLOURS, wbShadeColour, wbDerivedPaletteColour, wbThemeColourFor,
        wbResolveNoteColour,
        wbDragBoardDelta, wbClampNoteWidth, wbClampNoteHeight,
        wbExceedsMoveThreshold, wbMoveTaskToEnd,
        wbTaskAncestorNames, wbTaskAncestorPath, wbSummaryTaskEntries,
        wbTasksNotOnBoard, wbFilterPickerEntries, wbRectsOverlap,
        wbFindFreeSpacePosition, wbBuildAddNoteRows, wbLayoutRows, wbInsertNewSummaryTaskLine,
        wbGenerateTextObjectId,
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

    // Issue #1018: free-floating text objects are their own row shape in
    // the same `rows` this pass already parsed (see script.js's header
    // comment) -- rendered in the same pass so they never lag a post-it's
    // own render by a frame, into the same notes layer so they pan/zoom/
    // z-order together.
    const textItems = rows.filter(r => r && r.kind === 'text' && r.id);
    wbRenderTextObjects(layer, textItems);

    // Noodles and the floating outline panel are rendered from the exact
    // same rows/tasks this pass just used, in the same pass, so a note, the
    // noodle arriving at it, and its row in the outline can never disagree
    // about the hierarchy. Both are no-ops if their file isn't loaded.
    if (typeof wbRenderNoodles === 'function') wbRenderNoodles(rows, wbLastTasks);
    if (typeof wbRenderDependencyNoodles === 'function') wbRenderDependencyNoodles();
    if (typeof wbRenderOutlinePanel === 'function') wbRenderOutlinePanel();

    // Empty state (issue #847): purposeful "what is this board for" copy
    // + Add note / Add all summary tasks, shown whenever nothing actually
    // rendered -- covers both a genuinely empty ---whiteboard--- section
    // and one that only has orphan rows (rows naming a task that no
    // longer exists), which is exactly right: an orphan-only board is, to
    // the user looking at it, indistinguishable from an empty one. A
    // board with only text objects and no post-its (issue #1018) also
    // counts as having content -- the empty-state CTA would otherwise sit
    // on top of the very text the user just added.
    wbUpdateEmptyState(viewModels.length > 0 || textItems.length > 0);
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

    // Promote-to-task quick button (issue #1107, part of epic #1090's
    // "button at the top right of the board, to the left of the `...`, to
    // change this from a text note into a summary task"): a one-click
    // header shortcut for exactly the `...` menu's existing "Promote to
    // task" item (wbAppendPromoteMenuSection()/wbPromoteFreeformNote(),
    // issue #1020) -- same commit, same single undo step, no new promotion
    // logic. Only ever shown for a free-form note (wbIsFreeformNote(), see
    // the visibility toggle in wbUpdateNoteNode() below); a checklist note
    // hides it rather than offering a "demote back to text note" the other
    // way, since undoing that would mean deleting real child tasks with no
    // existing precedent in this codebase for doing so safely -- out of
    // scope here, see this issue's own notes on why only the forward
    // direction is wired.
    const promoteBtn = document.createElementNS(XHTML_NS, 'button');
    promoteBtn.setAttribute('class', 'wb-note-promote-btn');
    promoteBtn.setAttribute('type', 'button');
    promoteBtn.setAttribute('title', "Turn this text note into a summary task");
    promoteBtn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="2" y="3" width="8" height="8" rx="1"/><path d="M8 12h6M11 9l3 3-3 3"/></svg>';
    promoteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskName = fo.dataset.wbTask;
        if (taskName && typeof wbPromoteFreeformNote === 'function') wbPromoteFreeformNote(taskName);
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

    const coachBtn = document.createElementNS(XHTML_NS, 'button');
    coachBtn.setAttribute('class', 'wb-note-coach-btn');
    coachBtn.setAttribute('type', 'button');
    coachBtn.setAttribute('aria-label', 'Planning prompts');
    coachBtn.setAttribute('aria-haspopup', 'dialog');
    coachBtn.textContent = '✦';
    coachBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskName = fo.dataset.wbTask;
        if (taskName) wbToggleCoachingMenu(taskName, coachBtn);
    });

    const dateBtn = document.createElementNS(XHTML_NS, 'button');
    dateBtn.setAttribute('class', 'wb-note-smart-btn wb-note-date-btn');
    dateBtn.setAttribute('type', 'button');
    dateBtn.setAttribute('aria-label', 'Attach detected date');
    dateBtn.textContent = 'Date';
    dateBtn.style.display = 'none';
    dateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskName = fo.dataset.wbTask;
        const task = wbLastTasks.find(item => item && item.name === taskName);
        const suggestion = wbTaskDateSuggestions(task)[0];
        if (taskName && suggestion) wbToggleDateMenu(taskName, suggestion, dateBtn);
    });

    const resourceBtn = document.createElementNS(XHTML_NS, 'button');
    resourceBtn.setAttribute('class', 'wb-note-smart-btn wb-note-resource-btn');
    resourceBtn.setAttribute('type', 'button');
    resourceBtn.setAttribute('aria-label', 'Assign a resource');
    resourceBtn.textContent = '＋';
    resourceBtn.title = 'Quick assign';
    resourceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskName = fo.dataset.wbTask;
        if (taskName) wbToggleResourceMenu(taskName, resourceBtn);
    });

    header.appendChild(title);
    header.appendChild(dateBtn);
    header.appendChild(resourceBtn);
    header.appendChild(linkHandle);
    header.appendChild(coachBtn);
    header.appendChild(promoteBtn);
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
            card, header, title, menuBtn, linkHandle, coachBtn, dateBtn, resourceBtn, promoteBtn, parentCaption,
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

    // Note colour: vm.colour (see wbResolveNoteColour() / this file's
    // header for the row-Colour -> Theme: -> derived-palette precedence)
    // fills the *entire* card as one solid block (issue #1103) -- header,
    // body and footer alike, not just a header tint plus a left accent
    // bar. --wb-note-accent (views/whiteboard.css's .wb-note-card) is the
    // raw, undiluted swatch colour applied straight to the card's
    // background and border; --wb-note-text is computed once against that
    // same raw colour via wbContrastTextColour() (a real WCAG ratio) and
    // used throughout the note -- header, rows, footer, free text -- via
    // that one CSS custom property, so everything on the note stays
    // legible on every swatch in both themes without the header and body
    // ever disagreeing on colour.
    refs.card.style.setProperty('--wb-note-accent', vm.colour);
    refs.card.style.setProperty('--wb-note-text', wbContrastTextColour(vm.colour) || '');

    // Don't clobber a title the user is in the middle of retyping.
    if (!refs.title.isContentEditable) {
        wbSetText(refs.title, vm.task.name);
        refs.title.setAttribute('title', vm.task.name + ' — double-click to rename');
    }
    const planningType = wbTaskPlanningType(vm.task);
    const languageHint = wbActivityLanguageHint(vm.task && vm.task.name);
    refs.coachBtn.classList.toggle('suspected-activity', !!languageHint && !planningType);
    refs.coachBtn.classList.toggle('typed', !!planningType);
    refs.coachBtn.textContent = planningType === 'product' ? 'P' : planningType === 'activity' ? 'A' : '✦';
    refs.coachBtn.title = planningType
        ? `Planning type: ${planningType}`
        : languageHint
            ? 'This sounds activity-shaped — open a gentle planning hint'
            : 'Open facilitator prompts';
    const dateSuggestion = wbTaskDateSuggestions(vm.task)[0];
    refs.dateBtn.style.display = dateSuggestion ? '' : 'none';
    if (dateSuggestion) {
        refs.dateBtn.textContent = dateSuggestion.raw;
        refs.dateBtn.title = `Attach ${dateSuggestion.date} to this task`;
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

    // Free-form vs. checklist (issue #1015) -- see wbIsFreeformNote() and
    // this file's header comment. The class drives the footer's CSS-only
    // hide (views/whiteboard.css's `.wb-note-freeform .wb-note-footer`),
    // so "is this note free-form right now" has exactly one source of
    // truth rather than a second condition down by the footer that could
    // quietly drift from this one.
    const freeform = wbIsFreeformNote(vm);
    refs.card.classList.toggle('wb-note-freeform', freeform);

    // Header quick "promote to task" button (#1107): visible only for a
    // free-form note, same condition wbAppendPromoteMenuSection() uses for
    // the `...` menu's own "Promote to task" item, so the two affordances
    // never disagree about when promoting makes sense.
    refs.promoteBtn.style.display = freeform ? '' : 'none';
    refs.promoteBtn.setAttribute('aria-label', `Promote ${vm.task.name} to a task`);

    if (freeform) {
        // A free-form note's body is its own `comment` field -- the same
        // single-line free-text the task-details form's "Comment" textarea
        // reads/writes for this note's own task (see this file's header
        // comment) -- shown if the user set one, and otherwise left
        // completely blank. Deliberately no placeholder copy here ("No
        // subtasks yet", a nudge to add a comment, ...): per #885, nothing
        // is mandatory and nothing prompts for detail.
        const comment = String((vm.task && vm.task.comment) || '').trim();
        if (comment) {
            const text = document.createElementNS(XHTML_NS, 'div');
            text.setAttribute('class', 'wb-note-freetext');
            text.textContent = comment;
            refs.body.appendChild(text);
        }
    } else if (!vm.children.length) {
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
    // Issue #1104, part of epic #1090: every checklist note (never a
    // free-form one -- see the `freeform` branch above) always ends in one
    // empty "Add task..." row, whether it currently has zero rows (the
    // "No subtasks yet"/"N linked notes" placeholder above), some rows, or
    // all of its children noodled elsewhere. wbBuildAddChildRow() below.
    if (!freeform) {
        refs.body.appendChild(wbBuildAddChildRow(vm.task.name));
    }
    refs.body.scrollTop = savedScrollTop;

    // Footer: completed/total fraction + resource avatar chips. Populated
    // unconditionally even for a free-form note -- CSS hides the whole
    // footer for `.wb-note-freeform` (see the class toggled above), so
    // there is nothing here to gate; `vm.progress` is always `0 / 0` in
    // that case anyway (wbIsFreeformNote() is defined in terms of it).
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

// ── Free-floating text objects (issue #1018) ────────────────────────────
//
// See the file header comment for the overall design. Deliberately a
// small, self-contained sibling to the post-it rendering above: its own
// node map (wbTextNodes), its own drag state (wbActiveTextDrag), never
// touching wbNoteNodes/wbBuildNoteViewModel/the task outline.

/**
 * Render (or update in place) every text object `items` (already filtered
 * to `kind === 'text'` rows by wbRenderNotes()) calls for -- the text-
 * object twin of the note-rendering loop just above, appended into the
 * same `layer` (the notes layer) so text objects pan/zoom/z-order
 * alongside post-its.
 */
function wbRenderTextObjects(layer, items) {
    if (!layer) return;
    const seen = new Set();
    items.forEach(item => {
        seen.add(item.id);
        let entry = wbTextNodes.get(item.id);
        if (!entry) {
            entry = wbCreateTextObjectNode();
            layer.appendChild(entry.fo);
            wbTextNodes.set(item.id, entry);
        }
        wbUpdateTextObjectNode(entry, item);
    });

    for (const [id, entry] of wbTextNodes) {
        if (!seen.has(id)) {
            entry.fo.remove();
            wbTextNodes.delete(id);
            // A deleted object can't stay "selected" (issue #1105's move-
            // mode outline) with nothing left on the board to show it on.
            if (wbSelectedTextId === id) wbSelectedTextId = null;
        }
    }
}

/**
 * Build the static DOM skeleton for one text object: a <foreignObject>
 * (`.wb-text-object`) containing a single content div (`.wb-text-object-
 * content`) and a small hover-only delete button -- deliberately nothing
 * else. No header, no card, no border, no footer: see views/whiteboard.css
 * for the "reads as part of the canvas surface itself" styling this is
 * built to carry.
 */
function wbCreateTextObjectNode() {
    const fo = document.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('class', 'wb-text-object');

    const wrap = document.createElementNS(XHTML_NS, 'div');
    wrap.setAttribute('class', 'wb-text-object-wrap');

    const content = document.createElementNS(XHTML_NS, 'div');
    content.setAttribute('class', 'wb-text-object-content');
    content.setAttribute('spellcheck', 'false');

    const deleteBtn = document.createElementNS(XHTML_NS, 'button');
    deleteBtn.setAttribute('class', 'wb-text-object-delete');
    deleteBtn.setAttribute('type', 'button');
    deleteBtn.setAttribute('title', 'Delete this text');
    deleteBtn.setAttribute('aria-label', 'Delete this text object');
    deleteBtn.textContent = '×'; // multiplication sign, reused as a small close glyph
    deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = fo.dataset.wbTextId;
        if (id) wbDeleteTextObject(id);
    });
    deleteBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    wrap.appendChild(content);
    wrap.appendChild(deleteBtn);
    fo.appendChild(wrap);

    const entry = { fo, refs: { wrap, content, deleteBtn } };

    // Drag-vs-edit-click wiring -- see wbTextObjectMouseDown()'s doc
    // comment for the disambiguation rule. Attached to `content` (not
    // `wrap`) so the delete button's own mousedown (already stopped above)
    // is never mistaken for the start of a drag.
    content.addEventListener('mousedown', (e) => wbTextObjectMouseDown(e, entry));
    content.addEventListener('touchstart', (e) => wbTextObjectTouchStart(e, entry), { passive: false });

    return entry;
}

/** Update one text object's DOM in place from its current row item. */
function wbUpdateTextObjectNode(entry, item) {
    const { fo, refs } = entry;
    const width = WB_TEXT_DEFAULT_WIDTH;
    const height = WB_TEXT_DEFAULT_HEIGHT;
    const x = Math.round(item.x || 0);
    const y = Math.round(item.y || 0);

    fo.setAttribute('x', String(x));
    fo.setAttribute('y', String(y));
    fo.setAttribute('width', String(width));
    fo.setAttribute('height', String(height));
    fo.dataset.wbTextId = item.id;
    fo.dataset.wbX = String(x);
    fo.dataset.wbY = String(y);
    fo.dataset.wbWidth = String(width);
    fo.dataset.wbHeight = String(height);

    // Never stomp on live-typed content: while this object is mid-edit,
    // its DOM is the source of truth (nothing has committed to plan text
    // yet), so a re-render triggered by something else on the board must
    // leave it alone.
    if (refs.content.isContentEditable) return;

    const text = String(item.text || '');
    refs.content.textContent = text;
    refs.content.classList.toggle('wb-text-object-placeholder', !text);
    if (!text) refs.content.textContent = 'Text…';
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
 *
 * Also the single choke point every "user picked this note up" gesture
 * (header drag, resize drag, touch tap/long-press) already passes
 * through, so it doubles as marking that note "selected" (issue #1109) --
 * no separate click handler needed.
 */
function wbRaiseNoteToFront(entry) {
    if (entry && entry.fo) wbSetSelectedNote(entry.fo.dataset.wbTask);
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
    if (typeof wbRefreshDependencyNoodleGeometry === 'function') {
        wbRefreshDependencyNoodleGeometry(fo.dataset.wbTask);
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
    if (e.target && e.target.closest && e.target.closest('.wb-note-coach-btn')) return;
    if (e.target && e.target.closest && e.target.closest('.wb-note-smart-btn')) return;
    // Nor the noodle handle, nor a title mid-rename: both are their own
    // gestures that happen to start inside the drag handle.
    if (e.target && e.target.closest && e.target.closest('.wb-note-link-handle')) return;
    if (e.target && e.target.closest && e.target.closest('.wb-note-promote-btn')) return;
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
    if (e.target && e.target.closest && e.target.closest('.wb-note-coach-btn')) return;
    if (e.target && e.target.closest && e.target.closest('.wb-note-smart-btn')) return;
    if (e.target && e.target.closest && e.target.closest('.wb-note-link-handle')) return;
    if (e.target && e.target.closest && e.target.closest('.wb-note-promote-btn')) return;

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

// ── Text object drag / edit interaction (issue #1018, #1105) ────────────
//
// A deliberately smaller, parallel state machine to the note drag/resize
// one above -- see the file header comment for why this isn't a
// generalisation of wbActiveDrag. Move-only (no resize, no z-order-to-
// front commit, no noodles); a press that never exceeds
// WB_DRAG_MOVE_THRESHOLD is a click, not a drag.
//
// #1105 tightened what a non-dragging click does: it used to enter inline
// edit on its own (any click that didn't move was "the click to edit"),
// which made a plain, deliberate single click -- the gesture that starts
// every drag -- indistinguishable from "I want to edit this" the instant
// the pointer happened to lift without having moved yet. The issue asks
// explicitly for single-click-to-select/drag with *double*-click-to-edit,
// so a click that doesn't move now only selects (wbSetSelectedText());
// wbIsRepeatTextClick() below -- built the same way wbIsRepeatHeaderPress()
// already detects a note's own double-press-to-rename, from consecutive
// mousedowns rather than a native 'dblclick' listener, for the same touch
// parity -- promotes the *second* such click on the same object to inline
// edit instead.

let wbActiveTextDrag = null;

/** Last non-dragging click on a text object, for the double-press-to-edit
 * gesture (issue #1105) -- see wbIsRepeatTextClick(). Reuses
 * WB_HEADER_DOUBLE_PRESS_MS/SLOP: same "platform double-click default"
 * feel as the note header's own rename gesture, just tracked separately so
 * clicking a note then a text object in quick succession is never mistaken
 * for a double-click on either. */
let wbLastTextClick = null;

/** Whether `entry` was also the target of the *previous* non-dragging
 * click, within WB_HEADER_DOUBLE_PRESS_MS and without the pointer having
 * wandered more than WB_HEADER_DOUBLE_PRESS_SLOP px -- i.e. this click is
 * the second half of a double-click. Records this click either way, so
 * the next one can be compared against it. */
function wbIsRepeatTextClick(entry, clientX, clientY) {
    const now = Date.now();
    const last = wbLastTextClick;
    wbLastTextClick = { entry, x: clientX, y: clientY, at: now };

    if (!last || last.entry !== entry) return false;
    if (now - last.at > WB_HEADER_DOUBLE_PRESS_MS) return false;
    return !wbExceedsMoveThreshold(last.x, last.y, clientX, clientY, WB_HEADER_DOUBLE_PRESS_SLOP);
}

/** Resolve a text object click that never turned into a drag: the second
 * click of a double-click enters inline edit, anything else just selects
 * the object (the "picked up" state a drag would also show). */
function wbFinishTextClick(entry, clientX, clientY) {
    if (wbIsRepeatTextClick(entry, clientX, clientY)) {
        wbBeginTextObjectEdit(entry);
    } else {
        wbSetSelectedText(entry.fo.dataset.wbTextId);
    }
}

/** A text object's current board position, read off its own <foreignObject> dataset. */
function wbTextObjectCurrentRect(entry) {
    const fo = entry.fo;
    return {
        x: parseFloat(fo.dataset.wbX || fo.getAttribute('x') || '0') || 0,
        y: parseFloat(fo.dataset.wbY || fo.getAttribute('y') || '0') || 0,
    };
}

function wbBeginTextDrag(entry, clientX, clientY, touchId) {
    const rect = wbTextObjectCurrentRect(entry);
    wbActiveTextDrag = {
        phase: 'active',
        entry,
        touchId: (touchId === undefined) ? null : touchId,
        startClientX: clientX,
        startClientY: clientY,
        startX: rect.x,
        startY: rect.y,
        moved: false,
    };
    // Picking the object up selects it, same as a plain click that never
    // turns into a drag -- so the "selected" outline is already showing by
    // the time wbUpdateTextDragFromClient() starts moving it.
    wbSetSelectedText(entry.fo.dataset.wbTextId);
    wbSetDragCursor('grabbing');
}

/** Apply the live pointer position to the dragged text object's DOM only. */
function wbUpdateTextDragFromClient(clientX, clientY) {
    const drag = wbActiveTextDrag;
    if (!drag || drag.phase !== 'active') return;
    if (!drag.moved && wbExceedsMoveThreshold(drag.startClientX, drag.startClientY, clientX, clientY, WB_DRAG_MOVE_THRESHOLD)) {
        drag.moved = true;
    }
    if (!drag.moved) return;
    const { dx, dy } = wbDragBoardDelta(drag.startClientX, drag.startClientY, clientX, clientY, wbCurrentZoom());
    const x = Math.round(drag.startX + dx);
    const y = Math.round(drag.startY + dy);
    const fo = drag.entry.fo;
    fo.setAttribute('x', String(x));
    fo.setAttribute('y', String(y));
    fo.dataset.wbX = String(x);
    fo.dataset.wbY = String(y);
}

/**
 * The one markdown commit for a text-object gesture -- re-read the
 * whiteboard table fresh from #planEditor, apply `mutateItemFn` to this
 * object's own row (matched by `id`, never `task` -- see the file header
 * comment), and commit through the same wbCommitMarkdown() path every
 * other whiteboard write uses.
 */
function wbCommitTextObjectChange(id, mutateItemFn) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !id) return false;
    if (typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return false;
    }

    const planText = editor.value;
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(planText));
    const idx = items.findIndex(it => it && it.kind === 'text' && it.id === id);
    if (idx === -1) return false; // row vanished from underneath us -- nothing to persist

    if (typeof mutateItemFn === 'function') mutateItemFn(items[idx]);

    const nextText = updatePlanWhiteboardText(planText, items);
    return wbCommitMarkdown(nextText);
}

/** End the active text-object drag gesture: commit its new position, or
 * (a click that never moved) resolve it as a plain click vs. the second
 * half of a double-click -- see wbFinishTextClick(). */
function wbFinishTextDrag() {
    const drag = wbActiveTextDrag;
    if (!drag) return;
    wbActiveTextDrag = null;
    wbSetDragCursor('');

    if (!drag.moved) {
        wbFinishTextClick(drag.entry, drag.startClientX, drag.startClientY);
        return;
    }
    const rect = wbTextObjectCurrentRect(drag.entry);
    wbCommitTextObjectChange(drag.entry.fo.dataset.wbTextId, (item) => {
        item.x = Math.round(rect.x);
        item.y = Math.round(rect.y);
    });
}

function wbTextObjectFindTouchById(touchList, id) {
    return wbFindTouchById(touchList, id);
}

/**
 * A press on a text object's content: never hijack an already-editing
 * object (so cursor placement/text selection inside it works normally),
 * otherwise start a drag-or-click gesture -- resolved on release by
 * wbFinishTextDrag() into either a committed reposition, a plain-click
 * selection, or (the second click of a double-click) inline edit.
 */
function wbTextObjectMouseDown(e, entry) {
    if (e.button !== 0 || wbActiveTextDrag) return;
    if (entry.refs.content.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation(); // never let this fall through to canvas panning
    wbBeginTextDrag(entry, e.clientX, e.clientY);
}

function wbTextDragMouseMove(e) {
    if (!wbActiveTextDrag || wbActiveTextDrag.touchId !== null) return;
    wbUpdateTextDragFromClient(e.clientX, e.clientY);
}

function wbTextDragMouseUp(e) {
    if (!wbActiveTextDrag || wbActiveTextDrag.touchId !== null) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    wbFinishTextDrag();
}

/**
 * Touch twin of wbTextObjectMouseDown() -- same pending/long-press-to-
 * drag shape as wbNoteHeaderTouchStart() (issue #848), so a touch that
 * turns out to be an attempted canvas pan/scroll is abandoned rather than
 * dragging a text object by accident, and a quick tap resolves exactly
 * like a mouse click does (select, or edit on the second tap of a
 * double-tap -- see wbFinishTextClick()).
 */
function wbTextObjectTouchStart(e, entry) {
    if (wbActiveTextDrag || e.touches.length !== 1) return;
    if (entry.refs.content.isContentEditable) return;

    const touch = e.touches[0];
    const rect = wbTextObjectCurrentRect(entry);
    wbActiveTextDrag = {
        phase: 'pending',
        entry,
        touchId: touch.identifier,
        startClientX: touch.clientX,
        startClientY: touch.clientY,
        startX: rect.x,
        startY: rect.y,
        moved: false,
        longPressTimer: setTimeout(() => {
            if (!wbActiveTextDrag || wbActiveTextDrag.entry !== entry) return;
            wbActiveTextDrag.phase = 'active';
            wbActiveTextDrag.longPressTimer = null;
            wbSetDragCursor('grabbing');
        }, WB_TOUCH_LONG_PRESS_MS),
    };
}

function wbTextDragTouchMove(e) {
    const drag = wbActiveTextDrag;
    if (!drag || drag.touchId === null) return;
    const touch = wbTextObjectFindTouchById(e.touches, drag.touchId);
    if (!touch) return;

    if (drag.phase === 'pending') {
        if (wbExceedsMoveThreshold(drag.startClientX, drag.startClientY, touch.clientX, touch.clientY, WB_TOUCH_CANCEL_THRESHOLD)) {
            if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
            wbActiveTextDrag = null;
        }
        return;
    }

    e.preventDefault();
    wbUpdateTextDragFromClient(touch.clientX, touch.clientY);
}

function wbTextDragTouchEnd(e) {
    const drag = wbActiveTextDrag;
    if (!drag || drag.touchId === null) return;
    if (wbTextObjectFindTouchById(e.touches, drag.touchId)) return; // a different touch ended

    if (drag.phase === 'pending') {
        if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
        wbActiveTextDrag = null;
        // A plain tap: same resolution as a mouse click that never moved --
        // select, or edit on the second tap of a double-tap.
        wbFinishTextClick(drag.entry, drag.startClientX, drag.startClientY);
        return;
    }
    wbFinishTextDrag();
}

if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', wbTextDragMouseMove);
    window.addEventListener('mouseup', wbTextDragMouseUp);
    window.addEventListener('touchmove', wbTextDragTouchMove, { passive: false });
    window.addEventListener('touchend', wbTextDragTouchEnd);
    window.addEventListener('touchcancel', wbTextDragTouchEnd);
}

/**
 * Put a text object into inline edit mode: contentEditable directly on its
 * content div (the whole object *is* its text, unlike a note's separate
 * title-only rename), caret placed at the end. Blur or Escape settle it --
 * Escape reverts to the last-committed text, blur (including the natural
 * one from clicking elsewhere on the board) commits whatever was typed.
 * A newly-created, still-empty object that's left empty is not deleted
 * automatically -- see wbUpdateTextObjectNode()'s placeholder handling --
 * matching #885's "nothing is mandatory".
 */
function wbBeginTextObjectEdit(entry) {
    const content = entry.refs.content;
    if (!content || content.isContentEditable) return;

    const id = entry.fo.dataset.wbTextId;
    const wasPlaceholder = content.classList.contains('wb-text-object-placeholder');
    const originalText = wasPlaceholder ? '' : content.textContent;

    // Still "the selected object" once edit mode ends (issue #1105: leaving
    // edit mode returns to move mode, not to nothing selected) -- but the
    // two modes must look distinct, so the solid "selected" outline steps
    // aside for edit's own dashed one while typing (restored by finish()).
    wbSetSelectedText(id);
    content.classList.remove('selected');

    content.textContent = originalText;
    content.classList.remove('wb-text-object-placeholder');
    content.contentEditable = 'true';
    content.classList.add('editing');
    content.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    let settled = false;
    const finish = (commit) => {
        if (settled) return;
        settled = true;
        content.contentEditable = 'false';
        content.classList.remove('editing');
        content.removeEventListener('keydown', onKeydown);
        content.removeEventListener('blur', onBlur);
        // Back to move mode: restore the "selected" outline edit borrowed,
        // unless something else got selected while this was mid-edit.
        if (wbSelectedTextId === id) content.classList.add('selected');

        const typed = (content.innerText || content.textContent || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
        if (!commit || typed === originalText) {
            content.textContent = originalText || 'Text…';
            content.classList.toggle('wb-text-object-placeholder', !originalText);
            return;
        }
        content.textContent = typed || 'Text…';
        content.classList.toggle('wb-text-object-placeholder', !typed);
        wbCommitTextObjectChange(id, (item) => { item.text = typed; });
    };

    const onKeydown = (e) => {
        e.stopPropagation(); // canvas shortcuts must not fire while typing
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);

    content.addEventListener('keydown', onKeydown);
    content.addEventListener('blur', onBlur);
}

/**
 * Delete one text object's row, confirmation-free -- unlike deleting a
 * post-it's task (wbDeleteNoteTask()), this destroys nothing but the
 * object's own position/text: there is no task, no subtree, no other view
 * of this content anywhere else in the plan.
 */
function wbDeleteTextObject(id) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !id) return false;
    if (typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return false;
    }

    const planText = editor.value;
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(planText))
        .filter(item => !(item && item.kind === 'text' && item.id === id));
    return wbCommitMarkdown(updatePlanWhiteboardText(planText, items));
}

/**
 * Create a brand-new text object centred on the board point (x, y),
 * committed as its own whiteboard row (never a task -- see the file
 * header comment). Falls back to the same free-space scan wbCreateNoteAt()
 * uses when the centred point would overlap an existing note or text
 * object, and goes straight into edit mode so typing the text is part of
 * the same gesture, mirroring wbCreateNoteAt()'s title-edit handoff.
 */
function wbCreateTextObjectAt(boardX, boardY) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor) return null;
    if (typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return null;
    }

    const planText = editor.value;
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(planText));
    const id = wbGenerateTextObjectId();

    const width = WB_TEXT_DEFAULT_WIDTH;
    const height = WB_TEXT_DEFAULT_HEIGHT;
    let x = Math.round(boardX - width / 2);
    let y = Math.round(boardY - height / 2);

    const existingRects = items.map(item => ({
        x: item.x || 0,
        y: item.y || 0,
        width: (item.kind === 'text') ? WB_TEXT_DEFAULT_WIDTH : (item.width || WB_NOTE_DEFAULT_WIDTH),
        height: (item.kind === 'text') ? WB_TEXT_DEFAULT_HEIGHT : (item.height || WB_NOTE_DEFAULT_HEIGHT),
    }));
    const wanted = { x, y, width, height };
    const clashes = existingRects.some(rect => wbRectsOverlap(wanted, rect, 8));
    if (clashes && typeof wbFindFreeSpacePosition === 'function' &&
        typeof wbCurrentViewportBoardRect === 'function') {
        const free = wbFindFreeSpacePosition(existingRects, wbCurrentViewportBoardRect(), width, height);
        if (free) { x = Math.round(free.x); y = Math.round(free.y); }
    }

    items.push({ kind: 'text', id, text: '', x, y });
    if (!wbCommitMarkdown(updatePlanWhiteboardText(planText, items))) return null;

    // Same reasoning as wbCreateNoteAt(): the commit's renderText() is
    // async, so poll briefly for the new node rather than guessing a delay.
    // Budget is generous (3s) because renderText() awaits a full re-render
    // (baseline/forecast/escalation views included), which can be slow
    // under load -- see wbFocusAddRowWhenReady()'s comment below.
    let attempts = 0;
    const focusWhenReady = () => {
        const entry = wbTextNodes.get(id);
        if (entry) { wbBeginTextObjectEdit(entry); return; }
        if (++attempts < 60) setTimeout(focusWhenReady, 50);
    };
    setTimeout(focusWhenReady, 50);

    return id;
}

/** wbCreateTextObjectAt() for a client-space point. */
function wbCreateTextObjectAtClientPoint(clientX, clientY) {
    if (typeof wbClientToBoard !== 'function') return null;
    const point = wbClientToBoard(clientX, clientY);
    return wbCreateTextObjectAt(point.x, point.y);
}

/** wbCreateTextObjectAt() for the middle of whatever is currently on
 * screen -- the toolbar's "Add title" button (renamed from "New text" by
 * #1107) and the `t` keyboard shortcut. */
function wbCreateTextObjectInViewportCentre() {
    if (typeof wbCurrentViewportBoardRect !== 'function') return null;
    const rect = wbCurrentViewportBoardRect();
    return wbCreateTextObjectAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

/** Build one child-task row for a note body. */
function wbBuildChildRow(childVm) {
    const child = childVm.task;
    const row = document.createElementNS(XHTML_NS, 'div');
    row.setAttribute('class', 'wb-note-row');
    // Read by whiteboard-dep-noodles.js's wbNoteRowRectFor() (to draw a
    // committed dependency noodle at this row's own position) and by its
    // row-drag drop handling (wbUpdateRowDepDrag()/wbEndRowDepDrag(), to
    // find which task a dependency handle was dropped onto) -- see that
    // file's header comment for #1106.
    row.dataset.wbRowTask = child.name;
    row.dataset.wbRowSummary = childVm.hasChildren ? 'true' : 'false';

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

    const planningType = wbTaskPlanningType(child);
    const languageHint = wbActivityLanguageHint(child.name);
    if (languageHint || planningType) {
        const coach = document.createElementNS(XHTML_NS, 'button');
        coach.setAttribute('type', 'button');
        coach.setAttribute('class', 'wb-note-row-coach' + (languageHint && !planningType ? ' suspected-activity' : ''));
        coach.setAttribute('aria-label', `Planning hint for ${child.name}`);
        coach.textContent = planningType === 'product' ? 'P' : planningType === 'activity' ? 'A' : '✦';
        coach.title = planningType ? `Planning type: ${planningType}` : 'This wording may describe an activity';
        coach.addEventListener('click', (e) => {
            e.stopPropagation();
            wbToggleCoachingMenu(child.name, coach);
        });
        row.appendChild(coach);
    }

    const dateSuggestion = wbTaskDateSuggestions(child)[0];
    if (dateSuggestion) {
        const date = document.createElementNS(XHTML_NS, 'button');
        date.setAttribute('type', 'button');
        date.setAttribute('class', 'wb-note-row-smart wb-note-row-date');
        date.setAttribute('aria-label', `Attach detected date ${dateSuggestion.raw} to ${child.name}`);
        date.textContent = dateSuggestion.raw;
        date.title = `Attach ${dateSuggestion.date}`;
        date.addEventListener('click', (e) => {
            e.stopPropagation();
            wbToggleDateMenu(child.name, dateSuggestion, date);
        });
        row.appendChild(date);
    }

    const assign = document.createElementNS(XHTML_NS, 'button');
    assign.setAttribute('type', 'button');
    assign.setAttribute('class', 'wb-note-row-smart wb-note-row-resource');
    assign.setAttribute('aria-label', `Assign a resource to ${child.name}`);
    assign.textContent = '＋';
    assign.title = 'Quick assign';
    assign.addEventListener('click', (e) => {
        e.stopPropagation();
        wbToggleResourceMenu(child.name, assign);
    });
    row.appendChild(assign);

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

    wbAppendChildResourceControls(row, childVm);
    wbAppendRowDependencyHandle(row, childVm);

    return row;
}

/**
 * Append the row-level dependency-drag handle (issue #1106, epic #1090):
 * a small icon at the row's own right-hand end -- after every other
 * trailing control, so it is always the last, right-most thing in the
 * row, per the issue's own "to the right of the checkbox task name
 * (aligned to the right)" wording -- shown only on hover/focus (views/
 * whiteboard.css's `.wb-note-row:hover`) so a board at rest still reads
 * as checklists, not a grid of controls, matching `.wb-note-link-handle`'s
 * existing convention on the note header.
 *
 * Only ever added for a *leaf* child row (`!childVm.hasChildren` -- the
 * same "does this task have children of its own" signal wbHasChildren()
 * already computes for the count-badge/peek decision above, reused here
 * rather than a second, possibly-diverging "is this a summary task"
 * check): the epic's "not summary task/note level -- it has to be
 * another task" rule means a summary child row can never be a dependency
 * endpoint, so it never even offers the handle. plan-model.js's
 * canAddDependency() enforces the same rule server-side-of-the-DOM (on
 * both the drag's source and whatever it's dropped on), so this is a
 * usability guard, not the only guard.
 */
function wbAppendRowDependencyHandle(row, childVm) {
    if (childVm.hasChildren) return;
    const child = childVm.task;

    const handle = document.createElementNS(XHTML_NS, 'button');
    handle.setAttribute('type', 'button');
    handle.setAttribute('class', 'wb-note-row-dep-handle');
    handle.setAttribute('title', 'Drag to another task to make it depend on this one');
    handle.setAttribute('aria-label', `Draw a dependency from "${child.name}" to another task`);
    handle.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/>' +
        '<path d="M4 6 C4 11, 7 12, 10 12"/></svg>';
    handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof wbBeginRowDepDrag === 'function') wbBeginRowDepDrag(child.name, e.clientX, e.clientY);
    });
    handle.addEventListener('touchstart', (e) => {
        if (typeof wbRowDepHandleTouchStart === 'function') wbRowDepHandleTouchStart(e, child.name);
    }, { passive: false });
    handle.addEventListener('click', (e) => e.stopPropagation());

    row.appendChild(handle);
}

/**
 * Append the quick resource-assign affordance (issue #1162, part of epic
 * #878) to the right-hand end of a checklist row: a small avatar per
 * already-assigned resource (mirrors the note footer's own
 * `.wb-note-avatar` treatment -- wbGetInitials(), same initials -- just
 * smaller, since several may sit in one row), then a "+" bubble that opens
 * a dropdown of the plan's resources for one-click assignment. Deliberately
 * the row's last children in DOM order -- "a bubble at the right of a
 * task", per the epic's own wording.
 */
function wbAppendChildResourceControls(row, childVm) {
    const child = childVm.task;

    (childVm.resources || []).forEach(resource => {
        const avatar = document.createElementNS(XHTML_NS, 'span');
        avatar.setAttribute('class', 'wb-note-row-avatar');
        avatar.textContent = wbGetInitials(resource);
        avatar.title = resource;
        row.appendChild(avatar);
    });

    const bubble = document.createElementNS(XHTML_NS, 'button');
    bubble.setAttribute('type', 'button');
    bubble.setAttribute('class', 'wb-note-assign-bubble');
    bubble.setAttribute('aria-haspopup', 'menu');
    bubble.setAttribute('aria-expanded', 'false');
    bubble.textContent = '+';
    bubble.title = `Assign a resource to "${child.name}"`;
    bubble.setAttribute('aria-label', `Assign a resource to ${child.name}`);
    bubble.addEventListener('click', (e) => {
        e.stopPropagation();
        wbToggleAssignMenu(child.name, bubble);
    });
    row.appendChild(bubble);
}

/**
 * "Add task..." row (issue #1104, part of epic #1090): an always-present,
 * empty checklist row at the bottom of every checklist note's body, so a
 * new child task can be typed in and committed on the spot -- previously
 * the only ways to add one were dragging a noodle from another note in,
 * editing the outline/markdown by hand, or (only for a still-freeform
 * note -- see wbIsFreeformNote()) "Promote to task"'s prompt(). Styled
 * like an ordinary .wb-note-row (same padding/hover rhythm, views/
 * whiteboard.css) but with a "+" glyph where a checkbox would sit and a
 * borderless text <input> where the name would sit, so it reads as one
 * more slot rather than a form bolted onto the card. Only ever appended
 * for a checklist note (wbUpdateNoteNode() gates this on `!freeform`) --
 * a free-form note keeps #885's "nothing prompts for detail" and gains
 * this row automatically the moment it earns its first child, on the very
 * next render pass, same as the rest of #1015's split.
 *
 * Deliberately its own `.wb-note-add-row` class rather than sharing
 * `.wb-note-row` (views/whiteboard.css gives it the identical padding/
 * layout rhythm on its own): several existing call sites -- both here
 * (peek/menu wiring) and in tests -- find a real child row via
 * `.wb-note-row` then assume `.wb-note-row-name` exists on it; sharing the
 * class would make this placeholder row match that query too and break
 * every one of them the moment a checklist note (i.e. almost any of them)
 * renders it.
 */
function wbBuildAddChildRow(taskName) {
    const row = document.createElementNS(XHTML_NS, 'div');
    row.setAttribute('class', 'wb-note-add-row');

    const icon = document.createElementNS(XHTML_NS, 'span');
    icon.setAttribute('class', 'wb-note-add-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '+';
    row.appendChild(icon);

    const input = document.createElementNS(XHTML_NS, 'input');
    input.setAttribute('type', 'text');
    input.setAttribute('class', 'wb-note-add-input');
    input.setAttribute('placeholder', 'Add task…');
    input.setAttribute('aria-label', `Add a task under "${taskName}"`);
    row.appendChild(input);

    // Clicking anywhere on the row -- the "+" glyph, the row's own
    // padding, not just the input itself -- focuses the input, matching
    // how the ordinary child rows above treat their whole row as the
    // click target rather than just the name text.
    row.addEventListener('click', (e) => { e.stopPropagation(); input.focus(); });

    // Never let a click into the input bubble up to the row-drag / note-
    // select handlers a click on the card would otherwise trigger.
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // canvas shortcuts (n/t/+/-/arrows/...) must not fire while typing
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const typed = input.value;
        input.value = '';
        if (wbAddChecklistItem(taskName, typed)) {
            wbFocusAddRowWhenReady(taskName, input);
        }
    });

    return row;
}

/**
 * Poll briefly for `taskName`'s own "Add task..." row after a commit-
 * triggered re-render and refocus its input, so typing several checklist
 * items in a row is one continuous gesture rather than a click per item.
 * Needed because wbCommitMarkdown()'s renderText() is async and tears
 * down/rebuilds the note's whole body (wbUpdateNoteNode()), which
 * destroys the very input the Enter keypress came from -- same "commit is
 * async, poll rather than guess a delay" shape as wbCreateNoteAt()'s and
 * wbCreateTextObjectAt()'s own focusWhenReady() helpers. Gives up quietly
 * (no focus, no error) if the note or its add-row never reappears -- e.g.
 * something else removed the note from the board in the same tick.
 * Budget is generous (3s) because renderText() awaits a full re-render
 * (baseline/forecast/escalation views included), which can be slow under
 * load -- a short budget risks giving up before a real, finite render
 * finishes rather than racing a hang.
 */
function wbFocusAddRowWhenReady(taskName, previousInput = null, attempts = 0) {
    const entry = wbNoteNodes.get(taskName);
    const input = (entry && entry.refs && entry.refs.body)
        ? entry.refs.body.querySelector('.wb-note-add-input')
        : null;
    if (input && input !== previousInput) { input.focus(); return; }
    if (attempts < 60) setTimeout(() => wbFocusAddRowWhenReady(taskName, previousInput, attempts + 1), 50);
}

/**
 * Add one new child task under `taskName`, typed into that note's own
 * "Add task..." row (issue #1104, wbBuildAddChildRow() above). Reuses
 * exactly the primitive "Promote to task" (#1020's wbPromoteFreeformNote())
 * already uses: wbSanitiseChildTaskName() (the same defence against
 * embedded newlines/quotes that an untrusted comment or prompt() answer
 * already gets), wbUniqueTaskName() so a duplicate typed name can't
 * collide with an existing task, wbAppendChildTask() (whiteboard-
 * structure.js) to write the line as this task's last child -- the exact
 * same insertion point a noodle drop or a promotion would use -- and
 * wbCommitMarkdown() to push the result through #planEditor in one write.
 * A checklist item added this way is therefore indistinguishable in the
 * outline from one added any other way: the same summary/parent rules
 * apply (this task simply gains a child, exactly as a noodle drop or a
 * promotion would leave it) and it round-trips through markdown
 * identically. One wbCommitMarkdown() call, so it is a single undo step
 * like every other whiteboard mutation.
 *
 * Returns false -- a no-op, nothing written -- for blank/whitespace-only
 * text, or a `taskName` no longer found in the outline (wbAppendChildTask()
 * returns the plan text unchanged in that case, which wbCommitMarkdown()
 * then also no-ops on): matches this file's existing "nothing typed ->
 * nothing happens" convention (wbPromoteFreeformNote()'s prompt(),
 * kanban.js's addNewPhase()).
 */
function wbAddChecklistItem(taskName, rawText) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName) return false;
    if (typeof wbAppendChildTask !== 'function' || typeof wbUniqueTaskName !== 'function' ||
        typeof wbOutlineTaskNames !== 'function' || typeof wbSanitiseChildTaskName !== 'function') {
        return false;
    }

    const childName = wbSanitiseChildTaskName(rawText);
    if (!childName) return false;

    const planText = editor.value;
    const uniqueChildName = wbUniqueTaskName(wbOutlineTaskNames(planText), childName);

    const nextText = wbAppendChildTask(planText, taskName, uniqueChildName);
    return wbCommitMarkdown(nextText);
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

    // The dispatch above also schedules editor.js's own 1s debounced
    // auto-render (its 'input' listener does that unconditionally) -- on
    // top of the immediate renderText() call below, that leaves a second,
    // redundant render pending a second from now, which tears down and
    // rebuilds view DOM this function's callers already finished with
    // (e.g. a checklist add-row's caller focuses its freshly-rendered
    // input right after this returns -- the debounced re-render a second
    // later would silently steal that focus back off it). Cancel it: the
    // immediate render below already reflects nextText, so there is
    // nothing left for a later render of the same text to usefully do.
    if (typeof editor._cancelPendingRender === 'function') editor._cancelPendingRender();

    if (typeof renderText === 'function') {
        Promise.resolve(renderText()).catch(error => {
            console.error('Whiteboard note update render failed:', error);
        });
    }
    return true;
}

function wbCloseSmartMenu() {
    if (!wbSmartMenuState) return;
    const { popup, trigger } = wbSmartMenuState;
    if (popup && popup.parentNode) popup.remove();
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    wbSmartMenuState = null;
    document.removeEventListener('mousedown', wbSmartMenuOutsideClick, true);
    document.removeEventListener('keydown', wbSmartMenuEscape, true);
}

function wbSmartMenuOutsideClick(event) {
    if (!wbSmartMenuState) return;
    if (wbSmartMenuState.popup.contains(event.target) || wbSmartMenuState.trigger.contains(event.target)) return;
    wbCloseSmartMenu();
}

function wbSmartMenuEscape(event) {
    if (event.key !== 'Escape' || !wbSmartMenuState) return;
    const trigger = wbSmartMenuState.trigger;
    wbCloseSmartMenu();
    if (trigger) trigger.focus();
}

function wbOpenSmartMenu(taskName, trigger, popup) {
    wbCloseSmartMenu();
    if (wbCoachingMenuState) wbCloseCoachingMenu();
    document.body.appendChild(popup);
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(240, popup.offsetWidth || 0);
    popup.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`;
    popup.style.top = `${Math.max(8, Math.min(window.innerHeight - popup.offsetHeight - 8, rect.bottom + 6))}px`;
    trigger.setAttribute('aria-expanded', 'true');
    wbSmartMenuState = { taskName, trigger, popup };
    setTimeout(() => {
        document.addEventListener('mousedown', wbSmartMenuOutsideClick, true);
        document.addEventListener('keydown', wbSmartMenuEscape, true);
    }, 0);
}

function wbToggleDateMenu(taskName, suggestion, trigger) {
    if (wbSmartMenuState && wbSmartMenuState.taskName === taskName && wbSmartMenuState.popup.classList.contains('wb-date-menu')) {
        wbCloseSmartMenu();
        return;
    }
    const popup = document.createElement('section');
    popup.className = 'wb-smart-menu wb-date-menu';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', `Attach ${suggestion.raw} to ${taskName}`);
    const heading = document.createElement('strong');
    heading.textContent = `${suggestion.raw} → ${suggestion.date}`;
    popup.appendChild(heading);
    const copy = document.createElement('p');
    copy.textContent = 'What kind of date is this?';
    popup.appendChild(copy);
    const choices = [
        ['start', 'Start'], ['finish', 'Finish'], ['milestone', 'Milestone'], ['deadline', 'Deadline'],
    ];
    const buttons = document.createElement('div');
    buttons.className = 'wb-date-choices';
    for (const [kind, label] of choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.dateKind = kind;
        button.textContent = label;
        button.addEventListener('click', () => {
            wbCommitMarkdown(wbApplyDateChoiceToPlanText(wbLastPlanText, taskName, kind, suggestion.date));
            wbCloseSmartMenu();
        });
        buttons.appendChild(button);
    }
    popup.appendChild(buttons);
    wbOpenSmartMenu(taskName, trigger, popup);
}

function wbTaskHasResource(taskName, shortname) {
    if (typeof NoodlePlanModel === 'undefined') return false;
    const model = NoodlePlanModel.PlanModel.parse(wbLastPlanText);
    const task = model.tasks.find(node => String(node.name || '').toLowerCase() === String(taskName || '').toLowerCase());
    if (!task) return false;
    return TaskLineTokenizer.metadata(task.content).values.resources
        .some(value => value.toLowerCase() === String(shortname).toLowerCase());
}

function wbToggleResourceMenu(taskName, trigger) {
    if (wbSmartMenuState && wbSmartMenuState.taskName === taskName && wbSmartMenuState.popup.classList.contains('wb-resource-menu')) {
        wbCloseSmartMenu();
        return;
    }
    const popup = document.createElement('section');
    popup.className = 'wb-smart-menu wb-resource-menu';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', `Assign resources to ${taskName}`);
    const heading = document.createElement('strong');
    heading.textContent = 'Quick assign';
    popup.appendChild(heading);
    const resources = wbResourceOptionsFromPlanText(wbLastPlanText);
    if (!resources.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No resources in plan front matter.';
        popup.appendChild(empty);
    }
    for (const resource of resources) {
        const assigned = wbTaskHasResource(taskName, resource.shortname);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wb-resource-choice';
        button.setAttribute('aria-pressed', assigned ? 'true' : 'false');
        button.textContent = `${assigned ? '✓ ' : ''}${resource.name}`;
        button.title = resource.role ? `${resource.name} — ${resource.role}` : resource.name;
        button.addEventListener('click', () => {
            wbCommitMarkdown(wbApplyResourceToPlanText(wbLastPlanText, taskName, resource.shortname, !assigned));
            wbCloseSmartMenu();
        });
        popup.appendChild(button);
    }
    wbOpenSmartMenu(taskName, trigger, popup);
}

// ── Contextual facilitator menu (issue #875) ──────────────────────────

function wbCloseCoachingMenu() {
    if (!wbCoachingMenuState) return;
    const { popup, trigger } = wbCoachingMenuState;
    if (popup && popup.parentNode) popup.remove();
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    wbCoachingMenuState = null;
    document.removeEventListener('mousedown', wbCoachingOutsideClick, true);
    document.removeEventListener('keydown', wbCoachingEscape, true);
}

function wbCoachingOutsideClick(event) {
    if (!wbCoachingMenuState) return;
    if (wbCoachingMenuState.popup.contains(event.target) || wbCoachingMenuState.trigger.contains(event.target)) return;
    wbCloseCoachingMenu();
}

function wbCoachingEscape(event) {
    if (event.key !== 'Escape' || !wbCoachingMenuState) return;
    const trigger = wbCoachingMenuState.trigger;
    wbCloseCoachingMenu();
    if (trigger) trigger.focus();
}

function wbToggleCoachingMenu(taskName, trigger) {
    if (wbCoachingMenuState && wbCoachingMenuState.taskName === taskName) {
        wbCloseCoachingMenu();
        return;
    }
    wbCloseCoachingMenu();
    const task = wbLastTasks.find(item => item && item.name === taskName);
    if (!task) return;

    const popup = document.createElement('section');
    popup.className = 'wb-coaching-menu';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', `Planning prompts for ${taskName}`);

    const heading = document.createElement('strong');
    heading.textContent = taskName;
    popup.appendChild(heading);

    const hint = wbActivityLanguageHint(taskName);
    if (hint && !wbTaskPlanningType(task)) {
        const question = document.createElement('p');
        question.className = 'wb-coaching-hint';
        question.textContent = 'This looks like something you are doing rather than something you are making. Is the real deliverable the thing it produces?';
        popup.appendChild(question);
    }

    const typeRow = document.createElement('div');
    typeRow.className = 'wb-coaching-types';
    const currentType = wbTaskPlanningType(task);
    for (const type of ['product', 'activity']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = type === 'product' ? 'Product' : 'Activity';
        button.classList.toggle('selected', currentType === type);
        button.addEventListener('click', () => {
            const nextType = currentType === type ? null : type;
            wbCommitMarkdown(wbApplyPlanningTypeToPlanText(wbLastPlanText, taskName, nextType));
            wbCloseCoachingMenu();
        });
        typeRow.appendChild(button);
    }
    popup.appendChild(typeRow);

    const promptHeading = document.createElement('span');
    promptHeading.className = 'wb-coaching-label';
    promptHeading.textContent = 'Ask a useful question';
    popup.appendChild(promptHeading);

    const prompts = [
        { label: 'Does this need approval?', relation: 'predecessor', suggested: `Approval for ${taskName}` },
        { label: 'What does this produce?', relation: 'successor', suggested: `${taskName} output` },
        { label: 'What must be true before this can start?', relation: 'predecessor', suggested: `${taskName} prerequisite` },
    ];
    for (const item of prompts) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wb-coaching-prompt';
        button.textContent = item.label;
        button.addEventListener('click', () => {
            wbCloseCoachingMenu();
            wbSpawnCoachingNote(taskName, item.relation, item.suggested);
        });
        popup.appendChild(button);
    }

    const owner = document.createElement('button');
    owner.type = 'button';
    owner.className = 'wb-coaching-prompt';
    owner.textContent = 'Who owns it?';
    owner.addEventListener('click', () => {
        wbCloseCoachingMenu();
        wbOpenChildTask(taskName);
        setTimeout(() => {
            const field = document.getElementById('taskResources');
            if (field) field.focus();
        }, 0);
    });
    popup.appendChild(owner);

    document.body.appendChild(popup);
    const rect = trigger.getBoundingClientRect();
    const width = 300;
    popup.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`;
    popup.style.top = `${Math.min(window.innerHeight - popup.offsetHeight - 8, rect.bottom + 6)}px`;
    trigger.setAttribute('aria-expanded', 'true');
    wbCoachingMenuState = { taskName, trigger, popup };
    setTimeout(() => {
        document.addEventListener('mousedown', wbCoachingOutsideClick, true);
        document.addEventListener('keydown', wbCoachingEscape, true);
    }, 0);
}

function wbBoardRowForTaskOrAncestor(items, taskName) {
    let current = wbLastTasks.find(task => task && task.name === taskName);
    while (current) {
        const row = items.find(item => item && item.task && item.task.toLowerCase() === current.name.toLowerCase());
        if (row) return row;
        current = current.parent
            ? wbLastTasks.find(task => task && task.name === current.parent)
            : null;
    }
    return null;
}

/** Turn one facilitator answer into a real task and scheduling edge, and
 * place its new post-it beside the note that prompted it. */
function wbSpawnCoachingNote(sourceTaskName, relation, suggestedName) {
    const editor = document.getElementById('planEditor');
    if (!editor || typeof wbAppendTopLevelTask !== 'function') return null;
    const answer = prompt('Name the new linked note:', suggestedName || 'New note');
    if (!answer || !answer.trim()) return null;
    const existingNames = typeof wbOutlineTaskNames === 'function'
        ? wbOutlineTaskNames(editor.value)
        : wbLastTasks.map(task => task && task.name).filter(Boolean);
    const name = wbUniqueTaskName(existingNames, answer.trim().replace(/[\r\n]+/g, ' '));
    let nextText = wbAppendTopLevelTask(editor.value, name);
    nextText = relation === 'successor'
        ? wbAddNamedDependencyToPlanText(nextText, name, sourceTaskName)
        : wbAddNamedDependencyToPlanText(nextText, sourceTaskName, name);

    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(nextText));
    const source = wbBoardRowForTaskOrAncestor(items, sourceTaskName);
    const width = WB_NOTE_DEFAULT_WIDTH;
    const height = WB_NOTE_DEFAULT_HEIGHT;
    let x = source ? (source.x || 0) + (relation === 'successor' ? width + 60 : -width - 60) : 80;
    let y = source ? (source.y || 0) : 80;
    const wanted = { x, y, width, height };
    if (items.some(item => wbRectsOverlap(wanted, {
        x: item.x || 0, y: item.y || 0,
        width: item.width || WB_NOTE_DEFAULT_WIDTH,
        height: item.height || WB_NOTE_DEFAULT_HEIGHT,
    }, 8)) && typeof wbFindFreeSpacePosition === 'function' && typeof wbCurrentViewportBoardRect === 'function') {
        const free = wbFindFreeSpacePosition(items.map(item => ({
            x: item.x || 0, y: item.y || 0,
            width: item.width || WB_NOTE_DEFAULT_WIDTH,
            height: item.height || WB_NOTE_DEFAULT_HEIGHT,
        })), wbCurrentViewportBoardRect(), width, height);
        if (free) { x = free.x; y = free.y; }
    }
    items.push({ task: name, x: Math.round(x), y: Math.round(y), colour: '', width, height, collapsed: false });
    wbCommitMarkdown(updatePlanWhiteboardText(nextText, items));
    return name;
}

// ── Quick resource-assign bubble (issue #1162, part of epic #878) ───────
//
// A child row's own resource list, not the summary task's -- see
// wbBuildNoteViewModel()'s `resources` addition above. Follows
// wbToggleChildComplete()'s exact commit shape: findTaskLineNumber()
// locates the child's own markdown line (it need not have a whiteboard
// row of its own -- it is only ever shown as a row *inside* this note's
// body), a small pure line-rewriter adds the `@shortname` token, and
// wbCommitMarkdown() pushes the result through #planEditor like every
// other whiteboard mutation.
//
// The resource *list* offered is getAllResourceNames() (script.js) -- the
// exact same list the task-details form's own resource field draws from
// -- which is the "reusing the task details form['s] resource-assignment
// logic" #878 asks for. Writing the chosen name onto the line is its own
// small, free-standing tokenizer rather than a call through
// `window.kanbanBoard.addResourceToTaskLine()` (kanban.js already has an
// equivalent method): that singleton is only ever constructed once the
// Kanban view has been opened this session, and this bubble must work on
// the whiteboard whether or not Kanban has ever been visible.

/**
 * Add `@shortname` to a task line -- mirrors kanban.js's
 * KanbanBoard.addResourceToTaskLine() exactly (see that method for the
 * same logic used by the boards view's own drag-drop resource assignment).
 */
function wbAddResourceToLine(line, shortname) {
    const trimmed = line.trim();
    const indent = (line.match(/^(\s*)/) || ['', ''])[1];

    if (trimmed.includes('@')) {
        return line.replace(/(@\w+(?:\s+@\w+)*)/, `$1 @${shortname}`);
    }

    const tokens = trimmed.split(/\s+/);
    let insertIndex = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.startsWith('*')) { insertIndex = i + 1; continue; }
        if (token.startsWith('@') || token.startsWith('#') || /^\d+[dwmy]$/.test(token) ||
            /^\d+%$/.test(token) || /^\d{4}-\d{2}-\d{2}$/.test(token) || token.startsWith('"')) {
            break;
        }
        insertIndex = i + 1;
    }
    tokens.splice(insertIndex, 0, `@${shortname}`);
    return indent + tokens.join(' ');
}

/** Write `shortname` onto `childTaskName`'s own line and commit. */
function wbAssignResourceToChild(childTaskName, shortname) {
    const editor = document.getElementById('planEditor');
    if (!editor || !shortname) return false;
    if (typeof findTaskLineNumber !== 'function') return false;

    const lineNumber = findTaskLineNumber({ name: childTaskName });
    if (lineNumber === -1) return false;

    const lines = editor.value.split('\n');
    const line = lines[lineNumber - 1];
    if (!line && line !== '') return false;

    lines[lineNumber - 1] = wbAddResourceToLine(line, shortname);
    return wbCommitMarkdown(lines.join('\n'));
}

/**
 * Build the assign bubble's dropdown: every plan resource
 * (getAllResourceNames(), script.js) not already assigned to `taskName`,
 * each a clickable menuitem -- reuses `.wb-note-menu`/`.wb-note-menu-list`/
 * `.wb-note-menu-action` as-is (see views/whiteboard.css's note on that
 * section) rather than a second popup skin, since this is the exact same
 * "single floating list, appended to document.body" shape as the note's
 * own `...` menu (wbBuildNoteMenu()).
 */
function wbBuildAssignMenu(taskName) {
    const menu = document.createElement('div');
    menu.id = 'wbAssignMenu';
    menu.className = 'wb-note-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Assign a resource to ${taskName}`);

    const list = document.createElement('ul');
    list.className = 'wb-note-menu-list';
    menu.appendChild(list);

    const key = String(taskName).toLowerCase();
    const task = (wbLastTasks || []).find(t => t && String(t.name).toLowerCase() === key);
    const assigned = new Set(wbResourceList(task && task.resources).map(r => r.toLowerCase()));
    const allNames = (typeof getAllResourceNames === 'function') ? getAllResourceNames() : [];
    const available = allNames.filter(name => !assigned.has(String(name).toLowerCase()));

    if (!available.length) {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.className = 'wb-note-menu-empty';
        span.textContent = allNames.length ? 'All resources already assigned' : 'No resources defined yet';
        li.appendChild(span);
        list.appendChild(li);
        return menu;
    }

    available.forEach(name => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wb-note-menu-action';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = name;
        btn.setAttribute('aria-label', `Assign ${name} to ${taskName}`);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            wbCloseAssignMenu();
            wbAssignResourceToChild(taskName, name);
        });
        li.appendChild(btn);
        list.appendChild(li);
    });

    return menu;
}

/** Single-slot popup state, mirrors wbNoteMenuState. */
let wbAssignMenuState = null;

/** Toggle the assign menu for `taskName`: closes it if already open for
 * this same task, otherwise opens (re-rooting if a different task's menu
 * was open) -- mirrors wbTogglePeekFor()'s own open/close toggle. */
function wbToggleAssignMenu(taskName, anchorEl) {
    if (wbAssignMenuState && wbAssignMenuState.taskName === taskName) {
        wbCloseAssignMenu();
        return;
    }
    wbOpenAssignMenu(taskName, anchorEl);
}

/** Open the assign menu, positioned/clamped exactly like wbOpenNoteMenu()
 * (reuses wbNoteMenuSafeBounds() as-is). */
function wbOpenAssignMenu(taskName, btn) {
    wbCloseAssignMenu();
    wbCloseNoteMenu();

    const menu = wbBuildAssignMenu(taskName);
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
    wbAssignMenuState = { taskName, btn };

    document.addEventListener('mousedown', wbAssignMenuOutsideClick, true);
    document.addEventListener('keydown', wbAssignMenuKeydown, true);

    const first = menu.querySelector('[role="menuitem"]');
    if (first) first.focus();
}

function wbCloseAssignMenu() {
    const menu = document.getElementById('wbAssignMenu');
    if (menu) menu.remove();
    document.removeEventListener('mousedown', wbAssignMenuOutsideClick, true);
    document.removeEventListener('keydown', wbAssignMenuKeydown, true);
    if (wbAssignMenuState && wbAssignMenuState.btn) {
        wbAssignMenuState.btn.setAttribute('aria-expanded', 'false');
    }
    wbAssignMenuState = null;
}

function wbAssignMenuOutsideClick(e) {
    const menu = document.getElementById('wbAssignMenu');
    if (!menu) return;
    if (menu.contains(e.target)) return;
    if (wbAssignMenuState && wbAssignMenuState.btn && wbAssignMenuState.btn.contains(e.target)) return;
    wbCloseAssignMenu();
}

function wbAssignMenuKeydown(e) {
    const menu = document.getElementById('wbAssignMenu');
    if (!menu) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        const btn = wbAssignMenuState && wbAssignMenuState.btn;
        wbCloseAssignMenu();
        if (btn) btn.focus();
        return;
    }

    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(index + 1 + items.length) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
    }
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
    wbAppendPromoteMenuSection(list, taskName);
    wbAppendOpenTaskMenuSection(list, taskName);
    wbAppendParkMenuSection(list, taskName);
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
 * Append issue #1020's entire contribution to the note menu: a single
 * "Promote to task" action, shown only for a free-form note (checked via
 * wbHasChildren() directly rather than building a full view model just for
 * this -- equivalent to wbIsFreeformNote(), see that predicate's own doc
 * comment) -- a note that already has a child is already a checklist, and
 * offering to "promote" it a second time would be a confusing no-op.
 */
function wbAppendPromoteMenuSection(list, taskName) {
    if (wbHasChildren(wbLastTasks, taskName)) return;

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-note-menu-promote';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = 'Promote to task';
    btn.title = "Turn this note's comment into a real child task";
    btn.setAttribute('aria-label', `Promote ${taskName} to a task`);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbPromoteFreeformNote(taskName);
    });
    li.appendChild(btn);
    list.appendChild(li);
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
 * Append issue #1019's entire contribution to the note menu: a divider
 * followed by a single "Send to parking lot" action -- the "good idea,
 * not now" counterpart to Remove/Delete just below it, set apart with its
 * own divider so it doesn't read as a third flavour of the same
 * destructive group. Styled with the same neutral `.wb-note-menu-action`
 * look as Rename/Unlink/Open task details above (not
 * `.wb-note-menu-remove`'s red): parking an idea is not destructive, it
 * relocates the text (see wbSendNoteToParkingLot()'s own doc comment).
 */
function wbAppendParkMenuSection(list, taskName) {
    const dividerLi = document.createElement('li');
    dividerLi.className = 'wb-note-menu-divider';
    dividerLi.setAttribute('role', 'separator');
    list.appendChild(dividerLi);

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-note-menu-action';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = 'Send to parking lot';
    btn.title = 'Not ready yet? Park this idea -- it leaves the board and the plan, but its text is kept in the parking lot';
    btn.setAttribute('aria-label', `Send ${taskName} to the parking lot`);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbSendNoteToParkingLot(taskName);
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

/**
 * The ribbon's whiteboard "Colour" toolbar button (issue #1109) --
 * previously an unwired stub (ribbon.js's resolveAction() had no entry
 * for it, so clicking it just showed "not available yet"). Opens the
 * exact same `...` menu a note's own button opens -- colour swatches
 * first, see wbBuildNoteMenu() -- for whichever note is currently
 * selected (wbGetSelectedNoteTask(), set by wbRaiseNoteToFront() on every
 * drag/resize/tap), so picking a colour goes through the one existing,
 * already-tested commit path (wbHandleNoteColourPick()) rather than a
 * second one. A note that's been drilled deep into via its task-peek
 * popover is still *this* note -- peeking a child never changes which
 * note is selected, so the colour always lands on the summary task's own
 * post-it, never on a child that has no post-it of its own.
 *
 * With nothing selected, explains what to do (per the issue's own
 * "disabled, or explain what to select" acceptance criterion) rather than
 * silently doing nothing.
 */
function wbOpenColourPanelForSelectedNote(anchorEl) {
    const taskName = wbGetSelectedNoteTask();
    if (!taskName) {
        if (typeof wbFlashNoodleMessage === 'function') {
            wbFlashNoodleMessage('Select a note first, then click Colour to change it');
        }
        return;
    }
    const entry = wbNoteNodes.get(taskName);
    const btn = (anchorEl && anchorEl.nodeType === 1) ? anchorEl : (entry && entry.refs && entry.refs.menuBtn);
    if (!btn) return;
    wbOpenNoteMenu(taskName, btn);
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

/** Apply one layout mode to all note rows and commit as one edit. */
function wbCommitLayout(mode, options = {}) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor ||
        typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return false;
    }

    const planText = editor.value;
    const section = extractWhiteboardFromPlanText(planText);
    const items = parseWhiteboardMarkdown(section);
    if (!items.some(item => item && item.task)) return false;

    const viewport = (typeof wbCurrentViewportBoardRect === 'function') ? wbCurrentViewportBoardRect() : null;
    const tasks = (wbLastTasks && wbLastTasks.length)
        ? wbLastTasks
        : ((typeof lastRenderedTasks !== 'undefined' && Array.isArray(lastRenderedTasks)) ? lastRenderedTasks : []);
    const nextItems = wbLayoutRows(items, tasks, mode, {
        ...options,
        viewportRect: viewport || options.viewportRect,
    });

    const nextText = updatePlanWhiteboardText(planText, nextItems);
    return wbCommitMarkdown(nextText);
}

/** Tidy up notes into a uniform grid with standard-size cards. */
function wbLayoutTidyNotes() {
    return wbCommitLayout('tidy', {
        gap: WB_LAYOUT_GAP_DEFAULT,
        standardSize: true,
        width: WB_NOTE_DEFAULT_WIDTH,
        height: WB_NOTE_DEFAULT_HEIGHT,
    });
}

/** Arrange notes by plan hierarchy, with top-level summaries in columns. */
function wbLayoutHierarchyView() {
    return wbCommitLayout('hierarchy', { gap: WB_LAYOUT_GAP_DEFAULT });
}

/** Tight spacing between notes. */
function wbLayoutCompact() {
    return wbCommitLayout('compact', { gap: WB_LAYOUT_GAP_COMPACT });
}

/** Spacious spacing between notes. */
function wbLayoutComfy() {
    return wbCommitLayout('comfy', { gap: WB_LAYOUT_GAP_COMFY });
}

/** Left-to-right dependency flow layout. */
function wbLayoutFlowView() {
    return wbCommitLayout('flow', { gap: WB_LAYOUT_GAP_DEFAULT });
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
 * Insert a brand-new, top-level, bare task line named `taskName` at the end
 * of the plan's task outline -- i.e. after every existing outline line but
 * before the first back-matter section marker (Highlights, Budget,
 * Benefits, RAID log, Comms, Lessons learned, Baseline, Whiteboard --
 * the same marker list extractWhiteboardFromPlanText()/
 * updatePlanWhiteboardText() scan for), so the new task lands inside the
 * outline itself rather than inside, or after, some other back-matter
 * section.
 *
 * Deliberately just the one line, no placeholder child: this used to also
 * write a "New Task" placeholder (2-space indented) underneath, so the
 * outline parser (engine/scheduler.js buildTasks(), which only classifies
 * a task as a summary once it *has* a child) would treat the new line as a
 * summary task immediately. Issue #1015 removed that -- a childless task
 * is exactly a free-form note's natural backing (see wbIsFreeformNote()
 * and this file's header comment), and forcing an immediate child was
 * exactly the kind of premature structure #885 asks new notes not to
 * impose. This now matches wbAppendTopLevelTask() (whiteboard-structure.js),
 * the other new-note path (canvas double-click / `n` / "New post-it"): both
 * write a bare leaf, so a note is free-form until the user gives it its
 * first child, whichever creation path made it.
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

    // A blank-line separator before the new line (when there's existing
    // outline content to separate it from) matches how top-level
    // phases/sections are conventionally spaced in a plan's outline (see
    // e.g. SAMPLE_PLAN in tests/test_whiteboard_board_membership.py) --
    // the new task reads as its own top-level entry, not a continuation
    // of whatever came before it.
    let result = before ? before + '\n\n' + name : name;
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
    // render that never happens must not leave a dangling timer. Budget is
    // generous (3s) because renderText() awaits a full re-render
    // (baseline/forecast/escalation views included), which can be slow
    // under load.
    let attempts = 0;
    const focusWhenReady = () => {
        const entry = wbNoteNodes.get(name);
        if (entry) { wbBeginTitleEdit(entry); return; }
        if (++attempts < 60) setTimeout(focusWhenReady, 50);
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
 * the toolbar's "New post-it" and "Text note" buttons (#1107 -- the latter
 * is a second entry point onto this exact same free-form note, grouped
 * with the other bare-canvas-object buttons; see index.html's comment by
 * #whiteboardTextNoteBtn), the ribbon's Whiteboard tab "Note" button
 * (#1107, ribbon.js's 'whiteboard:Note'), and the `n` keyboard shortcut. */
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
        // The selected note (if any) is tracked by name too -- keep it
        // pointing at the same note through the rename (issue #1109's
        // toolbar Colour button reads this to know which note to act on).
        if (wbSelectedNoteTask === oldName) wbSelectedNoteTask = newName;
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
 * "Promote to task" (issue #1020, part of #885): turn a free-form note's
 * loose `comment` text into a real child task, in one commit. Per #1015's
 * already-landed free-form/checklist split, a note's own task is already a
 * real outline task -- what a free-form note is missing is *structure*, so
 * promotion's whole job is materialising the comment as a genuine child
 * task line (wbAppendChildTask(), whiteboard-structure.js), which is
 * exactly what flips wbIsFreeformNote() to false and switches the note to
 * checklist rendering on the very next render pass. No new rendering code
 * needed here -- see this file's header comment on #1015 for why.
 *
 * Source text is the task's own comment if it has one; otherwise (a
 * genuinely blank free-form note) a `prompt()` asks for a name, matching
 * this file's own prompt() convention elsewhere (see kanban.js's
 * addNewPhase() for the same "cancelled or blank -> silent no-op" shape).
 * Either way the text is run through wbSanitiseChildTaskName() (embedded
 * newlines/quotes stripped, length-capped) and, since outline task names
 * are expected to be unique (wbRenameNoteTask() above refuses a clash for
 * the same reason), disambiguated against every existing task name via
 * wbUniqueTaskName() before being written.
 *
 * Only ever called for a free-form note (the menu item that calls this is
 * itself only shown when wbIsFreeformNote() is true -- see
 * wbAppendPromoteMenuSection() below), but re-checked here too since this
 * is also the function tests exercise directly.
 */
function wbPromoteFreeformNote(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName) return false;
    if (typeof wbAppendChildTask !== 'function' || typeof wbUniqueTaskName !== 'function' ||
        typeof wbOutlineTaskNames !== 'function') {
        return false;
    }

    const task = (wbLastTasks || []).find(t => t && t.name === taskName);
    if (!task || wbHasChildren(wbLastTasks, taskName)) return false;

    let source = String(task.comment || '').trim();
    if (!source) {
        const typed = (typeof prompt === 'function')
            ? prompt(`Name the first task under "${taskName}":`, '')
            : null;
        if (typed == null) return false; // cancelled
        source = typed.trim();
        if (!source) return false;
    }

    const childName = wbSanitiseChildTaskName(source);
    if (!childName) return false;

    const planText = editor.value;
    const uniqueChildName = wbUniqueTaskName(wbOutlineTaskNames(planText), childName);

    const nextText = wbAppendChildTask(planText, taskName, uniqueChildName);
    return wbCommitMarkdown(nextText);
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

/** Today's date as YYYY-MM-DD, local time -- matches every other date
 * field this app writes into plan text (front matter's `last_saved`,
 * highlights headings, etc). */
function wbTodayIsoDate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The text a parked item carries into the ---parking lot--- section: the
 * note's title, plus its free-form comment (issue #1015's `!"text"` body)
 * if it had one -- everything a "Delete task" confirmation would otherwise
 * throw away, folded into one line (the parking lot table, like every
 * other back-matter table here, is one row per item). A checklist note
 * (`tasks` given and the task has children) instead notes its item count,
 * since a checklist's comment is rarely set and its children are the
 * whole point -- the full per-item list rides in the row's `detail`
 * instead (see wbBuildParkedItemDetail()), this is just the flat-text
 * fallback every plain list view (and every plan written before #1110)
 * still reads. */
function wbBuildParkedItemText(taskName, task, tasks) {
    const name = String(taskName || '').trim();
    const comment = (task && task.comment) ? String(task.comment).trim() : '';
    const childCount = tasks ? wbChildCount(tasks, taskName) : 0;
    if (childCount > 0) {
        const suffix = `${childCount} item${childCount === 1 ? '' : 's'}`;
        return comment ? `${name} — ${suffix} — ${comment}` : `${name} — ${suffix}`;
    }
    return comment ? `${name} — ${comment}` : name;
}

/**
 * Build the full detail snapshot (issue #1110) a parked item's `detail`
 * field carries alongside its flat `text` -- everything "Send to parking
 * lot" would otherwise lose beyond the flat line above: the note's exact
 * title, its fully-resolved colour (row Colour -> Theme: entry -> derived
 * palette -- see wbResolveNoteColour()'s header comment; a note is never
 * uncoloured, so this is never empty), its own free-form comment if it
 * has one, and -- for a checklist note -- every direct child's name and
 * completion state (a leaf's own `percent`, mirroring wbIsChildComplete()
 * exactly, so "done" here can never disagree with the checkbox the note
 * itself showed). `comment` and `checklist` are omitted entirely when
 * empty, keeping a freeform note's detail and a checklist note's detail
 * from carrying a stray empty field the other shape has no use for.
 */
function wbBuildParkedItemDetail(taskName, task, tasks) {
    const name = String(taskName || '').trim();
    const comment = (task && task.comment) ? String(task.comment).trim() : '';
    const children = wbDirectChildren(tasks, taskName);

    const detail = {
        title: name,
        colour: wbCurrentNoteColour(taskName),
    };
    if (comment) detail.comment = comment;
    if (children.length) {
        detail.checklist = children.map(child => ({
            name: String((child && child.name) || '').trim(),
            done: wbIsChildComplete(child),
        }));
    }
    return detail;
}

/**
 * Send a note to the parking lot (issue #1019): the "good idea, not now"
 * counterpart to "Remove from board"/"Delete task". A parked idea is, by
 * the issue's own framing, meant to genuinely leave the working plan --
 * not just come off the board -- so this deletes the task (subtree and
 * all, same as wbDeleteNoteTask()) *and* takes its whiteboard row with it,
 * but instead of discarding the task's text it is preserved as a new row
 * in the ---parking lot--- section (see extractParkingLotFromPlanText()/
 * parseParkingLotMarkdown()/updatePlanParkingLotText() in script.js).
 *
 * Every #1015 note -- free-form or checklist -- is still task-backed, so
 * this one action covers both, and (issue #1110) nothing about either
 * shape is actually lost: the parked row's `detail` field
 * (wbBuildParkedItemDetail(), captured *before* the task is deleted below)
 * carries the note's exact title, resolved colour, free-form comment, and
 * -- for a checklist note -- every child's own name and completion state,
 * on top of the flat `text` line every plain list view still reads. See
 * wbRestoreParkedItem() for the inverse: bringing a parked item, detail
 * and all, back onto the board. No confirmation prompt, unlike "Delete
 * task": nothing is actually lost -- the idea moves to the parking lot
 * rather than being destroyed -- and this is one wbCommitMarkdown() call,
 * so it is one ordinary undo step like every other board action.
 */
function wbSendNoteToParkingLot(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName) return false;
    if (typeof wbDeleteTaskFromPlanText !== 'function' ||
        typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function' ||
        typeof extractParkingLotFromPlanText !== 'function' ||
        typeof parseParkingLotMarkdown !== 'function' ||
        typeof updatePlanParkingLotText !== 'function') {
        return false;
    }

    const task = (wbLastTasks || []).find(t => t && t.name === taskName);
    const parkedText = wbBuildParkedItemText(taskName, task, wbLastTasks);
    const parkedDetail = wbBuildParkedItemDetail(taskName, task, wbLastTasks);

    let next = wbDeleteTaskFromPlanText(editor.value, taskName);
    if (next === editor.value) return false;

    const gone = new Set([String(taskName).toLowerCase()]);
    wbDescendantNames(wbLastTasks, taskName).forEach(n => gone.add(n));
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(next))
        .filter(item => !(item && item.task && gone.has(String(item.task).toLowerCase())));
    next = updatePlanWhiteboardText(next, items);

    const parkedItems = parseParkingLotMarkdown(extractParkingLotFromPlanText(next));
    const nextId = parkedItems.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    parkedItems.push({ id: nextId, text: parkedText, date_parked: wbTodayIsoDate(), detail: parkedDetail });
    next = updatePlanParkingLotText(next, parkedItems);

    return wbCommitMarkdown(next);
}

// ── Parking lot panel (issue #1019, restore added by #1110) ─────────────
//
// The "viewable/manageable" half of #1019's acceptance criteria: a simple
// list, deliberately no more than that (the issue's own words: "doesn't
// have to be fancy"). Follows the Add-note picker's floating-dialog
// convention (wbOpenAddNotePicker()/wbCloseAddNotePicker() above) --
// single overlay appended to document.body, rebuilt fresh on each open so
// it can never go stale across repeated opens in one session -- just
// without that picker's search/multi-select machinery, since "manage"
// here only means "see what's parked, remove one you no longer want, or
// bring one back".
//
// #1019 originally shipped with no "restore to board" action here (a
// parked item's text was flattened and one-way). #1110 closes that: every
// item parked from here on carries a `detail` snapshot (see
// wbBuildParkedItemDetail()) rich enough to rebuild the note exactly --
// wbRestoreParkedItem() below is the inverse of wbSendNoteToParkingLot().
// An item parked *before* #1110 (or a hand-typed row) has no `detail`;
// Restore still works for one of those, falling back to splitting its
// flat `text` back apart on wbBuildParkedItemText()'s own " — " separator
// -- a plain task with that title (and comment, if the split found one),
// no children -- rather than leaving old rows stuck with no way back onto
// the board at all.

/** Close the panel, if open, and return focus to the toolbar button that
 * opened it. */
function wbCloseParkingLotPanel() {
    const overlay = document.getElementById('wbParkingLotOverlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', wbParkingLotPanelKeydown, true);

    const btn = document.getElementById('whiteboardParkingLotBtn');
    if (btn) btn.focus();
}

/** Escape closes the panel, matching every other floating dialog here. */
function wbParkingLotPanelKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        wbCloseParkingLotPanel();
    }
}

/** The parking lot's current items, straight off the plan text --
 * re-read on every open/render rather than cached, so the panel can never
 * show something that's already been edited out from under it (a hand
 * edit in the raw markdown editor, say). */
function wbCurrentParkingLotItems() {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor ||
        typeof extractParkingLotFromPlanText !== 'function' ||
        typeof parseParkingLotMarkdown !== 'function') {
        return [];
    }
    return parseParkingLotMarkdown(extractParkingLotFromPlanText(editor.value));
}

/** Remove one parked item permanently (its text is not going anywhere
 * else -- unlike sending a note here, this is the actual delete). One
 * wbCommitMarkdown() call, one undo step. */
function wbDeleteParkedItem(itemId) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || typeof updatePlanParkingLotText !== 'function') return false;

    const items = wbCurrentParkingLotItems();
    const next = items.filter(item => item && item.id !== itemId);
    if (next.length === items.length) return false;

    const nextText = updatePlanParkingLotText(editor.value, next);
    const committed = wbCommitMarkdown(nextText);
    if (committed) wbRenderParkingLotList();
    return committed;
}

/** Collapse newlines/whitespace and swap `"` for `'` -- the same
 * embed-safely-in-one-outline-line treatment wbSanitiseChildTaskName()
 * gives a task name, minus its length cap (a comment can run longer than
 * a title). Used by wbRestoreParkedItem() when writing a restored note's
 * comment back onto its new task line as a `"..."` token. */
function wbSanitiseCommentText(text) {
    return String(text || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/"/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Restore a parked item to the board (issue #1110): the inverse of
 * wbSendNoteToParkingLot(). Recreates a top-level task named after the
 * item (uniquified against the current outline, same as every other
 * board-authored task -- see wbUniqueTaskName()), with its free-form
 * comment restored as a `"..."` token on that line, then -- for an item
 * whose `detail` carries a checklist -- appends every child back
 * underneath it (also uniquified, each carrying its own completion state
 * as a trailing `100%` when it was marked done). A whiteboard row is
 * added for the new task, in free board space, with the item's exact
 * preserved colour set directly as that row's own Colour (tier 1 of
 * wbResolveNoteColour()'s precedence -- see this file's header comment --
 * so the restored note shows that colour regardless of what the current
 * Theme: block or derived palette would otherwise pick). The item is then
 * removed from the parking lot. One wbCommitMarkdown() call, so -- like
 * every other board action here -- restoring is a single undo step.
 *
 * An item with no `detail` (parked before #1110, or hand-typed) has
 * nothing structured to rebuild from: this falls back to splitting its
 * flat `text` on wbBuildParkedItemText()'s own " — " separator into a
 * title and (if present) a comment, and restores a single childless task
 * with those -- strictly better than no restore at all, even though a
 * pre-#1110 checklist note's item list can't be recovered (it was never
 * kept anywhere once flattened).
 *
 * Returns false (no-op, no commit) if the item can't be found or the
 * required helpers aren't loaded.
 */
function wbRestoreParkedItem(itemId) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor) return false;
    if (typeof wbAppendTopLevelTask !== 'function' ||
        typeof wbAppendChildTask !== 'function' ||
        typeof wbOutlineTaskNames !== 'function' ||
        typeof wbUniqueTaskName !== 'function' ||
        typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function' ||
        typeof updatePlanParkingLotText !== 'function') {
        return false;
    }

    const items = wbCurrentParkingLotItems();
    const item = items.find(i => i && i.id === itemId);
    if (!item) return false;

    const detail = (item.detail && typeof item.detail === 'object') ? item.detail : null;
    let rawTitle = '';
    let rawComment = '';
    let checklist = [];
    let colour = null;

    if (detail) {
        rawTitle = detail.title || item.text || '';
        rawComment = detail.comment || '';
        checklist = Array.isArray(detail.checklist) ? detail.checklist : [];
        colour = detail.colour || null;
    } else {
        const text = String(item.text || '');
        const sepIdx = text.indexOf(' — ');
        if (sepIdx === -1) {
            rawTitle = text;
        } else {
            rawTitle = text.slice(0, sepIdx);
            rawComment = text.slice(sepIdx + 3);
        }
    }

    const planText = editor.value;
    const titleBase = wbSanitiseChildTaskName(rawTitle) ||
        (typeof WB_NEW_NOTE_BASE_NAME !== 'undefined' ? WB_NEW_NOTE_BASE_NAME : 'Restored idea');
    const name = wbUniqueTaskName(wbOutlineTaskNames(planText), titleBase);

    const comment = wbSanitiseCommentText(rawComment);
    const topLine = comment ? `${name} "${comment}"` : name;

    let next = wbAppendTopLevelTask(planText, topLine);
    if (next === planText) return false;

    checklist.forEach(child => {
        const childBase = wbSanitiseChildTaskName(child && child.name) || 'Item';
        const childName = wbUniqueTaskName(wbOutlineTaskNames(next), childBase);
        const childLine = (child && child.done) ? `${childName} 100%` : childName;
        next = wbAppendChildTask(next, name, childLine);
    });

    const rowItems = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(next));
    const viewport = (typeof wbCurrentViewportBoardRect === 'function') ? wbCurrentViewportBoardRect() : null;
    const newRows = wbBuildAddNoteRows(rowItems, viewport, [name], {
        width: WB_NOTE_DEFAULT_WIDTH,
        height: WB_NOTE_DEFAULT_HEIGHT,
    });
    if (colour) newRows.forEach(row => { row.colour = colour; });
    next = updatePlanWhiteboardText(next, rowItems.concat(newRows));

    const remainingParked = items.filter(i => i && i.id !== itemId);
    next = updatePlanParkingLotText(next, remainingParked);

    const committed = wbCommitMarkdown(next);
    if (committed) wbRenderParkingLotList();
    return committed;
}

/** Rebuild the panel's <ul> from the current parking lot items. */
function wbRenderParkingLotList() {
    const list = document.getElementById('wbParkingLotList');
    if (!list) return;

    const items = wbCurrentParkingLotItems();
    list.innerHTML = '';

    if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'wb-parking-lot-empty';
        empty.textContent = 'Nothing parked yet. Use a note\'s "..." menu to send an idea here.';
        list.appendChild(empty);
        return;
    }

    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'wb-parking-lot-item';

        const textEl = document.createElement('span');
        textEl.className = 'wb-parking-lot-item-text';
        textEl.textContent = item.text;
        li.appendChild(textEl);

        if (item.date_parked) {
            const dateEl = document.createElement('span');
            dateEl.className = 'wb-parking-lot-item-date';
            dateEl.textContent = item.date_parked;
            li.appendChild(dateEl);
        }

        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'wb-parking-lot-item-restore';
        restoreBtn.textContent = 'Restore';
        restoreBtn.setAttribute('aria-label', `Restore "${item.text}" to the whiteboard`);
        restoreBtn.addEventListener('click', () => wbRestoreParkedItem(item.id));
        li.appendChild(restoreBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'wb-parking-lot-item-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.setAttribute('aria-label', `Permanently remove "${item.text}" from the parking lot`);
        removeBtn.addEventListener('click', () => wbDeleteParkedItem(item.id));
        li.appendChild(removeBtn);

        list.appendChild(li);
    });
}

/** Open the parking lot panel: a modal dialog listing every parked item
 * with per-row "Restore" and "Remove" actions -- see this section's header
 * comment for how Restore rebuilds a note from its preserved detail. */
function wbOpenParkingLotPanel() {
    wbCloseParkingLotPanel();

    const overlay = document.createElement('div');
    overlay.id = 'wbParkingLotOverlay';
    overlay.className = 'wb-add-note-overlay';
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) wbCloseParkingLotPanel();
    });

    const dialog = document.createElement('div');
    dialog.id = 'wbParkingLotDialog';
    dialog.className = 'wb-add-note-dialog wb-parking-lot-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'wbParkingLotTitle');
    dialog.addEventListener('mousedown', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'wb-add-note-header';
    const title = document.createElement('h2');
    title.id = 'wbParkingLotTitle';
    title.className = 'wb-add-note-title';
    title.textContent = 'Parking lot';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wb-add-note-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => wbCloseParkingLotPanel());
    header.appendChild(title);
    header.appendChild(closeBtn);

    const intro = document.createElement('p');
    intro.className = 'wb-parking-lot-intro';
    intro.textContent = 'Good ideas, not now -- sent here from the whiteboard, kept in your plan file.';

    const list = document.createElement('ul');
    list.id = 'wbParkingLotList';
    list.className = 'wb-parking-lot-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Parked items');

    dialog.appendChild(header);
    dialog.appendChild(intro);
    dialog.appendChild(list);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    wbRenderParkingLotList();
    document.addEventListener('keydown', wbParkingLotPanelKeydown, true);
    closeBtn.focus();
}
