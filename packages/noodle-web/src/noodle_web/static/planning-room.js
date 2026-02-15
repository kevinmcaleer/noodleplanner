/**
 * Planning Room Module
 *
 * A structured, guided planning workflow with 3 stages:
 * 1. Outline - Markdown-based Work Breakdown Structure (WBS)
 * 2. Flow - Visual dependency mapping with interactive diagram
 * 3. Schedule - Auto-generated plan.md from outline + dependencies
 *
 * Storage: localStorage (primary) + zip download/upload (backup)
 * Architecture: Multi-file state (outline.md, flow.json, plan.md)
 */

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let planningRoomState = {
    outline: {
        content: '',
        lastModified: null
    },
    flow: {
        nodes: [],
        edges: [],
        lastModified: null
    },
    plan: {
        content: '',
        isGenerated: true,
        lastModified: null
    },
    currentStage: 'outline'
};

// Flow editor state
let flowState = {
    mode: 'select',  // 'pan', 'select', 'edge'
    zoom: 1.0,
    panX: 0,
    panY: 0,
    selectedNode: null,
    edgeSourceNode: null,
    isDragging: false,
    dragNode: null
};

// Undo/redo history
let undoHistory = {
    actions: [],  // Array of state snapshots
    currentIndex: -1,
    maxSize: 20
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize Planning Room on page load
 */
function initPlanningRoom() {
    loadPlanningState();
    setupPlanningEventListeners();
    setupFlowCanvasListeners();
    setupKeyboardShortcuts();
    renderOutlineEditor();

    // Save initial state for undo
    saveUndoState();

    console.log('Planning Room initialized');
}

/**
 * Load state from localStorage
 */
function loadPlanningState() {
    try {
        const saved = localStorage.getItem('planningRoomState');
        if (saved) {
            const parsed = JSON.parse(saved);
            planningRoomState = { ...planningRoomState, ...parsed };
            console.log('Planning Room state loaded from localStorage');
        }
    } catch (e) {
        console.error('Failed to load Planning Room state:', e);
    }
}

/**
 * Save state to localStorage
 */
function savePlanningState() {
    try {
        localStorage.setItem('planningRoomState', JSON.stringify(planningRoomState));
        console.log('Planning Room state saved to localStorage');
    } catch (e) {
        console.error('Failed to save Planning Room state:', e);
    }
}

/**
 * Setup event listeners
 */
function setupPlanningEventListeners() {
    // Auto-save outline editor with debounce
    const outlineEditor = document.getElementById('outlineEditor');
    if (outlineEditor) {
        let saveTimeout;
        outlineEditor.addEventListener('input', function() {
            planningRoomState.outline.content = this.value;
            planningRoomState.outline.lastModified = Date.now();

            // Debounce save (1 second)
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                savePlanningState();
                parseOutline(); // Auto-refresh tree view
            }, 1000);
        });
    }

    // Upload file inputs
    const outlineUpload = document.getElementById('outlineFileUpload');
    if (outlineUpload) {
        outlineUpload.addEventListener('change', handleOutlineUpload);
    }

    const flowUpload = document.getElementById('flowFileUpload');
    if (flowUpload) {
        flowUpload.addEventListener('change', handleFlowUpload);
    }
}

// ============================================================================
// STAGE SWITCHING
// ============================================================================

/**
 * Switch between Planning Room stages
 * @param {string} stage - 'outline', 'flow', or 'schedule'
 */
