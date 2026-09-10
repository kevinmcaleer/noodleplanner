/**
 * Product Views Implementation
 * Provides a Product Breakdown Structure (PBS) SVG canvas view
 * and a Deliverables Matrix table view.
 *
 * Products are tasks marked with a $deliverable token.
 * The PBS shows the hierarchy of products with dependency arrows.
 * The matrix shows a tabular breakdown of each deliverable.
 */

// ── Global state ──────────────────────────────────────────────────────
let pbsRagMode = false;
let pbsTasks = [];
let pbsTree = null;
let pbsSvg = null;
let pbsGroup = null;
let pbsZoom = 1;
let pbsPanX = 0;
let pbsPanY = 0;
let pbsIsDragging = false;
let pbsDragStartX = 0;
let pbsDragStartY = 0;
let pbsDragStartPanX = 0;
let pbsDragStartPanY = 0;

// Layout constants (top-down PBS with stacked children)
const PBS_SIBLING_GAP = 8;    // horizontal gap between sibling subtrees
const PBS_COL_GAP = 16;       // gap between dual columns
const PBS_STACK_GAP = 4;      // vertical gap between stacked children
const PBS_LEVEL_GAP = 36;     // vertical gap between parent bottom and children top (room for + button)
const PBS_ROOT_GAP = 40;      // vertical gap between root and first level (for visible connectors)
const PBS_BUS_DROP = 10;      // how far the bus line drops below parent before branching
const PBS_BUS_OFFSET = 10;    // horizontal offset from parent centre to bus line
const PBS_ADD_BTN_SIZE = 18;  // size of the + button circles
const PBS_NODE_HEIGHT = 44;
const PBS_NODE_PADDING_X = 10;
const PBS_NODE_WIDTH = 140;    // fixed width for all PBS nodes
const PBS_DUAL_THRESHOLD = 6;  // split into two columns above this many children

const PBS_COLOURS = [
    '#4A90D9', '#D97B4A', '#5CB85C', '#D95B5B',
    '#9B6BBF', '#3DBFA8', '#D9A84A', '#5B8FD9',
    '#4ABF7F', '#D9534F', '#D9B84A', '#8E5BBF'
];

// ── PBS: Extract deliverable tree ─────────────────────────────────────

function pbsExtractDeliverables(tasks) {
    if (!tasks || tasks.length === 0) return [];
    return tasks.filter(t => t.deliverable);
}

function pbsBuildTree(tasks, projectName) {
    const deliverables = pbsExtractDeliverables(tasks);
    if (deliverables.length === 0) return null;

    const root = {
        id: 'pbs-root',
        name: projectName || 'Products',
        deliverable: null,
        children: [],
        level: -1,
        _task: null,
        x: 0, y: 0, width: 0, height: PBS_NODE_HEIGHT, subtreeHeight: 0
    };

    // Build a map of deliverable name → node
    const nodeMap = {};
    for (const task of deliverables) {
        const node = {
            id: task.id || task.deliverable,
            name: task.name || task.description || task.deliverable,
            deliverable: task.deliverable,
            children: [],
            level: task.level || 0,
            _task: task,
            x: 0, y: 0, width: 0, height: PBS_NODE_HEIGHT, subtreeHeight: 0
        };
        nodeMap[task.deliverable] = node;
    }

    // Build parent-child relationships based on task hierarchy
    for (const task of deliverables) {
        const node = nodeMap[task.deliverable];
        let placed = false;

        // Check if this deliverable's parent task is also a deliverable
        if (task.parent) {
            const parentDeliverable = deliverables.find(
                d => d.name === task.parent || d.description === task.parent
            );
            if (parentDeliverable && nodeMap[parentDeliverable.deliverable]) {
                nodeMap[parentDeliverable.deliverable].children.push(node);
                placed = true;
            }
        }

        if (!placed) {
            root.children.push(node);
        }
    }

    if (root.children.length === 1 && root.children[0].children.length > 0) {
        const single = root.children[0];
        single._isRoot = true;
        return single;
    }

    root._isRoot = true;
    return root;
}

// ── PBS: Get child tasks (activities) for a deliverable ───────────────

function pbsGetActivities(deliverableTask, allTasks) {
    if (!deliverableTask || !allTasks) return [];
    const activities = [];
    const parentName = deliverableTask.name || deliverableTask.description || '';

    // Helper: check if a task's parent matches a name in our set.
    // The API 'name' includes metadata tokens ($product @resource etc.)
    // but child 'parent' is the raw key. So we also check startsWith.
    function isChild(task, nameSet) {
        if (!task.parent) return false;
        if (nameSet.has(task.parent)) return true;
        // Check if any name in the set starts with the parent (raw key match)
        for (const n of nameSet) {
            if (n.startsWith(task.parent) && task.parent.length > 2) return true;
        }
        return false;
    }

    // Collect all descendant names (not just direct children) so we find
    // leaf tasks nested under intermediate summary tasks.
    const descendantNames = new Set([parentName]);
    let added = true;
    while (added) {
        added = false;
        for (const t of allTasks) {
            if (isChild(t, descendantNames) && !descendantNames.has(t.name)) {
                // Stop at other deliverables — they are separate products
                if (t.deliverable) continue;
                descendantNames.add(t.name);
                added = true;
            }
        }
    }

    for (const t of allTasks) {
        if (isChild(t, descendantNames) && !t.deliverable && !t.is_summary) {
            activities.push(t);
        }
    }
    return activities;
}

function pbsGetResources(deliverableTask, allTasks) {
    const activities = pbsGetActivities(deliverableTask, allTasks);
    const resources = new Set();
    for (const a of activities) {
        if (a.resources) {
            a.resources.split(',').forEach(r => {
                const trimmed = r.trim();
                if (trimmed) resources.add(trimmed);
            });
        }
    }
    return [...resources];
}

// ── PBS: Status rollup from child activities ──────────────────────────

function pbsComputeRollup(deliverableTask, allTasks) {
    const activities = pbsGetActivities(deliverableTask, allTasks);
    if (activities.length === 0) {
        return { percent: deliverableTask.percent || 0, activityCount: 0 };
    }
    let totalPct = 0;
    for (const a of activities) {
        totalPct += parseFloat(a.percent) || 0;
    }
    return {
        percent: Math.round(totalPct / activities.length),
        activityCount: activities.length
    };
}

// ── PBS: RAG status ───────────────────────────────────────────────────
// Derive a Red/Amber/Green status from rolled-up completion vs schedule.
// Returns one of: 'green', 'amber', 'red', or null if not enough data.
function pbsComputeRag(deliverableTask, allTasks) {
    if (!deliverableTask) return null;
    const rollup = pbsComputeRollup(deliverableTask, allTasks);
    const actual = rollup ? rollup.percent : 0;
    const start = deliverableTask.start_date;
    const end = deliverableTask.end_date;
    if (!start || !end) {
        // Without dates, only strongly signal when clearly done
        if (actual >= 100) return 'green';
        return null;
    }
    const now = new Date();
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s) || isNaN(e) || e <= s) return null;
    if (now <= s) return actual >= 100 ? 'green' : null;
    if (now >= e) return actual >= 100 ? 'green' : 'red';
    const expected = ((now - s) / (e - s)) * 100;
    const delta = actual - expected;
    if (delta >= -5) return 'green';
    if (delta >= -20) return 'amber';
    return 'red';
}

function pbsRagColour(rag) {
    if (rag === 'green') return '#5CB85C';
    if (rag === 'amber') return '#F0AD4E';
    if (rag === 'red') return '#D9534F';
    return null;
}

// ── PBS: Layout ───────────────────────────────────────────────────────

let _pbsMeasureCtx = null;
function pbsMeasureText(text, font) {
    if (!_pbsMeasureCtx) {
        const canvas = document.createElement('canvas');
        _pbsMeasureCtx = canvas.getContext('2d');
    }
    _pbsMeasureCtx.font = font || '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    return _pbsMeasureCtx.measureText(text).width;
}

function pbsMeasure(node, depth) {
    if (depth === undefined) depth = 0;
    node.width = PBS_NODE_WIDTH;

    // Measure all children first
    for (const child of node.children) {
        pbsMeasure(child, depth + 1);
    }

    if (node.children.length === 0) {
        node.subtreeWidth = node.width;
        node.subtreeHeight = node.height;
        return;
    }

    const n = node.children.length;

    // Count total visible nodes in the subtree (not just direct children)
    function countDescendants(nd) {
        let count = 1;
        for (const c of nd.children) count += countDescendants(c);
        return count;
    }
    const totalNodes = countDescendants(node) - 1; // exclude self

    // First level (root's children): horizontal layout
    // Deeper levels: stacked layout — use dual columns if too many direct
    // children OR if the total descendant count exceeds the threshold
    const useHorizontal = (depth === 0);
    const dual = !useHorizontal && (n > PBS_DUAL_THRESHOLD || totalNodes > PBS_DUAL_THRESHOLD);
    node._dual = dual;
    node._horizontal = useHorizontal;

    const levelGap = useHorizontal ? PBS_ROOT_GAP : PBS_LEVEL_GAP;

    if (useHorizontal) {
        // Children side by side horizontally — subtract left margins for tighter packing
        let totalChildrenWidth = 0;
        let maxChildHeight = 0;
        for (const child of node.children) {
            const leftMargin = child._leftMargin || 0;
            totalChildrenWidth += child.subtreeWidth - leftMargin;
            maxChildHeight = Math.max(maxChildHeight, child.subtreeHeight);
        }
        totalChildrenWidth += (n - 1) * PBS_SIBLING_GAP;
        node.subtreeWidth = Math.max(node.width, totalChildrenWidth);
        node.subtreeHeight = node.height + levelGap + maxChildHeight;
    } else if (dual) {
        const half = Math.ceil(n / 2);
        const leftChildren = node.children.slice(0, half);
        const rightChildren = node.children.slice(half);
        const leftW = Math.max(...leftChildren.map(c => c.subtreeWidth));
        const rightW = Math.max(...rightChildren.map(c => c.subtreeWidth));
        const leftH = leftChildren.reduce((s, c) => s + c.subtreeHeight, 0) + (leftChildren.length - 1) * PBS_STACK_GAP;
        const rightH = rightChildren.reduce((s, c) => s + c.subtreeHeight, 0) + (rightChildren.length - 1) * PBS_STACK_GAP;

        const childrenWidth = leftW + PBS_COL_GAP + rightW;
        const childrenHeight = Math.max(leftH, rightH);
        node.subtreeWidth = Math.max(node.width, childrenWidth);
        node.subtreeHeight = node.height + levelGap + childrenHeight;
    } else {
        // Single column to one side of the bus
        const stackH = node.children.reduce((s, c) => s + c.subtreeHeight, 0) + (n - 1) * PBS_STACK_GAP;
        const maxChildW = Math.max(...node.children.map(c => c.subtreeWidth));
        const sideExtent = node.width / 2 + PBS_BUS_OFFSET + maxChildW;
        node.subtreeWidth = Math.max(node.width, sideExtent);
        // Track how much of the subtreeWidth is empty on the left
        // (parent is offset right, children extend further right)
        node._leftMargin = Math.max(0, (node.subtreeWidth - node.width) / 2 - PBS_BUS_OFFSET);
        node.subtreeHeight = node.height + levelGap + stackH;
    }
}

function pbsLayoutTree(node, x, y) {
    // Determine if this node should place children to the left (mirrored)
    const side = node._colSide || 'right';
    const placeLeft = (side === 'left');

    if (node.children.length === 0 || node._horizontal || node._dual) {
        node.x = x + (node.subtreeWidth - node.width) / 2;
    } else if (placeLeft) {
        // Stacked single column to the LEFT: offset parent right
        const maxChildW = Math.max(...node.children.map(c => c.subtreeWidth));
        const leftExtent = maxChildW + PBS_BUS_OFFSET + node.width / 2;
        if (leftExtent > node.width) {
            node.x = x + maxChildW + PBS_BUS_OFFSET - node.width / 2;
        } else {
            node.x = x + (node.subtreeWidth - node.width) / 2;
        }
    } else {
        // Stacked single column to the RIGHT: offset parent left
        const maxChildW = Math.max(...node.children.map(c => c.subtreeWidth));
        const rightExtent = node.width / 2 + PBS_BUS_OFFSET + maxChildW;
        if (rightExtent > node.width) {
            node.x = x + (node.subtreeWidth - rightExtent);
        } else {
            node.x = x + (node.subtreeWidth - node.width) / 2;
        }
    }
    node.y = y;

    if (node.children.length === 0) return;

    const gap = node._horizontal ? PBS_ROOT_GAP : PBS_LEVEL_GAP;
    const childrenTop = y + node.height + gap;
    const n = node.children.length;
    const parentCx = node.x + node.width / 2;

    if (node._horizontal) {
        // Horizontal layout: children side by side, tightened by overlapping left margins
        let childX = x;
        for (let ci = 0; ci < node.children.length; ci++) {
            const child = node.children[ci];
            child._colSide = 'centre';
            // Shift left by this child's left margin (empty space on its left side)
            const leftMargin = child._leftMargin || 0;
            pbsLayoutTree(child, childX - leftMargin, childrenTop);
            childX += child.subtreeWidth - leftMargin + PBS_SIBLING_GAP;
        }
    } else if (node._dual) {
        const half = Math.ceil(n / 2);
        const leftChildren = node.children.slice(0, half);
        const rightChildren = node.children.slice(half);
        const leftW = Math.max(...leftChildren.map(c => c.subtreeWidth));
        const rightW = Math.max(...rightChildren.map(c => c.subtreeWidth));
        const totalW = leftW + PBS_COL_GAP + rightW;
        const startX = x + (node.subtreeWidth - totalW) / 2;

        let cy = childrenTop;
        for (const child of leftChildren) {
            child._colSide = 'left';
            pbsLayoutTree(child, startX + (leftW - child.subtreeWidth), cy);
            cy += child.subtreeHeight + PBS_STACK_GAP;
        }
        cy = childrenTop;
        for (const child of rightChildren) {
            child._colSide = 'right';
            pbsLayoutTree(child, startX + leftW + PBS_COL_GAP, cy);
            cy += child.subtreeHeight + PBS_STACK_GAP;
        }
    } else if (placeLeft) {
        // Single column: children to the LEFT of the bus line
        const childX = parentCx - PBS_BUS_OFFSET - PBS_NODE_WIDTH;
        let cy = childrenTop;
        for (const child of node.children) {
            child._colSide = 'left';
            pbsLayoutTree(child, childX, cy);
            cy += child.subtreeHeight + PBS_STACK_GAP;
        }
    } else {
        // Single column: children to the right of the bus line
        const childX = parentCx + PBS_BUS_OFFSET;
        let cy = childrenTop;
        for (const child of node.children) {
            child._colSide = 'right';
            pbsLayoutTree(child, childX, cy);
            cy += child.subtreeHeight + PBS_STACK_GAP;
        }
    }
}

// ── PBS: Rendering ────────────────────────────────────────────────────

function pbsShadeColour(hex, factor) {
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
    return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}

function pbsCreateSVGElement(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
    }
    return el;
}

function pbsRender() {
    if (!pbsSvg || !pbsTree) return;

    // Clear existing content
    if (pbsGroup) pbsGroup.remove();
    pbsGroup = pbsCreateSVGElement('g', { 'transform': `translate(${pbsPanX},${pbsPanY}) scale(${pbsZoom})` });
    pbsSvg.appendChild(pbsGroup);

    // Draw edges (parent-child lines)
    pbsRenderEdges(pbsTree);

    // Draw nodes
    let colourIndex = 0;
    pbsRenderNode(pbsTree, null, () => {
        const c = PBS_COLOURS[colourIndex % PBS_COLOURS.length];
        colourIndex++;
        return c;
    }, 0);
}

function pbsRenderEdges(node) {
    if (node.children.length === 0) return;

    const parentCx = node.x + node.width / 2;
    const parentBottom = node.y + node.height;
    const strokeAttrs = { 'fill': 'none', 'stroke': '#666', 'stroke-width': '1.5', 'opacity': '0.6' };

    if (node._horizontal) {
        // Horizontal first-level: drop from parent, horizontal bus, vertical drops to children
        const busY = parentBottom + PBS_BUS_DROP;
        const childCxs = node.children.map(c => c.x + c.width / 2);
        const minCx = Math.min(...childCxs);
        const maxCx = Math.max(...childCxs);

        // Vertical drop from parent to bus
        pbsGroup.appendChild(pbsCreateSVGElement('line', {
            'x1': parentCx, 'y1': parentBottom, 'x2': parentCx, 'y2': busY, ...strokeAttrs
        }));
        // Horizontal bus spanning all children
        pbsGroup.appendChild(pbsCreateSVGElement('line', {
            'x1': minCx, 'y1': busY, 'x2': maxCx, 'y2': busY, ...strokeAttrs
        }));
        // Vertical drops from bus to each child top
        for (const child of node.children) {
            const childCx = child.x + child.width / 2;
            pbsGroup.appendChild(pbsCreateSVGElement('line', {
                'x1': childCx, 'y1': busY, 'x2': childCx, 'y2': child.y, ...strokeAttrs
            }));
        }
    } else if (node.children.length === 1 && !node._dual) {
        // Single child: orthogonal L-shaped line
        const child = node.children[0];
        const isLeft = child._colSide === 'left';
        const childEdge = isLeft ? child.x + child.width : child.x;
        const childMidY = child.y + child.height / 2;
        pbsGroup.appendChild(pbsCreateSVGElement('path', {
            'd': `M${parentCx},${parentBottom} L${parentCx},${childMidY} L${childEdge},${childMidY}`,
            ...strokeAttrs
        }));
    } else if (node._dual) {
        // Dual columns: vertical bus from parent, stubs left and right
        const half = Math.ceil(node.children.length / 2);
        const leftChildren = node.children.slice(0, half);
        const rightChildren = node.children.slice(half);
        const allCy = node.children.map(c => c.y + c.height / 2);
        const maxCy = Math.max(...allCy);

        pbsGroup.appendChild(pbsCreateSVGElement('line', {
            'x1': parentCx, 'y1': parentBottom, 'x2': parentCx, 'y2': maxCy, ...strokeAttrs
        }));
        // Left column: stubs from child's right edge to bus
        for (const child of leftChildren) {
            const cy = child.y + child.height / 2;
            pbsGroup.appendChild(pbsCreateSVGElement('line', {
                'x1': child.x + child.width, 'y1': cy, 'x2': parentCx, 'y2': cy, ...strokeAttrs
            }));
        }
        // Right column: stubs from bus to child's left edge
        for (const child of rightChildren) {
            const cy = child.y + child.height / 2;
            pbsGroup.appendChild(pbsCreateSVGElement('line', {
                'x1': parentCx, 'y1': cy, 'x2': child.x, 'y2': cy, ...strokeAttrs
            }));
        }
    } else {
        // Single column: children to one side of the bus
        const isLeft = node._colSide === 'left';
        const lastChild = node.children[node.children.length - 1];
        const lastCy = lastChild.y + lastChild.height / 2;

        // Vertical bus
        pbsGroup.appendChild(pbsCreateSVGElement('line', {
            'x1': parentCx, 'y1': parentBottom, 'x2': parentCx, 'y2': lastCy, ...strokeAttrs
        }));
        // Horizontal stubs
        for (const child of node.children) {
            const cy = child.y + child.height / 2;
            const childEdge = isLeft ? child.x + child.width : child.x;
            pbsGroup.appendChild(pbsCreateSVGElement('line', {
                'x1': parentCx, 'y1': cy, 'x2': childEdge, 'y2': cy, ...strokeAttrs
            }));
        }
    }

    // Recurse into children
    for (const child of node.children) {
        pbsRenderEdges(child);
    }
}

