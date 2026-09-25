/**
 * The genie pin: pinning a task to the whiteboard as a note of its own
 * animates the new note *out of* where the task was, rather than having it
 * just appear somewhere else on the board.
 *
 * Two phases, played on one throwaway overlay:
 *
 *  1. Slide out. The task's row slides out of the right edge of the note it
 *     sits in (or of whatever surface the pin was pressed on -- the peek
 *     popover, the outline panel), like a drawer being pulled.
 *  2. Pour in. The drawer stretches into a funnel and flows into the new
 *     note's rect: its leading edge races ahead and grows to the note's
 *     height, its trailing edge follows, and the top and bottom edges curve
 *     between the two (a smoothstep across the width), which is what reads as
 *     "genie" rather than a plain box tween. The note's own card fades in
 *     inside the funnel over the last part of the move.
 *
 * The funnel is a clip-path polygon on an element spanning the whole path,
 * filled with the new note's colour and drawn as a board object (a
 * <foreignObject> in the notes layer with a board rect, placed like a note)
 * so it pans and zooms with everything else; every frame has the same number of
 * points, so the Web Animations API interpolates between the precomputed
 * keyframes (wbGenieKeyframes()) without any per-frame script. The geometry
 * is pure (wbGeniePolygon()) and unit-tested in
 * tests/test_whiteboard_genie.mjs.
 *
 * The animation is cosmetic only. The pin commits exactly as it always has
 * (wbCommitAddNotes() in whiteboard-notes.js, one commit, one undo step);
 * the real note is merely held invisible (`.wb-note-ghosted`) until the
 * genie lands on it, and a fallback timer shows it regardless if anything
 * goes wrong. Reduced motion, the app's own "no animations" setting, or no
 * source to animate from all skip the effect and the note simply appears.
 *
 * Unpinning plays the same genie in reverse (wbGenieUnpin(), called from
 * wbRemoveNoteFromBoard()): the note drains into the funnel and slides back
 * into its row in the parent note -- or its row in the outline panel -- and
 * fades out where it has no row to go back to.
 */

/** Share of the run spent sliding out of the source surface. */
const WB_GENIE_SLIDE_SHARE = 0.35;
/** Keyframes precomputed for the clip-path (interpolated linearly between). */
const WB_GENIE_STEPS = 24;
/** Points sampled along each of the funnel's top and bottom edges. */
const WB_GENIE_EDGE_SAMPLES = 8;
/** A drawer taller than this is a popover, not a row: use its top strip. */
const WB_GENIE_MAX_SOURCE_HEIGHT = 44;
/** Used if --np-anim-duration-genie cannot be read. */
const WB_GENIE_DEFAULT_MS = 600;
/** However the animation goes, the real note is never hidden longer. */
const WB_GENIE_HOLD_TIMEOUT_MS = 4000;

/** Tasks whose note is held invisible until its genie lands. */
const wbGeniePending = new Map();

function wbGenieLerp(a, b, t) {
    return a + (b - a) * t;
}

