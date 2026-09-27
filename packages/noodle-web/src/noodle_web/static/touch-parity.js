/**
 * touch-parity.js -- every right-click menu opens on a long-press too (#1386,
 * epic #1376).
 *
 * A finger has no right button. These are the surfaces whose actions live in
 * a `contextmenu` handler, and a long-press on any of them raises that same
 * event where the finger is (NoodleTouch.contextMenuOnLongPress), so each
 * menu keeps its one handler and its one code path. The list is the whole
 * contract: tests/ui/test_touch_parity.py long-presses every entry.
 *
 * One delegated listener on the document covers them all, so rows a view
 * redraws need nothing re-attached.
 *
 * A classic script, after touch-gestures.js.
 */
(function (root) {
    'use strict';

    const SURFACES = [
        { id: 'raid', selector: '#raidTableBody tr', menu: 'RAID item' },
        { id: 'report-raid', selector: '#reportRaidTableBody tr', menu: 'RAID item' },
        { id: 'tasks', selector: '#tasksTableBody tr', menu: 'task' },
        { id: 'gantt', selector: '#ganttInfoBody tr', menu: 'task' },
        { id: 'products', selector: '.pbs-node', menu: 'product' },
        { id: 'outline', selector: '.wb-outline-row', menu: 'outline row' },
        // The board's own background. A note is pressed to lift it and drag
        // (whiteboard-notes.js), and its menu is on the toolbar a tap raises.
        { id: 'whiteboard', selector: '#whiteboardContainer', menu: 'board' },
    ];

    // Where a long-press means something else already: selecting text in a
    // field, lifting a note or a group to drag it.
    const IGNORE = [
        'input', 'textarea', 'select', '[contenteditable="true"]',
        '#whiteboardContainer .wb-note', '#whiteboardContainer .wb-text-object',
        '#whiteboardContainer .wb-group',
    ].join(', ');

    function init() {
        if (!root.NoodleTouch || typeof document === 'undefined') return;
        root.NoodleTouch.contextMenuOnLongPress(document, {
            selector: SURFACES.map((surface) => surface.selector).join(', '),
            ignore: IGNORE,
        });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }

    root.NoodleTouchParity = { SURFACES, IGNORE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
