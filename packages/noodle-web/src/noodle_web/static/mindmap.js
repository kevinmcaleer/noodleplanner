/**
 * Mind Map View Implementation
 * Provides a visual mind map of the project plan structure.
 * Summary tasks become parent nodes; leaf tasks become child nodes.
 * Uses SVG for rendering with elastic animations and keyboard navigation.
 */

// ── Global state ──────────────────────────────────────────────────────
let mindmapTasks = [];
let mindmapTree = null;          // root node of the tree we build
let mindmapSvg = null;           // <svg> element
let mindmapGroup = null;         // <g> element (pan/zoom target)
let mindmapZoom = 1;
let mindmapPanX = 0;
let mindmapPanY = 0;
let mindmapSelectedNode = null;  // currently-selected tree node
let mindmapNodeElements = [];    // flat list of {node, gEl} for tab navigation
let mindmapIsDragging = false;
let mindmapDragStartX = 0;
let mindmapDragStartY = 0;
let mindmapDragStartPanX = 0;
let mindmapDragStartPanY = 0;
let mindmapCollapsedIds = new Set();  // set of node IDs that are collapsed
let mindmapTheme = 'dark';       // 'dark' or 'light'
let mindmapBranchColours = {};   // { branchNodeName: '#HEX' } persisted in localStorage
let mindmapThemeColours = {};    // Theme colours from front matter (shared with kanban)

// Layout constants
const MM_H_GAP = 180;           // horizontal gap between levels
const MM_V_GAP = 14;            // vertical gap between sibling nodes
const MM_NODE_HEIGHT = 36;      // height of a node box
const MM_NODE_PADDING_X = 16;   // horizontal padding inside a node box
const MM_NODE_MIN_WIDTH = 80;
const MM_NODE_MAX_WIDTH = 220;
const MM_ROOT_RADIUS = 0;       // extra space around root
const MM_ANIM_DURATION = 400;   // ms for elastic animation
const MM_COLLAPSE_TRI_SIZE = 6; // disclosure triangle size

// Default subtle branch colours — each top-level branch gets one of these
const MM_BRANCH_COLOURS = [
    '#4A90D9', '#D97B4A', '#5CB85C', '#D95B5B',
    '#9B6BBF', '#3DBFA8', '#D9A84A', '#5B8FD9',
    '#4ABF7F', '#D9534F', '#D9B84A', '#8E5BBF'
];

// Lighter shades for child nodes (derived from branch colour at render time)
// Legacy fallback — still used if nothing else applies
const MM_COLOURS = [
    '#108BB9', '#E8833A', '#5CB85C', '#D9534F',
    '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB',
    '#2ECC71', '#E74C3C', '#F39C12', '#8E44AD'
];

// ── Branch colour helpers ────────────────────────────────────────────

/**
 * Get the localStorage key for branch colours (scoped to current project).
 */
function mindmapBranchColourKey() {
    const projectId = (typeof getCurrentProjectId === 'function') ? getCurrentProjectId() : 'default';
    return 'mindmap_branch_colours_' + projectId;
}

/**
 * Load user-chosen branch colours from localStorage.
 */
function mindmapLoadBranchColours() {
    try {
        const raw = localStorage.getItem(mindmapBranchColourKey());
        mindmapBranchColours = raw ? JSON.parse(raw) : {};
    } catch (e) {
        mindmapBranchColours = {};
    }
}

/**
 * Save user-chosen branch colours to localStorage.
 */
function mindmapSaveBranchColours() {
    try {
        localStorage.setItem(mindmapBranchColourKey(), JSON.stringify(mindmapBranchColours));
    } catch (e) {
        // Silently fail if localStorage is full
    }
}

/**
 * Parse theme colours from front matter (same format as kanban uses).
 * Format: Theme:\n- Phase Name: #HEX\n
 */
function mindmapParseThemeColours() {
    mindmapThemeColours = {};
    if (typeof extractFrontMatterSection !== 'function') return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const section = extractFrontMatterSection(editor.value, 'Theme');
    if (!section) return;

    const lines = section.split('\n');
    for (const line of lines) {
        const match = line.match(/^-\s+(.+?):\s*(#[0-9A-Fa-f]{6})\s*$/);
        if (match) {
            mindmapThemeColours[match[1].trim()] = match[2].toUpperCase();
        }
    }
}

/**
 * Given a hex colour, produce a lighter or darker shade.
 * factor < 1 = darker, factor > 1 = lighter (blended towards white)
 */
function mindmapShadeColour(hex, factor) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    if (factor > 1) {
        // Blend towards white
        const blend = factor - 1; // 0 to ~1
        r = Math.round(r + (255 - r) * Math.min(blend, 1));
        g = Math.round(g + (255 - g) * Math.min(blend, 1));
        b = Math.round(b + (255 - b) * Math.min(blend, 1));
    } else {
        r = Math.round(r * factor);
        g = Math.round(g * factor);
        b = Math.round(b * factor);
    }

    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));

    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Determine the colour for a node based on its branch.
 * Priority:
 *   1. Theme colour from front matter (matches kanban board colours)
 *   2. User-selected branch colour (from colour picker, stored in localStorage)
 *   3. Default branch colour from MM_BRANCH_COLOURS palette
 * Child nodes get a progressively lighter shade of their branch colour.
 */
function mindmapGetBranchColour(node, depth) {
    if (!mindmapTree) return MM_COLOURS[0];

    // Root node gets a neutral colour
    if (node._isRoot) return '#108BB9';

    // Find the top-level branch ancestor of this node
    const branchNode = mindmapFindBranchAncestor(node);
    if (!branchNode) return MM_COLOURS[depth % MM_COLOURS.length];

    const branchName = branchNode.name;
    const branchIndex = mindmapTree.children.indexOf(branchNode);

    // Determine base colour for this branch (priority order)
    let baseColour = null;

    // 1. Theme colour from front matter (kanban board colours)
    if (mindmapThemeColours[branchName]) {
        baseColour = mindmapThemeColours[branchName];
    }

    // 2. User-selected branch colour (localStorage)
    if (!baseColour && mindmapBranchColours[branchName]) {
        baseColour = mindmapBranchColours[branchName];
    }

    // 3. Default palette colour
    if (!baseColour) {
        baseColour = MM_BRANCH_COLOURS[branchIndex % MM_BRANCH_COLOURS.length];
    }

    // For the branch node itself, return the base colour
    if (node === branchNode) return baseColour;

    // For child nodes, lighten progressively based on depth within the branch
    // depth 1 = branch node, depth 2 = first child, etc.
    const branchDepth = depth - 1; // depth relative to branch root
    const shadeFactor = 1 + branchDepth * 0.25; // lighten by 25% per level
    return mindmapShadeColour(baseColour, Math.min(shadeFactor, 1.75));
}

/**
 * Find the top-level branch ancestor of a node (direct child of root).
 */
function mindmapFindBranchAncestor(node) {
    if (!mindmapTree || !mindmapTree.children) return null;

    // If this node is a direct child of root, it IS the branch
    if (mindmapTree.children.includes(node)) return node;

    // Walk up the tree to find the branch ancestor
    for (const branch of mindmapTree.children) {
        if (mindmapIsDescendant(branch, node)) return branch;
    }
    return null;
}

/**
 * Check if target is a descendant of ancestor.
 */
function mindmapIsDescendant(ancestor, target) {
    for (const child of ancestor.children) {
        if (child === target) return true;
        if (mindmapIsDescendant(child, target)) return true;
    }
    return false;
}

// ── Tree building ─────────────────────────────────────────────────────

/**
 * Build a tree structure from the flat tasks array returned by /api/parse.
 * Each task has `level` (0-based indent depth) and `is_summary`.
 */
