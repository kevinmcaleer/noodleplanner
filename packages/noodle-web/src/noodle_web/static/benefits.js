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
    benefit:    { fill: '#3B82F6', text: '#FFFFFF', stroke: 'none' },
    enabler:    { fill: '#EAB308', text: '#1A1A1A', stroke: 'none' },
    change:     { fill: '#F3F4F6', text: '#1A1A1A', stroke: 'none' },
    disbenefit: { fill: '#EF4444', text: '#FFFFFF', stroke: 'none' },
    objective:  { fill: '#22C55E', text: '#FFFFFF', stroke: 'none' }
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
    const aliasMap = {
        'id': 'id',
        'type': 'type',
        'title': 'title',
        'description': 'description',
        'objective type': 'objectiveType',
        'target value': 'targetValue',
        'current value': 'currentValue',
        'target date': 'targetDate',
        'measurement': 'measurementMethod',
        'linked to': 'linkedTo',
        'contribution %': 'contributionPercent',
        'status': 'status',
        'last updated': 'lastUpdated'
    };

    headers.forEach((h, idx) => {
        if (aliasMap[h] !== undefined) {
            colMap[aliasMap[h]] = idx;
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

        const get = (field) => (colMap[field] !== undefined && cells[colMap[field]]) ? cells[colMap[field]].replace(/\\\|/g, '|').trim() : '';

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
            status: get('status') || '',
            lastUpdated: get('lastUpdated') || '',
            score: 0
        });
    }

    return { items, maxId };
}

/**
 * Generate benefits markdown table from benefitItems.
 */
function generateBenefitsMarkdown() {
    const headers = ['ID', 'Type', 'Title', 'Description', 'Objective Type', 'Target Value', 'Current Value', 'Target Date', 'Measurement', 'Linked To', 'Contribution %', 'Status', 'Last Updated'];

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
        String(item.contributionPercent || 0),
        escPipe(item.status || ''),
        escPipe(item.lastUpdated || '')
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

    const HIGHLIGHTS_START = '---highlights---';
    const HIGHLIGHTS_END = '---end-highlights---';

    function extractSection(text, startMarker, endMarkers) {
        const idx = text.indexOf(startMarker);
        if (idx === -1) return '';
        const afterStart = idx + startMarker.length;
        let endIdx = text.length;
        for (const em of endMarkers) {
            const ei = text.indexOf(em, afterStart);
            if (ei !== -1 && ei < endIdx) endIdx = ei;
        }
        return text.substring(afterStart, endIdx).replace(/^\n+/, '').replace(/\n+$/, '');
    }

    // Extract every section so we can re-append in canonical order
    const highlightsText = extractSection(planText, HIGHLIGHTS_START,
        [HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START]);
    const hasEndHighlights = planText.includes(HIGHLIGHTS_END);
    const budgetText = extractSection(planText, BUDGET_START,
        [BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START]);
    const raidText = extractSection(planText, RAID_LOG_START, [COMMS_START, BASELINE_START]);
    const commsText = extractSection(planText, COMMS_START, [BASELINE_START]);
    const baselineText = planText.indexOf(BASELINE_START) !== -1
        ? planText.substring(planText.indexOf(BASELINE_START) + BASELINE_START.length).replace(/^\n+/, '')
        : '';

    // Strip all special sections to get just tasks + front matter
    let base = planText;
    const sectionMarkers = [HIGHLIGHTS_START, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START];
    let earliestIdx = base.length;
    for (const marker of sectionMarkers) {
        const idx = base.indexOf(marker);
        if (idx !== -1 && idx < earliestIdx) earliestIdx = idx;
    }
    if (earliestIdx < base.length) {
        base = base.substring(0, earliestIdx);
    }
    base = base.replace(/\n+$/, '');

    let lines = base.split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '---') {
        lines.pop();
    }
    base = lines.join('\n').replace(/\n+$/, '');

    // Rebuild in canonical order: tasks, highlights, budget, benefits, raid, comms, baseline
    let result = base;

    if (highlightsText) {
        result = result + '\n\n---\n\n' + HIGHLIGHTS_START + '\n' + highlightsText;
        if (hasEndHighlights) {
            result = result.replace(/\n+$/, '') + '\n\n' + HIGHLIGHTS_END;
        }
    }
    if (budgetText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BUDGET_START + '\n' + budgetText;
    }
    if (table) {
        result = result.replace(/\n+$/, '') + '\n\n' + BENEFITS_START + '\n' + table;
    }
    if (raidText) {
        result = result.replace(/\n+$/, '') + '\n\n' + RAID_LOG_START + '\n' + raidText;
    }
    if (commsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + COMMS_START + '\n' + commsText;
    }
    if (baselineText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BASELINE_START + '\n' + baselineText;
    }

    const updatedText = result;

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