function pbsRenderDependencyArrows() {
    // Draw dashed arrows between deliverables that have [depends $product] relationships
    const deliverables = pbsExtractDeliverables(pbsTasks);
    const nodePositions = {};

    function collectPositions(node) {
        if (node.deliverable) {
            nodePositions[node.deliverable] = node;
        }
        for (const child of node.children) collectPositions(child);
    }
    collectPositions(pbsTree);

    for (const task of deliverables) {
        if (!task.depends || task.depends.length === 0) continue;
        const targetNode = nodePositions[task.deliverable];
        if (!targetNode) continue;

        for (const depName of task.depends) {
            // Find the deliverable that matches this dependency
            const depTask = deliverables.find(d => d.name === depName || d.description === depName);
            if (!depTask) continue;
            const sourceNode = nodePositions[depTask.deliverable];
            if (!sourceNode) continue;

            const x1 = sourceNode.x + sourceNode.width;
            const y1 = sourceNode.y + sourceNode.height / 2;
            const x2 = targetNode.x;
            const y2 = targetNode.y + targetNode.height / 2;

            const arrow = pbsCreateSVGElement('path', {
                'd': `M${x1},${y1} L${x2},${y2}`,
                'fill': 'none',
                'stroke': '#E8833A',
                'stroke-width': '2',
                'stroke-dasharray': '6,4',
                'marker-end': 'url(#pbs-arrowhead)'
            });
            pbsGroup.appendChild(arrow);
        }
    }
}

function pbsRenderAddBtn(cx, cy, title, onClick) {
    const r = PBS_ADD_BTN_SIZE / 2;
    const g = pbsCreateSVGElement('g', { 'class': 'pbs-add-btn', 'style': 'cursor: pointer;' });
    g.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });

    g.appendChild(pbsCreateSVGElement('circle', {
        'cx': cx, 'cy': cy, 'r': r,
        'fill': '#4A90D9', 'stroke': '#fff', 'stroke-width': '1.5'
    }));
    // Plus sign
    const s = r * 0.5;
    g.appendChild(pbsCreateSVGElement('line', {
        'x1': cx - s, 'y1': cy, 'x2': cx + s, 'y2': cy,
        'stroke': '#fff', 'stroke-width': '2', 'stroke-linecap': 'round'
    }));
    g.appendChild(pbsCreateSVGElement('line', {
        'x1': cx, 'y1': cy - s, 'x2': cx, 'y2': cy + s,
        'stroke': '#fff', 'stroke-width': '2', 'stroke-linecap': 'round'
    }));
    const t = pbsCreateSVGElement('title', {});
    t.textContent = title;
    g.appendChild(t);
    return g;
}

function pbsRenderDeleteBtn(cx, cy, title, onClick) {
    const r = PBS_ADD_BTN_SIZE / 2;
    const g = pbsCreateSVGElement('g', { 'class': 'pbs-add-btn pbs-delete-btn', 'style': 'cursor: pointer;' });
    g.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });

    g.appendChild(pbsCreateSVGElement('circle', {
        'cx': cx, 'cy': cy, 'r': r,
        'fill': '#D94A4A', 'stroke': '#fff', 'stroke-width': '1.5'
    }));
    // X sign
    const s = r * 0.45;
    g.appendChild(pbsCreateSVGElement('line', {
        'x1': cx - s, 'y1': cy - s, 'x2': cx + s, 'y2': cy + s,
        'stroke': '#fff', 'stroke-width': '2', 'stroke-linecap': 'round'
    }));
    g.appendChild(pbsCreateSVGElement('line', {
        'x1': cx - s, 'y1': cy + s, 'x2': cx + s, 'y2': cy - s,
        'stroke': '#fff', 'stroke-width': '2', 'stroke-linecap': 'round'
    }));
    const t = pbsCreateSVGElement('title', {});
    t.textContent = title;
    g.appendChild(t);
    return g;
}

function pbsRenderNode(node, parentColour, nextColour, depth) {
    const isRoot = !!node._isRoot;
    let colour = isRoot ? '#4A90D9' : (depth === 1 ? nextColour() : (parentColour || '#4A90D9'));
    // RAG override: when enabled, colour non-root nodes by rolled-up schedule status
    if (pbsRagMode && !isRoot && node._task) {
        const tasksCtx = (typeof lastRenderedTasks !== 'undefined') ? lastRenderedTasks : [];
        const rag = pbsComputeRag(node._task, tasksCtx);
        const ragColour = pbsRagColour(rag);
        if (ragColour) colour = ragColour;
    }

    const g = pbsCreateSVGElement('g', {
        'class': 'pbs-node',
        'data-deliverable': node.deliverable || '',
        'style': 'cursor: pointer;'
    });

    // Click handler
    g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isRoot && typeof toggleProjectDetails === 'function') {
            toggleProjectDetails();
        } else if (node._task && typeof openProductForm === 'function') {
            openProductForm(node._task);
        }
    });

    // Right-click context menu: delete product marker
    if (!isRoot && node._task) {
        g.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            pbsDeleteProduct(node._task);
        });
    }

    // Invisible hit area extending beyond the node to keep hover active for + buttons
    if (!isRoot) {
        const pad = PBS_ADD_BTN_SIZE + 8;
        g.appendChild(pbsCreateSVGElement('rect', {
            'x': node.x - pad, 'y': node.y - pad,
            'width': node.width + pad * 2, 'height': node.height + pad * 2,
            'fill': 'transparent', 'stroke': 'none'
        }));
    }

    // Node shape based on product type:
    //   group (/) → parallelogram, external (^) → ellipse, internal → rounded rect
    const hasChildren = node.children && node.children.length > 0;
    const productType = (node._task && node._task.product_type) || 'internal';
    const skew = 10;
    if ((!isRoot && productType === 'group') || (hasChildren && !isRoot && productType === 'internal')) {
        // Parallelogram for groups and internal parents with children
        const x = node.x, y = node.y, w = node.width, h = node.height;
        const points = `${x + skew},${y} ${x + w},${y} ${x + w - skew},${y + h} ${x},${y + h}`;
        g.appendChild(pbsCreateSVGElement('polygon', {
            'points': points, 'fill': colour,
            'stroke': pbsShadeColour(colour, 0.7), 'stroke-width': '1.5',
            'class': 'pbs-node-rect'
        }));
    } else if (!isRoot && productType === 'external') {
        // Ellipse for external products
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;
        g.appendChild(pbsCreateSVGElement('ellipse', {
            'cx': cx, 'cy': cy,
            'rx': node.width / 2, 'ry': node.height / 2,
            'fill': colour,
            'stroke': pbsShadeColour(colour, 0.7), 'stroke-width': '1.5',
            'class': 'pbs-node-rect'
        }));
    } else {
        // Rounded rectangle for internal leaf products
        g.appendChild(pbsCreateSVGElement('rect', {
            'x': node.x, 'y': node.y, 'width': node.width, 'height': node.height,
            'rx': '6', 'ry': '6', 'fill': colour,
            'stroke': pbsShadeColour(colour, 0.7), 'stroke-width': '1.5',
            'class': 'pbs-node-rect'
        }));
    }

    // Product name — word-wrap onto up to 2 lines
    const fontSize = 11;
    const fontSpec = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const maxTextW = node.width - PBS_NODE_PADDING_X * 2;
    const words = (node.name || '').split(/\s+/);
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        if (pbsMeasureText(testLine, fontSpec) <= maxTextW || !currentLine) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);

    // Limit to 2 lines, truncate second line if needed
    if (lines.length > 2) {
        lines.length = 2;
        lines[1] = lines[1].substring(0, lines[1].length - 1) + '\u2026';
    }
    if (lines.length === 2 && pbsMeasureText(lines[1], fontSpec) > maxTextW) {
        while (lines[1].length > 1 && pbsMeasureText(lines[1] + '\u2026', fontSpec) > maxTextW) {
            lines[1] = lines[1].substring(0, lines[1].length - 1);
        }
        lines[1] += '\u2026';
    }

    const lineHeight = fontSize + 3;
    const totalTextH = lines.length * lineHeight;
    const textStartY = node.y + (node.height - totalTextH) / 2 + fontSize;

    for (let i = 0; i < lines.length; i++) {
        const tspan = pbsCreateSVGElement('text', {
            'x': node.x + node.width / 2,
            'y': textStartY + i * lineHeight,
            'text-anchor': 'middle', 'fill': '#fff', 'font-size': String(fontSize), 'font-weight': 'bold',
            'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        });
        tspan.textContent = lines[i];
        g.appendChild(tspan);
    }

    // Tooltip
    const title = pbsCreateSVGElement('title', {});
    if (isRoot) {
        title.textContent = `${node.name}\nClick to open project details`;
    } else {
        title.textContent = `${node.name}${node.deliverable ? '\n$' + node.deliverable : ''}\nClick to edit`;
    }
    g.appendChild(title);

    // Add + buttons (not on root) inside a container that's hidden until hover
    if (!isRoot && node._task) {
        const btns = pbsCreateSVGElement('g', { 'class': 'pbs-add-btns' });
        const btnGap = PBS_ADD_BTN_SIZE / 2 + 6;
        const taskName = node._task.name || node.name;

        btns.appendChild(pbsRenderAddBtn(
            node.x + node.width / 2, node.y + node.height + btnGap,
            'Add child product',
            () => pbsCreateProduct(taskName, 'child')
        ));
        btns.appendChild(pbsRenderAddBtn(
            node.x - btnGap, node.y + node.height / 2,
            'Add sibling before',
            () => pbsCreateProduct(taskName, 'before')
        ));
        btns.appendChild(pbsRenderAddBtn(
            node.x + node.width + btnGap, node.y + node.height / 2,
            'Add sibling after',
            () => pbsCreateProduct(taskName, 'after')
        ));
        // Delete (remove $deliverable marker) button, top-right of node
        const delivId = node._task.deliverable || node.deliverable;
        btns.appendChild(pbsRenderDeleteBtn(
            node.x + node.width + btnGap - PBS_ADD_BTN_SIZE / 2,
            node.y - btnGap + PBS_ADD_BTN_SIZE / 2,
            'Delete product (remove $' + (delivId || '') + ' marker)',
            () => pbsDeleteProduct(node._task)
        ));
        g.appendChild(btns);
    }

    pbsGroup.appendChild(g);

    for (const child of node.children) {
        pbsRenderNode(child, colour, nextColour, depth + 1);
    }
}

// ── PBS: SVG init & interaction ───────────────────────────────────────

function initPbs() {
    const container = document.getElementById('pbsContainer');
    if (!container) return;
    container.innerHTML = '';

    pbsSvg = pbsCreateSVGElement('svg', {
        'width': '100%',
        'height': '100%',
        'class': 'pbs-svg'
    });

    // Arrow marker definition
    const defs = pbsCreateSVGElement('defs', {});
    const marker = pbsCreateSVGElement('marker', {
        'id': 'pbs-arrowhead',
        'markerWidth': '10',
        'markerHeight': '7',
        'refX': '10',
        'refY': '3.5',
        'orient': 'auto'
    });
    const arrowPath = pbsCreateSVGElement('polygon', {
        'points': '0 0, 10 3.5, 0 7',
        'fill': '#E8833A'
    });
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    pbsSvg.appendChild(defs);

    container.appendChild(pbsSvg);

    // Pan/zoom handlers
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        pbsZoom = Math.max(0.1, Math.min(5, pbsZoom * delta));
        pbsApplyTransform();
    }, { passive: false });

    let panPointerId = null;
    container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.pbs-node')) return;
        panPointerId = e.pointerId;
        pbsIsDragging = true;
        pbsDragStartX = e.clientX;
        pbsDragStartY = e.clientY;
        pbsDragStartPanX = pbsPanX;
        pbsDragStartPanY = pbsPanY;
        container.style.cursor = 'grabbing';
        container.setPointerCapture(e.pointerId);
        e.preventDefault();
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerUp);
    });

    const onPointerMove = (e) => {
        if (!pbsIsDragging || e.pointerId !== panPointerId) return;
        pbsPanX = pbsDragStartPanX + (e.clientX - pbsDragStartX);
        pbsPanY = pbsDragStartPanY + (e.clientY - pbsDragStartY);
        pbsApplyTransform();
    };

    const onPointerUp = (e) => {
        if (!pbsIsDragging || e.pointerId !== panPointerId) return;
        pbsIsDragging = false;
        container.style.cursor = '';
        if (container.hasPointerCapture(panPointerId)) {
            container.releasePointerCapture(panPointerId);
        }
        panPointerId = null;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerUp);
    };
}

function pbsApplyTransform() {
    if (pbsGroup) {
        pbsGroup.setAttribute('transform', `translate(${pbsPanX},${pbsPanY}) scale(${pbsZoom})`);
    }
}

function pbsZoomFit() {
    if (!pbsSvg || !pbsTree) return;
    const container = document.getElementById('pbsContainer');
    if (!container) return;

    const bounds = pbsGetBounds(pbsTree);
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const padding = 60;

    const bw = bounds.maxX - bounds.minX + padding * 2;
    const bh = bounds.maxY - bounds.minY + padding * 2;

    pbsZoom = Math.min(cw / bw, ch / bh, 1.5);
    pbsPanX = (cw - bw * pbsZoom) / 2 - bounds.minX * pbsZoom + padding * pbsZoom;
    pbsPanY = (ch - bh * pbsZoom) / 2 - bounds.minY * pbsZoom + padding * pbsZoom;
    pbsApplyTransform();
}

function pbsGetBounds(node) {
    let minX = node.x, maxX = node.x + (node.subtreeWidth || node.width);
    let minY = node.y, maxY = node.y + node.height;
    for (const child of node.children) {
        const cb = pbsGetBounds(child);
        minX = Math.min(minX, cb.minX);
        maxX = Math.max(maxX, cb.maxX);
        minY = Math.min(minY, cb.minY);
        maxY = Math.max(maxY, cb.maxY);
    }
    return { minX, maxX, minY, maxY };
}

function pbsZoomIn() { pbsZoom = Math.min(5, pbsZoom * 1.2); pbsApplyTransform(); }
function pbsZoomOut() { pbsZoom = Math.max(0.1, pbsZoom * 0.8); pbsApplyTransform(); }
function pbsZoomReset() { pbsZoom = 1; pbsPanX = 0; pbsPanY = 0; pbsApplyTransform(); }

// ── PBS: Main update entry point ──────────────────────────────────────

