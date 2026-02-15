/**
 * Planning Room Module
 *
 * A structured, guided planning workflow with 3 stages:
 * 1. Outline - YAML-based Work Breakdown Structure (WBS)
 * 2. Flow - Visual dependency mapping with interactive diagram
 * 3. Schedule - Auto-generated plan.md from outline + dependencies
 *
 * Storage: localStorage (primary) + zip download/upload (backup)
 * Architecture: Multi-file state (outline.yaml, flow.json, plan.md)
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

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize Planning Room on page load
 */
function initPlanningRoom() {
    loadPlanningState();
    setupPlanningEventListeners();
    renderOutlineEditor();
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
 * Parse YAML outline and render tree view
 */
async function parseOutline() {
    const editor = document.getElementById('outlineEditor');
    const yamlContent = editor.value.trim();

    if (!yamlContent) {
        renderOutlineTree(null);
        return;
    }

    try {
        // Call backend to parse YAML
        const response = await fetch('/api/planning-room/parse-outline', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ yaml: yamlContent })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to parse YAML');
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
                <p>Edit the YAML on the left to see the task hierarchy</p>
            </div>
        `;
        return;
    }

    if (parsed.error) {
        treeView.innerHTML = `
            <div class="error-state">
                <p style="color: #d9534f;">❌ YAML Error</p>
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
 * Download outline as YAML file
 */
function downloadOutline() {
    const content = planningRoomState.outline.content || '';
    const blob = new Blob([content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'outline.yaml';
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Upload outline YAML file
 */
function uploadOutline() {
    // Create hidden file input if not exists
    let input = document.getElementById('outlineFileUpload');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'outlineFileUpload';
        input.accept = '.yaml,.yml';
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
// FLOW DIAGRAM (Phase 2 - Placeholder)
// ============================================================================

/**
 * Sync outline tasks to flow nodes
 */
function syncOutlineToFlow() {
    // Phase 2: Parse outline and create/update flow nodes
    console.log('syncOutlineToFlow - To be implemented in Phase 2');
}

/**
 * Render flow diagram
 */
function renderFlowDiagram() {
    const canvas = document.getElementById('flowCanvas');
    if (!canvas) return;

    const emptyState = document.getElementById('flowEmptyState');

    if (planningRoomState.flow.nodes.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Phase 2: Render SVG nodes and edges
    console.log('renderFlowDiagram - To be implemented in Phase 2');
}

/**
 * Auto-layout flow diagram
 */
function autoLayoutFlow() {
    // Phase 2: Implement topological sort + layer assignment
    console.log('autoLayoutFlow - To be implemented in Phase 2');
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

// ============================================================================
// INITIALIZATION ON PAGE LOAD
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlanningRoom);
} else {
    initPlanningRoom();
}