function mindmapBuildTree(tasks, projectName) {
    if (!tasks || tasks.length === 0) return null;

    // Virtual root that holds top-level nodes
    const root = {
        id: 0,
        name: '',
        children: [],
        level: -1,
        is_summary: true,
        _task: null
    };

    // Use a stack to track the current parent at each level
    const stack = [root];

    for (const task of tasks) {
        const node = {
            id: task.id,
            name: task.name || `Task ${task.id}`,
            children: [],
            level: task.level || 0,
            is_summary: !!task.is_summary,
            percent: task.percent || '',
            _task: task,
            // Layout fields (filled later)
            x: 0,
            y: 0,
            width: 0,
            height: MM_NODE_HEIGHT,
            subtreeHeight: 0
        };

        // Pop the stack until we find the correct parent
        // Parent is the last node on the stack whose level < this node's level
        while (stack.length > 1 && stack[stack.length - 1].level >= node.level) {
            stack.pop();
        }

        stack[stack.length - 1].children.push(node);

        // If this is a summary task (or any task), it can be a parent
        stack.push(node);
    }

    // If only one top-level child, promote it to root to avoid an empty root label
    if (root.children.length === 1) {
        const single = root.children[0];
        single._isRoot = true;
        return single;
    }

    // Use project name as root label
    root.name = projectName || 'Project';
    root._isRoot = true;
    return root;
}

// ── Layout algorithm ──────────────────────────────────────────────────

/**
 * Measure text width using a hidden canvas context (cached).
 */
let _mmMeasureCtx = null;
function mindmapMeasureText(text) {
    if (!_mmMeasureCtx) {
        const canvas = document.createElement('canvas');
        _mmMeasureCtx = canvas.getContext('2d');
        _mmMeasureCtx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    }
    return _mmMeasureCtx.measureText(text).width;
}

/**
 * Get the visible children of a node (respects collapsed state).
 */
function mindmapVisibleChildren(node) {
    if (mindmapCollapsedIds.has(node.id) && node.children.length > 0) {
        return [];
    }
    return node.children;
}

/**
 * Recursively calculate the width and subtreeHeight for every node.
 */
function mindmapMeasure(node) {
    // Add extra width for the disclosure triangle on nodes with children
    const triExtra = node.children.length > 0 ? (MM_COLLAPSE_TRI_SIZE * 2 + 6) : 0;
    // Add extra width for completed tick icon (green circle with checkmark)
    const pct = parseInt(node.percent, 10);
    const tickExtra = (pct === 100) ? 18 : 0;
    const textW = mindmapMeasureText(node.name);
    node.width = Math.min(MM_NODE_MAX_WIDTH + triExtra + tickExtra, Math.max(MM_NODE_MIN_WIDTH, textW + MM_NODE_PADDING_X * 2 + 8 + triExtra + tickExtra));

    const visChildren = mindmapVisibleChildren(node);

    if (visChildren.length === 0) {
        node.subtreeHeight = node.height;
        return;
    }

    let totalChildrenHeight = 0;
    for (const child of visChildren) {
        mindmapMeasure(child);
        totalChildrenHeight += child.subtreeHeight;
    }
    totalChildrenHeight += (visChildren.length - 1) * MM_V_GAP;
    node.subtreeHeight = Math.max(node.height, totalChildrenHeight);
}

/**
 * Layout the tree with clockwise rotation from the centre.
 * The first item at the top of the plan appears at 3 o'clock (right),
 * then subsequent items fan clockwise: bottom-right, bottom, bottom-left,
 * left, top-left, top, top-right.
 *
 * Children are placed radially around the root to achieve the clockwise effect,
 * but then each sub-branch uses the traditional left-to-right or right-to-left
 * tree layout depending on which side of the root the branch falls on.
 */
function mindmapLayout(root) {
    mindmapMeasure(root);

    root.x = 0;
    root.y = 0;

    const visChildren = mindmapVisibleChildren(root);
    if (visChildren.length === 0) return;

    const n = visChildren.length;

    // Assign each child to an angular position clockwise starting from the right (0 deg).
    // First child is at the top of the plan -> right side (angle 0),
    // then clockwise means increasing angle: right -> bottom -> left -> top.
    // We distribute children evenly over 360 degrees.
    const rightChildren = [];
    const leftChildren = [];

    for (let i = 0; i < n; i++) {
        // Angle in radians, starting at -PI/2 (top) but we want to start at 0 (right)
        // and go clockwise. In SVG, positive Y is down, so clockwise from right means:
        // angle 0 = right, PI/2 = down, PI = left, 3PI/2 = up
        const angle = (2 * Math.PI * i) / n;
        const child = visChildren[i];
        child._angle = angle;

        // Classify children as left or right based on their angular position.
        // Right side: angle <= PI/2 (right + bottom-right) or angle > 3PI/2 (top-right)
        // Left side: PI/2 < angle <= 3PI/2
        if (angle <= Math.PI / 2 || angle > 3 * Math.PI / 2) {
            child._direction = 'right';
            rightChildren.push(child);
        } else {
            child._direction = 'left';
            leftChildren.push(child);
        }
    }

    // Sort right children by angle (ascending) so they appear top-to-bottom on the right side
    rightChildren.sort((a, b) => {
        // Normalize angles so that angles > 3PI/2 (near 2PI) come before angles near 0
        // This maps: 3PI/2..2PI -> -PI/2..0, and 0..PI/2 -> 0..PI/2
        const normA = a._angle > 3 * Math.PI / 2 ? a._angle - 2 * Math.PI : a._angle;
        const normB = b._angle > 3 * Math.PI / 2 ? b._angle - 2 * Math.PI : b._angle;
        return normA - normB;
    });

    // Sort left children by angle (ascending) so they appear top-to-bottom on the left side
    // Left children go from PI/2 (top) to 3PI/2 (bottom) — but in the left layout,
    // we want them visually top-to-bottom, which means reverse order of angle
    // (PI = horizontal left, items with angle closer to PI/2 are above, closer to 3PI/2 are below)
    leftChildren.sort((a, b) => a._angle - b._angle);

    // Layout right side children as a vertical branch to the right
    mindmapLayoutBranch(root, rightChildren, 'right');

    // Layout left side children as a vertical branch to the left
    mindmapLayoutBranch(root, leftChildren, 'left');
}

function mindmapLayoutBranch(parent, children, direction) {
    if (children.length === 0) return;

    const sign = direction === 'right' ? 1 : -1;
    const offsetX = sign * (parent.width / 2 + MM_H_GAP);

    // Total height of all children subtrees with gaps
    let totalH = 0;
    for (const child of children) {
        totalH += child.subtreeHeight;
    }
    totalH += (children.length - 1) * MM_V_GAP;

    let currentY = parent.y - totalH / 2;

    for (const child of children) {
        child.x = parent.x + offsetX;
        child.y = currentY + child.subtreeHeight / 2;
        child._direction = direction;
        currentY += child.subtreeHeight + MM_V_GAP;

        // Recursively layout visible grandchildren (always same direction)
        const visGrandchildren = mindmapVisibleChildren(child);
        if (visGrandchildren.length > 0) {
            mindmapLayoutBranch(child, visGrandchildren, direction);
        }
    }
}

// ── Theme support ─────────────────────────────────────────────────────

/**
 * Read a CSS custom property value from the #mindmap-view element.
 * Falls back to the provided default if the property is not set.
 */
function mindmapCSSVar(name, fallback) {
    const el = document.getElementById('mindmap-view');
    if (!el) return fallback || '';
    const val = getComputedStyle(el).getPropertyValue(name).trim();
    return val || fallback || '';
}

/**
 * Toggle between light and dark themes for the mindmap.
 */
