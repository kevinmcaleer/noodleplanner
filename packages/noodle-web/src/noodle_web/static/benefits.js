/**
 * Benefits Realisation Management View
 * Provides a visual benefits map with SVG canvas showing the flow from
 * Enablers -> Business Changes -> Benefits/Disbenefits -> Objectives.
 * Uses SVG rendering with pan/zoom, similar to mindmap.js.
 */

// ── Layout constants ─────────────────────────────────────────────────
const BEN_COL_GAP = 280;         // horizontal gap between columns
const BEN_ROW_GAP = 24;          // vertical gap between nodes in a column
const BEN_NODE_WIDTH = 200;      // default node width
const BEN_NODE_HEIGHT = 60;      // default node height
const BEN_PADDING_X = 60;        // left padding for first column
const BEN_PADDING_Y = 60;        // top padding
const BEN_ANIM_DURATION = 350;   // ms for zoom animation

// Column assignments (left to right)
const BEN_COLUMNS = {
    enabler: 0,
    change: 1,
    benefit: 2,
    disbenefit: 2,
    objective: 3
};

// Node colours per type
const BEN_COLOURS = {
    benefit:    { fill: '#3B82F6', text: '#FFFFFF', stroke: '#2563EB' },
    enabler:    { fill: '#EAB308', text: '#1A1A1A', stroke: '#CA8A04' },
    change:     { fill: '#FFFFFF', text: '#1A1A1A', stroke: '#6B7280' },
    disbenefit: { fill: '#EF4444', text: '#FFFFFF', stroke: '#DC2626' },
    objective:  { fill: '#22C55E', text: '#FFFFFF', stroke: '#16A34A' }
};

// Column labels
const BEN_COL_LABELS = ['Enablers', 'Business Changes', 'Benefits / Disbenefits', 'Objectives'];

// ── Canvas state ─────────────────────────────────────────────────────
let benSvg = null;
let benGroup = null;
let benZoom = 1;
let benPanX = 0;
let benPanY = 0;
let benIsDragging = false;
let benDragStartX = 0;
let benDragStartY = 0;
let benDragStartPanX = 0;
let benDragStartPanY = 0;
let benTouchStartDist = 0;
let benTouchStartZoom = 1;
let benSelectedNodeId = null;

// ── Markdown parsing ─────────────────────────────────────────────────

/**
 * Parse benefits markdown table into benefitItems array.
 * Expects the section between ---benefits--- and the next section marker.
 */
function parseBenefitsMarkdown(text) {
    if (!text) return [];

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Find the elements table header
    const headerKeywords = ['id', 'type', 'title'];
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (lower.includes('|') && headerKeywords.every(kw => lower.includes(kw))) {
            headerIndex = i;
            break;
        }
    }

    if (headerIndex === -1) return [];

    const parseRow = (line) => {
        const parts = line.split(/(?<!\\)\|/).map(cell => cell.trim());
        return parts.filter((cell, idx) => idx > 0 && idx < parts.length - 1);
    };

    const headers = parseRow(lines[headerIndex]).map(h => h.toLowerCase().trim());

    // Build column mapping
    const colMap = {};
    const aliases = {
        'id': 'id', 'type': 'type', 'title': 'title',
        'description': 'description', 'objective type': 'objectiveType',
        'target value': 'targetValue', 'current value': 'currentValue',
        'target date': 'targetDate', 'measurement': 'measurementMethod',
        'linked to': 'linkedTo', 'contribution %': 'contributionPercent'
    };

    headers.forEach((h, idx) => {
        for (const [alias, field] of Object.entries(aliases)) {
            if (h.includes(alias)) {
                colMap[field] = idx;
                break;
            }
        }
    });

    const items = [];
    let maxId = 0;

    // Skip header and separator line
    for (let i = headerIndex + 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('|')) break;
        // Stop at tracking table header
        if (line.toLowerCase().includes('benefit id') && line.toLowerCase().includes('status')) break;
        // Stop at sub-heading
        if (line.startsWith('##')) break;

        const cells = parseRow(line);
        if (cells.length < 3) continue;

        const get = (field) => (colMap[field] !== undefined && cells[colMap[field]]) ? cells[colMap[field]].replace(/\\\\\\|/g, '|').trim() : '';

        const id = parseInt(get('id'), 10) || 0;
        if (id > maxId) maxId = id;

        const linkedToStr = get('linkedTo');
        const linkedTo = linkedToStr ? linkedToStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];

        items.push({
            id: id,
            type: get('type').toLowerCase() || 'benefit',
            title: get('title'),
            description: get('description'),
            objectiveType: get('objectiveType'),
            targetValue: get('targetValue'),
            currentValue: get('currentValue'),
            targetDate: get('targetDate'),
            measurementMethod: get('measurementMethod'),
            linkedTo: linkedTo,
            contributionPercent: parseInt(get('contributionPercent'), 10) || 0,
            score: 0
        });
    }

    return { items, maxId };
}