function wbGenieEase(t) {
    const c = Math.min(1, Math.max(0, t));
    return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function wbGenieSmoothstep(t) {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

/**
 * The funnel's outline at progress `t` (0..1), as `[x, y]` points in the
 * same coordinate space as the rects given.
 *
 * `src` is the row being pinned ({left, top, right, bottom}), `edgeX` the
 * edge of the surface it slides out of, `dst` the new note's rect. The
 * drawer slides out towards whichever side the note is on -- right in the
 * usual case, left if the note landed to the left of its source.
 *
 * Always returns 2 * (WB_GENIE_EDGE_SAMPLES + 1) points: along the top edge
 * from the trailing edge to the leading one, then back along the bottom.
 */
function wbGeniePolygon(t, src, edgeX, dst) {
    const dir = ((dst.left + dst.right) / 2) >= ((src.left + src.right) / 2) ? 1 : -1;
    const width = src.right - src.left;
    const drawer = dir > 0
        ? { left: edgeX, right: edgeX + width, top: src.top, bottom: src.bottom }
        : { left: edgeX - width, right: edgeX, top: src.top, bottom: src.bottom };
    const leadOf = r => (dir > 0 ? r.right : r.left);
    const trailOf = r => (dir > 0 ? r.left : r.right);

    let lead;
    let trail;
    if (t <= WB_GENIE_SLIDE_SHARE) {
        const p = wbGenieEase(t / WB_GENIE_SLIDE_SHARE);
        lead = { x: edgeX + dir * width * p, top: src.top, bottom: src.bottom };
        trail = { x: edgeX, top: src.top, bottom: src.bottom };
    } else {
        const q = (t - WB_GENIE_SLIDE_SHARE) / (1 - WB_GENIE_SLIDE_SHARE);
        const qLead = wbGenieEase(q * 1.5);
        const qTrail = wbGenieEase((q - 0.25) / 0.75);
        lead = {
            x: wbGenieLerp(leadOf(drawer), leadOf(dst), qLead),
            top: wbGenieLerp(drawer.top, dst.top, qLead),
            bottom: wbGenieLerp(drawer.bottom, dst.bottom, qLead),
        };
        trail = {
            x: wbGenieLerp(trailOf(drawer), trailOf(dst), qTrail),
            top: wbGenieLerp(drawer.top, dst.top, qTrail),
            bottom: wbGenieLerp(drawer.bottom, dst.bottom, qTrail),
        };
    }

    const top = [];
    const bottom = [];
    for (let i = 0; i <= WB_GENIE_EDGE_SAMPLES; i++) {
        const u = i / WB_GENIE_EDGE_SAMPLES;
        const x = wbGenieLerp(trail.x, lead.x, u);
        const s = wbGenieSmoothstep(u);
        top.push([x, wbGenieLerp(trail.top, lead.top, s)]);
        bottom.push([x, wbGenieLerp(trail.bottom, lead.bottom, s)]);
    }
    return top.concat(bottom.reverse());
}

/** The clip-path keyframes for the whole run (see wbGeniePolygon()). */
function wbGenieKeyframes(src, edgeX, dst, steps = WB_GENIE_STEPS) {
    const frames = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const points = wbGeniePolygon(t, src, edgeX, dst)
            .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`)
            .join(', ');
        frames.push({ offset: t, clipPath: `polygon(${points})` });
    }
    return frames;
}

/** Whether to animate at all: honours the OS reduced-motion preference and
 * the app's own "no animations" setting (body.no-animations). */
function wbGenieMotionAllowed() {
    if (typeof document === 'undefined' || !document.body) return false;
    if (document.body.classList.contains('no-animations')) return false;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return false;
    }
    return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

/** --np-anim-duration-genie (visual-system.css), in milliseconds. */
function wbGenieDurationMs() {
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--np-anim-duration-genie').trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) return WB_GENIE_DEFAULT_MS;
    return raw.endsWith('ms') ? value : value * 1000;
}

function wbGenieRectOK(rect) {
    return !!rect && rect.width > 0 && rect.height > 0;
}

/**
 * A client rect in *board* coordinates, at the current pan and zoom -- the
 * same conversion as wbClientToBoard() (whiteboard-groups.js). The genie is
 * a board object like the notes, so that it pans and zooms with them:
 * pinning often pans the board to bring the new note on screen
 * (whiteboardRevealNote()), and a screen-space overlay would then be sliding
 * out of where the row used to be.
 */
function wbGenieToBoard(rect) {
    const svg = (typeof wbSvg !== 'undefined') ? wbSvg : null;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const zoom = (typeof wbZoom === 'number' && wbZoom > 0) ? wbZoom : 1;
    const panX = (typeof wbPanX === 'number') ? wbPanX : 0;
    const panY = (typeof wbPanY === 'number') ? wbPanY : 0;
    return {
        left: (rect.left - box.left - panX) / zoom,
        top: (rect.top - box.top - panY) / zoom,
        right: (rect.right - box.left - panX) / zoom,
        bottom: (rect.bottom - box.top - panY) / zoom,
    };
}

/**
 * Where the genie starts from, in board coordinates, read *before* the pin
 * commits (the commit re-renders the parent note, and the pinned row leaves
 * it). The task's own checklist row inside a note on the board is preferred
 * -- that is the "slides out of the note" the effect is for -- and
 * `fallback` ({rect, edgeRect}, client rects of the surface the pin was
 * pressed on) is used when the task has no row on screen, e.g. a grandchild
 * pinned from a drilled-in peek. Returns null, and so no animation, when
 * motion is off or there is no visible source at all.
 */
function wbGenieCapture(taskName, fallback) {
    if (!taskName || !wbGenieMotionAllowed()) return null;
    const container = document.getElementById('whiteboardContainer');
    if (!container || !wbGenieRectOK(container.getBoundingClientRect())) return null;

    let rect = null;
    let edgeRect = null;
    const escaped = (window.CSS && CSS.escape) ? CSS.escape(taskName) : taskName;
    const row = container.querySelector(`.wb-note .wb-note-row[data-wb-row-task="${escaped}"]`);
    if (row && wbGenieRectOK(row.getBoundingClientRect())) {
        rect = row.getBoundingClientRect();
        const note = row.closest('.wb-note');
        edgeRect = note ? note.getBoundingClientRect() : rect;
    } else if (fallback && wbGenieRectOK(fallback.rect)) {
        rect = fallback.rect;
        edgeRect = fallback.edgeRect || fallback.rect;
    }
    if (!rect) return null;
    const src = wbGenieToBoard(rect);
    const edge = wbGenieToBoard(edgeRect);
    if (!src || !edge) return null;
    const zoom = (typeof wbZoom === 'number' && wbZoom > 0) ? wbZoom : 1;
    src.bottom = Math.min(src.bottom, src.top + WB_GENIE_MAX_SOURCE_HEIGHT / zoom);
    return { src, edge };
}

/** Hold `taskName`'s note invisible until its genie lands (or the timeout). */
function wbGenieHold(taskName) {
    wbGenieRelease(taskName);
    const timer = setTimeout(() => wbGenieRelease(taskName), WB_GENIE_HOLD_TIMEOUT_MS);
    wbGeniePending.set(taskName, timer);
}

/** Whether `taskName`'s note should render held (see wbRenderNotes()). */
function wbGenieIsHeld(taskName) {
    return wbGeniePending.has(taskName);
}

/** Show `taskName`'s note, if it was being held. Safe to call repeatedly. */
function wbGenieRelease(taskName) {
    const timer = wbGeniePending.get(taskName);
    if (timer !== undefined) clearTimeout(timer);
    wbGeniePending.delete(taskName);
    const entry = (typeof wbNoteNodes !== 'undefined' && wbNoteNodes) ? wbNoteNodes.get(taskName) : null;
    if (entry && entry.fo) entry.fo.classList.remove('wb-note-ghosted');
}

/** A rendered note's board rect, from the dataset every note carries. */
function wbGenieNoteRect(fo) {
    const d = fo.dataset || {};
    const left = parseFloat(d.wbX || fo.getAttribute('x') || '0') || 0;
    const top = parseFloat(d.wbY || fo.getAttribute('y') || '0') || 0;
    const width = parseFloat(d.wbWidth || fo.getAttribute('width') || '0') || 0;
    const height = parseFloat(d.wbHeight || fo.getAttribute('height') || '0') || 0;
    if (!width || !height) return null;
    return { left, top, right: left + width, bottom: top + height, width, height };
}

/** The colour a note's card paints (wbUpdateNoteNode() sets it on the card). */
function wbGenieAccent(entry) {
    const card = entry && entry.refs && entry.refs.card;
    return card ? card.style.getPropertyValue('--wb-note-accent').trim() : '';
}

/** A board-object <foreignObject> for the genie at board rect `r`: last in
 * `layer`, so it draws above every note, and given a board rect like every
 * note's, so wbPlaceBoardObject() (whiteboard.js) draws it -- and every pan
 * or zoom tween redraws it -- in step with them. */
function wbGenieBoardObject(layer, r, content) {
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('class', 'wb-genie-ghost');
    fo.setAttribute('aria-hidden', 'true');
    fo.setAttribute('inert', ''); // the copied card's controls are not live
    fo.dataset.wbX = String(r.left);
    fo.dataset.wbY = String(r.top);
    fo.dataset.wbWidth = String(r.right - r.left);
    fo.dataset.wbHeight = String(r.bottom - r.top);
    fo.appendChild(content);
    layer.appendChild(fo);
    if (typeof wbPlaceBoardObject === 'function') wbPlaceBoardObject(fo);
    return fo;
}

/**
 * Run the genie between a row (`src`, sliding in or out at `edge`) and a
 * note's board rect `dst`, drawing `card` (a copy of the note's card) inside
 * it. Forward pours the row into the note (a pin); `reverse` drains the note
 * back into the row (an unpin) -- the same keyframes, played backwards.
 * `onDone` runs exactly once, however the run ends.
 */
function wbGenieRun({ layer, src, edge, dst, card, accent, reverse, onDone }) {
    const toRight = (dst.left + dst.right) / 2 >= (src.left + src.right) / 2;
    const edgeX = toRight ? edge.right : edge.left;
    const rowWidth = src.right - src.left;

    // The overlay spans everything the funnel passes through; the polygon is
    // expressed in its own coordinates.
    const span = {
        left: Math.min(src.left, edgeX - rowWidth, dst.left),
        top: Math.min(src.top, dst.top),
        right: Math.max(src.right, edgeX + rowWidth, dst.right),
        bottom: Math.max(src.bottom, dst.bottom),
    };
    const shift = r => ({
        left: r.left - span.left, top: r.top - span.top,
        right: r.right - span.left, bottom: r.bottom - span.top,
    });

    const funnel = document.createElement('div');
    funnel.className = 'wb-genie-funnel';
    if (accent) funnel.style.setProperty('--wb-note-accent', accent);

    // The copy of the card at the note's own spot, faded in as the funnel
    // arrives (or out as it leaves) -- the same copying the parking-lot drag
    // ghost does.
    const d = shift(dst);
    const copy = document.createElement('div');
    copy.className = 'wb-genie-note';
    copy.style.left = `${d.left}px`;
    copy.style.top = `${d.top}px`;
    copy.style.width = `${dst.right - dst.left}px`;
    copy.style.height = `${dst.bottom - dst.top}px`;
    if (card) copy.appendChild(card);
    funnel.appendChild(copy);
    const ghost = wbGenieBoardObject(layer, span, funnel);

    const duration = wbGenieDurationMs();
    let finished = false;
    let fallback = null;
    const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(fallback);
        ghost.remove();
        if (onDone) onDone();
    };
    fallback = setTimeout(finish, duration + 300);
    try {
        const timing = {
            duration, easing: 'linear', fill: 'forwards',
            direction: reverse ? 'reverse' : 'normal',
        };
        const run = funnel.animate(wbGenieKeyframes(shift(src), edgeX - span.left, d), timing);
        copy.animate(
            [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1, offset: 1 }],
            timing);
        run.addEventListener('finish', finish);
        run.addEventListener('cancel', finish);
    } catch (err) {
        finish();
        return false;
    }
    return true;
}

/**
 * Play the genie from `source` (wbGenieCapture()'s result) into the rendered
 * note `entry`, then show the real note. Always ends with the note released,
 * whether or not the animation could run.
 */
function wbGeniePlay(taskName, source, entry) {
    const fo = entry && entry.fo;
    const layer = fo && fo.parentNode;
    const dst = fo ? wbGenieNoteRect(fo) : null;
    if (!layer || !source || !dst) {
        wbGenieRelease(taskName);
        return false;
    }
    return wbGenieRun({
        layer, src: source.src, edge: source.edge, dst,
        card: fo.firstElementChild ? fo.firstElementChild.cloneNode(true) : null,
        accent: wbGenieAccent(entry),
        reverse: false,
        onDone: () => wbGenieRelease(taskName),
    });
}

// ── Unpin: the genie in reverse ─────────────────────────────────────────

/** How long an unpin waits for the task's row to re-render in its parent
 * note before giving up on the reverse genie and just fading the note out. */
const WB_GENIE_ROW_WAIT_MS = 500;

/** `taskName`'s rendered note entry, matched case-insensitively (the board's
 * rows and the plan's task names can differ in case). */
function wbGenieNoteEntry(taskName) {
    if (typeof wbNoteNodes === 'undefined' || !wbNoteNodes || !taskName) return null;
    if (wbNoteNodes.has(taskName)) return wbNoteNodes.get(taskName);
    const key = String(taskName).toLowerCase();
    for (const [name, entry] of wbNoteNodes) {
        if (String(name).toLowerCase() === key) return entry;
    }
    return null;
}

/** Whether `taskName`'s parent task has a note on the board -- where its
 * row will come back once its own note is unpinned. */
function wbGenieParentOnBoard(taskName) {
    const tasks = (typeof wbLastTasks !== 'undefined' && Array.isArray(wbLastTasks)) ? wbLastTasks : [];
    const key = String(taskName).toLowerCase();
    const task = tasks.find(t => t && t.name && t.name.toLowerCase() === key);
    return !!(task && task.parent && wbGenieNoteEntry(task.parent));
}

/**
 * Where an unpinned note drains back to, in board coordinates
 * ({src, edge, row}), or null if it is not on screen (yet). `inParent`
 * looks for the task's checklist row in its parent note; otherwise its row
 * in the open outline panel.
 */
function wbGenieFindReturnRow(taskName, inParent) {
    const escaped = (window.CSS && CSS.escape) ? CSS.escape(taskName) : taskName;
    let row = null;
    let surface = null;
    if (inParent) {
        const container = document.getElementById('whiteboardContainer');
        row = container
            ? container.querySelector(`.wb-note .wb-note-row[data-wb-row-task="${escaped}"]`) : null;
        surface = row ? row.closest('.wb-note') : null;
    } else {
        const panel = document.getElementById('whiteboardOutlinePanel');
        row = (panel && !panel.classList.contains('hidden'))
            ? panel.querySelector(`[data-task="${escaped}"]`) : null;
        surface = panel;
    }
    if (!row || !wbGenieRectOK(row.getBoundingClientRect())) return null;
    const src = wbGenieToBoard(row.getBoundingClientRect());
    const edge = wbGenieToBoard((surface || row).getBoundingClientRect());
    if (!src || !edge) return null;
    const zoom = (typeof wbZoom === 'number' && wbZoom > 0) ? wbZoom : 1;
    src.bottom = Math.min(src.bottom, src.top + WB_GENIE_MAX_SOURCE_HEIGHT / zoom);
    return { src, edge, row };
}

/**
 * Unpin `taskName`'s note with the genie played backwards: the note drains
 * into a funnel and slides back into its row in the parent note.
 *
 * `commit` is the unpin itself (wbRemoveNoteFromBoard()'s one
 * wbCommitMarkdown() call) and runs exactly as it would without the effect.
 * A copy of the note stands in for it across the commit, so nothing blinks
 * while the board re-renders; once the task's row is back on screen the
 * genie runs from the note into it, with the row held hidden until the
 * funnel lands. No row to return to (a top-level task, the outline closed)
 * fades the stand-in out instead. Motion off: just the commit.
 */
function wbGenieUnpin(taskName, commit) {
    const entry = wbGenieNoteEntry(taskName);
    const fo = entry && entry.fo;
    const layer = fo && fo.parentNode;
    const dst = fo ? wbGenieNoteRect(fo) : null;
    if (!layer || !dst || !fo.firstElementChild || !wbGenieMotionAllowed()) return commit();

    // Read before the commit: a note of the parent's own is where the row
    // comes back, and the only surface worth waiting for it to re-render on.
    const inParent = wbGenieParentOnBoard(taskName);
    const accent = wbGenieAccent(entry);
    const card = fo.firstElementChild.cloneNode(true);
    const standInContent = document.createElement('div');
    standInContent.className = 'wb-genie-standin';
    standInContent.appendChild(fo.firstElementChild.cloneNode(true));
    const standIn = wbGenieBoardObject(layer, dst, standInContent);

    if (!commit()) {
        standIn.remove();
        return false;
    }

    const fadeOut = () => {
        try {
            const fade = standInContent.animate([{ opacity: 1 }, { opacity: 0 }],
                { duration: wbGenieDurationMs() / 3, easing: 'ease-out', fill: 'forwards' });
            fade.addEventListener('finish', () => standIn.remove());
            setTimeout(() => standIn.remove(), wbGenieDurationMs());
        } catch (err) {
            standIn.remove();
        }
    };

    const started = Date.now();
    const tryStart = () => {
        const target = wbGenieFindReturnRow(taskName, inParent);
        if (!target) {
            if (inParent && Date.now() - started < WB_GENIE_ROW_WAIT_MS) {
                setTimeout(tryStart, 50);
            } else {
                fadeOut();
            }
            return;
        }
        const row = target.row;
        row.classList.add('wb-genie-row-held');
        // The run's own overlay goes up in the same task as the stand-in
        // comes down, so there is no frame without either.
        standIn.remove();
        wbGenieRun({
            layer, src: target.src, edge: target.edge, dst, card, accent,
            reverse: true,
            onDone: () => row.classList.remove('wb-genie-row-held'),
        });
    };
    setTimeout(tryStart, 0);
    return true;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        wbGeniePolygon, wbGenieKeyframes, wbGenieEase, wbGenieSmoothstep,
        WB_GENIE_SLIDE_SHARE, WB_GENIE_EDGE_SAMPLES,
    };
}
