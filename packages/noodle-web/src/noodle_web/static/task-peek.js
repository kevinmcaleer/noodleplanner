/**
 * Task peek popover (issue #850).
 *
 * Answers the epic's (#840) open question -- "sub tasks can also have sub
 * tasks but the note only shows one level deep until opened... should we
 * create a simplified view of this -- just task name and assigned to" --
 * with a lightweight, anchored popover: click a todo's child-count badge
 * (or the todo row itself) on a whiteboard note and this opens, listing
 * that task's own direct children (name, assignee chips, a completion
 * checkbox, and a further child-count badge if a child has its own
 * children). It is recursive: drilling into a child-with-children pushes a
 * new level onto a small breadcrumb; the breadcrumb navigates back up.
 * "Open task details" (in the popover's own header, and separately on the
 * note's `...` menu) escalates to the real task-details form.
 *
 * Deliberately reusable, not whiteboard-private: this file never reaches
 * into whiteboard-only module state (no wbLastTasks/wbGroup/plan-text
 * parsing here). Every call site hands TaskPeek.open() a plain
 * {task, children} "level" view-model plus a small set of callbacks
 * (resolveLevel/onToggle/onOpenDetails) -- see that function's own doc
 * comment for the exact shape. The only whiteboard-specific glue lives in
 * whiteboard-notes.js's wbOpenChildPeek()/wbBuildPeekLevel(), which build
 * those inputs from wbLastTasks and wire the callbacks to
 * wbToggleChildComplete()/wbOpenChildTask() -- a future consumer (a
 * simple-plan-entry view, a live-collaboration joiner interface) can open
 * the exact same popover by building its own {task, children} level and
 * callbacks, without touching this file at all. The one place this file
 * *does* lean on an existing whiteboard convention is cosmetic: peek rows
 * reuse the `.wb-note-avatar` / `.wb-note-count-badge` CSS classes
 * (views/whiteboard.css, #846/#846) so its chips/badge are pixel-identical
 * to a note's own -- see task-peek.css's header comment for the trade-off
 * that creates.
 *
 * Breadcrumb: `tpState.levels` is a small stack of {task, children}
 * levels, pushed via tpPushLevel() when the user drills into a child that
 * itself has children (from within the peek, not just from the note), and
 * truncated back to any earlier crumb via tpPopToIndex() -- genuinely new
 * state this issue introduces, not something existing note/menu code
 * already tracks. A new level's data is asked for lazily, via the
 * caller-supplied resolveLevel(taskName) callback, rather than eagerly
 * walking the whole task tree up front.
 *
 * Positioning/Escape/outside-click/focus-management deliberately mirror
 * the conventions whiteboard-notes.js's own `...` note menu established
 * for #849 (see wbOpenNoteMenu()/wbCloseNoteMenu()/wbNoteMenuKeydown()): a
 * single floating popup appended to document.body (never clipped to a
 * small host element), positioned then clamped against
 * window.innerWidth/innerHeight, a single Escape closes it and refocuses
 * the triggering element, and a capture-phase outside mousedown also
 * closes it. Only one peek is ever open at a time (`tpState` is a single
 * slot, matching wbNoteMenuState's convention), which is also what makes
 * "click the same badge again" a natural toggle-close for its caller.
 */

// ── Pure breadcrumb-stack helpers (no DOM — unit tested directly) ──────

/** Push a new level onto the breadcrumb stack (drilling into a child). */
function tpPushLevel(levels, level) {
    if (!level) return levels || [];
    return (levels || []).concat([level]);
}

/**
 * Truncate the stack back to (and including) the level at `index` -- used
 * both by "back one" (index = levels.length - 2) and by clicking any
 * earlier breadcrumb crumb directly (index = that crumb's own position).
 * Out-of-range indices clamp rather than throw, so a stale index (e.g. a
 * crumb click racing a level that has since been popped) degrades to a
 * harmless no-op-ish clamp instead of corrupting the stack.
 */
function tpPopToIndex(levels, index) {
    if (!levels || !levels.length) return [];
    const clamped = Math.max(0, Math.min(index, levels.length - 1));
    return levels.slice(0, clamped + 1);
}

/** The level currently on top of the stack (what's rendered), or null. */
function tpCurrentLevel(levels) {
    return (levels && levels.length) ? levels[levels.length - 1] : null;
}

/** Task names for each crumb, in root-to-current order -- pure, for tests. */
function tpBreadcrumbNames(levels) {
    return (levels || []).map(l => l && l.task && l.task.name).filter(Boolean);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { tpPushLevel, tpPopToIndex, tpCurrentLevel, tpBreadcrumbNames };
}

// ── DOM component ────────────────────────────────────────────────────────

