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
const PBS_SIBLING_GAP = 20;   // horizontal gap between sibling subtrees
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

    // First level (root's children): horizontal layout
    // Deeper levels: stacked layout
    const useHorizontal = (depth === 0);
    const dual = !useHorizontal && n > PBS_DUAL_THRESHOLD;
    node._dual = dual;
    node._horizontal = useHorizontal;

    const levelGap = useHorizontal ? PBS_ROOT_GAP : PBS_LEVEL_GAP;

    if (useHorizontal) {
        // Children side by side horizontally
        let totalChildrenWidth = 0;
        let maxChildHeight = 0;
        for (const child of node.children) {
            totalChildrenWidth += child.subtreeWidth;
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
        // Single column to the right of the bus
        const stackH = node.children.reduce((s, c) => s + c.subtreeHeight, 0) + (n - 1) * PBS_STACK_GAP;
        const maxChildW = Math.max(...node.children.map(c => c.subtreeWidth));
        const rightExtent = node.width / 2 + PBS_BUS_OFFSET + maxChildW;
        node.subtreeWidth = Math.max(node.width, rightExtent);
        node.subtreeHeight = node.height + levelGap + stackH;
    }
}

function pbsLayoutTree(node, x, y) {
    if (node.children.length === 0 || node._horizontal || node._dual) {
        node.x = x + (node.subtreeWidth - node.width) / 2;
    } else {
        // Stacked single column: offset parent left so bus + children fit
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
        // Horizontal layout: children side by side
        let childX = x;
        for (const child of node.children) {
            child._colSide = 'centre';
            pbsLayoutTree(child, childX, childrenTop);
            childX += child.subtreeWidth + PBS_SIBLING_GAP;
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
        const childLeft = child.x;
        const childMidY = child.y + child.height / 2;
        pbsGroup.appendChild(pbsCreateSVGElement('path', {
            'd': `M${parentCx},${parentBottom} L${parentCx},${childMidY} L${childLeft},${childMidY}`,
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
        for (const child of leftChildren) {
            const cy = child.y + child.height / 2;
            pbsGroup.appendChild(pbsCreateSVGElement('line', {
                'x1': child.x + child.width, 'y1': cy, 'x2': parentCx, 'y2': cy, ...strokeAttrs
            }));
        }
        for (const child of rightChildren) {
            const cy = child.y + child.height / 2;
            pbsGroup.appendChild(pbsCreateSVGElement('line', {
                'x1': parentCx, 'y1': cy, 'x2': child.x, 'y2': cy, ...strokeAttrs
            }));
        }
    } else {
        // Single column to the right: vertical bus + horizontal stubs
        const lastChild = node.children[node.children.length - 1];
        const lastCy = lastChild.y + lastChild.height / 2;

        pbsGroup.appendChild(pbsCreateSVGElement('line', {
            'x1': parentCx, 'y1': parentBottom, 'x2': parentCx, 'y2': lastCy, ...strokeAttrs
        }));
        for (const child of node.children) {
            const cy = child.y + child.height / 2;
            pbsGroup.appendChild(pbsCreateSVGElement('line', {
                'x1': parentCx, 'y1': cy, 'x2': child.x, 'y2': cy, ...strokeAttrs
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
    const colour = isRoot ? '#4A90D9' : (depth === 1 ? nextColour() : (parentColour ? pbsShadeColour(parentColour, 1.3) : '#4A90D9'));

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

function updateDeliverablesMatrix(tasks, projectName) {
    const container = document.getElementById('deliverablesMatrixBody');
    const placeholder = document.querySelector('#deliverables-view .deliverables-placeholder');
    const content = document.querySelector('#deliverables-view .deliverables-content');

    if (!container) return;

    const deliverables = pbsExtractDeliverables(tasks || []);

    if (deliverables.length === 0) {
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    container.innerHTML = '';

    for (const task of deliverables) {
        const activities = pbsGetActivities(task, tasks);
        const resources = pbsGetResources(task, tasks);
        const rollup = pbsComputeRollup(task, tasks);
        const pct = rollup.percent;

        // Find product dependencies
        const deps = [];
        if (task.depends) {
            for (const depName of task.depends) {
                const depTask = deliverables.find(d => d.name === depName || d.description === depName);
                if (depTask) {
                    deps.push(`$${depTask.deliverable}`);
                }
            }
        }

        let status = 'Not Started';
        let statusClass = 'status-not-started';
        if (pct === 100) {
            status = 'Complete';
            statusClass = 'status-complete';
        } else if (pct > 0) {
            status = 'In Progress';
            statusClass = 'status-in-progress';
        }

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => {
            if (typeof openProductForm === 'function') openProductForm(task);
        });

        const escapedName = (task.name || task.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escapedActivities = activities.length > 0
            ? activities.map(a => (a.description || a.name).replace(/</g, '&lt;').replace(/>/g, '&gt;')).join(', ')
            : '\u2014';

        tr.innerHTML = `
            <td class="deliverable-id"><code>$${task.deliverable}</code></td>
            <td class="deliverable-name">${escapedName}</td>
            <td class="deliverable-activities" title="${escapedActivities}">${escapedActivities}</td>
            <td class="deliverable-resources">${resources.length > 0 ? resources.join(', ') : '\u2014'}</td>
            <td class="deliverable-deps">${deps.length > 0 ? deps.join(', ') : '\u2014'}</td>
            <td class="deliverable-dates">${task.start || '\u2014'} \u2192 ${task.finish || '\u2014'}</td>
            <td class="deliverable-status"><span class="deliverable-status-badge ${statusClass}">${status}</span></td>
            <td class="deliverable-progress">
                <div class="deliverable-progress-bar">
                    <div class="deliverable-progress-fill" style="width: ${pct}%"></div>
                </div>
                <span class="deliverable-progress-text">${pct}%</span>
            </td>
        `;
        container.appendChild(tr);
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
let pfCollapsedGroups = new Set(); // collapsed top-level summary IDs
let pfLastPositions = null;
let pfLastAllTasks = null;
let pfLastSummaries = null;

const PF_NODE_W = 180;
const PF_NODE_H = 44;
const PF_H_GAP = 60;
const PF_V_GAP = 15;

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

    // Identify top-level summary deliverables (those with child deliverables)
    // These become bounding boxes, not flow nodes.
    const childDeliverableParents = new Set();
    for (const d of deliverables) {
        if (d.parent) {
            const parentDel = deliverables.find(
                p => (p.name === d.parent || p.description === d.parent) && p.deliverable
            );
            if (parentDel) {
                childDeliverableParents.add(parentDel.deliverable);
            }
        }
    }

    // Top-level summaries = deliverables that have child deliverables
    // and whose own parent is NOT a deliverable (first level only)
    const topLevelSummaries = {};
    const hiddenSummaries = new Set();
    for (const id of childDeliverableParents) {
        const d = deliverables.find(dd => dd.deliverable === id);
        if (!d) continue;
        // Check if this summary's parent is also a deliverable
        const parentIsDel = d.parent && deliverables.some(
            p => (p.name === d.parent || p.description === d.parent) && p.deliverable
        );
        if (!parentIsDel) {
            // Top-level summary — show as bounding box
            topLevelSummaries[id] = { task: d, children: [] };
        } else {
            // Deeper summary — hide entirely
            hiddenSummaries.add(id);
        }
    }

    // Build child lists for top-level summaries — walk full descendant tree
    // to find all leaf deliverables under each top-level summary
    function findAncestorSummary(d) {
        // Walk up the parent chain to find which top-level summary this belongs to
        let current = d;
        while (current && current.parent) {
            const parentDel = deliverables.find(
                p => (p.name === current.parent || p.description === current.parent) && p.deliverable
            );
            if (!parentDel) break;
            if (topLevelSummaries[parentDel.deliverable]) return parentDel.deliverable;
            current = parentDel;
        }
        return null;
    }

    for (const d of deliverables) {
        // Only add leaf deliverables (not summaries) to bounding box children
        if (childDeliverableParents.has(d.deliverable)) continue;
        if (hiddenSummaries.has(d.deliverable)) continue;

        const ancestorId = findAncestorSummary(d);
        if (ancestorId && topLevelSummaries[ancestorId]) {
            topLevelSummaries[ancestorId].children.push(d.deliverable);
        }
    }

    // Leaf deliverables = not a summary (no child deliverables) and not hidden
    const leafDeliverables = deliverables.filter(
        d => !childDeliverableParents.has(d.deliverable) && !hiddenSummaries.has(d.deliverable)
    );

    // Build a set of children belonging to each collapsed group
    const collapsedChildren = new Set();
    for (const [id, summary] of Object.entries(topLevelSummaries)) {
        if (pfCollapsedGroups.has(id)) {
            summary.children.forEach(cid => collapsedChildren.add(cid));
        }
    }

    // Build the flow graph: leaf nodes + collapsed group placeholders
    const nodes = {};

    // Add leaf nodes that are NOT inside a collapsed group
    for (const d of leafDeliverables) {
        if (collapsedChildren.has(d.deliverable)) continue;
        nodes[d.deliverable] = { task: d, deps: [], column: 0 };
    }

    // Add collapsed group placeholders as single nodes
    for (const [id, summary] of Object.entries(topLevelSummaries)) {
        if (!pfCollapsedGroups.has(id)) continue;
        const placeholderId = '_collapsed_' + id;
        nodes[placeholderId] = {
            task: summary.task, deps: [], column: 0,
            isCollapsed: true, groupId: id, childIds: summary.children
        };
    }

    // Helper: resolve a deliverable ID to its flow node key
    // (a leaf's own key, or its collapsed group's placeholder key)
    function resolveFlowKey(delId) {
        if (nodes[delId]) return delId;
        // Check if this deliverable belongs to a collapsed group
        for (const [id, summary] of Object.entries(topLevelSummaries)) {
            if (pfCollapsedGroups.has(id) && summary.children.includes(delId)) {
                return '_collapsed_' + id;
            }
        }
        return null;
    }

    // Build dependency edges — for leaf nodes
    for (const d of leafDeliverables) {
        if (collapsedChildren.has(d.deliverable)) continue;
        if (d.depends) {
            for (const depName of d.depends) {
                const depTask = deliverables.find(dt => dt.name === depName || dt.description === depName);
                if (depTask) {
                    const flowKey = resolveFlowKey(depTask.deliverable);
                    if (flowKey && flowKey !== d.deliverable && !nodes[d.deliverable].deps.includes(flowKey)) {
                        nodes[d.deliverable].deps.push(flowKey);
                    }
                }
            }
        }
        // Inherit parent dependencies
        if (d.parent) {
            const parentDel = deliverables.find(
                p => (p.name === d.parent || p.description === d.parent) && p.deliverable
            );
            if (parentDel && parentDel.depends) {
                for (const depName of parentDel.depends) {
                    const depTask = deliverables.find(dt => dt.name === depName || dt.description === depName);
                    if (depTask) {
                        const flowKey = resolveFlowKey(depTask.deliverable);
                        if (flowKey && flowKey !== d.deliverable && !nodes[d.deliverable].deps.includes(flowKey)) {
                            nodes[d.deliverable].deps.push(flowKey);
                        }
                    }
                }
            }
        }
    }

    // Build dependency edges for collapsed group placeholders
    for (const [id, summary] of Object.entries(topLevelSummaries)) {
        if (!pfCollapsedGroups.has(id)) continue;
        const placeholderId = '_collapsed_' + id;

        // Aggregate deps from all children in this group + the summary itself
        const allGroupDels = [summary.task, ...summary.children.map(
            cid => deliverables.find(dd => dd.deliverable === cid)
        ).filter(Boolean)];

        for (const d of allGroupDels) {
            if (d.depends) {
                for (const depName of d.depends) {
                    const depTask = deliverables.find(dt => dt.name === depName || dt.description === depName);
                    if (depTask) {
                        const flowKey = resolveFlowKey(depTask.deliverable);
                        if (flowKey && flowKey !== placeholderId && !nodes[placeholderId].deps.includes(flowKey)) {
                            nodes[placeholderId].deps.push(flowKey);
                        }
                    }
                }
            }
        }

        // Also find nodes that depend on children in this group (output connections)
        for (const [nodeKey, node] of Object.entries(nodes)) {
            if (nodeKey === placeholderId) continue;
            // Check if any of this node's deps reference children in the collapsed group
            const newDeps = [];
            for (const dep of node.deps) {
                if (dep === placeholderId) {
                    newDeps.push(dep);
                } else {
                    newDeps.push(dep);
                }
            }
            // Check if this node's original task depends on anything in the collapsed group
            const nodeTask = node.task;
            if (nodeTask && nodeTask.depends) {
                for (const depName of nodeTask.depends) {
                    const depTask = deliverables.find(dt => dt.name === depName || dt.description === depName);
                    if (depTask && summary.children.includes(depTask.deliverable)) {
                        if (!node.deps.includes(placeholderId)) {
                            node.deps.push(placeholderId);
                        }
                    }
                }
            }
        }
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

    // Group by column
    const columns = {};
    for (const [key, node] of Object.entries(nodes)) {
        if (!columns[node.column]) columns[node.column] = [];
        columns[node.column].push({ key, ...node });
    }

    // Layout: x by column, y by row within column
    const positions = {};
    const maxCol = Object.keys(columns).length > 0 ? Math.max(...Object.keys(columns).map(Number)) : 0;
    for (let col = 0; col <= maxCol; col++) {
        const items = columns[col] || [];
        items.forEach((item, row) => {
            positions[item.key] = {
                x: 40 + col * (PF_NODE_W + PF_H_GAP),
                y: 40 + row * (PF_NODE_H + PF_V_GAP),
                task: item.task,
                deps: item.deps,
                isCollapsed: item.isCollapsed || false,
                groupId: item.groupId || null
            };
        });
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

    container.addEventListener('mousedown', (e) => {
        if (e.target.closest('.pf-node')) return;
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

    // Draw bounding boxes for expanded top-level summaries
    const pad = 12;
    if (topLevelSummaries) {
        let boxIdx = 0;
        for (const [id, summary] of Object.entries(topLevelSummaries)) {
            const colour = PBS_COLOURS[boxIdx % PBS_COLOURS.length];
            boxIdx++;

            if (pfCollapsedGroups.has(id)) continue;

            const childPositions = summary.children
                .map(cid => positions[cid])
                .filter(Boolean);
            if (childPositions.length === 0) continue;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const cp of childPositions) {
                minX = Math.min(minX, cp.x);
                minY = Math.min(minY, cp.y);
                maxX = Math.max(maxX, cp.x + PF_NODE_W);
                maxY = Math.max(maxY, cp.y + PF_NODE_H);
            }

            // Background box
            pfGroup.appendChild(pbsCreateSVGElement('rect', {
                'x': minX - pad, 'y': minY - pad - 20,
                'width': maxX - minX + pad * 2, 'height': maxY - minY + pad * 2 + 20,
                'rx': '8', 'ry': '8',
                'fill': 'none',
                'stroke': colour, 'stroke-width': '1.5',
                'stroke-dasharray': '6,3',
                'opacity': '0.5'
            }));

            // Label with disclosure triangle (expanded = down arrow)
            const labelG = pbsCreateSVGElement('g', { 'style': 'cursor: pointer;' });
            labelG.addEventListener('click', (e) => {
                e.stopPropagation();
                pfToggleGroup(id);
            });

            const triX = minX - pad + 6;
            const triY = minY - pad - 10;
            labelG.appendChild(pbsCreateSVGElement('polygon', {
                'points': `${triX},${triY - 4} ${triX + 8},${triY - 4} ${triX + 4},${triY + 4}`,
                'fill': colour, 'opacity': '0.7'
            }));
            const labelEl = pbsCreateSVGElement('text', {
                'x': triX + 14, 'y': minY - pad - 4,
                'fill': colour, 'font-size': '11', 'font-weight': 'bold', 'opacity': '0.7',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            });
            labelEl.textContent = summary.task.name || id;
            labelG.appendChild(labelEl);

            const tip = pbsCreateSVGElement('title', {});
            tip.textContent = 'Click to collapse';
            labelG.appendChild(tip);
            pfGroup.appendChild(labelG);
        }
    }

    // Draw dependency arrows
    for (const [key, pos] of Object.entries(positions)) {
        for (const dep of pos.deps) {
            const src = positions[dep];
            if (!src) continue;
            const x1 = src.x + PF_NODE_W;
            const y1 = src.y + PF_NODE_H / 2;
            const x2 = pos.x;
            const y2 = pos.y + PF_NODE_H / 2;
            const midX = (x1 + x2) / 2;
            pfGroup.appendChild(pbsCreateSVGElement('path', {
                'd': `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`,
                'fill': 'none', 'stroke': '#E8833A', 'stroke-width': '2',
                'marker-end': 'url(#pf-arrowhead)'
            }));
        }
    }

    // Draw nodes
    let colourIdx = 0;
    for (const [key, pos] of Object.entries(positions)) {
        const task = pos.task;
        const colour = PBS_COLOURS[colourIdx % PBS_COLOURS.length];
        colourIdx++;
        const isCollapsedNode = !!pos.isCollapsed;

        const g = pbsCreateSVGElement('g', { 'class': 'pf-node', 'style': 'cursor: pointer;' });

        if (isCollapsedNode) {
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

        pfGroup.appendChild(g);
    }
}

function pfToggleGroup(groupId) {
    if (pfCollapsedGroups.has(groupId)) {
        pfCollapsedGroups.delete(groupId);
    } else {
        pfCollapsedGroups.add(groupId);
    }
    // Re-run the full flow to recalculate layout
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
    const idRegex = /\$([A-Za-z_][A-Za-z0-9_-]*)/;
    const seen = {}; // id → [line numbers]

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(idRegex);
        if (match) {
            const id = match[1].toLowerCase();
            if (!seen[id]) seen[id] = [];
            seen[id].push(i + 1); // 1-based line numbers
        }
    }

    const duplicates = [];
    const duplicateLines = new Set();
    for (const [id, lineNums] of Object.entries(seen)) {
        if (lineNums.length > 1) {
            duplicates.push(`$${id} (lines ${lineNums.join(', ')})`);
            lineNums.forEach(ln => duplicateLines.add(ln));
        }
    }

    // Clear previous duplicate indicators
    document.querySelectorAll('.line-number.duplicate-id').forEach(el => {
        el.classList.remove('duplicate-id');
        el.title = '';
    });

    // Add yellow dot to duplicate lines
    if (duplicateLines.size > 0) {
        duplicateLines.forEach(ln => {
            const el = document.querySelector(`.line-number[data-line-number="${ln}"]`);
            if (el) {
                el.classList.add('duplicate-id');
                el.title = 'Duplicate deliverable identifier';
            }
        });
    }

    if (duplicates.length > 0 && typeof setStatusMessage === 'function') {
        setStatusMessage('\u26A0 Duplicate deliverable IDs: ' + duplicates.join('; '), 0);
    }
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
    currentProductTask = task;
    currentProductLineNumber = productFindLineNumber(task.name, task.deliverable);

    openDetailPane('productFormSection');

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

    // Composition (child tasks)
    const compEl = document.getElementById('productComposition');
    if (compEl) {
        const activities = pbsGetActivities(task, pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []));
        if (activities.length === 0) {
            compEl.innerHTML = '<span>No child tasks</span>';
        } else {
            compEl.innerHTML = activities.map(a => {
                const pct = parseFloat(a.percent) || 0;
                const name = (a.description || a.name || '').replace(/</g, '&lt;');
                return `<div class="product-comp-item">
                    <span class="product-comp-name">${name}</span>
                    <span class="product-comp-pct">${pct}%</span>
                </div>`;
            }).join('');
        }
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

    // Dependencies
    const depsEl = document.getElementById('productDependencies');
    if (depsEl) {
        const depTokens = [];
        if (task.depends) {
            const allTasks = pbsTasks.length > 0 ? pbsTasks : (lastRenderedTasks || []);
            const deliverables = pbsExtractDeliverables(allTasks);
            for (const depName of task.depends) {
                const depTask = deliverables.find(d => d.name === depName || d.description === depName);
                if (depTask) depTokens.push(`$${depTask.deliverable}`);
            }
        }
        depsEl.value = depTokens.join(', ');
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
    if (typeof closeDetailPane === 'function') closeDetailPane();
    currentProductTask = null;
}

function saveProductForm() {
    if (!currentProductTask || currentProductLineNumber === null) return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const originalLine = lines[currentProductLineNumber];
    if (originalLine === undefined) return;

    // Safety: verify this line contains the expected $deliverable token
    // to prevent writing to the wrong line after re-renders shift line numbers
    if (currentProductTask.deliverable && !originalLine.includes('$' + currentProductTask.deliverable)) {
        // Line number is stale — try to re-find it
        currentProductLineNumber = productFindLineNumber(currentProductTask.name, currentProductTask.deliverable);
        if (currentProductLineNumber === null) return;
        const refreshedLine = lines[currentProductLineNumber];
        if (!refreshedLine || !refreshedLine.includes('$' + currentProductTask.deliverable)) return;
    }

    const newTitle = (document.getElementById('productTitle').value || '').trim();
    const newId = (document.getElementById('productIdentifier').value || '').trim();
    const newPurpose = (document.getElementById('productPurpose').value || '').trim();
    const newDeps = (document.getElementById('productDependencies').value || '').trim();

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