// ── Scoring algorithm ───────────────────────────────────────────────

/**
 * Format a numeric score with abbreviations (1M, 500K, 250K, etc.).
 */
function benFormatScore(value) {
    if (value >= 1000000) {
        const m = value / 1000000;
        return (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + 'M';
    }
    if (value >= 1000) {
        const k = value / 1000;
        return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'K';
    }
    return String(Math.round(value));
}

/**
 * Calculate benefit scores by cascading value backwards from objectives.
 *
 * Algorithm:
 *  1. Each objective gets a base score of 1,000,000.
 *  2. For each benefit/disbenefit linked to an objective:
 *     benefit.score = objective.score * (benefit.contributionPercent / 100)
 *  3. For each business change linked to benefits:
 *     change.score = sum of linked benefit scores
 *  4. For each enabler linked to changes:
 *     enabler.score = sum of linked change scores
 *
 * Links go forward (enabler -> change -> benefit -> objective) via linkedTo.
 * Scoring flows backward (objective -> benefit -> change -> enabler).
 */
function calculateBenefitScores() {
    const BASE_SCORE = 1000000;

    // Reset all scores
    for (const item of benefitItems) {
        item.score = 0;
    }

    // Build a reverse link map: targetId -> [sourceItems]
    // linkedTo means "this item links TO that target"
    const reverseLinks = {};
    for (const item of benefitItems) {
        for (const targetId of item.linkedTo) {
            if (!reverseLinks[targetId]) reverseLinks[targetId] = [];
            reverseLinks[targetId].push(item);
        }
    }


    // Build lookup by id
    const itemById = {};
    for (const item of benefitItems) {
        itemById[item.id] = item;
    }

    // Step 1: Assign base score to objectives
    for (const item of benefitItems) {
        if (item.type === 'objective') {
            item.score = BASE_SCORE;
        }
    }

    // Step 2: Benefits/disbenefits get score from linked objectives
    // A benefit links TO an objective, so benefit.linkedTo contains objective IDs
    for (const item of benefitItems) {
        if (item.type === 'benefit' || item.type === 'disbenefit') {
            let totalScore = 0;
            for (const targetId of item.linkedTo) {
                const target = itemById[targetId];
                if (target && target.type === 'objective') {
                    totalScore += target.score * (item.contributionPercent / 100);
                }
            }
            item.score = totalScore;
        }
    }

    // Step 3: Business changes get score from linked benefits
    // A change links TO benefits, so change.linkedTo contains benefit IDs
    for (const item of benefitItems) {
        if (item.type === 'change') {
            let totalScore = 0;
            for (const targetId of item.linkedTo) {
                const target = itemById[targetId];
                if (target && (target.type === 'benefit' || target.type === 'disbenefit')) {
                    totalScore += target.score;
                }
            }
            item.score = totalScore;
        }
    }

    // Step 4: Enablers get score from linked changes
    // An enabler links TO changes, so enabler.linkedTo contains change IDs
    for (const item of benefitItems) {
        if (item.type === 'enabler') {
            let totalScore = 0;
            for (const targetId of item.linkedTo) {
                const target = itemById[targetId];
                if (target && target.type === 'change') {
                    totalScore += target.score;
                }
            }
            item.score = totalScore;
        }
    }
}

/**
 * Validate that contributions from all benefits to each objective do not exceed 100%.
 * Returns an object mapping objective IDs to their total contribution percentage.
 */
function benValidateContributions() {
    const objectiveTotals = {};

    for (const item of benefitItems) {
        if (item.type !== 'benefit' && item.type !== 'disbenefit') continue;
        for (const targetId of item.linkedTo) {
            const target = benefitItems.find(i => i.id === targetId);
            if (target && target.type === 'objective') {
                if (!objectiveTotals[targetId]) objectiveTotals[targetId] = 0;
                objectiveTotals[targetId] += item.contributionPercent;
            }
        }
    }

    return objectiveTotals;
}

// ── Layout algorithm ─────────────────────────────────────────────────

/**
 * Compute positions for all benefit items using a flow-aware layout.
 * Items are placed in type-based columns but positioned vertically
 * according to their linkedTo connections so that connected items
 * sit close together.
 *
 * Returns an array of { item, x, y, col } objects.
 */
function benComputeLayout() {
    // Group items by column (type-based)
    const columns = [[], [], [], []];
    const itemById = {};
    for (const item of benefitItems) {
        const col = BEN_COLUMNS[item.type] !== undefined ? BEN_COLUMNS[item.type] : 2;
        columns[col].push(item);
        itemById[item.id] = item;
    }

    // Build reverse links: targetId -> [sourceItems]
    const reverseLinks = {};
    for (const item of benefitItems) {
        for (const targetId of item.linkedTo) {
            if (!reverseLinks[targetId]) reverseLinks[targetId] = [];
            reverseLinks[targetId].push(item);
        }
    }

    // Track assigned Y positions per item id
    const yPos = {};
    const nodeStep = BEN_NODE_HEIGHT + BEN_ROW_GAP;

    // Phase 1: Position rightmost column (objectives, col 3) evenly
    columns[3].forEach((item, idx) => {
        yPos[item.id] = BEN_PADDING_Y + idx * nodeStep;
    });

    // Phase 2: Position columns 2, 1, 0 based on connections to the
    // column to their right.  Items with links are placed at the
    // average Y of their targets; unlinked items are appended below.
    for (let col = 2; col >= 0; col--) {
        const linked = [];
        const unlinked = [];

        for (const item of columns[col]) {
            // Find connected items in columns to the right that already have positions.
            // Check both: items this links TO, and items that link TO this (reverse).
            const connectedYs = [];

            // Forward links (linkedTo targets)
            for (const tid of item.linkedTo) {
                if (itemById[tid] && yPos[tid] !== undefined) {
                    const targetCol = BEN_COLUMNS[itemById[tid].type];
                    if (targetCol !== undefined && targetCol > col) {
                        connectedYs.push(yPos[tid]);
                    }
                }
            }

            // Reverse links (items that link TO this item and are in a column to the right)
            const sources = reverseLinks[item.id] || [];
            for (const src of sources) {
                const srcCol = BEN_COLUMNS[src.type];
                if (srcCol !== undefined && srcCol > col && yPos[src.id] !== undefined) {
                    connectedYs.push(yPos[src.id]);
                }
            }

            if (connectedYs.length > 0) {
                const avgY = connectedYs.reduce((a, b) => a + b, 0) / connectedYs.length;
                linked.push({ item, desiredY: avgY });
            } else {
                unlinked.push(item);
            }
        }

        // Sort linked items by their desired Y so order is stable
        linked.sort((a, b) => a.desiredY - b.desiredY);

        // Assign Y positions for linked items, resolving collisions
        for (const entry of linked) {
            yPos[entry.item.id] = entry.desiredY;
        }

        // Append unlinked items below the last positioned item in this column
        let maxY = -Infinity;
        for (const entry of linked) {
            if (yPos[entry.item.id] > maxY) maxY = yPos[entry.item.id];
        }
        const startY = maxY === -Infinity ? BEN_PADDING_Y : maxY + nodeStep;
        unlinked.forEach((item, idx) => {
            yPos[item.id] = startY + idx * nodeStep;
        });

        // Collision avoidance: push overlapping nodes apart within this column
        const allInCol = [...linked.map(e => e.item), ...unlinked];
        allInCol.sort((a, b) => yPos[a.id] - yPos[b.id]);

        for (let i = 1; i < allInCol.length; i++) {
            const prev = allInCol[i - 1];
            const curr = allInCol[i];
            const minY = yPos[prev.id] + nodeStep;
            if (yPos[curr.id] < minY) {
                yPos[curr.id] = minY;
            }
        }
    }

    // Phase 3: Second pass — pull items towards their sources (reverse
    // links) to reduce long diagonal connections.  This helps when a
    // right-column node is linked from multiple left-column nodes that
    // ended up far apart; we nudge the target toward its sources'
    // average while still respecting collision constraints.
    for (let col = 3; col >= 1; col--) {
        const colItems = columns[col].slice();
        colItems.sort((a, b) => yPos[a.id] - yPos[b.id]);

        for (const item of colItems) {
            const sources = reverseLinks[item.id];
            if (!sources || sources.length === 0) continue;
            const sourceYs = sources
                .filter(s => yPos[s.id] !== undefined)
                .map(s => yPos[s.id]);
            if (sourceYs.length === 0) continue;
            const avgSourceY = sourceYs.reduce((a, b) => a + b, 0) / sourceYs.length;
            // Blend: move 40% toward sources average
            yPos[item.id] = yPos[item.id] * 0.6 + avgSourceY * 0.4;
        }

        // Re-apply collision avoidance after nudging
        colItems.sort((a, b) => yPos[a.id] - yPos[b.id]);
        for (let i = 1; i < colItems.length; i++) {
            const prev = colItems[i - 1];
            const curr = colItems[i];
            const minY = yPos[prev.id] + nodeStep;
            if (yPos[curr.id] < minY) {
                yPos[curr.id] = minY;
            }
        }
    }

    // Group sibling items that share the same connection so they can be
    // laid out side-by-side instead of stacked vertically.
    // "Siblings" = items in the same column that share a common linked partner
    // (either via linkedTo or reverseLinks) in an adjacent column.
    const xOffset = {};  // itemId -> horizontal pixel offset from column base

    for (let col = 0; col < 4; col++) {
        if (columns[col].length <= 1) continue;

        // Build groups: partner item id → [sibling items in this column]
        const groups = {};
        for (const item of columns[col]) {
            // Gather all connected partner IDs in adjacent columns
            const partnerIds = new Set();
            for (const tid of item.linkedTo) {
                if (itemById[tid]) partnerIds.add(tid);
            }
            for (const src of (reverseLinks[item.id] || [])) {
                partnerIds.add(src.id);
            }
            for (const pid of partnerIds) {
                if (!groups[pid]) groups[pid] = [];
                if (!groups[pid].includes(item)) groups[pid].push(item);
            }
        }

        // Find groups with 2+ siblings and spread them horizontally
        const processed = new Set();
        for (const [, siblings] of Object.entries(groups)) {
            if (siblings.length < 2) continue;
            // Skip if any of these have already been offset
            if (siblings.some(s => processed.has(s.id))) continue;

            const spreadWidth = (BEN_NODE_WIDTH + 16) * (siblings.length - 1);
            const startOffset = -spreadWidth / 2;

            // Position siblings side-by-side at the same Y
            const sharedY = yPos[siblings[0].id];
            for (let i = 0; i < siblings.length; i++) {
                xOffset[siblings[i].id] = startOffset + i * (BEN_NODE_WIDTH + 16);
                yPos[siblings[i].id] = sharedY;
                processed.add(siblings[i].id);
            }
        }
    }

    // Build final layout array
    const layout = [];
    for (let col = 0; col < 4; col++) {
        const baseX = BEN_PADDING_X + col * BEN_COL_GAP;
        for (const item of columns[col]) {
            const x = baseX + (xOffset[item.id] || 0);
            layout.push({ item, x, y: yPos[item.id], col });
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

    // Score label (shown below title if score > 0)
    if (item.score > 0) {
        const scoreLabel = benSvgEl('text', {
            x: x + BEN_NODE_WIDTH / 2,
            y: y + 52,
            'text-anchor': 'middle',
            'font-size': '10',
            'font-weight': '700',
            fill: colours.text,
            opacity: '0.85',
            'pointer-events': 'none',
            'class': 'ben-score-label'
        });
        scoreLabel.textContent = benFormatScore(item.score);
        g.appendChild(scoreLabel);
    }

    // Phase 5: Show task completion % on change nodes
    if (item.type === 'change') {
        const taskPercent = benGetTaskCompletion(item.title);
        if (taskPercent !== null) {
            const pctLabel = benSvgEl('text', {
                x: x + BEN_NODE_WIDTH - 8,
                y: y + BEN_NODE_HEIGHT - 6,
                'text-anchor': 'end',
                'font-size': '10',
                'font-weight': '700',
                fill: taskPercent >= 100 ? '#22C55E' : '#6B7280',
                'pointer-events': 'none',
                'class': 'ben-completion-label'
            });
            pctLabel.textContent = taskPercent + '%';
            g.appendChild(pctLabel);
        }
    }

    // Contribution over-100% warning icon on objective nodes
    if (item.type === 'objective') {
        const contributions = benValidateContributions();
        if (contributions[item.id] > 100) {
            const warningIcon = benSvgEl('text', {
                x: x + BEN_NODE_WIDTH - 8,
                y: y + 16,
                'text-anchor': 'middle',
                'font-size': '14',
                fill: '#FFA500',
                'pointer-events': 'none',
                'class': 'ben-warning-icon'
            });
            warningIcon.textContent = '\u26A0';

            const warningTitle = benSvgEl('title', {});
            warningTitle.textContent = 'Contributions total ' + contributions[item.id] + '% (exceeds 100%)';
            warningIcon.appendChild(warningTitle);

            g.appendChild(warningIcon);
        }
    }

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
 * Render an orthogonal (right-angle) connection between two nodes.
 * Route: exit right from source -> horizontal -> vertical turn -> horizontal -> enter left of target
 */
function benRenderConnection(fromLayout, toLayout) {
    // Source: right edge midpoint; target: left edge midpoint
    const sx = fromLayout.x + BEN_NODE_WIDTH;
    const sy = fromLayout.y + BEN_NODE_HEIGHT / 2;
    const tx = toLayout.x;
    const ty = toLayout.y + BEN_NODE_HEIGHT / 2;

    // S-curve bezier: control points at 60% of the horizontal distance
    const dx = (tx - sx) * 0.6;
    const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;

    const path = benSvgEl('path', {
        d: d,
        fill: 'none',
        stroke: '#999',
        'stroke-width': '1.5',
        'class': 'ben-connection'
    });

    // Arrow head at target
    const arrowSize = 7;
    const arrowPath = benSvgEl('path', {
        d: `M ${tx} ${ty} L ${tx - arrowSize} ${ty - arrowSize / 2} L ${tx - arrowSize} ${ty + arrowSize / 2} Z`,
        fill: '#999',
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
            fill: '#666',
            opacity: '1',
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

    // Calculate scores before rendering
    calculateBenefitScores();

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
    // Draw links left-to-right regardless of which item holds the linkedTo reference
    const drawnConnections = new Set();
    for (const entry of layout) {
        for (const targetId of entry.item.linkedTo) {
            if (layoutMap[targetId]) {
                const from = entry;
                const to = layoutMap[targetId];
                // Always draw left-to-right: lower column → higher column
                const left = from.col <= to.col ? from : to;
                const right = from.col <= to.col ? to : from;
                const key = left.item.id + '->' + right.item.id;
                if (!drawnConnections.has(key)) {
                    drawnConnections.add(key);
                    benGroup.appendChild(benRenderConnection(left, right));
                }
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
        status: '',
        lastUpdated: '',
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

    // Capture old title for rename synchronisation
    let oldTitle = null;
    if (idField) {
        const id = parseInt(idField, 10);
        const item = benefitItems.find(i => i.id === id);
        if (item) {
            oldTitle = item.title;
        }
    }

    if (idField) {
        // Update existing item — preserve status and lastUpdated
        const id = parseInt(idField, 10);
        const item = benefitItems.find(i => i.id === id);
        if (item) {
            data.status = item.status || '';
            data.lastUpdated = item.lastUpdated || '';
            Object.assign(item, data);
        }
    } else {
        // Create new item
        data.id = benefitNextId++;
        data.status = '';
        data.lastUpdated = '';
        benefitItems.push(data);
    }

    // Recalculate scores after saving
    calculateBenefitScores();

    // Validate contributions and warn if any objective exceeds 100%
    const contributions = benValidateContributions();
    const warnings = [];
    for (const objId in contributions) {
        if (contributions[objId] > 100) {
            const obj = benefitItems.find(i => i.id === parseInt(objId, 10));
            const objName = obj ? obj.title : 'ID ' + objId;
            warnings.push(objName + ': ' + contributions[objId] + '%');
        }
    }
    if (warnings.length > 0) {
        alert('Warning: The following objectives have contributions exceeding 100%:\n\n' + warnings.join('\n'));
    }

    syncBenefitsToPlanText();

    // Phase 5: Task linkage for change-type items
    if (data.type === 'change') {
        benSyncChangeTaskToEditor(data.title, oldTitle);
    }

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
    const itemType = item ? item.type : '';

    if (!confirm('Are you sure you want to delete "' + itemTitle + '"? This action cannot be undone.')) {
        return;
    }

    // Phase 5: Offer to remove the corresponding task from the plan editor
    if (itemType === 'change' && item) {
        const removeTask = confirm('Also remove the corresponding task "' + item.title + '" from the plan?');
        if (removeTask) {
            benRemoveTaskFromEditor(item.title);
        }
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

    // Recalculate scores after deletion
    calculateBenefitScores();

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
        // No benefits section in plan text — clear items
        benefitItems = [];
        benefitNextId = 1;
        const placeholder = document.querySelector('#benefits-view .benefits-placeholder');
        const content = document.querySelector('#benefits-view .benefits-content');
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
        if (benGroup) {
            while (benGroup.firstChild) benGroup.removeChild(benGroup.firstChild);
        }
        return;
    }

    // Show content, hide placeholder
    if (benefitItems.length > 0) {
        const placeholder = document.querySelector('#benefits-view .benefits-placeholder');
        const content = document.querySelector('#benefits-view .benefits-content');
        if (placeholder) placeholder.style.display = 'none';
        if (content) content.style.display = '';
    }

    // Calculate scores after parsing
    calculateBenefitScores();

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

    // If tracking view is active, also render tracking table
    if (benCurrentView === 'tracking') {
        benRenderTrackingTable();
    }
}

// ── Benefits view toggle (Map / Tracking) ───────────────────────────

let benCurrentView = 'map';

/**
 * Switch between Map and Tracking views.
 */
function benSwitchView(view) {
    benCurrentView = view;

    const mapBtn = document.getElementById('benViewMapBtn');
    const trackingBtn = document.getElementById('benViewTrackingBtn');
    const mapContainer = document.getElementById('benefitsContainer');
    const trackingContainer = document.getElementById('benefitsTrackingContainer');
    const hint = document.getElementById('benToolbarHint');
    const addGroup = document.querySelector('.benefits-add-group');

    if (view === 'map') {
        if (mapBtn) { mapBtn.classList.add('ben-view-btn--active'); mapBtn.setAttribute('aria-selected', 'true'); }
        if (trackingBtn) { trackingBtn.classList.remove('ben-view-btn--active'); trackingBtn.setAttribute('aria-selected', 'false'); }
        if (mapContainer) mapContainer.style.display = '';
        if (trackingContainer) trackingContainer.style.display = 'none';
        if (hint) hint.style.display = '';
        if (addGroup) addGroup.style.display = '';
    } else {
        if (trackingBtn) { trackingBtn.classList.add('ben-view-btn--active'); trackingBtn.setAttribute('aria-selected', 'true'); }
        if (mapBtn) { mapBtn.classList.remove('ben-view-btn--active'); mapBtn.setAttribute('aria-selected', 'false'); }
        if (mapContainer) mapContainer.style.display = 'none';
        if (trackingContainer) trackingContainer.style.display = '';
        if (hint) hint.style.display = 'none';
        if (addGroup) addGroup.style.display = 'none';
        benRenderTrackingTable();
    }
}

// ── Benefits Tracking Table ─────────────────────────────────────────

const BEN_STATUS_OPTIONS = [
    '',
    'Not Started',
    'In Progress',
    'Achieved',
    'Partially Achieved',
    'Not Achieved'
];

/**
 * Get the CSS modifier class for a status value.
 */
function benStatusClass(status) {
    if (!status) return '';
    return 'ben-status-badge--' + status.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
function benTodayDate() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

/**
 * Render the benefits tracking table with inline-editable cells.
 * Only shows benefit and disbenefit items.
 */
function benRenderTrackingTable() {
    const tbody = document.getElementById('benefitsTrackingBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const trackableItems = benefitItems.filter(i => i.type === 'benefit' || i.type === 'disbenefit');

    if (trackableItems.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'ben-tracking-empty';
        td.textContent = 'No benefits or disbenefits to track. Add items in the Map view.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    for (const item of trackableItems) {
        const tr = document.createElement('tr');
        tr.dataset.itemId = item.id;

        // Title (read-only, click to open form)
        const titleTd = document.createElement('td');
        titleTd.textContent = item.title;
        titleTd.style.cursor = 'pointer';
        titleTd.style.fontWeight = '500';
        titleTd.title = 'Click to edit details';
        titleTd.addEventListener('click', () => openBenefitForm(item.id));
        tr.appendChild(titleTd);

        // Editable text cells
        const textFields = [
            { field: 'targetValue', value: item.targetValue },
            { field: 'currentValue', value: item.currentValue },
            { field: 'targetDate', value: item.targetDate },
            { field: 'measurementMethod', value: item.measurementMethod }
        ];

        for (const { field, value } of textFields) {
            const td = document.createElement('td');
            td.className = 'ben-cell-editable';

            if (field === 'targetDate') {
                const input = document.createElement('input');
                input.type = 'date';
                input.className = 'ben-cell-input';
                input.value = value || '';
                input.addEventListener('change', () => benTrackingCellChanged(item.id, field, input.value));
                td.appendChild(input);
            } else {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'ben-cell-input';
                input.value = value || '';
                input.placeholder = field === 'targetValue' ? 'e.g. 10% savings' :
                                    field === 'currentValue' ? 'e.g. 3% savings' :
                                    field === 'measurementMethod' ? 'e.g. monthly review' : '';
                input.addEventListener('change', () => benTrackingCellChanged(item.id, field, input.value));
                td.appendChild(input);
            }

            tr.appendChild(td);
        }

        // Status dropdown
        const statusTd = document.createElement('td');
        statusTd.className = 'ben-cell-editable';
        const select = document.createElement('select');
        select.className = 'ben-cell-select';
        for (const opt of BEN_STATUS_OPTIONS) {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt || '-- Select --';
            if (opt === (item.status || '')) option.selected = true;
            select.appendChild(option);
        }
        select.addEventListener('change', () => benTrackingCellChanged(item.id, 'status', select.value));
        statusTd.appendChild(select);
        tr.appendChild(statusTd);

        // Last Updated (read-only, auto-set)
        const updatedTd = document.createElement('td');
        updatedTd.textContent = item.lastUpdated || '';
        updatedTd.style.color = '#999';
        updatedTd.style.fontSize = '12px';
        tr.appendChild(updatedTd);

        tbody.appendChild(tr);
    }
}

/**
 * Handle a change in a tracking table cell.
 * Updates the item, sets lastUpdated, and syncs to plan text.
 */
function benTrackingCellChanged(itemId, field, value) {
    const item = benefitItems.find(i => i.id === itemId);
    if (!item) return;

    item[field] = value.trim();
    item.lastUpdated = benTodayDate();

    syncBenefitsToPlanText();

    // Update the Last Updated cell in the same row
    const row = document.querySelector('#benefitsTrackingBody tr[data-item-id="' + itemId + '"]');
    if (row) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 7) {
            cells[6].textContent = item.lastUpdated;
        }
    }
}

// ── Phase 5: Task Linkage helpers ──────────────────────────────────

/**
 * Section markers used to find insertion points in the plan editor.
 */
const BEN_SECTION_MARKERS = [
    '---benefits---',
    '---raid log---',
    '---budget---',
    '---baseline---',
    '---comms---'
];

/**
 * Sync a change-type benefit item to a task in the plan editor.
 * If the change is new (no oldTitle or oldTitle matches title), create a task
 * line if it doesn't already exist. If the title was renamed, update the
 * existing task line and cascade into [depends] blocks.
 */
function benSyncChangeTaskToEditor(newTitle, oldTitle) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');

    if (oldTitle && oldTitle !== newTitle) {
        // Rename: find existing task line and update it
        benRenameTaskInLines(lines, oldTitle, newTitle);
        if (typeof updateDependencyReferences === 'function') {
            updateDependencyReferences(lines, oldTitle, newTitle);
        }
        editor.value = lines.join('\n');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        // Create: only if a matching task doesn't already exist
        const taskExists = lines.some(line => line.trim() === newTitle);
        if (!taskExists) {
            benInsertTaskLine(lines, newTitle);
            editor.value = lines.join('\n');
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}

/**
 * Find a task line matching oldTitle and rename it to newTitle.
 */
function benRenameTaskInLines(lines, oldTitle, newTitle) {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === oldTitle) {
            const indent = lines[i].match(/^(\s*)/)[1];
            lines[i] = indent + newTitle;
            return;
        }
    }
}

/**
 * Insert a new task line (indented with 2 spaces) before the first section
 * marker found in the plan editor lines.
 */
function benInsertTaskLine(lines, taskTitle) {
    let insertIdx = lines.length;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim().toLowerCase();
        if (BEN_SECTION_MARKERS.some(marker => trimmed === marker)) {
            insertIdx = i;
            break;
        }
    }

    lines.splice(insertIdx, 0, '  ' + taskTitle);
}

/**
 * Remove a task line matching the given title from the plan editor.
 */
function benRemoveTaskFromEditor(taskTitle) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const idx = lines.findIndex(line => line.trim() === taskTitle);
    if (idx !== -1) {
        lines.splice(idx, 1);
        editor.value = lines.join('\n');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * Look up the completion percentage for a task matching the given title
 * from the last parsed task list.
 * Returns a number (0-100) or null if no matching task is found.
 */
function benGetTaskCompletion(taskTitle) {
    if (typeof lastRenderedTasks === 'undefined' || !lastRenderedTasks) return null;

    const task = lastRenderedTasks.find(t => t.name === taskTitle);
    if (!task) return null;

    const pct = parseInt(task.percent, 10);
    return isNaN(pct) ? 0 : pct;
}

// ── Copy canvas as PNG ──────────────────────────────────────────────

async function copyBenefitsAsImage() {
    if (!benSvg) { alert('No benefits map to copy.'); return; }
    try {
        const serializer = new XMLSerializer();
        const svgRect = benSvg.getBoundingClientRect();
        const svgClone = benSvg.cloneNode(true);
        svgClone.setAttribute('width', svgRect.width);
        svgClone.setAttribute('height', svgRect.height);
        svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('width', '100%');
        bgRect.setAttribute('height', '100%');
        bgRect.setAttribute('fill', '#ffffff');
        svgClone.insertBefore(bgRect, svgClone.firstChild);
        svgClone.querySelectorAll('text').forEach(el => {
            el.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
        });
        const svgString = serializer.serializeToString(svgClone);
        const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
        const img = new Image();
        img.width = svgRect.width;
        img.height = svgRect.height;
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = svgDataUrl; });
        const canvas = document.createElement('canvas');
        const scale = 2;
        canvas.width = svgRect.width * scale;
        canvas.height = svgRect.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, svgRect.width, svgRect.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        const copyBtn = document.querySelector('#benefits-view .mindmap-toolbar-btn[onclick*="copyBenefitsAsImage"]');
        if (copyBtn) {
            const original = copyBtn.innerHTML;
            copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
            setTimeout(() => { copyBtn.innerHTML = original; }, 1500);
        }
    } catch (err) { alert('Failed to copy image: ' + err.message); }
}

// ── Export benefits to Excel ────────────────────────────────────────

async function exportBenefitsExcel() {
    if (benefitItems.length === 0) { alert('No benefit items to export.'); return; }
    try {
        const projectName = document.getElementById('projectName')
            ? document.getElementById('projectName').textContent.trim() : 'Benefits';
        const response = await fetch('/api/benefits/export-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: benefitItems, project_name: projectName })
        });
        if (!response.ok) throw new Error('Export failed');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (projectName || 'benefits') + '-benefits.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) { alert('Failed to export: ' + error.message); }
}