const TP_EDGE_GAP = 8;

/**
 * Module state for the single peek popover (only one is ever open at a
 * time -- see the file header). Shape while open:
 * {
 *   levels: [{task, children}],  // breadcrumb stack; current = last entry
 *   anchorEl: Element,           // popover is positioned relative to this
 *   triggerEl: Element,          // gets focus back on close
 *   resolveLevel(taskName) -> {task, children} | null,
 *   onToggle(task, checked),
 *   onOpenDetails(task),
 *   onClose() (optional),
 * }
 * null while closed.
 */
let tpState = null;

/** First-plus-last-initial fallback -- delegates to whiteboard-notes.js's
 * real wbGetInitials() when it's loaded (the running app always has it
 * loaded before this file's callers ever invoke it), so avatar initials
 * stay identical between a note's own footer and this popover's rows; the
 * body below exists only so this file works standalone (e.g. a future
 * non-whiteboard consumer, or this file's own isolated unit tests). */
function tpGetInitials(name) {
    if (typeof wbGetInitials === 'function') return wbGetInitials(name);
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

/**
 * Open (or re-root, if a different task's peek was already open) the peek.
 *
 * @param {Object} opts
 * @param {Element} opts.anchorEl - the popover is positioned relative to
 *   this element's current bounding rect (e.g. a note's card), reclamped
 *   to the viewport if it would overflow -- see tpPosition().
 * @param {Element} [opts.triggerEl] - the exact control the user clicked
 *   (e.g. the badge/row); receives focus back when the peek closes.
 *   Defaults to `anchorEl`.
 * @param {{task: Object, children: Array}} opts.level - the root level to
 *   show, built by the caller (see whiteboard-notes.js's
 *   wbBuildPeekLevel()). Each entry in `children` is
 *   {task, hasChildren, childCount, complete, resources: string[]}.
 * @param {(taskName: string) => ({task, children}|null)} opts.resolveLevel -
 *   builds the level for a child being drilled into, called lazily only
 *   when the user actually drills down.
 * @param {(task: Object, checked: boolean) => void} opts.onToggle - commit
 *   a row's completion-state change; called on every checkbox click.
 * @param {(task: Object) => void} opts.onOpenDetails - escalate to the
 *   full task-details form for whichever task is the *current* level's
 *   own task (the peek's header button, not a per-row action).
 * @param {() => void} [opts.onClose] - called once the peek actually
 *   closes, for any reason (Escape, outside click, close button, or a
 *   fresh tpOpen() elsewhere replacing this one).
 */
function tpOpen(opts) {
    if (!opts || !opts.level) return;
    tpClose();

    tpState = {
        levels: [opts.level],
        anchorEl: opts.anchorEl,
        triggerEl: opts.triggerEl || opts.anchorEl,
        resolveLevel: opts.resolveLevel,
        onToggle: opts.onToggle,
        onOpenDetails: opts.onOpenDetails,
        onClose: opts.onClose,
    };

    if (tpState.triggerEl && tpState.triggerEl.setAttribute) {
        tpState.triggerEl.setAttribute('aria-expanded', 'true');
    }

    document.body.appendChild(tpBuildPopover());
    tpRender();

    document.addEventListener('mousedown', tpOutsideClick, true);
    document.addEventListener('keydown', tpKeydown, true);
}

/** Whether the peek is currently open with `taskName` as its *root* level
 * -- used by callers to implement "click the same badge again closes it"
 * without this file needing to know anything about badges. */
function tpIsOpenFor(taskName) {
    if (!tpState || !tpState.levels.length) return false;
    const root = tpState.levels[0];
    return !!(root && root.task && String(root.task.name) === String(taskName));
}

/** Close the peek, if one is open, and tear down its listeners/DOM. */
function tpClose() {
    const popover = document.getElementById('taskPeekPopover');
    if (popover) popover.remove();
    document.removeEventListener('mousedown', tpOutsideClick, true);
    document.removeEventListener('keydown', tpKeydown, true);

    const state = tpState;
    tpState = null;
    if (state) {
        if (state.triggerEl && state.triggerEl.setAttribute) {
            state.triggerEl.setAttribute('aria-expanded', 'false');
        }
        if (typeof state.onClose === 'function') state.onClose();
    }
}

/** Close and return focus to the element that opened the peek -- the
 * Escape and close-button paths both want exactly this. */
function tpCloseAndRefocus() {
    const triggerEl = tpState && tpState.triggerEl;
    tpClose();
    if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
}

function tpBuildPopover() {
    const el = document.createElement('div');
    el.id = 'taskPeekPopover';
    el.className = 'task-peek';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    return el;
}

/** Rebuild the popover's contents for the current top-of-stack level (an
 * open, a drill-down, or a breadcrumb navigation all funnel through this),
 * then reposition against the (possibly now-taller/shorter) content. */
function tpRender() {
    const popover = document.getElementById('taskPeekPopover');
    if (!popover || !tpState) return;

    const level = tpCurrentLevel(tpState.levels);
    popover.innerHTML = '';
    if (!level || !level.task) {
        // The current level's task vanished from underneath us (renamed/
        // deleted elsewhere while the peek was open) -- fail closed rather
        // than render a stale/broken level.
        tpClose();
        return;
    }

    popover.setAttribute('aria-label', `${level.task.name} subtasks`);

    if (tpState.levels.length > 1) {
        popover.appendChild(tpBuildBreadcrumb());
    }
    popover.appendChild(tpBuildHeader(level));
    popover.appendChild(tpBuildList(level));
    popover.appendChild(tpBuildAnnouncer(level));

    tpPosition(popover);

    const firstFocusable = popover.querySelector('input, button');
    if (firstFocusable) firstFocusable.focus();
}

function tpBuildBreadcrumb() {
    const nav = document.createElement('nav');
    nav.className = 'task-peek-breadcrumb';
    nav.setAttribute('aria-label', 'Peek breadcrumb');

    tpState.levels.forEach((lvl, index) => {
        if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'task-peek-crumb-sep';
            sep.setAttribute('aria-hidden', 'true');
            sep.textContent = '›';
            nav.appendChild(sep);
        }
        const isCurrent = index === tpState.levels.length - 1;
        const crumb = document.createElement('button');
        crumb.type = 'button';
        crumb.className = 'task-peek-crumb';
        crumb.textContent = lvl.task.name;
        crumb.title = lvl.task.name;
        if (isCurrent) {
            crumb.setAttribute('aria-current', 'true');
            crumb.disabled = true;
        } else {
            crumb.addEventListener('click', (e) => {
                e.stopPropagation();
                tpState.levels = tpPopToIndex(tpState.levels, index);
                tpRender();
            });
        }
        nav.appendChild(crumb);
    });

    return nav;
}