function mindmapToggleTheme() {
    const view = document.getElementById('mindmap-view');
    if (!view) return;

    if (mindmapTheme === 'dark') {
        mindmapTheme = 'light';
        view.classList.add('mindmap-light');
    } else {
        mindmapTheme = 'dark';
        view.classList.remove('mindmap-light');
    }

    localStorage.setItem('mindmapTheme', mindmapTheme);

    // Re-render the SVG nodes to pick up new colours
    if (mindmapTree) {
        mindmapRender();
    }
}

/**
 * Restore the saved theme preference on load.
 */
function mindmapRestoreTheme() {
    const saved = localStorage.getItem('mindmapTheme');
    if (saved === 'light' || saved === 'dark') {
        mindmapTheme = saved;
    }

    const view = document.getElementById('mindmap-view');
    if (view && mindmapTheme === 'light') {
        view.classList.add('mindmap-light');
    }
}

// ── SVG rendering ─────────────────────────────────────────────────────

function mindmapColour(node, depth) {
    return mindmapGetBranchColour(node, depth);
}

/**
 * Render the mind map tree into the SVG.
 */
function mindmapRender() {
    if (!mindmapTree || !mindmapSvg) return;

    // Clear existing content
    while (mindmapGroup.firstChild) {
        mindmapGroup.removeChild(mindmapGroup.firstChild);
    }

    mindmapNodeElements = [];

    // Draw links first (so they're behind nodes)
    mindmapDrawLinks(mindmapTree, 0);

    // Draw nodes
    mindmapDrawNodes(mindmapTree, 0);

    // Apply transform
    mindmapApplyTransform(false);
}

/**
 * Recursively draw curved links between parent and visible children.
 */
function mindmapDrawLinks(node, depth) {
    const linkOpacity = mindmapCSSVar('--mm-link-opacity', '0.5');

    const visChildren = mindmapVisibleChildren(node);
    for (const child of visChildren) {
        const colour = mindmapColour(child, depth + 1);
        const link = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        const dir = child._direction || 'right';
        const startX = node.x + (dir === 'right' ? node.width / 2 : -node.width / 2);
        const startY = node.y;
        const endX = child.x + (dir === 'right' ? -child.width / 2 : child.width / 2);
        const endY = child.y;

        // Bezier control points for a smooth S-curve
        const cpOffset = Math.abs(endX - startX) * 0.5;
        const cp1x = startX + (dir === 'right' ? cpOffset : -cpOffset);
        const cp1y = startY;
        const cp2x = endX + (dir === 'right' ? -cpOffset : cpOffset);
        const cp2y = endY;

        link.setAttribute('d', `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`);
        link.setAttribute('fill', 'none');
        link.setAttribute('stroke', colour);
        link.setAttribute('stroke-width', Math.max(1.5, 3 - depth * 0.5));
        link.setAttribute('opacity', linkOpacity);
        link.classList.add('mm-link');

        mindmapGroup.appendChild(link);

        mindmapDrawLinks(child, depth + 1);
    }
}

/**
 * Recursively draw node boxes with labels.
 */