function switchPlanningStage(stage) {
    // Update state
    planningRoomState.currentStage = stage;

    // Update stage tabs
    document.querySelectorAll('.planning-stage-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`${stage}StageTab`).classList.add('active');

    // Update stage content
    document.querySelectorAll('.planning-stage').forEach(stageDiv => {
        stageDiv.classList.remove('active');
    });
    document.getElementById(`${stage}-stage`).classList.add('active');

    // Stage-specific actions
    if (stage === 'flow') {
        syncOutlineToFlow();
        renderFlowDiagram();
    } else if (stage === 'schedule') {
        // Auto-generate plan if not already done
        if (!planningRoomState.plan.content || planningRoomState.plan.isGenerated) {
            generatePlan();
        }
    }

    savePlanningState();
}

// ============================================================================
// OUTLINE EDITOR (Phase 1)
// ============================================================================

/**
 * Render outline editor with current content
 */
function renderOutlineEditor() {
    const editor = document.getElementById('outlineEditor');
    if (editor && planningRoomState.outline.content) {
        editor.value = planningRoomState.outline.content;
    }
}

/**
 * Parse markdown outline and render tree view
 */
async function parseOutline() {
    const editor = document.getElementById('outlineEditor');
    const yamlContent = editor.value.trim();

    if (!yamlContent) {
        renderOutlineTree(null);
        return;
    }

    try {
        // Call backend to parse markdown outline
        const response = await fetch('/api/planning-room/parse-outline', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ yaml: yamlContent })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to parse outline');
        }

        const parsed = await response.json();
        renderOutlineTree(parsed);

    } catch (e) {
        console.error('Failed to parse outline:', e);
        renderOutlineTree({ error: e.message });
    }
}

/**
 * Render tree view of outline
 * @param {object} parsed - Parsed outline data or null
 */
function renderOutlineTree(parsed) {
    const treeView = document.getElementById('outlineTreeView');
    if (!treeView) return;

    if (!parsed) {
        treeView.innerHTML = `
            <div class="empty-state">
                <p>Tree preview will appear here</p>
                <p>Edit the outline on the left to see the task hierarchy</p>
            </div>
        `;
        return;
    }

    if (parsed.error) {
        treeView.innerHTML = `
            <div class="error-state">
                <p style="color: #d9534f;">❌ Parse Error</p>
                <p style="font-size: 0.9em;">${escapeHtml(parsed.error)}</p>
            </div>
        `;
        return;
    }

    // Build tree HTML
    let html = '<div class="outline-tree">';

    // Project info
    if (parsed.project) {
        html += '<div class="tree-node tree-project">';
        html += `<span class="tree-icon">📦</span>`;
        html += `<strong>${escapeHtml(parsed.project.name || 'Untitled Project')}</strong>`;
        if (parsed.project.start_date) {
            html += ` <span class="tree-meta">(Start: ${escapeHtml(parsed.project.start_date)})</span>`;
        }
        html += '</div>';

        // Resources
        if (parsed.project.resources && parsed.project.resources.length > 0) {
            html += '<div class="tree-node tree-resources">';
            html += '<span class="tree-icon">👥</span>';
            html += '<strong>Resources:</strong> ';
            html += parsed.project.resources.map(r =>
                `<span class="resource-badge">@${escapeHtml(r.id)}</span>`
            ).join(' ');
            html += '</div>';
        }
    }

    // Phases and tasks
    if (parsed.phases && parsed.phases.length > 0) {
        parsed.phases.forEach((phase, phaseIdx) => {
            html += renderPhaseNode(phase, phaseIdx);
        });
    }

    html += '</div>';
    treeView.innerHTML = html;
}

/**
 * Render a phase node in the tree
 */
function renderPhaseNode(phase, phaseIdx) {
    let html = '<div class="tree-node tree-phase">';
    html += `<span class="tree-icon">📂</span>`;
    html += `<strong>Phase ${phaseIdx + 1}:</strong> ${escapeHtml(phase.name)}`;
    html += '</div>';

    if (phase.tasks && phase.tasks.length > 0) {
        html += '<div class="tree-children">';
        phase.tasks.forEach((task, taskIdx) => {
            html += renderTaskNode(task, `${phaseIdx + 1}.${taskIdx + 1}`, 1);
        });
        html += '</div>';
    }

    return html;
}

/**
 * Render a task node in the tree (recursive for children)
 */
