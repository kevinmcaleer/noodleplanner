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
 * empty checklist. The #1015 PR rejected a second, task-less note type
 * stored as a new `Text` column; the task-less note the board does have now
 * -- a *thought*, see "Thoughts" below and in whiteboard-structure.js --
 * needs no new column either, because it is a commented-out task line.
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
 * Promotion is no longer something the note asks you to do. Every note,
 * free-form included, carries #1104's "Add task..." row (see
 * wbBuildAddChildRow()); typing a task into it appends the same child line
 * through the same wbAppendChildTask(), so the note becomes a summary task
 * as a side effect of the thing the user came to do. The header's
 * quick-promote button (#1107) is gone with that: it occupied a header
 * slot to offer a structural change in the abstract, one keystroke ahead
 * of the content that would have caused it anyway. What is left of #1020
 * is the `...` menu item, which still does the one thing typing cannot --
 * reuse the note's existing comment text as the first child's name.
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

/** Avatars rendered inline on a checklist row before the overflow chip takes
 * over (issue #1243). The row used to render one per assignee, uncapped, while
 * the note footer capped the same list at six.
 *
 * Read from the shared builder at use time rather than declared here, so the
 * board and <np-note> cannot cap the same stack differently (#1249). The
 * fallback covers the window before the deferred module has run -- nothing
 * renders a note that early, but a `const` evaluated at script-eval time
 * would capture `undefined` if one did. */
/* np-resource-stack's own numbers, which this file has to know to reserve the
   right width for a stack it does not draw. Keep in step with
   `.wb-note-row-avatar`'s --np-avatar-size and the component's default
   --np-avatar-overlap. */
const WB_ROW_AVATAR_PX = 20;
const WB_ROW_AVATAR_OVERLAP_PX = 5;
const WB_ROW_ASSIGN_PX = 20;

function wbRowAvatarCap() {
    const markup = globalThis.NoodleNoteMarkup;
    return (markup && markup.ROW_AVATAR_CAP) || 3;
}

/** `.wb-note-menu-grid`'s `grid-template-columns: repeat(6, ...)` in
 * views/whiteboard.css, which the menu's arrow-key navigation has to know to
 * move a *row* rather than one swatch (#1247). The two have to stay in step. */
const WB_NOTE_MENU_SWATCH_COLUMNS = 6;

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
// The outline's commented-out task lines, parsed once per plan update --
// the candidates a ---whiteboard--- row can name as a thought (see
// wbBuildThoughtViewModel()).
let wbLastThoughts = [];
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

// Issue #874's group and combine gestures both act on *several* notes, so
// the selection is a set and `wbSelectedNoteTask` above is the last name
// added to it -- kept because the ribbon's Colour button, the `...` menu
// and the keyboard handlers all want "the one note in hand" and would each
// have to pick one otherwise. One source of truth, one derived convenience:
// every write goes through wbApplySelection() below.
let wbSelectedNoteTasks = new Set();

/**
 * Make `names` the selection exactly, repainting only the cards whose state
 * actually changed.
 *
 * Order matters on the way in: the last name wins `wbSelectedNoteTask`,
 * which is what makes shift-clicking a fourth note leave *that* one as the
 * one a colour pick or a menu acts on.
 */
function wbApplySelection(names) {
    const next = new Set();
    let last = null;
    for (const name of (names || [])) {
        if (!name) continue;
        next.add(name);
        last = name;
    }

    for (const name of wbSelectedNoteTasks) {
        if (next.has(name)) continue;
        const entry = wbNoteNodes.get(name);
        if (entry && entry.refs && entry.refs.card) {
            entry.refs.card.classList.remove('wb-note-selected');
        }
    }
    for (const name of next) {
        if (wbSelectedNoteTasks.has(name)) continue;
        const entry = wbNoteNodes.get(name);
        if (entry && entry.refs && entry.refs.card) {
            entry.refs.card.classList.add('wb-note-selected');
        }
    }

    wbSelectedNoteTasks = next;
    wbSelectedNoteTask = last;
    // A note and a group are never selected at once: the object toolbar
    // floats over one thing.
    if (next.size && typeof wbClearGroupSelection === 'function') wbClearGroupSelection();
    if (typeof wbUpdateSelectionToolbar === 'function') wbUpdateSelectionToolbar();
    if (typeof wbUpdateObjectToolbar === 'function') wbUpdateObjectToolbar();
}

/** Select (or, with a falsy name, deselect) one note, updating the
 * `.wb-note-selected` class on its card. A no-op when the same note is
 * already the whole selection, so re-raising an already-frontmost note on
 * repeated clicks doesn't thrash the class. */
function wbSetSelectedNote(taskName) {
    const next = taskName || null;
    if (!next) { wbApplySelection([]); return; }
    if (wbSelectedNoteTasks.size === 1 && wbSelectedNoteTasks.has(next)) return;
    wbApplySelection([next]);
}

/**
 * Add `taskName` to the selection, or take it out if it is already in --
 * the shift-click half of #874's multi-select.
 */
function wbToggleSelectedNote(taskName) {
    if (!taskName) return;
    const next = [...wbSelectedNoteTasks];
    const at = next.indexOf(taskName);
    if (at === -1) next.push(taskName);
    else next.splice(at, 1);
    wbApplySelection(next);
}

/** Replace the selection wholesale -- the lasso's way in. */
function wbSetSelectedNotes(names) {
    wbApplySelection(names);
}

/**
 * Every currently selected note, in selection order, dropping any that have
 * left the board since. Self-healing for the same reason
 * wbGetSelectedNoteTask() is: wbRenderNotes()' sweep deletes straight from
 * wbNoteNodes without going through the setters here.
 */
function wbGetSelectedNoteTasks() {
    const live = [...wbSelectedNoteTasks].filter(name => wbNoteNodes.has(name));
    if (live.length !== wbSelectedNoteTasks.size) wbApplySelection(live);
    return live;
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
        wbGetSelectedNoteTasks(); // drops the dangling name and re-derives this one
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

// A scissors split (issue #874) creates a uniquely-named outline task
// ("New idea", "New idea 2", …) but the new post-it should look untitled
// until the user names it. Set for that one task name around the commit;
// wbUpdateNoteNode() shows an empty title and wbBeginTitleEdit() starts
// the inline rename with the box already blank.
let wbBlankTitleUntilNamed = null;

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

/**
 * wbNoteProgress()'s answer for every parent at once: one pass over `tasks`
 * producing a Map of parent name -> { completed, total } across that task's
 * direct children. Keyed by the parent string exactly as wbDirectChildren()
 * matches it, so the two can never disagree about who a child belongs to.
 *
 * This exists for cost, not for expressiveness. A note's body needs this
 * answer once per summary *row* (issue #1245's mixed checkbox), and
 * wbNoteProgress() answers it with a filter over the whole task list -- so
 * asking per row would be a nested scan on every whiteboard render, and the
 * view model is rebuilt on every one. One O(n) pass, then O(1) per row.
 *
 * `total` is also the child-count badge's number and `total > 0` is also
 * "has children", which is why wbBuildNoteViewModel() reads all three from
 * here rather than calling wbChildCount()/wbHasChildren() per child: those
 * are the same scan, once each, per child.
 */
function wbChildProgressIndex(tasks) {
    const index = new Map();
    if (!tasks) return index;
    for (const t of tasks) {
        if (!t || !t.parent) continue;
        let entry = index.get(t.parent);
        if (!entry) {
            entry = { completed: 0, total: 0 };
            index.set(t.parent, entry);
        }
        entry.total += 1;
        if (wbIsChildComplete(t)) entry.completed += 1;
    }
    return index;
}

/**
 * Whether a summary row's checkbox should render the mixed state: some, but
 * not all, of its own direct children are complete (issue #1245).
 *
 * Deliberately the completed-count rule wbNoteProgress() uses, not the
 * engine's averaged percent. A row's mixed box is a *report* of the children
 * the user sees when they drill into it -- task peek renders exactly these
 * children, each with a checkbox that is ticked iff wbIsChildComplete() --
 * so counting ticks is what makes the box and the drill-down agree. Reading
 * the rollup instead would show mixed for a summary whose every child sits
 * at 50% and whose peek therefore shows nothing ticked at all.
 *
 * Neither 0/n nor n/n is mixed, which is what keeps this exclusive with the
 * checked state: a summary's rolled-up percent reaches 100 exactly when all
 * of its children do, so `complete` and `indeterminate` are never both true.
 */
function wbIsPartlyComplete(progress) {
    if (!progress || !progress.total) return false;
    return progress.completed > 0 && progress.completed < progress.total;
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

/**
 * Resources offerable for quick assignment, richest source first.
 *
 * Front matter (`- @short: Full Name, Role`) is preferred, because it is the
 * only source carrying a display name and a role. When a plan declares none,
 * fall back to the `@shortname` tokens already used on its task lines --
 * getAllResourceNames() (script.js) has always done this, so before the two
 * assign controls were merged (#1162's bubble read that list, this menu read
 * front matter) a plan that used tokens without declaring them got a working
 * bubble and an empty menu. Harvested here from `planText` rather than by
 * calling getAllResourceNames(), which reads #planEditor directly: this
 * function is pure and unit-tested, and must stay callable without a DOM.
 */
function wbResourceOptionsFromPlanText(planText) {
    const text = String(planText || '');
    const result = [];
    const match = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
    if (match) {
        const re = /^\s*-\s*@([A-Za-z0-9_]+):\s*([^,\n]+)(?:,\s*([^\n]+))?/gm;
        let item;
        while ((item = re.exec(match[1]))) result.push({ shortname: item[1], name: item[2].trim(), role: (item[3] || '').trim() });
    }
    if (result.length) return result;

    // Strip the front matter block before harvesting, so a declaration block
    // that parsed to nothing cannot leak its own `@` tokens back in here.
    const body = match ? text.slice(match.index + match[0].length) : text;
    const seen = new Set();
    const token = /@([A-Za-z0-9_]+)/g;
    let hit;
    while ((hit = token.exec(body))) {
        const shortname = hit[1];
        const key = shortname.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ shortname, name: shortname, role: '' });
    }
    result.sort((a, b) => a.shortname.localeCompare(b.shortname));
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
 *
 * `childProgressIndex` (optional) is wbChildProgressIndex(tasks), shared
 * across a render pass for the same reason `themeColours` is -- omitting it
 * just builds one locally and costs a second walk of the task list.
 */
function wbBuildNoteViewModel(row, tasks, themeColours = {}, boardNames = null, childProgressIndex = null) {
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

    // One O(n) pass answering "how many of your children are done" for every
    // task at once -- see wbChildProgressIndex(). Built by wbNoteViewModels()
    // and passed down so a render pass only ever walks the task list once,
    // the same reason `themeColours` is passed in rather than re-parsed here.
    // A caller with no index (the pure unit tests, task peek) still works.
    const childProgress = childProgressIndex || wbChildProgressIndex(tasks);

    const allChildren = wbDirectChildren(tasks, task.name).map(child => {
        // hasChildren, childCount and the mixed-state report are the same
        // question asked three ways, so they come from the one index rather
        // than from a wbHasChildren()/wbChildCount() scan each.
        const progress = childProgress.get(child.name) || { completed: 0, total: 0 };
        const hasChildren = progress.total > 0;
        return {
            task: child,
            hasChildren,
            childCount: progress.total,
            complete: wbIsChildComplete(child),
            // The leaf's own percent, for the part-done pie in its checkbox.
            percent: child.percent,
            // A summary child reports its own children's completion so its
            // row can render the mixed checkbox (#1245) -- the same
            // { completed, total } shape as this note's own footer progress,
            // one level down. A leaf has none: it is one task, done or not.
            childProgress: hasChildren ? { ...progress } : null,
            // The decision the row's checkbox needs, made once here so the
            // live whiteboard (wbBuildChildRow()) and Storybook's <np-note>
            // cannot drift apart about when a summary looks mixed. It is a
            // report of the children, never a control over them:
            // wbToggleChildComplete() writes 100%/0% onto this row's own
            // markdown line and leaves its descendants' percentages alone.
            indeterminate: hasChildren && wbIsPartlyComplete(progress),
            onBoard: onBoard.has(String(child.name).toLowerCase()),
            // Issue #1162's resource-assign bubble shows a child row's own
            // current assignees (not the summary task's, unlike the note
            // footer's avatars) -- same shape as wbBuildPeekLevel()'s own
            // per-child `resources`, so the bubble and the peek can never
            // disagree about who a child is assigned to.
            resources: wbResourceList(child.resources),
        };
    });
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

/**
 * The view model for a thought (a note that is not a task -- see
 * whiteboard-structure.js's "Thoughts" section): the same shape
 * wbBuildNoteViewModel() returns, so wbUpdateNoteNode() and everything keyed
 * on `vm.task.name` treat it like any other note, but with `thought: true`,
 * no children, no parent and nothing to count. `task` is a stand-in carrying
 * only what the card draws: the name and the body text.
 *
 * Null when no thought in `thoughts` (wbParseThoughts()) has the row's name.
 * The caller only asks once no real task matched, so a task always wins a
 * name both could claim.
 */
function wbBuildThoughtViewModel(row, thoughts, themeColours = {}) {
    if (!row || !row.task || !thoughts || !thoughts.length) return null;
    const key = String(row.task).toLowerCase();
    const thought = thoughts.find(t => t && String(t.name).toLowerCase() === key);
    if (!thought) return null;
    const task = { name: thought.name, comment: thought.comment || '', parent: null, thought: true };

    let colour;
    if (wbColourOverrides.has(task.name) && wbColourOverrides.get(task.name)) {
        colour = wbColourOverrides.get(task.name).toUpperCase();
    } else {
        // No task list to take a palette position from: tier 3 falls back to
        // the palette's first entry, a stable colour for every thought.
        colour = wbResolveNoteColour(row, task, [], themeColours).colour;
    }

    return {
        row,
        task,
        thought: true,
        children: [],
        linkedChildren: [],
        linkedParent: null,
        parentName: null,
        progress: { completed: 0, total: 0 },
        colour,
        colourSource: row.colour ? 'row' : 'derived',
    };
}

/** wbBuildNoteViewModel() for every row, skipping orphans. A row naming a
 * thought rather than a task (see wbBuildThoughtViewModel()) is a thought
 * card; `thoughts` defaults to none, so callers that predate thoughts --
 * and the pure unit tests -- still see only tasks. */
function wbNoteViewModels(rows, tasks, themeColours = {}, boardNames = null, thoughts = null) {
    // A group row (issue #874) names a task like a post-it row does, but it
    // asks for a boundary rather than a card -- so it is not a note, and it
    // is not "on the board" for the purpose of deciding which of a note's
    // children became noodles either. Without the second exclusion a group's
    // members would each draw a noodle to a card that is not there.
    const postIts = (rows || []).filter(r => r && r.task && r.kind !== 'group' && r.kind !== 'text');
    const names = boardNames || new Set(
        postIts.map(r => String(r.task).toLowerCase())
    );
    // Walked once here, not once per note: every row's body asks the same
    // "how many of your children are done" question of the same task list.
    const childProgress = wbChildProgressIndex(tasks);
    return postIts
        .map(row => wbBuildNoteViewModel(row, tasks, themeColours, names, childProgress) ||
            wbBuildThoughtViewModel(row, thoughts, themeColours))
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

/** Whether rect `inner` lies wholly inside rect `outer`. */
function wbRectInside(inner, outer) {
    return inner.x >= outer.x && inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height;
}

/**
 * The free `width` x `height` spot *nearest* to `preferred` (the top-left
 * the caller would ideally use), for a single new note.
 *
 * wbFindFreeSpacePosition() shelf-packs from the viewport's top-left, which
 * suits a batch but not one note: with a note already in the middle of a
 * small viewport it finds no free cell on screen and falls through to the
 * rows *below* the viewport -- the note is created, shows up in the
 * markdown and the outline, and is nowhere to be seen. This instead walks
 * outward from `preferred` in note-sized steps and takes the closest free
 * candidate that is wholly inside `viewportRect`; only when nothing on
 * screen is free does it settle for the closest free candidate off it
 * (which the caller then pans to -- see wbRevealNewNote()).
 *
 * Pure, so it is unit-tested alongside wbFindFreeSpacePosition().
 */
function wbFindNearestFreePosition(existingRects, preferred, viewportRect, width, height, gap = 24) {
    const rects = existingRects || [];
    const vp = viewportRect || null;
    const origin = { x: Math.round(preferred.x), y: Math.round(preferred.y) };
    const colStep = width + gap;
    const rowStep = height + gap;
    const free = (c) => !rects.some(r => wbRectsOverlap(c, r, gap));

    let offscreen = null;
    const maxRing = 40;
    for (let ring = 0; ring <= maxRing; ring++) {
        const candidates = [];
        for (let i = -ring; i <= ring; i++) {
            for (let j = -ring; j <= ring; j++) {
                if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
                candidates.push({ x: origin.x + i * colStep, y: origin.y + j * rowStep, width, height });
            }
        }
        // Within a ring, nearest first; ties go right, then down, so a
        // note beside the selected one lands to its right before its left.
        candidates.sort((a, b) =>
            Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y) ||
            (b.x - a.x) || (b.y - a.y));
        for (const c of candidates) {
            if (!free(c)) continue;
            if (!vp || wbRectInside(c, vp)) return { x: c.x, y: c.y };
            if (!offscreen) offscreen = { x: c.x, y: c.y };
        }
        // Once past the viewport in every direction, nothing further out
        // can be on screen -- take the nearest off-screen spot found.
        if (offscreen && vp &&
            ring * colStep > vp.width + Math.abs(origin.x - vp.x) &&
            ring * rowStep > vp.height + Math.abs(origin.y - vp.y)) {
            return offscreen;
        }
    }
    return offscreen || wbFindFreeSpacePosition(rects, vp, width, height, gap);
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
        wbNoteProgress, wbChildProgressIndex, wbIsPartlyComplete,
        wbGetInitials, wbResourceList, wbRelativeLuminance,
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
    wbLastThoughts = (typeof wbParseThoughts === 'function') ? wbParseThoughts(wbLastPlanText) : [];
    wbRenderNotes();
}

/** Get-or-create the single <g> that holds all note foreignObjects. It is
 * *not* inside the panned/zoomed wbGroup but after it, untransformed: see
 * wbPlaceBoardObject() in whiteboard.js for why. */
function wbNotesLayer() {
    if (typeof wbGroup === 'undefined' || !wbGroup) return null;
    const svg = wbGroup.ownerSVGElement || wbGroup.parentNode;
    let layer = svg.querySelector('.wb-notes-layer');
    if (!layer) {
        layer = document.createElementNS(SVG_NS, 'g');
        layer.setAttribute('class', 'wb-notes-layer');
        svg.insertBefore(layer, wbGroup.nextSibling);
    }
    return layer;
}

/** wbSetBoardRect() (whiteboard.js), or -- where only this file is loaded,
 * as in its unit tests -- just the board rect it would record. */
function wbSetNoteBoardRect(fo, rect) {
    if (typeof wbSetBoardRect === 'function') { wbSetBoardRect(fo, rect); return; }
    if (rect.x != null) { fo.setAttribute('x', String(rect.x)); fo.dataset.wbX = String(rect.x); }
    if (rect.y != null) { fo.setAttribute('y', String(rect.y)); fo.dataset.wbY = String(rect.y); }
    if (rect.width != null) { fo.setAttribute('width', String(rect.width)); fo.dataset.wbWidth = String(rect.width); }
    if (rect.height != null) { fo.setAttribute('height', String(rect.height)); fo.dataset.wbHeight = String(rect.height); }
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
    const viewModels = wbNoteViewModels(rows, wbLastTasks, themeColours, null, wbLastThoughts);
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
    // Group boundaries (issue #874) are measured from the notes inside them,
    // so they are derived after the notes have their rects -- and before the
    // noodles, which want the same settled geometry.
    if (typeof wbRenderGroups === 'function') wbRenderGroups(rows, wbLastTasks);
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

    // Markup from components/note/note-markup.js, listeners from here (#1249).
    //
    // The card's header, caption, body, footer and resize grip -- their
    // elements, classes, ARIA and glyphs, and the header's load-bearing child
    // order -- used to be ~120 lines here and another ~50 in <np-note>, typed
    // out twice. That is what made Storybook a second drawing of the note
    // rather than the place it is designed, and it had already produced real
    // divergences: the title was an <h3> here and a <p> there, and the promote
    // button's glyph was a different icon in each.
    //
    // What stays is everything the component neither has nor wants: the drag,
    // resize, link and menu gestures, all of which read `fo.dataset.wbTask` at
    // event time rather than closing over a view model, so they keep working
    // across the re-renders that reuse this same node for the same task.
    const { card, rails, refs } = globalThis.NoodleNoteMarkup.buildNoteCard();
    const {
        header, title, linkHandle, coachBtn,
        parentCaption, body, footer, progress, moreBtn, resizeHandle,
        railHint, railDep,
    } = refs;

    // The noodle handle: drag from here to another note to make that note
    // a child of this one. Lives in the header rather than floating over
    // the card edge so it never sits on top of the note's own content.
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

    coachBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskName = fo.dataset.wbTask;
        if (taskName) wbToggleCoachingMenu(taskName, coachBtn);
    });

    // The rails go beside the card, not in it: both `.wb-note-card` and
    // `.wb-note-body` clip horizontally, and this <foreignObject> is the first
    // ancestor that does not (`.wb-note { overflow: visible }`).
    fo.append(card, rails);

    const entry = {
        fo,
        refs: {
            card, header, title, linkHandle, coachBtn, parentCaption,
            body, footer, progress, moreBtn, resizeHandle, rails, railHint, railDep,
        },
    };

    wbWireRowRails(entry);

    // The footer's "+N more": recount whenever the body scrolls or changes
    // size (a resize, a zoom tier, a row added), and scroll on to the rows
    // it counts when pressed.
    body.addEventListener('scroll', () => wbScheduleNoteOverflow(entry), { passive: true });
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => wbScheduleNoteOverflow(entry)).observe(body);
    }
    moreBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbRevealMoreNoteRows(entry);
    });

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
        wbSetNoteBoardRect(fo, { x: row.x || 0, y: row.y || 0, width: w, height: h });
        // whiteboardZoomFit() (whiteboard.js) reads these dataset values to
        // frame the real note bounding box -- see that function's comment.
        fo.dataset.wbX = String(row.x || 0);
        fo.dataset.wbY = String(row.y || 0);
        fo.dataset.wbWidth = String(w);
        fo.dataset.wbHeight = String(h);
    }
    fo.dataset.wbTask = vm.task.name;
    // A thought (a note that is not a task) shares every gesture a post-it
    // has that only touches its ---whiteboard--- row -- drag, resize,
    // colour, rename -- and none of the ones that need a task. The class
    // hides the task-only header controls (views/whiteboard.css); the
    // dataset flag is what wbIsThoughtNote() asks.
    const thought = !!vm.thought;
    fo.dataset.wbThought = thought ? 'true' : '';
    refs.card.classList.toggle('wb-note-thought', thought);

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
    //
    // A thought has no colour of its own: it is always the design system's
    // very light grey, so a text note reads as a different kind of thing
    // from every post-it on the board rather than as one more pastel. Any
    // Colour its row still carries (from before it was a thought) is left
    // alone and comes back if it is promoted.
    const fill = thought ? wbThoughtFill() : vm.colour;
    if (fill) refs.card.style.setProperty('--wb-note-accent', fill);
    else refs.card.style.removeProperty('--wb-note-accent');
    refs.card.style.setProperty('--wb-note-text', (fill && wbContrastTextColour(fill)) || '');

    // Don't clobber a title the user is in the middle of retyping.
    // A freshly scissors-split note keeps a unique placeholder in the
    // outline ("New idea") but shows a blank title so naming it is the
    // next action (issue #874).
    if (!refs.title.isContentEditable) {
        if (wbBlankTitleUntilNamed && wbBlankTitleUntilNamed === vm.task.name) {
            wbSetText(refs.title, '');
            refs.title.setAttribute('title', 'Name this note');
        } else {
            wbSetText(refs.title, vm.task.name);
            refs.title.setAttribute('title', thought
                ? vm.task.name + ' — a text note, not a task. Double-click to rename'
                : vm.task.name + ' — double-click to rename');
        }
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
    // The rails point at a row by name and are about to outlive every row in
    // this body. Hiding them here means the next pointerover re-places them
    // against the rebuilt row rather than leaving a handle beside a gap.
    if (typeof entry.railsHide === 'function') entry.railsHide();
    refs.body.innerHTML = '';

    // Free-form vs. checklist (issue #1015) -- see wbIsFreeformNote() and
    // this file's header comment. The class drives the footer's CSS-only
    // hide (views/whiteboard.css's `.wb-note-freeform .wb-note-footer`),
    // so "is this note free-form right now" has exactly one source of
    // truth rather than a second condition down by the footer that could
    // quietly drift from this one.
    const freeform = wbIsFreeformNote(vm);
    refs.card.classList.toggle('wb-note-freeform', freeform);

    if (thought) {
        // A thought's body is the text it was made to hold, edited in place:
        // there is no task form behind it to type a comment into. No
        // "Add task..." row either -- a checklist is a task's structure, and
        // giving a thought one would make it a summary task by stealth. The
        // way to a task is the `...` menu's "Promote to task".
        refs.body.appendChild(wbBuildThoughtBody(vm.task.name, vm.task.comment));
        refs.body.scrollTop = savedScrollTop;
        wbSetText(refs.progress, '');
        wbScheduleNoteOverflow(entry);
        return;
    }

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
        vm.children.forEach((childVm, i) => {
            refs.body.appendChild(wbBuildChildRow(childVm, {
                parentName: vm.task.name,
                scissors: i < vm.children.length - 1,
            }));
        });
    }
    wbSizeNotePeopleSlot(refs.card, vm.children);
    // No "+ N linked notes" line. A note that had both kinds used to get a
    // quiet caption naming the children that had been noodled out, on the
    // reasoning that nothing typed into a note should appear to vanish. But
    // the board already says it, and says it better: a child that left has a
    // post-it of its own with a noodle drawn from this note to it, in view, at
    // the moment you are looking at either. The caption restated that as a
    // number, wedged between the last real task and the row you type the next
    // one into -- so the one place on the card that should read as "the list
    // continues here" read as "the list ended and here is a footnote".
    //
    // The zero-children case keeps its placeholder (the `.wb-note-empty`
    // branch above): there, the count is the only thing on the card that says
    // the note has any children at all.
    // Issue #1104, part of epic #1090: every note always ends in one empty
    // "Add task..." row, whether it currently has zero rows (the "No
    // subtasks yet"/"N linked notes" placeholder above), some rows, or all
    // of its children noodled elsewhere. wbBuildAddChildRow() below.
    //
    // Free-form notes get it too, which #1104 originally withheld from them
    // on the reading that #885's "nothing prompts for detail" forbade it.
    // The row is how a note becomes a summary task now: typing a task into
    // it gives the note its first child, and gaining a child is exactly
    // what flips wbIsFreeformNote() to false (see this file's header
    // comment on #1015). Withholding the row from free-form notes meant the
    // one kind of note that had no structure was the one kind that could
    // not be given any without first pressing a "promote" button -- which
    // is why that button existed, and why it no longer needs to.
    refs.body.appendChild(wbBuildAddChildRow(vm.task.name));
    refs.body.scrollTop = savedScrollTop;

    // Footer: completed/total fraction + resource avatar chips. Populated
    // unconditionally even for a free-form note -- CSS hides the whole
    // footer for `.wb-note-freeform` (see the class toggled above), so
    // there is nothing here to gate; `vm.progress` is always `0 / 0` in
    // that case anyway (wbIsFreeformNote() is defined in terms of it).
    wbSetText(refs.progress, `${vm.progress.completed} / ${vm.progress.total}`);
    wbScheduleNoteOverflow(entry);
}

