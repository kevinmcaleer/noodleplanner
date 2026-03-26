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
    const parentName = deliverableTask.name || deliverableTask.description;

    // Collect all descendant names (not just direct children) so we find
    // leaf tasks nested under intermediate summary tasks.
    const descendantNames = new Set([parentName]);
    let added = true;
    while (added) {
        added = false;
        for (const t of allTasks) {
            if (t.parent && descendantNames.has(t.parent) && !descendantNames.has(t.name)) {
                // Stop at other deliverables — they are separate products
                if (t.deliverable) continue;
                descendantNames.add(t.name);
                added = true;
            }
        }
    }

    for (const t of allTasks) {
        if (t.parent && descendantNames.has(t.parent) && !t.deliverable && !t.is_summary) {
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

function pbsRenderNode(node, parentColour, nextColour, depth) {
    const isRoot = !!node._isRoot;
    const colour = isRoot ? '#4A90D9' : (depth === 1 ? nextColour() : (parentColour || '#4A90D9'));

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

    // Invisible hit area extending beyond the node to keep hover active for + buttons
    if (!isRoot) {
        const pad = PBS_ADD_BTN_SIZE + 8;
        g.appendChild(pbsCreateSVGElement('rect', {
            'x': node.x - pad, 'y': node.y - pad,
            'width': node.width + pad * 2, 'height': node.height + pad * 2,
            'fill': 'transparent', 'stroke': 'none'
        }));
    }

    // Node shape: parallelogram for parents with children, rounded rect for leaves
    const hasChildren = node.children && node.children.length > 0;
    const skew = 10;
    if (hasChildren && !isRoot) {
        // Parallelogram
        const x = node.x, y = node.y, w = node.width, h = node.height;
        const points = `${x + skew},${y} ${x + w},${y} ${x + w - skew},${y + h} ${x},${y + h}`;
        g.appendChild(pbsCreateSVGElement('polygon', {
            'points': points, 'fill': colour,
            'stroke': pbsShadeColour(colour, 0.7), 'stroke-width': '1.5',
            'class': 'pbs-node-rect'
        }));
    } else {
        // Rounded rectangle
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

    container.addEventListener('mousedown', (e) => {
        if (e.target.closest('.pbs-node')) return;
        pbsIsDragging = true;
        pbsDragStartX = e.clientX;
        pbsDragStartY = e.clientY;
        pbsDragStartPanX = pbsPanX;
        pbsDragStartPanY = pbsPanY;
        container.style.cursor = 'grabbing';
        e.preventDefault();
    });

    const onMouseMove = (e) => {
        if (!pbsIsDragging) return;
        pbsPanX = pbsDragStartPanX + (e.clientX - pbsDragStartX);
        pbsPanY = pbsDragStartPanY + (e.clientY - pbsDragStartY);
        pbsApplyTransform();
    };

    const onMouseUp = () => {
        if (!pbsIsDragging) return;
        pbsIsDragging = false;
        container.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };

    container.addEventListener('mousedown', () => {
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
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

    // From the deliverable task's quality_roles (explicit :P/:R/:A)
    const qr = deliverableTask.quality_roles;
    if (qr && typeof qr === 'object') {
        for (const [name, role] of Object.entries(qr)) {
            merged[name.toLowerCase()] = role;
        }
    }

    // Regular resources on the deliverable default to Producer
    if (deliverableTask.resources) {
        const resList = deliverableTask.resources.split(',').map(r => r.trim().toLowerCase()).filter(r => r);
        for (const res of resList) {
            if (!merged[res]) merged[res] = 'P';
        }
    }

    // From child activities
    const activities = pbsGetActivities(deliverableTask, allTasks);
    for (const act of activities) {
        const aqr = act.quality_roles;
        if (aqr && typeof aqr === 'object') {
            for (const [name, role] of Object.entries(aqr)) {
                const key = name.toLowerCase();
                if (!merged[key]) merged[key] = role;
            }
        }
        // Regular resources on activities default to Producer
        if (act.resources) {
            const resList = act.resources.split(',').map(r => r.trim().toLowerCase()).filter(r => r);
            for (const res of resList) {
                if (!merged[res]) merged[res] = 'P';
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

    const deliverables = pbsExtractDeliverables(tasks || []);

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
        const roleValues = Object.values(rolesMap);
        const hasP = roleValues.includes('P');
        const hasR = roleValues.includes('R');
        const hasA = roleValues.includes('A');
        const isQA = hasP && hasR && hasA;

        const tr = document.createElement('tr');
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
            const role = rolesMap[p.shortname] || '';
            let roleLabel = '';
            let roleClass = 'dm-role-empty';
            if (role === 'P') { roleLabel = 'P'; roleClass = 'dm-role-producer'; }
            else if (role === 'R') { roleLabel = 'R'; roleClass = 'dm-role-reviewer'; }
            else if (role === 'A') { roleLabel = 'A'; roleClass = 'dm-role-approver'; }

            html += `<td class="dm-role-cell" title="${p.displayName}">
                <select class="role-${role}" data-deliverable="${task.deliverable}" data-person="${p.shortname}" onchange="dmUpdateRole(this)">
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

    const lines = editor.value.split('\n');
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('$' + deliverable)) continue;

        // Remove existing @person:P/R/A token for this person
        let newLine = line.replace(new RegExp('\\s*@' + person + ':[PRA]', 'gi'), '');

        if (newRole) {
            // Add the new role token
            newLine = newLine.trimEnd() + ' @' + person + ':' + newRole;
        }

        if (newLine !== line) {
            lines[i] = newLine;
            updated = true;
            break;
        }
    }

    if (updated) {
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

const PF_NODE_W = 140;
const PF_NODE_H = 44;
const PF_H_GAP = 30;
const PF_V_GAP = 10;

function updateProductFlow(tasks, projectName) {
    const allTasks = tasks || [];
    const deliverables = pbsExtractDeliverables(allTasks);

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
    }

    // Build topLevelSummaries for bounding box rendering (expanded stages only)
    const topLevelSummaries = {};
    for (const [id, stage] of Object.entries(stageNodes)) {
        if (pfExpandedStages.has(id)) topLevelSummaries[id] = stage;
    }

    // Assign columns via longest path from roots
    function assignColumn(key, visited) {
        if (visited.has(key)) return nodes[key].column;
        visited.add(key);
        let maxDepCol = -1;
        for (const dep of nodes[key].deps) {
            if (nodes[dep]) {
                maxDepCol = Math.max(maxDepCol, assignColumn(dep, visited));
            }
        }
        nodes[key].column = maxDepCol + 1;
        return nodes[key].column;
    }
    const visited = new Set();
    for (const key of Object.keys(nodes)) {
        assignColumn(key, visited);
    }

    // Shift independent nodes (no deps) to be one column before their
    // earliest downstream dependent, so they sit close to what needs them
    for (const [key, node] of Object.entries(nodes)) {
        if (node.deps.length > 0) continue; // has upstream deps — column is correct

        // Find the earliest column of anything that depends on this node
        let minDownstreamCol = Infinity;
        for (const [otherKey, otherNode] of Object.entries(nodes)) {
            if (otherNode.deps.includes(key)) {
                minDownstreamCol = Math.min(minDownstreamCol, otherNode.column);
            }
        }

        if (minDownstreamCol !== Infinity && minDownstreamCol > 0) {
            node.column = minDownstreamCol - 1;
        }
    }

    // Group by column
    const columns = {};
    for (const [key, node] of Object.entries(nodes)) {
        if (!columns[node.column]) columns[node.column] = [];
        columns[node.column].push({ key, ...node });
    }

    // Barycenter ordering: sort nodes within each column to minimize
    // vertical distance to their connected nodes
    const maxCol = Object.keys(columns).length > 0 ? Math.max(...Object.keys(columns).map(Number)) : 0;

    // Build reverse dependency map (key → list of nodes that depend on it)
    const dependedOnBy = {};
    for (const [key, node] of Object.entries(nodes)) {
        for (const dep of node.deps) {
            if (!dependedOnBy[dep]) dependedOnBy[dep] = [];
            dependedOnBy[dep].push(key);
        }
    }

    // Combined barycenter: use both upstream AND downstream connections
    // Run multiple passes for convergence
    const rowIndex = {};
    for (let col = 0; col <= maxCol; col++) {
        (columns[col] || []).forEach((item, idx) => { rowIndex[item.key] = idx; });
    }

    for (let pass = 0; pass < 3; pass++) {
        // Forward pass
        for (let col = 0; col <= maxCol; col++) {
            const items = columns[col] || [];
            if (items.length <= 1) continue;

            items.sort((a, b) => {
                const aUp = a.deps.filter(d => rowIndex[d] !== undefined);
                const aDown = (dependedOnBy[a.key] || []).filter(d => rowIndex[d] !== undefined);
                const bUp = b.deps.filter(d => rowIndex[d] !== undefined);
                const bDown = (dependedOnBy[b.key] || []).filter(d => rowIndex[d] !== undefined);

                const aAll = [...aUp, ...aDown];
                const bAll = [...bUp, ...bDown];

                const aAvg = aAll.length > 0
                    ? aAll.reduce((s, d) => s + rowIndex[d], 0) / aAll.length
                    : rowIndex[a.key];
                const bAvg = bAll.length > 0
                    ? bAll.reduce((s, d) => s + rowIndex[d], 0) / bAll.length
                    : rowIndex[b.key];

                return aAvg - bAvg;
            });

            items.forEach((item, idx) => { rowIndex[item.key] = idx; });
            columns[col] = items;
        }

        // Backward pass
        for (let col = maxCol; col >= 0; col--) {
            const items = columns[col] || [];
            if (items.length <= 1) continue;

            items.sort((a, b) => {
                const aUp = a.deps.filter(d => rowIndex[d] !== undefined);
                const aDown = (dependedOnBy[a.key] || []).filter(d => rowIndex[d] !== undefined);
                const bUp = b.deps.filter(d => rowIndex[d] !== undefined);
                const bDown = (dependedOnBy[b.key] || []).filter(d => rowIndex[d] !== undefined);

                const aAll = [...aUp, ...aDown];
                const bAll = [...bUp, ...bDown];

                const aAvg = aAll.length > 0
                    ? aAll.reduce((s, d) => s + rowIndex[d], 0) / aAll.length
                    : rowIndex[a.key];
                const bAvg = bAll.length > 0
                    ? bAll.reduce((s, d) => s + rowIndex[d], 0) / bAll.length
                    : rowIndex[b.key];

                return aAvg - bAvg;
            });

            items.forEach((item, idx) => { rowIndex[item.key] = idx; });
            columns[col] = items;
        }
    }

    // Layout: x by column, y cumulative (diamonds get extra space for label)
    const PF_DIAMOND_EXTRA = 20;
    const positions = {};
    for (let col = 0; col <= maxCol; col++) {
        const items = columns[col] || [];
        let y = 40;
        for (const item of items) {
            positions[item.key] = {
                x: 40 + col * (PF_NODE_W + PF_H_GAP),
                y: y,
                task: item.task,
                deps: item.deps,
                isCollapsed: item.isCollapsed || false,
                isDiamond: item.isDiamond || false,
                groupId: item.groupId || null
            };
            y += PF_NODE_H + PF_V_GAP;
            if (item.isDiamond) y += PF_DIAMOND_EXTRA;
        }
    }


    // Post-layout: adjust y positions so nodes sit at the average y of their connections
    // This makes e.g. Test sit halfway between Build and Training Materials
    for (let pass = 0; pass < 2; pass++) {
        for (const [key, pos] of Object.entries(positions)) {
            const upstream = pos.deps.map(d => positions[d]).filter(Boolean);
            const downstream = (dependedOnBy[key] || []).map(d => positions[d]).filter(Boolean);
            const connected = [...upstream, ...downstream];
            if (connected.length === 0) continue;

            const avgY = connected.reduce((s, p) => s + p.y, 0) / connected.length;

            // Only move if it doesn't overlap with neighbours in the same column
            const col = Math.round((pos.x - 40) / (PF_NODE_W + PF_H_GAP));
            const sameCol = Object.values(positions).filter(p =>
                p !== pos && Math.round((p.x - 40) / (PF_NODE_W + PF_H_GAP)) === col
            );

            let targetY = avgY;
            // Ensure no overlap with same-column nodes
            for (const other of sameCol) {
                if (Math.abs(targetY - other.y) < PF_NODE_H + PF_V_GAP) {
                    // Too close — nudge away
                    if (targetY < other.y) {
                        targetY = Math.min(targetY, other.y - PF_NODE_H - PF_V_GAP);
                    } else {
                        targetY = Math.max(targetY, other.y + PF_NODE_H + PF_V_GAP);
                    }
                }
            }
            pos.y = targetY;
        }
    }

    // Normalize: shift all positions so minimum y is 40
    let minY = Infinity;
    for (const pos of Object.values(positions)) minY = Math.min(minY, pos.y);
    if (minY < 40) {
        const shift = 40 - minY;
        for (const pos of Object.values(positions)) pos.y += shift;
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
        if (!e.target.closest('.pf-node') && !e.target.closest('.pf-arrow') && pfSelectedArrow) {
            pfGroup.querySelectorAll('.pf-arrow.selected').forEach(el => {
                el.classList.remove('selected');
                el.setAttribute('stroke', '#E8833A');
                el.setAttribute('stroke-width', '2');
            });
            pfSelectedArrow = null;
        }
    });

    // Delete key removes selected arrow
    container.setAttribute('tabindex', '0');
    container.style.outline = 'none';
    container.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && pfSelectedArrow) {
            e.preventDefault();
            pfDeleteSelectedArrow();
        }
    });

    container.addEventListener('mousedown', (e) => {
        if (e.target.closest('.pf-node')) return;
        if (e.target.closest('.pf-connector-out')) return;
        pfIsDragging = true;
        pfDragStartX = e.clientX;
        pfDragStartY = e.clientY;
        pfDragStartPanX = pfPanX;
        pfDragStartPanY = pfPanY;
        container.style.cursor = 'grabbing';
        e.preventDefault();
    });

    const onMove = (e) => {
        if (!pfIsDragging) return;
        pfPanX = pfDragStartPanX + (e.clientX - pfDragStartX);
        pfPanY = pfDragStartPanY + (e.clientY - pfDragStartY);
        pfApplyTransform();
    };
    const onUp = () => {
        if (!pfIsDragging) return;
        pfIsDragging = false;
        container.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };
    container.addEventListener('mousedown', () => {
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function pfApplyTransform() {
    if (pfGroup) pfGroup.setAttribute('transform', `translate(${pfPanX},${pfPanY}) scale(${pfZoom})`);
}

function pfRender(positions, allTasks, topLevelSummaries) {
    if (!pfSvg) return;
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

    // Draw dependency arrows (clickable for deletion)
    pfSelectedArrow = null;
    for (const [key, pos] of Object.entries(positions)) {
        for (const dep of pos.deps) {
            const src = positions[dep];
            if (!src) continue;

            // Route arrows to/from diamond points (right/left tips) instead of rectangle edges
            const srcCy = src.y + PF_NODE_H / 2;
            const dstCy = pos.y + PF_NODE_H / 2;
            let x1, y1, x2, y2;
            if (src.isDiamond && src._diamondCx) {
                x1 = src._diamondCx + src._diamondW; // right tip of diamond
                y1 = srcCy;
            } else {
                x1 = src.x + PF_NODE_W;
                y1 = srcCy;
            }
            if (pos.isDiamond && pos._diamondCx) {
                x2 = pos._diamondCx - pos._diamondW; // left tip of diamond
                y2 = dstCy;
            } else {
                x2 = pos.x;
                y2 = dstCy;
            }
            const midX = (x1 + x2) / 2;
            const d = `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;

            // Visible arrow
            const arrow = pbsCreateSVGElement('path', {
                'd': d, 'fill': 'none', 'stroke': '#E8833A', 'stroke-width': '2',
                'marker-end': 'url(#pf-arrowhead)', 'class': 'pf-arrow',
                'data-source': dep, 'data-target': key
            });

            // Wider invisible hit area for clicking
            const hitArea = pbsCreateSVGElement('path', {
                'd': d, 'fill': 'none', 'stroke': 'transparent', 'stroke-width': '12',
                'style': 'cursor: pointer;'
            });

            const sourceKey = dep;
            const targetKey = key;
            hitArea.addEventListener('click', (e) => {
                e.stopPropagation();
                pfSelectArrow(sourceKey, targetKey, arrow);
            });

            pfGroup.appendChild(arrow);
            pfGroup.appendChild(hitArea);
        }
    }

    // Draw nodes
    let colourIdx = 0;
    for (const [key, pos] of Object.entries(positions)) {
        const task = pos.task;
        const colour = PBS_COLOURS[colourIdx % PBS_COLOURS.length];
        colourIdx++;
        const isCollapsedNode = !!pos.isCollapsed;
        const isDiamondNode = !!pos.isDiamond;

        const g = pbsCreateSVGElement('g', { 'class': 'pf-node', 'style': 'cursor: pointer;' });

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
        rightConn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            pfStartDragConnect(srcKey, rightCx, rightCy, e);
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
}

// ── Product Flow: Drag-to-connect ─────────────────────────────────────

function pfStartDragConnect(sourceKey, startX, startY, e) {
    pfDragConnection = { sourceKey, startX, startY };

    // Create preview bezier line
    pfDragLine = pbsCreateSVGElement('path', {
        'd': `M${startX},${startY} L${startX},${startY}`,
        'fill': 'none', 'stroke': '#4A90D9', 'stroke-width': '2',
        'stroke-dasharray': '6,3', 'pointer-events': 'none'
    });
    pfGroup.appendChild(pfDragLine);

    const container = document.getElementById('productFlowContainer');

    const onMove = (e) => {
        if (!pfDragConnection || !pfDragLine) return;
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
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);

        if (pfDragLine) { pfDragLine.remove(); pfDragLine = null; }

        if (!pfDragConnection) return;

        // Find target at drop position
        const rect = container.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - pfPanX) / pfZoom;
        const mouseY = (e.clientY - rect.top - pfPanY) / pfZoom;
        const target = pfFindNearestInput(mouseX, mouseY);

        if (target && target.key !== pfDragConnection.sourceKey && target.dist < 50) {
            pfCreateDependency(pfDragConnection.sourceKey, target.key);
        }

        // Reset node highlights
        pfGroup.querySelectorAll('.pf-node').forEach(n => n.style.filter = '');

        pfDragConnection = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
    const dependsMatch = line.match(/\[depends\s+([^\]]*)\]/i);
    let newLine;
    if (dependsMatch) {
        // Append to existing [depends ...] block
        const existingDeps = dependsMatch[1].trim();
        const newDeps = existingDeps ? `${existingDeps}, $${sourceId}` : `$${sourceId}`;
        newLine = line.replace(/\[depends\s+[^\]]*\]/i, `[depends ${newDeps}]`);
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
    const dependsMatch = line.match(/\[depends\s+([^\]]*)\]/i);
    if (!dependsMatch) return;

    const deps = dependsMatch[1].split(',').map(d => d.trim()).filter(d => {
        // Remove the dependency that matches $sourceId (with optional type/lag suffixes)
        const stripped = d.replace(/:[A-Z]{2}$/i, '').replace(/\s+[+\-]\d+[dwmy]$/i, '').trim();
        return stripped !== `$${sourceId}`;
    });

    let newLine;
    if (deps.length === 0) {
        // Remove entire [depends ...] block
        newLine = line.replace(/\s*\[depends\s+[^\]]*\]/i, '');
    } else {
        newLine = line.replace(/\[depends\s+[^\]]*\]/i, `[depends ${deps.join(', ')}]`);
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

// ── Duplicate deliverable identifier detection ───────────────────────

function checkDuplicateDeliverables() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const warnings = [];
    const warningLines = new Set();

    // 1. Check for duplicate $identifier tokens
    const idRegex = /\$([A-Za-z_][A-Za-z0-9_-]*)/;
    const seenIds = {};
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(idRegex);
        if (match) {
            const id = match[1].toLowerCase();
            if (!seenIds[id]) seenIds[id] = [];
            seenIds[id].push(i + 1);
        }
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
        // Strip metadata tokens to get just the name
        const nameMatch = taskText.match(/^([^@#!$"{\d\[~][^@#!$"{\[~]*?)(?:\s+[\$@#!"{~\[]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s*$)/);
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

    // Store warning lines globally for the highlight layer to pick up
    window._duplicateWarningLines = warningLines;

    // Apply yellow background highlights to the editor highlight layer
    applyDuplicateHighlights();

    if (typeof setStatusMessage === 'function') {
        if (warnings.length > 0) {
            setStatusMessage('\u26A0 ' + warnings.join(' \u00B7 '), 0);
        } else {
            setStatusMessage('', 0);
        }
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
        const nameMatch = trimmed.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[\$@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
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

function productIdentifierOnInput(el) {
    const pos = el.selectionStart;
    el.value = el.value.replace(/\s/g, '_');
    el.setSelectionRange(pos, pos);
}

let currentProductTask = null;
let currentProductLineNumber = null;
let productFormSaveTimer = null;

function productFindLineNumber(taskName, deliverableId) {
    const editor = document.getElementById('planEditor');
    if (!editor || !taskName) return null;
    const lines = editor.value.split('\n');
    // First pass: match by both name AND $deliverable (most precise)
    if (deliverableId) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('$' + deliverableId)) {
                const trimmed = lines[i].trim().replace(/^\*\s*/, '');
                const nameMatch = trimmed.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[\$@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
                const lineName = nameMatch ? nameMatch[1].trim() : trimmed.split(/\s+/)[0];
                if (lineName === taskName) return i;
            }
        }
    }
    // Fallback: match by name only
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim().replace(/^\*\s*/, '');
        const nameMatch = trimmed.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[\$@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
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

    if (newId) newLine += ` $${newId}`;

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
        .replace(/\[depends\s+[^\]]*\]/i, '')
        .replace(/"[^"]*"/g, '')
        .replace(/\$[A-Za-z_][A-Za-z0-9_-]*/g, '')
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
    const verifyMatch = verifyTrimmed.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[\$@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
    const verifyName = verifyMatch ? verifyMatch[1].trim() : '';
    if (verifyName !== taskName) {
        // Line number is stale — search for the correct line
        let found = false;
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim().replace(/^\*\s*/, '');
            const nm = t.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[\$@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
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
                const nm = t.match(/^([^@#!$"{\d][^@#!$"{]*?)(?:\s+[\$@#!"{]|\s+\d+[dwmy]|\s+\d+%|\s+\d{4}-|\s+\[|\s*$)/);
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

    const dependsMatch = line.match(/\[depends\s+([^\]]*)\]/i);
    if (dependsMatch) {
        const existing = dependsMatch[1].trim();
        lines[lineNum] = line.replace(/\[depends\s+[^\]]*\]/i, `[depends ${existing}, $${delivId}]`);
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
    const dependsMatch = line.match(/\[depends\s+([^\]]*)\]/i);
    if (!dependsMatch) return;

    const deps = dependsMatch[1].split(',').map(d => d.trim()).filter(d => {
        const stripped = d.replace(/:[A-Z]{2}$/i, '').replace(/\s+[+\-]\d+[dwmy]$/i, '').trim();
        return stripped !== `$${delivId}`;
    });

    if (deps.length === 0) {
        lines[lineNum] = line.replace(/\s*\[depends\s+[^\]]*\]/i, '');
    } else {
        lines[lineNum] = line.replace(/\[depends\s+[^\]]*\]/i, `[depends ${deps.join(', ')}]`);
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
    const lines = editor.value.split('\n');

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('$' + deliverable)) continue;

        // Remove any existing @xxx:ROLE for this role code
        let newLine = lines[i].replace(new RegExp('\\s*@\\S+:' + roleCode, 'gi'), '');

        if (person) {
            newLine = newLine.trimEnd() + ' @' + person + ':' + roleCode;
        }

        if (newLine !== lines[i]) {
            lines[i] = newLine;
            editor.value = lines.join('\n');
            if (editor._updateLineNumbers) editor._updateLineNumbers();
            editor.dispatchEvent(new Event('input'));
            setTimeout(() => renderText(), 10);
        }
        break;
    }
}