function updatePbs(tasks, projectName) {
    pbsTasks = tasks || [];
    const deliverables = pbsExtractDeliverables(pbsTasks);

    // Check for duplicate deliverable identifiers (deferred so line numbers
    // are rebuilt before we add yellow dot classes to them)
    setTimeout(checkDuplicateDeliverables, 100);

    const placeholder = document.querySelector('#pbs-view .pbs-placeholder');
    const content = document.querySelector('#pbs-view .pbs-content');

    if (deliverables.length === 0) {
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
        pbsTree = null;
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    pbsTree = pbsBuildTree(pbsTasks, projectName);
    if (!pbsTree) return;

    initPbs();
    pbsMeasure(pbsTree);
    pbsLayoutTree(pbsTree, 40, 40);
    pbsRender();
    pbsZoomFit();
}

// ── Deliverables Matrix ───────────────────────────────────────────────

/**
 * Collect all unique stakeholder/resource shortnames across deliverables.
 * Sources: task quality_roles, front-matter Resources, and Key Stakeholders.
 * Returns an array of { shortname, displayName } sorted alphabetically.
 */
function _dmCollectPeople(deliverables, allTasks, resourceMap, stakeholders) {
    const people = {};  // shortname -> displayName

    // 1. From quality_roles on all tasks (including deliverables)
    for (const t of allTasks) {
        const qr = t.quality_roles;
        if (qr && typeof qr === 'object') {
            for (const name of Object.keys(qr)) {
                const key = name.toLowerCase();
                if (!people[key]) {
                    people[key] = resourceMap[key] || name;
                }
            }
        }
    }

    // 2. From front-matter Resources (resourceMap)
    if (resourceMap) {
        for (const [key, fullName] of Object.entries(resourceMap)) {
            if (!people[key]) {
                people[key] = fullName;
            }
        }
    }

    // 3. From Key Stakeholders — use shortname if available
    if (stakeholders && stakeholders.length > 0) {
        for (const s of stakeholders) {
            const key = (s.shortname || s.name || '').replace(/^@/, '').toLowerCase();
            const displayName = s.name || key;
            if (!people[key]) {
                people[key] = displayName;
            }
        }
    }

    // Look up roles from globalResourceDetails and stakeholders
    const roleMap = {};
    if (typeof globalResourceDetails !== 'undefined') {
        for (const [key, details] of Object.entries(globalResourceDetails)) {
            if (details && details.role) roleMap[key.toLowerCase()] = details.role;
        }
    }
    if (stakeholders && stakeholders.length > 0) {
        for (const s of stakeholders) {
            const key = (s.shortname || s.name || '').replace(/^@/, '').toLowerCase();
            if (s.role && !roleMap[key]) roleMap[key] = s.role;
        }
    }

    return Object.entries(people)
        .map(([shortname, displayName]) => ({
            shortname,
            displayName,
            role: roleMap[shortname] || ''
        }))
        .sort((a, b) => a.shortname.localeCompare(b.shortname));
}

/**
 * For a given deliverable task, collect all quality roles from the task
 * itself and its child activities.
 * Returns: { shortname: role_letter } merged map.
 */
function _dmGetRolesForDeliverable(deliverableTask, allTasks) {
    const merged = {};

    // Build reverse lookup: full name → shortname
    const reverseMap = {};
    if (typeof globalResourceMap !== 'undefined') {
        for (const [sn, fullName] of Object.entries(globalResourceMap)) {
            reverseMap[fullName.toLowerCase()] = sn.toLowerCase();
        }
    }

    function resolveShortname(name) {
        const lower = name.toLowerCase();
        return reverseMap[lower] || lower;
    }

    // From the deliverable task's quality_roles (explicit :P/:R/:A)
    const qr = deliverableTask.quality_roles;
    if (qr && typeof qr === 'object') {
        for (const [name, role] of Object.entries(qr)) {
            merged[name.toLowerCase()] = { role, inferred: false };
        }
    }

    // Regular resources on the deliverable default to Producer (inferred)
    if (deliverableTask.resources) {
        const resList = deliverableTask.resources.split(',').map(r => r.trim()).filter(r => r);
        for (const res of resList) {
            const key = resolveShortname(res);
            if (!merged[key]) merged[key] = { role: 'P', inferred: true };
        }
    }

    // From child activities
    const activities = pbsGetActivities(deliverableTask, allTasks);
    for (const act of activities) {
        const aqr = act.quality_roles;
        if (aqr && typeof aqr === 'object') {
            for (const [name, role] of Object.entries(aqr)) {
                const key = name.toLowerCase();
                if (!merged[key]) merged[key] = { role, inferred: false };
            }
        }
        // Regular resources on activities default to Producer (inferred)
        if (act.resources) {
            const resList = act.resources.split(',').map(r => r.trim()).filter(r => r);
            for (const res of resList) {
                const key = resolveShortname(res);
                if (!merged[key]) merged[key] = { role: 'P', inferred: true };
            }
        }
    }
    return merged;
}

function updateDeliverablesMatrix(tasks, projectName, resourceMap, stakeholders) {
    const container = document.getElementById('deliverablesMatrixBody');
    const thead = document.getElementById('deliverablesMatrixHead');
    const placeholder = document.querySelector('#deliverables-view .deliverables-placeholder');
    const content = document.querySelector('#deliverables-view .deliverables-content');

    if (!container) return;

    // Fall back to globals if not passed
    resourceMap = resourceMap || (typeof globalResourceMap !== 'undefined' ? globalResourceMap : {});
    stakeholders = stakeholders || window._lastStakeholders || [];

    // Exclude group products from the deliverables matrix — they are just containers
    const deliverables = pbsExtractDeliverables(tasks || []).filter(t => (t.product_type || 'internal') !== 'group');

    if (deliverables.length === 0) {
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    // Collect all people (resources + stakeholders) for column headers
    const people = _dmCollectPeople(deliverables, tasks || [], resourceMap, stakeholders);

    // Rebuild thead with dynamic person columns
    if (thead) {
        const headerRow = thead.querySelector('tr') || document.createElement('tr');
        headerRow.innerHTML = '';

        const fixedHeaders = ['ID', 'Deliverable', 'Description', 'Dates', 'Status'];
        for (const h of fixedHeaders) {
            const th = document.createElement('th');
            th.className = 'dm-col-fixed';
            th.textContent = h;
            headerRow.appendChild(th);
        }

        // One column per person — rotated header showing role, tooltip shows full name
        for (const p of people) {
            const th = document.createElement('th');
            th.className = 'dm-col-person';
            const span = document.createElement('span');
            span.className = 'dm-person-label';
            span.textContent = p.role || p.shortname;
            th.appendChild(span);
            th.title = p.displayName;
            headerRow.appendChild(th);
        }

        // Quality Assured column
        const qaHeader = document.createElement('th');
        qaHeader.className = 'dm-col-qa';
        qaHeader.textContent = 'QA';
        qaHeader.title = 'Quality Assured — tick when Producer, Reviewer, and Approver are all assigned';
        headerRow.appendChild(qaHeader);

        if (!thead.contains(headerRow)) thead.appendChild(headerRow);
    }

    container.innerHTML = '';

    for (const task of deliverables) {
        const rollup = pbsComputeRollup(task, tasks);
        const pct = rollup.percent;

        let status = 'Not Started';
        if (pct === 100) {
            status = 'Complete';
        } else if (pct > 0) {
            status = 'In Progress';
        }

        const rolesMap = _dmGetRolesForDeliverable(task, tasks);

        // Check quality-assured: has at least one P, one R, one A
        const roleLetters = Object.values(rolesMap).map(r => r.role || r);
        const hasP = roleLetters.includes('P');
        const hasR = roleLetters.includes('R');
        const hasA = roleLetters.includes('A');
        const isQA = hasP && hasR && hasA;

        const tr = document.createElement('tr');
        if (pct === 100) tr.classList.add('dm-row-complete');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
            // Don't open product form if clicking a role cell dropdown
            if (e.target.closest('.dm-role-cell')) return;
            if (typeof openProductForm === 'function') openProductForm(task);
        });

        const escapedName = (task.name || task.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const escapedComment = (task.comment || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Fixed columns: ID, Deliverable, Description, Dates, Status
        let html = `
            <td class="deliverable-id dm-col-fixed">$${task.deliverable}</td>
            <td class="deliverable-name dm-col-fixed">${escapedName}</td>
            <td class="deliverable-desc dm-col-fixed">${escapedComment}</td>
            <td class="deliverable-dates dm-col-fixed">${task.start || '\u2014'} \u2192 ${task.finish || '\u2014'}</td>
            <td class="deliverable-status dm-col-fixed">${status}</td>
        `;

        // Person/role columns with inline select
        for (const p of people) {
            const roleObj = rolesMap[p.shortname];
            const role = roleObj ? roleObj.role : '';
            const isInferred = roleObj ? roleObj.inferred : false;
            let roleLabel = '';
            let roleClass = 'dm-role-empty';
            if (role === 'P') { roleLabel = 'P'; roleClass = 'dm-role-producer'; }
            else if (role === 'R') { roleLabel = 'R'; roleClass = 'dm-role-reviewer'; }
            else if (role === 'A') { roleLabel = 'A'; roleClass = 'dm-role-approver'; }
            const inferredStyle = isInferred ? ' font-style: italic;' : '';

            html += `<td class="dm-role-cell" title="${p.displayName}">
                <select class="role-${role}" style="${inferredStyle}" data-deliverable="${task.deliverable}" data-person="${p.shortname}" onchange="dmUpdateRole(this)">
                    <option value=""${role === '' ? ' selected' : ''}>—</option>
                    <option value="P"${role === 'P' ? ' selected' : ''}>P</option>
                    <option value="R"${role === 'R' ? ' selected' : ''}>R</option>
                    <option value="A"${role === 'A' ? ' selected' : ''}>A</option>
                </select>
            </td>`;
        }

        // QA column
        html += `<td class="dm-col-qa-cell">${isQA ? '<span class="dm-qa-tick">&#10003;</span>' : ''}</td>`;

        tr.innerHTML = html;

        // No click handlers needed — selects handle role changes
        tr.querySelectorAll('.dm-role-cell').forEach(cell => {
            // Prevent row click when interacting with role cells
            cell.addEventListener('click', (e) => { e.stopPropagation(); });
        });

        container.appendChild(tr);
    }
}

/**
 * Show a dropdown to select P/R/A/empty for a role cell.
 */
/**
 * Handle role change from inline select dropdown.
 * Updates the plan text in the editor with the new @person:ROLE token.
 */
function dmUpdateRole(selectEl) {
    const deliverable = selectEl.dataset.deliverable;
    const person = selectEl.dataset.person;
    const newRole = selectEl.value;

    // Update colour class
    selectEl.className = newRole ? 'role-' + newRole : '';

    const editor = document.getElementById('planEditor');
    if (!editor || !deliverable || !person) return;

    const lineIdx = _findDeliverableLineIdx(editor.value, deliverable);
    if (lineIdx < 0) return;

    const lines = editor.value.split('\n');
    const line = lines[lineIdx];
    // Remove existing @person:P/R/A token for this person
    let newLine = line.replace(new RegExp('\\s*@' + person + ':[PRA]', 'gi'), '');

    if (newRole) {
        newLine = newLine.trimEnd() + ' @' + person + ':' + newRole;
    }

    if (newLine !== line) {
        lines[lineIdx] = newLine;
        editor.value = lines.join('\n');
        if (editor._updateLineNumbers) editor._updateLineNumbers();
        editor.dispatchEvent(new Event('input'));
        setTimeout(() => renderText(), 10);
    }
}

// ── Product Flow View (dependency graph) ──────────────────────────────

let pfSvg = null;
let pfGroup = null;
let pfZoom = 1;
let pfPanX = 0;
let pfPanY = 0;
let pfIsDragging = false;
let pfDragStartX = 0;
let pfDragStartY = 0;
let pfDragStartPanX = 0;
let pfDragStartPanY = 0;
let pfCollapsedGroups = new Set(); // legacy — replaced by pfExpandedStages
let pfExpandedStages = new Set();  // stages that are expanded to show children
let pfUserToggledExpand = false;   // true once user explicitly collapses/expands
let pfLastPositions = null;
let pfLastAllTasks = null;
let pfLastSummaries = null;
let pfDragConnection = null;     // { sourceKey, startX, startY } during drag-connect
let pfDragLine = null;           // SVG path element for live bezier preview
let pfSelectedArrow = null;      // { sourceKey, targetKey } of selected dependency arrow
let pfPositionsCache = null;     // cached positions for connector lookups
let pfDeliverableEdgesCache = null; // every real deliverable->deliverable dependency edge, collapse-independent (issue #986 badges)
let pfDeliverablesCache = null;     // the current render's flat deliverable list, for RAG lookups by id (issue #986 buried-detail)
let pfLastToggledGroupId = null;    // group just expanded/collapsed, so its node(s) get the #986 zoom-transition animation on this one render
let pfPendingConnectionSource = null; // tap connector, then tap a target node

const PF_NODE_W = 140;
const PF_NODE_H = 44;
const PF_H_GAP = 30;
const PF_V_GAP = 10;

function updateProductFlow(tasks, projectName) {
    const allTasks = tasks || [];
    let deliverables = pbsExtractDeliverables(allTasks);
    if (pfHideCompleted) {
        deliverables = deliverables.filter(d => {
            try {
                const r = pbsComputeRollup(d, allTasks);
                // Keep a deliverable if it has no activities (can't be "complete")
                // or if completion is less than 100%.
                if (!r || r.activityCount === 0) return true;
                return r.percent < 100;
            } catch (e) { return true; }
        });
    }

    const placeholder = document.querySelector('#product-flow-view .product-flow-placeholder');
    const content = document.querySelector('#product-flow-view .product-flow-content');

    if (deliverables.length === 0) {
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    // Classify deliverables into stages, intermediates, and leaves
    const childDeliverableParents = new Set();
    for (const d of deliverables) {
        if (d.parent) {
            const parentDel = deliverables.find(
                p => (p.name === d.parent || p.description === d.parent) && p.deliverable
            );
            if (parentDel) childDeliverableParents.add(parentDel.deliverable);
        }
    }

    // ALL summaries with child deliverables become stage nodes.
    // They are always expanded — children shown as flow nodes, with a
    // diamond gate node representing the summary's completion.
    const stageNodes = {};
    const hiddenSummaries = new Set(); // kept empty — no summaries are hidden now
    for (const id of childDeliverableParents) {
        const d = deliverables.find(dd => dd.deliverable === id);
        if (!d) continue;
        stageNodes[id] = { task: d, children: [] };
    }

    // Auto-expand all stages on first render only (when user hasn't made a choice)
    if (!pfUserToggledExpand) {
        for (const id of Object.keys(stageNodes)) {
            pfExpandedStages.add(id);
        }
    }

    // Build child lists — find leaf deliverables under each stage
    function findAncestorStage(d) {
        // Find the nearest parent that is a stage node
        let current = d;
        while (current && current.parent) {
            const parentDel = deliverables.find(
                p => (p.name === current.parent || p.description === current.parent) && p.deliverable
            );
            if (!parentDel) break;
            if (stageNodes[parentDel.deliverable]) return parentDel.deliverable;
            current = parentDel;
        }
        return null;
    }

    for (const d of deliverables) {
        if (childDeliverableParents.has(d.deliverable)) continue;
        if (hiddenSummaries.has(d.deliverable)) continue;
        const ancestorId = findAncestorStage(d);
        if (ancestorId && stageNodes[ancestorId]) {
            stageNodes[ancestorId].children.push(d.deliverable);
        }
    }

    const leafDeliverables = deliverables.filter(
        d => !childDeliverableParents.has(d.deliverable) && !hiddenSummaries.has(d.deliverable)
    );

    // Every real deliverable->deliverable dependency edge, independent of
    // which stages are currently collapsed -- issue #986's "N links" badge
    // and buried-detail marker need to see across a collapse boundary, which
    // the flow-node graph built below deliberately can't (it only ever
    // knows about whatever's on the board right now).
    pfDeliverableEdgesCache = [];
    pfDeliverablesCache = deliverables;
    for (const d of deliverables) {
        if (!d.depends) continue;
        for (const depName of d.depends) {
            const depDel = deliverables.find(dt => dt.name === depName || dt.description === depName);
            if (depDel && depDel.deliverable !== d.deliverable) {
                pfDeliverableEdgesCache.push({ from: depDel.deliverable, to: d.deliverable });
            }
        }
    }

    // Build the flow graph
    const nodes = {};

    // Check if a stage is inside a collapsed ancestor stage
    function isStageInsideCollapsed(stageId) {
        const stageDel = deliverables.find(dd => dd.deliverable === stageId);
        if (!stageDel) return false;
        let current = stageDel;
        while (current && current.parent) {
            const parentDel = deliverables.find(
                p => (p.name === current.parent || p.description === current.parent) && p.deliverable
            );
            if (!parentDel) break;
            if (stageNodes[parentDel.deliverable] && !pfExpandedStages.has(parentDel.deliverable)) return true;
            current = parentDel;
        }
        return false;
    }

    // Stage nodes: collapsed = single node, expanded = children + diamond gate
    for (const [id, stage] of Object.entries(stageNodes)) {
        // Skip stages that are inside a collapsed ancestor
        if (isStageInsideCollapsed(id)) continue;

        const isExpanded = pfExpandedStages.has(id);
        if (isExpanded) {
            // Add children as individual nodes (only if not inside collapsed ancestor)
            for (const cid of stage.children) {
                const childDel = deliverables.find(dd => dd.deliverable === cid);
                if (childDel && !nodes[cid]) nodes[cid] = { task: childDel, deps: [], column: 0 };
            }
            // Add diamond gate node
            const gateId = '_gate_' + id;
            const gateDeps = stage.children.map(cid => {
                if (stageNodes[cid] && !isStageInsideCollapsed(cid)) return '_gate_' + cid;
                if (stageNodes[cid]) return cid; // collapsed child stage
                return cid;
            }).filter(dep => nodes[dep] || nodes['_gate_' + dep.replace('_gate_', '')]);
            nodes[gateId] = {
                task: stage.task, deps: gateDeps, column: 0,
                isDiamond: true, groupId: id, childIds: stage.children
            };
        } else {
            nodes[id] = {
                task: stage.task, deps: [], column: 0,
                isStage: true, isCollapsed: true, groupId: id, childIds: stage.children
            };
        }
    }

    // Leaf deliverables: hide if ANY ancestor stage is collapsed
    function isInsideCollapsedStage(d) {
        let current = d;
        while (current && current.parent) {
            const parentDel = deliverables.find(
                p => (p.name === current.parent || p.description === current.parent) && p.deliverable
            );
            if (!parentDel) break;
            if (stageNodes[parentDel.deliverable] && !pfExpandedStages.has(parentDel.deliverable)) return true;
            current = parentDel;
        }
        return false;
    }

    for (const d of leafDeliverables) {
        if (isInsideCollapsedStage(d)) continue;
        if (!nodes[d.deliverable]) nodes[d.deliverable] = { task: d, deps: [], column: 0 };
    }

    // Resolve deliverable ID to flow node key
    function resolveFlowKey(delId) {
        if (nodes[delId]) return delId;
        for (const [id, stage] of Object.entries(stageNodes)) {
            if (pfExpandedStages.has(id)) {
                // Expanded stage: if delId is the stage itself, point to its diamond gate
                if (delId === id) return '_gate_' + id;
                // If delId is a child inside the expanded stage, it should be in nodes already
                if (stage.children.includes(delId)) return delId;
            } else {
                // Collapsed stage: children resolve to the stage node
                if (stage.children.includes(delId) || delId === id) return id;
            }
        }
        // Hidden intermediate without [depends]: find its last leaf descendant as proxy
        if (hiddenSummaries.has(delId)) {
            for (let i = leafDeliverables.length - 1; i >= 0; i--) {
                const ld = leafDeliverables[i];
                if (!nodes[ld.deliverable]) continue;
                let cur = ld;
                while (cur && cur.parent) {
                    const p = deliverables.find(pp => (pp.name === cur.parent || pp.description === cur.parent) && pp.deliverable);
                    if (!p) break;
                    if (p.deliverable === delId) return ld.deliverable;
                    cur = p;
                }
            }
        }
        return null;
    }

    // Build dependency edges
    for (const [nodeKey, node] of Object.entries(nodes)) {
        const task = node.task;
        node.relates = [];
        if (!task) continue;

        // Direct dependencies
        if (task.depends) {
            for (const depName of task.depends) {
                const depTask = deliverables.find(dt => dt.name === depName || dt.description === depName);
                if (depTask) {
                    const flowKey = resolveFlowKey(depTask.deliverable);
                    if (flowKey && flowKey !== nodeKey && !node.deps.includes(flowKey))
                        node.deps.push(flowKey);
                }
            }
        }

        // Associative links (issue #985: `[relates: ...]`, engine/tokeniser.js's
        // task.relates) -- non-scheduling, so they never enter node.deps or
        // affect the layout; noodle-edges.js just draws them dashed.
        if (task.relates) {
            for (const relName of task.relates) {
                const relTask = deliverables.find(dt => dt.name === relName || dt.description === relName);
                if (relTask) {
                    const flowKey = resolveFlowKey(relTask.deliverable);
                    if (flowKey && flowKey !== nodeKey && !node.relates.includes(flowKey))
                        node.relates.push(flowKey);
                }
            }
        }

        // Inherit parent dependencies (for nodes inside expanded stages)
        if (!node.isStage && task.parent) {
            const parentDel = deliverables.find(
                p => (p.name === task.parent || p.description === task.parent) && p.deliverable
            );
            if (parentDel && parentDel.depends) {
                for (const depName of parentDel.depends) {
                    const depTask = deliverables.find(dt => dt.name === depName || dt.description === depName);
                    if (depTask) {
                        const flowKey = resolveFlowKey(depTask.deliverable);
                        if (flowKey && flowKey !== nodeKey && !node.deps.includes(flowKey))
                            node.deps.push(flowKey);
                    }
                }
            }
        }

        // Collapsed stages: aggregate children deps
        if (node.isCollapsed && node.childIds) {
            for (const cid of node.childIds) {
                const childDel = deliverables.find(dd => dd.deliverable === cid);
                if (childDel && childDel.depends) {
                    for (const depName of childDel.depends) {
                        const depTask = deliverables.find(dt => dt.name === depName || dt.description === depName);
                        if (depTask) {
                            const flowKey = resolveFlowKey(depTask.deliverable);
                            if (flowKey && flowKey !== nodeKey && !node.deps.includes(flowKey))
                                node.deps.push(flowKey);
                        }
                    }
                }
            }
        }
    }

    // Deduplicate and clean deps
    for (const [nodeKey, node] of Object.entries(nodes)) {
        node.deps = [...new Set(node.deps.map(d => resolveFlowKey(d) || d))].filter(d => d !== nodeKey);
        node.relates = [...new Set((node.relates || []).map(d => resolveFlowKey(d) || d))]
            .filter(d => d !== nodeKey && !node.deps.includes(d));
    }

    // Build topLevelSummaries for bounding box rendering (expanded stages only)
    const topLevelSummaries = {};
    for (const [id, stage] of Object.entries(stageNodes)) {
        if (pfExpandedStages.has(id)) topLevelSummaries[id] = stage;
    }

    // -- Layout engine (issue #984) ------------------------------------------
    // A seeded, spring-relaxed layout swapped in for what used to be a
    // hand-tuned column + barycenter-ordering + average-y-nudge heuristic --
    // see noodle-layout.js's own header for the physics this runs (taut
    // dependency chains settle straight, loose nodes drift, pins hold, and
    // an edit only disturbs the neighbourhood that actually changed). This
    // file still owns the flow-graph shape (stages, diamond gates,
    // collapse/expand) -- that's product-flow business logic, not layout --
    // it just hands the resulting node/edge graph to the engine instead of
    // solving coordinates itself. Every flow node (deliverable, collapsed
    // stage, or diamond gate) becomes a task-like node keyed by its own flow
    // key, since `deps` here already resolves to other flow keys rather
    // than raw task names.
    const layoutTasks = Object.entries(nodes).map(([key, node]) => ({
        name: key,
        depends: node.deps,
        resources: node.task ? node.task.resources : '',
        pin: node.task ? node.task.pin : undefined,
        start: node.task ? node.task.start : undefined,
        summary: false,
    }));

    // Local disturbance on edit: a node that was already on the board seeds
    // from where it last settled; only nodes that appeared or disappeared
    // since the previous render count as "dirty" and are free to move the
    // board around them -- everything else holds still. On the very first
    // render there is no previous layout, so everything is free.
    const previousLayout = new Map();
    const previousKeys = new Set();
    if (pfPositionsCache) {
        for (const [key, pos] of Object.entries(pfPositionsCache)) {
            previousLayout.set(key.toLowerCase(), { x: pos.x, y: pos.y });
            previousKeys.add(key.toLowerCase());
        }
    }
    let dirty;
    if (previousKeys.size) {
        const currentKeys = new Set(Object.keys(nodes).map(k => k.toLowerCase()));
        dirty = new Set();
        currentKeys.forEach(k => { if (!previousKeys.has(k)) dirty.add(k); });
        previousKeys.forEach(k => { if (!currentKeys.has(k)) dirty.add(k); });
    }

    const planTextEl = document.getElementById('planEditor');
    const maxDistance = noodleFrontMatterNumber(planTextEl ? planTextEl.value : '', 'noodle_max_distance', 320);
    const PF_DIAMOND_EXTRA = 20;

    const layoutResult = noodleComputeLayout(layoutTasks, {
        columnWidth: PF_NODE_W + PF_H_GAP,
        rowHeight: PF_NODE_H + PF_V_GAP + PF_DIAMOND_EXTRA,
        maxDistance,
        previous: previousKeys.size ? previousLayout : undefined,
        dirty,
    });

    const positions = {};
    for (const [key, node] of Object.entries(nodes)) {
        const p = layoutResult.positions[key.toLowerCase()];
        positions[key] = {
            x: 40 + (p ? p.x : 0),
            y: 40 + (p ? p.y - layoutResult.bounds.minY : 0),
            task: node.task,
            deps: node.deps,
            relates: node.relates || [],
            isCollapsed: node.isCollapsed || false,
            isDiamond: node.isDiamond || false,
            groupId: node.groupId || null,
            childIds: node.childIds || null,
            pinned: p ? p.pinned : false,
            restless: p ? p.restless : 0,
        };
    }

    // Render
    if (!pfSvg) initProductFlow();
    pfRender(positions, allTasks, topLevelSummaries);
    pfZoomFit(positions);
}

function initProductFlow() {
    const container = document.getElementById('productFlowContainer');
    if (!container) return;
    container.innerHTML = '';

    pfSvg = pbsCreateSVGElement('svg', { 'width': '100%', 'height': '100%', 'class': 'pbs-svg' });

    const defs = pbsCreateSVGElement('defs', {});
    const marker = pbsCreateSVGElement('marker', {
        'id': 'pf-arrowhead', 'markerWidth': '10', 'markerHeight': '7',
        'refX': '10', 'refY': '3.5', 'orient': 'auto'
    });
    marker.appendChild(pbsCreateSVGElement('polygon', { 'points': '0 0, 10 3.5, 0 7', 'fill': '#E8833A' }));
    defs.appendChild(marker);
    pfSvg.appendChild(defs);
    container.appendChild(pfSvg);

    // Pan/zoom
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        pfZoom = Math.max(0.1, Math.min(5, pfZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
        pfApplyTransform();
    }, { passive: false });

    // Click on empty space deselects arrows
    container.addEventListener('click', (e) => {
        if (!e.target.closest('.pf-node') && !e.target.closest('.pf-arrow')) {
            pfClearPendingConnection();
            if (pfSelectedArrow) {
                pfGroup.querySelectorAll('.pf-arrow.selected').forEach(el => {
                    el.classList.remove('selected');
                    el.setAttribute('stroke', '#E8833A');
                    el.setAttribute('stroke-width', '2');
                });
                pfSelectedArrow = null;
            }
        }
    });

    // Delete key removes selected arrow
    container.setAttribute('tabindex', '0');
    container.style.outline = 'none';
    container.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && pfSelectedArrow) {
            e.preventDefault();
            pfDeleteSelectedArrow();
        } else if (e.key === 'Escape' && pfPendingConnectionSource) {
            e.preventDefault();
            pfClearPendingConnection();
        }
    });

    let panPointerId = null;
    container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.pf-node')) return;
        if (e.target.closest('.pf-connector-out')) return;
        panPointerId = e.pointerId;
        pfIsDragging = true;
        pfDragStartX = e.clientX;
        pfDragStartY = e.clientY;
        pfDragStartPanX = pfPanX;
        pfDragStartPanY = pfPanY;
        container.style.cursor = 'grabbing';
        container.setPointerCapture(e.pointerId);
        e.preventDefault();
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    });

    const onMove = (e) => {
        if (!pfIsDragging || e.pointerId !== panPointerId) return;
        pfPanX = pfDragStartPanX + (e.clientX - pfDragStartX);
        pfPanY = pfDragStartPanY + (e.clientY - pfDragStartY);
        pfApplyTransform();
    };
    const onUp = (e) => {
        if (!pfIsDragging || e.pointerId !== panPointerId) return;
        pfIsDragging = false;
        container.style.cursor = '';
        if (container.hasPointerCapture(panPointerId)) {
            container.releasePointerCapture(panPointerId);
        }
        panPointerId = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
    };
}