// ── "+N more": rows scrolled out of sight ───────────────────────────────
//
// A note's body scrolls, but its scrollbar only shows on hover and the board
// takes the wheel for panning, so a note shorter than its list looked like it
// held every task it had. The footer says how many rows are out of sight, and
// pressing it scrolls to them.

/** Notes whose overflow needs recounting on the next frame. */
const wbNoteOverflowQueue = new Set();

function wbScheduleNoteOverflow(entry) {
    if (!entry || !entry.refs || !entry.refs.moreBtn) return;
    const first = !wbNoteOverflowQueue.size;
    wbNoteOverflowQueue.add(entry);
    if (!first) return;
    const run = () => {
        const batch = [...wbNoteOverflowQueue];
        wbNoteOverflowQueue.clear();
        batch.forEach(wbUpdateNoteOverflow);
    };
    // Batched to one frame: a render updates every note at once, and
    // measuring each straight after its own rebuild would force a layout per
    // note.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
}

/**
 * How many checklist rows of this note are out of sight, above and below.
 * A row counts as hidden when less than half of it shows: a row cut off at
 * its last few pixels has been seen, and one showing a sliver has not.
 */
function wbNoteHiddenRows(entry) {
    const body = entry.refs.body;
    const out = { above: 0, below: 0 };
    if (!body || !body.isConnected || body.clientHeight <= 0) return out;
    if (body.scrollHeight <= body.clientHeight + 1) return out;
    const view = body.getBoundingClientRect();
    for (const row of body.querySelectorAll('.wb-note-row')) {
        const r = row.getBoundingClientRect();
        const middle = r.top + r.height / 2;
        if (middle > view.bottom) out.below += 1;
        else if (middle < view.top) out.above += 1;
    }
    return out;
}