function mindmapDrawNodes(node, depth) {
    const colour = mindmapColour(node, depth);
    const isRoot = !!node._isRoot;
    const hasChildren = node.children.length > 0;
    const isCollapsed = mindmapCollapsedIds.has(node.id);
    const dir = node._direction || 'right';

    // Read theme-aware colours from CSS custom properties
    const nodeFill = mindmapCSSVar('--mm-node-fill', '#2a2a2a');
    const nodeText = mindmapCSSVar('--mm-node-text', '#e0e0e0');
    const rootText = mindmapCSSVar('--mm-root-text', '#fff');
    const selectionStroke = mindmapCSSVar('--mm-selection-stroke', '#fff');
    const plusBtnFill = mindmapCSSVar('--mm-plus-btn-fill', '#333');
    const progressBg = mindmapCSSVar('--mm-progress-bg', '#444');

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('mm-node');
    g.dataset.nodeId = node.id;

    // Rectangle
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const rx = isRoot ? 24 : 8;
    rect.setAttribute('x', node.x - node.width / 2);
    rect.setAttribute('y', node.y - node.height / 2);
    rect.setAttribute('width', node.width);
    rect.setAttribute('height', node.height);
    rect.setAttribute('rx', rx);
    rect.setAttribute('ry', rx);
    // Determine node fill: root gets full colour; branch nodes get a subtle tint
    const computedFill = isRoot ? colour : mindmapShadeColour(colour, 0.3);
    rect.setAttribute('fill', computedFill);
    rect.setAttribute('stroke', colour);
    rect.setAttribute('stroke-width', isRoot ? 2.5 : 1.5);
    g.appendChild(rect);

    // Text label (truncated if too long) — shift text slightly left to make room for triangle/tick
    const triExtra = hasChildren ? (MM_COLLAPSE_TRI_SIZE * 2 + 6) : 0;
    const pct = parseInt(node.percent, 10);
    const isComplete = pct === 100;
    const tickExtra = isComplete ? 18 : 0;  // space for completed tick icon
    const textOffsetX = (triExtra + tickExtra) / 2;
    const textCenterX = (hasChildren || isComplete) ? node.x - textOffsetX : node.x;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', textCenterX);
    text.setAttribute('y', node.y + 1);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('fill', isRoot ? rootText : nodeText);
    text.setAttribute('font-size', isRoot ? '14px' : '13px');
    text.setAttribute('font-weight', isRoot ? '600' : (node.is_summary ? '600' : '400'));
    text.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
    text.classList.add('mm-label');

    // Truncate text to fit node width (minus space for triangle and tick)
    let displayName = node.name;
    const maxTextW = node.width - MM_NODE_PADDING_X * 2 - triExtra - tickExtra;
    if (mindmapMeasureText(displayName) > maxTextW) {
        while (displayName.length > 0 && mindmapMeasureText(displayName + '...') > maxTextW) {
            displayName = displayName.slice(0, -1);
        }
        displayName += '...';
    }
    text.textContent = displayName;
    g.appendChild(text);

    // Completed tick icon (green circle with white checkmark) — to the right of text, before triangle
    if (isComplete && !isRoot) {
        const tickG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        tickG.classList.add('mm-complete-tick');
        // Position the tick between the text area and the disclosure triangle (or right edge)
        const tickX = hasChildren
            ? node.x + node.width / 2 - MM_NODE_PADDING_X - (MM_COLLAPSE_TRI_SIZE * 2 + 6) - 8
            : node.x + node.width / 2 - MM_NODE_PADDING_X - 2;
        const tickY = node.y;
        const tickR = 6;  // radius of the tick circle

        const tickCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        tickCircle.setAttribute('cx', tickX);
        tickCircle.setAttribute('cy', tickY);
        tickCircle.setAttribute('r', tickR);
        tickCircle.setAttribute('fill', '#28a745');
        tickCircle.setAttribute('stroke', 'none');
        tickG.appendChild(tickCircle);

        // White checkmark path scaled to fit inside the circle
        const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const cx = tickX;
        const cy = tickY;
        checkPath.setAttribute('d', `M ${cx - 3} ${cy} L ${cx - 1} ${cy + 2.5} L ${cx + 3.5} ${cy - 2.5}`);
        checkPath.setAttribute('stroke', '#fff');
        checkPath.setAttribute('stroke-width', '1.8');
        checkPath.setAttribute('fill', 'none');
        checkPath.setAttribute('stroke-linecap', 'round');
        checkPath.setAttribute('stroke-linejoin', 'round');
        tickG.appendChild(checkPath);

        g.appendChild(tickG);
    }

    // Disclosure triangle for nodes with children (to the right of the text)
    if (hasChildren) {
        const triG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        triG.classList.add('mm-collapse-btn');

        const triX = node.x + node.width / 2 - MM_NODE_PADDING_X - MM_COLLAPSE_TRI_SIZE;
        const triY = node.y;
        const s = MM_COLLAPSE_TRI_SIZE;

        const triPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let d;
        if (isCollapsed) {
            // Right-pointing triangle (collapsed): indicates children are hidden
            // For left-direction nodes, point left instead
            if (dir === 'left') {
                d = `M ${triX + s} ${triY - s} L ${triX - s} ${triY} L ${triX + s} ${triY + s} Z`;
            } else {
                d = `M ${triX - s} ${triY - s} L ${triX + s} ${triY} L ${triX - s} ${triY + s} Z`;
            }
        } else {
            // Down-pointing triangle (expanded): indicates children are visible
            d = `M ${triX - s} ${triY - s / 2} L ${triX + s} ${triY - s / 2} L ${triX} ${triY + s} Z`;
        }
        triPath.setAttribute('d', d);
        triPath.setAttribute('fill', isRoot ? 'rgba(255,255,255,0.7)' : '#888');
        triPath.setAttribute('stroke', 'none');
        triG.appendChild(triPath);

        // Invisible hit area (larger than the triangle for easier clicking)
        const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hitRect.setAttribute('x', triX - s - 4);
        hitRect.setAttribute('y', triY - s - 4);
        hitRect.setAttribute('width', (s + 4) * 2);
        hitRect.setAttribute('height', (s + 4) * 2);
        hitRect.setAttribute('fill', 'transparent');
        hitRect.setAttribute('cursor', 'pointer');
        triG.appendChild(hitRect);

        triG.addEventListener('click', (e) => {
            e.stopPropagation();
            mindmapToggleCollapse(node);
        });

        g.appendChild(triG);
    }

    // Progress indicator (small bar at bottom of node) — skip for 100% complete tasks (they show tick instead)
    if (!isNaN(pct) && pct >= 0 && pct < 100) {
        const barY = node.y + node.height / 2 - 4;
        const barW = (node.width - 8) * (pct / 100);
        const bgBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgBar.setAttribute('x', node.x - node.width / 2 + 4);
        bgBar.setAttribute('y', barY);
        bgBar.setAttribute('width', node.width - 8);
        bgBar.setAttribute('height', 3);
        bgBar.setAttribute('rx', 1.5);
        bgBar.setAttribute('fill', progressBg);
        g.appendChild(bgBar);

        if (barW > 0) {
            const fgBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            fgBar.setAttribute('x', node.x - node.width / 2 + 4);
            fgBar.setAttribute('y', barY);
            fgBar.setAttribute('width', barW);
            fgBar.setAttribute('height', 3);
            fgBar.setAttribute('rx', 1.5);
            fgBar.setAttribute('fill', colour);
            g.appendChild(fgBar);
        }
    }

    // Hover plus button (add child)
    const plusG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    plusG.classList.add('mm-plus-btn');
    const plusX = node.x + (dir === 'right' ? node.width / 2 + 14 : -node.width / 2 - 14);
    const plusY = node.y;

    const plusCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    plusCircle.setAttribute('cx', plusX);
    plusCircle.setAttribute('cy', plusY);
    plusCircle.setAttribute('r', 10);
    plusCircle.setAttribute('fill', plusBtnFill);
    plusCircle.setAttribute('stroke', colour);
    plusCircle.setAttribute('stroke-width', '1.5');
    plusG.appendChild(plusCircle);

    const plusText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    plusText.setAttribute('x', plusX);
    plusText.setAttribute('y', plusY + 1);
    plusText.setAttribute('text-anchor', 'middle');
    plusText.setAttribute('dominant-baseline', 'central');
    plusText.setAttribute('fill', colour);
    plusText.setAttribute('font-size', '16px');
    plusText.setAttribute('font-weight', '700');
    plusText.textContent = '+';
    plusG.appendChild(plusText);

    plusG.addEventListener('click', (e) => {
        e.stopPropagation();
        mindmapAddChild(node);
    });

    g.appendChild(plusG);

    // Selection highlight (hidden by default)
    const selRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    selRect.setAttribute('x', node.x - node.width / 2 - 3);
    selRect.setAttribute('y', node.y - node.height / 2 - 3);
    selRect.setAttribute('width', node.width + 6);
    selRect.setAttribute('height', node.height + 6);
    selRect.setAttribute('rx', rx + 2);
    selRect.setAttribute('ry', rx + 2);
    selRect.setAttribute('fill', 'none');
    selRect.setAttribute('stroke', selectionStroke);
    selRect.setAttribute('stroke-width', '2');
    selRect.setAttribute('opacity', '0');
    selRect.classList.add('mm-selection');
    g.insertBefore(selRect, g.firstChild);

    // Tooltip
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    let tooltipText = node.name;
    if (node._task) {
        if (node._task.resources) tooltipText += `\nResources: ${node._task.resources}`;
        if (node._task.start) tooltipText += `\nStart: ${node._task.start}`;
        if (node._task.finish) tooltipText += `\nFinish: ${node._task.finish}`;
        if (pct >= 0 && !isNaN(pct)) tooltipText += `\nProgress: ${pct}%`;
    }
    if (hasChildren) {
        tooltipText += `\n${isCollapsed ? 'Click triangle to expand' : 'Click triangle to collapse'} (${node.children.length} ${node.children.length === 1 ? 'child' : 'children'})`;
    }
    titleEl.textContent = tooltipText;
    g.appendChild(titleEl);

    // Click to select
    g.addEventListener('click', (e) => {
        e.stopPropagation();
        mindmapSelectNode(node);
    });

    mindmapGroup.appendChild(g);
    mindmapNodeElements.push({ node, gEl: g });

    // Recurse only visible children
    const visChildren = mindmapVisibleChildren(node);
    for (const child of visChildren) {
        mindmapDrawNodes(child, depth + 1);
    }
}

// ── Collapse / expand ─────────────────────────────────────────────────

function mindmapToggleCollapse(node) {
    if (node.children.length === 0) return;
    if (mindmapCollapsedIds.has(node.id)) {
        mindmapCollapsedIds.delete(node.id);
    } else {
        mindmapCollapsedIds.add(node.id);
    }
    mindmapLayout(mindmapTree);
    mindmapRender();
    // Reselect the node if it was selected
    if (mindmapSelectedNode === node) {
        mindmapSelectNode(node);
    }
}

function mindmapExpandAll() {
    mindmapCollapsedIds.clear();
    if (!mindmapTree) return;
    mindmapLayout(mindmapTree);
    mindmapRender();
    if (mindmapSelectedNode) {
        mindmapSelectNode(mindmapSelectedNode);
    }
}

function mindmapCollapseAll() {
    if (!mindmapTree) return;
    // Collapse every node that has children
    function walk(node) {
        if (node.children.length > 0) {
            mindmapCollapsedIds.add(node.id);
        }
        for (const child of node.children) walk(child);
    }
    walk(mindmapTree);
    // Don't collapse the root itself so it remains visible with its direct branches
    mindmapCollapsedIds.delete(mindmapTree.id);
    mindmapLayout(mindmapTree);
    mindmapRender();
    if (mindmapSelectedNode) {
        mindmapSelectNode(mindmapSelectedNode);
    }
}

// ── Selection ─────────────────────────────────────────────────────────

function mindmapSelectNode(node) {
    // Deselect previous
    if (mindmapSelectedNode) {
        const prevEl = mindmapNodeElements.find(e => e.node === mindmapSelectedNode);
        if (prevEl) {
            const sel = prevEl.gEl.querySelector('.mm-selection');
            if (sel) sel.setAttribute('opacity', '0');
        }
    }

    mindmapSelectedNode = node;

    // Highlight new
    const el = mindmapNodeElements.find(e => e.node === node);
    if (el) {
        const sel = el.gEl.querySelector('.mm-selection');
        if (sel) sel.setAttribute('opacity', '1');
    }

    // Update colour picker visibility in the toolbar
    mindmapUpdateColourPicker(node);

    // Focus the container so keyboard events work
    const container = document.getElementById('mindmapContainer');
    if (container) container.focus();
}

