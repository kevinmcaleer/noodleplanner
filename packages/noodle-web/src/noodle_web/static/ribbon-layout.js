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