function wbUpdateNoteOverflow(entry) {
    const btn = entry && entry.refs && entry.refs.moreBtn;
    if (!btn || !btn.isConnected) return;
    const { above, below } = wbNoteHiddenRows(entry);
    const hidden = above + below;
    if (!hidden) {
        btn.hidden = true;
        return;
    }
    // Pointing the way there is still more: down while anything is below,
    // otherwise back up.
    const down = below > 0;
    const text = `+${hidden} more ${down ? '\u25BE' : '\u25B4'}`;
    if (btn.textContent !== text) btn.textContent = text;
    const label = `${hidden} more task${hidden === 1 ? '' : 's'} ${down ? 'below' : 'above'} -- scroll to ${hidden === 1 ? 'it' : 'them'}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.hidden = false;
}

/** Scroll the body on to the rows the footer counted: the next ones down,
 * or back to the top once everything below has been seen. */
function wbRevealMoreNoteRows(entry) {
    const body = entry.refs.body;
    if (!body) return;
    const { below } = wbNoteHiddenRows(entry);
    const top = below
        ? Math.min(body.scrollHeight - body.clientHeight, body.scrollTop + body.clientHeight * 0.8)
        : 0;
    if (typeof body.scrollTo === 'function') body.scrollTo({ top, behavior: 'smooth' });
    else body.scrollTop = top;
}

// ── Free-floating text objects (issue #1018) ────────────────────────────
//
// See the file header comment for the overall design. Deliberately a
// small, self-contained sibling to the post-it rendering above: its own
// node map (wbTextNodes), its own drag state (wbActiveTextDrag), never
// touching wbNoteNodes/wbBuildNoteViewModel/the task outline.


/**
 * Size this note's people slot to what this note's rows actually carry.
 *
 * The slot reserves its width on every row whether or not the row has anyone
 * on it -- that is #1243's rule, and it is what keeps a busy row and a bare
 * row the same shape. What it does not have to do is reserve the width of the
 * *worst case in the app*: a note whose rows name one person each was holding
 * 78px open for three chips plus an overflow chip that could never appear on
 * it, and the task names paid for all of it.
 *
 * So the reservation is per note, from that note's own widest row. Every row
 * in a card still agrees with every other row in that card, which is the
 * alignment anyone can actually see; two different notes disagreeing is not
 * something a reader can put side by side.
 *
 * The narrow-tier container query sets --wb-row-people on `.wb-note-row`,
 * which is an own declaration and so still beats this inherited one.
 */
function wbSizeNotePeopleSlot(card, children) {
    const cap = wbRowAvatarCap();
    let widest = 0;
    let overflowed = false;
    for (const childVm of children) {
        const n = (childVm.resources || []).length;
        if (n > cap) overflowed = true;
        widest = Math.max(widest, Math.min(n, cap));
    }

    // Mirrors np-resource-stack's own geometry: chips overlap by
    // --np-avatar-overlap and the overflow chip is one more chip. The stack
    // and the quick-assign circle are alternatives rather than neighbours, so
    // the slot holds whichever is wider -- and a note whose rows name one
    // person each now reserves a single 20px column.
    const chips = widest + (overflowed ? 1 : 0);
    const stack = chips ? (chips * WB_ROW_AVATAR_PX - (chips - 1) * WB_ROW_AVATAR_OVERLAP_PX) : 0;
    card.style.setProperty('--wb-row-people', `${Math.max(stack, WB_ROW_ASSIGN_PX)}px`);
}

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

    const deleteBtn = document.createElementNS(XHTML_NS, 'np-button');
    deleteBtn.setAttribute('class', 'wb-text-object-delete');
    deleteBtn.setAttribute('icon-only', '');
    deleteBtn.setAttribute('variant', 'danger');
    deleteBtn.setAttribute('size', 'small');
    deleteBtn.setAttribute('type', 'button');
    deleteBtn.setAttribute('title', 'Delete this text');
    deleteBtn.setAttribute('label', 'Delete this text object');
    deleteBtn.innerHTML = '<span slot="icon">×</span>'; // multiplication sign, reused as a small close glyph
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

    fo.dataset.wbTextId = item.id;
    wbSetNoteBoardRect(fo, { x, y, width, height });

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
        wbSetNoteBoardRect(fo, { x: Math.round(drag.startX + dx), y: Math.round(drag.startY + dy) });
    } else if (drag.type === 'resize') {
        wbSetNoteBoardRect(fo, {
            width: wbClampNoteWidth(drag.startWidth + dx),
            height: wbClampNoteHeight(drag.startHeight + dy),
        });
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

    // Issue #1201: hint that dropping *here* would park the note instead of
    // repositioning it -- the panel gets a highlight, the note itself gets a
    // "this is about to leave the board" cue, mirroring wb-link-target's own
    // live drop-target feedback.
    if (drag.type === 'move' && fo.dataset.wbThought !== 'true') {
        wbUpdateParkingLotDropHint(fo, wbPointOverParkingLotPanel(clientX, clientY));
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

/**
 * End the active drag/resize gesture and commit its result (if any).
 *
 * `clientX`/`clientY`, when given, are the pointer's position at release --
 * used only to check whether a *move* drag ended over the open parking lot
 * panel (issue #1201), in which case the note is parked (wbParkDraggedNote())
 * instead of having its new board position committed. Omit them (as a plain
 * tap/click, or a resize, does) to always fall through to the ordinary
 * position/size commit below.
 */
function wbFinishDrag(clientX, clientY) {
    const drag = wbActiveDrag;
    if (!drag) return;
    wbActiveDrag = null;
    wbSetDragCursor('');
    // The ghost stays on screen for a park: the park animation plays on it.
    const ghost = wbTakeParkDragGhost();
    wbUpdateParkingLotDropHint(drag.entry.fo, false);

    const taskName = drag.entry.fo.dataset.wbTask;
    // Parking and drag-to-stack both rewrite a task's outline subtree, which
    // a thought does not have: for one, a drop is just a move.
    const thought = wbIsThoughtNote(taskName);

    if (drag.type === 'move' && drag.moved && !thought &&
        typeof clientX === 'number' && typeof clientY === 'number' &&
        wbPointOverParkingLotPanel(clientX, clientY)) {
        wbParkDraggedNote(drag.entry, taskName, ghost);
        return;
    }
    if (ghost) {
        ghost.el.remove();
        ghost.fo.classList.remove('wb-note-ghosted');
    }

    // Drag-to-stack (issue #874): released on top of another note, this one
    // merges into it. Checked before the ordinary move commit below, and
    // confirmed rather than silent -- landing on a note is one pixel from
    // landing beside it, and the two outcomes are "nothing happened" and
    // "that note is gone". A declined confirm falls through to the move, so
    // the note stays where the user dropped it.
    if (drag.type === 'move' && drag.moved && !thought &&
        typeof clientX === 'number' && typeof clientY === 'number' &&
        typeof wbNoteAt === 'function' && typeof wbMergeDroppedNote === 'function') {
        const onto = wbNoteAt(clientX, clientY, taskName);
        if (onto && !wbIsThoughtNote(onto) && wbMergeDroppedNote(taskName, onto)) return;
    }

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
    // The menu button (issue #849, not this issue's to build or wire) is
    // a sibling inside the same header -- never hijack its own click.
    if (e.target && e.target.closest && e.target.closest('.wb-note-menu-btn')) return;
    if (e.target && e.target.closest && e.target.closest('.wb-note-coach-btn')) return;
    if (e.target && e.target.closest && e.target.closest('.wb-note-smart-btn')) return;
    // Nor the noodle handle, nor a title mid-rename: both are their own
    // gestures that happen to start inside the drag handle.
    if (e.target && e.target.closest && e.target.closest('.wb-note-link-handle')) return;
    if (e.target && e.target.isContentEditable) return;
    // Double-click-to-rename is detected here, from consecutive
    // mousedowns, rather than from a native 'dblclick' listener: the first
    // press of the pair raises the note to the front of the notes layer,
    // and moving a node in the DOM cancels the browser's own double-click
    // tracking, so a dblclick handler on the header would simply never
    // fire for any note that wasn't already frontmost. Detecting it
    // ourselves also gives touch the same gesture for free (see
    // wbNoteHeaderTouchStart()), which 'dblclick' does not.
    //
    // Below the guards, not above them, since issue #1250. It used to run
    // first, which made the rename gesture's hit area device-dependent:
    // wbNoteHeaderTouchStart() has always run its identical guards before
    // its own repeat-press check, so a fast second press on the `⋮` menu
    // button or the coach button renamed the note on a mouse and did
    // nothing on a touchscreen. The two paths now agree -- rename is the
    // header minus its controls, on both.
    if (wbIsRepeatHeaderPress(entry, e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        wbBeginTitleEdit(entry);
        return;
    }
    // Shift-click adds to (or removes from) the selection instead of picking
    // the note up -- issue #874's multi-select, which group and combine both
    // read. It deliberately starts no drag: shift is how you build a
    // selection, and a build step that also moved something would make every
    // fourth click a small accident.
    if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const name = entry && entry.fo && entry.fo.dataset.wbTask;
        if (name && typeof wbToggleSelectedNote === 'function') wbToggleSelectedNote(name);
        return;
    }
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
    wbFinishDrag(e.clientX, e.clientY);
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
    // The fifth guard the mouse path has always carried, added here for the
    // same parity (#1250): a second tap inside a title already being
    // renamed places the caret, it does not re-enter the edit.
    if (e.target && e.target.isContentEditable) return;

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
    const touch = wbFindTouchById(e.changedTouches, drag.touchId);
    wbFinishDrag(touch ? touch.clientX : undefined, touch ? touch.clientY : undefined);
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
    wbSetNoteBoardRect(drag.entry.fo, { x, y });
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

/**
 * Fill (or build) an <np-resource-stack> for `resources`.
 *
 * Both of the note's stacks go through here -- the footer's, which shows the
 * note's own task's resources, and a checklist row's, which shows that child's.
 * They keep their different *data*; what they no longer keep is two sizes, two
 * caps, two elements and two copies of the initials algorithm.
 *
 * `details` comes from the plan's front matter, which already carries the role
 * and the email the profile card wants (`- @short: Full Name, Role, email,
 * ...`). parseResourceDetails() (script.js) reads it; this tolerates that
 * function being absent so the whiteboard still renders in isolation.
 */
function wbFillResourceStack(host, resources, cap, size, taskName) {
    const stack = document.createElementNS(XHTML_NS, 'np-resource-stack');
    stack.setAttribute('max', String(cap));
    if (size) stack.setAttribute('size', String(size));
    stack.names = resources || [];
    if (typeof parseResourceDetails === 'function') {
        try {
            stack.details = parseResourceDetails(wbLastPlanText || '');
        } catch { /* front matter is optional; the card degrades to the name */ }
    }

    // The component reports rather than reaching for the app itself, which is
    // what keeps it usable in Storybook. Wiring it up is this end's job.
    //
    // Clicking a chip opens the same assign menu the row's own "+" opens, so
    // seeing who is on a task and changing it are one control -- they used to
    // be a chip and a detached "+" that looked nothing like each other.
    if (taskName) {
        stack.addEventListener('resource-activate', (e) => {
            e.stopPropagation();
            wbToggleResourceMenu(taskName, stack);
        });
    }
    stack.addEventListener('resource-open', (e) => {
        e.stopPropagation();
        const shortname = e.detail && e.detail.shortname;
        if (shortname && typeof openResourceForm === 'function') openResourceForm(shortname);
    });

    if (host) host.replaceChildren(stack);
    return stack;
}

/** Clear the touch-armed state from every scissors cut on the board,
 * optionally sparing one.
 *
 * Arming is document-wide state (only one cut should ever show its
 * scissors at a time), so disarming has to be too. Scoping the sweep to
 * the pressed row's own note body -- which is what it used to do -- left
 * an armed cut on note A showing forever once the press moved to note B,
 * because nothing in note B could see note A's cuts.
 */
function wbDisarmCuts(except) {
    document.querySelectorAll('.wb-note-cut[data-wb-armed]').forEach((el) => {
        if (el !== except) delete el.dataset.wbArmed;
    });
}

// Any press that is not the arming press itself disarms: tapping another
// note, the canvas, or a toolbar all put the scissors away. Capture phase,
// so this runs before the row's own pointerdown handler re-arms its cut.
if (typeof document !== 'undefined' && !globalThis.__wbCutDisarmWired) {
    globalThis.__wbCutDisarmWired = true;
    document.addEventListener('pointerdown', (e) => {
        // A press on the armed cut itself (the scissors button, or the gap
        // strip around it) is the second tap the arming exists for.
        if (e.target && e.target.closest && e.target.closest('.wb-note-cut')) return;
        wbDisarmCuts(null);
    }, true);
    // Keyboard dismissal, to match every other transient affordance here.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') wbDisarmCuts(null);
    }, true);
}

/** Build one child-task row for a note body.
 *
 * `options.scissors` (issue #874): the cut *after* this row, only when
 * another visible checklist row follows. The last row never gets one.
 * The cut is a sibling of the row (see buildChecklistRow()), so this
 * returns a DocumentFragment of `[row, cut]` when scissors are asked
 * for, and the row alone otherwise -- the caller always `appendChild`s
 * the return value. */
function wbBuildChildRow(childVm, options) {
    const child = childVm.task;
    const markup = globalThis.NoodleNoteMarkup;
    const opts = options || {};

    // Markup from components/note/note-markup.js, listeners from here (#1249).
    //
    // The zones, classes, ARIA and glyphs this row is made of used to be typed
    // out twice -- once here and once in <np-note>'s _buildRow() -- which is
    // the duplication that made Storybook a second drawing of the note rather
    // than the place it is designed. One builder now, and the view-model
    // derivation below is the part that stays here, because it reads plan text
    // and Storybook has none.
    const dateSuggestion = wbTaskDateSuggestions(child)[0];
    const planningType = wbTaskPlanningType(child);
    const languageHint = wbActivityLanguageHint(child.name);
    const { row, refs } = markup.buildChecklistRow({
        name: child.name,
        complete: childVm.complete,
        percent: childVm.percent,
        // Decided in wbBuildNoteViewModel() from this child's own
        // { completed, total } -- see wbIsPartlyComplete(). Only a summary can
        // be mixed, and buildChecklistRow() re-checks that against
        // `hasChildren` below. It reports the children's state and does not
        // control it: checking a summary calls wbToggleChildComplete(), which
        // writes 100%/0% onto this row's own markdown line only, and its
        // children keep their own percentages.
        indeterminate: childVm.indeterminate,
        hasChildren: childVm.hasChildren,
        childCount: childVm.childCount,
        deliverable: child.deliverable,
        date: dateSuggestion ? {
            text: dateSuggestion.raw,
            label: `Attach the detected date ${dateSuggestion.raw} (${dateSuggestion.date}) to ${child.name}`,
        } : null,
        coach: (languageHint || planningType) ? {
            glyph: planningType === 'product' ? 'P' : planningType === 'activity' ? 'A' : '\u2726',
            suspected: !!languageHint && !planningType,
            label: planningType
                ? `Planning hint for ${child.name}: this is a ${planningType}`
                : `Planning hint for ${child.name}: this wording may describe an activity`,
        } : null,
        depHandle: true,
        scissors: opts.scissors ? {
            label: `Split note after ${child.name}`,
        } : null,
    });

    // ── Behaviour ──────────────────────────────────────────────────────
    // The row itself is a peek target on a summary row, so a click on the
    // checkbox must not also drill in.
    refs.checkbox.addEventListener('click', (e) => e.stopPropagation());
    refs.checkbox.addEventListener('change', (e) => {
        const checked = e.detail.checked;
        // spawnConfetti() appends its particles to document.body and they are
        // styled by `.confetti-particle` in views/kanban.css, so this stays a
        // light-DOM effect fired against the host. Particles created inside the
        // shadow root would lose that stylesheet and render as bare divs.
        if (checked && typeof spawnConfetti === 'function') {
            spawnConfetti(refs.checkbox);
        }
        wbToggleChildComplete(child, checked);
    });

    if (refs.dateBtn) {
        refs.dateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            wbToggleDateMenu(child.name, dateSuggestion, refs.dateBtn);
        });
    }

    if (refs.countBadge) {
        refs.countBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            wbTogglePeekFor(child.name, refs.countBadge);
        });
        // The badge's own click already stopPropagation()s, so this row-level
        // listener only ever fires for a click on the row's own name/blank
        // area -- the issue's "click a todo's child-count badge, or the todo
        // row itself" affordance. `.wb-note-row-drillable` comes with the
        // badge, from the builder.
        row.addEventListener('click', () => wbTogglePeekFor(child.name, refs.countBadge));
    }

    // No per-row coach button or dependency handle to wire: both are rail
    // controls now (wbWireRowRails()), shared by every row of this note and
    // pointed at whichever row is active. The row carries what they need to
    // know in `data-wb-row-coach` / `data-wb-row-dep`, written by the builder.

    wbAppendChildResourceControls(refs.peopleSlot, childVm, refs.assignBtn);

    if (refs.scissors) {
        const parentName = opts.parentName;
        const stop = (e) => e.stopPropagation();
        refs.scissors.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const from = parentName || (row.closest && row.closest('.wb-note') && row.closest('.wb-note').dataset.wbTask);
            if (from) wbSplitNoteAtChild(from, child.name);
        });
        refs.scissors.addEventListener('mousedown', stop);
        refs.scissors.addEventListener('pointerdown', stop);
        // Touch has no hover, so a press on the row above the cut arms it
        // -- the scissors become visible, then a second tap fires click.
        // Fine pointers already get hover-reveal on the gap itself, so a
        // mouse press must NOT arm: it has no second tap to spend, and the
        // armed cut would then outlive the press (#874 follow-up -- clicking
        // a row's count badge left the scissors showing on a note that had
        // since lost focus).
        row.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            // A press aimed at one of the row's own controls -- the count
            // badge, the checkbox, the date or assign buttons -- is that
            // control's gesture, not a bid to split the note.
            if (e.target && e.target.closest && e.target.closest('button, input, np-resource-stack')) return;
            wbDisarmCuts(refs.cut);
            if (refs.cut) refs.cut.dataset.wbArmed = 'true';
        });
    }

    if (refs.cut) {
        const frag = document.createDocumentFragment();
        frag.append(row, refs.cut);
        return frag;
    }
    return row;
}

// ── Row rails ───────────────────────────────────────────────────────────
//
// The planning hint and the dependency handle, drawn outside the card level
// with whichever row the pointer or the keyboard is on. See buildNoteCard()
// in components/note/note-markup.js for why they left the row's gutter and
// why they are a sibling of the card rather than a child of it.
//
// One pair per note, moved to the active row, rather than a pair per row:
// only one row can be active at a time, so a note with twenty rows still has
// two rail buttons. The pair reads the row it is currently serving from its
// own dataset at event time -- the same trick the note's header controls use
// with `fo.dataset.wbTask` -- so a re-render that rebuilds every row does not
// leave a rail wired to a row that no longer exists.

/**
 * Leaving the card to reach a rail button means crossing the --wb-rail-gap
 * of board between them, which is a `pointerleave` on the card. Hiding on that would make the
 * buttons unreachable -- the pointer moves toward one and it disappears --
 * so a hide is scheduled rather than immediate, and entering either button
 * cancels it. The buttons also carry transparent padding back toward the card
 * so the gap itself is inside their hit box; this timeout only has to cover
 * the pointer being between the two boxes for a frame or two.
 */
const WB_RAIL_HIDE_MS = 140;

function wbWireRowRails(entry) {
    const { card, body, rails, railHint, railDep } = entry.refs;
    let hideTimer = null;

    const cancelHide = () => {
        if (hideTimer === null) return;
        clearTimeout(hideTimer);
        hideTimer = null;
    };
    const hideNow = () => {
        cancelHide();
        railHint.hidden = true;
        railDep.hidden = true;
        rails.dataset.wbRailRow = '';
    };
    const scheduleHide = () => {
        cancelHide();
        hideTimer = setTimeout(hideNow, WB_RAIL_HIDE_MS);
    };
    entry.railsHide = hideNow;

    // Delegated, so rows rebuilt by wbUpdateNoteNode() need no wiring of their
    // own. `pointerover` rather than `mouseenter` because it bubbles; a move
    // within one row re-runs this, which is cheap and keeps the rails right
    // where the row has reflowed under the pointer.
    card.addEventListener('pointerover', (e) => {
        const row = e.target.closest && e.target.closest('.wb-note-row');
        if (!row || !card.contains(row)) return;
        cancelHide();
        wbShowRowRails(entry, row);
    });
    // Touch has no hover at all, so a tap is the only way in. `pointerdown`
    // covers it and costs a mouse user nothing -- they have already been
    // served by `pointerover` before the button goes down.
    card.addEventListener('pointerdown', (e) => {
        const row = e.target.closest && e.target.closest('.wb-note-row');
        if (!row || !card.contains(row)) return;
        cancelHide();
        wbShowRowRails(entry, row);
    });
    card.addEventListener('pointerleave', scheduleHide);

    // Keyboard: a row has no focus of its own, but its controls do, so the
    // rails follow whatever inside a row has focus.
    card.addEventListener('focusin', (e) => {
        const row = e.target.closest && e.target.closest('.wb-note-row');
        if (!row) return;
        cancelHide();
        wbShowRowRails(entry, row);
    });

    for (const btn of [railHint, railDep]) {
        btn.addEventListener('pointerenter', cancelHide);
        btn.addEventListener('pointerleave', scheduleHide);
        btn.addEventListener('focus', cancelHide);
        btn.addEventListener('blur', scheduleHide);
    }

    // A scroll inside the note moves the row out from under its rails, so they
    // are re-placed against the row they are already serving -- which also
    // hides them once that row scrolls out of the body's visible band.
    body.addEventListener('scroll', () => {
        const name = rails.dataset.wbRailRow;
        if (!name) return;
        const row = wbFindRowByTask(body, name);
        if (row) wbShowRowRails(entry, row);
        else hideNow();
    });

    railHint.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = rails.dataset.wbRailRow;
        if (name) wbToggleCoachingMenu(name, railHint);
    });
    railDep.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const name = rails.dataset.wbRailRow;
        if (name && typeof wbBeginRowDepDrag === 'function') {
            wbBeginRowDepDrag(name, e.clientX, e.clientY);
        }
    });
    railDep.addEventListener('touchstart', (e) => {
        const name = rails.dataset.wbRailRow;
        if (name && typeof wbRowDepHandleTouchStart === 'function') {
            wbRowDepHandleTouchStart(e, name);
        }
    }, { passive: false });
    railDep.addEventListener('click', (e) => e.stopPropagation());
}

/** The checklist row for `taskName` inside one note's body, or null. */
function wbFindRowByTask(body, taskName) {
    return body.querySelector(
        `.wb-note-row[data-wb-row-task="${(window.CSS && CSS.escape)
            ? CSS.escape(taskName) : taskName}"]`);
}