function renderTaskNode(task, number, depth) {
    let html = '<div class="tree-node tree-task">';
    html += `<span class="tree-icon">${depth === 1 ? '📋' : '📌'}</span>`;
    html += `<span class="tree-number">${number}</span> `;
    html += escapeHtml(task.name);

    if (task.duration) {
        html += ` <span class="tree-meta">(${escapeHtml(task.duration)})</span>`;
    }

    if (task.resources && task.resources.length > 0) {
        html += ' ';
        task.resources.forEach(res => {
            html += `<span class="resource-badge">${escapeHtml(res)}</span>`;
        });
    }

    html += '</div>';

    // Render children recursively
    if (task.children && task.children.length > 0) {
        html += '<div class="tree-children">';
        task.children.forEach((child, childIdx) => {
            html += renderTaskNode(child, `${number}.${childIdx + 1}`, depth + 1);
        });
        html += '</div>';
    }

    return html;
}

/**
 * Download outline as markdown file
 */
function downloadOutline() {
    const content = planningRoomState.outline.content || '';
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'outline.md';
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Upload outline markdown file
 */
function uploadOutline() {
    // Create hidden file input if not exists
    let input = document.getElementById('outlineFileUpload');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'outlineFileUpload';
        input.accept = '.md,.txt';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', handleOutlineUpload);
    }
    input.click();
}

/**
 * Handle outline file upload
 */
function handleOutlineUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        planningRoomState.outline.content = content;
        planningRoomState.outline.lastModified = Date.now();

        renderOutlineEditor();
        parseOutline();
        savePlanningState();
    };
    reader.readAsText(file);

    // Reset input
    event.target.value = '';
}

/**
 * Clear outline
 */
function clearOutline() {
    if (confirm('Clear the outline? This cannot be undone.')) {
        planningRoomState.outline.content = '';
        planningRoomState.outline.lastModified = Date.now();
        renderOutlineEditor();
        renderOutlineTree(null);
        savePlanningState();
    }
}

// ============================================================================
// FLOW DIAGRAM (Phase 2)
// ============================================================================

/**
 * Sync outline tasks to flow nodes
 * Creates/updates nodes from outline, preserves existing positions
 */
async function syncOutlineToFlow() {
    const editor = document.getElementById('outlineEditor');
    const yamlContent = editor.value.trim();

    if (!yamlContent) {
        planningRoomState.flow.nodes = [];
        planningRoomState.flow.edges = [];
        renderFlowDiagram();
        return;
    }

    try {
        // Parse outline via backend
        const response = await fetch('/api/planning-room/parse-outline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml: yamlContent })
        });

        if (!response.ok) return;

        const parsed = await response.json();

        // Extract all tasks from phases
        const tasks = [];
        if (parsed.phases) {
            parsed.phases.forEach((phase, phaseIdx) => {
                if (phase.tasks) {
                    extractTasksRecursive(phase.tasks, `Phase ${phaseIdx + 1}: ${phase.name}`, '', tasks);
                }
            });
        }

        // Create node map from existing nodes
        const existingNodes = new Map();
        planningRoomState.flow.nodes.forEach(node => {
            existingNodes.set(node.taskPath, node);
        });

        // Create new nodes, preserving positions
        const newNodes = [];
        tasks.forEach((task, idx) => {
            const existing = existingNodes.get(task.path);
            const nodeId = existing ? existing.id : `node-${Date.now()}-${idx}`;

            newNodes.push({
                id: nodeId,
                name: task.name,
                taskPath: task.path,
                duration: task.duration || '',
                resources: task.resources || [],
                position: existing ? existing.position : { x: 100 + (idx % 5) * 200, y: 100 + Math.floor(idx / 5) * 120 }
            });
        });

        planningRoomState.flow.nodes = newNodes;

        // Remove edges that reference deleted nodes
        const nodeIds = new Set(newNodes.map(n => n.id));
        planningRoomState.flow.edges = planningRoomState.flow.edges.filter(edge =>
            nodeIds.has(edge.source) && nodeIds.has(edge.target)
        );

        planningRoomState.flow.lastModified = Date.now();
        savePlanningState();
        renderFlowDiagram();

    } catch (e) {
        console.error('Failed to sync outline to flow:', e);
    }
}

/**
 * Extract tasks recursively from outline structure
 */