function pfApplyTransform() {
    if (pfGroup) pfGroup.setAttribute('transform', `translate(${pfPanX},${pfPanY}) scale(${pfZoom})`);
}

function pfClearPendingConnection() {
    pfPendingConnectionSource = null;
    if (pfGroup) {
        pfGroup.querySelectorAll('.pf-connector-out.pending')
            .forEach(connector => connector.classList.remove('pending'));
    }
}

function pfRender(positions, allTasks, topLevelSummaries) {
    if (!pfSvg) return;
    pfClearPendingConnection();
    if (pfGroup) pfGroup.remove();
    pfGroup = pbsCreateSVGElement('g', { 'transform': `translate(${pfPanX},${pfPanY}) scale(${pfZoom})` });
    pfSvg.appendChild(pfGroup);

    // Pre-calculate diamond centres for arrow routing
    const diamondW = 22;
    for (const [key, pos] of Object.entries(positions)) {
        if (pos.isDiamond) {
            pos._diamondCx = pos.x + PF_NODE_W / 2;
            pos._diamondCy = pos.y + PF_NODE_H / 2;
            pos._diamondW = diamondW;
        }
    }

    // Draw edges (clickable for deletion) -- issue #985's port model + bezier
    // renderer, kept strictly separate from the layout it hands off from
    // (noodle-edges.js's header). A diamond gate's "port" is its left/right
    // tip rather than a rectangle edge, so noodles still meet its point.
    function pfPortRectFor(pos) {
        if (pos.isDiamond && pos._diamondCx) {
            return { x: pos._diamondCx - pos._diamondW, y: pos._diamondCy - PF_NODE_H / 2, width: pos._diamondW * 2, height: PF_NODE_H };
        }
        return { x: pos.x, y: pos.y, width: PF_NODE_W, height: PF_NODE_H };
    }
    function pfDrawEdge(sourceKey, targetKey, src, dst, kind) {
        const exit = noodleEdgePorts(pfPortRectFor(src)).exit;
        const entry = noodleEdgePorts(pfPortRectFor(dst)).entry;
        const d = noodleEdgePathD([exit, entry]);
        const style = noodleEdgeStyle(kind); // solid = dependency, dashed = associative
        const strokeColour = kind === 'associative' ? '#9a9a9a' : '#E8833A';

        const arrow = pbsCreateSVGElement('path', {
            'd': d, 'fill': 'none', 'stroke': strokeColour, 'stroke-width': '2',
            'marker-end': 'url(#pf-arrowhead)',
            'class': 'pf-arrow' + (kind === 'associative' ? ' pf-arrow-associative' : ''),
            'data-source': sourceKey, 'data-target': targetKey
        });
        if (style.dasharray) arrow.setAttribute('stroke-dasharray', style.dasharray);

        // Wider invisible hit area for clicking
        const hitArea = pbsCreateSVGElement('path', {
            'd': d, 'fill': 'none', 'stroke': 'transparent', 'stroke-width': '12',
            'style': 'cursor: pointer;'
        });
        hitArea.addEventListener('click', (e) => {
            e.stopPropagation();
            pfSelectArrow(sourceKey, targetKey, arrow);
        });

        pfGroup.appendChild(arrow);
        pfGroup.appendChild(hitArea);
    }

    pfSelectedArrow = null;
    for (const [key, pos] of Object.entries(positions)) {
        for (const dep of pos.deps) {
            const src = positions[dep];
            if (src) pfDrawEdge(dep, key, src, pos, 'dependency');
        }
        for (const rel of (pos.relates || [])) {
            const src = positions[rel];
            if (src) pfDrawEdge(rel, key, src, pos, 'associative');
        }
    }

    // Draw nodes
    let colourIdx = 0;
    for (const [key, pos] of Object.entries(positions)) {
        const task = pos.task;
        let colour = PBS_COLOURS[colourIdx % PBS_COLOURS.length];
        colourIdx++;
        if (pbsRagMode && task) {
            const rag = pbsComputeRag(task, allTasks || []);
            const ragColour = pbsRagColour(rag);
            if (ragColour) colour = ragColour;
        }
        const isCollapsedNode = !!pos.isCollapsed;
        const isDiamondNode = !!pos.isDiamond;

        // Restless nodes (issue #984): a task missing an estimate, an owner,
        // or any connection wobbles gently until completed -- a pure CSS
        // animation, gated on the amplitude the layout engine reported and
        // on prefers-reduced-motion, so the wobble is a calm-by-default
        // attention cue rather than a gimmick that moves just to look busy.
        const restlessClass = (pos.restless > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            ? ' pf-restless' : '';
        // #986: whatever the user just expanded/collapsed gets a short
        // enter animation on this one render, so the eye can track the
        // change rather than the diagram silently jumping to a new shape.
        const zoomTransitionClass = (pfLastToggledGroupId && (key === pfLastToggledGroupId || key === '_gate_' + pfLastToggledGroupId))
            ? ' pf-zoom-transition' : '';
        const g = pbsCreateSVGElement('g', { 'class': 'pf-node' + restlessClass + zoomTransitionClass, 'style': 'cursor: pointer;' + (pos.restless > 0 ? ` --pf-restless-amplitude: ${(1 + pos.restless * 2).toFixed(2)}px;` : '') });
        g.dataset.key = key;
        g.addEventListener('click', (event) => {
            if (!pfPendingConnectionSource) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (pfPendingConnectionSource !== key) {
                pfCreateDependency(pfPendingConnectionSource, key);
            }
            pfClearPendingConnection();
        });

        // Invisible hit area for hover (extends to cover connectors)
        const connPad = 20;
        const nw = PF_NODE_W;
        g.appendChild(pbsCreateSVGElement('rect', {
            'x': pos.x - connPad, 'y': pos.y - 4,
            'width': nw + connPad * 2, 'height': PF_NODE_H + 8,
            'fill': 'transparent', 'stroke': 'none'
        }));

        if (isDiamondNode) {
            // Diamond gate node — represents stage completion
            // No default click — popup handles actions

            // Diamond shape centred at node position
            const cx = pos.x + PF_NODE_W / 2;
            const cy = pos.y + PF_NODE_H / 2;
            const dw = 22; // half-width
            const dh = 18; // half-height
            // Store diamond centre for arrow routing
            pos._diamondCx = cx;
            pos._diamondCy = cy;
            pos._diamondW = dw;

            g.appendChild(pbsCreateSVGElement('polygon', {
                'points': `${cx},${cy - dh} ${cx + dw},${cy} ${cx},${cy + dh} ${cx - dw},${cy}`,
                'fill': colour, 'stroke': pbsShadeColour(colour, 0.7), 'stroke-width': '1.5'
            }));

            // Stage name below diamond — wrap onto two lines
            const fullName = (task.name || key);
            const line1 = fullName.length > 14 ? fullName.substring(0, 13) + '\u2026' : fullName;
            const line2 = 'complete';

            const label1 = pbsCreateSVGElement('text', {
                'x': cx, 'y': cy + dh + 12,
                'text-anchor': 'middle', 'fill': colour, 'font-size': '9', 'font-weight': 'bold',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            });
            label1.textContent = line1;
            g.appendChild(label1);

            const label2 = pbsCreateSVGElement('text', {
                'x': cx, 'y': cy + dh + 23,
                'text-anchor': 'middle', 'fill': colour, 'font-size': '9', 'opacity': '0.7',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            });
            label2.textContent = line2;
            g.appendChild(label2);

            // Hover popup with collapse/edit options
            const popupG = pbsCreateSVGElement('g', { 'class': 'pf-diamond-popup' });
            const popupY = cy - dh - 36;
            const popupW = 120;
            const popupX = cx - popupW / 2;

            // Popup background
            popupG.appendChild(pbsCreateSVGElement('rect', {
                'x': popupX, 'y': popupY, 'width': popupW, 'height': 28,
                'rx': '4', 'ry': '4', 'fill': '#333', 'opacity': '0.95'
            }));

            // Collapse button
            const collapseBtn = pbsCreateSVGElement('g', { 'style': 'cursor: pointer;' });
            collapseBtn.appendChild(pbsCreateSVGElement('text', {
                'x': popupX + 12, 'y': popupY + 18,
                'fill': '#fff', 'font-size': '11',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            })).textContent = '\u25B2 Collapse';
            const groupId = pos.groupId;
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (groupId) pfToggleGroup(groupId);
            });
            popupG.appendChild(collapseBtn);

            // Separator
            popupG.appendChild(pbsCreateSVGElement('line', {
                'x1': cx, 'y1': popupY + 4, 'x2': cx, 'y2': popupY + 24,
                'stroke': '#555', 'stroke-width': '1'
            }));

            // Edit button
            const editBtn = pbsCreateSVGElement('g', { 'style': 'cursor: pointer;' });
            editBtn.appendChild(pbsCreateSVGElement('text', {
                'x': cx + 8, 'y': popupY + 18,
                'fill': '#fff', 'font-size': '11',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            })).textContent = '\u270E Edit';
            const editTask = task;
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (editTask && typeof openProductForm === 'function') openProductForm(editTask);
            });
            popupG.appendChild(editBtn);

            // Arrow pointing down to diamond
            popupG.appendChild(pbsCreateSVGElement('polygon', {
                'points': `${cx - 5},${popupY + 28} ${cx + 5},${popupY + 28} ${cx},${popupY + 34}`,
                'fill': '#333', 'opacity': '0.95'
            }));

            g.appendChild(popupG);
        } else if (isCollapsedNode) {
            // Collapsed group placeholder
            g.addEventListener('click', (e) => {
                e.stopPropagation();
                pfToggleGroup(pos.groupId);
            });

            // Dashed outline box
            g.appendChild(pbsCreateSVGElement('rect', {
                'x': pos.x, 'y': pos.y, 'width': PF_NODE_W, 'height': PF_NODE_H,
                'rx': '6', 'ry': '6', 'fill': 'rgba(74,144,217,0.1)',
                'stroke': colour, 'stroke-width': '1.5', 'stroke-dasharray': '6,3'
            }));

            // Disclosure triangle (right = collapsed)
            const triX = pos.x + 10;
            const triY = pos.y + PF_NODE_H / 2;
            g.appendChild(pbsCreateSVGElement('polygon', {
                'points': `${triX},${triY - 5} ${triX},${triY + 5} ${triX + 6},${triY}`,
                'fill': colour, 'opacity': '0.8'
            }));

            // Name
            const label = pbsCreateSVGElement('text', {
                'x': pos.x + PF_NODE_W / 2 + 6, 'y': pos.y + PF_NODE_H / 2 + 4,
                'text-anchor': 'middle', 'fill': colour, 'font-size': '12', 'font-weight': 'bold',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            });
            let name = task.name || key;
            if (name.length > 20) name = name.substring(0, 19) + '\u2026';
            label.textContent = name;
            g.appendChild(label);

            const title = pbsCreateSVGElement('title', {});
            title.textContent = `${task.name}\nClick to expand`;
            g.appendChild(title);

            // -- Semantic zoom (issue #986) --------------------------------
            // A collapsed node visually inherits its children's external
            // dependencies (a "N links" badge) and, if there's something
            // worth a second look buried inside it, a subtle marker -- both
            // computed from the real, collapse-independent deliverable
            // graph (pfDeliverableEdgesCache), never by moving a dependency
            // onto the summary task itself.
            if (pos.childIds && pos.childIds.length && pfDeliverableEdgesCache) {
                const insideKeys = new Set(pos.childIds);
                const crossing = noodleCountCrossingEdges(pfDeliverableEdgesCache, insideKeys);
                const badgeLabel = noodleBadgeLabel(crossing.total);
                if (badgeLabel) {
                    const badgeCx = pos.x + PF_NODE_W - 4;
                    const badgeCy = pos.y - 2;
                    const badgeW = 14 + badgeLabel.length * 5.2;
                    g.appendChild(pbsCreateSVGElement('rect', {
                        'x': badgeCx - badgeW / 2, 'y': badgeCy - 8, 'width': badgeW, 'height': 16,
                        'rx': '8', 'ry': '8', 'fill': '#02384d', 'class': 'pf-badge'
                    }));
                    const badgeText = pbsCreateSVGElement('text', {
                        'x': badgeCx, 'y': badgeCy + 4, 'text-anchor': 'middle',
                        'fill': '#ffffff', 'font-size': '9', 'font-weight': 'bold',
                        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                    });
                    badgeText.textContent = badgeLabel;
                    g.appendChild(badgeText);
                }

                const hasAtRiskDescendant = pos.childIds.some((cid) => {
                    const childDel = (pfDeliverablesCache || []).find((dd) => dd.deliverable === cid);
                    return childDel && pbsComputeRag(childDel, allTasks || []) === 'red';
                });
                const buried = noodleBuriedDetail(pfDeliverableEdgesCache, insideKeys, { hasAtRiskDescendant });
                if (buried.buried) {
                    const marker = pbsCreateSVGElement('circle', {
                        'cx': pos.x + 6, 'cy': pos.y - 2, 'r': '4',
                        'class': 'pf-buried-detail-marker'
                    });
                    const markerTitle = pbsCreateSVGElement('title', {});
                    markerTitle.textContent = 'Buried detail: ' + buried.reasons.join(', ');
                    marker.appendChild(markerTitle);
                    g.appendChild(marker);
                }
            }
        } else {
            // Regular node
            g.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof openProductForm === 'function') openProductForm(task);
            });

            g.appendChild(pbsCreateSVGElement('rect', {
                'x': pos.x, 'y': pos.y, 'width': PF_NODE_W, 'height': PF_NODE_H,
                'rx': '6', 'ry': '6', 'fill': colour,
                'stroke': pbsShadeColour(colour, 0.7), 'stroke-width': '1.5'
            }));

            const label = pbsCreateSVGElement('text', {
                'x': pos.x + PF_NODE_W / 2, 'y': pos.y + 18,
                'text-anchor': 'middle', 'fill': '#fff', 'font-size': '12', 'font-weight': 'bold',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            });
            let name = task.name || key;
            if (name.length > 22) name = name.substring(0, 21) + '\u2026';
            label.textContent = name;
            g.appendChild(label);

            const sub = pbsCreateSVGElement('text', {
                'x': pos.x + PF_NODE_W / 2, 'y': pos.y + 34,
                'text-anchor': 'middle', 'fill': 'rgba(255,255,255,0.7)', 'font-size': '10',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            });
            sub.textContent = `$${key}`;
            g.appendChild(sub);

            const title = pbsCreateSVGElement('title', {});
            title.textContent = `${task.name}\n$${key}\nClick to edit`;
            g.appendChild(title);
        }

        // Connection connectors (left = input, right = output)
        const connR = 8;
        const connectors = pbsCreateSVGElement('g', { 'class': 'pf-connectors' });

        // Right connector (output — drag FROM here)
        const rightCx = pos.x + PF_NODE_W + connR + 2;
        const rightCy = pos.y + PF_NODE_H / 2;
        const rightConn = pbsCreateSVGElement('g', { 'class': 'pf-connector-out', 'style': 'cursor: crosshair;' });
        rightConn.appendChild(pbsCreateSVGElement('circle', {
            'cx': rightCx, 'cy': rightCy, 'r': connR,
            'fill': '#4A90D9', 'stroke': '#fff', 'stroke-width': '1.5'
        }));
        rightConn.appendChild(pbsCreateSVGElement('line', {
            'x1': rightCx - 3, 'y1': rightCy, 'x2': rightCx + 3, 'y2': rightCy,
            'stroke': '#fff', 'stroke-width': '2', 'stroke-linecap': 'round'
        }));
        rightConn.appendChild(pbsCreateSVGElement('line', {
            'x1': rightCx, 'y1': rightCy - 3, 'x2': rightCx, 'y2': rightCy + 3,
            'stroke': '#fff', 'stroke-width': '2', 'stroke-linecap': 'round'
        }));
        const srcKey = key;
        rightConn.setAttribute('role', 'button');
        rightConn.setAttribute('tabindex', '0');
        rightConn.setAttribute('aria-label', `Connect ${task.name} to another product`);
        rightConn.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            pfStartDragConnect(srcKey, rightCx, rightCy, e);
        });
        const selectConnectionSource = (e) => {
            e.stopPropagation();
            pfClearPendingConnection();
            pfPendingConnectionSource = srcKey;
            rightConn.classList.add('pending');
        };
        rightConn.addEventListener('click', selectConnectionSource);
        rightConn.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectConnectionSource(e);
            }
        });
        connectors.appendChild(rightConn);

        // Left connector (input — drop TO here)
        const leftCx = pos.x - connR - 2;
        const leftCy = pos.y + PF_NODE_H / 2;
        const leftConn = pbsCreateSVGElement('g', { 'class': 'pf-connector-in', 'style': 'cursor: crosshair;', 'data-key': key });
        leftConn.appendChild(pbsCreateSVGElement('circle', {
            'cx': leftCx, 'cy': leftCy, 'r': connR,
            'fill': '#5CB85C', 'stroke': '#fff', 'stroke-width': '1.5'
        }));
        leftConn.appendChild(pbsCreateSVGElement('line', {
            'x1': leftCx - 3, 'y1': leftCy, 'x2': leftCx + 3, 'y2': leftCy,
            'stroke': '#fff', 'stroke-width': '2', 'stroke-linecap': 'round'
        }));
        leftConn.appendChild(pbsCreateSVGElement('line', {
            'x1': leftCx, 'y1': leftCy - 3, 'x2': leftCx, 'y2': leftCy + 3,
            'stroke': '#fff', 'stroke-width': '2', 'stroke-linecap': 'round'
        }));
        connectors.appendChild(leftConn);

        g.appendChild(connectors);
        pfGroup.appendChild(g);
    }

    // Cache positions for drag-connect lookups
    pfPositionsCache = positions;

    // Orphan detection: highlight nodes that are dead-ends in the flow
    // (no outgoing deps except the last column, no incoming deps except the first column)
    const allKeys = Object.keys(positions);
    const hasIncoming = new Set();
    const hasOutgoing = new Set();
    for (const [key, pos] of Object.entries(positions)) {
        for (const dep of pos.deps) {
            hasOutgoing.add(dep);    // dep has an outgoing connection (something depends on it)
            hasIncoming.add(key);     // key has an incoming connection (it depends on something)
        }
    }

    // Find min/max columns to identify first/last products
    let minCol = Infinity, maxCol = -Infinity;
    for (const pos of Object.values(positions)) {
        const col = Math.round((pos.x - 40) / (PF_NODE_W + PF_H_GAP));
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
    }

    for (const [key, pos] of Object.entries(positions)) {
        const col = Math.round((pos.x - 40) / (PF_NODE_W + PF_H_GAP));
        const isFirst = col === minCol;
        const isLast = col === maxCol;
        const noIncoming = !hasIncoming.has(key) && !isFirst;
        const noOutgoing = !hasOutgoing.has(key) && !isLast;

        if (noIncoming || noOutgoing) {
            // Draw orphan indicator — orange dashed border around the node
            const nodeW = PF_NODE_W;
            const cx = pos.x + nodeW / 2;
            const cy = pos.y + PF_NODE_H / 2;
            if (pos.isDiamond && pos._diamondW) {
                const dw = pos._diamondW + 6;
                const dh = 24;
                pfGroup.appendChild(pbsCreateSVGElement('polygon', {
                    'points': `${cx},${cy - dh} ${cx + dw},${cy} ${cx},${cy + dh} ${cx - dw},${cy}`,
                    'fill': 'none', 'stroke': '#E8833A', 'stroke-width': '2',
                    'stroke-dasharray': '4,3', 'class': 'pf-orphan-indicator'
                }));
            } else {
                pfGroup.appendChild(pbsCreateSVGElement('rect', {
                    'x': pos.x - 3, 'y': pos.y - 3,
                    'width': nodeW + 6, 'height': PF_NODE_H + 6,
                    'rx': '8', 'ry': '8',
                    'fill': 'none', 'stroke': '#E8833A', 'stroke-width': '2',
                    'stroke-dasharray': '4,3', 'class': 'pf-orphan-indicator'
                }));
            }
        }
    }

    // The zoom-transition animation (#986) is a one-render enter effect --
    // clear it so the *next* render doesn't replay it on an untouched node.
    pfLastToggledGroupId = null;
}

