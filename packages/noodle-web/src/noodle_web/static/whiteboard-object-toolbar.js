/**
 * The object toolbar: quick actions floating above the one selected note or
 * group, the way Obsidian's canvas does it.
 *
 *   Note   — Colour, Zoom to, Edit title, Remove from board, More
 *   Group  — Colour, Zoom to, Edit title, Remove group
 *
 * It replaced the `...` button every note used to carry in its header. The
 * header is the note's drag handle and was already crowded; a toolbar that
 * appears only on the thing you picked puts the same actions one click away
 * without spending space on every note. More opens the full note menu --
 * Rename, Unlink, Open task details, Send to parking lot, Delete task and
 * the rest -- so nothing that menu offered went away. A right-click still
 * opens that menu at the pointer.
 *
 * With two or more notes selected the board shows the selection toolbar
 * instead (Group these / Combine, whiteboard-groups.js): what you do with
 * several things is different from what you do with one.
 *
 * ## Placement
 *
 * An HTML element over the canvas, not SVG in it, so it stays the same size
 * at every zoom. It is re-placed every animation frame while it is up,
 * rather than from each of the dozen places that move things -- pan, zoom,
 * the zoom animation, a note drag, a resize, a group drag, a re-render. One
 * getBoundingClientRect() a frame, only while something is selected, is
 * cheaper than keeping a dozen call sites honest.
 */

/** The selected group's name, or null. Notes keep their own selection
 * (wbSelectedNoteTasks in whiteboard-notes.js); the two never overlap. */
let wbSelectedGroupName = null;

/** What the toolbar is currently showing: { kind, name }, or null. */
let wbObjectToolbarTarget = null;
let wbObjectToolbarFrame = 0;

const WB_OBJECT_TOOLBAR_ICONS = {
    colour: '<path d="M12 3a9 9 0 100 18c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 005-5c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    zoom: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    remove: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
};

function wbObjectToolbarElement() {
    if (typeof document === 'undefined') return null;
    const host = document.getElementById('whiteboardContainer');
    if (!host) return null;
    let bar = host.querySelector('.wb-object-toolbar');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'wb-object-toolbar';
        bar.setAttribute('role', 'toolbar');
        bar.hidden = true;
        // A press on the toolbar is never a press on the board beneath it.
        bar.addEventListener('mousedown', (e) => e.stopPropagation());
        bar.addEventListener('dblclick', (e) => e.stopPropagation());
        host.appendChild(bar);
    }
    return bar;
}

/** The toolbar's button for `action` ('colour', 'zoom', 'edit', 'remove',
 * 'more'), or null when the toolbar is not showing one. */
function wbObjectToolbarButton(action) {
    const bar = wbObjectToolbarElement();
    if (!bar || bar.hidden) return null;
    return bar.querySelector(`[data-wb-action="${action}"]`);
}

function wbObjectToolbarBtn(action, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `wb-object-toolbar-btn wb-object-toolbar-${action}`;
    btn.dataset.wbAction = action;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + WB_OBJECT_TOOLBAR_ICONS[action] + '</svg>';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(btn);
    });
    return btn;
}

/** What should the toolbar float over right now? */
function wbObjectToolbarWants() {
    const notes = (typeof wbGetSelectedNoteTasks === 'function') ? wbGetSelectedNoteTasks() : [];
    if (notes.length === 1) return { kind: 'note', name: notes[0] };
    if (!notes.length && wbSelectedGroupName
        && typeof wbGroupNodes !== 'undefined' && wbGroupNodes.has(wbSelectedGroupName)) {
        return { kind: 'group', name: wbSelectedGroupName };
    }
    return null;
}

/**
 * Show, rebuild or hide the toolbar to match the selection. Called whenever
 * the selection changes (wbApplySelection(), wbSelectGroup()) and after a
 * render, which can take the selected thing off the board.
 */