function extractTasksRecursive(tasks, phaseName, parentPath, result) {
    tasks.forEach((task, idx) => {
        const taskNumber = parentPath ? `${parentPath}.${idx + 1}` : `${idx + 1}`;
        const taskPath = parentPath ? `${phaseName} > ${parentPath} > ${task.name}` : `${phaseName} > ${task.name}`;

        result.push({
            name: task.name,
            path: taskPath,
            number: taskNumber,
            duration: task.duration,
            resources: task.resources
        });

        // Recurse into children
        if (task.children && task.children.length > 0) {
            extractTasksRecursive(task.children, phaseName, taskNumber, result);
        }
    });
}

/**
 * Render flow diagram with SVG
 */
function renderFlowDiagram() {
    const canvas = document.getElementById('flowCanvas');
    if (!canvas) return;

    const emptyState = document.getElementById('flowEmptyState');
    const nodesGroup = document.getElementById('flowNodesGroup');
    const edgesGroup = document.getElementById('flowEdgesGroup');

    if (!nodesGroup || !edgesGroup) return;

    if (planningRoomState.flow.nodes.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        nodesGroup.innerHTML = '';
        edgesGroup.innerHTML = '';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Clear existing content
    nodesGroup.innerHTML = '';
    edgesGroup.innerHTML = '';

    // Apply transform for zoom/pan
    const transform = `translate(${flowState.panX}, ${flowState.panY}) scale(${flowState.zoom})`;
    nodesGroup.setAttribute('transform', transform);
    edgesGroup.setAttribute('transform', transform);

    // Render edges first (so they appear behind nodes)
    planningRoomState.flow.edges.forEach(edge => {
        renderEdge(edge, edgesGroup);
    });

    // Render nodes
    planningRoomState.flow.nodes.forEach(node => {
        renderNode(node, nodesGroup);
    });
}

/**
 * Render a single node
 */
function renderNode(node, group) {
    const nodeWidth = 180;
    const nodeHeight = 80;

    // Create group for node
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'flow-node');
    g.setAttribute('data-node-id', node.id);
    g.setAttribute('transform', `translate(${node.position.x}, ${node.position.y})`);

    // Rectangle
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', nodeWidth);
    rect.setAttribute('height', nodeHeight);
    rect.setAttribute('rx', 6);

    // Name text
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', nodeWidth / 2);
    text.setAttribute('y', 25);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-weight', 'bold');
    text.textContent = truncateText(node.name, 20);

    // Duration text
    if (node.duration) {
        const durationText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        durationText.setAttribute('x', nodeWidth / 2);
        durationText.setAttribute('y', 45);
        durationText.setAttribute('text-anchor', 'middle');
        durationText.setAttribute('font-size', '12');
        durationText.setAttribute('fill', '#6c757d');
        durationText.textContent = node.duration;
        g.appendChild(durationText);
    }

    // Resources text
    if (node.resources && node.resources.length > 0) {
        const resourceText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        resourceText.setAttribute('x', nodeWidth / 2);
        resourceText.setAttribute('y', 65);
        resourceText.setAttribute('text-anchor', 'middle');
        resourceText.setAttribute('font-size', '11');
        resourceText.setAttribute('fill', '#007bff');
        resourceText.textContent = node.resources.join(' ');
        g.appendChild(resourceText);
    }

    g.appendChild(rect);
    g.appendChild(text);

    // Add event listeners
    g.addEventListener('mousedown', (e) => onNodeMouseDown(e, node));
    g.addEventListener('click', (e) => onNodeClick(e, node));

    group.appendChild(g);
}

/**
 * Render a single edge
 */
function renderEdge(edge, group) {
    const sourceNode = planningRoomState.flow.nodes.find(n => n.id === edge.source);
    const targetNode = planningRoomState.flow.nodes.find(n => n.id === edge.target);

    if (!sourceNode || !targetNode) return;

    const nodeWidth = 180;
    const nodeHeight = 80;

    // Calculate edge endpoints
    const x1 = sourceNode.position.x + nodeWidth;
    const y1 = sourceNode.position.y + nodeHeight / 2;
    const x2 = targetNode.position.x;
    const y2 = targetNode.position.y + nodeHeight / 2;

    // Create path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${x1} ${y1} L ${x2} ${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('class', 'flow-edge');
    path.setAttribute('data-edge-id', edge.id);

    // Add click handler for edge deletion
    path.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            deleteEdge(edge.id);
        }
    });

    group.appendChild(path);
}