/**
 * Put this note's rail buttons level with `row` and show the ones it asks for.
 *
 * Geometry is read through bounding boxes and divided back out by the board's
 * own zoom, rather than walked up `offsetTop`: the rails hang off the
 * <foreignObject> and the row sits two positioned ancestors deeper inside a
 * scroller, so an offset chain would have to know about both. A rect is the
 * same measurement whatever the chain, and `scale` converts it from screen
 * pixels back into the layout pixels the rails are positioned in.
 */
function wbShowRowRails(entry, row) {
    const { body, rails, railHint, railDep } = entry.refs;

    // Measured from the rails' own box, not the card's: the rails are
    // positioned inside it, and it does not always share the card's scale.
    // Under a zoomed board Chromium lays the absolutely positioned rails layer
    // out at screen size while the card is scaled (329 layout px against the
    // card's 300 at 1.095), so dividing by the card's scale left the rail off
    // its row by (zoom - 1) x its offset -- 8.6px on a mid-note row.
    const railsRect = rails.getBoundingClientRect();
    const scale = rails.offsetHeight ? (railsRect.height / rails.offsetHeight) : 1;
    if (!scale) return;
    const rowRect = row.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();

    // Scrolled out of the body's visible band: no rails, rather than rails
    // floating beside the header or the footer.
    const midpoint = rowRect.top + rowRect.height / 2;
    if (midpoint < bodyRect.top || midpoint > bodyRect.bottom) {
        railHint.hidden = true;
        railDep.hidden = true;
        return;
    }

    rails.dataset.wbRailRow = row.dataset.wbRowTask || '';
    // The row's midpoint. `.wb-note-rail` pulls itself up by half its own
    // height from here -- see the transform on that rule for why the halving
    // is not done here.
    const top = (midpoint - railsRect.top) / scale;
    railHint.style.top = `${top}px`;
    railDep.style.top = `${top}px`;

    let coach = null;
    try {
        coach = row.dataset.wbRowCoach ? JSON.parse(row.dataset.wbRowCoach) : null;
    } catch (err) {
        coach = null; // a malformed stash is a missing hint, not a broken note
    }
    if (coach) {
        railHint.textContent = coach.glyph;
        railHint.classList.toggle('suspected-activity', !!coach.suspected);
        railHint.title = coach.label;
        railHint.setAttribute('aria-label', coach.label);
        railHint.hidden = false;
    } else {
        railHint.hidden = true;
    }

    if (row.dataset.wbRowDep === 'true') {
        const name = row.dataset.wbRowTask || '';
        const label = `Draw a dependency from "${name}": drag to the task that depends on it`;
        railDep.title = label;
        railDep.setAttribute('aria-label', label);
        railDep.hidden = false;
    } else {
        railDep.hidden = true;
    }
}

/**
 * Append a small avatar per already-assigned resource to the right-hand end
 * of a checklist row -- mirrors the note footer's own `.wb-note-avatar`
 * treatment (wbGetInitials(), same initials), just smaller, since several
 * may sit in one row.
 *
 * This used to also append a second "+" bubble (`.wb-note-assign-bubble`,
 * issue #1162) opening its own dropdown. Every row therefore rendered *two*
 * resource-assign controls: that bubble and the `.wb-note-row-resource` "+"
 * wbBuildChildRow() adds above, both always visible, both labelled "Assign a
 * resource to <name>", opening two different menus over two different
 * resource lists. They arrived from different issues under the same epic
 * (#878) and were never reconciled. The bubble is gone; the survivor is the
 * `.wb-note-row-resource` control, which reads the same plan front matter
 * either way, shows names and roles rather than raw shortnames, can
 * *un*assign, and writes through PlanModel rather than a second regex
 * line-rewriter. The bubble's better behaviours -- menu semantics, roving
 * arrow keys, viewport flipping -- moved onto wbOpenSmartMenu() so the date
 * menu gained them too.
 */
function wbAppendChildResourceControls(slot, childVm, assign) {
    const child = childVm.task;
    const resources = childVm.resources || [];

    // One control, never two. The slot used to hold the avatars *and* a dashed
    // "+" beside them, which is two things in one 20px column that open the
    // same menu: the chips already do, since #1246 wired `resource-activate`
    // to wbToggleResourceMenu() below. So a row with people on it shows the
    // people, and clicking them is how you change who they are; a row with
    // nobody shows the empty circle, which is the only case where there is
    // nothing to click instead.
    if (resources.length) {
        // No `size`: the attribute writes --np-avatar-size as an *inline*
        // style, which outranks both `.wb-note-row-avatar`'s own value and the
        // narrow-tier container query that is supposed to shrink the chips.
        // Passing 14 here is what pinned every row chip at 14px and made both
        // of those rules dead letters. CSS owns the size now.
        const stack = wbFillResourceStack(null, resources, wbRowAvatarCap(), null, child.name);
        stack.setAttribute('class', 'wb-note-row-avatar');
        slot.appendChild(stack);
        return;
    }

    // `aria-haspopup`/`aria-expanded` are declared by the builder rather than
    // set once wbOpenSmartMenu() has run: a screen reader reaching a
    // never-opened row must still be told this opens a menu.
    assign.addEventListener('click', (e) => {
        e.stopPropagation();
        wbToggleResourceMenu(child.name, assign);
    });
    slot.appendChild(assign);
}

/**
 * "Add task..." row (issue #1104, part of epic #1090): an always-present,
 * empty checklist row at the bottom of every note's body, so a new child
 * task can be typed in and committed on the spot -- previously the only
 * ways to add one were dragging a noodle from another note in, editing the
 * outline/markdown by hand, or (only for a still-freeform note -- see
 * wbIsFreeformNote()) "Promote to task". Styled like an ordinary
 * .wb-note-row (same padding, hover and lead-zone rhythm, views/
 * whiteboard.css) with a borderless italic text <input> where the name
 * would sit, so it reads as one more slot rather than a form bolted onto
 * the card.
 *
 * Appended for every note, free-form ones included -- see
 * wbUpdateNoteNode()'s own comment at the append site for why the
 * `!freeform` gate this row used to carry is gone. An empty italic
 * placeholder is the lightest affordance the board has; it states what the
 * row is for and asks for nothing, which is the side of #885's "nothing
 * prompts for detail" that matters.
 *
 * Deliberately its own `.wb-note-add-row` class rather than sharing
 * `.wb-note-row` (views/whiteboard.css gives it the identical padding/
 * hover/layout rhythm on its own, and since #1250 the identical lead-zone
 * columns as well -- the input is offset by a checkbox's
 * --np-checkbox-target so this row's text lines up with the names above it
 * at every container-query tier; the two rules have to move together, and
 * the comment above `.wb-note-add-row` in views/whiteboard.css says so
 * from its end):
 * several existing call sites -- both here
 * (peek/menu wiring) and in tests -- find a real child row via
 * `.wb-note-row` then assume `.wb-note-row-name` exists on it; sharing the
 * class would make this placeholder row match that query too and break
 * every one of them the moment a checklist note (i.e. almost any of them)
 * renders it.
 */
function wbBuildAddChildRow(taskName) {
    // Markup from components/note/note-markup.js (#1249), listeners from here.
    const { row, refs } = globalThis.NoodleNoteMarkup.buildAddRow(taskName);
    const input = refs.input;

    // Clicking anywhere on the row -- its lead gutter and its own padding,
    // not just the input itself -- focuses the input, matching
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
        // The peek's pin (#1291): put this child on the board as a note of
        // its own, where the peek was. Same wbCommitAddNotes() the outline's
        // pin and the picker's "Add" call -- only the placement differs, and
        // only as a starting point for the usual free-space scan.
        onPin: (task, rect) => wbPinTaskFromPeek(task.name, rect),
        isPinned: (task) => wbTaskIsOnBoard(task.name),
    });
}

/**
 * Pin `taskName` to the board from the peek popover (issue #1291), landing
 * the new note at the popover's own position -- "pin that note to the
 * whiteboard (at that position)", verbatim.
 *
 * `rect` is the popover's client rect, captured before it closed, and the
 * point taken from it is its top-*right*: the peek is anchored over the note
 * whose badge opened it, so its top-left is inside that note and the
 * free-space scan starting there would step the new note down past the whole
 * parent card before it found room. Starting just clear of the popover's
 * right edge puts the note beside where the user was looking, which is what
 * "at that position" can mean on a board that will not stack two notes.
 * wbClientToBoard() is the same screen-to-board conversion every other
 * gesture on this canvas makes. Without a rect (or without
 * the converter, in a build where whiteboard-groups.js has not loaded) the
 * add falls back to ordinary viewport placement rather than refusing: the
 * user asked for the note, and the position is the refinement.
 */
function wbPinTaskFromPeek(taskName, rect) {
    if (!taskName) return false;
    let at = null;
    if (rect && typeof wbClientToBoard === 'function') {
        at = wbClientToBoard(rect.right, rect.top);
    }
    return wbCommitAddNotes([taskName], at ? { at } : {});
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
    document.removeEventListener('keydown', wbSmartMenuKeydown, true);
}

/** A smart menu's focusable choices, in DOM order. Prefers explicit menu
 * items -- note `menuitemcheckbox`, not just `menuitem`: the resource menu's
 * choices toggle, so a bare `[role="menuitem"]` selector would match none of
 * them and fall through to the button sweep below by accident. Falls back to
 * every button for the date menu, which is a real dialog (a heading, a
 * question, four choices) rather than a list of menu items. */
function wbSmartMenuItems(popup) {
    const items = popup.querySelectorAll(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]');
    return Array.from(items.length ? items : popup.querySelectorAll('button'));
}

function wbSmartMenuOutsideClick(event) {
    if (!wbSmartMenuState) return;
    if (wbSmartMenuState.popup.contains(event.target) || wbSmartMenuState.trigger.contains(event.target)) return;
    wbCloseSmartMenu();
}

/**
 * Escape closes and restores focus to the trigger; Arrow/Home/End rove
 * between choices. The roving half came from the assign bubble's own menu
 * (#1162) when the two assign controls were merged -- this menu previously
 * focused nothing on open and handled no arrow keys, so it was reachable by
 * Tab only. The date menu shares this handler and gains the same.
 */
function wbSmartMenuKeydown(event) {
    if (!wbSmartMenuState) return;
    const { popup, trigger } = wbSmartMenuState;

    if (event.key === 'Escape') {
        event.preventDefault();
        wbCloseSmartMenu();
        if (trigger) trigger.focus();
        return;
    }

    const items = wbSmartMenuItems(popup);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[index < 0 ? 0 : (index + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
        event.preventDefault();
        items[0].focus();
    } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1].focus();
    }
}