// ── Product Flow: Drag-to-connect ─────────────────────────────────────

function pfStartDragConnect(sourceKey, startX, startY, e) {
    pfDragConnection = {
        sourceKey,
        startX,
        startY,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        sourceElement: e.currentTarget,
        moved: false
    };

    // Create preview bezier line
    pfDragLine = pbsCreateSVGElement('path', {
        'd': `M${startX},${startY} L${startX},${startY}`,
        'fill': 'none', 'stroke': '#4A90D9', 'stroke-width': '2',
        'stroke-dasharray': '6,3', 'pointer-events': 'none'
    });
    pfGroup.appendChild(pfDragLine);

    const container = document.getElementById('productFlowContainer');

    const onMove = (e) => {
        if (!pfDragConnection || !pfDragLine ||
            e.pointerId !== pfDragConnection.pointerId) return;
        if (Math.hypot(
            e.clientX - pfDragConnection.startClientX,
            e.clientY - pfDragConnection.startClientY
        ) >= 8) {
            pfDragConnection.moved = true;
        }
        // Convert mouse position to SVG coordinates
        const rect = container.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - pfPanX) / pfZoom;
        const mouseY = (e.clientY - rect.top - pfPanY) / pfZoom;
        const midX = (startX + mouseX) / 2;
        pfDragLine.setAttribute('d',
            `M${startX},${startY} C${midX},${startY} ${midX},${mouseY} ${mouseX},${mouseY}`
        );

        // Highlight nearest target node
        pfGroup.querySelectorAll('.pf-node').forEach(n => n.style.filter = '');
        const nearest = pfFindNearestInput(mouseX, mouseY);
        if (nearest && nearest.key !== pfDragConnection.sourceKey && nearest.dist < 50) {
            const targetNode = pfGroup.querySelectorAll('.pf-node');
            // Find the node group by matching position
            targetNode.forEach(n => {
                const delivAttr = n.querySelector('[data-key]');
                if (delivAttr && delivAttr.getAttribute('data-key') === nearest.key) {
                    n.style.filter = 'brightness(1.3)';
                }
            });
        }
    };

    const onUp = (e) => {
        if (!pfDragConnection || e.pointerId !== pfDragConnection.pointerId) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);

        if (pfDragLine) { pfDragLine.remove(); pfDragLine = null; }

        if (!pfDragConnection) return;

        // Find target at drop position
        const rect = container.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - pfPanX) / pfZoom;
        const mouseY = (e.clientY - rect.top - pfPanY) / pfZoom;
        const target = pfFindNearestInput(mouseX, mouseY);

        if (e.type !== 'pointercancel' && !pfDragConnection.moved) {
            pfClearPendingConnection();
            pfPendingConnectionSource = pfDragConnection.sourceKey;
            pfDragConnection.sourceElement.classList.add('pending');
        } else if (e.type !== 'pointercancel' &&
            target && target.key !== pfDragConnection.sourceKey && target.dist < 50) {
            pfCreateDependency(pfDragConnection.sourceKey, target.key);
        }

        // Reset node highlights
        pfGroup.querySelectorAll('.pf-node').forEach(n => n.style.filter = '');

        pfDragConnection = null;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

function pfFindNearestInput(x, y) {
    if (!pfPositionsCache) return null;
    let nearest = null;
    let minDist = Infinity;
    for (const [key, pos] of Object.entries(pfPositionsCache)) {
        // Check if cursor is inside or near the node body
        const nodeW = PF_NODE_W;
        const cx = pos.x + nodeW / 2;
        const cy = pos.y + PF_NODE_H / 2;
        const insideX = x >= pos.x - 10 && x <= pos.x + nodeW + 10;
        const insideY = y >= pos.y - 10 && y <= pos.y + PF_NODE_H + 10;
        const dist = insideX && insideY ? 0 : Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist < minDist) {
            minDist = dist;
            nearest = { key, dist };
        }
    }
    return nearest;
}

function pfCreateDependency(sourceKey, targetKey) {
    // sourceKey = the product being depended ON (output)
    // targetKey = the product that DEPENDS on source (input)
    // We need to add [depends $sourceId] to target's editor line

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Resolve the source's $deliverable ID
    const sourcePos = pfPositionsCache[sourceKey];
    const targetPos = pfPositionsCache[targetKey];
    if (!sourcePos || !targetPos) return;

    // Get the actual deliverable ID (handle collapsed group placeholders)
    const sourceId = sourceKey.replace(/^_collapsed_|^_gate_/, '');
    const targetTask = targetPos.task;
    const targetId = targetKey.replace(/^_collapsed_|^_gate_/, '');

    // Find the target task's line in the editor
    const lineNum = productFindLineNumber(targetTask.name, targetId);
    if (lineNum === null) return;

    const lines = editor.value.split('\n');
    const line = lines[lineNum];
    if (!line) return;

    // Check if already has this dependency
    if (line.includes(`$${sourceId}`)) return;

    // Add or update [depends ...] block
    const dependsMatch = line.match(/\[depends(?::\s*|\s+)([^\]]*)\]/i);
    let newLine;
    if (dependsMatch) {
        // Append to existing [depends ...] block
        const existingDeps = dependsMatch[1].trim();
        const newDeps = existingDeps ? `${existingDeps}, $${sourceId}` : `$${sourceId}`;
        newLine = line.replace(/\[depends(?::\s*|\s+)[^\]]*\]/i, `[depends ${newDeps}]`);
    } else {
        // Add new [depends $sourceId] before any trailing comment
        const commentMatch = line.match(/(\s+"[^"]*"\s*)$/);
        if (commentMatch) {
            newLine = line.slice(0, -commentMatch[0].length) + ` [depends $${sourceId}]` + commentMatch[0];
        } else {
            newLine = line + ` [depends $${sourceId}]`;
        }
    }

    lines[lineNum] = newLine;
    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    setTimeout(() => renderText(), 10);
}

// ── Product Flow: Arrow selection & deletion ──────────────────────────

function pfSelectArrow(sourceKey, targetKey, arrowEl) {
    // Deselect previous
    pfGroup.querySelectorAll('.pf-arrow.selected').forEach(el => {
        el.classList.remove('selected');
        el.setAttribute('stroke', '#E8833A');
        el.setAttribute('stroke-width', '2');
    });

    pfSelectedArrow = { sourceKey, targetKey };
    arrowEl.classList.add('selected');
    arrowEl.setAttribute('stroke', '#ff4444');
    arrowEl.setAttribute('stroke-width', '3');

    // Focus the container so it receives keyboard events
    const container = document.getElementById('productFlowContainer');
    if (container) container.focus();
}

function pfDeleteSelectedArrow() {
    if (!pfSelectedArrow) return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const { sourceKey, targetKey } = pfSelectedArrow;
    const sourceId = sourceKey.replace(/^_collapsed_|^_gate_/, '');
    const targetPos = pfPositionsCache ? pfPositionsCache[targetKey] : null;
    if (!targetPos) return;

    const targetId = targetKey.replace(/^_collapsed_|^_gate_/, '');
    const lineNum = productFindLineNumber(targetPos.task.name, targetId);
    if (lineNum === null) return;

    const lines = editor.value.split('\n');
    const line = lines[lineNum];
    if (!line) return;

    // Remove $sourceId from [depends ...] block
    const dependsMatch = line.match(/\[depends(?::\s*|\s+)([^\]]*)\]/i);
    if (!dependsMatch) return;

    const deps = dependsMatch[1].split(',').map(d => d.trim()).filter(d => {
        // Remove the dependency that matches $sourceId (with optional type/lag suffixes)
        const stripped = d.replace(/:[A-Z]{2}$/i, '').replace(/\s+[+\-]\d+[dwmy]$/i, '').trim();
        return stripped !== `$${sourceId}`;
    });

    let newLine;
    if (deps.length === 0) {
        // Remove entire [depends ...] block
        newLine = line.replace(/\s*\[depends(?::\s*|\s+)[^\]]*\]/i, '');
    } else {
        newLine = line.replace(/\[depends(?::\s*|\s+)[^\]]*\]/i, `[depends ${deps.join(', ')}]`);
    }

    lines[lineNum] = newLine;
    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    pfSelectedArrow = null;
    setTimeout(() => renderText(), 10);
}

function pfToggleGroup(groupId) {
    pfUserToggledExpand = true;
    if (pfExpandedStages.has(groupId)) {
        pfExpandedStages.delete(groupId);
    } else {
        pfExpandedStages.add(groupId);
    }
    pfLastToggledGroupId = groupId; // #986: animate whatever this becomes on the next render
    if (typeof lastRenderedTasks !== 'undefined' && lastRenderedTasks.length > 0) {
        updateProductFlow(lastRenderedTasks);
    }
}

function pfZoomFit(positions) {
    if (!pfSvg) return;
    const container = document.getElementById('productFlowContainer');
    if (!container) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pos of Object.values(positions)) {
        minX = Math.min(minX, pos.x);
        maxX = Math.max(maxX, pos.x + PF_NODE_W);
        minY = Math.min(minY, pos.y);
        maxY = Math.max(maxY, pos.y + PF_NODE_H);
    }
    if (!isFinite(minX)) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const padding = 60;
    const bw = maxX - minX + padding * 2;
    const bh = maxY - minY + padding * 2;

    pfZoom = Math.min(cw / bw, ch / bh, 1.5);
    pfPanX = (cw - bw * pfZoom) / 2 - minX * pfZoom + padding * pfZoom;
    pfPanY = (ch - bh * pfZoom) / 2 - minY * pfZoom + padding * pfZoom;
    pfApplyTransform();
}

function productFlowZoomIn() { pfZoom = Math.min(5, pfZoom * 1.2); pfApplyTransform(); }
function productFlowZoomOut() { pfZoom = Math.max(0.1, pfZoom * 0.8); pfApplyTransform(); }
function productFlowZoomReset() { pfZoom = 1; pfPanX = 0; pfPanY = 0; pfApplyTransform(); }
function productFlowZoomFit() {
    if (typeof lastRenderedTasks !== 'undefined' && lastRenderedTasks.length > 0) {
        updateProductFlow(lastRenderedTasks);
    }
}

function productFlowCollapseAll() {
    pfUserToggledExpand = true;
    pfExpandedStages.clear();
    if (typeof lastRenderedTasks !== 'undefined' && lastRenderedTasks.length > 0) {
        updateProductFlow(lastRenderedTasks);
    }
}

function productFlowExpandAll() {
    pfUserToggledExpand = false; // let auto-expand re-populate all
    pfExpandedStages.clear();
    if (typeof lastRenderedTasks !== 'undefined' && lastRenderedTasks.length > 0) {
        updateProductFlow(lastRenderedTasks);
    }
}

// Toggle RAG (red/amber/green) status colouring on PBS + Product Flow nodes.
function pbsToggleRagMode(btn) {
    pbsRagMode = !pbsRagMode;
    // Sync state across any other buttons with matching onclick
    document.querySelectorAll('[data-pbs-rag-toggle]').forEach(b => {
        b.classList.toggle('active', pbsRagMode);
        b.title = pbsRagMode ? 'Turn off RAG colouring' : 'Colour by RAG status';
    });
    if (btn) {
        btn.classList.toggle('active', pbsRagMode);
    }
    if (typeof lastRenderedTasks !== 'undefined' && lastRenderedTasks.length > 0) {
        if (typeof updatePbs === 'function') updatePbs(lastRenderedTasks);
        if (typeof updateProductFlow === 'function') updateProductFlow(lastRenderedTasks);
    }
}

// Hide/show completed products (100% rolled-up) in the Product Flow.
let pfHideCompleted = false;
function productFlowToggleCompleted(btn) {
    pfHideCompleted = !pfHideCompleted;
    if (btn) {
        btn.classList.toggle('active', pfHideCompleted);
        btn.title = pfHideCompleted ? 'Show completed products' : 'Hide completed products';
    }
    if (typeof lastRenderedTasks !== 'undefined' && lastRenderedTasks.length > 0) {
        updateProductFlow(lastRenderedTasks);
    }
}

// ── Product Details Form ──────────────────────────────────────────────

// ── Copy SVG view as high-res image ──────────────────────────────────

function copySvgAsImage(containerId, btn) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    const originalText = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '...';

    try {
        // Get bounding box from the LIVE g element (not the clone)
        const liveG = svg.querySelector('g');
        let gBounds = null;
        if (liveG) {
            try { gBounds = liveG.getBBox(); } catch (e) { /* getBBox can fail */ }
        }

        // Clone the SVG
        const clone = svg.cloneNode(true);
        const cloneG = clone.querySelector('g');

        // Remove add-product buttons from the clone
        clone.querySelectorAll('.pbs-add-btns, .pbs-add-btn').forEach(el => el.remove());

        // Set viewBox to frame the content, remove pan/zoom transform
        const padding = 40;
        let viewBox;
        if (gBounds && gBounds.width > 0 && cloneG) {
            viewBox = `${gBounds.x - padding} ${gBounds.y - padding} ${gBounds.width + padding * 2} ${gBounds.height + padding * 2}`;
            cloneG.removeAttribute('transform');
        } else {
            viewBox = `0 0 ${container.clientWidth} ${container.clientHeight}`;
        }

        // Size the output to match the aspect ratio
        const parts = viewBox.split(' ').map(Number);
        const vbW = parts[2] || 2400;
        const vbH = parts[3] || 1600;
        const maxDim = 2400;
        const aspect = vbW / vbH;
        const outW = aspect >= 1 ? maxDim : Math.round(maxDim * aspect);
        const outH = aspect >= 1 ? Math.round(maxDim / aspect) : maxDim;

        clone.setAttribute('viewBox', viewBox);
        clone.setAttribute('width', String(outW));
        clone.setAttribute('height', String(outH));
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // Add explicit background rect (SVG background style doesn't render in img)
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const bgColor = isDark ? '#1a1a2e' : '#ffffff';
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', String(parts[0]));
        bgRect.setAttribute('y', String(parts[1]));
        bgRect.setAttribute('width', String(vbW));
        bgRect.setAttribute('height', String(vbH));
        bgRect.setAttribute('fill', bgColor);
        clone.insertBefore(bgRect, clone.firstChild);

        // Serialize to data URL
        const svgData = new XMLSerializer().serializeToString(clone);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        // Render to canvas at high resolution
        const img = new Image();
        img.onload = async () => {
            const scale = 2;
            const canvas = document.createElement('canvas');
            canvas.width = outW * scale;
            canvas.height = outH * scale;
            const ctx = canvas.getContext('2d');

            // Background already in SVG as a rect, just draw
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);

            try {
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                if (btn) {
                    btn.innerHTML = '\u2713';
                    setTimeout(() => { btn.innerHTML = originalText; }, 1500);
                }
            } catch (e) {
                console.error('Failed to copy image:', e);
                if (btn) btn.innerHTML = originalText;
                if (typeof setStatusMessage === 'function') setStatusMessage('Failed to copy image to clipboard', 3000);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            if (btn) btn.innerHTML = originalText;
        };
        img.src = url;
    } catch (e) {
        console.error('Error copying SVG:', e);
        if (btn) btn.innerHTML = originalText;
    }
}

// ── Download SVG as PNG / SVG file ────────────────────────────────────