/**
 * Auto-layout flow diagram using layered layout
 */
function autoLayoutFlow() {
    if (planningRoomState.flow.nodes.length === 0) return;

    // Build adjacency map
    const adjacency = new Map();
    planningRoomState.flow.nodes.forEach(node => {
        adjacency.set(node.id, []);
    });

    planningRoomState.flow.edges.forEach(edge => {
        if (adjacency.has(edge.source)) {
            adjacency.get(edge.source).push(edge.target);
        }
    });

    // Topological sort with layer assignment
    const layers = [];
    const visited = new Set();
    const inDegree = new Map();

    // Calculate in-degree
    planningRoomState.flow.nodes.forEach(node => {
        inDegree.set(node.id, 0);
    });
    planningRoomState.flow.edges.forEach(edge => {
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    });

    // Start with nodes that have no incoming edges
    let currentLayer = planningRoomState.flow.nodes
        .filter(node => inDegree.get(node.id) === 0)
        .map(node => node.id);

    if (currentLayer.length === 0) {
        // No roots found, use all nodes (graph may have cycles)
        currentLayer = planningRoomState.flow.nodes.map(node => node.id);
    }

    // Layer assignment
    while (currentLayer.length > 0) {
        layers.push([...currentLayer]);
        currentLayer.forEach(id => visited.add(id));

        const nextLayer = new Set();
        currentLayer.forEach(nodeId => {
            const neighbors = adjacency.get(nodeId) || [];
            neighbors.forEach(neighborId => {
                if (!visited.has(neighborId)) {
                    nextLayer.add(neighborId);
                }
            });
        });

        currentLayer = Array.from(nextLayer);
    }

    // Add any remaining nodes (disconnected)
    planningRoomState.flow.nodes.forEach(node => {
        if (!visited.has(node.id)) {
            layers.push([node.id]);
        }
    });

    // Position nodes
    const layerSpacing = 250;
    const nodeSpacing = 120;
    const startX = 100;
    const startY = 100;

    layers.forEach((layer, layerIdx) => {
        const x = startX + layerIdx * layerSpacing;

        layer.forEach((nodeId, nodeIdx) => {
            const node = planningRoomState.flow.nodes.find(n => n.id === nodeId);
            if (node) {
                node.position.x = x;
                node.position.y = startY + nodeIdx * nodeSpacing;
            }
        });
    });

    planningRoomState.flow.lastModified = Date.now();
    savePlanningState();
    renderFlowDiagram();
}

/**
 * Handle node mouse down (start drag)
 */
function onNodeMouseDown(event, node) {
    if (flowState.mode !== 'select') return;

    event.stopPropagation();

    flowState.isDragging = true;
    flowState.dragNode = node;
    flowState.dragStartX = event.clientX;
    flowState.dragStartY = event.clientY;
    flowState.dragNodeStartX = node.position.x;
    flowState.dragNodeStartY = node.position.y;

    // Add global mouse move and up listeners
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('mouseup', onDocumentMouseUp);
}

/**
 * Handle document mouse move (during drag)
 */
function onDocumentMouseMove(event) {
    if (!flowState.isDragging || !flowState.dragNode) return;

    const dx = (event.clientX - flowState.dragStartX) / flowState.zoom;
    const dy = (event.clientY - flowState.dragStartY) / flowState.zoom;

    flowState.dragNode.position.x = flowState.dragNodeStartX + dx;
    flowState.dragNode.position.y = flowState.dragNodeStartY + dy;

    renderFlowDiagram();
}

/**
 * Handle document mouse up (end drag)
 */
function onDocumentMouseUp(event) {
    if (flowState.isDragging) {
        flowState.isDragging = false;
        flowState.dragNode = null;

        planningRoomState.flow.lastModified = Date.now();
        savePlanningState();
    }

    document.removeEventListener('mousemove', onDocumentMouseMove);
    document.removeEventListener('mouseup', onDocumentMouseUp);
}