function wbOpenSmartMenu(taskName, trigger, popup) {
    wbCloseSmartMenu();
    if (wbCoachingMenuState) wbCloseCoachingMenu();
    if (typeof wbCloseNoteMenu === 'function') wbCloseNoteMenu();
    document.body.appendChild(popup);

    // Positioned like wbOpenNoteMenu(): clamped into the whiteboard's own
    // safe band rather than the raw viewport, flipped above the trigger when
    // there is more room there, and given a max-height for whichever side it
    // lands on (`.wb-smart-menu` scrolls past that). The previous rule had no
    // flip and no max-height, so a note low on the canvas opened a menu whose
    // lower half was unreachable. Ported from the assign bubble's own menu
    // (#1162) when the two assign controls were merged.
    const edgeGap = 8;
    const bounds = (typeof wbNoteMenuSafeBounds === 'function')
        ? wbNoteMenuSafeBounds(edgeGap)
        : { top: edgeGap, bottom: window.innerHeight - edgeGap };
    const rect = trigger.getBoundingClientRect();
    const popupHeight = popup.getBoundingClientRect().height;
    const width = Math.max(240, popup.offsetWidth || 0);

    let left = Math.min(rect.left, window.innerWidth - width - edgeGap);
    left = Math.max(edgeGap, left);

    const spaceBelow = bounds.bottom - (rect.bottom + 6);
    const spaceAbove = (rect.top - 6) - bounds.top;

    let top;
    if (popupHeight <= spaceBelow || spaceBelow >= spaceAbove) {
        top = rect.bottom + 6;
        popup.style.maxHeight = `${Math.max(80, Math.min(popupHeight, spaceBelow))}px`;
    } else {
        const height = Math.max(80, Math.min(popupHeight, spaceAbove));
        top = rect.top - 6 - height;
        popup.style.maxHeight = `${height}px`;
    }
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    trigger.setAttribute('aria-expanded', 'true');
    wbSmartMenuState = { taskName, trigger, popup };
    setTimeout(() => {
        document.addEventListener('mousedown', wbSmartMenuOutsideClick, true);
        document.addEventListener('keydown', wbSmartMenuKeydown, true);
    }, 0);

    const first = wbSmartMenuItems(popup)[0];
    if (first) first.focus();
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
    // role="menu", not the role="dialog" this used to carry: every child but
    // the heading is a choice, and a menu is what the trigger's own
    // aria-haspopup advertises. The heading and the empty-state line are
    // marked presentational so the menu's only children are menuitems.
    const popup = document.createElement('section');
    popup.className = 'wb-smart-menu wb-resource-menu';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', `Assign resources to ${taskName}`);
    const heading = document.createElement('strong');
    heading.setAttribute('role', 'presentation');
    heading.textContent = 'Quick assign';
    popup.appendChild(heading);
    const resources = wbResourceOptionsFromPlanText(wbLastPlanText);
    if (!resources.length) {
        const empty = document.createElement('p');
        empty.setAttribute('role', 'presentation');
        empty.textContent = 'No resources defined yet.';
        popup.appendChild(empty);
    }
    for (const resource of resources) {
        const assigned = wbTaskHasResource(taskName, resource.shortname);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wb-resource-choice';
        button.setAttribute('role', 'menuitemcheckbox');
        button.setAttribute('aria-checked', assigned ? 'true' : 'false');
        button.textContent = `${assigned ? '✓ ' : ''}${resource.name}`;
        button.title = resource.role ? `${resource.name} — ${resource.role}` : resource.name;
        button.setAttribute('aria-label', `${assigned ? 'Unassign' : 'Assign'} ${resource.name}`);
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
    const rects = items.map(item => ({
        x: item.x || 0, y: item.y || 0,
        width: item.width || WB_NOTE_DEFAULT_WIDTH,
        height: item.height || WB_NOTE_DEFAULT_HEIGHT,
    }));
    const wanted = { x, y, width, height };
    if (rects.some(rect => wbRectsOverlap(wanted, rect, 8)) && typeof wbCurrentViewportBoardRect === 'function') {
        const free = wbFindNearestFreePosition(rects, wanted, wbCurrentViewportBoardRect(), width, height);
        if (free) { x = free.x; y = free.y; }
    }
    items.push({ task: name, x: Math.round(x), y: Math.round(y), colour: '', width, height, collapsed: false });
    if (wbCommitMarkdown(updatePlanWhiteboardText(nextText, items))) {
        wbRevealNewNote(name);
    }
    return name;
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
    // A menu's children must be menu items. Without this the implicit `list`
    // and `listitem` roles sat unowned between the menu and its buttons -- only
    // the colour section's two wrappers carried `role="presentation"` (#1247).
    list.setAttribute('role', 'none');
    menu.appendChild(list);

    // A thought is always light grey (see wbThoughtFill()), so it has no
    // colour to choose.
    if (!wbIsThoughtNote(taskName)) wbAppendColourMenuSection(list, taskName);
    wbAppendStructureMenuSection(list, taskName);
    // A thought has no task to open, park, unlink or take off the board and
    // leave behind -- see wbAppendThoughtMenuSection().
    if (wbIsThoughtNote(taskName)) {
        wbAppendThoughtMenuSection(list, taskName);
        return menu;
    }
    wbAppendPromoteMenuSection(list, taskName);
    wbAppendDemoteMenuSection(list, taskName);
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
 * The two actions only a thought has: "Promote to task", which uncomments
 * its outline line so the same card becomes a post-it (wbPromoteThought()),
 * and "Delete note", which removes the line and the row together
 * (wbDeleteThought()). No confirmation on the delete: a thought carries no
 * schedule, no subtasks and nothing else points at it, and the delete is a
 * single undo step like every other board edit.
 */
function wbAppendThoughtMenuSection(list, taskName) {
    const promoteLi = document.createElement('li');
    const promoteBtn = document.createElement('button');
    promoteBtn.type = 'button';
    promoteBtn.className = 'wb-note-menu-action wb-note-menu-promote-thought';
    promoteBtn.setAttribute('role', 'menuitem');
    promoteBtn.textContent = 'Promote to task';
    promoteBtn.title = 'Make this text note a real task in the plan, keeping its text as the task comment';
    promoteBtn.setAttribute('aria-label', `Promote ${taskName} to a task in the plan`);
    promoteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbPromoteThought(taskName);
    });
    promoteLi.appendChild(promoteBtn);
    list.appendChild(promoteLi);

    const dividerLi = document.createElement('li');
    dividerLi.className = 'wb-note-menu-divider';
    dividerLi.setAttribute('role', 'separator');
    list.appendChild(dividerLi);

    const deleteLi = document.createElement('li');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'wb-note-menu-remove wb-note-menu-delete';
    deleteBtn.setAttribute('role', 'menuitem');
    deleteBtn.textContent = 'Delete note';
    deleteBtn.title = 'Deletes this text note; it is not a task, so nothing in the plan changes';
    deleteBtn.setAttribute('aria-label', `Delete the text note ${taskName}`);
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbDeleteThought(taskName);
    });
    deleteLi.appendChild(deleteBtn);
    list.appendChild(deleteLi);
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
    // Worded for what it does. This note is already a task; what it lacks
    // is a subtask. "Promote to task" now names the thought's action (see
    // wbAppendThoughtMenuSection()), which really does make a task.
    btn.textContent = 'Make comment a subtask';
    btn.title = "Turn this note's comment into its first subtask";
    btn.setAttribute('aria-label', `Turn the comment on ${taskName} into its first subtask`);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbPromoteFreeformNote(taskName);
    });
    li.appendChild(btn);
    list.appendChild(li);
}

/**
 * "Turn into text note": the way back from "Promote to task" -- see
 * wbDemoteToThought(). Offered only where it can work, a task with no
 * subtasks, following this menu's rule that an inert item teaches the wrong
 * thing; a task other tasks depend on still gets it, and is told why not.
 */
function wbAppendDemoteMenuSection(list, taskName) {
    if (wbHasChildren(wbLastTasks, taskName)) return;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-note-menu-action wb-note-menu-demote';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = 'Turn into text note';
    btn.title = 'Take this task out of the schedule and keep it as a text note, with its comment as the text. Promote it again at any time.';
    btn.setAttribute('aria-label', `Turn ${taskName} into a text note, taking it out of the schedule`);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbDemoteToThought(taskName);
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
    // menuitemradio, not menuitem: `aria-checked` below is not supported on a
    // plain menuitem, so the selected colour was never announced (#1247).
    btn.setAttribute('role', 'menuitemradio');
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
function wbOpenNoteMenu(taskName, btn, at) {
    wbShowBoardMenu(wbBuildNoteMenu(taskName), { taskName, btn }, at);
}

/**
 * The same menu, opened by a right-click on the note (see
 * wbHandleContextMenu() in whiteboard.js) at the pointer. The note is
 * selected first, so its object toolbar is up and the toolbar's More button
 * owns the menu -- it is what Escape hands focus back to, and its
 * aria-expanded is what says the menu is open -- so the ways in are one
 * menu, not several that could drift apart.
 */
function wbOpenNoteMenuAt(taskName, clientX, clientY) {
    if (!wbNoteNodes.has(taskName)) return;
    wbOpenNoteMenu(taskName, wbNoteMenuOwner(taskName), { x: clientX, y: clientY });
}

/**
 * Select `taskName` and hand back the button its menu hangs off: the
 * object toolbar's More button. Null only in a build without the toolbar,
 * where the menu falls back to handing focus back to the canvas.
 */
function wbNoteMenuOwner(taskName) {
    wbSetSelectedNote(taskName);
    return (typeof wbObjectToolbarButton === 'function') ? wbObjectToolbarButton('more') : null;
}

/** Open the note menu from the keyboard (the context-menu key), under the
 * selected note's More button, or under the note itself without one. */
function wbOpenNoteMenuFromKeyboard(taskName) {
    const entry = wbNoteNodes.get(taskName);
    if (!entry) return;
    const btn = wbNoteMenuOwner(taskName);
    if (btn) { wbOpenNoteMenu(taskName, btn); return; }
    const rect = entry.refs.card.getBoundingClientRect();
    wbOpenNoteMenu(taskName, null, { x: rect.left, y: rect.top });
}

/**
 * The menu a right-click on bare canvas opens. Everything on it is already
 * a toolbar button or a key; the two "here" items are the reason it exists,
 * because they put the new object where you clicked rather than in the
 * middle of the screen -- the same placement a canvas double-click gives a
 * post-it (wbHandleCanvasDoubleClick()). It shares the note menu's DOM id,
 * styling and wbNoteMenuState, so opening one closes the other and the
 * outside-click and keyboard handling are the note menu's own.
 */
function wbBuildCanvasMenu(clientX, clientY) {
    const menu = document.createElement('div');
    menu.id = 'wbNoteMenu';
    menu.className = 'wb-note-menu wb-canvas-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Board options');

    const list = document.createElement('ul');
    list.className = 'wb-note-menu-list';
    list.setAttribute('role', 'none');
    menu.appendChild(list);

    const addItem = (label, title, action) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wb-note-menu-action';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            wbCloseNoteMenu();
            action();
        });
        li.appendChild(btn);
        list.appendChild(li);
    };
    const addDivider = () => {
        const li = document.createElement('li');
        li.className = 'wb-note-menu-divider';
        li.setAttribute('role', 'separator');
        list.appendChild(li);
    };

    // Converted to board space now, not when an item is picked: the board
    // can still pan or zoom while the menu is open, and the object belongs
    // where the click was on the board, not under wherever that screen
    // point has drifted to.
    const at = wbClientToBoard(clientX, clientY);
    addItem('New note here', 'A new note -- and a new task -- where you clicked (or double-click the canvas)',
        () => wbCreateNoteAt(at.x, at.y));
    addItem('Add title here', 'Free-floating text where you clicked -- no task, no card',
        () => wbCreateTextObjectAt(at.x, at.y));
    addItem('Add existing task…', 'Put a task that is already in the plan onto the board',
        () => wbOpenAddNotePicker());
    addDivider();
    addItem('Fit to content', 'Zoom to show every note (F)', () => whiteboardZoomFit());
    addItem('Zoom to 100%', 'Reset the zoom (0)', () => whiteboardZoomReset());
    addDivider();
    addItem('Plan structure', 'Show or hide the plan structure panel', () => wbToggleOutlinePanel());
    addItem('Parking lot', 'Show or hide the parked ideas', () => wbToggleParkingLotPanel());

    return menu;
}

/** Open the canvas menu at a client point -- see wbBuildCanvasMenu(). */
function wbOpenCanvasMenu(clientX, clientY) {
    const container = document.getElementById('whiteboardContainer');
    wbShowBoardMenu(wbBuildCanvasMenu(clientX, clientY),
        { taskName: null, btn: null, returnFocus: container }, { x: clientX, y: clientY });
}

/**
 * Put a built board menu (the note menu, or the canvas menu below) on
 * screen and wire it up. `state.btn` is the button that owns the menu --
 * it gets aria-expanded, and Escape hands focus back to it. The canvas menu
 * has no such button, so it passes `returnFocus` instead. `at` -- a client
 * point -- anchors the menu there instead of under `state.btn`.
 */
function wbShowBoardMenu(menu, state, at) {
    wbCloseNoteMenu();
    // One popup at a time. None of the three open paths used to close all the
    // others, so a smart menu and the note menu could sit open together (#1247).
    if (typeof wbCloseSmartMenu === 'function') wbCloseSmartMenu();
    if (typeof wbCloseCoachingMenu === 'function') wbCloseCoachingMenu();

    const btn = state.btn;
    document.body.appendChild(menu);

    const edgeGap = 8;
    const bounds = wbNoteMenuSafeBounds(edgeGap);
    // A point stands in for the button as a zero-size rect, pre-shifted by
    // the 4px gap below so the menu's corner lands on the pointer itself,
    // whichever side it opens on.
    const btnRect = at
        ? { left: at.x, right: at.x, top: at.y + 4, bottom: at.y - 4 }
        : btn.getBoundingClientRect();
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

    if (btn) btn.setAttribute('aria-expanded', 'true');
    wbNoteMenuState = state;

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
    if (wbIsThoughtNote(taskName)) {
        if (typeof wbFlashNoodleMessage === 'function') {
            wbFlashNoodleMessage('Text notes are always light grey -- promote it to a task to give it a colour');
        }
        return;
    }
    if (anchorEl && anchorEl.nodeType === 1) { wbOpenNoteMenu(taskName, anchorEl); return; }
    wbOpenNoteMenuFromKeyboard(taskName);
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

/** Where focus goes when the menu closes from the keyboard: the button
 * that owns it, or -- for the canvas menu, which no button owns -- the
 * canvas itself. */
function wbNoteMenuReturnFocus() {
    if (!wbNoteMenuState) return null;
    return wbNoteMenuState.btn || wbNoteMenuState.returnFocus || null;
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
        const btn = wbNoteMenuReturnFocus();
        wbCloseNoteMenu();
        if (btn) btn.focus();
        return;
    }

    if (e.key === 'Tab') {
        // Every item is a real <button> and nothing used to intercept Tab, so
        // focus could walk out of an open menu and leave it open behind (#1247).
        const btn = wbNoteMenuReturnFocus();
        wbCloseNoteMenu();
        if (btn) btn.focus();
        return;
    }

    const items = Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);

    // The swatch grid is a grid, and this used to walk it one swatch at a time
    // in every direction -- so ArrowDown from "Default colour" stepped through
    // all ten before reaching "Rename", and the grid's six columns were
    // invisible to the keyboard. Left/Right move within a row, Up/Down between
    // rows, and stepping off the top or bottom leaves the grid for the item
    // before or after it.
    const grid = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('.wb-note-menu-grid')
        : null;
    if (grid && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const swatches = Array.from(grid.querySelectorAll('[role="menuitemradio"]'));
        const columns = WB_NOTE_MENU_SWATCH_COLUMNS;
        const within = swatches.indexOf(document.activeElement);
        const next = within + (e.key === 'ArrowDown' ? columns : -columns);
        if (next >= 0 && next < swatches.length) {
            swatches[next].focus();
        } else {
            const edge = e.key === 'ArrowDown'
                ? items.indexOf(swatches[swatches.length - 1]) + 1
                : items.indexOf(swatches[0]) - 1;
            items[Math.max(0, Math.min(items.length - 1, edge))].focus();
        }
        return;
    }

    if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && !grid)) {
        e.preventDefault();
        items[(index + 1 + items.length) % items.length].focus();
    } else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && !grid)) {
        e.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
    } else if (grid && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        items[Math.max(0, Math.min(items.length - 1,
            index + (e.key === 'ArrowRight' ? 1 : -1)))].focus();
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
 * The rect wbCommitAddNotes() scans for free space.
 *
 * Normally the current viewport (wbCurrentViewportBoardRect(), which already
 * excludes the part of the canvas the outline panel covers). Given a
 * board-space `at` point -- the peek's pin (#1291) -- the same rect is
 * re-anchored to that point so the shelf-pack in wbFindFreeSpacePosition()
 * starts there, keeping its size so an occupied point still resolves to
 * somewhere on screen rather than off the bottom of the board.
 */
function wbAddNotesViewport(at) {
    const viewport = (typeof wbCurrentViewportBoardRect === 'function') ? wbCurrentViewportBoardRect() : null;
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return viewport;
    const base = viewport || { x: 0, y: 0, width: 1200, height: 800 };
    return { x: at.x, y: at.y, width: base.width, height: base.height };
}

/** Whether `taskName` already has a note pinned to the board right now --
 * read from the plan text rather than the DOM, so it is the same source of
 * truth the commit paths write to. */
function wbTaskIsOnBoard(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName) return false;
    if (typeof extractWhiteboardFromPlanText !== 'function' || typeof parseWhiteboardMarkdown !== 'function') {
        return false;
    }
    const key = String(taskName).toLowerCase();
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(editor.value)) || [];
    return items.some(item => item && item.task && String(item.task).toLowerCase() === key);
}

/**
 * Add `taskNames` to the board: one free-space rect per name (via
 * wbNewNoteRows() -- a single note goes beside the selected one or nearest
 * the middle of the screen, a batch is shelf-packed from the *current*
 * viewport, see whiteboard.js's wbCurrentViewportBoardRect()), appended to
 * the current rows, written and committed in a single call, and the board
 * pans to the first new note if it could not fit on screen. This is the one and only
 * place new whiteboard rows get written, whether the caller is the
 * picker's multi-select "Add" button or the empty state's "Add all
 * summary tasks" shortcut -- see this section's header comment.
 *
 * `options.at` (issue #1291) is an optional board-space point to lay the
 * batch out from instead of the viewport's own top-left: the peek popover's
 * pin passes the popover's position so a child note appears where the user
 * was looking rather than wherever the next free viewport cell happens to
 * be. It is a *starting point*, not a placement -- free-space scanning still
 * runs from there, so a pin never drops a note on top of an existing one.
 */