/**
 * Generate benefits markdown table from benefitItems.
 */
function generateBenefitsMarkdown() {
    const headers = ['ID', 'Type', 'Title', 'Description', 'Objective Type', 'Target Value', 'Current Value', 'Target Date', 'Measurement', 'Linked To', 'Contribution %'];

    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const rows = benefitItems.map(item => [
        String(item.id),
        item.type,
        escPipe(item.title),
        escPipe(item.description),
        escPipe(item.objectiveType || ''),
        escPipe(item.targetValue || ''),
        escPipe(item.currentValue || ''),
        escPipe(item.targetDate || ''),
        escPipe(item.measurementMethod || ''),
        item.linkedTo.length > 0 ? item.linkedTo.join(', ') : '',
        String(item.contributionPercent || 0)
    ]);

    const widths = headers.map(h => h.length);
    rows.forEach(row => {
        row.forEach((cell, i) => {
            widths[i] = Math.max(widths[i], cell.length);
        });
    });

    const pad = (str, width) => str + ' '.repeat(Math.max(0, width - str.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    let md = '# Benefits Map\n\n';
    md += formatRow(headers) + '\n';
    md += separator + '\n';
    rows.forEach(row => {
        md += formatRow(row) + '\n';
    });

    return md;
}

/**
 * Sync benefits data back to the plan editor text.
 */
function syncBenefitsToPlanText() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const planText = editor.value;
    const table = generateBenefitsMarkdown();

    // Find section boundaries
    const benStart = planText.indexOf(BENEFITS_START);
    const budgetStart = planText.indexOf(BUDGET_START);
    const raidStart = planText.indexOf(RAID_LOG_START);
    const baselineStart = planText.indexOf(BASELINE_START);

    // Find the end of the benefits section (next section marker)
    let benEnd = planText.length;
    if (benStart !== -1) {
        for (const marker of [BUDGET_START, RAID_LOG_START, BASELINE_START, COMMS_START]) {
            const idx = planText.indexOf(marker, benStart + BENEFITS_START.length);
            if (idx !== -1 && idx < benEnd) benEnd = idx;
        }
    }

    let updatedText;
    if (benStart !== -1) {
        // Replace existing benefits section
        const before = planText.substring(0, benStart);
        const after = planText.substring(benEnd);
        updatedText = before + BENEFITS_START + '\n' + table + '\n' + after;
    } else {
        // Insert before budget/raid/baseline (whichever comes first)
        let insertIdx = planText.length;
        for (const marker of [BUDGET_START, RAID_LOG_START, BASELINE_START, COMMS_START]) {
            const idx = planText.indexOf(marker);
            if (idx !== -1 && idx < insertIdx) insertIdx = idx;
        }

        const before = planText.substring(0, insertIdx).replace(/\n+$/, '');
        const after = planText.substring(insertIdx);
        updatedText = before + '\n\n' + BENEFITS_START + '\n' + table + '\n' + after;
    }

    if (updatedText !== planText) {
        if (typeof setEditorValuePreservingCursor === 'function') {
            setEditorValuePreservingCursor(editor, updatedText);
        } else {
            editor.value = updatedText;
        }
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedText;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

// ── SVG Transform helpers ────────────────────────────────────────────

function benApplyTransform(animate) {
    if (!benGroup) return;
    const transformStr = `translate(${benPanX}, ${benPanY}) scale(${benZoom})`;

    if (animate) {
        benGroup.style.transition = `transform ${BEN_ANIM_DURATION}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
        benGroup.setAttribute('transform', transformStr);
        setTimeout(() => { benGroup.style.transition = ''; }, BEN_ANIM_DURATION);
    } else {
        benGroup.style.transition = '';
        benGroup.setAttribute('transform', transformStr);
    }
}

function benefitsZoomIn() {
    benZoom = Math.min(3, benZoom * 1.25);
    benApplyTransform(true);
    benUpdateZoomLabel();
}

function benefitsZoomOut() {
    benZoom = Math.max(0.1, benZoom / 1.25);
    benApplyTransform(true);
    benUpdateZoomLabel();
}

function benefitsZoomReset() {
    benZoom = 1;
    benPanX = 0;
    benPanY = 0;
    if (benSvg) {
        const rect = benSvg.getBoundingClientRect();
        benPanX = rect.width / 2 - (BEN_PADDING_X + BEN_COL_GAP * 1.5);
        benPanY = 40;
    }
    benApplyTransform(true);
    benUpdateZoomLabel();
}

function benefitsZoomFit() {
    if (!benSvg || benefitItems.length === 0) return;

    const layout = benComputeLayout();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const node of layout) {
        if (node.x < minX) minX = node.x;
        if (node.x + BEN_NODE_WIDTH > maxX) maxX = node.x + BEN_NODE_WIDTH;
        if (node.y < minY) minY = node.y;
        if (node.y + BEN_NODE_HEIGHT > maxY) maxY = node.y + BEN_NODE_HEIGHT;
    }

    if (minX === Infinity) return;

    const svgRect = benSvg.getBoundingClientRect();
    const padding = 80;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;

    const scaleX = svgRect.width / contentW;
    const scaleY = svgRect.height / contentH;
    benZoom = Math.min(scaleX, scaleY, 2);

    benPanX = svgRect.width / 2 - centreX * benZoom;
    benPanY = svgRect.height / 2 - centreY * benZoom;

    benApplyTransform(true);
    benUpdateZoomLabel();
}

function benUpdateZoomLabel() {
    const label = document.getElementById('benefitsZoomLabel');
    if (label) {
        label.textContent = Math.round(benZoom * 100) + '%';
    }
}

// ── Mouse/Touch event handlers ───────────────────────────────────────

function benHandleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY;

    if (e.ctrlKey || e.metaKey) {
        if (delta < 0) {
            benZoom = Math.min(3, benZoom * 1.08);
        } else {
            benZoom = Math.max(0.1, benZoom / 1.08);
        }
        benApplyTransform(false);
        benUpdateZoomLabel();
    } else {
        benPanX -= e.deltaX || 0;
        benPanY -= delta;
        benApplyTransform(false);
    }
}

function benHandleMouseDown(e) {
    if (e.button !== 0) return;
    if (e.target !== benSvg && !e.target.closest('.ben-background')) return;
    benIsDragging = true;
    benDragStartX = e.clientX;
    benDragStartY = e.clientY;
    benDragStartPanX = benPanX;
    benDragStartPanY = benPanY;
    e.preventDefault();
}

function benHandleMouseMove(e) {
    if (!benIsDragging) return;
    benPanX = benDragStartPanX + (e.clientX - benDragStartX);
    benPanY = benDragStartPanY + (e.clientY - benDragStartY);
    benApplyTransform(false);
}

function benHandleMouseUp() {
    benIsDragging = false;
}

function benHandleTouchStart(e) {
    if (e.touches.length === 1) {
        benIsDragging = true;
        benDragStartX = e.touches[0].clientX;
        benDragStartY = e.touches[0].clientY;
        benDragStartPanX = benPanX;
        benDragStartPanY = benPanY;
    } else if (e.touches.length === 2) {
        benIsDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        benTouchStartDist = Math.sqrt(dx * dx + dy * dy);
        benTouchStartZoom = benZoom;
    }
}

function benHandleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && benIsDragging) {
        benPanX = benDragStartPanX + (e.touches[0].clientX - benDragStartX);
        benPanY = benDragStartPanY + (e.touches[0].clientY - benDragStartY);
        benApplyTransform(false);
    } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (benTouchStartDist > 0) {
            benZoom = Math.max(0.1, Math.min(3, benTouchStartZoom * (dist / benTouchStartDist)));
            benApplyTransform(false);
            benUpdateZoomLabel();
        }
    }
}

function benHandleTouchEnd() {
    benIsDragging = false;
    benTouchStartDist = 0;
}

// ── Layout algorithm ─────────────────────────────────────────────────

/**
 * Compute positions for all benefit items in a 4-column layout.
 * Returns an array of { item, x, y, col } objects.
 */
function benComputeLayout() {
    // Group items by column
    const columns = [[], [], [], []];
    for (const item of benefitItems) {
        const col = BEN_COLUMNS[item.type] !== undefined ? BEN_COLUMNS[item.type] : 2;
        columns[col].push(item);
    }

    const layout = [];
    for (let col = 0; col < 4; col++) {
        const items = columns[col];
        const x = BEN_PADDING_X + col * BEN_COL_GAP;
        for (let row = 0; row < items.length; row++) {
            const y = BEN_PADDING_Y + row * (BEN_NODE_HEIGHT + BEN_ROW_GAP);
            layout.push({ item: items[row], x, y, col });
        }
    }

    return layout;
}

// ── SVG rendering ────────────────────────────────────────────────────

/**
 * Create an SVG namespace element.
 */
function benSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, val] of Object.entries(attrs || {})) {
        el.setAttribute(key, val);
    }
    return el;
}

/**
 * Render a single node based on its type.
 */
function benRenderNode(item, x, y) {
    const g = benSvgEl('g', {
        'class': 'ben-node ben-node--' + item.type,
        'data-id': item.id,
        'role': 'button',
        'aria-label': item.type + ': ' + item.title,
        'tabindex': '0'
    });
    g.style.cursor = 'pointer';

    const colours = BEN_COLOURS[item.type] || BEN_COLOURS.benefit;

    if (item.type === 'enabler') {
        // Ellipse
        const ellipse = benSvgEl('ellipse', {
            cx: x + BEN_NODE_WIDTH / 2,
            cy: y + BEN_NODE_HEIGHT / 2,
            rx: BEN_NODE_WIDTH / 2,
            ry: BEN_NODE_HEIGHT / 2,
            fill: colours.fill,
            stroke: colours.stroke,
            'stroke-width': '2',
            'class': 'ben-shape'
        });
        g.appendChild(ellipse);
    } else {
        // Rectangle with type-specific corner radius
        let rx = 0;
        if (item.type === 'benefit' || item.type === 'objective') rx = 16;

        const rect = benSvgEl('rect', {
            x: x,
            y: y,
            width: BEN_NODE_WIDTH,
            height: BEN_NODE_HEIGHT,
            rx: rx,
            ry: rx,
            fill: colours.fill,
            stroke: colours.stroke,
            'stroke-width': '2',
            'class': 'ben-shape'
        });
        g.appendChild(rect);
    }

    // Type label (small, top)
    const typeLabel = benSvgEl('text', {
        x: x + BEN_NODE_WIDTH / 2,
        y: y + 18,
        'text-anchor': 'middle',
        'font-size': '10',
        'font-weight': '600',
        fill: colours.text,
        opacity: '0.7',
        'pointer-events': 'none',
        'class': 'ben-type-label'
    });
    typeLabel.textContent = item.type.charAt(0).toUpperCase() + item.type.slice(1);
    g.appendChild(typeLabel);

    // Title text (truncated)
    const titleText = benSvgEl('text', {
        x: x + BEN_NODE_WIDTH / 2,
        y: y + 38,
        'text-anchor': 'middle',
        'font-size': '13',
        'font-weight': '500',
        fill: colours.text,
        'pointer-events': 'none',
        'class': 'ben-title'
    });
    const maxChars = 22;
    titleText.textContent = item.title.length > maxChars ? item.title.substring(0, maxChars) + '...' : item.title;
    g.appendChild(titleText);

    // Selection highlight (invisible by default)
    if (item.type === 'enabler') {
        const selEllipse = benSvgEl('ellipse', {
            cx: x + BEN_NODE_WIDTH / 2,
            cy: y + BEN_NODE_HEIGHT / 2,
            rx: BEN_NODE_WIDTH / 2 + 4,
            ry: BEN_NODE_HEIGHT / 2 + 4,
            fill: 'none',
            stroke: '#108BB9',
            'stroke-width': '3',
            'class': 'ben-selection-ring',
            'visibility': benSelectedNodeId === item.id ? 'visible' : 'hidden'
        });
        g.appendChild(selEllipse);
    } else {
        let rx = 0;
        if (item.type === 'benefit' || item.type === 'objective') rx = 18;

        const selRect = benSvgEl('rect', {
            x: x - 4,
            y: y - 4,
            width: BEN_NODE_WIDTH + 8,
            height: BEN_NODE_HEIGHT + 8,
            rx: rx,
            ry: rx,
            fill: 'none',
            stroke: '#108BB9',
            'stroke-width': '3',
            'class': 'ben-selection-ring',
            'visibility': benSelectedNodeId === item.id ? 'visible' : 'hidden'
        });
        g.appendChild(selRect);
    }

    // Click handler for selection
    g.addEventListener('click', (e) => {
        e.stopPropagation();
        benSelectNode(item.id);
    });

    // Double-click handler to open edit form
    g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openBenefitForm(item.id);
    });

    // Enter key to open edit form when focused
    g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            openBenefitForm(item.id);
        }
    });

    // Focus styling
    g.addEventListener('focus', () => {
        g.querySelector('.ben-selection-ring').setAttribute('visibility', 'visible');
    });
    g.addEventListener('blur', () => {
        if (benSelectedNodeId !== item.id) {
            g.querySelector('.ben-selection-ring').setAttribute('visibility', 'hidden');
        }
    });

    return g;
}

/**
 * Render an S-curve bezier connection between two nodes.
 */
function benRenderConnection(fromLayout, toLayout) {
    // Source: right edge of from node, target: left edge of to node
    let sx, sy, tx, ty;

    if (fromLayout.item.type === 'enabler') {
        sx = fromLayout.x + BEN_NODE_WIDTH;
        sy = fromLayout.y + BEN_NODE_HEIGHT / 2;
    } else {
        sx = fromLayout.x + BEN_NODE_WIDTH;
        sy = fromLayout.y + BEN_NODE_HEIGHT / 2;
    }

    if (toLayout.item.type === 'enabler') {
        tx = toLayout.x;
        ty = toLayout.y + BEN_NODE_HEIGHT / 2;
    } else {
        tx = toLayout.x;
        ty = toLayout.y + BEN_NODE_HEIGHT / 2;
    }

    // S-curve control points
    const midX = (sx + tx) / 2;
    const d = `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`;

    const path = benSvgEl('path', {
        d: d,
        fill: 'none',
        stroke: '#6B7280',
        'stroke-width': '2',
        'stroke-opacity': '0.6',
        'class': 'ben-connection'
    });

    // Arrow head at target
    const arrowSize = 8;
    const arrowPath = benSvgEl('path', {
        d: `M ${tx} ${ty} L ${tx - arrowSize} ${ty - arrowSize / 2} L ${tx - arrowSize} ${ty + arrowSize / 2} Z`,
        fill: '#6B7280',
        'fill-opacity': '0.6',
        'class': 'ben-arrow'
    });

    const g = benSvgEl('g', { 'class': 'ben-connection-group' });
    g.appendChild(path);
    g.appendChild(arrowPath);
    return g;
}

/**
 * Render column header labels.
 */
function benRenderColumnLabels() {
    const g = benSvgEl('g', { 'class': 'ben-column-labels' });

    for (let col = 0; col < 4; col++) {
        const x = BEN_PADDING_X + col * BEN_COL_GAP + BEN_NODE_WIDTH / 2;
        const label = benSvgEl('text', {
            x: x,
            y: BEN_PADDING_Y - 20,
            'text-anchor': 'middle',
            'font-size': '14',
            'font-weight': '600',
            fill: 'var(--text-primary, #E0E0E0)',
            opacity: '0.6',
            'pointer-events': 'none'
        });
        label.textContent = BEN_COL_LABELS[col];
        g.appendChild(label);
    }

    return g;
}

/**
 * Select a node by ID.
 */
function benSelectNode(id) {
    // Deselect previous
    if (benGroup) {
        benGroup.querySelectorAll('.ben-selection-ring').forEach(el => {
            el.setAttribute('visibility', 'hidden');
        });
    }

    benSelectedNodeId = id;

    if (id !== null && benGroup) {
        const nodeG = benGroup.querySelector(`.ben-node[data-id="${id}"]`);
        if (nodeG) {
            const ring = nodeG.querySelector('.ben-selection-ring');
            if (ring) ring.setAttribute('visibility', 'visible');
        }
    }
}

/**
 * Deselect all nodes.
 */
function benDeselectAll() {
    benSelectedNodeId = null;
    if (benGroup) {
        benGroup.querySelectorAll('.ben-selection-ring').forEach(el => {
            el.setAttribute('visibility', 'hidden');
        });
    }
}

// ── Full render ──────────────────────────────────────────────────────

/**
 * Render the full benefits map SVG.
 */
function benRenderAll() {
    if (!benGroup) return;

    // Clear existing content
    while (benGroup.firstChild) {
        benGroup.removeChild(benGroup.firstChild);
    }

    if (benefitItems.length === 0) return;

    // Compute layout
    const layout = benComputeLayout();

    // Build lookup map for connections
    const layoutMap = {};
    for (const entry of layout) {
        layoutMap[entry.item.id] = entry;
    }

    // Render column labels
    benGroup.appendChild(benRenderColumnLabels());

    // Render connections first (behind nodes)
    for (const entry of layout) {
        for (const targetId of entry.item.linkedTo) {
            if (layoutMap[targetId]) {
                benGroup.appendChild(benRenderConnection(entry, layoutMap[targetId]));
            }
        }
    }

    // Render nodes
    for (const entry of layout) {
        benGroup.appendChild(benRenderNode(entry.item, entry.x, entry.y));
    }
}

// ── Add item functions (called from toolbar buttons) ─────────────────

function addBenefitElement(type) {
    const item = {
        id: benefitNextId++,
        type: type,
        title: 'New ' + type.charAt(0).toUpperCase() + type.slice(1),
        description: '',
        objectiveType: '',
        targetValue: '',
        currentValue: '',
        targetDate: '',
        measurementMethod: '',
        linkedTo: [],
        contributionPercent: 0,
        score: 0
    };

    benefitItems.push(item);
    syncBenefitsToPlanText();
    benRenderAll();
    benSelectNode(item.id);

    // Show content, hide placeholder
    const placeholder = document.querySelector('#benefits-view .benefits-placeholder');
    const content = document.querySelector('#benefits-view .benefits-content');
    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    // Open the form for the new item
    openBenefitForm(item.id);
}

// ── CRUD functions ──────────────────────────────────────────────────

/**
 * Create a new benefit item with pre-selected type and open the form.
 */
function addBenefitItem(type) {
    addBenefitElement(type || 'benefit');
}

/**
 * Open the benefit form in the detail pane for editing an existing item.
 */
function openBenefitForm(itemId) {
    const title = document.getElementById('benefitsFormTitle');
    const idField = document.getElementById('benefitItemId');
    const deleteRow = document.getElementById('benefitDeleteButtonRow');

    if (itemId != null) {
        const item = benefitItems.find(i => i.id === itemId);
        if (!item) return;

        title.textContent = 'Edit Benefit Item';
        idField.value = item.id;
        document.getElementById('benefitItemType').value = item.type;
        document.getElementById('benefitItemTitle').value = item.title;
        document.getElementById('benefitItemDescription').value = item.description;
        document.getElementById('benefitObjectiveType').value = item.objectiveType || '';
        document.getElementById('benefitTargetValue').value = item.targetValue || '';
        document.getElementById('benefitCurrentValue').value = item.currentValue || '';
        document.getElementById('benefitTargetDate').value = item.targetDate || '';
        document.getElementById('benefitMeasurementMethod').value = item.measurementMethod || '';
        document.getElementById('benefitContribution').value = item.contributionPercent || 0;

        if (deleteRow) deleteRow.style.display = 'block';

        // Render linked tags
        benRenderLinkedTags(item.linkedTo);
    } else {
        title.textContent = 'New Benefit Item';
        idField.value = '';
        document.getElementById('benefitItemType').value = 'benefit';
        document.getElementById('benefitItemTitle').value = '';
        document.getElementById('benefitItemDescription').value = '';
        document.getElementById('benefitObjectiveType').value = '';
        document.getElementById('benefitTargetValue').value = '';
        document.getElementById('benefitCurrentValue').value = '';
        document.getElementById('benefitTargetDate').value = '';
        document.getElementById('benefitMeasurementMethod').value = '';
        document.getElementById('benefitContribution').value = 0;

        if (deleteRow) deleteRow.style.display = 'none';

        // Clear linked tags
        benRenderLinkedTags([]);
    }

    // Update conditional field visibility
    benefitTypeChanged();

    // Populate the "Linked To" select with available items
    benPopulateLinkedToSelect(itemId);

    openDetailPane('benefitsFormSection');
}

/**
 * Show/hide conditional fields based on selected type.
 */
function benefitTypeChanged() {
    const type = document.getElementById('benefitItemType').value;
    const objectiveGroup = document.getElementById('benefitObjectiveTypeGroup');
    const measurementFields = document.getElementById('benefitMeasurementFields');

    // Objective type only visible for objectives
    if (objectiveGroup) {
        objectiveGroup.style.display = type === 'objective' ? '' : 'none';
    }

    // Measurement fields only visible for benefit/disbenefit
    if (measurementFields) {
        measurementFields.style.display = (type === 'benefit' || type === 'disbenefit') ? '' : 'none';
    }
}

/**
 * Populate the linked-to select dropdown with available items (excluding self).
 */
function benPopulateLinkedToSelect(excludeId) {
    const select = document.getElementById('benefitLinkedToSelect');
    if (!select) return;

    // Clear existing options except the placeholder
    while (select.options.length > 1) {
        select.remove(1);
    }

    for (const item of benefitItems) {
        if (item.id === excludeId) continue;
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.type.charAt(0).toUpperCase() + item.type.slice(1) + ': ' + item.title;
        select.appendChild(opt);
    }
}

/**
 * Add a link from the dropdown to the current item's linked tags.
 */
function addBenefitLink() {
    const select = document.getElementById('benefitLinkedToSelect');
    if (!select || !select.value) return;

    const linkId = parseInt(select.value, 10);
    const tagsContainer = document.getElementById('benefitLinkedTags');
    if (!tagsContainer) return;

    // Check if already linked
    const existing = tagsContainer.querySelectorAll('.benefit-link-tag');
    for (const tag of existing) {
        if (parseInt(tag.dataset.linkId, 10) === linkId) {
            select.value = '';
            return;
        }
    }

    const item = benefitItems.find(i => i.id === linkId);
    if (!item) return;

    const tag = document.createElement('span');
    tag.className = 'benefit-link-tag';
    tag.dataset.linkId = linkId;
    tag.setAttribute('role', 'option');
    tag.setAttribute('aria-label', 'Linked to ' + item.title + '. Press to remove.');
    tag.innerHTML = '<span class="benefit-link-tag-text">' +
        (item.type.charAt(0).toUpperCase() + item.type.slice(1)) + ': ' + item.title +
        '</span><button type="button" class="benefit-link-tag-remove" onclick="removeBenefitLink(this)" aria-label="Remove link">&times;</button>';
    tagsContainer.appendChild(tag);

    select.value = '';
}

/**
 * Remove a linked tag.
 */
function removeBenefitLink(btn) {
    const tag = btn.closest('.benefit-link-tag');
    if (tag) tag.remove();
}

/**
 * Render linked tags from an array of IDs.
 */
function benRenderLinkedTags(linkedIds) {
    const tagsContainer = document.getElementById('benefitLinkedTags');
    if (!tagsContainer) return;
    tagsContainer.innerHTML = '';

    for (const linkId of linkedIds) {
        const item = benefitItems.find(i => i.id === linkId);
        if (!item) continue;

        const tag = document.createElement('span');
        tag.className = 'benefit-link-tag';
        tag.dataset.linkId = linkId;
        tag.setAttribute('role', 'option');
        tag.setAttribute('aria-label', 'Linked to ' + item.title + '. Press to remove.');
        tag.innerHTML = '<span class="benefit-link-tag-text">' +
            (item.type.charAt(0).toUpperCase() + item.type.slice(1)) + ': ' + item.title +
            '</span><button type="button" class="benefit-link-tag-remove" onclick="removeBenefitLink(this)" aria-label="Remove link">&times;</button>';
        tagsContainer.appendChild(tag);
    }
}

/**
 * Validate and save the benefit item from the form fields.
 */
function saveBenefitItemFromForm() {
    const idField = document.getElementById('benefitItemId').value;
    const title = document.getElementById('benefitItemTitle').value.trim();

    if (!title) {
        alert('Please enter a title for the benefit item.');
        return;
    }

    const type = document.getElementById('benefitItemType').value;

    // Collect linked IDs from tags
    const tags = document.querySelectorAll('#benefitLinkedTags .benefit-link-tag');
    const linkedTo = [];
    for (const tag of tags) {
        const linkId = parseInt(tag.dataset.linkId, 10);
        if (!isNaN(linkId)) linkedTo.push(linkId);
    }

    const data = {
        type: type,
        title: title,
        description: document.getElementById('benefitItemDescription').value.trim(),
        objectiveType: type === 'objective' ? document.getElementById('benefitObjectiveType').value : '',
        targetValue: (type === 'benefit' || type === 'disbenefit') ? document.getElementById('benefitTargetValue').value.trim() : '',
        currentValue: (type === 'benefit' || type === 'disbenefit') ? document.getElementById('benefitCurrentValue').value.trim() : '',
        targetDate: (type === 'benefit' || type === 'disbenefit') ? document.getElementById('benefitTargetDate').value : '',
        measurementMethod: (type === 'benefit' || type === 'disbenefit') ? document.getElementById('benefitMeasurementMethod').value.trim() : '',
        linkedTo: linkedTo,
        contributionPercent: parseInt(document.getElementById('benefitContribution').value, 10) || 0,
        score: 0
    };

    if (idField) {
        // Update existing item
        const id = parseInt(idField, 10);
        const item = benefitItems.find(i => i.id === id);
        if (item) {
            Object.assign(item, data);
        }
    } else {
        // Create new item
        data.id = benefitNextId++;
        benefitItems.push(data);
    }

    syncBenefitsToPlanText();
    benRenderAll();
    closeBenefitForm();
}

/**
 * Delete the currently edited benefit item with confirmation.
 */
function deleteBenefitItem(idOverride) {
    const id = idOverride !== undefined ? idOverride : parseInt(document.getElementById('benefitItemId').value, 10);
    if (isNaN(id)) return;

    const item = benefitItems.find(i => i.id === id);
    const itemTitle = item ? item.title : 'this item';

    if (!confirm('Are you sure you want to delete "' + itemTitle + '"? This action cannot be undone.')) {
        return;
    }

    // Remove the item
    benefitItems = benefitItems.filter(i => i.id !== id);

    // Remove references to this item from other items' linkedTo arrays
    for (const other of benefitItems) {
        other.linkedTo = other.linkedTo.filter(linkId => linkId !== id);
    }

    // Deselect if it was selected
    if (benSelectedNodeId === id) {
        benSelectedNodeId = null;
    }

    syncBenefitsToPlanText();
    benRenderAll();
    closeBenefitForm();

    // Show placeholder if no items remain
    if (benefitItems.length === 0) {
        const placeholder = document.querySelector('#benefits-view .benefits-placeholder');
        const content = document.querySelector('#benefits-view .benefits-content');
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
    }
}

/**
 * Close the benefit form detail pane section.
 */
function closeBenefitForm() {
    closeDetailPane();
}

// ── Initialization ───────────────────────────────────────────────────

/**
 * Initialize the benefits canvas (create SVG, attach event listeners).
 */
function initBenefitsCanvas() {
    const container = document.getElementById('benefitsContainer');
    if (!container) return;

    benSvg = container.querySelector('svg.ben-svg');
    if (!benSvg) {
        benSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        benSvg.classList.add('ben-svg');
        benSvg.setAttribute('width', '100%');
        benSvg.setAttribute('height', '100%');
        benSvg.setAttribute('role', 'img');
        benSvg.setAttribute('aria-label', 'Benefits realisation map');

        benGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        benGroup.classList.add('ben-root-group');
        benSvg.appendChild(benGroup);

        container.appendChild(benSvg);

        // Event listeners
        benSvg.addEventListener('wheel', benHandleWheel, { passive: false });
        benSvg.addEventListener('mousedown', benHandleMouseDown);
        window.addEventListener('mousemove', benHandleMouseMove);
        window.addEventListener('mouseup', benHandleMouseUp);

        // Touch
        benSvg.addEventListener('touchstart', benHandleTouchStart, { passive: false });
        benSvg.addEventListener('touchmove', benHandleTouchMove, { passive: false });
        benSvg.addEventListener('touchend', benHandleTouchEnd);

        // Click on background to deselect
        benSvg.addEventListener('click', (e) => {
            if (e.target === benSvg) {
                benDeselectAll();
            }
        });

        // Double-click on background to deselect and close form
        benSvg.addEventListener('dblclick', (e) => {
            if (e.target === benSvg) {
                benDeselectAll();
            }
        });
    } else {
        benGroup = benSvg.querySelector('.ben-root-group');
    }
}

/**
 * Main entry point: called from updateAllViews() after plan text parsing.
 */
function updateBenefits() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const planText = editor.value;

    // Extract benefits section
    const benStart = planText.indexOf(BENEFITS_START);
    if (benStart !== -1) {
        // Find end of benefits section
        let benEnd = planText.length;
        const searchAfter = benStart + BENEFITS_START.length;
        for (const marker of [BUDGET_START, RAID_LOG_START, BASELINE_START, COMMS_START]) {
            const idx = planText.indexOf(marker, searchAfter);
            if (idx !== -1 && idx < benEnd) benEnd = idx;
        }

        const benefitsText = planText.substring(searchAfter, benEnd);
        const parsed = parseBenefitsMarkdown(benefitsText);
        if (parsed && parsed.items) {
            benefitItems = parsed.items;
            benefitNextId = (parsed.maxId || 0) + 1;
        }
    } else {
        // No benefits section in plan text
        if (benefitItems.length === 0) {
            // Show placeholder
            const placeholder = document.querySelector('#benefits-view .benefits-placeholder');
            const content = document.querySelector('#benefits-view .benefits-content');
            if (placeholder) placeholder.style.display = '';
            if (content) content.style.display = 'none';
            return;
        }
    }

    // Show content, hide placeholder
    if (benefitItems.length > 0) {
        const placeholder = document.querySelector('#benefits-view .benefits-placeholder');
        const content = document.querySelector('#benefits-view .benefits-content');
        if (placeholder) placeholder.style.display = 'none';
        if (content) content.style.display = '';
    }

    // Initialize canvas if needed
    initBenefitsCanvas();

    // Attach Delete key handler to benefits container (once)
    const container = document.getElementById('benefitsContainer');
    if (container && !container._benKeydownAttached) {
        container.addEventListener('keydown', (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && benSelectedNodeId !== null) {
                // Only if not focused on an input inside the form
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
                e.preventDefault();
                deleteBenefitItem(benSelectedNodeId);
            }
        });
        container._benKeydownAttached = true;
    }

    // Render
    benRenderAll();
}