/**
 * Handle node click
 */
function onNodeClick(event, node) {
    event.stopPropagation();

    if (flowState.mode === 'edge') {
        // Edge creation mode
        if (!flowState.edgeSourceNode) {
            // Select source node
            flowState.edgeSourceNode = node;
            selectNode(node.id);
        } else {
            // Create edge from source to target
            if (flowState.edgeSourceNode.id !== node.id) {
                createEdge(flowState.edgeSourceNode.id, node.id);
            }
            flowState.edgeSourceNode = null;
            deselectAllNodes();
        }
    } else if (flowState.mode === 'select') {
        // Select mode - toggle selection
        if (flowState.selectedNode === node.id) {
            deselectAllNodes();
        } else {
            selectNode(node.id);
        }
    }
}

/**
 * Select a node
 */
function selectNode(nodeId) {
    flowState.selectedNode = nodeId;

    // Update visual selection
    document.querySelectorAll('.flow-node').forEach(el => {
        el.classList.remove('selected');
    });

    const nodeEl = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (nodeEl) {
        nodeEl.classList.add('selected');
    }
}

/**
 * Deselect all nodes
 */
function deselectAllNodes() {
    flowState.selectedNode = null;
    document.querySelectorAll('.flow-node').forEach(el => {
        el.classList.remove('selected');
    });
}

/**
 * Create edge between two nodes
 */
function createEdge(sourceId, targetId) {
    // Check if edge already exists
    const exists = planningRoomState.flow.edges.some(edge =>
        edge.source === sourceId && edge.target === targetId
    );

    if (exists) {
        console.log('Edge already exists');
        return;
    }

    // Create new edge
    const edge = {
        id: `edge-${Date.now()}`,
        source: sourceId,
        target: targetId,
        type: 'FS',  // Finish-Start
        lag: ''
    };

    planningRoomState.flow.edges.push(edge);
    planningRoomState.flow.lastModified = Date.now();
    savePlanningState();
    renderFlowDiagram();
}

/**
 * Delete edge
 */
function deleteEdge(edgeId) {
    planningRoomState.flow.edges = planningRoomState.flow.edges.filter(e => e.id !== edgeId);
    planningRoomState.flow.lastModified = Date.now();
    savePlanningState();
    renderFlowDiagram();
}

/**
 * Setup flow canvas event listeners
 */
function setupFlowCanvasListeners() {
    const canvas = document.getElementById('flowCanvas');
    if (!canvas) return;

    // Pan mode
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartOffsetX = 0;
    let panStartOffsetY = 0;

    canvas.addEventListener('mousedown', (e) => {
        if (flowState.mode === 'pan') {
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panStartOffsetX = flowState.panX;
            panStartOffsetY = flowState.panY;
        } else if (flowState.mode === 'edge' && flowState.edgeSourceNode) {
            // Click on empty canvas cancels edge creation
            flowState.edgeSourceNode = null;
            deselectAllNodes();
            renderFlowDiagram();
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const dx = e.clientX - panStartX;
            const dy = e.clientY - panStartY;

            flowState.panX = panStartOffsetX + dx;
            flowState.panY = panStartOffsetY + dy;

            renderFlowDiagram();
        }
    });

    canvas.addEventListener('mouseup', () => {
        isPanning = false;
    });

    canvas.addEventListener('mouseleave', () => {
        isPanning = false;
    });

    // Zoom with mouse wheel
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;

        flowState.zoom = Math.max(0.1, Math.min(3.0, flowState.zoom + delta));

        renderFlowDiagram();
    });
}

/**
 * Truncate text to max length
 */
function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Reset flow zoom/pan
 */
function resetFlowZoom() {
    flowState.zoom = 1.0;
    flowState.panX = 0;
    flowState.panY = 0;
    renderFlowDiagram();
}

/**
 * Set flow interaction mode
 */
function setFlowMode(mode) {
    flowState.mode = mode;

    // Update button states
    document.querySelectorAll('[id^="flowMode"]').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`flowMode${mode.charAt(0).toUpperCase() + mode.slice(1)}`).classList.add('active');
}