function wbUpdateObjectToolbar() {
    const bar = wbObjectToolbarElement();
    if (!bar) return;
    const want = wbObjectToolbarWants();
    if (!want) {
        wbObjectToolbarTarget = null;
        bar.hidden = true;
        bar.replaceChildren();
        if (wbObjectToolbarFrame && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(wbObjectToolbarFrame);
        }
        wbObjectToolbarFrame = 0;
        return;
    }

    const same = wbObjectToolbarTarget
        && wbObjectToolbarTarget.kind === want.kind && wbObjectToolbarTarget.name === want.name;
    if (!same) {
        wbObjectToolbarTarget = want;
        bar.replaceChildren(...(want.kind === 'note'
            ? wbNoteToolbarButtons(want.name)
            : wbGroupToolbarButtons(want.name)));
        bar.setAttribute('aria-label', want.kind === 'note'
            ? `Note: ${want.name}` : `Group: ${want.name}`);
    }
    bar.hidden = false;
    // Placed now as well as every frame, so a menu anchored to one of its
    // buttons straight after a selection opens in the right place.
    wbPlaceObjectToolbar();
    if (!wbObjectToolbarFrame && typeof requestAnimationFrame === 'function') {
        const tick = () => {
            if (!wbObjectToolbarTarget) { wbObjectToolbarFrame = 0; return; }
            // The selected thing can leave the board (removed, merged,
            // ungrouped) without a selection change saying so.
            const now = wbObjectToolbarWants();
            if (!now || now.kind !== wbObjectToolbarTarget.kind || now.name !== wbObjectToolbarTarget.name) {
                wbObjectToolbarFrame = 0;
                wbUpdateObjectToolbar();
                return;
            }
            wbPlaceObjectToolbar();
            wbObjectToolbarFrame = requestAnimationFrame(tick);
        };
        wbObjectToolbarFrame = requestAnimationFrame(tick);
    }
}

function wbNoteToolbarButtons(taskName) {
    const thought = (typeof wbIsThoughtNote === 'function') && wbIsThoughtNote(taskName);
    return [
        wbObjectToolbarBtn('colour', 'Colour', (btn) => wbOpenNoteColourMenu(taskName, btn)),
        wbObjectToolbarBtn('zoom', 'Zoom to this note', () => {
            const entry = wbNoteNodes.get(taskName);
            if (entry && typeof wbZoomToBoardRect === 'function') wbZoomToBoardRect(wbBoardRect(entry.fo));
        }),
        wbObjectToolbarBtn('edit', 'Edit title', () => {
            const entry = wbNoteNodes.get(taskName);
            if (entry && typeof wbBeginTitleEdit === 'function') wbBeginTitleEdit(entry);
        }),
        // Taking a card off the canvas, as Obsidian's delete does: the task
        // stays in the plan. A thought is only a note, so its note is all
        // there is to delete. Deleting the task itself is under More, beside
        // Remove from board, where the difference is spelt out.
        thought
            ? wbObjectToolbarBtn('remove', 'Delete this text note', () => wbDeleteThought(taskName))
            : wbObjectToolbarBtn('remove', 'Remove from board (the task stays in your plan)',
                () => wbRemoveNoteFromBoard(taskName)),
        wbObjectToolbarBtn('more', 'More options', (btn) => {
            if (wbNoteMenuState && wbNoteMenuState.btn === btn) { wbCloseNoteMenu(); return; }
            wbOpenNoteMenu(taskName, btn);
        }),
    ].map(btn => {
        if (btn.dataset.wbAction === 'colour' || btn.dataset.wbAction === 'more') {
            btn.setAttribute('aria-haspopup', 'true');
            btn.setAttribute('aria-expanded', 'false');
        }
        return btn;
    });
}

function wbGroupToolbarButtons(groupName) {
    const colour = wbObjectToolbarBtn('colour', 'Colour', (btn) => wbOpenGroupColourMenu(groupName, btn));
    colour.setAttribute('aria-haspopup', 'true');
    colour.setAttribute('aria-expanded', 'false');
    return [
        colour,
        wbObjectToolbarBtn('zoom', 'Zoom to this group', () => {
            const node = wbGroupNodes.get(groupName);
            if (!node || typeof wbZoomToBoardRect !== 'function') return;
            const r = node.rect;
            wbZoomToBoardRect({
                x: +r.getAttribute('x'), y: +r.getAttribute('y'),
                width: +r.getAttribute('width'), height: +r.getAttribute('height'),
            });
        }),
        wbObjectToolbarBtn('edit', 'Edit title', () => wbEditGroupTitle(groupName)),
        // Obsidian's delete on a group removes the group and leaves what was
        // in it: here, that is Ungroup.
        wbObjectToolbarBtn('remove', 'Remove group (its notes stay)', () => {
            wbClearGroupSelection();
            wbUngroupGroup(groupName);
        }),
    ];
}

/** Screen rect of whatever the toolbar is floating over, or null. */
function wbObjectToolbarTargetRect() {
    const target = wbObjectToolbarTarget;
    if (!target) return null;
    if (target.kind === 'note') {
        const entry = (typeof wbNoteNodes !== 'undefined') ? wbNoteNodes.get(target.name) : null;
        return entry && entry.refs && entry.refs.card ? entry.refs.card.getBoundingClientRect() : null;
    }
    const node = (typeof wbGroupNodes !== 'undefined') ? wbGroupNodes.get(target.name) : null;
    return node ? node.rect.getBoundingClientRect() : null;
}

/**
 * Centre the toolbar above its target, flipping below when there is no room
 * above, and keeping it inside the canvas. Hidden while its target is wholly
 * off screen, so it never hangs at the edge pointing at nothing.
 */