function wbCommitAddNotes(taskNames, options = {}) {
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
    const newRows = wbNewNoteRows(items, names, options.at);

    const nextText = updatePlanWhiteboardText(planText, items.concat(newRows));
    if (!wbCommitMarkdown(nextText)) return false;
    wbRevealNewNote(names[0]);
    return true;
}

/**
 * The rows for adding `names` to a board that already has `items`. A single
 * note is placed the way a new post-it is (wbNewNotePosition(): beside the
 * selected note, else nearest the middle of the screen); a batch, or one
 * laid out from a pin's `at` point, is shelf-packed as a tidy grid by
 * wbBuildAddNoteRows().
 */
function wbNewNoteRows(items, names, at) {
    if (names.length === 1 && !at) {
        const { x, y } = wbNewNotePosition(items, null);
        return [{ task: names[0], x, y, colour: '', width: null, height: null, collapsed: false }];
    }
    return wbBuildAddNoteRows(items, wbAddNotesViewport(at), names, {
        width: WB_NOTE_DEFAULT_WIDTH,
        height: WB_NOTE_DEFAULT_HEIGHT,
    });
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

    // Step back over the bare `---` separator that precedes the highlights
    // section (see wbOutlineRegion()), so the new task goes above it rather
    // than beneath it as a phantom-"---"-headed stray.
    const beforeLines = text.substring(0, insertIdx).split('\n');
    let cut = beforeLines.length;
    while (cut > 0 && (!beforeLines[cut - 1].trim() || beforeLines[cut - 1].trim() === '---')) cut--;
    if (beforeLines.slice(cut).some(line => line.trim() === '---')) {
        insertIdx = beforeLines.slice(0, cut).join('\n').length;
    }

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
    const newRows = wbNewNoteRows(items, [name]);

    const nextText = updatePlanWhiteboardText(withNewTask, items.concat(newRows));
    if (!wbCommitMarkdown(nextText)) return false;
    wbRevealNewNote(name);
    return true;
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
        '<np-empty-state variant="card" heading="Nothing on the board yet">',
        '<p>Start with a note. Double-click anywhere (or press <kbd>n</kbd>) to add one &mdash; each note is a task in your plan. Drag a note\'s noodle handle onto another to make it a subtask, and the structure appears in the panel on the left.</p>',
        '<button type="button" class="wb-empty-state-btn wb-empty-state-btn-primary" slot="actions" id="wbEmptyStateNewBtn">New note</button>',
        '<button type="button" class="wb-empty-state-btn" slot="actions" id="wbEmptyStateAddBtn">Add an existing task</button>',
        '<button type="button" class="wb-empty-state-btn" slot="actions" id="wbEmptyStateAddAllBtn">Add all summary tasks</button>',
        '</np-empty-state>',
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
    const closeBtn = document.createElement('np-close-button');
    closeBtn.addEventListener('close', () => wbCloseAddNotePicker());
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
 * Where one new note of `width` x `height` goes, as a top-left board point.
 *
 * - Given a board `point` (a double-click, or the canvas menu's "here"):
 *   centred on it, unless that would overlap an existing note, in which
 *   case the nearest free spot to it.
 * - Otherwise, with a note selected: beside the selected note (to its
 *   right, or the nearest free spot to there).
 * - Otherwise: the nearest free spot to the middle of the visible canvas.
 *
 * Every case prefers a spot wholly on screen (wbFindNearestFreePosition()),
 * so a new note is never parked below the viewport while a free spot is
 * showing; the caller still reveals it afterwards (wbRevealNewNote()) for
 * the case where the screen genuinely has no room left.
 */
function wbNewNotePosition(items, point, width = WB_NOTE_DEFAULT_WIDTH, height = WB_NOTE_DEFAULT_HEIGHT) {
    const gap = 24;
    const rects = (items || []).map(item => ({
        x: item.x || 0,
        y: item.y || 0,
        width: item.width || WB_NOTE_DEFAULT_WIDTH,
        height: item.height || WB_NOTE_DEFAULT_HEIGHT,
    }));
    const viewport = (typeof wbCurrentViewportBoardRect === 'function') ? wbCurrentViewportBoardRect() : null;

    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        const wanted = { x: Math.round(point.x - width / 2), y: Math.round(point.y - height / 2), width, height };
        if (!rects.some(rect => wbRectsOverlap(wanted, rect, 8))) return { x: wanted.x, y: wanted.y };
        return wbFindNearestFreePosition(rects, wanted, viewport, width, height, gap);
    }

    const selectedName = (typeof wbGetSelectedNoteTask === 'function') ? wbGetSelectedNoteTask() : null;
    const key = selectedName ? String(selectedName).toLowerCase() : null;
    const selected = key && (items || []).find(item =>
        item && item.task && item.kind !== 'group' && String(item.task).toLowerCase() === key);
    if (selected) {
        const preferred = {
            x: (selected.x || 0) + (selected.width || WB_NOTE_DEFAULT_WIDTH) + gap,
            y: selected.y || 0,
        };
        return wbFindNearestFreePosition(rects, preferred, viewport, width, height, gap);
    }

    const vp = viewport || { x: 0, y: 0, width: 1200, height: 800 };
    const centre = { x: vp.x + vp.width / 2 - width / 2, y: vp.y + vp.height / 2 - height / 2 };
    return wbFindNearestFreePosition(rects, centre, viewport, width, height, gap);
}

/**
 * Run `callback(entry)` once `taskName`'s note has rendered. A commit's
 * renderText() is async, so the note's DOM does not exist yet when the
 * commit returns. Poll briefly for it rather than guessing a delay -- a
 * slow render must still land, and a render that never happens must not
 * leave a dangling timer. Budget is generous (3s) because renderText()
 * awaits a full re-render (baseline/forecast/escalation views included),
 * which can be slow under load.
 */
function wbWhenNoteRendered(taskName, callback) {
    let attempts = 0;
    const check = () => {
        const entry = wbNoteNodes.get(taskName);
        if (entry) { callback(entry); return; }
        if (++attempts < 60) setTimeout(check, 50);
    };
    setTimeout(check, 50);
}

/**
 * Pan the board so a just-added note is in the middle of the screen if it
 * is not already on it (see whiteboardRevealNote() in whiteboard.js).
 * Queued first, then done once the note has rendered: if the whiteboard
 * view is hidden or not built yet (a note made from the ribbon with another
 * view showing), the note cannot be measured or render until it is shown,
 * and initWhiteboard() does it then instead.
 */
function wbRevealNewNote(taskName, onRendered) {
    if (typeof whiteboardQueueReveal === 'function') whiteboardQueueReveal(taskName);
    wbWhenNoteRendered(taskName, entry => {
        if (typeof whiteboardRevealNote === 'function') whiteboardRevealNote(taskName);
        if (onRendered) onRendered(entry);
    });
}

/**
 * Create a brand-new post-it: a new top-level task in the outline plus a
 * whiteboard row positioning it, committed together. The new note's title
 * goes straight into edit mode so naming it is part of the same gesture.
 *
 * Given a board point (x, y) the note is centred there; called with no
 * point it goes beside the selected note, or in the middle of the screen --
 * see wbNewNotePosition(). Either way it never lands on top of another
 * note, and the board pans to it if it had to go off screen.
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
    const existingNames = ((typeof wbOutlineTaskNames === 'function')
        ? wbOutlineTaskNames(planText)
        : (wbLastTasks || []).map(t => t && t.name).filter(Boolean))
        .concat((typeof wbParseThoughts === 'function') ? wbParseThoughts(planText).map(t => t.name) : []);
    const name = wbUniqueTaskName(existingNames, WB_NEW_NOTE_BASE_NAME);

    const width = WB_NOTE_DEFAULT_WIDTH;
    const height = WB_NOTE_DEFAULT_HEIGHT;

    const withTask = wbAppendTopLevelTask(planText, name);
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(withTask));
    const point = (Number.isFinite(boardX) && Number.isFinite(boardY)) ? { x: boardX, y: boardY } : null;
    const { x, y } = wbNewNotePosition(items, point, width, height);

    items.push({ task: name, x, y, colour: '', width, height, collapsed: false });

    if (!wbCommitMarkdown(updatePlanWhiteboardText(withTask, items))) return null;

    wbRevealNewNote(name, entry => wbBeginTitleEdit(entry));

    return name;
}

// ── Thoughts: text notes that are not tasks ─────────────────────────────
//
// See whiteboard-structure.js's "Thoughts" section for the storage: a
// commented-out task line in the outline plus an ordinary whiteboard row.
// The card is the post-it's own card (wbCreateNoteNode()), so dragging,
// resizing, colouring and renaming come for free; what differs is decided
// by `vm.thought` in wbUpdateNoteNode() and wbBuildNoteMenu().

/** Fallback text shown in an empty thought's body -- the one place a card
 * invites typing, since a thought has no task form to hold its text. */
const WB_THOUGHT_BODY_PLACEHOLDER = 'Double-click to write…';

/**
 * A text note's fill: the --np-light-grey-subtle design token, read from the
 * page, never a literal. It is read rather than written as var() because
 * wbContrastTextColour() has to measure the ink against a concrete colour.
 * Empty when the token cannot be read, which leaves the card's own default.
 */
function wbThoughtFill() {
    try {
        return getComputedStyle(document.documentElement)
            .getPropertyValue('--np-light-grey-subtle').trim();
    } catch (e) {
        return '';
    }
}

/** Whether the note on the board called `taskName` is a thought. Asked of
 * the rendered card, which wbUpdateNoteNode() flags from the view model, so
 * it agrees with what the user is looking at. */
function wbIsThoughtNote(taskName) {
    if (!taskName) return false;
    const entry = wbNoteNodes.get(taskName);
    return !!(entry && entry.fo && entry.fo.dataset.wbThought === 'true');
}

/** The body of a thought card: its text, or a quiet invitation to write
 * some. Double-click (or Enter when focused) edits it in place. */
function wbBuildThoughtBody(taskName, comment) {
    const text = document.createElementNS(XHTML_NS, 'div');
    const body = String(comment || '').trim();
    text.setAttribute('class', 'wb-note-freetext wb-note-thought-text' + (body ? '' : ' wb-note-thought-empty'));
    text.setAttribute('tabindex', '0');
    text.setAttribute('role', 'button');
    text.setAttribute('aria-label', body ? `Edit the text of ${taskName}` : `Write the text of ${taskName}`);
    text.textContent = body || WB_THOUGHT_BODY_PLACEHOLDER;
    text.dataset.wbThoughtBody = body;
    const begin = (e) => {
        e.stopPropagation();
        e.preventDefault();
        wbBeginThoughtBodyEdit(taskName, text);
    };
    text.addEventListener('dblclick', begin);
    text.addEventListener('keydown', (e) => {
        if (text.isContentEditable) return;
        if (e.key === 'Enter') begin(e);
    });
    return text;
}

/** Edit a thought's body in place. Enter or blur commits -- the body is one
 * line of plan text, so there is no newline to type -- and Escape reverts. */
function wbBeginThoughtBodyEdit(taskName, el) {
    if (!el || el.isContentEditable) return;
    const original = el.dataset.wbThoughtBody || '';
    el.contentEditable = 'true';
    el.spellcheck = true;
    el.classList.add('editing');
    el.classList.remove('wb-note-thought-empty');
    el.textContent = original;
    el.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    let settled = false;
    const finish = (commit) => {
        if (settled) return;
        settled = true;
        el.contentEditable = 'false';
        el.classList.remove('editing');
        el.removeEventListener('keydown', onKeydown);
        el.removeEventListener('blur', onBlur);
        const typed = el.textContent.replace(/\s+/g, ' ').trim();
        if (commit && typed !== original && wbSetThoughtText(taskName, typed)) return;
        el.textContent = original || WB_THOUGHT_BODY_PLACEHOLDER;
        el.classList.toggle('wb-note-thought-empty', !original);
    };
    const onKeydown = (e) => {
        e.stopPropagation(); // canvas shortcuts must not fire while typing
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('blur', onBlur);
}

/** Write a thought's body text into its outline line, in one commit. */
function wbSetThoughtText(taskName, text) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || typeof wbSetThoughtCommentInPlanText !== 'function') return false;
    const next = wbSetThoughtCommentInPlanText(editor.value, taskName, text);
    if (next === editor.value) return false;
    return wbCommitMarkdown(next);
}

/**
 * Drop a new thought on the board: a commented-out task line at the end of
 * the outline plus a row for it, in one commit -- wbCreateNoteAt()'s shape,
 * with wbAppendThought() in place of wbAppendTopLevelTask(). The name is
 * unique across tasks *and* thoughts, so promoting it later can never
 * collide with a task that already exists.
 */
function wbCreateThoughtAt(boardX, boardY) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor) return null;
    if (typeof wbAppendThought !== 'function' ||
        typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return null;
    }

    const planText = editor.value;
    const existingNames = wbOutlineTaskNames(planText)
        .concat(wbParseThoughts(planText).map(t => t.name));
    const name = wbUniqueTaskName(existingNames, WB_NEW_THOUGHT_BASE_NAME);

    const width = WB_NOTE_DEFAULT_WIDTH;
    const height = WB_NOTE_MIN_HEIGHT;

    const withThought = wbAppendThought(planText, name);
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(withThought));
    const point = (Number.isFinite(boardX) && Number.isFinite(boardY)) ? { x: boardX, y: boardY } : null;
    const { x, y } = wbNewNotePosition(items, point, width, height);

    items.push({ task: name, x, y, colour: '', width, height, collapsed: false });

    if (!wbCommitMarkdown(updatePlanWhiteboardText(withThought, items))) return null;

    wbRevealNewNote(name, entry => wbBeginTitleEdit(entry));

    return name;
}

/** wbCreateThoughtAt() beside the selected note, or in the middle of the
 * screen -- the toolbar's "Text note" button and the ribbon's "Text Note". */
function wbCreateThoughtInViewportCentre() {
    return wbCreateThoughtAt();
}

/**
 * Promote a thought to a task: uncomment its outline line. Its whiteboard
 * row already names it, so the next render finds a real task by that name
 * and the same card becomes an ordinary (free-form) post-it in place --
 * same position, size and colour, one undo step.
 *
 * Refused, with a message, when a task already has the name: uncommenting
 * would give the plan two tasks the board, dependencies and colours could
 * not tell apart (the same rule wbRenameNoteTask() enforces).
 */
function wbPromoteThought(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName || typeof wbPromoteThoughtInPlanText !== 'function') return false;
    const key = String(taskName).toLowerCase();
    if ((wbLastTasks || []).some(t => t && String(t.name).toLowerCase() === key)) {
        if (typeof wbFlashNoodleMessage === 'function') {
            wbFlashNoodleMessage(`A task is already called "${taskName}" — rename this note first.`);
        }
        return false;
    }
    const next = wbPromoteThoughtInPlanText(editor.value, taskName);
    if (next === editor.value) return false;
    return wbCommitMarkdown(next);
}

/**
 * Names of the tasks that depend on `taskName`: every task whose `depends`
 * list (the engine's parsed `[depends ...]` names) includes it. A thought is
 * not a task, so turning one of these into a thought would leave those
 * dependencies pointing at nothing.
 */
function wbTaskDependents(taskName) {
    const key = String(taskName || '').toLowerCase();
    return (wbLastTasks || [])
        .filter(t => t && Array.isArray(t.depends)
            && t.depends.some(d => String(d).toLowerCase() === key))
        .map(t => t.name);
}

/**
 * Turn a task's note back into a text note (a thought): the reverse of
 * wbPromoteThought(). Its outline line is commented out, so the task leaves
 * the schedule, and its whiteboard row is untouched, so the same card, in
 * the same place, re-renders as a text note holding the task's comment.
 * One commit, one undo.
 *
 * Refused, with a message, for a task with subtasks (they would be orphaned)
 * and for one other tasks depend on (the dependencies would dangle).
 */