function mindmapDeselectAll() {
    if (mindmapSelectedNode) {
        const el = mindmapNodeElements.find(e => e.node === mindmapSelectedNode);
        if (el) {
            const sel = el.gEl.querySelector('.mm-selection');
            if (sel) sel.setAttribute('opacity', '0');
        }
    }
    mindmapSelectedNode = null;
    mindmapUpdateColourPicker(null);
}

// ── Node editing (inline) ─────────────────────────────────────────────

function mindmapStartEditing(node) {
    const el = mindmapNodeElements.find(e => e.node === node);
    if (!el) return;

    const textEl = el.gEl.querySelector('.mm-label');
    if (!textEl) return;

    // Create a foreignObject with an input field
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', node.x - node.width / 2 + 4);
    fo.setAttribute('y', node.y - node.height / 2 + 2);
    fo.setAttribute('width', node.width - 8);
    fo.setAttribute('height', node.height - 4);
    fo.classList.add('mm-edit-fo');

    const inputBg = mindmapCSSVar('--mm-inline-input-bg', '#1e1e1e');
    const inputText = mindmapCSSVar('--mm-inline-input-text', '#e0e0e0');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = node.name;
    input.className = 'mm-inline-input';
    input.style.cssText = `
        width: 100%; height: 100%; border: none; outline: none;
        background: ${inputBg}; color: ${inputText}; font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        text-align: center; padding: 0 4px; box-sizing: border-box;
        border-radius: 4px;
    `;

    fo.appendChild(input);
    el.gEl.appendChild(fo);
    textEl.setAttribute('opacity', '0');

    input.focus();
    input.select();

    const finishEdit = () => {
        const newName = input.value.trim();
        if (newName && newName !== node.name) {
            node.name = newName;
            mindmapSyncToEditor();
        }
        fo.remove();
        textEl.setAttribute('opacity', '1');
        // Re-render to update widths/layout
        mindmapLayout(mindmapTree);
        mindmapRender();
        mindmapSelectNode(node);
    };

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        }
        if (e.key === 'Escape') {
            input.value = node.name; // revert
            input.blur();
        }
        e.stopPropagation();
    });
}

// ── Add / remove nodes ────────────────────────────────────────────────

function mindmapAddChild(parentNode) {
    const newId = mindmapGetNextId();
    const newNode = {
        id: newId,
        name: 'New Task',
        children: [],
        level: parentNode.level + 1,
        is_summary: false,
        percent: '',
        _task: null,
        _direction: parentNode._direction || 'right',
        x: 0, y: 0,
        width: 0, height: MM_NODE_HEIGHT,
        subtreeHeight: 0
    };

    parentNode.children.push(newNode);
    if (parentNode.children.length > 0) {
        parentNode.is_summary = true;
    }

    // Auto-expand if the parent was collapsed
    mindmapCollapsedIds.delete(parentNode.id);

    // Sync immediately so the plan text includes this node before any
    // pending debounced render fires (prevents the node from vanishing).
    mindmapSyncToEditor();

    mindmapLayout(mindmapTree);
    mindmapRender();
    mindmapSelectNode(newNode);

    // Auto-start editing the new node
    setTimeout(() => mindmapStartEditing(newNode), 50);
}

function mindmapAddSibling(node) {
    // Find parent of this node
    let parent = mindmapFindParent(mindmapTree, node);

    // If this is the promoted root (single top-level item promoted to root),
    // we need to wrap it in a virtual root so it can have siblings (phases).
    if (!parent && node._isRoot) {
        const virtualRoot = {
            id: 0,
            name: 'Project',
            children: [node],
            level: -1,
            is_summary: true,
            _task: null,
            _isRoot: true,
            x: 0, y: 0,
            width: 0, height: MM_NODE_HEIGHT,
            subtreeHeight: 0
        };
        node._isRoot = false;
        node.level = 0;
        mindmapTree = virtualRoot;
        parent = virtualRoot;
    }

    if (!parent) return;

    const newId = mindmapGetNextId();
    const newNode = {
        id: newId,
        name: 'New Task',
        children: [],
        level: node.level,
        is_summary: false,
        percent: '',
        _task: null,
        _direction: node._direction || 'right',
        x: 0, y: 0,
        width: 0, height: MM_NODE_HEIGHT,
        subtreeHeight: 0
    };

    // Insert after the current node
    const idx = parent.children.indexOf(node);
    parent.children.splice(idx + 1, 0, newNode);

    // Sync immediately so the plan text includes this node before any
    // pending debounced render fires (prevents the node from vanishing).
    mindmapSyncToEditor();

    mindmapLayout(mindmapTree);
    mindmapRender();
    mindmapSelectNode(newNode);

    setTimeout(() => mindmapStartEditing(newNode), 50);
}

/**
 * Bootstrap the mind map from an empty plan.
 * Creates an initial root node and starts editing it.
 */
function mindmapCreateFirst() {
    mindmapTree = {
        id: 1,
        name: 'New Project',
        children: [],
        level: 0,
        is_summary: true,
        _task: null,
        _isRoot: true,
        x: 0, y: 0,
        width: 0, height: MM_NODE_HEIGHT,
        subtreeHeight: 0
    };

    // Hide placeholder, show content
    const placeholder = document.querySelector('#mindmap-view .mindmap-placeholder');
    const content = document.querySelector('#mindmap-view .mindmap-content');
    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    initMindmap();
    mindmapLayout(mindmapTree);
    mindmapRender();
    mindmapZoomReset();
    mindmapSelectNode(mindmapTree);

    setTimeout(() => mindmapStartEditing(mindmapTree), 50);
}

function mindmapDeleteNode(node) {
    const parent = mindmapFindParent(mindmapTree, node);

    // Root with no parent: allow delete only if it has no children,
    // which clears the mindmap entirely.
    if (node._isRoot) {
        if (node.children.length > 0) return; // can't delete root that has children
        mindmapClearToEmpty();
        return;
    }

    if (!parent) return;

    const idx = parent.children.indexOf(node);
    if (idx >= 0) parent.children.splice(idx, 1);

    if (parent.children.length === 0) {
        parent.is_summary = false;
    }

    // If the tree is now effectively empty (only a childless root remains),
    // clear the mindmap and show the placeholder.
    if (mindmapTree.children.length === 0) {
        mindmapClearToEmpty();
        return;
    }

    mindmapSelectedNode = null;
    mindmapLayout(mindmapTree);
    mindmapRender();

    // Select the parent or the next sibling
    if (parent.children.length > 0) {
        const nextIdx = Math.min(idx, parent.children.length - 1);
        mindmapSelectNode(parent.children[nextIdx]);
    } else {
        mindmapSelectNode(parent);
    }

    mindmapSyncToEditor();
}

/**
 * Clear the mindmap to empty state, sync the cleared plan, and show placeholder.
 */