function downloadSvgAsImage(containerId, format, btn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const fmt = (format || 'png').toLowerCase();
    const originalText = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '...';

    try {
        const liveG = svg.querySelector('g');
        let gBounds = null;
        if (liveG) { try { gBounds = liveG.getBBox(); } catch (e) {} }

        const clone = svg.cloneNode(true);
        const cloneG = clone.querySelector('g');
        clone.querySelectorAll('.pbs-add-btns, .pbs-add-btn').forEach(el => el.remove());

        const padding = 40;
        let viewBox;
        if (gBounds && gBounds.width > 0 && cloneG) {
            viewBox = `${gBounds.x - padding} ${gBounds.y - padding} ${gBounds.width + padding * 2} ${gBounds.height + padding * 2}`;
            cloneG.removeAttribute('transform');
        } else {
            viewBox = `0 0 ${container.clientWidth} ${container.clientHeight}`;
        }
        const parts = viewBox.split(' ').map(Number);
        const vbW = parts[2] || 2400;
        const vbH = parts[3] || 1600;
        const maxDim = 2400;
        const aspect = vbW / vbH;
        const outW = aspect >= 1 ? maxDim : Math.round(maxDim * aspect);
        const outH = aspect >= 1 ? Math.round(maxDim / aspect) : maxDim;

        clone.setAttribute('viewBox', viewBox);
        clone.setAttribute('width', String(outW));
        clone.setAttribute('height', String(outH));
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const bgColor = isDark ? '#1a1a2e' : '#ffffff';
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', String(parts[0]));
        bgRect.setAttribute('y', String(parts[1]));
        bgRect.setAttribute('width', String(vbW));
        bgRect.setAttribute('height', String(vbH));
        bgRect.setAttribute('fill', bgColor);
        clone.insertBefore(bgRect, clone.firstChild);

        const svgData = new XMLSerializer().serializeToString(clone);
        const baseName = containerId === 'pbsContainer' ? 'pbs' :
                         containerId === 'productFlowContainer' ? 'product-flow' : 'diagram';
        const finish = () => {
            if (btn) {
                btn.innerHTML = '\u2713';
                setTimeout(() => { btn.innerHTML = originalText; }, 1500);
            }
        };

        if (fmt === 'svg') {
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = baseName + '.svg';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 500);
            finish();
            return;
        }

        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
            const scale = 2;
            const canvas = document.createElement('canvas');
            canvas.width = outW * scale;
            canvas.height = outH * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob((blob) => {
                if (!blob) { if (btn) btn.innerHTML = originalText; return; }
                const dlUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = dlUrl;
                a.download = baseName + '.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(dlUrl), 500);
                finish();
            }, 'image/png');
        };
        img.onerror = () => { URL.revokeObjectURL(url); if (btn) btn.innerHTML = originalText; };
        img.src = url;
    } catch (e) {
        console.error('Error downloading SVG:', e);
        if (btn) btn.innerHTML = originalText;
    }
}

// ── Duplicate deliverable identifier detection ───────────────────────

function checkDuplicateDeliverables() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const warnings = [];
    const warningLines = new Set();

    // 1. Check for duplicate $identifier tokens (only count definitions, not references in [depends])
    const idRegex = /[/^]?\$([A-Za-z_][A-Za-z0-9_-]*)/g;
    const seenIds = {};
    for (let i = 0; i < lines.length; i++) {
        // Strip [depends ...] blocks so we don't count dependency references as definitions
        const lineWithoutDepends = lines[i].replace(/\[depends(?::\s*|\s+)[^\]]*\]/gi, '');
        let match;
        while ((match = idRegex.exec(lineWithoutDepends)) !== null) {
            const id = match[1].toLowerCase();
            if (!seenIds[id]) seenIds[id] = [];
            seenIds[id].push(i + 1);
        }
        idRegex.lastIndex = 0;
    }
    for (const [id, lineNums] of Object.entries(seenIds)) {
        if (lineNums.length > 1) {
            warnings.push(`Duplicate ID $${id} (lines ${lineNums.join(', ')})`);
            lineNums.forEach(ln => warningLines.add(ln));
        }
    }

    // 2. Check for duplicate task names at the same indentation level under the same parent
    let inFrontMatter = false;
    let inSection = false;
    const tasksByParent = {}; // "indent:parentLine" → { name → [line numbers] }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip front matter and special sections
        if (trimmed === '---') { inFrontMatter = !inFrontMatter; continue; }
        if (trimmed.startsWith('---') && trimmed.endsWith('---')) { inSection = true; continue; }
        if (inFrontMatter || inSection) {
            if (trimmed === '---') inSection = false;
            continue;
        }
        if (!trimmed || trimmed.startsWith('#')) continue;

        const indent = line.search(/\S/);
        if (indent < 0) continue;

        // Extract task name (strip * prefix and metadata)
        let taskText = trimmed.replace(/^\*\s*/, '');
        // Strip metadata tokens to get just the name:
        // Stop at @resource, #label, $deliverable, /$deliverable, ^$deliverable,
        // !comment, "quote", [depends], {bucket}, duration, percent, or date
        const nameMatch = taskText.match(/^(.+?)(?:\s+[/^]?\$|\s+[@#!"{~\[]|\s+\d+[dwmy]\b|\s+\d+%|\s+\d{4}-\d{2}-\d{2}|\s*$)/);
        const taskName = nameMatch ? nameMatch[1].trim() : taskText.split(/\s+/)[0];
        if (!taskName) continue;

        // Find parent by looking for the nearest line above with less indent
        let parentKey = 'root';
        for (let j = i - 1; j >= 0; j--) {
            const pLine = lines[j];
            if (!pLine.trim()) continue;
            const pIndent = pLine.search(/\S/);
            if (pIndent >= 0 && pIndent < indent) {
                parentKey = `${pIndent}:${j}`;
                break;
            }
        }

        const scopeKey = `${indent}:${parentKey}`;
        if (!tasksByParent[scopeKey]) tasksByParent[scopeKey] = {};
        const nameKey = taskName.toLowerCase();
        if (!tasksByParent[scopeKey][nameKey]) tasksByParent[scopeKey][nameKey] = [];
        tasksByParent[scopeKey][nameKey].push(i + 1);
    }

    for (const [scope, names] of Object.entries(tasksByParent)) {
        for (const [name, lineNums] of Object.entries(names)) {
            if (lineNums.length > 1) {
                warnings.push(`Duplicate task "${name}" (lines ${lineNums.join(', ')})`);
                lineNums.forEach(ln => warningLines.add(ln));
            }
        }
    }

    // 2b. Check for globally duplicate task names (across different parents).
    // The scheduler deduplicates by name so the second instance is lost.
    const globalTaskNames = {}; // name → [line numbers]
    inFrontMatter = false;
    inSection = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '---') { inFrontMatter = !inFrontMatter; continue; }
        if (trimmed.startsWith('---') && trimmed.endsWith('---')) { inSection = true; continue; }
        if (inFrontMatter || inSection) { if (trimmed === '---') inSection = false; continue; }
        if (!trimmed || trimmed.startsWith('#')) continue;

        let taskText = trimmed.replace(/^\*\s*/, '');
        const nm = taskText.match(/^(.+?)(?:\s+[/^]?\$|\s+[@#!"{~\[]|\s+\d+[dwmy]\b|\s+\d+%|\s+\d{4}-\d{2}-\d{2}|\s*$)/);
        const tn = nm ? nm[1].trim().toLowerCase() : '';
        if (tn) {
            if (!globalTaskNames[tn]) globalTaskNames[tn] = [];
            globalTaskNames[tn].push(i + 1);
        }
    }
    for (const [name, lineNums] of Object.entries(globalTaskNames)) {
        if (lineNums.length > 1) {
            // Only warn if not already warned by the per-parent check
            const alreadyWarned = warnings.some(w => w.includes('"' + name + '"') && w.includes('Duplicate task'));
            if (!alreadyWarned) {
                warnings.push(`Duplicate task name "${name}" (lines ${lineNums.join(', ')}) — second instance will be lost by scheduler`);
                lineNums.forEach(ln => warningLines.add(ln));
            }
        }
    }

    // 3. Check for missing dependencies (references that don't match any task or deliverable)
    const allValidTargets = new Set();
    // Collect task names and deliverable tokens
    inFrontMatter = false;
    inSection = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed2 = lines[i].trim();
        if (trimmed2 === '---') { inFrontMatter = !inFrontMatter; continue; }
        if (trimmed2.startsWith('---') && trimmed2.endsWith('---')) { inSection = true; continue; }
        if (inFrontMatter || inSection) {
            if (trimmed2 === '---') inSection = false;
            continue;
        }
        if (!trimmed2) continue;
        // Collect deliverable tokens
        const deliverableRe = /[/^]?\$([A-Za-z_][A-Za-z0-9_-]*)/g;
        let dm;
        while ((dm = deliverableRe.exec(trimmed2)) !== null) {
            allValidTargets.add('$' + dm[1].toLowerCase());
            allValidTargets.add(dm[1].toLowerCase());
        }
        // Collect task name
        let tn = trimmed2.replace(/^\*\s*/, '');
        tn = tn.replace(/!?["\u201c][^"\u201d]*["\u201d]/g, '').trim();
        tn = tn.replace(/\[depends(?::\s*|\s+)[^\]]+\]/gi, '').trim();
        const tnMatch = tn.match(/^(.+?)(?:\s+[/^]?\$|\s+[@#!"{~\[]|\s+\d+[dwmy]\b|\s+\d+%|\s+\d{4}-\d{2}-\d{2}|\s*$)/);
        const tnName = tnMatch ? tnMatch[1].trim() : '';
        if (tnName) {
            allValidTargets.add(tnName.toLowerCase());
            allValidTargets.add(tnName.replace(/ /g, '_').toLowerCase());
            allValidTargets.add(tnName.replace(/_/g, ' ').toLowerCase());
        }
    }

    const missingDeps = new Set();
    const depLineRe = /\[depends(?::\s*|\s+)([^\]]+)\]/gi;
    for (let i = 0; i < lines.length; i++) {
        let dm2;
        while ((dm2 = depLineRe.exec(lines[i])) !== null) {
            const deps = dm2[1].split(',').map(d => d.trim()).filter(d => d);
            for (let dep of deps) {
                dep = dep.replace(/\s+[+\-]\d+[dwmy]$/, '');
                dep = dep.replace(/:(FS|SS|FF|SF)$/i, '');
                dep = dep.replace(/^Milestone:\s*/i, '');
                const depLower = dep.toLowerCase().replace(/\s+/g, ' ').trim();
                const depBare = depLower.replace(/^[/^]?\$/, '');
                const found = allValidTargets.has(depLower) ||
                    allValidTargets.has(depLower.replace(/_/g, ' ')) ||
                    allValidTargets.has(depLower.replace(/ /g, '_')) ||
                    (depBare !== depLower && (allValidTargets.has(depBare) ||
                        allValidTargets.has('$' + depBare)));
                if (!found) {
                    // Fuzzy fallback
                    const depNorm = depLower.replace(/[^a-z0-9]/g, '');
                    let fuzzy = false;
                    for (const t of allValidTargets) {
                        if (t.replace(/[^a-z0-9]/g, '') === depNorm) { fuzzy = true; break; }
                    }
                    if (!fuzzy) {
                        missingDeps.add(dep);
                        warningLines.add(i + 1);
                    }
                }
            }
        }
    }

    if (missingDeps.size > 0) {
        const depList = [...missingDeps].slice(0, 5);
        const label = missingDeps.size === 1 ? 'Missing dependency' : `${missingDeps.size} missing dependencies`;
        warnings.push(`${label}: ${depList.map(d => '"' + d + '"').join(', ')}${missingDeps.size > 5 ? '...' : ''}`);
    }

    // 4. Check for commas in task names (breaks dependency parsing)
    inFrontMatter = false;
    inSection = false;
    const commaLines = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed3 = lines[i].trim();
        if (trimmed3 === '---') { inFrontMatter = !inFrontMatter; continue; }
        if (trimmed3.startsWith('---') && trimmed3.endsWith('---')) { inSection = true; continue; }
        if (inFrontMatter || inSection) {
            if (trimmed3 === '---') inSection = false;
            continue;
        }
        if (!trimmed3) continue;
        // Strip comments, [depends], and metadata to isolate the task name
        let nameOnly = trimmed3.replace(/^\*\s*/, '');
        nameOnly = nameOnly.replace(/!?["\u201c][^"\u201d]*["\u201d]/g, '');
        nameOnly = nameOnly.replace(/\[depends(?::\s*|\s+)[^\]]+\]/gi, '');
        // Get just the name portion (before metadata tokens)
        const nmMatch = nameOnly.match(/^(.+?)(?:\s+[/^]?\$|\s+[@#!"{~\[]|\s+\d+[dwmy]\b|\s+\d+%|\s+\d{4}-\d{2}-\d{2}|\s*$)/);
        const nm = nmMatch ? nmMatch[1] : '';
        if (nm && nm.includes(',')) {
            commaLines.push(i + 1);
            warningLines.add(i + 1);
        }
    }
    if (commaLines.length > 0) {
        warnings.push(`Task names cannot contain commas (line${commaLines.length > 1 ? 's' : ''} ${commaLines.slice(0, 5).join(', ')}${commaLines.length > 5 ? '...' : ''}) — this breaks dependencies`);
    }

    // 5. Circular product dependencies & products with no activities
    try {
        const tasksForCheck = (typeof lastRenderedTasks !== 'undefined') ? lastRenderedTasks : [];
        const deliverables = (typeof pbsExtractDeliverables === 'function')
            ? pbsExtractDeliverables(tasksForCheck) : [];
        if (deliverables.length > 0) {
            // Build id -> dep-ids map
            const byId = {};
            for (const d of deliverables) byId[d.deliverable] = d;
            const depMap = {};
            for (const d of deliverables) {
                const deps = [];
                if (d.depends) {
                    for (const depName of d.depends) {
                        const target = deliverables.find(
                            dd => dd.name === depName || dd.description === depName
                        );
                        if (target) deps.push(target.deliverable);
                    }
                }
                depMap[d.deliverable] = deps;
            }
            // DFS to detect cycles
            const WHITE = 0, GREY = 1, BLACK = 2;
            const color = {};
            for (const id of Object.keys(depMap)) color[id] = WHITE;
            const cycles = [];
            function dfs(id, stack) {
                color[id] = GREY;
                stack.push(id);
                for (const next of depMap[id] || []) {
                    if (color[next] === GREY) {
                        const idx = stack.indexOf(next);
                        cycles.push(stack.slice(idx).concat(next));
                    } else if (color[next] === WHITE) {
                        dfs(next, stack);
                    }
                }
                stack.pop();
                color[id] = BLACK;
            }
            for (const id of Object.keys(depMap)) {
                if (color[id] === WHITE) dfs(id, []);
            }
            if (cycles.length > 0) {
                const first = cycles[0].map(x => '$' + x).join(' → ');
                warnings.push(`Circular product dependency: ${first}`);
                // Highlight the cycle member lines
                const cycleIds = new Set(cycles.flat());
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(/\$([A-Za-z_][A-Za-z0-9_-]*)/);
                    if (m && cycleIds.has(m[1])) warningLines.add(i + 1);
                }
            }

            // Products with no activities (skip milestones and products that contain sub-products)
            const empty = [];
            for (const d of deliverables) {
                // Skip milestones (0-duration tasks) — they're markers, not work packages
                if (d.duration_days === 0) continue;

                const activities = (typeof pbsGetActivities === 'function')
                    ? pbsGetActivities(d, tasksForCheck) : [];
                if (!activities || activities.length === 0) {
                    // Check if this product has sub-products (children with deliverable tokens)
                    const parentName = d.name || d.description || '';
                    const hasSubProducts = deliverables.some(other => {
                        if (other === d || !other.parent) return false;
                        return other.parent === parentName ||
                            (parentName.startsWith(other.parent) && other.parent.length > 2);
                    });
                    if (!hasSubProducts) empty.push(d.deliverable);
                }
            }
            if (empty.length > 0) {
                const show = empty.slice(0, 5).map(x => '$' + x).join(', ');
                warnings.push(`${empty.length === 1 ? 'Product has' : empty.length + ' products have'} no activities: ${show}${empty.length > 5 ? '…' : ''}`);
                // Store for clickable rendering
                window._emptyProducts = empty.slice(0, 5);
            } else {
                window._emptyProducts = null;
            }
        }
    } catch (e) { /* validation best-effort */ }

    // Store warning lines globally for the highlight layer to pick up
    window._duplicateWarningLines = warningLines;

    // Apply yellow background highlights to the editor highlight layer
    applyDuplicateHighlights();

    // Product-quality warnings are sticky (key 'duplicate-deliverables') like
    // the circular-dependency and .mpp assignment-risk warnings; the status
    // log's compact-bar priority (actionable sticky warnings beat passive
    // ones) is what now keeps a Fix-able warning visible over this one, so
    // this no longer needs to check whether those are currently showing.
    if (typeof pushStatusLogEntry !== 'function' || typeof clearStatusLogEntry !== 'function') return;

    if (warnings.length === 0) {
        clearStatusLogEntry('duplicate-deliverables');
        return;
    }

    const emptyProducts = window._emptyProducts;
    if (emptyProducts && emptyProducts.length > 0) {
        // Separate the "no activities" warning (rendered as clickable product
        // links) from any other plain-text warnings.
        const otherWarnings = warnings.filter(w => !w.includes('no activities'));
        const label = emptyProducts.length === 1 ? 'Product has' : emptyProducts.length + ' products have';
        const text = '\u26A0 ' +
            (otherWarnings.length > 0 ? otherWarnings.join(' \u00B7 ') + ' \u00B7 ' : '') +
            label + ' no activities: ';
        const actions = emptyProducts.map((name, i) => ({
            kind: 'link',
            label: (i === 0 ? '' : ', ') + '$' + name,
            title: 'Open task details',
            onClick: () => { if (typeof openTaskInspectorByDeliverable === 'function') openTaskInspectorByDeliverable(name); }
        }));
        pushStatusLogEntry({ key: 'duplicate-deliverables', text: text, actions: actions });
    } else {
        pushStatusLogEntry({ key: 'duplicate-deliverables', text: '\u26A0 ' + warnings.join(' \u00B7 ') });
    }
}

function applyDuplicateHighlights() {
    const warningLines = window._duplicateWarningLines;

    // Find or create the warning overlay container inside the highlight layer
    const highlightLayer = document.getElementById('highlightLayer');
    if (!highlightLayer) return;

    let overlay = highlightLayer.querySelector('.duplicate-overlay');
    if (overlay) overlay.remove();

    if (!warningLines || warningLines.size === 0) return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Calculate line height from the editor's computed style
    const style = getComputedStyle(editor);
    const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.5);
    const paddingTop = parseFloat(style.paddingTop) || 15;

    overlay = document.createElement('div');
    overlay.className = 'duplicate-overlay';
    overlay.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none;';

    warningLines.forEach(ln => {
        const bar = document.createElement('div');
        bar.style.cssText = `
            position: absolute;
            left: 0; right: 0;
            top: ${paddingTop + (ln - 1) * lineHeight}px;
            height: ${lineHeight}px;
            background: rgba(240, 173, 78, 0.25);
            pointer-events: none;
        `;
        overlay.appendChild(bar);
    });

    // Insert at the start of highlight layer so it's behind the text
    highlightLayer.insertBefore(overlay, highlightLayer.firstChild);
}

function pbsAddFirstProduct() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Generate unique identifier
    let id = 'new_product';
    const existingIds = new Set();
    const idRegex = /\$([A-Za-z_][A-Za-z0-9_-]*)/g;
    let m;
    while ((m = idRegex.exec(editor.value)) !== null) {
        existingIds.add(m[1].toLowerCase());
    }
    let counter = 1;
    while (existingIds.has(id)) {
        id = `new_product_${counter}`;
        counter++;
    }

    // Find the end of the task section (before --- sections)
    const lines = editor.value.split('\n');
    let insertAt = lines.length;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '---' && i > 0) {
            // Skip the first --- (front matter start), find the second one
            let fmCount = 0;
            for (let j = 0; j <= i; j++) {
                if (lines[j].trim() === '---') fmCount++;
            }
            if (fmCount > 2) { insertAt = i; break; }
        }
        if (lines[i].trim().startsWith('---') && lines[i].trim().endsWith('---') && lines[i].trim().length > 3) {
            insertAt = i;
            break;
        }
    }

    lines.splice(insertAt, 0, `\nNew Product $${id}`);
    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    setTimeout(() => renderText(), 10);
}

function pbsCreateProduct(anchorTaskName, position) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Find the anchor task's line
    const lines = editor.value.split('\n');
    let anchorLine = -1;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim().replace(/^\*\s*/, '');
        const nameMatch = trimmed.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[/^]?\$|\s+[@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
        const lineName = nameMatch ? nameMatch[1].trim() : trimmed.split(/\s+/)[0];
        if (lineName === anchorTaskName) { anchorLine = i; break; }
    }
    if (anchorLine < 0) return;

    const anchorIndent = lines[anchorLine].match(/^(\s*)/)[1];

    // Generate unique identifier
    let id = 'new_product';
    const existingIds = new Set();
    const idRegex = /\$([A-Za-z_][A-Za-z0-9_-]*)/g;
    let m;
    while ((m = idRegex.exec(editor.value)) !== null) {
        existingIds.add(m[1].toLowerCase());
    }
    let counter = 1;
    while (existingIds.has(id)) {
        id = `new_product_${counter}`;
        counter++;
    }

    const newTaskName = 'New Product';

    if (position === 'child') {
        // Insert as child: indented under anchor
        const childIndent = anchorIndent + '  ';
        // Find the end of anchor's children to insert after them
        let insertAt = anchorLine + 1;
        while (insertAt < lines.length) {
            const lineIndent = lines[insertAt].match(/^(\s*)/)[1];
            if (lines[insertAt].trim() === '' || lineIndent.length <= anchorIndent.length) break;
            insertAt++;
        }
        lines.splice(insertAt, 0, `${childIndent}${newTaskName} $${id}`);
    } else {
        // Sibling: same indent as anchor
        const insertAt = position === 'before' ? anchorLine : anchorLine + 1;
        lines.splice(insertAt, 0, `${anchorIndent}${newTaskName} $${id}`);
    }

    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    setTimeout(() => renderText(), 10);
}

function pbsDeleteProduct(task) {
    if (!task) return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const delivId = task.deliverable;
    const label = task.name || delivId || 'this product';
    const msg = `Delete product "${label}"?\n\nThis removes the $${delivId || ''} marker from the plan. The task itself is kept.`;
    if (typeof confirm === 'function' && !confirm(msg)) return;

    const lineNum = (typeof productFindLineNumber === 'function')
        ? productFindLineNumber(task.name, delivId)
        : null;
    if (lineNum === null || lineNum === undefined) return;

    const lines = editor.value.split('\n');
    const line = lines[lineNum];
    if (line === undefined) return;

    // Remove $identifier token (with optional /^ prefix and leading whitespace)
    const newLine = line.replace(/\s*[/^]?\$[A-Za-z_][A-Za-z0-9_-]*/, '');
    lines[lineNum] = newLine;
    editor.value = lines.join('\n');

    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    // renderText triggers a full re-render of PBS and Product Flow
    setTimeout(() => { if (typeof renderText === 'function') renderText(); }, 10);
}

function productIdentifierOnInput(el) {
    const pos = el.selectionStart;
    el.value = el.value.replace(/\s/g, '_');
    el.setSelectionRange(pos, pos);
}

let currentProductTask = null;
let currentProductLineNumber = null;
let productFormSaveTimer = null;
let currentProductType = 'internal';

function productSetType(type) {
    currentProductType = type;
    const toggleBtns = document.querySelectorAll('#productTypeToggle .product-type-btn');
    for (const btn of toggleBtns) {
        btn.classList.toggle('active', btn.dataset.type === type);
    }
    const prefixEl = document.getElementById('productIdentifierPrefix');
    if (prefixEl) {
        prefixEl.textContent = type === 'group' ? '/$' : type === 'external' ? '^$' : '$';
    }
    if (currentProductTask) {
        currentProductTask.product_type = type;
    }
    saveProductForm();
}

function productFindLineNumber(taskName, deliverableId) {
    const editor = document.getElementById('planEditor');
    if (!editor || !taskName) return null;
    const lines = editor.value.split('\n');
    // First pass: match by both name AND $deliverable (most precise)
    if (deliverableId) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('$' + deliverableId)) {
                const trimmed = lines[i].trim().replace(/^\*\s*/, '');
                const nameMatch = trimmed.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[/^]?\$|\s+[@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
                const lineName = nameMatch ? nameMatch[1].trim() : trimmed.split(/\s+/)[0];
                if (lineName === taskName) return i;
            }
        }
    }
    // Fallback: match by name only
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim().replace(/^\*\s*/, '');
        const nameMatch = trimmed.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[/^]?\$|\s+[@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
        const lineName = nameMatch ? nameMatch[1].trim() : trimmed.split(/\s+/)[0];
        if (lineName === taskName) return i;
    }
    return null;
}

