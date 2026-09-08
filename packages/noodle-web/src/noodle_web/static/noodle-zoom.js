/**
 * noodle-zoom.js -- semantic zoom for the Noodle view (issue #986).
 *
 * Pure graph helpers, no DOM: a collapsed summary node is one solid box,
 * and everything a viewer needs to know about what's hidden inside it --
 * how many real dependencies cross its boundary, and whether something
 * worth a second look is buried inside -- is computed here from a plain
 * edge list, independent of whether the caller's "nodes" are tasks,
 * product-flow deliverables, or anything else. views-products.js's
 * existing `pfExpandedStages`/diamond-gate collapse mechanism is the
 * renderer these feed; this file only ever answers questions about a
 * graph, never draws or toggles anything.
 *
 * Key decision this mirrors from the epic: the PM rule that a dependency
 * can't sit on a summary task is respected rather than bent. Nothing here
 * moves a dependency onto the collapsed node -- noodleCountCrossingEdges()
 * still counts real edges between real inner tasks and the outside world;
 * a collapsed node just *visually* absorbs them into one badge.
 */

/**
 * How many edges cross the boundary of a collapsed group -- exactly one of
 * `from`/`to` is inside `insideKeys` -- split by direction, for the "N
 * links" badge #986 asks for on a noodle reaching a collapsed node.
 *
 * @param {Array<{from: string, to: string}>} edges
 * @param {Set<string>} insideKeys - lowercase keys of the group's children.
 * @returns {{incoming: number, outgoing: number, total: number}}
 */
function noodleCountCrossingEdges(edges, insideKeys) {
    let incoming = 0; // outside -> inside
    let outgoing = 0; // inside -> outside
    (edges || []).forEach((edge) => {
        if (!edge) return;
        const fromInside = insideKeys.has(edge.from);
        const toInside = insideKeys.has(edge.to);
        if (fromInside === toInside) return; // both or neither inside: not a crossing
        if (toInside) incoming++;
        else outgoing++;
    });
    return { incoming, outgoing, total: incoming + outgoing };
}

/** "3 links" / "1 link" / null (nothing to badge -- zero crossing edges). */
function noodleBadgeLabel(count) {
    if (!count || count <= 0) return null;
    return count === 1 ? '1 link' : `${count} links`;
}

/**
 * Whether the edges restricted to `insideKeys` contain a cycle -- a
 * dependency loop wholly inside a collapsed group, invisible until it's
 * expanded. Plain DFS with a recursion stack; cheap at the node counts a
 * single summary task's children ever reach.
 */
function noodleHasInternalCycle(edges, insideKeys) {
    const adjacency = new Map();
    insideKeys.forEach((k) => adjacency.set(k, []));
    (edges || []).forEach((edge) => {
        if (insideKeys.has(edge.from) && insideKeys.has(edge.to)) {
            adjacency.get(edge.from).push(edge.to);
        }
    });

    const visited = new Set();
    const onStack = new Set();

    function visit(node) {
        visited.add(node);
        onStack.add(node);
        for (const next of adjacency.get(node) || []) {
            if (!visited.has(next)) {
                if (visit(next)) return true;
            } else if (onStack.has(next)) {
                return true;
            }
        }
        onStack.delete(node);
        return false;
    }

    for (const node of insideKeys) {
        if (!visited.has(node) && visit(node)) return true;
    }
    return false;
}

/**
 * The buried-detail marker (#986 scope): a subtle indicator on a collapsed
 * node that has something interesting inside it. Combines the structural
 * check this file can do itself (an internal dependency loop) with a
 * caller-supplied signal for anything that needs domain knowledge this
 * module deliberately doesn't have (e.g. an at-risk RAG status -- that's
 * views-products.js's pbsComputeRag's job, not a graph question).
 *
 * @param {Array<{from: string, to: string}>} edges
 * @param {Set<string>} insideKeys
 * @param {object} [opts]
 * @param {boolean} [opts.hasAtRiskDescendant]
 * @returns {{buried: boolean, reasons: string[]}}
 */
function noodleBuriedDetail(edges, insideKeys, opts) {
    const reasons = [];
    if (noodleHasInternalCycle(edges, insideKeys)) reasons.push('dependency loop');
    if (opts && opts.hasAtRiskDescendant) reasons.push('at-risk task');
    return { buried: reasons.length > 0, reasons };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        noodleCountCrossingEdges,
        noodleBadgeLabel,
        noodleHasInternalCycle,
        noodleBuriedDetail,
    };
}
