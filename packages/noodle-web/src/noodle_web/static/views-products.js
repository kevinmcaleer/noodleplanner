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

// Layout constants
const PBS_H_GAP = 200;
const PBS_V_GAP = 20;
const PBS_NODE_HEIGHT = 72;
const PBS_NODE_PADDING_X = 16;
const PBS_NODE_MIN_WIDTH = 160;
const PBS_NODE_MAX_WIDTH = 280;

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
    for (const t of allTasks) {
        if (t.parent === parentName && !t.deliverable && !t.is_summary) {
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

function pbsMeasure(node) {
    const textW = pbsMeasureText(node.name, 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
    node.width = Math.min(PBS_NODE_MAX_WIDTH, Math.max(PBS_NODE_MIN_WIDTH, textW + PBS_NODE_PADDING_X * 2 + 8));

    if (node.children.length === 0) {
        node.subtreeHeight = node.height;
        return;
    }

    let totalChildrenHeight = 0;
    for (const child of node.children) {
        pbsMeasure(child);
        totalChildrenHeight += child.subtreeHeight;
    }
    totalChildrenHeight += (node.children.length - 1) * PBS_V_GAP;
    node.subtreeHeight = Math.max(node.height, totalChildrenHeight);
}

function pbsLayoutTree(node, x, y) {
    node.x = x;
    node.y = y + (node.subtreeHeight - node.height) / 2;

    if (node.children.length === 0) return;

    let childY = y;
    const childX = x + node.width + PBS_H_GAP;
    for (const child of node.children) {
        pbsLayoutTree(child, childX, childY);
        childY += child.subtreeHeight + PBS_V_GAP;
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

    // Draw edges first (behind nodes)
    pbsRenderEdges(pbsTree);

    // Draw dependency arrows between deliverables
    pbsRenderDependencyArrows();

    // Draw nodes
    let colourIndex = 0;
    pbsRenderNode(pbsTree, null, () => {
        const c = PBS_COLOURS[colourIndex % PBS_COLOURS.length];
        colourIndex++;
        return c;
    }, 0);
}

function pbsRenderEdges(node) {
    for (const child of node.children) {
        const x1 = node.x + node.width;
        const y1 = node.y + node.height / 2;
        const x2 = child.x;
        const y2 = child.y + child.height / 2;
        const midX = (x1 + x2) / 2;

        const path = pbsCreateSVGElement('path', {
            'd': `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`,
            'fill': 'none',
            'stroke': '#666',
            'stroke-width': '2',
            'opacity': '0.5'
        });
        pbsGroup.appendChild(path);

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

function pbsRenderNode(node, parentColour, nextColour, depth) {
    const isRoot = !!node._isRoot;
    const colour = isRoot ? '#4A90D9' : (depth === 1 ? nextColour() : (parentColour ? pbsShadeColour(parentColour, 1.3) : '#4A90D9'));

    // Compute rollup status from child activities
    const rollup = node._task ? pbsComputeRollup(node._task, pbsTasks) : { percent: 0, activityCount: 0 };
    const pct = rollup.percent;
    const activities = node._task ? pbsGetActivities(node._task, pbsTasks) : [];
    const resources = node._task ? pbsGetResources(node._task, pbsTasks) : [];

    const g = pbsCreateSVGElement('g', {
        'class': 'pbs-node',
        'data-deliverable': node.deliverable || '',
        'data-task-name': node.name || '',
        'style': 'cursor: pointer;'
    });

    // Click handler — open task form
    g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (node.name && typeof openTaskFormByName === 'function') {
            if (typeof switchTab === 'function') switchTab('editor');
            openTaskFormByName(node.name);
        }
    });

    // Node rectangle
    const rect = pbsCreateSVGElement('rect', {
        'x': node.x,
        'y': node.y,
        'width': node.width,
        'height': node.height,
        'rx': '8',
        'ry': '8',
        'fill': colour,
        'stroke': pbsShadeColour(colour, 0.7),
        'stroke-width': '1.5',
        'class': 'pbs-node-rect'
    });
    g.appendChild(rect);

    // Node label (product name) — line 1
    const label = pbsCreateSVGElement('text', {
        'x': node.x + node.width / 2,
        'y': node.y + 18,
        'text-anchor': 'middle',
        'fill': '#fff',
        'font-size': '13',
        'font-weight': 'bold',
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });
    let displayName = node.name;
    const maxChars = Math.floor((node.width - PBS_NODE_PADDING_X * 2) / 7);
    if (displayName.length > maxChars) {
        displayName = displayName.substring(0, maxChars - 1) + '\u2026';
    }
    label.textContent = displayName;
    g.appendChild(label);

    // Subtitle line 2: deliverable ID + status
    if (node._task) {
        const statusText = pct === 100 ? 'Complete' : pct > 0 ? `${pct}%` : 'Not started';
        const sub = pbsCreateSVGElement('text', {
            'x': node.x + node.width / 2,
            'y': node.y + 33,
            'text-anchor': 'middle',
            'fill': 'rgba(255,255,255,0.8)',
            'font-size': '10',
            'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        });
        sub.textContent = `$${node.deliverable} \u00B7 ${statusText}`;
        g.appendChild(sub);

        // Line 3: activity count + resource count
        const infoLine = pbsCreateSVGElement('text', {
            'x': node.x + node.width / 2,
            'y': node.y + 47,
            'text-anchor': 'middle',
            'fill': 'rgba(255,255,255,0.6)',
            'font-size': '9',
            'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        });
        const infoParts = [];
        if (activities.length > 0) infoParts.push(`${activities.length} activities`);
        if (resources.length > 0) infoParts.push(`${resources.length} resources`);
        if (node._task.start && node._task.finish) {
            infoParts.push(`${node._task.start} \u2192 ${node._task.finish}`);
        }
        infoLine.textContent = infoParts.join(' \u00B7 ');
        g.appendChild(infoLine);

        // Progress bar
        const barY = node.y + node.height - 8;
        const barWidth = node.width - 16;
        const barX = node.x + 8;
        // Background
        g.appendChild(pbsCreateSVGElement('rect', {
            'x': barX, 'y': barY, 'width': barWidth, 'height': 4,
            'rx': '2', 'fill': 'rgba(0,0,0,0.2)'
        }));
        // Progress fill
        if (pct > 0) {
            const fillColour = pct === 100 ? 'rgba(92,184,92,0.9)' : 'rgba(255,255,255,0.7)';
            g.appendChild(pbsCreateSVGElement('rect', {
                'x': barX, 'y': barY, 'width': barWidth * (pct / 100), 'height': 4,
                'rx': '2', 'fill': fillColour
            }));
        }
    }

    // Tooltip on hover
    const title = pbsCreateSVGElement('title', {});
    let tooltipText = node.name;
    if (node.deliverable) tooltipText += `\nProduct: $${node.deliverable}`;
    if (activities.length) tooltipText += `\nActivities: ${activities.length}`;
    if (resources.length) tooltipText += `\nSkills: ${resources.join(', ')}`;
    tooltipText += `\nProgress: ${pct}%`;
    if (node._task && node._task.start) tooltipText += `\nDates: ${node._task.start} \u2192 ${node._task.finish}`;
    tooltipText += '\n\nClick to edit';
    title.textContent = tooltipText;
    g.appendChild(title);

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
    let minX = node.x, maxX = node.x + node.width;
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
            if (typeof switchTab === 'function') switchTab('editor');
            if (typeof openTaskFormByName === 'function') openTaskFormByName(task.name);
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