function openProductForm(task) {
    if (!task) return;
    // Cancel any pending save from a previous product form
    if (productFormSaveTimer) {
        clearTimeout(productFormSaveTimer);
        productFormSaveTimer = null;
    }
    currentProductTask = task;
    currentProductLineNumber = productFindLineNumber(task.name, task.deliverable);

    openDetailPane('productFormSection');

    // Parent product
    const parentGroup = document.getElementById('productParentGroup');
    const parentEl = document.getElementById('productParent');
    if (parentGroup && parentEl) {
        const allTasks = pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []);
        const parentProduct = task.parent ? allTasks.find(t =>
            t.deliverable && (t.name === task.parent || t.description === task.parent)
        ) : null;

        if (parentProduct) {
            parentGroup.style.display = '';
            const colour = PBS_COLOURS[0];
            const name = (parentProduct.name || '').replace(/</g, '&lt;');
            parentEl.innerHTML = `<div class="pf-mini-node" style="background:${colour}; display: inline-block; cursor: pointer;" onclick="openProductForm(lastRenderedTasks.find(t => t.deliverable === '${parentProduct.deliverable}'))" title="$${parentProduct.deliverable}">${name}</div>`;
        } else {
            parentGroup.style.display = 'none';
            parentEl.innerHTML = '';
        }
    }

    // Title
    const titleEl = document.getElementById('productTitle');
    if (titleEl) titleEl.value = task.name || '';

    // Form title
    const formTitle = document.getElementById('productFormTitle');
    if (formTitle) formTitle.textContent = task.name || 'Product Details';

    // Identifier
    const idEl = document.getElementById('productIdentifier');
    if (idEl) idEl.value = task.deliverable || '';

    // Product type toggle
    const pType = task.product_type || 'internal';
    currentProductType = pType;
    const toggleBtns = document.querySelectorAll('#productTypeToggle .product-type-btn');
    for (const btn of toggleBtns) {
        btn.classList.toggle('active', btn.dataset.type === pType);
    }
    const prefixEl = document.getElementById('productIdentifierPrefix');
    if (prefixEl) {
        prefixEl.textContent = pType === 'group' ? '/$' : pType === 'external' ? '^$' : '$';
    }

    // Purpose (comment)
    const purposeEl = document.getElementById('productPurpose');
    if (purposeEl) purposeEl.value = task.comment || '';

    // Composition (child products)
    const childProdsEl = document.getElementById('productChildProducts');
    if (childProdsEl) {
        const allTasks = pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []);
        const parentName = task.name || task.description;
        const childProducts = allTasks.filter(t => t.deliverable && t.parent === parentName);
        let cpIdx = 0;
        let html = childProducts.map(cp => {
            const name = (cp.name || cp.description || '').replace(/</g, '&lt;');
            const id = cp.deliverable || '';
            const comment = (cp.comment || '').replace(/</g, '&lt;');
            const colour = PBS_COLOURS[cpIdx % PBS_COLOURS.length];
            cpIdx++;
            return `<div class="product-comp-item" style="cursor: pointer; padding: 4px 6px;">
                <div class="pf-mini-node" style="background:${colour}; flex-shrink: 0;" onclick="openProductForm(lastRenderedTasks.find(t => t.deliverable === '${id}'))" title="$${id}">${name}</div>
                ${comment ? `<span class="product-comp-comment" title="${comment}">${comment}</span>` : ''}
                <div class="product-comp-actions">
                    <button class="product-comp-action-btn" onclick="event.stopPropagation(); openProductForm(lastRenderedTasks.find(t => t.deliverable === '${id}'))" title="Edit">&#9998;</button>
                    <button class="product-comp-action-btn" onclick="event.stopPropagation(); productDeleteChild('${id}')" title="Remove">&#10005;</button>
                </div>
            </div>`;
        }).join('');
        html += `<div class="product-comp-add"><input type="text" placeholder="Add child product..." onkeydown="if(event.key==='Enter'){productAddChild(this.value);this.value='';event.preventDefault();}"></div>`;
        childProdsEl.innerHTML = html;
    }

    // Activities (child tasks — non-deliverable leaf tasks)
    const compEl = document.getElementById('productComposition');
    if (compEl) {
        const activities = pbsGetActivities(task, pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []));
        let html = activities.map(a => {
            const pct = parseFloat(a.percent) || 0;
            const name = (a.description || a.name || '').replace(/</g, '&lt;');
            const safeName = (a.name || '').replace(/'/g, "\\'");
            return `<div class="product-comp-item">
                <span class="product-comp-name">${name}</span>
                <span class="product-comp-pct">${pct}%</span>
                <div class="product-comp-actions">
                    <button class="product-comp-action-btn" onclick="event.stopPropagation(); openTaskFormByName('${safeName}')" title="Edit">&#9998;</button>
                    <button class="product-comp-action-btn" onclick="event.stopPropagation(); productDeleteActivity('${safeName}')" title="Remove">&#10005;</button>
                </div>
            </div>`;
        }).join('');
        html += `<div class="product-comp-add"><input type="text" placeholder="Add activity..." onkeydown="if(event.key==='Enter'){productAddActivity(this.value);this.value='';event.preventDefault();}"></div>`;
        compEl.innerHTML = html;
    }

    // Mini flow diagram — inputs → [this] → outputs
    const flowEl = document.getElementById('productFlowDiagram');
    if (flowEl) {
        const allTasks = pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []);
        const deliverables = pbsExtractDeliverables(allTasks);
        const thisId = task.deliverable;

        // Find inputs: products that this product depends on
        const inputs = [];
        if (task.depends) {
            for (const depName of task.depends) {
                const depTask = deliverables.find(d => d.name === depName || d.description === depName);
                if (depTask) inputs.push(depTask);
            }
        }

        // Find outputs: products that depend on this product
        const outputs = [];
        for (const d of deliverables) {
            if (d.depends && d.deliverable !== thisId) {
                const dependsOnThis = d.depends.some(depName => {
                    const depTask = deliverables.find(dt => dt.name === depName || dt.description === depName);
                    return depTask && depTask.deliverable === thisId;
                });
                if (dependsOnThis) outputs.push(d);
            }
        }

        const arrowSvg = '<span class="pf-mini-arrow"><svg viewBox="0 0 30 12"><path d="M0,6 L22,6" fill="none" stroke="#E8833A" stroke-width="2"/><polygon points="20,2 28,6 20,10" fill="#E8833A"/></svg></span>';

        let html = '';
        let colIdx = 0;

        // Input nodes
        if (inputs.length > 0) {
            for (const inp of inputs) {
                const name = (inp.name || '').replace(/</g, '&lt;');
                const colour = PBS_COLOURS[colIdx % PBS_COLOURS.length];
                colIdx++;
                html += `<div class="pf-mini-node" style="background:${colour};" onclick="openProductForm(lastRenderedTasks.find(t => t.deliverable === '${inp.deliverable}'))" title="${name}">${name}</div>`;
                html += arrowSvg;
            }
        }

        // Current node
        const currentName = (task.name || '').replace(/</g, '&lt;');
        const currentColour = PBS_COLOURS[colIdx % PBS_COLOURS.length];
        colIdx++;
        html += `<div class="pf-mini-node" style="background:${currentColour}; box-shadow: 0 0 0 2px #fff, 0 0 0 4px ${currentColour};" title="${currentName}">${currentName}</div>`;

        // Output nodes
        if (outputs.length > 0) {
            for (const out of outputs) {
                const name = (out.name || '').replace(/</g, '&lt;');
                const colour = PBS_COLOURS[colIdx % PBS_COLOURS.length];
                colIdx++;
                html += arrowSvg;
                html += `<div class="pf-mini-node" style="background:${colour};" onclick="openProductForm(lastRenderedTasks.find(t => t.deliverable === '${out.deliverable}'))" title="${name}">${name}</div>`;
            }
        }

        if (inputs.length === 0 && outputs.length === 0) {
            html = `<div class="pf-mini-node" style="background:${currentColour};">${currentName}</div><span style="color: var(--text-secondary, #888); font-size: 11px; padding-left: 8px;">No connections</span>`;
        }

        flowEl.innerHTML = html;
    }

    // Resources
    const resEl = document.getElementById('productResources');
    if (resEl) {
        const resources = pbsGetResources(task, pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []));
        if (resources.length === 0) {
            resEl.innerHTML = '<span>No resources assigned</span>';
        } else {
            resEl.innerHTML = resources.map(r =>
                `<span class="product-resource-badge">${r.replace(/</g, '&lt;')}</span>`
            ).join(' ');
        }
    }

    // Quality Assurance roles
    const qaEl = document.getElementById('productQARoles');
    if (qaEl) {
        const allTasks = pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []);
        const qr = task.quality_roles || {};

        // Build list of all available people (resources + stakeholders)
        const availablePeople = [];
        if (typeof globalResourceMap !== 'undefined') {
            for (const [sn, fullName] of Object.entries(globalResourceMap)) {
                availablePeople.push({ shortname: sn.toLowerCase(), displayName: fullName });
            }
        }
        const stakeholders = window._lastStakeholders || [];
        for (const s of stakeholders) {
            const sn = (s.shortname || s.name || '').replace(/^@/, '').toLowerCase();
            if (!availablePeople.find(p => p.shortname === sn)) {
                availablePeople.push({ shortname: sn, displayName: s.name || sn });
            }
        }
        availablePeople.sort((a, b) => a.displayName.localeCompare(b.displayName));

        // Find current assignments
        const currentP = Object.entries(qr).find(([, r]) => r === 'P');
        const currentR = Object.entries(qr).find(([, r]) => r === 'R');
        const currentA = Object.entries(qr).find(([, r]) => r === 'A');

        // Also check regular resources as default producers
        let producerName = currentP ? currentP[0].toLowerCase() : '';
        if (!producerName && task.resources) {
            const firstRes = task.resources.split(',')[0].trim();
            if (firstRes) {
                // Reverse lookup: find the shortname for this full name
                const match = availablePeople.find(p =>
                    p.displayName.toLowerCase() === firstRes.toLowerCase() ||
                    p.shortname === firstRes.toLowerCase()
                );
                producerName = match ? match.shortname : firstRes.toLowerCase();
            }
        }

        function buildRoleSelect(roleCode, roleLabel, currentShortname) {
            const options = availablePeople.map(p =>
                `<option value="${p.shortname}"${p.shortname === currentShortname ? ' selected' : ''}>${p.displayName}</option>`
            ).join('');
            return `<div class="product-qa-role-row">
                <span class="product-qa-role-label role-${roleCode}">${roleLabel}</span>
                <select class="product-qa-role-select" data-role="${roleCode}" onchange="productUpdateQARole(this)">
                    <option value="">— None</option>
                    ${options}
                </select>
            </div>`;
        }

        qaEl.innerHTML =
            buildRoleSelect('P', 'Producer', producerName) +
            buildRoleSelect('R', 'Reviewer', currentR ? currentR[0].toLowerCase() : '') +
            buildRoleSelect('A', 'Approver', currentA ? currentA[0].toLowerCase() : '');
    }

    // Dependencies — tag input with autocomplete
    const depsTagsEl = document.getElementById('productDependenciesTags');
    const depsInputEl = document.getElementById('productDependenciesInput');
    if (depsTagsEl && depsInputEl) {
        const allTasks = pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []);
        const deliverables = pbsExtractDeliverables(allTasks);

        // Render existing dependency tags
        depsTagsEl.innerHTML = '';
        if (task.depends) {
            let tagIdx = 0;
            for (const depName of task.depends) {
                const depTask = deliverables.find(d => d.name === depName || d.description === depName);
                if (depTask) {
                    const colour = PBS_COLOURS[tagIdx % PBS_COLOURS.length];
                    tagIdx++;
                    const tag = document.createElement('span');
                    tag.className = 'product-dep-tag';
                    tag.style.background = colour;
                    tag.innerHTML = `${depTask.name.replace(/</g, '&lt;')}<span class="dep-tag-remove" onclick="productRemoveDep('${depTask.deliverable}')">&times;</span>`;
                    tag.title = `$${depTask.deliverable}`;
                    tag.addEventListener('click', (e) => {
                        if (e.target.classList.contains('dep-tag-remove')) return;
                        openProductForm(depTask);
                    });
                    depsTagsEl.appendChild(tag);
                }
            }
        }

        // Setup autocomplete on the input
        depsInputEl.value = '';
        depsInputEl.oninput = () => productDepsAutocomplete(depsInputEl, deliverables);
        depsInputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const acItems = document.querySelectorAll('.product-deps-autocomplete-item.active');
                if (acItems.length > 0) {
                    acItems[0].click();
                } else {
                    // Try exact match
                    const val = depsInputEl.value.trim();
                    const match = deliverables.find(d => d.name.toLowerCase() === val.toLowerCase());
                    if (match) productAddDep(match.deliverable);
                }
            } else if (e.key === 'Backspace' && !depsInputEl.value) {
                // Remove last tag
                const tags = depsTagsEl.querySelectorAll('.product-dep-tag');
                if (tags.length > 0) {
                    const lastTag = tags[tags.length - 1];
                    const id = lastTag.title.replace('$', '');
                    productRemoveDep(id);
                }
            }
        };
    }

    // Dates (read-only, from scheduling engine)
    const startEl = document.getElementById('productStartDate');
    if (startEl) startEl.textContent = task.start || '\u2014';
    const finishEl = document.getElementById('productFinishDate');
    if (finishEl) finishEl.textContent = task.finish || '\u2014';

    // Progress (rolled up)
    const allTasks = pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []);
    const rollup = pbsComputeRollup(task, allTasks);
    const pctEl = document.getElementById('productPercentText');
    if (pctEl) pctEl.textContent = `${rollup.percent}%`;
    const barEl = document.getElementById('productProgressBar');
    if (barEl) {
        barEl.style.width = `${rollup.percent}%`;
        barEl.setAttribute('aria-valuenow', rollup.percent);
    }
}

function closeProductForm() {
    if (productFormSaveTimer) {
        clearTimeout(productFormSaveTimer);
        productFormSaveTimer = null;
    }
    if (typeof closeDetailPane === 'function') closeDetailPane();
    currentProductTask = null;
    currentProductLineNumber = null;
}