/**
 * Download flow as JSON file
 */
function downloadFlow() {
    const content = JSON.stringify({
        nodes: planningRoomState.flow.nodes,
        edges: planningRoomState.flow.edges
    }, null, 2);

    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flow.json';
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// PLAN GENERATION (Phase 3 - Placeholder)
// ============================================================================

/**
 * Generate plan.md from outline + flow
 */
async function generatePlan() {
    const statusDiv = document.getElementById('scheduleStatus');
    const previewDiv = document.getElementById('schedulePlanPreview');

    if (!planningRoomState.outline.content) {
        if (statusDiv) statusDiv.textContent = '⚠️ No outline to generate from';
        return;
    }

    if (statusDiv) statusDiv.textContent = '⏳ Generating plan...';

    try {
        // Phase 3: Call backend to generate plan
        const response = await fetch('/api/planning-room/generate-plan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                outline: planningRoomState.outline.content,
                flow: {
                    nodes: planningRoomState.flow.nodes,
                    edges: planningRoomState.flow.edges
                }
            })
        });

        if (!response.ok) {
            throw new Error('Failed to generate plan');
        }

        const result = await response.json();
        planningRoomState.plan.content = result.plan;
        planningRoomState.plan.isGenerated = true;
        planningRoomState.plan.lastModified = Date.now();

        if (previewDiv) {
            previewDiv.textContent = result.plan;
        }

        if (statusDiv) statusDiv.textContent = '✅ Plan generated';

        savePlanningState();

    } catch (e) {
        console.error('Failed to generate plan:', e);
        if (statusDiv) statusDiv.textContent = '❌ Generation failed';
    }
}

/**
 * Copy plan to Editor
 */
function copyToEditor() {
    if (!planningRoomState.plan.content) {
        alert('No plan to copy. Generate a plan first.');
        return;
    }

    // Copy to editor textarea
    const editor = document.getElementById('planEditor');
    if (editor) {
        editor.value = planningRoomState.plan.content;

        // Trigger render
        renderPlan();

        // Switch to editor tab
        switchTab('editor');
    }
}

/**
 * Download plan as .md file
 */
