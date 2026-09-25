/**
 * ribbon-layout.js -- the ribbon's overflow ("» More") fit calculation
 * (design handoff "Ribbon Toolbar option 2a", #833 follow-up).
 *
 * Pure arithmetic, no DOM: ribbon.js measures real group widths with
 * offsetWidth and a ResizeObserver (the README recommends this over the
 * prototype's own estGroup/fit heuristic) and calls this with the numbers.
 */

/**
 * Which groups fit in the available width, and which overflow into "More".
 *
 * @param {number[]} groupWidths - width of each group, in display order
 * @param {number} containerWidth - available width for the ribbon body
 * @param {number} moreWidth - width the "More" tile takes when shown
 * @returns {{visible: number[], overflow: number[]}} group indices
 */
export function fitGroups(groupWidths, containerWidth, moreWidth) {
    const total = groupWidths.reduce((sum, w) => sum + w, 0);
    if (total <= containerWidth) {
        return { visible: groupWidths.map((_, i) => i), overflow: [] };
    }

    const budget = containerWidth - moreWidth;
    const visible = [];
    const overflow = [];
    let used = 0;
    let stillFitting = true;
    for (let i = 0; i < groupWidths.length; i++) {
        // Once a group doesn't fit, every group after it overflows too --
        // groups are ordered left-to-right, so a later, narrower group must
        // never jump ahead of an earlier one that didn't fit.
        if (stillFitting && used + groupWidths[i] <= budget) {
            visible.push(i);
            used += groupWidths[i];
        } else {
            stillFitting = false;
            overflow.push(i);
        }
    }

    // Never collapse everything: an empty ribbon behind a lone "More" tile
    // is worse than letting the first group overflow its budget slightly.
    if (visible.length === 0 && groupWidths.length > 0) {
        visible.push(0);
        overflow.shift();
    }

    return { visible, overflow };
}

/**
 * The simple ribbon's (#955) text-or-icon-only decision: "just shows the
 * icons (and text if that fits)". Unlike fitGroups() -- which drops whole
 * groups into a "More" popover -- a button here is never hidden; it only
 * ever loses its label and falls back to its narrower icon-only width.
 *
 * All or nothing: either the whole row fits with every label showing, or
 * every button in the row goes icon-only. It used to shrink labels greedily
 * right-to-left, which left the leftmost buttons fully labelled beside a
 * run of bare icons -- a half-collapsed row that spent the room on text
 * for a few commands while the rest of the ribbon was already being pushed
 * into dropdowns. Labels are the first thing to go, for every button at
 * once, before any group collapses.
 *
 * @param {number[]} groupWidths - each group's measured width with every
 *   label showing, in display order.
 * @param {number} containerWidth - available width for the whole row.
 * @returns {boolean} true = show every label, false = every button icon-only.
 */
export function fitLabels(groupWidths, containerWidth) {
    return groupWidths.reduce((sum, w) => sum + w, 0) <= containerWidth;
}

/**
 * The simple ribbon's last-resort fallback (issue #1026): once fitLabels()
 * has already shrunk every button in the row to icon-only and the row
 * *still* doesn't fit, individual groups collapse into their own dropdown
 * trigger, labelled with the group's name -- never into one shared "More"
 * catch-all (that's fitGroups()/applyOverflow()'s full-ribbon-only
 * behaviour; the simple ribbon's own group-level fallback needed a different
 * shape because every collapsed group still costs *some* width here -- its
 * own trigger -- unlike fitGroups()'s single shared "More" tile that the
 * whole overflow set shares).
 *
 * Same greedy, left-to-right, order-preserving contract as fitGroups()
 * elsewhere in this file: once a group doesn't fit, every group after it
 * collapses too, so a later, narrower group can never jump ahead of an
 * earlier one that didn't fit -- and the first group is never collapsed
 * (an empty-looking row of nothing but dropdowns would be worse than
 * letting the first group run slightly over budget).
 *
 * A group considering whether to stay visible must also leave enough room
 * for every group after it to *at least* render as a collapsed trigger --
 * otherwise a group could "fit" only to immediately starve the rest of the
 * row, which would violate the ordering contract the moment the loop reached
 * them.
 *
 * @param {number[]} groupWidths - each group's already-measured width (after
 *   fitLabels() has shrunk its buttons), in display order.
 * @param {number} containerWidth - available width for the whole row.
 * @param {number|number[]} triggerWidths - the width each group takes once
 *   collapsed to its trigger, in display order. The triggers carry the
 *   group's name, so each is measured; a single number applies to all.
 * @returns {{visible: number[], collapsed: number[]}} group indices.
 */
export function fitSimpleGroups(groupWidths, containerWidth, triggerWidths) {
    const total = groupWidths.reduce((sum, w) => sum + w, 0);
    if (total <= containerWidth) {
        return { visible: groupWidths.map((_, i) => i), collapsed: [] };
    }

    const triggerWidth = (i) => (Array.isArray(triggerWidths) ? triggerWidths[i] : triggerWidths);
    const visible = [];
    const collapsed = [];
    let used = 0;
    let stillFitting = true;
    for (let i = 0; i < groupWidths.length; i++) {
        if (stillFitting) {
            let reserveForRest = 0;
            for (let j = i + 1; j < groupWidths.length; j++) reserveForRest += triggerWidth(j);
            if (used + groupWidths[i] + reserveForRest <= containerWidth) {
                visible.push(i);
                used += groupWidths[i];
                continue;
            }
            stillFitting = false;
        }
        collapsed.push(i);
        used += triggerWidth(i);
    }

    // Never collapse everything: a row of nothing but dropdowns, with not
    // even the first group shown in full, reads worse than letting the
    // first group overflow its budget slightly (same safety net fitGroups()
    // applies to the full ribbon's own "More" fallback).
    if (visible.length === 0 && groupWidths.length > 0) {
        visible.push(0);
        collapsed.shift();
    }

    return { visible, collapsed };
}