function mindmapClearToEmpty() {
    mindmapTree = null;
    mindmapSelectedNode = null;
    mindmapNodeElements = [];
    mindmapTasks = [];

    if (mindmapGroup) {
        while (mindmapGroup.firstChild) {
            mindmapGroup.removeChild(mindmapGroup.firstChild);
        }
    }

    const placeholder = document.querySelector('#mindmap-view .mindmap-placeholder');
    const content = document.querySelector('#mindmap-view .mindmap-content');
    if (placeholder) placeholder.style.display = '';
    if (content) content.style.display = 'none';

    // Clear task lines from the plan text, preserving front matter and RAID log
    const editor = document.getElementById('planEditor');
    if (editor) {
        const currentText = editor.value;
        let frontMatter = '';
        let raidLog = '';
        const lines = currentText.split('\n');

        let inFrontMatter = false;
        let fmEnd = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                if (!inFrontMatter) { inFrontMatter = true; } else { fmEnd = i; break; }
            }
        }
        if (fmEnd >= 0) {
            frontMatter = lines.slice(0, fmEnd + 1).join('\n') + '\n';
        }

        const raidIdx = currentText.indexOf('---raid log---');
        if (raidIdx >= 0) {
            raidLog = '\n' + currentText.substring(raidIdx);
        }

        editor.value = frontMatter + raidLog;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function mindmapFindParent(root, target) {
    if (!root) return null;
    for (const child of root.children) {
        if (child === target) return root;
        const found = mindmapFindParent(child, target);
        if (found) return found;
    }
    return null;
}

function mindmapGetNextId() {
    let maxId = 0;
    function walk(node) {
        if (node.id > maxId) maxId = node.id;
        for (const child of node.children) walk(child);
    }
    if (mindmapTree) walk(mindmapTree);
    return maxId + 1;
}

// ── Sync tree back to editor ──────────────────────────────────────────

function mindmapSyncToEditor() {
    if (!mindmapTree) return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Preserve front matter
    const currentText = editor.value;
    let frontMatter = '';
    let raidLog = '';
    const lines = currentText.split('\n');

    let inFrontMatter = false;
    let fmEnd = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
            if (!inFrontMatter) {
                inFrontMatter = true;
            } else {
                fmEnd = i;
                break;
            }
        }
    }

    if (fmEnd >= 0) {
        frontMatter = lines.slice(0, fmEnd + 1).join('\n') + '\n\n';
    }

    // Preserve RAID log
    const raidIdx = currentText.indexOf('---raid log---');
    if (raidIdx >= 0) {
        raidLog = '\n' + currentText.substring(raidIdx);
    }

    // Build plan text from tree
    const planLines = [];
    function writeNode(node, indent) {
        if (node._isRoot && node.level === -1) {
            // Virtual root: skip, just write children
            for (const child of node.children) {
                writeNode(child, 0);
            }
            return;
        }

        const prefix = '  '.repeat(indent);
        let line = prefix + node.name;

        // Re-attach original task metadata if available
        if (node._task) {
            const t = node._task;
            if (t.resources) {
                const res = t.resources.split(',').map(r => '@' + r.trim()).join(' ');
                line += ' ' + res;
            }
            if (t.duration_days > 0) {
                line += ` ${t.duration_days}days`;
            }
            if (t.percent !== '' && t.percent !== undefined && t.percent !== null) {
                line += ` ${t.percent}%`;
            }
            if (t.comment) {
                line += ` "${t.comment}"`;
            }
        }

        planLines.push(line);

        for (const child of node.children) {
            writeNode(child, indent + 1);
        }
    }

    writeNode(mindmapTree, 0);

    editor.value = frontMatter + planLines.join('\n') + raidLog;

    // Dispatch input event to trigger re-render
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Keyboard navigation ───────────────────────────────────────────────

function mindmapHandleKeydown(e) {
    // Don't handle if editing inline
    if (document.querySelector('.mm-edit-fo')) return;

    const node = mindmapSelectedNode;

    switch (e.key) {
        case 'Tab':
            e.preventDefault();
            if (e.shiftKey) {
                // Shift+Tab: select parent
                if (node) {
                    const parent = mindmapFindParent(mindmapTree, node);
                    if (parent && !parent._isRoot) {
                        mindmapSelectNode(parent);
                    } else if (parent && parent._isRoot) {
                        mindmapSelectNode(parent);
                    }
                }
            } else {
                // Tab: select next node in flat order
                if (!node) {
                    if (mindmapNodeElements.length > 0) {
                        mindmapSelectNode(mindmapNodeElements[0].node);
                    }
                } else {
                    const idx = mindmapNodeElements.findIndex(e => e.node === node);
                    if (idx >= 0 && idx < mindmapNodeElements.length - 1) {
                        mindmapSelectNode(mindmapNodeElements[idx + 1].node);
                    } else if (idx === mindmapNodeElements.length - 1) {
                        mindmapSelectNode(mindmapNodeElements[0].node);
                    }
                }
            }
            break;

        case 'Enter':
            e.preventDefault();
            if (node) {
                mindmapAddSibling(node);
            }
            break;

        case 'F2':
            e.preventDefault();
            if (node) {
                mindmapStartEditing(node);
            }
            break;

        case 'Delete':
        case 'Backspace':
            if (node && !node._isRoot) {
                e.preventDefault();
                mindmapDeleteNode(node);
            }
            break;

        case 'ArrowRight':
            e.preventDefault();
            if (node && node.children.length > 0) {
                // If collapsed, expand first; otherwise navigate to first child
                if (mindmapCollapsedIds.has(node.id)) {
                    mindmapToggleCollapse(node);
                } else {
                    mindmapSelectNode(node.children[0]);
                }
            }
            break;

        case 'Insert':
            // Insert key: add a child to the selected node
            e.preventDefault();
            if (node) {
                mindmapAddChild(node);
            }
            break;

        case 'ArrowLeft':
            e.preventDefault();
            if (node) {
                // If node has children and is expanded, collapse it first
                if (node.children.length > 0 && !mindmapCollapsedIds.has(node.id)) {
                    mindmapToggleCollapse(node);
                } else {
                    const parent = mindmapFindParent(mindmapTree, node);
                    if (parent) {
                        mindmapSelectNode(parent);
                    }
                }
            }
            break;

        case 'ArrowDown':
            e.preventDefault();
            if (node) {
                const parent = mindmapFindParent(mindmapTree, node);
                if (parent) {
                    const idx = parent.children.indexOf(node);
                    if (idx < parent.children.length - 1) {
                        mindmapSelectNode(parent.children[idx + 1]);
                    }
                }
            }
            break;

        case 'ArrowUp':
            e.preventDefault();
            if (node) {
                const parent = mindmapFindParent(mindmapTree, node);
                if (parent) {
                    const idx = parent.children.indexOf(node);
                    if (idx > 0) {
                        mindmapSelectNode(parent.children[idx - 1]);
                    }
                }
            }
            break;

        case ' ':
            // Space: toggle collapse on nodes with children
            e.preventDefault();
            if (node && node.children.length > 0) {
                mindmapToggleCollapse(node);
            }
            break;

        case 'Escape':
            e.preventDefault();
            mindmapDeselectAll();
            break;
    }
}

// ── Zoom and pan ──────────────────────────────────────────────────────