function tpBuildHeader(level) {
    const header = document.createElement('div');
    header.className = 'task-peek-header';

    const title = document.createElement('h3');
    title.className = 'task-peek-title';
    title.textContent = level.task.name;
    title.title = level.task.name;
    header.appendChild(title);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'task-peek-open-details-btn';
    openBtn.textContent = 'Open task details';
    openBtn.setAttribute('aria-label', `Open task details for ${level.task.name}`);
    openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = level.task;
        const onOpenDetails = tpState && tpState.onOpenDetails;
        // Close first: the destination is a full-page form, and leaving a
        // stale, now-unanchored popover behind (e.g. its note scrolled or
        // the window resized while the form was open) would be worse than
        // just closing it, exactly like the `...` menu closes itself
        // before acting on a pick.
        tpClose();
        if (typeof onOpenDetails === 'function') onOpenDetails(task);
    });
    header.appendChild(openBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'task-peek-close-btn';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tpCloseAndRefocus();
    });
    header.appendChild(closeBtn);

    return header;
}

function tpBuildList(level) {
    const list = document.createElement('ul');
    list.className = 'task-peek-list';

    if (!level.children || !level.children.length) {
        const empty = document.createElement('li');
        empty.className = 'task-peek-empty';
        empty.textContent = 'No subtasks';
        list.appendChild(empty);
        return list;
    }

    level.children.forEach(childVm => list.appendChild(tpBuildRow(childVm)));
    return list;
}

/** One child row: checkbox, name, assignee chips, and (if it has its own
 * children) a badge that drills the peek one level deeper -- "just task
 * name and assigned to" plus the one extra affordance the epic's own
 * question calls for (a way to keep going deeper without leaving the
 * board). Nothing else is editable from here (renaming/reassigning/
 * re-dating are explicitly out of scope -- see the issue). */
