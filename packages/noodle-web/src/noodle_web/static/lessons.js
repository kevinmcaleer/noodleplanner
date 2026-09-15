/**
 * Lessons Learned (issue #598)
 *
 * Captures project lessons learned using an Appreciative Inquiry approach.
 * Provides:
 *   - Markdown table parser/generator that round-trips through plan text
 *     between the ---lessons learned--- and ---baseline--- markers.
 *   - A detail form with all fields required by the issue.
 *   - A table view with filtering by impact type and project phase.
 *   - Sync-to-plan-text helper that preserves canonical section order.
 */

// =====================================================================
// Markdown <-> JS items
// =====================================================================

function parseLessonsMarkdown(text) {
    if (!text) return [];

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (lower.includes('|') && (
            lower.includes('observation') ||
            lower.includes('impact type') ||
            lower.includes('project manager')
        )) {
            headerIndex = i;
            break;
        }
    }
    if (headerIndex === -1) return [];

    function parseRow(line) {
        const parts = line.split(/(?<!\\)\|/);
        const cells = [];
        for (let i = 0; i < parts.length; i++) {
            const stripped = parts[i].trim();
            if (i === 0 && !stripped) continue;
            if (i === parts.length - 1 && !stripped) continue;
            cells.push(stripped);
        }
        return cells;
    }

    const headers = parseRow(lines[headerIndex]).map(h => h.toLowerCase());
    const aliases = {
        'id': 'id',
        'project manager': 'projectManager',
        'manager': 'projectManager',
        'project type': 'projectType',
        'technology': 'technology',
        'project phase': 'projectPhase',
        'phase': 'projectPhase',
        'area': 'area',
        'impact type': 'impactType',
        'observation': 'observation',
        'lesson': 'observation',
        'impact': 'impact',
        'recommendation': 'recommendations',
        'recommendations': 'recommendations',
        'date': 'date',
    };

    const colMap = {};
    headers.forEach((h, idx) => {
        for (const [alias, field] of Object.entries(aliases)) {
            if (h.includes(alias) && colMap[field] === undefined) {
                colMap[field] = idx;
                break;
            }
        }
    });

    const items = [];
    let maxId = 0;

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('|')) continue;
        if (line.replace(/[|\- ]/g, '') === '') continue;

        const cells = parseRow(line);
        if (!cells.length) continue;

        function getCell(field, def) {
            const idx = colMap[field];
            if (idx !== undefined && idx < cells.length) {
                return cells[idx].replace(/\\\|/g, '|');
            }
            return def || '';
        }

        const idStr = getCell('id', '');
        let itemId = (idStr && /^\d+$/.test(idStr)) ? parseInt(idStr, 10) : maxId + 1;
        maxId = Math.max(maxId, itemId);

        items.push({
            id: itemId,
            projectManager: getCell('projectManager', ''),
            projectType: getCell('projectType', ''),
            technology: getCell('technology', ''),
            projectPhase: getCell('projectPhase', ''),
            area: getCell('area', ''),
            impactType: getCell('impactType', 'Went Well'),
            observation: getCell('observation', ''),
            impact: getCell('impact', ''),
            recommendations: getCell('recommendations', ''),
            date: getCell('date', ''),
        });
    }

    return items;
}

function generateLessonsMarkdown() {
    if (!lessonsItems || lessonsItems.length === 0) return '';

    const headers = ['ID', 'Project Manager', 'Project Type', 'Technology',
                     'Project Phase', 'Area', 'Impact Type', 'Observation',
                     'Impact', 'Recommendations', 'Date'];
    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const rows = lessonsItems.map(item => [
        String(item.id || ''),
        escPipe(item.projectManager),
        escPipe(item.projectType),
        escPipe(item.technology),
        escPipe(item.projectPhase),
        escPipe(item.area),
        escPipe(item.impactType),
        escPipe(item.observation),
        escPipe(item.impact),
        escPipe(item.recommendations),
        escPipe(item.date),
    ]);

    const widths = headers.map(h => h.length);
    rows.forEach(row => row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i], cell.length);
    }));

    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    const out = [formatRow(headers), separator];
    rows.forEach(row => out.push(formatRow(row)));
    return out.join('\n');
}

function extractLessonsFromPlanText(planText) {
    if (!planText) return '';
    const startIdx = planText.indexOf(LESSONS_START);
    if (startIdx === -1) return '';
    const afterStart = startIdx + LESSONS_START.length;
    let endIdx = planText.length;
    for (const marker of [BASELINE_START, WHITEBOARD_START]) {
        const mIdx = planText.indexOf(marker, afterStart);
        if (mIdx !== -1 && mIdx < endIdx) endIdx = mIdx;
    }
    return planText.substring(afterStart, endIdx).trim();
}