function wbDemoteToThought(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName || typeof wbDemoteTaskToThoughtInPlanText !== 'function') return false;
    const say = (msg) => { if (typeof wbFlashNoodleMessage === 'function') wbFlashNoodleMessage(msg); };
    if (wbHasChildren(wbLastTasks, taskName)) {
        say(`"${taskName}" has subtasks — move or remove them before turning it into a text note.`);
        return false;
    }
    const dependents = wbTaskDependents(taskName);
    if (dependents.length) {
        say(`"${dependents[0]}"${dependents.length > 1 ? ` and ${dependents.length - 1} more` : ''} depend on "${taskName}" — remove those dependencies first.`);
        return false;
    }
    const next = wbDemoteTaskToThoughtInPlanText(editor.value, taskName);
    if (next === editor.value) return false;
    return wbCommitMarkdown(next);
}

/** Delete a thought: its outline line and its whiteboard row, one commit.
 * There is no "remove from board" for a thought -- without its row the
 * line is just a comment nobody can see from the board. */
function wbDeleteThought(taskName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !taskName || typeof wbDeleteThoughtFromPlanText !== 'function') return false;
    let next = wbDeleteThoughtFromPlanText(editor.value, taskName);
    if (next === editor.value) return false;
    const key = String(taskName).toLowerCase();
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(next))
        .filter(item => !(item && item.task && item.kind !== 'text' && String(item.task).toLowerCase() === key));
    next = updatePlanWhiteboardText(next, items);
    if (wbGetSelectedNoteTask() === taskName) wbClearNoteSelection();
    return wbCommitMarkdown(next);
}

/** wbCreateNoteAt() for a client-space point (a canvas double-click). */
function wbCreateNoteAtClientPoint(clientX, clientY) {
    if (typeof wbClientToBoard !== 'function') return null;
    const point = wbClientToBoard(clientX, clientY);
    return wbCreateNoteAt(point.x, point.y);
}

/** wbCreateNoteAt() with no point: beside the selected note, or in the
 * middle of whatever is currently on screen -- the toolbar's "New post-it"
 * button, the ribbon's Whiteboard tab "Note" button (#1107, ribbon.js's
 * 'whiteboard:Note'), and the `n` keyboard shortcut. The toolbar's "Text
 * note" button used to call this too; it now makes a thought instead (see
 * wbCreateThoughtInViewportCentre()). */
function wbCreateNoteInViewportCentre() {
    return wbCreateNoteAt();
}

/**
 * Put one note's title into inline edit mode: the whole name selected, so
 * typing replaces it. Enter or blur commits, Escape reverts.
 *
 * contentEditable rather than swapping in an <input> so the text keeps its
 * exact position, font and colour while being edited -- a note's title
 * jumping half a pixel as you click it reads as a glitch on a surface that
 * is meant to feel like paper.
 *
 * `options.blank` (issue #874): start with an empty box so the next
 * keystroke *is* the name, rather than replacing a placeholder. The
 * outline still holds a unique task name (`originalName`); blurring
 * without typing restores that, so we never write a blank outline line.
 */