function tpBuildRow(childVm) {
    const task = childVm.task;
    const row = document.createElement('li');
    row.className = 'task-peek-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-peek-checkbox';
    checkbox.checked = !!childVm.complete;
    checkbox.setAttribute('aria-label', `Mark "${task.name}" as ${childVm.complete ? 'incomplete' : 'complete'}`);
    checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        const checked = checkbox.checked;
        // Same "instant confetti, same commit path" treatment a note's own
        // checkbox gets (see whiteboard-notes.js's wbBuildChildRow()) --
        // duplicated here (rather than routed through onToggle) because
        // spawnConfetti() is a general app-wide effect (editor-sync.js),
        // not whiteboard-specific, so calling it directly here doesn't
        // create any whiteboard coupling.
        if (checked && typeof spawnConfetti === 'function') spawnConfetti(checkbox);
        if (tpState && typeof tpState.onToggle === 'function') tpState.onToggle(task, checked);
        childVm.complete = checked;
        checkbox.setAttribute('aria-label', `Mark "${task.name}" as ${checked ? 'incomplete' : 'complete'}`);
    });
    row.appendChild(checkbox);

    const name = document.createElement('span');
    name.className = 'task-peek-row-name';
    name.textContent = task.name;
    name.title = task.name;
    row.appendChild(name);

    const avatars = document.createElement('div');
    avatars.className = 'task-peek-avatars';
    (childVm.resources || []).slice(0, 4).forEach(resource => {
        const avatar = document.createElement('div');
        avatar.className = 'wb-note-avatar';
        avatar.title = resource;
        avatar.textContent = tpGetInitials(resource);
        avatars.appendChild(avatar);
    });
    row.appendChild(avatars);

    if (childVm.hasChildren) {
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'wb-note-count-badge task-peek-count-badge';
        badge.textContent = `${childVm.childCount} ▾`;
        badge.setAttribute('aria-label', `${task.name} has ${childVm.childCount} subtasks. Peek subtasks.`);
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            tpDrillInto(task.name);
        });
        row.appendChild(badge);

        row.classList.add('task-peek-row-drillable');
        // The badge's own click already stopPropagation()s, so this only
        // ever fires for a click on the row's own name/blank area -- the
        // issue's "or the todo row itself" affordance, mirrored one level
        // deeper than the note's own equivalent.
        row.addEventListener('click', () => tpDrillInto(task.name));
    }

    return row;
}

function tpDrillInto(taskName) {
    if (!tpState || typeof tpState.resolveLevel !== 'function') return;
    const level = tpState.resolveLevel(taskName);
    if (!level) return;
    tpState.levels = tpPushLevel(tpState.levels, level);
    tpRender();
}

/** An aria-live region announcing the level just rendered, so a screen
 * reader user hears "showing N subtasks of X" on open, on drill-down, and
 * on every breadcrumb navigation -- not just silence until they explore
 * the list themselves. */
function tpBuildAnnouncer(level) {
    const live = document.createElement('div');
    live.className = 'task-peek-announcer';
    live.setAttribute('aria-live', 'polite');
    const total = (level.children || []).length;
    live.textContent = `Showing ${total} subtask${total === 1 ? '' : 's'} of ${level.task.name}`;
    return live;
}

/** Position the popover relative to its anchor: prefer just to the right
 * of the anchor, flip to the left if that would overflow, then clamp both
 * axes to the viewport -- the same "reposition rather than overflow near a
 * viewport edge" rule wbOpenNoteMenu() (issue #849) already established
 * for the note `...` menu, adapted for a side-anchored (rather than
 * below-anchored) popover. */
function tpPosition(popover) {
    const anchor = tpState && tpState.anchorEl;
    if (!anchor || !anchor.getBoundingClientRect) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();

    let left = anchorRect.right + 12;
    if (left + popRect.width > window.innerWidth - TP_EDGE_GAP) {
        left = anchorRect.left - popRect.width - 12;
    }
    if (left < TP_EDGE_GAP) {
        left = Math.max(TP_EDGE_GAP, Math.min(anchorRect.left, window.innerWidth - popRect.width - TP_EDGE_GAP));
    }

    let top = anchorRect.top;
    if (top + popRect.height > window.innerHeight - TP_EDGE_GAP) {
        top = window.innerHeight - popRect.height - TP_EDGE_GAP;
    }
    top = Math.max(TP_EDGE_GAP, top);

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

/** Outside click closes the peek -- mirrors wbNoteMenuOutsideClick()
 * (mousedown, capture phase, so it beats any click-driven UI already
 * listening on click/bubble). Only the exact triggering control is
 * excluded (not the whole anchor, e.g. a note card), matching the note
 * menu's own button-only exclusion -- so clicking elsewhere on the same
 * note (its title, another row, its drag handle) still closes the peek. */
function tpOutsideClick(e) {
    const popover = document.getElementById('taskPeekPopover');
    if (!popover) return;
    if (popover.contains(e.target)) return;
    if (tpState && tpState.triggerEl && tpState.triggerEl.contains && tpState.triggerEl.contains(e.target)) return;
    tpClose();
}

/** Escape closes the peek (and only the peek -- a second Escape with
 * nothing open is a no-op, never bubbling on to affect the board). */
function tpKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        tpCloseAndRefocus();
    }
}

if (typeof window !== 'undefined') {
    window.TaskPeek = {
        open: tpOpen,
        close: tpClose,
        isOpenFor: tpIsOpenFor,
    };
}