function extractLessonsItemsFromPlanText(planText) {
    try {
        const text = extractLessonsFromPlanText(planText);
        if (!text) return [];
        return parseLessonsMarkdown(text);
    } catch (error) {
        console.error('Error extracting lessons items from plan text:', error);
        return [];
    }
}

// =====================================================================
// Sync to plan text (preserves canonical section order)
// =====================================================================

function syncLessonsToPlanText() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const planText = editor.value;
    const updatedText = updatePlanLessonsText(planText, lessonsItems);

    if (updatedText !== planText) {
        if (typeof setEditorValuePreservingCursor === 'function') {
            setEditorValuePreservingCursor(editor, updatedText);
        } else {
            editor.value = updatedText;
        }
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) kanbanEditor.value = updatedText;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function updatePlanLessonsText(planText, items) {
    const HIGHLIGHTS_START_M = '---highlights---';
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

    const highlightsText = extractSection(planText, HIGHLIGHTS_START_M,
        [HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const hasEndHighlights = planText.includes(HIGHLIGHTS_END);
    const budgetText = extractSection(planText, BUDGET_START,
        [BENEFITS_START, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const benefitsText = extractSection(planText, BENEFITS_START,
        [RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const raidText = extractSection(planText, RAID_LOG_START,
        [COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const commsText = extractSection(planText, COMMS_START,
        [LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const baselineText = extractSection(planText, BASELINE_START, [WHITEBOARD_START]);
    const whiteboardText = extractSection(planText, WHITEBOARD_START, []);

    let base = planText;
    const sectionMarkers = [HIGHLIGHTS_START_M, BUDGET_START, BENEFITS_START,
                            RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START];
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

    let result = base;
    if (highlightsText) {
        result = result + '\n\n---\n\n' + HIGHLIGHTS_START_M + '\n' + highlightsText;
        if (hasEndHighlights) {
            result = result.replace(/\n+$/, '') + '\n\n' + HIGHLIGHTS_END;
        }
    }
    if (budgetText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BUDGET_START + '\n' + budgetText;
    }
    if (benefitsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BENEFITS_START + '\n' + benefitsText;
    }
    if (raidText) {
        result = result.replace(/\n+$/, '') + '\n\n' + RAID_LOG_START + '\n' + raidText;
    }
    if (commsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + COMMS_START + '\n' + commsText;
    }

    const table = generateLessonsMarkdown();
    if (table) {
        result = result.replace(/\n+$/, '') + '\n\n' + LESSONS_START + '\n' + table;
    }

    if (baselineText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BASELINE_START + '\n' + baselineText;
    }

    if (whiteboardText) {
        result = result.replace(/\n+$/, '') + '\n\n' + WHITEBOARD_START + '\n' + whiteboardText;
    }

    return result;
}

// =====================================================================
// Item lifecycle
// =====================================================================

function clearLessonsEntries() {
    lessonsItems = [];
    lessonsNextId = 1;
    renderLessonsTable();
}

function loadLessonsItemsFromData(items) {
    try {
        if (!items || items.length === 0) return;
        if (lessonsItems.length > 0) return;
        lessonsItems = items.map(it => ({
            id: it.id,
            projectManager: it.project_manager || it.projectManager || '',
            projectType: it.project_type || it.projectType || '',
            technology: it.technology || '',
            projectPhase: it.project_phase || it.projectPhase || '',
            area: it.area || '',
            impactType: it.impact_type || it.impactType || 'Went Well',
            observation: it.observation || '',
            impact: it.impact || '',
            recommendations: it.recommendations || '',
            date: it.date || '',
        }));
        lessonsNextId = Math.max(...lessonsItems.map(i => i.id || 0), 0) + 1;
        renderLessonsTable();
    } catch (error) {
        console.error('Error loading lessons items:', error);
    }
}

function loadLessonsItemsIfEmpty() {
    if (lessonsItems.length === 0) {
        try {
            const editor = document.getElementById('planEditor');
            if (editor && editor.value) {
                const items = extractLessonsItemsFromPlanText(editor.value);
                if (items.length > 0) {
                    loadLessonsItemsFromData(items);
                }
            }
        } catch (error) {
            console.error('Error loading lessons items on tab switch:', error);
        }
    }
}

function updateLessonsView(result, planText) {
    const fromApi = (result && result.lessons_items) || [];
    if (fromApi.length > 0) {
        lessonsItems = [];
        loadLessonsItemsFromData(fromApi);
    } else {
        const fromText = extractLessonsItemsFromPlanText(planText);
        lessonsItems = [];
        loadLessonsItemsFromData(fromText);
    }
}

function addLessonsItem() {
    openLessonsForm(null);
}

function openLessonsForm(itemId) {
    const title = document.getElementById('lessonsFormTitle');
    const idField = document.getElementById('lessonsItemId');
    const deleteRow = document.getElementById('lessonsDeleteButtonRow');

    if (itemId != null) {
        const item = lessonsItems.find(i => i.id === itemId);
        if (!item) return;
        title.textContent = 'Edit Lesson Learned';
        idField.value = item.id;
        document.getElementById('lessonsItemProjectManager').value = item.projectManager || '';
        document.getElementById('lessonsItemProjectType').value = item.projectType || '';
        document.getElementById('lessonsItemTechnology').value = item.technology || '';
        document.getElementById('lessonsItemProjectPhase').value = item.projectPhase || '';
        document.getElementById('lessonsItemArea').value = item.area || '';
        document.getElementById('lessonsItemImpactType').value = item.impactType || 'Went Well';
        document.getElementById('lessonsItemObservation').value = item.observation || '';
        document.getElementById('lessonsItemImpact').value = item.impact || '';
        document.getElementById('lessonsItemRecommendations').value = item.recommendations || '';
        document.getElementById('lessonsItemDate').value = item.date || '';
        if (deleteRow) deleteRow.style.display = 'block';
    } else {
        title.textContent = 'New Lesson Learned';
        idField.value = '';
        // Pre-populate manager from front matter if available
        let pm = '';
        try {
            const editor = document.getElementById('planEditor');
            if (editor && editor.value) {
                const m = editor.value.match(/^manager:\s*(.+)$/m);
                if (m) pm = m[1].trim();
            }
        } catch (e) { /* ignore */ }
        document.getElementById('lessonsItemProjectManager').value = pm;
        document.getElementById('lessonsItemProjectType').value = '';
        document.getElementById('lessonsItemTechnology').value = '';
        document.getElementById('lessonsItemProjectPhase').value = '';
        document.getElementById('lessonsItemArea').value = '';
        document.getElementById('lessonsItemImpactType').value = 'Went Well';
        document.getElementById('lessonsItemObservation').value = '';
        document.getElementById('lessonsItemImpact').value = '';
        document.getElementById('lessonsItemRecommendations').value = '';
        // Default to today
        const today = new Date().toISOString().slice(0, 10);
        document.getElementById('lessonsItemDate').value = today;
        if (deleteRow) deleteRow.style.display = 'none';
    }

    if (typeof openDetailPane === 'function') {
        openDetailPane('lessonsFormSection');
    }
}

function closeLessonsForm() {
    if (typeof closeDetailPane === 'function') closeDetailPane();
}

function saveLessonsItemFromForm() {
    const idField = document.getElementById('lessonsItemId').value;
    const observation = document.getElementById('lessonsItemObservation').value.trim();

    if (!observation) {
        alert('Please enter an observation for the lesson.');
        return;
    }

    const itemData = {
        projectManager: document.getElementById('lessonsItemProjectManager').value.trim(),
        projectType: document.getElementById('lessonsItemProjectType').value.trim(),
        technology: document.getElementById('lessonsItemTechnology').value.trim(),
        projectPhase: document.getElementById('lessonsItemProjectPhase').value,
        area: document.getElementById('lessonsItemArea').value,
        impactType: document.getElementById('lessonsItemImpactType').value,
        observation: observation,
        impact: document.getElementById('lessonsItemImpact').value.trim(),
        recommendations: document.getElementById('lessonsItemRecommendations').value.trim(),
        date: document.getElementById('lessonsItemDate').value,
    };

    if (idField) {
        const existingId = parseInt(idField, 10);
        const idx = lessonsItems.findIndex(i => i.id === existingId);
        if (idx >= 0) {
            lessonsItems[idx] = { ...lessonsItems[idx], ...itemData };
        }
    } else {
        itemData.id = lessonsNextId++;
        lessonsItems.push(itemData);
    }

    closeLessonsForm();
    renderLessonsTable();
    syncLessonsToPlanText();
}

function deleteLessonsItem(id) {
    if (!confirm('Are you sure you want to delete this lesson?')) return;
    lessonsItems = lessonsItems.filter(i => i.id !== id);
    renderLessonsTable();
    syncLessonsToPlanText();
}

function confirmDeleteLessonsItem() {
    const idField = document.getElementById('lessonsItemId').value;
    if (!idField) return;
    lessonsItemPendingDeleteId = parseInt(idField, 10);
    const item = lessonsItems.find(i => i.id === lessonsItemPendingDeleteId);
    const desc = item ? (item.observation || 'this lesson') : 'this lesson';

    const msg = document.getElementById('lessonsDeleteConfirmMessage');
    if (msg) {
        msg.textContent = 'Are you sure you want to delete "' + desc + '"? This action cannot be undone.';
    }
    const overlay = document.getElementById('lessonsDeleteConfirmOverlay');
    if (overlay) overlay.classList.add('active');
}

function cancelDeleteLessonsItem() {
    lessonsItemPendingDeleteId = null;
    const overlay = document.getElementById('lessonsDeleteConfirmOverlay');
    if (overlay) overlay.classList.remove('active');
}

function executeDeleteLessonsItem() {
    if (lessonsItemPendingDeleteId == null) return;
    lessonsItems = lessonsItems.filter(i => i.id !== lessonsItemPendingDeleteId);
    lessonsItemPendingDeleteId = null;
    const overlay = document.getElementById('lessonsDeleteConfirmOverlay');
    if (overlay) overlay.classList.remove('active');
    closeLessonsForm();
    renderLessonsTable();
    syncLessonsToPlanText();
}

// =====================================================================
// Rendering
// =====================================================================

function renderLessonsTable() {
    const tbody = document.getElementById('lessonsTableBody');
    const emptyState = document.getElementById('lessonsEmptyState');
    const table = document.getElementById('lessonsTable');
    if (!tbody || !emptyState || !table) return;

    const filterImpactEl = document.getElementById('lessonsFilterImpact');
    const filterPhaseEl = document.getElementById('lessonsFilterPhase');
    const filterImpact = filterImpactEl ? filterImpactEl.value : 'all';
    const filterPhase = filterPhaseEl ? filterPhaseEl.value : 'all';

    let filtered = lessonsItems.filter(item => {
        if (filterImpact !== 'all' && item.impactType !== filterImpact) return false;
        if (filterPhase !== 'all' && item.projectPhase !== filterPhase) return false;
        return true;
    });

    filtered.sort((a, b) => {
        let valA = a[lessonsSortColumn];
        let valB = b[lessonsSortColumn];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return lessonsSortAsc ? -1 : 1;
        if (valA > valB) return lessonsSortAsc ? 1 : -1;
        return 0;
    });

    tbody.innerHTML = '';

    if (lessonsItems.length === 0) {
        emptyState.hidden = false;
        table.style.display = 'none';
        return;
    }

    emptyState.hidden = true;
    table.style.display = 'table';

    const escapeHtml = (s) => String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const impactBadgeClass = (impact) => {
        const v = (impact || '').toLowerCase();
        if (v.includes('went well')) return 'lesson-impact-positive';
        if (v.includes('needs')) return 'lesson-impact-change';
        return 'lesson-impact-mixed';
    };

    filtered.forEach(item => {
        try {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.id || ''}</td>
                <td>${escapeHtml(item.projectPhase)}</td>
                <td>${escapeHtml(item.area)}</td>
                <td><span class="raid-status-badge ${impactBadgeClass(item.impactType)}">${escapeHtml(item.impactType)}</span></td>
                <td title="${escapeHtml(item.observation)}">${escapeHtml(item.observation)}</td>
                <td title="${escapeHtml(item.impact)}">${escapeHtml(item.impact)}</td>
                <td title="${escapeHtml(item.recommendations)}">${escapeHtml(item.recommendations)}</td>
                <td>${escapeHtml(item.projectManager)}</td>
                <td>${escapeHtml(item.date)}</td>
                <td>
                    <np-button icon-only variant="neutral" size="small" title="Edit" label="Edit" onclick="openLessonsForm(${item.id})"><span slot="icon">&#9998;&#65039;</span></np-button>
                    <np-button icon-only variant="neutral" size="small" title="Open source row in plan editor" label="Open source row in plan editor" onclick="SectionFolding.jumpToBackMatterSection('---lessons learned---', ${item.id}, 'tasks')"><i class="bi bi-code-slash" slot="icon"></i></np-button>
                    <np-button icon-only variant="danger" size="small" title="Delete" label="Delete" onclick="deleteLessonsItem(${item.id})"><span slot="icon">&#128465;&#65039;</span></np-button>
                </td>
            `;
            tbody.appendChild(row);
        } catch (err) {
            console.warn('Skipping malformed lesson row:', item, err);
        }
    });

    if (typeof updateLessonsSortIndicators === 'function') updateLessonsSortIndicators();
}

function sortLessonsTable(column) {
    if (lessonsSortColumn === column) {
        lessonsSortAsc = !lessonsSortAsc;
    } else {
        lessonsSortColumn = column;
        lessonsSortAsc = true;
    }
    renderLessonsTable();
}

function updateLessonsSortIndicators() {
    const table = document.getElementById('lessonsTable');
    if (!table) return;
    const headers = table.querySelectorAll('th');
    headers.forEach(th => {
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) {
            const onclick = th.getAttribute('onclick');
            if (onclick && onclick.includes(`'${lessonsSortColumn}'`)) {
                indicator.textContent = lessonsSortAsc ? '▲' : '▼';
            } else {
                indicator.textContent = '';
            }
        }
    });
}
