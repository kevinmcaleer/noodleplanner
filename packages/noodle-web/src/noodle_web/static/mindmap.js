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

// Layout constants
const MM_H_GAP = 180;           // horizontal gap between levels
const MM_V_GAP = 14;            // vertical gap between sibling nodes
const MM_NODE_HEIGHT = 36;      // height of a node box
const MM_NODE_PADDING_X = 16;   // horizontal padding inside a node box
const MM_NODE_MIN_WIDTH = 80;
const MM_NODE_MAX_WIDTH = 220;
const MM_ROOT_RADIUS = 0;       // extra space around root
const MM_ANIM_DURATION = 400;   // ms for elastic animation

// Colours
const MM_COLOURS = [
    '#108BB9', '#E8833A', '#5CB85C', '#D9534F',
    '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB',
    '#2ECC71', '#E74C3C', '#F39C12', '#8E44AD'
];

// ── Tree building ─────────────────────────────────────────────────────

/**
 * Build a tree structure from the flat tasks array returned by /api/parse.
 * Each task has `level` (0-based indent depth) and `is_summary`.
 */
function mindmapBuildTree(tasks) {
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
    root.name = 'Project';
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
 * Recursively calculate the width and subtreeHeight for every node.
 */
function mindmapMeasure(node) {
    const textW = mindmapMeasureText(node.name);
    node.width = Math.min(MM_NODE_MAX_WIDTH, Math.max(MM_NODE_MIN_WIDTH, textW + MM_NODE_PADDING_X * 2 + 8));

    if (node.children.length === 0) {
        node.subtreeHeight = node.height;
        return;
    }

    let totalChildrenHeight = 0;
    for (const child of node.children) {
        mindmapMeasure(child);
        totalChildrenHeight += child.subtreeHeight;
    }
    totalChildrenHeight += (node.children.length - 1) * MM_V_GAP;
    node.subtreeHeight = Math.max(node.height, totalChildrenHeight);
}

/**
 * Layout the tree in a left-to-right fashion starting from a centre point.
 * The root is placed at (0,0). Children fan out to the right by default.
 * For an even split, the first half of root children go left, second half right.
 */
function mindmapLayout(root) {
    mindmapMeasure(root);

    root.x = 0;
    root.y = 0;

    if (root.children.length === 0) return;

    // Split root's children: first half to the LEFT, second half to the RIGHT
    const mid = Math.ceil(root.children.length / 2);
    const leftChildren = root.children.slice(0, mid);
    const rightChildren = root.children.slice(mid);

    // Layout right side
    mindmapLayoutBranch(root, rightChildren, 'right');

    // Layout left side
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

        // Recursively layout grandchildren (always same direction)
        if (child.children.length > 0) {
            mindmapLayoutBranch(child, child.children, direction);
        }
    }
}

// ── SVG rendering ─────────────────────────────────────────────────────

function mindmapColour(node, depth) {
    return MM_COLOURS[depth % MM_COLOURS.length];
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
 * Recursively draw curved links between parent and children.
 */
function mindmapDrawLinks(node, depth) {
    for (const child of node.children) {
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
        link.setAttribute('opacity', '0.5');
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
    rect.setAttribute('fill', isRoot ? colour : '#2a2a2a');
    rect.setAttribute('stroke', colour);
    rect.setAttribute('stroke-width', isRoot ? 2.5 : 1.5);
    g.appendChild(rect);

    // Text label (truncated if too long)
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', node.x);
    text.setAttribute('y', node.y + 1);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('fill', isRoot ? '#fff' : '#e0e0e0');
    text.setAttribute('font-size', isRoot ? '14px' : '13px');
    text.setAttribute('font-weight', isRoot ? '600' : (node.is_summary ? '600' : '400'));
    text.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
    text.classList.add('mm-label');

    // Truncate text to fit node width
    let displayName = node.name;
    const maxTextW = node.width - MM_NODE_PADDING_X * 2;
    if (mindmapMeasureText(displayName) > maxTextW) {
        while (displayName.length > 0 && mindmapMeasureText(displayName + '...') > maxTextW) {
            displayName = displayName.slice(0, -1);
        }
        displayName += '...';
    }
    text.textContent = displayName;
    g.appendChild(text);

    // Progress indicator (small bar at bottom of node)
    const pct = parseInt(node.percent, 10);
    if (!isNaN(pct) && pct >= 0) {
        const barY = node.y + node.height / 2 - 4;
        const barW = (node.width - 8) * (pct / 100);
        const bgBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgBar.setAttribute('x', node.x - node.width / 2 + 4);
        bgBar.setAttribute('y', barY);
        bgBar.setAttribute('width', node.width - 8);
        bgBar.setAttribute('height', 3);
        bgBar.setAttribute('rx', 1.5);
        bgBar.setAttribute('fill', '#444');
        g.appendChild(bgBar);

        if (barW > 0) {
            const fgBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            fgBar.setAttribute('x', node.x - node.width / 2 + 4);
            fgBar.setAttribute('y', barY);
            fgBar.setAttribute('width', barW);
            fgBar.setAttribute('height', 3);
            fgBar.setAttribute('rx', 1.5);
            fgBar.setAttribute('fill', pct === 100 ? '#5CB85C' : colour);
            g.appendChild(fgBar);
        }
    }

    // Hover plus button (add child)
    const plusG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    plusG.classList.add('mm-plus-btn');
    const dir = node._direction || 'right';
    const plusX = node.x + (dir === 'right' ? node.width / 2 + 14 : -node.width / 2 - 14);
    const plusY = node.y;

    const plusCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    plusCircle.setAttribute('cx', plusX);
    plusCircle.setAttribute('cy', plusY);
    plusCircle.setAttribute('r', 10);
    plusCircle.setAttribute('fill', '#333');
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
    selRect.setAttribute('stroke', '#fff');
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
    titleEl.textContent = tooltipText;
    g.appendChild(titleEl);

    // Click to select
    g.addEventListener('click', (e) => {
        e.stopPropagation();
        mindmapSelectNode(node);
    });

    mindmapGroup.appendChild(g);
    mindmapNodeElements.push({ node, gEl: g });

    // Recurse children
    for (const child of node.children) {
        mindmapDrawNodes(child, depth + 1);
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

    const input = document.createElement('input');
    input.type = 'text';
    input.value = node.name;
    input.className = 'mm-inline-input';
    input.style.cssText = `
        width: 100%; height: 100%; border: none; outline: none;
        background: #1e1e1e; color: #e0e0e0; font-size: 13px;
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
    if (node._isRoot) return; // can't delete root

    const parent = mindmapFindParent(mindmapTree, node);
    if (!parent) return;

    const idx = parent.children.indexOf(node);
    if (idx >= 0) parent.children.splice(idx, 1);

    if (parent.children.length === 0) {
        parent.is_summary = false;
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
                // Go to first child
                mindmapSelectNode(node.children[0]);
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
                const parent = mindmapFindParent(mindmapTree, node);
                if (parent) {
                    mindmapSelectNode(parent);
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
            // Space: toggle collapse (TODO: future feature)
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

    // Find the bounding box of all nodes
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
        for (const child of node.children) walk(child);
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
function updateMindmap(tasks) {
    // Don't rebuild the tree while the user is actively editing a node —
    // the rebuild would destroy the inline input and discard unsynced nodes.
    if (document.querySelector('.mm-edit-fo')) return;

    mindmapTasks = tasks || [];

    // Build the tree
    const newTree = mindmapBuildTree(mindmapTasks);
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