function wbBeginTitleEdit(entry, options) {
    if (!entry || !entry.refs || !entry.refs.title) return;
    const title = entry.refs.title;
    if (title.isContentEditable) return;

    const originalName = entry.fo.dataset.wbTask || title.textContent;
    const startBlank = !!(options && options.blank) ||
        !!(wbBlankTitleUntilNamed && wbBlankTitleUntilNamed === originalName);
    title.contentEditable = 'true';
    title.spellcheck = false;
    title.classList.add('editing');
    if (startBlank) title.textContent = '';
    title.focus();

    if (!startBlank) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(title);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    let settled = false;
    const finish = (commit) => {
        if (settled) return;
        settled = true;
        title.contentEditable = 'false';
        title.classList.remove('editing');
        title.removeEventListener('keydown', onKeydown);
        title.removeEventListener('blur', onBlur);
        if (wbBlankTitleUntilNamed === originalName) wbBlankTitleUntilNamed = null;

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

    // What was typed goes into the outline line verbatim, so inline tokens
    // work from the board just as in the editor: `Design 3d @kev` becomes a
    // 3-day task assigned to kev. But the task is then *called* `Design` --
    // that is what the scheduler parses out of the line -- and every
    // reference keyed by name (the note's whiteboard row, dependencies, the
    // clash check, the note DOM) has to use that. Keying them on the raw
    // text left the row naming a task that does not exist, and the note
    // vanished from the canvas while the outline and the markdown still
    // showed it.
    const taskName = (typeof wbTaskNameFromLine === 'function')
        ? wbTaskNameFromLine(newName)
        : String(newName).trim();
    if (!taskName) return false; // nothing but tokens: no name to give it

    // Thoughts share the namespace: a row names one or the other, and a
    // task and a thought with the same name would leave the thought's card
    // silently showing the task instead.
    const clash = (wbLastTasks || []).concat(wbLastThoughts || []).some(t =>
        t && t.name && t.name !== oldName &&
        String(t.name).toLowerCase() === taskName.toLowerCase());
    if (clash) {
        if (typeof wbFlashNoodleMessage === 'function') {
            wbFlashNoodleMessage(`Another note is already called "${taskName}".`);
        }
        return false;
    }

    // A thought's name lives on its commented-out line, which the task
    // rename below cannot see. Nothing depends on a thought, so the line and
    // the row are all there is to rename.
    const isThought = wbIsThoughtNote(oldName);
    let next = isThought
        ? wbRenameThoughtInPlanText(editor.value, oldName, taskName)
        : wbRenameTaskInPlanText(editor.value, oldName, newName);
    if (next === editor.value) return false;

    if (taskName !== oldName) {
        if (!isThought && typeof updateDependencyReferences === 'function') {
            const lines = next.split('\n');
            updateDependencyReferences(lines, oldName, taskName);
            next = lines.join('\n');
        }
        if (typeof renamePlanWhiteboardTask === 'function') {
            next = renamePlanWhiteboardTask(next, oldName, taskName);
        }
    }

    // The note's DOM is keyed by task name; re-key it now so the in-flight
    // render updates the existing node instead of building a second one
    // and leaving the old one behind until the next pass sweeps it.
    const entry = wbNoteNodes.get(oldName);
    if (wbBlankTitleUntilNamed === oldName) wbBlankTitleUntilNamed = null;

    if (entry) {
        wbNoteNodes.delete(oldName);
        wbNoteNodes.set(taskName, entry);
        entry.fo.dataset.wbTask = taskName;
        // The selected note (if any) is tracked by name too -- keep it
        // pointing at the same note through the rename (issue #1109's
        // toolbar Colour button reads this to know which note to act on).
        if (wbSelectedNoteTask === oldName) wbSelectedNoteTask = taskName;
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
 * Scissors split (issue #874): lift every visible checklist row below
 * `lastStayingChildName` off `parentName` onto a new post-it alongside.
 *
 * Outline rewrite is wbSplitChecklistAt() (pure, plan text in / plan text
 * out). This function uniquifies the new task's name, places a
 * ---whiteboard--- row (offset in X, same Y, source colour and size),
 * commits once, and starts the inline title rename with the box blank so
 * naming the new note is the next action. No window.prompt().
 *
 * Returns the new task name, or null on a no-op.
 */
function wbSplitNoteAtChild(parentName, lastStayingChildName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !parentName || !lastStayingChildName) return null;
    if (typeof wbSplitChecklistAt !== 'function' || typeof wbUniqueTaskName !== 'function' ||
        typeof wbOutlineTaskNames !== 'function' ||
        typeof extractWhiteboardFromPlanText !== 'function' ||
        typeof parseWhiteboardMarkdown !== 'function' ||
        typeof updatePlanWhiteboardText !== 'function') {
        return null;
    }

    const planText = editor.value;
    const newName = wbUniqueTaskName(wbOutlineTaskNames(planText), WB_NEW_NOTE_BASE_NAME);
    const splitText = wbSplitChecklistAt(planText, parentName, lastStayingChildName, newName);
    if (splitText === planText) return null;

    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(splitText));
    const sourceKey = String(parentName).toLowerCase();
    const source = items.find(it => it && it.task && String(it.task).toLowerCase() === sourceKey);

    const sourceEntry = wbNoteNodes.get(parentName);
    const rect = sourceEntry ? wbNoteCurrentRect(sourceEntry) : null;
    const width = (rect && rect.width) || (source && source.width) || WB_NOTE_DEFAULT_WIDTH;
    const height = (rect && rect.height) || (source && source.height) || WB_NOTE_DEFAULT_HEIGHT;
    const gap = 24;

    let colour = (source && source.colour) || '';
    if (!colour && sourceEntry && sourceEntry.refs && sourceEntry.refs.card) {
        colour = (sourceEntry.refs.card.style.getPropertyValue('--wb-note-accent') || '').trim();
    }

    let x = Math.round((rect ? rect.x : (source && source.x) || 0) + width + gap);
    const y = Math.round(rect ? rect.y : (source && source.y) || 0);

    const existingRects = items.map(item => ({
        x: item.x || 0,
        y: item.y || 0,
        width: item.width || WB_NOTE_DEFAULT_WIDTH,
        height: item.height || WB_NOTE_DEFAULT_HEIGHT,
    }));
    const wanted = () => ({ x, y, width, height });
    let guard = 0;
    while (existingRects.some(r => wbRectsOverlap(wanted(), r, 8)) && guard < 50) {
        x += width + gap;
        guard++;
    }

    items.push({
        task: newName,
        x, y,
        colour,
        width, height,
        collapsed: false,
    });

    wbBlankTitleUntilNamed = newName;
    if (!wbCommitMarkdown(updatePlanWhiteboardText(splitText, items))) {
        wbBlankTitleUntilNamed = null;
        return null;
    }

    let attempts = 0;
    const focusWhenReady = () => {
        const entry = wbNoteNodes.get(newName);
        if (entry) { wbBeginTitleEdit(entry, { blank: true }); return; }
        if (++attempts < 60) setTimeout(focusWhenReady, 50);
        else wbBlankTitleUntilNamed = null;
    };
    setTimeout(focusWhenReady, 50);

    return newName;
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
 * Only ever called for a free-form note (the `...` menu item that calls
 * this is itself only shown when wbIsFreeformNote() is true -- see
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

// ── Parking lot panel (issue #1019, restore added by #1110, slide-out +
//    drag/reorder added by #1201) ─────────────────────────────────────
//
// The "viewable/manageable" half of #1019's acceptance criteria: a simple
// list, deliberately no more than that (the issue's own words: "doesn't
// have to be fancy"). Originally a modal dialog cloned from the Add-note
// picker's floating-dialog convention; #1201 turns it into a non-modal
// slide-out panel docked to the board's right edge instead -- the board
// stays interactive underneath it (no full-screen backdrop, no
// `aria-modal`), and dragging a note's header onto it parks that note the
// same way the note's own "..." menu does, with the note shrinking away
// under it as visual confirmation. Rebuilt fresh on each open (like the
// modal it replaces) so it can never go stale across repeated opens in one
// session; unlike the modal, closing slides it back out rather than
// removing it from the DOM instantly, so #wbParkingLotPanel stays attached
// for the CSS transition's duration (see wbCloseParkingLotPanel()).
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
// the board at all. #1201 adds a second way to restore: dragging a row out
// of the panel and dropping it on the board restores it at the drop point
// instead of the first free grid cell (see wbRestoreParkedItem()'s
// `atPoint` parameter).
//
// #1201 also makes list order meaningful: each row is HTML5-draggable
// (native drag and drop, not the note system's own custom mouse/touch
// machinery -- these rows are plain list items, not SVG-positioned notes)
// and dropping one on another reorders the underlying ---parking lot---
// table via wbReorderParkedItem(), one wbCommitMarkdown() call like every
// other action here.

const WB_PARK_ITEM_DRAG_MIME = 'application/x-noodleplanner-parked-item';
const WB_NOTE_PARK_ANIM_MS = 180;
const WB_PARKING_LOT_PANEL_ANIM_MS = 200; // keep in step with .wb-parking-lot-panel's transition-duration

/** Whether the parking lot panel is currently open (slid in, not mid- or
 * post-close). Every drag/drop hook below gates on this rather than just
 * "does #wbParkingLotPanel exist", since the panel stays in the DOM for its
 * closing transition (see wbCloseParkingLotPanel()) and must not accept
 * drops during that time. */
function wbParkingLotPanelEl() {
    if (typeof document === 'undefined') return null;
    const panel = document.getElementById('wbParkingLotPanel');
    return (panel && panel.classList.contains('open')) ? panel : null;
}

/** Whether a screen point sits over the open parking lot panel -- what
 * wbFinishDrag() checks to decide "reposition the note" vs. "park it". */
function wbPointOverParkingLotPanel(clientX, clientY) {
    const panel = wbParkingLotPanelEl();
    if (!panel || typeof clientX !== 'number' || typeof clientY !== 'number') return false;
    const rect = panel.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

/** Live drop-target feedback for a note drag in progress: highlights the
 * panel and marks the dragged note itself while the pointer is over it, so
 * releasing there doesn't surprise anyone. Cheap to call every drag frame
 * (two classList toggles, no layout work beyond the containment check
 * above) and always safe to call with `active: false` even when nothing was
 * ever highlighted. */
function wbUpdateParkingLotDropHint(fo, active) {
    if (typeof document === 'undefined') return;
    const panel = document.getElementById('wbParkingLotPanel');
    if (panel) panel.classList.toggle('wb-parking-lot-panel-drop-armed', !!active);
    if (fo) fo.classList.toggle('wb-note-park-armed', !!active);
    wbUpdateParkDragGhost(fo, active);
    wbUpdateParkPlaceholder(fo, active);
}

/* The note being dragged over the parking lot panel, drawn above it.
 *
 * A note is an SVG <foreignObject> on the canvas, and the panel is an HTML
 * layer stacked over the canvas, so the note itself can only ever pass
 * *under* the panel -- the drag seemed to vanish just as it reached its
 * target. While the pointer is over the panel, a copy of the note's card
 * takes its place one layer above the panel, at exactly the note's
 * on-screen rect; the note underneath is hidden (.wb-note-ghosted) and comes
 * back the moment the pointer leaves the panel. */
let wbParkGhost = null;

function wbUpdateParkDragGhost(fo, active) {
    if (!active || !fo) {
        wbRemoveParkDragGhost();
        return;
    }
    const container = document.getElementById('whiteboardContainer');
    const content = fo.firstElementChild;
    if (!container || !content) return;
    if (!wbParkGhost || wbParkGhost.fo !== fo) {
        wbRemoveParkDragGhost();
        const ghost = document.createElement('div');
        ghost.className = 'wb-note wb-note-park-armed wb-note-drag-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        const style = fo.getAttribute('style');
        if (style) ghost.setAttribute('style', style);
        ghost.appendChild(content.cloneNode(true));
        container.appendChild(ghost);
        fo.classList.add('wb-note-ghosted');
        wbParkGhost = { fo, el: ghost };
    }
    const box = container.getBoundingClientRect();
    const rect = fo.getBoundingClientRect();
    const el = wbParkGhost.el;
    el.style.left = `${rect.left - box.left}px`;
    el.style.top = `${rect.top - box.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
}

/** Take the ghost out of the drag without removing it from the page -- the
 * park animation (wbParkDraggedNote()) plays on it. */
function wbTakeParkDragGhost() {
    const ghost = wbParkGhost;
    wbParkGhost = null;
    return ghost;
}

function wbRemoveParkDragGhost() {
    const ghost = wbTakeParkDragGhost();
    if (!ghost) return;
    ghost.el.remove();
    ghost.fo.classList.remove('wb-note-ghosted');
}

/* Where the note will land: a dotted outline at the end of the parking lot
 * list -- where wbSendNoteToParkingLot() appends it -- naming the note,
 * while the pointer is over the panel. */
function wbUpdateParkPlaceholder(fo, active) {
    const list = document.getElementById('wbParkingLotList');
    if (!list) return;
    const existing = list.querySelector('.wb-parking-lot-placeholder');
    const empty = list.querySelector('.wb-parking-lot-empty');
    if (!active || !fo) {
        if (existing) existing.remove();
        if (empty) empty.hidden = false;
        return;
    }
    if (existing) return;
    const placeholder = document.createElement('li');
    placeholder.className = 'wb-parking-lot-item wb-parking-lot-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'wb-parking-lot-item-text';
    text.textContent = fo.dataset.wbTask || '';
    placeholder.appendChild(text);
    if (empty) empty.hidden = true;
    list.appendChild(placeholder);
    if (typeof placeholder.scrollIntoView === 'function') placeholder.scrollIntoView({ block: 'nearest' });
}

/**
 * Finish parking a note that was dropped on the open panel mid-drag (issue
 * #1201): plays a brief shrink-and-fade on the note's own <foreignObject>
 * (`.wb-note-parking`, see views/whiteboard.css) so it visually collapses
 * into the panel it's about to appear in, *then* runs the exact same
 * wbSendNoteToParkingLot() the note's "..." menu action does -- one
 * wbCommitMarkdown() call, one undo step, identical result either way. The
 * animation is cosmetic only: if `entry.fo` is somehow gone (or transitions
 * are disabled) this still completes via the fallback timer.
 */
function wbParkDraggedNote(entry, taskName, ghost) {
    // Dropped over the panel, the note on show is the ghost above it
    // (wbUpdateParkDragGhost()), so that is what shrinks into the panel.
    const fo = ghost ? ghost.el : (entry && entry.fo);
    const finishPark = () => {
        const parked = wbSendNoteToParkingLot(taskName);
        if (ghost) {
            ghost.el.remove();
            // Parked, the note's own node goes with the re-render; showing it
            // again first would flash it back onto the board for a frame.
            if (!parked) ghost.fo.classList.remove('wb-note-ghosted');
        }
        if (wbParkingLotPanelEl()) wbRenderParkingLotList();
    };
    if (!fo) {
        finishPark();
        return;
    }
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        fo.removeEventListener('transitionend', finish);
        clearTimeout(timer);
        finishPark();
    };
    fo.classList.add('wb-note-parking');
    fo.addEventListener('transitionend', finish);
    // transitionend can be missed (reduced-motion, a tab backgrounded mid-
    // gesture) -- the fallback timer guarantees the park still lands.
    const timer = setTimeout(finish, WB_NOTE_PARK_ANIM_MS + 80);
}

/**
 * Convert a screen point into board coordinates, for a drag-restore drop
 * (see the canvas `drop` handler wired in wbWireParkingLotCanvasDropTarget()
 * below). Inverse of the `translate(panX, panY) scale(zoom)` transform --
 * see wbViewportToBoardRect()'s doc comment (whiteboard.js) for the same
 * relationship. Returns null if the canvas isn't on screen.
 */
function wbBoardPointFromClient(clientX, clientY) {
    if (typeof wbSvg === 'undefined' || !wbSvg) return null;
    const rect = wbSvg.getBoundingClientRect();
    const zoom = wbCurrentZoom();
    const panX = (typeof wbPanX === 'number') ? wbPanX : 0;
    const panY = (typeof wbPanY === 'number') ? wbPanY : 0;
    return {
        x: (clientX - rect.left - panX) / zoom,
        y: (clientY - rect.top - panY) / zoom,
    };
}

/** Whether a native drag carries a parked item (vs. a browser text/file
 * drag, or nothing relevant) -- checked before preventDefault()-ing a
 * dragover/drop on the canvas, so an unrelated drag onto the whiteboard is
 * never hijacked. */
function wbDragHasParkedItem(e) {
    return !!(e.dataTransfer && e.dataTransfer.types &&
        Array.prototype.includes.call(e.dataTransfer.types, WB_PARK_ITEM_DRAG_MIME));
}

/**
 * Wire the whiteboard canvas as a drop target for a parked item dragged out
 * of the panel (issue #1201's "and also back out"), restoring it at the
 * drop point (wbRestoreParkedItem()'s `atPoint`) rather than the first free
 * grid cell. Idempotent (guarded by a dataset flag) and cheap to call on
 * every panel open -- the container only exists once the whiteboard view
 * has been shown, which is the only place the panel can be opened from.
 */
function wbWireParkingLotCanvasDropTarget() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('whiteboardContainer');
    if (!container || container.dataset.wbParkDropWired) return;
    container.dataset.wbParkDropWired = '1';

    container.addEventListener('dragover', (e) => {
        if (!wbDragHasParkedItem(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    container.addEventListener('drop', (e) => {
        if (!wbDragHasParkedItem(e)) return;
        e.preventDefault();
        const itemId = parseInt(e.dataTransfer.getData(WB_PARK_ITEM_DRAG_MIME), 10);
        if (Number.isNaN(itemId)) return;
        const point = wbBoardPointFromClient(e.clientX, e.clientY);
        wbRestoreParkedItem(itemId, point);
    });
}

/**
 * Reorder the parking lot (issue #1201's "allow items ... to be ordered"):
 * moves the item `draggedId` to just before/after `targetId` (per
 * `placeAfter`) and rewrites the ---parking lot--- table in that order --
 * table order *is* display/restore order, so this is the whole of what
 * "ordered" means here. One wbCommitMarkdown() call, one undo step, same as
 * every other panel action. No-op (returns false, no commit) if either item
 * can't be found or the drop is a no-op (dropped on itself).
 */
function wbReorderParkedItem(draggedId, targetId, placeAfter) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || typeof updatePlanParkingLotText !== 'function') return false;
    if (draggedId === targetId) return false;

    const items = wbCurrentParkingLotItems();
    const fromIdx = items.findIndex(i => i && i.id === draggedId);
    if (fromIdx === -1) return false;
    const [moved] = items.splice(fromIdx, 1);

    let toIdx = items.findIndex(i => i && i.id === targetId);
    if (toIdx === -1) return false; // target vanished from underneath us -- nothing to persist
    if (placeAfter) toIdx += 1;
    items.splice(toIdx, 0, moved);

    const nextText = updatePlanParkingLotText(editor.value, items);
    const committed = wbCommitMarkdown(nextText);
    if (committed) wbRenderParkingLotList();
    return committed;
}

/** Close the panel, if open, sliding it back out before detaching it (the
 * reverse of wbOpenParkingLotPanel()'s slide-in) and returning focus to the
 * toolbar button that opened it. Safe to call when nothing is open, and
 * when a close is already in flight (a second Escape, say). */
function wbCloseParkingLotPanel() {
    const panel = document.getElementById('wbParkingLotPanel');
    if (!panel) return;
    document.removeEventListener('keydown', wbParkingLotPanelKeydown, true);

    if (panel.dataset.wbClosing) return; // already mid-close
    panel.dataset.wbClosing = '1';
    panel.classList.remove('open');

    let done = false;
    const detach = () => {
        if (done) return;
        done = true;
        panel.removeEventListener('transitionend', detach);
        clearTimeout(panel._wbDetachTimer);
        delete panel._wbDetachCleanup;
        if (panel.isConnected) panel.remove();
    };
    panel.addEventListener('transitionend', detach);
    panel._wbDetachTimer = setTimeout(detach, WB_PARKING_LOT_PANEL_ANIM_MS + 80);
    // Reachable from wbOpenParkingLotPanel() if it's asked to reopen the
    // panel while this close animation is still in flight -- cancels the
    // pending detach without running it, so the panel already on screen
    // (mid-slide-out) can just slide back in rather than being torn down
    // and rebuilt from scratch.
    panel._wbDetachCleanup = () => {
        done = true;
        panel.removeEventListener('transitionend', detach);
        clearTimeout(panel._wbDetachTimer);
    };

    wbParkingLotPanelChanged(true);
}

/** The ribbon's Whiteboard > Parking Lot button, when that tab is showing. */
function wbParkingLotRibbonButton() {
    return document.querySelector('#ribbonShell [data-scope-id="whiteboard"][data-label="Parking Lot"]');
}

/** Whether the panel is open (and not mid-close) -- the ribbon's Parking
 * Lot button reads this for its pressed state. */
function wbParkingLotPanelOpen() {
    const panel = document.getElementById('wbParkingLotPanel');
    return !!(panel && panel.classList.contains('open') && !panel.dataset.wbClosing);
}

/** Bring the ribbon's pressed state up to date after the panel opens or
 * closes; on a close, hand focus back to the button that toggles it, or to
 * the board when the ribbon's Whiteboard tab is not the one showing. */
function wbParkingLotPanelChanged(returnFocus) {
    const refreshed = (typeof refreshRibbon === 'function') ? refreshRibbon() : null;
    if (!returnFocus) return;
    Promise.resolve(refreshed).then(() => {
        const target = wbParkingLotRibbonButton() || document.getElementById('whiteboardContainer');
        if (target) target.focus();
    });
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
 * `atPoint` (issue #1201, `{x, y}` in board coordinates) places the
 * restored note centred on that point instead of the first free grid cell
 * -- what a drag out of the panel onto the board uses (see
 * wbWireParkingLotCanvasDropTarget()), so the note lands exactly where it
 * was dropped rather than wherever wbFindFreeSpacePosition() would have put
 * it. Omitted (or given a non-finite point), this falls back to the
 * original free-space placement -- the Restore button's own behaviour,
 * unchanged.
 *
 * Returns false (no-op, no commit) if the item can't be found or the
 * required helpers aren't loaded.
 */
function wbRestoreParkedItem(itemId, atPoint) {
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
    const hasDropPoint = atPoint && Number.isFinite(atPoint.x) && Number.isFinite(atPoint.y);
    let newRows;
    if (hasDropPoint) {
        newRows = [{
            task: name,
            x: Math.round(atPoint.x - WB_NOTE_DEFAULT_WIDTH / 2),
            y: Math.round(atPoint.y - WB_NOTE_DEFAULT_HEIGHT / 2),
            colour: '', width: null, height: null, collapsed: false,
        }];
    } else {
        const viewport = (typeof wbCurrentViewportBoardRect === 'function') ? wbCurrentViewportBoardRect() : null;
        newRows = wbBuildAddNoteRows(rowItems, viewport, [name], {
            width: WB_NOTE_DEFAULT_WIDTH,
            height: WB_NOTE_DEFAULT_HEIGHT,
        });
    }
    if (colour) newRows.forEach(row => { row.colour = colour; });
    next = updatePlanWhiteboardText(next, rowItems.concat(newRows));

    const remainingParked = items.filter(i => i && i.id !== itemId);
    next = updatePlanParkingLotText(next, remainingParked);

    const committed = wbCommitMarkdown(next);
    if (committed) wbRenderParkingLotList();
    return committed;
}

/**
 * Rebuild the panel's <ul> from the current parking lot items. Each row is
 * natively draggable (issue #1201): dragging it over another row and
 * dropping reorders the list (wbReorderParkedItem()); dragging it out onto
 * the board restores it at the drop point (wbWireParkingLotCanvasDropTarget()
 * reads the same WB_PARK_ITEM_DRAG_MIME payload set in `dragstart` below).
 */
function wbRenderParkingLotList() {
    const list = document.getElementById('wbParkingLotList');
    if (!list) return;

    const items = wbCurrentParkingLotItems();
    list.innerHTML = '';

    if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'wb-parking-lot-empty';
        empty.textContent = 'Nothing parked yet. Drag a note here, or use its "..." menu, to send an idea over.';
        list.appendChild(empty);
        return;
    }

    const clearDropIndicators = () => {
        list.querySelectorAll('.wb-parking-lot-item-drop-before, .wb-parking-lot-item-drop-after')
            .forEach(el => el.classList.remove('wb-parking-lot-item-drop-before', 'wb-parking-lot-item-drop-after'));
    };

    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'wb-parking-lot-item';
        li.draggable = true;
        li.dataset.wbParkedId = String(item.id);

        const handle = document.createElement('span');
        handle.className = 'wb-parking-lot-item-handle';
        handle.setAttribute('aria-hidden', 'true');
        handle.textContent = '⠿';
        li.appendChild(handle);

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

        li.addEventListener('dragstart', (e) => {
            if (!e.dataTransfer) return;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData(WB_PARK_ITEM_DRAG_MIME, String(item.id));
            e.dataTransfer.setData('text/plain', item.text);
            // Deferred a tick: adding the class synchronously would apply
            // it to the drag image itself (most browsers snapshot the
            // element before dragstart's own listeners run, but not all).
            setTimeout(() => li.classList.add('wb-parking-lot-item-dragging'), 0);
        });
        li.addEventListener('dragend', () => {
            li.classList.remove('wb-parking-lot-item-dragging');
            clearDropIndicators();
        });
        li.addEventListener('dragover', (e) => {
            if (!wbDragHasParkedItem(e)) return;
            e.preventDefault();
            e.stopPropagation(); // this is a reorder-in-progress, not a hover over the board
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const rect = li.getBoundingClientRect();
            const after = (e.clientY - rect.top) > rect.height / 2;
            li.classList.toggle('wb-parking-lot-item-drop-after', after);
            li.classList.toggle('wb-parking-lot-item-drop-before', !after);
        });
        li.addEventListener('dragleave', () => {
            li.classList.remove('wb-parking-lot-item-drop-before', 'wb-parking-lot-item-drop-after');
        });
        li.addEventListener('drop', (e) => {
            if (!wbDragHasParkedItem(e)) return;
            e.preventDefault();
            // Never let this reach wbWireParkingLotCanvasDropTarget()'s own
            // `drop` listener on #whiteboardContainer (the panel is a child
            // of that same container): a reorder within the list is not a
            // restore onto the board, and without stopping it here the
            // event bubbles up and both handlers would fire on the exact
            // same drop, restoring the item *and* reordering it.
            e.stopPropagation();
            const placeAfter = li.classList.contains('wb-parking-lot-item-drop-after');
            clearDropIndicators();
            const draggedId = parseInt(e.dataTransfer.getData(WB_PARK_ITEM_DRAG_MIME), 10);
            if (!Number.isNaN(draggedId)) wbReorderParkedItem(draggedId, item.id, placeAfter);
        });

        list.appendChild(li);
    });
}

/**
 * Open the slide-out parking lot panel -- non-modal, docked to the board's
 * right edge (issue #1201, replacing the modal dialog #1019 originally
 * shipped): every parked item with per-row "Restore" and "Remove" actions,
 * draggable for reordering and for restoring by dragging back onto the
 * board -- see this section's header comment for the full behaviour.
 * Reopening while already open (or while a just-closed panel is still
 * mid-slide-out) refreshes it in place rather than tearing it down.
 */
function wbOpenParkingLotPanel() {
    const existing = document.getElementById('wbParkingLotPanel');
    if (existing) {
        if (existing._wbDetachCleanup) {
            existing._wbDetachCleanup();
            delete existing._wbDetachCleanup;
        }
        delete existing.dataset.wbClosing;
        existing.classList.add('open');
        wbRenderParkingLotList();
        wbParkingLotPanelChanged(false);
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'wbParkingLotPanel';
    panel.className = 'wb-parking-lot-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'wbParkingLotTitle');

    const header = document.createElement('div');
    header.className = 'wb-add-note-header';
    const title = document.createElement('h2');
    title.id = 'wbParkingLotTitle';
    title.className = 'wb-add-note-title';
    title.textContent = 'Parking lot';
    const closeBtn = document.createElement('np-close-button');
    closeBtn.addEventListener('close', () => wbCloseParkingLotPanel());
    header.appendChild(title);
    header.appendChild(closeBtn);

    const intro = document.createElement('p');
    intro.className = 'wb-parking-lot-intro';
    intro.textContent = 'Good ideas, not now. Drag a note onto this panel to park it, or drag a row back onto the board to restore it.';

    const list = document.createElement('ul');
    list.id = 'wbParkingLotList';
    list.className = 'wb-parking-lot-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Parked items');

    panel.appendChild(header);
    panel.appendChild(intro);
    panel.appendChild(list);

    const container = document.getElementById('whiteboardContainer') || document.body;
    container.appendChild(panel);

    wbRenderParkingLotList();
    wbWireParkingLotCanvasDropTarget();
    document.addEventListener('keydown', wbParkingLotPanelKeydown, true);

    // Slide in on the *next* frame: appending with .open already present
    // would give the transition no "closed" state to animate from, so it
    // would just appear in place instead of sliding.
    requestAnimationFrame(() => {
        panel.classList.add('open');
        wbParkingLotPanelChanged(false);
    });
    closeBtn.focus();
}

/** Toggle the panel open/closed -- what the toolbar button's click does
 * (issue #1201). Replaces the old "always (re)open" modal behaviour: now
 * that closing is a real, visible slide-out rather than just tearing down
 * a one-shot dialog, a second press of the same button is the natural way
 * to dismiss it. */
function wbToggleParkingLotPanel() {
    const panel = document.getElementById('wbParkingLotPanel');
    if (panel && panel.classList.contains('open') && !panel.dataset.wbClosing) {
        wbCloseParkingLotPanel();
    } else {
        wbOpenParkingLotPanel();
    }
}