function saveProductForm() {
    if (!currentProductTask || currentProductLineNumber === null) return;

    // Don't save if the product form is not the active section
    const productSection = document.getElementById('productFormSection');
    if (productSection && !productSection.classList.contains('active')) return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');

    // Always re-find the line by $deliverable to ensure we write to the correct one
    if (currentProductTask.deliverable) {
        const foundLine = productFindLineNumber(currentProductTask.name, currentProductTask.deliverable);
        if (foundLine !== null) {
            currentProductLineNumber = foundLine;
        }
    }

    const originalLine = lines[currentProductLineNumber];
    if (originalLine === undefined) return;

    // Final safety: verify this line contains the expected $deliverable token
    if (currentProductTask.deliverable && !originalLine.includes('$' + currentProductTask.deliverable)) {
        return; // Can't find the right line — don't write anywhere
    }

    const newTitle = (document.getElementById('productTitle').value || '').trim();
    const newId = (document.getElementById('productIdentifier').value || '').trim();
    const newPurpose = (document.getElementById('productPurpose').value || '').trim();
    const newDeps = productGetDepsFromTags();

    // Preserve indent and * prefix from original line
    const indent = originalLine.match(/^(\s*)/)[1];
    const star = originalLine.trim().startsWith('*') ? '* ' : '';
    let newLine = `${indent}${star}${newTitle || currentProductTask.name}`;

    if (newId) {
        const typePrefix = currentProductType === 'group' ? '/' : currentProductType === 'external' ? '^' : '';
        newLine += ` ${typePrefix}$${newId}`;
    }

    // Preserve original tokens we don't edit (resources, dates, duration, percent)
    const origText = originalLine.trim().replace(/^\*\s*/, '');
    // Remove task name, old $id, [depends ...], and "comments" to isolate metadata tokens
    const origTaskName = currentProductTask.name || newTitle || '';
    let cleaned = origText;
    // Remove the task name from the front
    if (origTaskName && cleaned.startsWith(origTaskName)) {
        cleaned = cleaned.substring(origTaskName.length);
    }
    cleaned = cleaned
        .replace(/\[depends(?::\s*|\s+)[^\]]*\]/i, '')
        .replace(/"[^"]*"/g, '')
        .replace(/[/^]?\$[A-Za-z_][A-Za-z0-9_-]*/g, '')
        .replace(/\[repeats\s+[^\]]*\]/i, '');
    const origTokens = cleaned.split(/\s+/);
    for (const token of origTokens) {
        if (token.startsWith('@')) newLine += ` ${token}`;
        else if (token.match(/^\d+[dwmy]$/)) newLine += ` ${token}`;
        else if (token.match(/^\d+%$/)) newLine += ` ${token}`;
        else if (token.match(/^\d{4}-\d{2}-\d{2}$/)) newLine += ` ${token}`;
        else if (token.startsWith('#')) newLine += ` ${token}`;
    }

    if (newDeps) newLine += ` [depends ${newDeps}]`;
    if (newPurpose) newLine += ` "${newPurpose}"`;

    lines[currentProductLineNumber] = newLine;

    // Auto-update dependency references if the $identifier was renamed
    const oldId = currentProductTask ? currentProductTask.deliverable : null;
    if (oldId && newId && oldId !== newId && typeof updateDeliverableReferences === 'function') {
        updateDeliverableReferences(lines, oldId, newId);
    }

    // Auto-update dependency references if the task name was renamed
    const oldName = currentProductTask ? currentProductTask.name : null;
    if (oldName && newTitle && oldName !== newTitle && typeof updateDependencyReferences === 'function') {
        updateDependencyReferences(lines, oldName, newTitle);
    }

    editor.value = lines.join('\n');

    // Keep track of the new identifier so subsequent saves can find the line
    if (newId && currentProductTask) {
        currentProductTask.deliverable = newId;
    }
    if (newTitle && currentProductTask) {
        currentProductTask.name = newTitle;
    }

    // Update line numbers display immediately
    if (editor._updateLineNumbers) editor._updateLineNumbers();

    // Debounce the render to avoid "Too many requests" from rapid keystrokes
    if (productFormSaveTimer) clearTimeout(productFormSaveTimer);
    productFormSaveTimer = setTimeout(() => {
        editor.dispatchEvent(new Event('input'));
        renderText();
    }, 1500);
}

// ── Toggle between Task and Product forms ─────────────────────────────

function toggleTaskDeliverable() {
    // Called from the task form's "Product" / "Make Deliverable" button
    // Cancel any pending product form save from a previous interaction
    if (productFormSaveTimer) {
        clearTimeout(productFormSaveTimer);
        productFormSaveTimer = null;
    }
    currentProductTask = null;
    currentProductLineNumber = null;

    const editor = document.getElementById('planEditor');
    if (!editor || typeof currentTaskLineNumber === 'undefined' || currentTaskLineNumber === null) return;

    const taskName = (document.getElementById('taskName').value || '').trim();
    if (!taskName) return;

    // Re-find the correct line by name to avoid stale line numbers
    const lines = editor.value.split('\n');
    let lineIdx = currentTaskLineNumber - 1;

    // Verify the line at currentTaskLineNumber actually contains this task
    const verifyLine = lines[lineIdx] || '';
    const verifyTrimmed = verifyLine.trim().replace(/^\*\s*/, '');
    const verifyMatch = verifyTrimmed.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[/^]?\$|\s+[@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
    const verifyName = verifyMatch ? verifyMatch[1].trim() : '';
    if (verifyName !== taskName) {
        // Line number is stale — search for the correct line
        let found = false;
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim().replace(/^\*\s*/, '');
            const nm = t.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[/^]?\$|\s+[@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
            const n = nm ? nm[1].trim() : '';
            if (n === taskName && !lines[i].match(/\$[A-Za-z_]/)) {
                lineIdx = i;
                found = true;
                break;
            }
        }
        // If still not found, try matching with $deliverable (already a product)
        if (!found) {
            for (let i = 0; i < lines.length; i++) {
                const t = lines[i].trim().replace(/^\*\s*/, '');
                const nm = t.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[/^]?\$|\s+[@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
                const n = nm ? nm[1].trim() : '';
                if (n === taskName) { lineIdx = i; break; }
            }
        }
    }

    const line = lines[lineIdx];
    if (line === undefined) return;

    // Check if this task already has a $deliverable token
    const delivMatch = line.match(/\$([A-Za-z_][A-Za-z0-9_-]*)/);

    if (delivMatch) {
        // Already a deliverable — find the matching backend task and open product form
        const delivId = delivMatch[1];
        const allTasks = (typeof lastRenderedTasks !== 'undefined') ? lastRenderedTasks : [];
        let task = allTasks.find(t => t.deliverable === delivId);
        // Fallback: match by name if deliverable ID not found (can happen with duplicate task names)
        if (!task) {
            task = allTasks.find(t => t.name === taskName && t.deliverable);
        }
        if (task) {
            openProductForm(task);
        } else {
            // Last resort: construct a minimal task object from the editor line
            openProductForm({
                name: taskName,
                deliverable: delivId,
                depends: [], comment: '', start: '', finish: '', percent: 0
            });
        }
    } else {
        // Not a deliverable — add a $identifier token
        let identifier = taskName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (!identifier) return;

        // Collect all existing $identifiers to avoid duplicates
        const existingIds = new Set();
        const idRegex = /\$([A-Za-z_][A-Za-z0-9_-]*)/g;
        let m;
        while ((m = idRegex.exec(editor.value)) !== null) {
            existingIds.add(m[1].toLowerCase());
        }

        // If duplicate, append a number suffix
        if (existingIds.has(identifier)) {
            let counter = 1;
            while (existingIds.has(`${identifier}_${counter}`)) {
                counter++;
            }
            identifier = `${identifier}_${counter}`;
        }

        // Insert $identifier after the task name
        const trimmed = line.trimStart();
        const indent = line.substring(0, line.length - trimmed.length);
        // Find first metadata token position to insert before it
        const metaMatch = trimmed.match(/(\s+[@#!$"{\[\d]|\s+\d+[dwmy]|\s+\d+%)/);
        let newLine;
        if (metaMatch) {
            const pos = metaMatch.index;
            newLine = indent + trimmed.substring(0, pos) + ` $${identifier}` + trimmed.substring(pos);
        } else {
            newLine = line + ` $${identifier}`;
        }

        lines[lineIdx] = newLine;
        editor.value = lines.join('\n');
        if (editor._updateLineNumbers) editor._updateLineNumbers();
        editor.dispatchEvent(new Event('input'));

        // Use the identifier we just created to find the task after render
        const createdId = identifier;
        setTimeout(() => {
            renderText();
            setTimeout(() => {
                const allTasks = (typeof lastRenderedTasks !== 'undefined') ? lastRenderedTasks : [];
                const task = allTasks.find(t => t.deliverable === createdId);
                if (task) {
                    openProductForm(task);
                }
            }, 500);
        }, 10);
    }
}

function switchProductToTaskForm() {
    // Called from the product form's "Task Details" button
    if (!currentProductTask) return;
    // Cancel any pending product form save to avoid overwriting the line
    if (productFormSaveTimer) {
        clearTimeout(productFormSaveTimer);
        productFormSaveTimer = null;
    }

    // Use the tracked line number (0-based) for precision instead of name search
    if (currentProductLineNumber !== null && typeof openTaskForm === 'function') {
        // Re-verify the line still has our deliverable
        const editor = document.getElementById('planEditor');
        if (editor) {
            const lines = editor.value.split('\n');
            const line = lines[currentProductLineNumber];
            if (line && currentProductTask.deliverable && line.includes('$' + currentProductTask.deliverable)) {
                openTaskForm(currentProductLineNumber + 1); // openTaskForm uses 1-based
                return;
            }
        }
    }

    // Fallback: search by name
    const taskName = currentProductTask.name;
    if (taskName && typeof openTaskFormByName === 'function') {
        openTaskFormByName(taskName);
    }
}

function updateProductNameFromTitle() {
    const titleEl = document.getElementById('productFormTitle');
    const inputEl = document.getElementById('productTitle');
    if (titleEl && inputEl) {
        inputEl.value = titleEl.innerText.trim();
        saveProductForm();
    }
}

function updateProductTitleFromInput() {
    const inputEl = document.getElementById('productTitle');
    const titleEl = document.getElementById('productFormTitle');
    if (inputEl && titleEl) {
        titleEl.textContent = inputEl.value || 'Product Details';
    }
}

function removeDeliverable() {
    // Remove the $identifier token from the current product's line
    if (!currentProductTask || currentProductLineNumber === null) return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const line = lines[currentProductLineNumber];
    if (line === undefined) return;

    // Remove $identifier token
    const newLine = line.replace(/\s*\$[A-Za-z_][A-Za-z0-9_-]*/, '');
    lines[currentProductLineNumber] = newLine;
    editor.value = lines.join('\n');

    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    setTimeout(() => renderText(), 10);

    // Switch to task form
    const taskName = currentProductTask.name;
    closeProductForm();
    if (taskName && typeof openTaskFormByName === 'function') {
        setTimeout(() => openTaskFormByName(taskName), 600);
    }
}

function productFormRefresh() {
    // Re-render then reopen the product form with refreshed task data
    const delivId = currentProductTask ? currentProductTask.deliverable : null;
    setTimeout(() => {
        renderText();
        setTimeout(() => {
            if (!delivId) return;
            const allTasks = (typeof lastRenderedTasks !== 'undefined') ? lastRenderedTasks : [];
            const refreshed = allTasks.find(t => t.deliverable === delivId);
            if (refreshed) openProductForm(refreshed);
        }, 500);
    }, 10);
}

// ── Product form helpers: add/delete activities, child products, deps ──

function productAddActivity(name) {
    if (!name.trim() || !currentProductTask) return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lineNum = productFindLineNumber(currentProductTask.name, currentProductTask.deliverable);
    if (lineNum === null) return;

    const lines = editor.value.split('\n');
    const parentIndent = lines[lineNum].match(/^(\s*)/)[1];
    const childIndent = parentIndent + '  ';

    // Find end of this task's children
    let insertAt = lineNum + 1;
    while (insertAt < lines.length) {
        const li = lines[insertAt];
        if (!li.trim()) { insertAt++; continue; }
        const indent = li.search(/\S/);
        if (indent <= parentIndent.length) break;
        insertAt++;
    }

    lines.splice(insertAt, 0, `${childIndent}*${name.trim()}`);
    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    productFormRefresh();
}

function productDeleteActivity(taskName) {
    if (!taskName) return;
    if (!confirm(`Remove activity "${taskName}"?`)) return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim().replace(/^\*\s*/, '');
        const nm = t.match(/^([^@#!$"{\d\[~][^@#!$"{\[~]*?)(?:\s+[\$@#!"{~\[]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s*$)/);
        const n = nm ? nm[1].trim() : t.split(/\s+/)[0];
        if (n === taskName) {
            lines.splice(i, 1);
            break;
        }
    }
    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    productFormRefresh();
}

function productAddChild(name) {
    if (!name.trim() || !currentProductTask) return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Generate unique id
    let id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const existingIds = new Set();
    const idRegex = /\$([A-Za-z_][A-Za-z0-9_-]*)/g;
    let m;
    while ((m = idRegex.exec(editor.value)) !== null) existingIds.add(m[1].toLowerCase());
    if (existingIds.has(id)) { let c = 1; while (existingIds.has(`${id}_${c}`)) c++; id = `${id}_${c}`; }

    const lineNum = productFindLineNumber(currentProductTask.name, currentProductTask.deliverable);
    if (lineNum === null) return;

    const lines = editor.value.split('\n');
    const parentIndent = lines[lineNum].match(/^(\s*)/)[1];
    const childIndent = parentIndent + '  ';

    let insertAt = lineNum + 1;
    while (insertAt < lines.length) {
        const li = lines[insertAt];
        if (!li.trim()) { insertAt++; continue; }
        const indent = li.search(/\S/);
        if (indent <= parentIndent.length) break;
        insertAt++;
    }

    lines.splice(insertAt, 0, `${childIndent}${name.trim()} $${id}`);
    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    productFormRefresh();
}

function productDeleteChild(delivId) {
    if (!delivId) return;
    // Find the product name for the confirmation message
    const allTasks = (typeof lastRenderedTasks !== 'undefined') ? lastRenderedTasks : [];
    const product = allTasks.find(t => t.deliverable === delivId);
    const productName = product ? product.name : delivId;
    if (!confirm(`Remove product "${productName}" and its contents?`)) return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const token = '$' + delivId;
    let lineNum = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(token)) { lineNum = i; break; }
    }
    if (lineNum < 0) return;

    lines.splice(lineNum, 1);
    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    productFormRefresh();
}

function productAddDep(delivId) {
    if (!delivId || !currentProductTask) return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lineNum = productFindLineNumber(currentProductTask.name, currentProductTask.deliverable);
    if (lineNum === null) return;

    const lines = editor.value.split('\n');
    const line = lines[lineNum];
    if (line.includes(`$${delivId}`)) return; // already has this dep

    const dependsMatch = line.match(/\[depends(?::\s*|\s+)([^\]]*)\]/i);
    if (dependsMatch) {
        const existing = dependsMatch[1].trim();
        lines[lineNum] = line.replace(/\[depends(?::\s*|\s+)[^\]]*\]/i, `[depends ${existing}, $${delivId}]`);
    } else {
        const commentMatch = line.match(/(\s+"[^"]*"\s*)$/);
        if (commentMatch) {
            lines[lineNum] = line.slice(0, -commentMatch[0].length) + ` [depends $${delivId}]` + commentMatch[0];
        } else {
            lines[lineNum] = line + ` [depends $${delivId}]`;
        }
    }

    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));

    const depsInput = document.getElementById('productDependenciesInput');
    if (depsInput) depsInput.value = '';
    const acEl = document.getElementById('productDepsAutocomplete');
    if (acEl) acEl.style.display = 'none';

    productFormRefresh();
}

function productRemoveDep(delivId) {
    if (!delivId || !currentProductTask) return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lineNum = productFindLineNumber(currentProductTask.name, currentProductTask.deliverable);
    if (lineNum === null) return;

    const lines = editor.value.split('\n');
    const line = lines[lineNum];
    const dependsMatch = line.match(/\[depends(?::\s*|\s+)([^\]]*)\]/i);
    if (!dependsMatch) return;

    const deps = dependsMatch[1].split(',').map(d => d.trim()).filter(d => {
        const stripped = d.replace(/:[A-Z]{2}$/i, '').replace(/\s+[+\-]\d+[dwmy]$/i, '').trim();
        return stripped !== `$${delivId}`;
    });

    if (deps.length === 0) {
        lines[lineNum] = line.replace(/\s*\[depends(?::\s*|\s+)[^\]]*\]/i, '');
    } else {
        lines[lineNum] = line.replace(/\[depends(?::\s*|\s+)[^\]]*\]/i, `[depends ${deps.join(', ')}]`);
    }

    editor.value = lines.join('\n');
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));
    productFormRefresh();
}

function productDepsAutocomplete(inputEl, deliverables) {
    const acEl = document.getElementById('productDepsAutocomplete');
    if (!acEl) return;

    const query = inputEl.value.trim().toLowerCase();
    if (!query) { acEl.style.display = 'none'; return; }

    // Filter deliverables matching query, excluding current product and existing deps
    const currentDeps = new Set();
    const tags = document.querySelectorAll('#productDependenciesTags .product-dep-tag');
    tags.forEach(t => currentDeps.add(t.title.replace('$', '')));
    if (currentProductTask) currentDeps.add(currentProductTask.deliverable);

    const matches = deliverables.filter(d =>
        !currentDeps.has(d.deliverable) &&
        (d.name.toLowerCase().includes(query) || d.deliverable.toLowerCase().includes(query))
    ).slice(0, 8);

    if (matches.length === 0) { acEl.style.display = 'none'; return; }

    acEl.style.display = 'block';
    acEl.innerHTML = matches.map((d, i) => {
        const colour = PBS_COLOURS[i % PBS_COLOURS.length];
        const name = (d.name || '').replace(/</g, '&lt;');
        return `<div class="product-deps-autocomplete-item${i === 0 ? ' active' : ''}" onclick="productAddDep('${d.deliverable}')">
            <span class="dep-ac-swatch" style="background:${colour};"></span>
            <span>${name}</span>
        </div>`;
    }).join('');
}

// Update saveProductForm to read deps from tags instead of input
function productGetDepsFromTags() {
    const tags = document.querySelectorAll('#productDependenciesTags .product-dep-tag');
    return [...tags].map(t => t.title.replace('$', '')).map(id => `$${id}`).join(', ');
}

function productUpdateQARole(selectEl) {
    const roleCode = selectEl.dataset.role;
    const person = selectEl.value;

    if (!currentProductTask || !currentProductTask.deliverable) return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const deliverable = currentProductTask.deliverable;
    const lineIdx = _findDeliverableLineIdx(editor.value, deliverable);
    if (lineIdx < 0) return;

    const lines = editor.value.split('\n');
    // Remove any existing @xxx:ROLE for this role code
    let newLine = lines[lineIdx].replace(new RegExp('\\s*@\\S+:' + roleCode, 'gi'), '');

    if (person) {
        newLine = newLine.trimEnd() + ' @' + person + ':' + roleCode;
    }

    if (newLine !== lines[lineIdx]) {
        lines[lineIdx] = newLine;
        editor.value = lines.join('\n');
        if (editor._updateLineNumbers) editor._updateLineNumbers();
        editor.dispatchEvent(new Event('input'));
        setTimeout(() => renderText(), 10);
    }
}

// Find the line index where $deliverable is the task's OWN token (not in [depends])
function _findDeliverableLineIdx(text, deliverable) {
    const lines = text.split('\n');
    // Use regex with word boundary to avoid $proposal matching $proposal_stage
    // Also handles product type prefixes: /$name (group), ^$name (external)
    const escaped = deliverable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRe = new RegExp('[/^]?\\$' + escaped + '(?![\\w])', 'i');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!tokenRe.test(line)) continue;
        // Strip [depends ...] blocks and check if token remains
        const withoutDeps = line.replace(/\[depends(?::\s*|\s+)[^\]]*\]/gi, '');
        if (tokenRe.test(withoutDeps)) return i;
    }
    return -1;
}