function downloadPlan() {
    const content = planningRoomState.plan.content || '';
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plan.md';
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// ZIP EXPORT/IMPORT (Phase 4)
// ============================================================================

/**
 * Export all Planning Room files as a zip
 */
async function exportPlanningRoomZip() {
    try {
        // Dynamically import JSZip (assuming it's available globally or via CDN)
        // For now, create a simple download of individual files
        // Full zip implementation would require JSZip library

        // Generate all three files
        const outline = planningRoomState.outline.content || '';
        const flow = JSON.stringify({
            nodes: planningRoomState.flow.nodes,
            edges: planningRoomState.flow.edges
        }, null, 2);
        const plan = planningRoomState.plan.content || '';

        // Create download links for each file
        downloadFile(outline, 'outline.md', 'text/markdown');
        setTimeout(() => downloadFile(flow, 'flow.json', 'application/json'), 300);
        setTimeout(() => downloadFile(plan, 'plan.md', 'text/markdown'), 600);

        console.log('Planning Room files exported');
    } catch (e) {
        console.error('Failed to export Planning Room:', e);
        alert('Failed to export files. Please try individual downloads.');
    }
}

/**
 * Helper to download a file
 */
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Import Planning Room from uploaded files
 */
async function importPlanningRoomZip() {
    // For Phase 4, provide individual file upload
    // Full zip import would require JSZip library
    alert('Import feature: Please upload files individually using the upload buttons in each stage.');
}

// ============================================================================
// UNDO/REDO (Phase 4)
// ============================================================================

/**
 * Save current state to undo history
 */
function saveUndoState() {
    // Create snapshot of current state
    const snapshot = {
        outline: { ...planningRoomState.outline },
        flow: {
            nodes: JSON.parse(JSON.stringify(planningRoomState.flow.nodes)),
            edges: JSON.parse(JSON.stringify(planningRoomState.flow.edges))
        },
        plan: { ...planningRoomState.plan }
    };

    // Remove any redo history after current position
    undoHistory.actions = undoHistory.actions.slice(0, undoHistory.currentIndex + 1);

    // Add new snapshot
    undoHistory.actions.push(snapshot);

    // Limit history size
    if (undoHistory.actions.length > undoHistory.maxSize) {
        undoHistory.actions.shift();
    } else {
        undoHistory.currentIndex++;
    }
}

/**
 * Undo last action
 */
function undo() {
    if (undoHistory.currentIndex > 0) {
        undoHistory.currentIndex--;
        restoreState(undoHistory.actions[undoHistory.currentIndex]);
        console.log('Undo:', undoHistory.currentIndex);
    } else {
        console.log('Nothing to undo');
    }
}

/**
 * Redo last undone action
 */
function redo() {
    if (undoHistory.currentIndex < undoHistory.actions.length - 1) {
        undoHistory.currentIndex++;
        restoreState(undoHistory.actions[undoHistory.currentIndex]);
        console.log('Redo:', undoHistory.currentIndex);
    } else {
        console.log('Nothing to redo');
    }
}

/**
 * Restore state from snapshot
 */
function restoreState(snapshot) {
    planningRoomState.outline = { ...snapshot.outline };
    planningRoomState.flow.nodes = JSON.parse(JSON.stringify(snapshot.flow.nodes));
    planningRoomState.flow.edges = JSON.parse(JSON.stringify(snapshot.flow.edges));
    planningRoomState.plan = { ...snapshot.plan };

    // Re-render current stage
    renderOutlineEditor();
    parseOutline();
    renderFlowDiagram();

    savePlanningState();
}

// ============================================================================
// KEYBOARD SHORTCUTS (Phase 4)
// ============================================================================

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Only handle shortcuts when Planning tab is active
        const planningTab = document.getElementById('planning-tab');
        if (!planningTab || !planningTab.classList.contains('active')) {
            return;
        }

        // Ctrl/Cmd + S: Save (already auto-saves, but trigger manual save)
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            savePlanningState();
            console.log('Manual save triggered');
            // Show brief confirmation
            showNotification('Saved to localStorage', 'success');
        }

        // Ctrl/Cmd + L: Auto-layout flow
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            if (planningRoomState.currentStage === 'flow') {
                autoLayoutFlow();
                showNotification('Auto-layout applied', 'success');
            }
        }

        // Ctrl/Cmd + G: Generate plan
        if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
            e.preventDefault();
            if (planningRoomState.currentStage === 'schedule') {
                generatePlan();
            }
        }

        // Ctrl/Cmd + Z: Undo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
            showNotification('Undo', 'info');
        }

        // Ctrl/Cmd + Shift + Z: Redo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
            e.preventDefault();
            redo();
            showNotification('Redo', 'info');
        }

        // Ctrl/Cmd + Y: Redo (alternative)
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            redo();
            showNotification('Redo', 'info');
        }

        // Escape: Cancel edge creation
        if (e.key === 'Escape') {
            if (flowState.edgeSourceNode) {
                flowState.edgeSourceNode = null;
                deselectAllNodes();
                renderFlowDiagram();
                showNotification('Edge creation cancelled', 'info');
            }
        }
    });
}

/**
 * Show brief notification
 */
function showNotification(message, type = 'info') {
    // Simple notification system
    const notification = document.createElement('div');
    notification.className = `planning-notification planning-notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
        color: white;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        font-size: 14px;
        opacity: 0;
        transition: opacity 0.3s;
    `;

    document.body.appendChild(notification);

    // Fade in
    setTimeout(() => notification.style.opacity = '1', 10);

    // Fade out and remove
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show Planning Room help modal
 */
function showPlanningHelp() {
    const overlay = document.getElementById('planningHelpOverlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

/**
 * Close Planning Room help modal
 */
function closePlanningHelp() {
    const overlay = document.getElementById('planningHelpOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

// ============================================================================
// INITIALIZATION ON PAGE LOAD
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlanningRoom);
} else {
    initPlanningRoom();
}