function mindmapApplyTransform(animate) {
    if (!mindmapGroup) return;

    const transformStr = `translate(${mindmapPanX}, ${mindmapPanY}) scale(${mindmapZoom})`;

    if (animate) {
        mindmapGroup.style.transition = `transform ${MM_ANIM_DURATION}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
        mindmapGroup.setAttribute('transform', transformStr);
        setTimeout(() => {
            mindmapGroup.style.transition = '';
        }, MM_ANIM_DURATION);
    } else {
        mindmapGroup.style.transition = '';
        mindmapGroup.setAttribute('transform', transformStr);
    }
}

function mindmapZoomIn() {
    mindmapZoom = Math.min(3, mindmapZoom * 1.25);
    mindmapApplyTransform(true);
    mindmapUpdateZoomLabel();
}

function mindmapZoomOut() {
    mindmapZoom = Math.max(0.1, mindmapZoom / 1.25);
    mindmapApplyTransform(true);
    mindmapUpdateZoomLabel();
}

function mindmapZoomReset() {
    mindmapZoom = 1;
    mindmapPanX = 0;
    mindmapPanY = 0;

    // Re-centre on SVG midpoint
    if (mindmapSvg) {
        const rect = mindmapSvg.getBoundingClientRect();
        mindmapPanX = rect.width / 2;
        mindmapPanY = rect.height / 2;
    }

    mindmapApplyTransform(true);
    mindmapUpdateZoomLabel();
}

function mindmapZoomFit() {
    if (!mindmapTree || !mindmapSvg) return;

    // Find the bounding box of all visible nodes
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    function walk(node) {
        const left = node.x - node.width / 2;
        const right = node.x + node.width / 2;
        const top = node.y - node.height / 2;
        const bottom = node.y + node.height / 2;
        if (left < minX) minX = left;
        if (right > maxX) maxX = right;
        if (top < minY) minY = top;
        if (bottom > maxY) maxY = bottom;
        const visChildren = mindmapVisibleChildren(node);
        for (const child of visChildren) walk(child);
    }
    walk(mindmapTree);

    if (minX === Infinity) return;

    const svgRect = mindmapSvg.getBoundingClientRect();
    const padding = 60;
    const treeW = maxX - minX + padding * 2;
    const treeH = maxY - minY + padding * 2;
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;

    const scaleX = svgRect.width / treeW;
    const scaleY = svgRect.height / treeH;
    mindmapZoom = Math.min(scaleX, scaleY, 2);

    mindmapPanX = svgRect.width / 2 - centreX * mindmapZoom;
    mindmapPanY = svgRect.height / 2 - centreY * mindmapZoom;

    mindmapApplyTransform(true);
    mindmapUpdateZoomLabel();
}

function mindmapUpdateZoomLabel() {
    const label = document.getElementById('mindmapZoomLabel');
    if (label) {
        label.textContent = Math.round(mindmapZoom * 100) + '%';
    }
}

function mindmapHandleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY;

    if (e.ctrlKey || e.metaKey) {
        // Pinch zoom
        if (delta < 0) {
            mindmapZoom = Math.min(3, mindmapZoom * 1.08);
        } else {
            mindmapZoom = Math.max(0.1, mindmapZoom / 1.08);
        }
        mindmapApplyTransform(false);
        mindmapUpdateZoomLabel();
    } else {
        // Pan
        mindmapPanX -= e.deltaX || 0;
        mindmapPanY -= delta;
        mindmapApplyTransform(false);
    }
}

function mindmapHandleMouseDown(e) {
    if (e.button !== 0) return;
    // Only start drag if clicking on the SVG background (not on a node)
    if (e.target === mindmapSvg || e.target === mindmapGroup) {
        mindmapIsDragging = true;
        mindmapDragStartX = e.clientX;
        mindmapDragStartY = e.clientY;
        mindmapDragStartPanX = mindmapPanX;
        mindmapDragStartPanY = mindmapPanY;
        mindmapSvg.style.cursor = 'grabbing';
        e.preventDefault();
    }
}

function mindmapHandleMouseMove(e) {
    if (!mindmapIsDragging) return;
    mindmapPanX = mindmapDragStartPanX + (e.clientX - mindmapDragStartX);
    mindmapPanY = mindmapDragStartPanY + (e.clientY - mindmapDragStartY);
    mindmapApplyTransform(false);
}

function mindmapHandleMouseUp() {
    if (mindmapIsDragging) {
        mindmapIsDragging = false;
        if (mindmapSvg) mindmapSvg.style.cursor = '';
    }
}

// ── Touch support for mobile ──────────────────────────────────────────

let mindmapTouchStartDist = 0;
let mindmapTouchStartZoom = 1;

function mindmapHandleTouchStart(e) {
    if (e.touches.length === 1) {
        mindmapIsDragging = true;
        mindmapDragStartX = e.touches[0].clientX;
        mindmapDragStartY = e.touches[0].clientY;
        mindmapDragStartPanX = mindmapPanX;
        mindmapDragStartPanY = mindmapPanY;
    } else if (e.touches.length === 2) {
        mindmapIsDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        mindmapTouchStartDist = Math.sqrt(dx * dx + dy * dy);
        mindmapTouchStartZoom = mindmapZoom;
    }
}

function mindmapHandleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && mindmapIsDragging) {
        mindmapPanX = mindmapDragStartPanX + (e.touches[0].clientX - mindmapDragStartX);
        mindmapPanY = mindmapDragStartPanY + (e.touches[0].clientY - mindmapDragStartY);
        mindmapApplyTransform(false);
    } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (mindmapTouchStartDist > 0) {
            mindmapZoom = Math.max(0.1, Math.min(3, mindmapTouchStartZoom * (dist / mindmapTouchStartDist)));
            mindmapApplyTransform(false);
            mindmapUpdateZoomLabel();
        }
    }
}

function mindmapHandleTouchEnd() {
    mindmapIsDragging = false;
    mindmapTouchStartDist = 0;
}

// ── Initialization ────────────────────────────────────────────────────

function initMindmap() {
    const container = document.getElementById('mindmapContainer');
    if (!container) return;

    // Restore theme preference from localStorage on first init
    mindmapRestoreTheme();

    // Create SVG if not already present
    mindmapSvg = container.querySelector('svg.mm-svg');
    if (!mindmapSvg) {
        mindmapSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        mindmapSvg.classList.add('mm-svg');
        mindmapSvg.setAttribute('width', '100%');
        mindmapSvg.setAttribute('height', '100%');

        mindmapGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        mindmapGroup.classList.add('mm-root-group');
        mindmapSvg.appendChild(mindmapGroup);

        container.appendChild(mindmapSvg);

        // Event listeners
        mindmapSvg.addEventListener('wheel', mindmapHandleWheel, { passive: false });
        mindmapSvg.addEventListener('mousedown', mindmapHandleMouseDown);
        window.addEventListener('mousemove', mindmapHandleMouseMove);
        window.addEventListener('mouseup', mindmapHandleMouseUp);

        // Touch
        mindmapSvg.addEventListener('touchstart', mindmapHandleTouchStart, { passive: false });
        mindmapSvg.addEventListener('touchmove', mindmapHandleTouchMove, { passive: false });
        mindmapSvg.addEventListener('touchend', mindmapHandleTouchEnd);

        // Click on background to deselect
        mindmapSvg.addEventListener('click', (e) => {
            if (e.target === mindmapSvg) {
                mindmapDeselectAll();
            }
        });
    } else {
        mindmapGroup = mindmapSvg.querySelector('.mm-root-group');
    }

    // Keyboard
    container.setAttribute('tabindex', '0');
    container.addEventListener('keydown', mindmapHandleKeydown);
}

/**
 * Main entry point: called from updateAllViews() with fresh tasks array.
 */
function updateMindmap(tasks, projectName) {
    // Don't rebuild the tree while the user is actively editing a node —
    // the rebuild would destroy the inline input and discard unsynced nodes.
    if (document.querySelector('.mm-edit-fo')) return;

    mindmapTasks = tasks || [];

    // Load colours before building the tree
    mindmapLoadBranchColours();
    mindmapParseThemeColours();

    // Build the tree
    const newTree = mindmapBuildTree(mindmapTasks, projectName);
    if (!newTree) {
        mindmapTree = null;
        mindmapSelectedNode = null;
        mindmapNodeElements = [];
        // Clear the SVG so stale nodes don't linger
        if (mindmapGroup) {
            while (mindmapGroup.firstChild) {
                mindmapGroup.removeChild(mindmapGroup.firstChild);
            }
        }
        // Show placeholder
        const placeholder = document.querySelector('#mindmap-view .mindmap-placeholder');
        const content = document.querySelector('#mindmap-view .mindmap-content');
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
        return;
    }

    // Show content, hide placeholder
    const placeholder = document.querySelector('#mindmap-view .mindmap-placeholder');
    const content = document.querySelector('#mindmap-view .mindmap-content');
    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    // Try to preserve the project name from existing root
    if (mindmapTree && mindmapTree._isRoot && mindmapTree.name && newTree._isRoot) {
        // Keep custom root name only if it was the same task
        if (!newTree.name || newTree.name === 'Project') {
            newTree.name = mindmapTree.name;
        }
    }

    mindmapTree = newTree;

    initMindmap();
    mindmapLayout(mindmapTree);
    mindmapRender();

    // Centre view on first render
    if (mindmapPanX === 0 && mindmapPanY === 0) {
        mindmapZoomFit();
    }
}

// ── Colour picker (toolbar) ───────────────────────────────────────────

/**
 * Update the colour picker UI in the toolbar based on the selected node.
 * The picker appears only when a node is selected, allowing the user to
 * set the branch colour for the selected node's top-level branch.
 */
function mindmapUpdateColourPicker(node) {
    const container = document.getElementById('mindmapColourPickerGroup');
    if (!container) return;

    if (!node || node._isRoot) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';

    // Find the branch ancestor for this node
    const branchNode = mindmapFindBranchAncestor(node);
    if (!branchNode) {
        container.style.display = 'none';
        return;
    }

    // Update the colour swatch to show current branch colour
    const swatch = document.getElementById('mindmapColourSwatch');
    if (swatch) {
        const branchName = branchNode.name;
        const currentColour = mindmapThemeColours[branchName]
            || mindmapBranchColours[branchName]
            || MM_BRANCH_COLOURS[mindmapTree.children.indexOf(branchNode) % MM_BRANCH_COLOURS.length];
        swatch.style.backgroundColor = currentColour;
        swatch.dataset.branchName = branchName;
    }

    // Update the label
    const label = document.getElementById('mindmapColourLabel');
    if (label) {
        label.textContent = branchNode.name;
        // Truncate long names
        if (label.textContent.length > 20) {
            label.textContent = label.textContent.slice(0, 18) + '...';
        }
    }
}

/**
 * Show the colour picker popup anchored to the swatch button.
 */
function mindmapShowColourPicker() {
    mindmapHideColourPicker();

    const swatch = document.getElementById('mindmapColourSwatch');
    if (!swatch) return;

    const branchName = swatch.dataset.branchName;
    if (!branchName) return;

    const picker = document.createElement('div');
    picker.className = 'mm-colour-picker';
    picker.id = 'mmColourPicker';

    // Pastel colours section
    const pastelLabel = document.createElement('div');
    pastelLabel.className = 'mm-colour-picker-label';
    pastelLabel.textContent = 'Pastel';
    picker.appendChild(pastelLabel);

    const pastelGrid = document.createElement('div');
    pastelGrid.className = 'mm-colour-grid';
    if (typeof CF_PASTEL_COLOURS !== 'undefined') {
        CF_PASTEL_COLOURS.forEach(colour => {
            pastelGrid.appendChild(mindmapCreateColourSwatch(colour, branchName));
        });
    }
    picker.appendChild(pastelGrid);

    // Dark colours section
    const darkLabel = document.createElement('div');
    darkLabel.className = 'mm-colour-picker-label';
    darkLabel.textContent = 'Dark';
    picker.appendChild(darkLabel);

    const darkGrid = document.createElement('div');
    darkGrid.className = 'mm-colour-grid';
    if (typeof CF_DARK_COLOURS !== 'undefined') {
        CF_DARK_COLOURS.forEach(colour => {
            darkGrid.appendChild(mindmapCreateColourSwatch(colour, branchName));
        });
    }
    picker.appendChild(darkGrid);

    // Branch default colours section
    const branchLabel = document.createElement('div');
    branchLabel.className = 'mm-colour-picker-label';
    branchLabel.textContent = 'Branch Defaults';
    picker.appendChild(branchLabel);

    const branchGrid = document.createElement('div');
    branchGrid.className = 'mm-colour-grid';
    MM_BRANCH_COLOURS.forEach(colour => {
        branchGrid.appendChild(mindmapCreateColourSwatch(colour, branchName));
    });
    picker.appendChild(branchGrid);

    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'mm-colour-clear-btn';
    clearBtn.textContent = 'Reset to default';
    clearBtn.addEventListener('click', () => {
        mindmapSetBranchColour(branchName, null);
        mindmapHideColourPicker();
    });
    picker.appendChild(clearBtn);

    // Position relative to the swatch button
    const rect = swatch.getBoundingClientRect();
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.left = rect.left + 'px';

    document.body.appendChild(picker);

    // Close on outside click
    const closeHandler = (e) => {
        if (!picker.contains(e.target) && e.target !== swatch) {
            mindmapHideColourPicker();
            document.removeEventListener('mousedown', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
}

/**
 * Create a single colour swatch for the picker.
 */
function mindmapCreateColourSwatch(colour, branchName) {
    const el = document.createElement('div');
    el.className = 'mm-colour-swatch-option';
    el.style.backgroundColor = colour;
    el.title = colour;

    // Check if this is the currently selected colour
    const current = mindmapThemeColours[branchName]
        || mindmapBranchColours[branchName];
    if (current && current.toUpperCase() === colour.toUpperCase()) {
        el.classList.add('selected');
    }

    el.addEventListener('click', () => {
        mindmapSetBranchColour(branchName, colour);
        mindmapHideColourPicker();
    });

    return el;
}

/**
 * Set a branch colour and re-render.
 */
function mindmapSetBranchColour(branchName, colour) {
    if (colour) {
        mindmapBranchColours[branchName] = colour.toUpperCase();
    } else {
        delete mindmapBranchColours[branchName];
    }

    // Save to localStorage
    mindmapSaveBranchColours();

    // Also save to front matter Theme section (shared with kanban)
    mindmapSaveThemeColour(branchName, colour);

    // Re-render the mindmap
    mindmapRender();

    // Update the swatch colour
    if (mindmapSelectedNode) {
        mindmapUpdateColourPicker(mindmapSelectedNode);
    }
}

/**
 * Save a branch colour to the front matter Theme section,
 * so it is shared with the kanban board view.
 */
function mindmapSaveThemeColour(branchName, colour) {
    if (colour) {
        mindmapThemeColours[branchName] = colour.toUpperCase();
    } else {
        delete mindmapThemeColours[branchName];
    }

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    let content = editor.value;

    // Build theme section
    let themeSection = '';
    const entries = Object.entries(mindmapThemeColours);
    if (entries.length > 0) {
        themeSection = 'Theme:\n';
        for (const [name, col] of entries) {
            themeSection += `- ${name}: ${col}\n`;
        }
    }

    // Replace or add theme section in front matter
    if (typeof removeFrontMatterSection === 'function') {
        const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (frontMatterMatch) {
            const fmContent = removeFrontMatterSection(frontMatterMatch[1], 'Theme');
            let newContent = fmContent.trimEnd();
            if (themeSection) {
                newContent += '\n' + themeSection;
            }
            const newFrontMatter = '---\n' + newContent.trim() + '\n---';
            content = content.replace(/^---\s*\n[\s\S]*?\n---/, newFrontMatter);
        } else if (themeSection) {
            content = '---\n' + themeSection + '---\n\n' + content;
        }

        editor.value = content;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * Hide the colour picker popup.
 */
function mindmapHideColourPicker() {
    const existing = document.getElementById('mmColourPicker');
    if (existing) existing.remove();
}

// ── Double-click to edit ──────────────────────────────────────────────
document.addEventListener('dblclick', function(e) {
    const nodeEl = e.target.closest('.mm-node');
    if (!nodeEl) return;

    const nodeId = parseInt(nodeEl.dataset.nodeId, 10);
    const entry = mindmapNodeElements.find(ne => ne.node.id === nodeId);
    if (entry) {
        mindmapSelectNode(entry.node);
        mindmapStartEditing(entry.node);
    }
});