function wbPlaceObjectToolbar() {
    const bar = wbObjectToolbarElement();
    const host = bar && bar.parentElement;
    const rect = wbObjectToolbarTargetRect();
    if (!bar || !host) return;
    if (!rect) { bar.classList.add('wb-object-toolbar-offscreen'); return; }
    const hostRect = host.getBoundingClientRect();
    const offscreen = rect.right < hostRect.left || rect.left > hostRect.right
        || rect.bottom < hostRect.top || rect.top > hostRect.bottom;
    bar.classList.toggle('wb-object-toolbar-offscreen', offscreen);
    if (offscreen) return;

    const gap = 8;
    const width = bar.offsetWidth;
    const height = bar.offsetHeight;
    let left = rect.left - hostRect.left + rect.width / 2 - width / 2;
    left = Math.max(gap, Math.min(hostRect.width - width - gap, left));
    let top = rect.top - hostRect.top - height - gap;
    if (top < gap) top = Math.min(hostRect.height - height - gap, rect.bottom - hostRect.top + gap);
    top = Math.max(gap, top);
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
}

// ── Colour ──────────────────────────────────────────────────────────────

/** A note's colour popover: the note menu's own colour section, alone. */
function wbOpenNoteColourMenu(taskName, btn) {
    if (wbNoteMenuState && wbNoteMenuState.btn === btn) { wbCloseNoteMenu(); return; }
    const menu = wbColourOnlyMenu('Note colour');
    wbAppendColourMenuSection(menu.querySelector('ul'), taskName);
    wbShowBoardMenu(menu, { taskName, btn });
}

function wbOpenGroupColourMenu(groupName, btn) {
    if (wbNoteMenuState && wbNoteMenuState.btn === btn) { wbCloseNoteMenu(); return; }
    const menu = wbColourOnlyMenu('Group colour');
    const list = menu.querySelector('ul');
    const rows = (typeof wbReadBoardRows === 'function' && typeof document !== 'undefined')
        ? wbReadBoardRows(document.getElementById('planEditor').value) : [];
    const row = rows.find(r => r && r.kind === 'group' && r.task === groupName);
    const current = row && row.colour ? String(row.colour).toUpperCase() : '';

    const defaultLi = document.createElement('li');
    const defaultBtn = document.createElement('button');
    defaultBtn.type = 'button';
    defaultBtn.className = 'wb-note-menu-default';
    defaultBtn.setAttribute('role', 'menuitem');
    defaultBtn.textContent = 'Default colour';
    defaultBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCloseNoteMenu();
        wbSetGroupColour(groupName, '');
    });
    defaultLi.appendChild(defaultBtn);
    list.appendChild(defaultLi);

    const gridLi = document.createElement('li');
    gridLi.setAttribute('role', 'presentation');
    const grid = document.createElement('div');
    grid.className = 'wb-note-menu-grid';
    for (const colour of wbPalette()) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'wb-note-menu-swatch';
        swatch.setAttribute('role', 'menuitemradio');
        swatch.style.background = colour;
        swatch.title = colour;
        swatch.setAttribute('aria-label', `Set group colour to ${colour}`);
        const selected = current === colour.toUpperCase();
        swatch.setAttribute('aria-checked', selected ? 'true' : 'false');
        if (selected) swatch.classList.add('selected');
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            wbCloseNoteMenu();
            wbSetGroupColour(groupName, colour);
        });
        grid.appendChild(swatch);
    }
    gridLi.appendChild(grid);
    list.appendChild(gridLi);
    wbShowBoardMenu(menu, { btn });
}

function wbColourOnlyMenu(label) {
    const menu = document.createElement('div');
    menu.id = 'wbNoteMenu';
    menu.className = 'wb-note-menu wb-colour-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    const list = document.createElement('ul');
    list.className = 'wb-note-menu-list';
    list.setAttribute('role', 'none');
    menu.appendChild(list);
    return menu;
}

// ── Group selection ─────────────────────────────────────────────────────

/** Select a group (a click on its boundary), dropping any note selection. */
function wbSelectGroup(groupName) {
    if (typeof wbSetSelectedNotes === 'function') wbSetSelectedNotes([]);
    wbSelectedGroupName = groupName || null;
    wbMarkSelectedGroup();
    wbUpdateObjectToolbar();
}

function wbClearGroupSelection() {
    if (!wbSelectedGroupName) return;
    wbSelectedGroupName = null;
    wbMarkSelectedGroup();
    wbUpdateObjectToolbar();
}

/** Keep `.wb-group-selected` on exactly the selected group's boundary. */
function wbMarkSelectedGroup() {
    if (typeof wbGroupNodes === 'undefined') return;
    for (const [name, node] of wbGroupNodes) {
        node.g.classList.toggle('wb-group-selected', name === wbSelectedGroupName);
    }
}
