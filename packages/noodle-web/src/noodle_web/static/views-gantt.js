/**
 * views-gantt.js — Gantt chart rendering, drag interactions, and dependency helpers.
 * Depends on: state.js (globals), editor-sync.js
 */

function parseLocalDate(dateString) {
    if (!dateString) return null;

    // Split the date string (YYYY-MM-DD)
    const parts = dateString.split('-');
    if (parts.length !== 3) return new Date(dateString);

    // Create date using local timezone (month is 0-indexed)
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    return new Date(year, month, day);
}

/**
 * Format a local Date object as YYYY-MM-DD string without timezone conversion.
 * Unlike toISOString().split('T')[0], this preserves the local date correctly
 * regardless of the user's timezone offset.
 */
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ----- Dependency / Predecessors helpers -----

/**
 * Build a lookup from lowercase task name to Gantt row ID.
 * Called once per render so every helper can reuse it.
 */
function buildTaskNameToIdMap(tasks) {
    const map = {};
    tasks.forEach(t => {
        if (t.name) {
            map[t.name.toLowerCase()] = t.id;
        }
    });
    return map;
}

/**
 * Build a lookup from Gantt row ID to task name.
 */
function buildIdToTaskNameMap(tasks) {
    const map = {};
    tasks.forEach(t => {
        map[t.id] = t.name;
    });
    return map;
}

/**
 * Convert a task's depends[] + lag_lead{} + dependency_types{} into a display
 * string like "3FS, 5SS+2d".
 * Dependency types: FS (Finish-Start), SS (Start-Start), FF (Finish-Finish), SF (Start-Finish).
 */
function formatPredecessors(task, nameToId) {
    if (!task.depends || task.depends.length === 0) return '';
    const lagLead = task.lag_lead || {};
    const depTypes = task.dependency_types || {};
    const parts = [];
    for (const depName of task.depends) {
        const depId = nameToId[depName.toLowerCase()];
        if (depId === undefined) continue;  // unknown dependency — skip
        const depType = depTypes[depName] || 'FS';
        let entry = depId + depType;
        if (lagLead[depName]) {
            // lagLead values look like "+2d" or "-1w"
            entry += lagLead[depName];
        }
        parts.push(entry);
    }
    return parts.join(', ');
}

/**
 * Parse a predecessors display string (e.g. "3FS, 5SS+2d") back into
 * { depends: [name1, name2], lag_lead: { name1: '+2d' }, dependency_types: { name2: 'SS' } }.
 * Returns null if parsing fails.
 */
function parsePredecessorsString(str, idToName) {
    if (!str || !str.trim()) return { depends: [], lag_lead: {}, dependency_types: {} };
    const depends = [];
    const lagLead = {};
    const depTypes = {};
    const specs = str.split(',');
    for (let spec of specs) {
        spec = spec.trim();
        if (!spec) continue;
        // Pattern: ID + type (FS/SS/FF/SF) + optional lag like "+2d" or "-1w"
        const m = spec.match(/^(\d+)\s*(FS|SS|FF|SF)\s*([+-]\d+[dwmy])?$/i);
        if (!m) return null;  // invalid format
        const id = parseInt(m[1], 10);
        const depType = m[2].toUpperCase();
        const name = idToName[id];
        if (!name) return null;  // unknown ID
        depends.push(name);
        if (depType !== 'FS') {
            depTypes[name] = depType;
        }
        if (m[3]) {
            lagLead[name] = m[3];
        }
    }
    return { depends, lag_lead: lagLead, dependency_types: depTypes };
}

/**
 * Detect dependency loops in ganttTasks using DFS.
 * Returns true if adding the proposed dependencies for taskId would create a cycle.
 * proposedDeps is an array of task IDs that taskId would depend on.
 */
function wouldCreateLoop(taskId, proposedDepIds, tasks) {
    // Build adjacency: task ID -> set of IDs it depends on
    const deps = {};
    tasks.forEach(t => {
        deps[t.id] = new Set();
        if (t.depends && t.depends.length > 0) {
            const nameToId = buildTaskNameToIdMap(tasks);
            for (const dn of t.depends) {
                const did = nameToId[dn.toLowerCase()];
                if (did !== undefined) deps[t.id].add(did);
            }
        }
    });
    // Apply the proposed change
    deps[taskId] = new Set(proposedDepIds);

    // DFS from each proposed dep — can we reach taskId?
    const visited = new Set();
    function canReach(current, target) {
        if (current === target) return true;
        if (visited.has(current)) return false;
        visited.add(current);
        if (!deps[current]) return false;
        for (const next of deps[current]) {
            if (canReach(next, target)) return true;
        }
        return false;
    }
    for (const depId of proposedDepIds) {
        visited.clear();
        if (canReach(depId, taskId)) return true;
    }
    return false;
}

function updateGantt(tasks) {
    try {
        // Show gantt content, hide placeholder
        const placeholder = document.querySelector('#gantt-view .placeholder-view');
        const content = document.querySelector('#gantt-view .gantt-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Store tasks globally for editing
        ganttTasks = tasks;

        // Filter tasks with dates
        const tasksWithDates = tasks.filter(t => t.start && t.finish);
        if (tasksWithDates.length === 0) return;

        // Find date range and add 1 week buffer before/after
        // Parse dates explicitly to avoid timezone issues
        const allDates = tasksWithDates.flatMap(t => {
            const start = parseLocalDate(t.start);
            const finish = parseLocalDate(t.finish);
            return [start, finish];
        });
        ganttMinDate = new Date(Math.min(...allDates));
        ganttMaxDate = new Date(Math.max(...allDates));

        // Add 1 week (7 days) buffer before and after
        ganttMinDate.setDate(ganttMinDate.getDate() - 7);
        ganttMaxDate.setDate(ganttMaxDate.getDate() + 7);

        // Set up scale selector if not already done
        const scaleSelector = document.getElementById('ganttScale');
        if (scaleSelector && !scaleSelector.dataset.initialized) {
            scaleSelector.addEventListener('change', function() {
                ganttScale = this.value;
                renderGanttChart();
            });
            scaleSelector.dataset.initialized = 'true';
        }

        // Set up dependency toggle if not already done
        const depToggle = document.getElementById('ganttShowDependencies');
        if (depToggle && !depToggle.dataset.initialized) {
            depToggle.addEventListener('change', function() {
                renderDependencyLines();
            });
            depToggle.dataset.initialized = 'true';
        }

        // Initial render
        renderGanttChart();

    } catch (error) {
        console.error('Error updating gantt chart:', error);
    }
}

function renderGanttChart() {
    // Adjust pixels per day based on scale
    switch (ganttScale) {
        case 'days':
            ganttPixelsPerDay = 28;
            break;
        case 'weeks':
            ganttPixelsPerDay = 12;
            break;
        case 'months':
            ganttPixelsPerDay = 5;
            break;
        case 'quarters':
            ganttPixelsPerDay = 3;
            break;
        case 'years':
            ganttPixelsPerDay = 1;
            break;
    }

    // Restore saved splitter position
    const savedWidth = localStorage.getItem('ganttTableWidth');
    if (savedWidth) {
        const tableSide = document.querySelector('.gantt-table-side');
        if (tableSide) {
            tableSide.style.width = savedWidth + 'px';
        }
    }

    // Render headers based on scale
    renderGanttHeaders();

    // Render task rows
    renderGanttRows();

    // Align task rows with Gantt bars by compensating for header height differences
    alignGanttRows();

    // Render dependency lines if toggle is on
    renderDependencyLines();

    // Auto-scroll to current date (only in days view)
    if (ganttScale === 'days') {
        scrollGanttToToday();
    }
}

/**
 * Align the Gantt chart body rows with the task list rows by compensating
 * for any difference in header heights (e.g. the month-title row in days view
 * makes the chart header taller than the table header).
 *
 * Both sides scroll vertically in sync. Both have sticky headers (the table
 * thead and the chart .gantt-header). When the chart header is taller, the
 * chart body starts lower, so we need to push the table body down by the
 * same amount. We achieve this by setting the table thead's min-height to
 * match the chart header height.
 */
function alignGanttRows() {
    const tableHead = document.querySelector('.gantt-info-table thead');
    const chartHeader = document.getElementById('ganttHeader');

    if (!tableHead || !chartHeader) return;

    // Reset any previous override so we measure natural heights
    const headRow = tableHead.querySelector('tr');
    if (headRow) {
        headRow.style.height = '';
    }

    // Use requestAnimationFrame to ensure layout is computed after render
    requestAnimationFrame(() => {
        const tableHeaderHeight = tableHead.offsetHeight;
        const chartHeaderHeight = chartHeader.offsetHeight;

        if (chartHeaderHeight > tableHeaderHeight && headRow) {
            // Make the table header row taller to match the chart header
            headRow.style.height = chartHeaderHeight + 'px';
        }
    });
}

function scrollGanttToToday() {
    // Scroll the chart side so today is the second visible column
    const chartSide = document.querySelector('.gantt-chart-side');
    const todayColumn = document.querySelector('.gantt-day-cell.gantt-today');

    if (!chartSide || !todayColumn) {
        return;
    }

    // Position today as the second column: offset by one column width
    const todayOffset = todayColumn.offsetLeft;
    const scrollPosition = todayOffset - ganttPixelsPerDay;

    chartSide.scrollLeft = Math.max(0, scrollPosition);
}

function renderGanttHeaders() {
    const ganttHeader = document.getElementById('ganttHeader');
    if (!ganttHeader) return;

    ganttHeader.innerHTML = '';

    // Set header min-width to match the total date range width
    // This prevents flex children from shrinking and misaligning with the body
    const minDate = new Date(ganttMinDate);
    const maxDate = new Date(ganttMaxDate);
    minDate.setHours(0, 0, 0, 0);
    maxDate.setHours(0, 0, 0, 0);
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
    const totalWidth = totalDays * ganttPixelsPerDay;
    ganttHeader.style.minWidth = totalWidth + 'px';

    switch (ganttScale) {
        case 'days':
            renderDayHeaders(ganttHeader);
            break;
        case 'weeks':
            renderWeekHeaders(ganttHeader);
            break;
        case 'months':
            renderMonthHeaders(ganttHeader);
            break;
        case 'quarters':
            renderQuarterHeaders(ganttHeader);
            break;
        case 'years':
            renderYearHeaders(ganttHeader);
            break;
    }
}

function renderMonthHeaders(container) {
    const months = [];
    let currentMonth = new Date(ganttMinDate);
    currentMonth.setDate(1);

    while (currentMonth <= ganttMaxDate) {
        const nextMonth = new Date(currentMonth);
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        const monthStart = new Date(Math.max(currentMonth, ganttMinDate));
        const monthEnd = new Date(Math.min(nextMonth, ganttMaxDate));
        const daysInView = Math.ceil((monthEnd - monthStart) / (1000 * 60 * 60 * 24));

        months.push({
            name: currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            days: daysInView
        });

        currentMonth = nextMonth;
    }

    months.forEach(month => {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'gantt-month';
        monthDiv.style.width = (month.days * ganttPixelsPerDay) + 'px';
        monthDiv.textContent = month.name;
        container.appendChild(monthDiv);
    });
}

function renderDayHeaders(container) {
    // Use a two-row layout: month names row on top, day numbers below
    container.style.flexWrap = 'wrap';

    let currentDate = new Date(ganttMinDate);
    const endDate = new Date(ganttMaxDate);
    const today = new Date();

    currentDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    // First pass: build month spans for the month row
    const monthRow = document.createElement('div');
    monthRow.className = 'gantt-month-row';

    const months = [];
    let iterDate = new Date(currentDate);
    while (iterDate <= endDate) {
        const monthKey = iterDate.getFullYear() + '-' + iterDate.getMonth();
        if (months.length === 0 || months[months.length - 1].key !== monthKey) {
            months.push({
                key: monthKey,
                name: iterDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                days: 1
            });
        } else {
            months[months.length - 1].days++;
        }
        iterDate.setDate(iterDate.getDate() + 1);
    }

    months.forEach(month => {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'gantt-month-label';
        monthDiv.style.width = (month.days * ganttPixelsPerDay) + 'px';
        monthDiv.textContent = month.name;
        monthRow.appendChild(monthDiv);
    });

    container.appendChild(monthRow);

    // Second pass: day number row
    const dayRow = document.createElement('div');
    dayRow.className = 'gantt-day-row';

    currentDate = new Date(ganttMinDate);
    currentDate.setHours(0, 0, 0, 0);

    while (currentDate <= endDate) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'gantt-month gantt-day-cell';
        dayDiv.style.width = ganttPixelsPerDay + 'px';
        dayDiv.textContent = currentDate.getDate();
        dayDiv.title = currentDate.toLocaleDateString();

        if (currentDate.getTime() === today.getTime()) {
            dayDiv.classList.add('gantt-today');
        }

        dayRow.appendChild(dayDiv);
        currentDate.setDate(currentDate.getDate() + 1);
    }

    container.appendChild(dayRow);
}

function renderWeekHeaders(container) {
    let currentDate = new Date(ganttMinDate);

    while (currentDate <= ganttMaxDate) {
        const weekStart = new Date(currentDate);
        const weekEnd = new Date(currentDate);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const actualEnd = weekEnd > ganttMaxDate ? ganttMaxDate : weekEnd;
        const daysInWeek = Math.ceil((actualEnd - weekStart) / (1000 * 60 * 60 * 24)) + 1;

        const weekDiv = document.createElement('div');
        weekDiv.className = 'gantt-month';
        weekDiv.style.width = (daysInWeek * ganttPixelsPerDay) + 'px';
        weekDiv.textContent = `Week ${getWeekNumber(weekStart)}`;
        container.appendChild(weekDiv);

        currentDate.setDate(currentDate.getDate() + 7);
    }
}

function renderQuarterHeaders(container) {
    let currentDate = new Date(ganttMinDate);
    currentDate.setMonth(Math.floor(currentDate.getMonth() / 3) * 3, 1);

    while (currentDate <= ganttMaxDate) {
        const quarterStart = new Date(currentDate);
        const quarterEnd = new Date(currentDate);
        quarterEnd.setMonth(quarterEnd.getMonth() + 3);

        const actualStart = quarterStart < ganttMinDate ? ganttMinDate : quarterStart;
        const actualEnd = quarterEnd > ganttMaxDate ? ganttMaxDate : quarterEnd;
        const daysInQuarter = Math.ceil((actualEnd - actualStart) / (1000 * 60 * 60 * 24));

        const quarter = Math.floor(currentDate.getMonth() / 3) + 1;
        const year = currentDate.getFullYear();

        const quarterDiv = document.createElement('div');
        quarterDiv.className = 'gantt-month';
        quarterDiv.style.width = (daysInQuarter * ganttPixelsPerDay) + 'px';
        quarterDiv.textContent = `Q${quarter} ${year}`;
        container.appendChild(quarterDiv);

        currentDate.setMonth(currentDate.getMonth() + 3);
    }
}

function renderYearHeaders(container) {
    let currentDate = new Date(ganttMinDate);
    currentDate.setMonth(0, 1);

    while (currentDate <= ganttMaxDate) {
        const yearStart = new Date(currentDate);
        const yearEnd = new Date(currentDate);
        yearEnd.setFullYear(yearEnd.getFullYear() + 1);

        const actualStart = yearStart < ganttMinDate ? ganttMinDate : yearStart;
        const actualEnd = yearEnd > ganttMaxDate ? ganttMaxDate : yearEnd;
        const daysInYear = Math.ceil((actualEnd - actualStart) / (1000 * 60 * 60 * 24));

        const yearDiv = document.createElement('div');
        yearDiv.className = 'gantt-month';
        yearDiv.style.width = (daysInYear * ganttPixelsPerDay) + 'px';
        yearDiv.textContent = currentDate.getFullYear();
        container.appendChild(yearDiv);

        currentDate.setFullYear(currentDate.getFullYear() + 1);
    }
}

function renderGanttRows() {
    const ganttInfoBody = document.getElementById('ganttInfoBody');
    const ganttBody = document.getElementById('ganttBody');

    if (!ganttInfoBody || !ganttBody) return;

    ganttInfoBody.innerHTML = '';
    ganttBody.innerHTML = '';

    if (!ganttTasks || ganttTasks.length === 0) return;

    // Calculate total days in range and set body width to match header
    const minDate = new Date(ganttMinDate);
    const maxDate = new Date(ganttMaxDate);
    minDate.setHours(0, 0, 0, 0);
    maxDate.setHours(0, 0, 0, 0);
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
    const totalWidth = totalDays * ganttPixelsPerDay;
    ganttBody.style.minWidth = totalWidth + 'px';

    // Render weekend/day grid if scale is days
    if (ganttScale === 'days') {
        renderWeekendHighlights(ganttBody);
    }

    // Build a set of task indices that should be hidden due to collapsed parents
    const hiddenIndices = new Set();
    for (let i = 0; i < ganttTasks.length; i++) {
        const task = ganttTasks[i];
        if (task.is_summary && collapsedSummaryTasks.has(task.id)) {
            // Hide all descendants: tasks after this one with a higher level,
            // until we hit a task at the same or lower level
            for (let j = i + 1; j < ganttTasks.length; j++) {
                if (ganttTasks[j].level <= task.level) break;
                hiddenIndices.add(j);
            }
        }
    }

    ganttTasks.forEach((task, index) => {
        // Skip hidden tasks (children of collapsed summary tasks)
        const isHidden = hiddenIndices.has(index);

        // Get conditional formatting for this task
        const cfStyle = !task.is_summary ? getConditionalFormatting(task) : null;

        // Info row
        const infoRow = document.createElement('tr');
        infoRow.dataset.taskIndex = index;
        if (task.is_summary) {
            infoRow.classList.add('gantt-phase-row');
        }
        if (isHidden) {
            infoRow.style.display = 'none';
        }
        // Apply conditional formatting to info row
        if (cfStyle) {
            infoRow.style.backgroundColor = cfStyle.backgroundColor;
            infoRow.style.color = cfStyle.color;
        }

        // Done piechart cell (skip for summary tasks)
        const doneCell = document.createElement('td');
        doneCell.classList.add('gantt-done-cell');
        if (!task.is_summary) {
            const percent = parseFloat(task.percent) || 0;
            const piechart = createMiniPiechart(percent, (newPercent) => {
                task.percent = newPercent;
                syncGanttPercentToEditor(task, index);
            });
            doneCell.appendChild(piechart);
        }
        infoRow.appendChild(doneCell);

        // ID cell (not editable)
        const idCell = document.createElement('td');
        idCell.textContent = task.id;
        infoRow.appendChild(idCell);

        // Task Name cell (editable) with context menu button
        const nameCell = document.createElement('td');
        nameCell.classList.add('editable', 'task-name-cell');
        nameCell.dataset.field = 'name';
        nameCell.style.position = 'relative';
        const indent = '  '.repeat(task.level);

        const ganttNameSpan = document.createElement('span');
        ganttNameSpan.classList.add('task-name-text');
        ganttNameSpan.style.whiteSpace = 'pre';

        // Add disclosure triangle for summary tasks
        if (task.is_summary) {
            const triangle = document.createElement('span');
            triangle.className = 'gantt-disclosure-triangle';
            const isCollapsed = collapsedSummaryTasks.has(task.id);
            triangle.textContent = isCollapsed ? '\u25B6' : '\u25BC';
            if (isCollapsed) {
                triangle.classList.add('collapsed');
            }
            triangle.addEventListener('click', (e) => {
                e.stopPropagation();
                if (collapsedSummaryTasks.has(task.id)) {
                    collapsedSummaryTasks.delete(task.id);
                } else {
                    collapsedSummaryTasks.add(task.id);
                }
                renderGanttRows();
            });
            ganttNameSpan.style.fontWeight = '600';
            ganttNameSpan.appendChild(document.createTextNode(indent));
            ganttNameSpan.appendChild(triangle);
            ganttNameSpan.appendChild(document.createTextNode(' ' + task.name));
        } else {
            ganttNameSpan.textContent = indent + task.name;
        }
        nameCell.appendChild(ganttNameSpan);

        // Context menu button inside name cell
        const ganttContextBtn = createTaskContextButton(task, index);
        nameCell.appendChild(ganttContextBtn);

        nameCell.addEventListener('dblclick', () => makeEditable(nameCell, task, index));
        infoRow.appendChild(nameCell);

        // Duration cell (editable)
        const durationCell = document.createElement('td');
        durationCell.classList.add('editable');
        durationCell.dataset.field = 'duration';
        durationCell.textContent = task.duration_days ? `${task.duration_days}d` : '-';
        durationCell.addEventListener('dblclick', () => makeEditable(durationCell, task, index));
        infoRow.appendChild(durationCell);

        // Start cell (editable)
        const startCell = document.createElement('td');
        startCell.classList.add('editable');
        startCell.dataset.field = 'start';
        startCell.textContent = task.start || '-';
        startCell.addEventListener('dblclick', () => makeEditable(startCell, task, index));
        infoRow.appendChild(startCell);

        // Finish cell (editable)
        const finishCell = document.createElement('td');
        finishCell.classList.add('editable');
        finishCell.dataset.field = 'finish';
        finishCell.textContent = task.finish || '-';
        finishCell.addEventListener('dblclick', () => makeEditable(finishCell, task, index));
        infoRow.appendChild(finishCell);

        // Resources cell (editable, unless inherited)
        const resourcesCell = document.createElement('td');
        resourcesCell.classList.add('editable');
        resourcesCell.dataset.field = 'resources';
        resourcesCell.textContent = task.resources || '-';
        if (task.inherited_resource) {
            resourcesCell.style.fontStyle = 'italic';
            resourcesCell.title = 'Inherited from parent summary task';
        }
        resourcesCell.addEventListener('dblclick', () => makeEditable(resourcesCell, task, index));
        infoRow.appendChild(resourcesCell);

        // Percent cell (editable)
        const percentCell = document.createElement('td');
        percentCell.classList.add('editable');
        percentCell.dataset.field = 'percent';
        percentCell.textContent = task.percent ? `${String(task.percent).replace('%', '')}%` : '-';
        percentCell.addEventListener('dblclick', () => makeEditable(percentCell, task, index));
        infoRow.appendChild(percentCell);

        // RAG cell (not editable)
        const ragCell = document.createElement('td');
        ragCell.classList.add('gantt-rag-cell');
        if (task.rag) {
            const ganttRagColour = ragStatusToColour(task.rag);
            const ragDot = document.createElement('span');
            ragDot.className = 'gantt-rag-dot' + (ganttRagColour ? ' rag-' + ganttRagColour : '');
            ragDot.title = task.rag;
            ragCell.appendChild(ragDot);
        } else {
            ragCell.textContent = '-';
        }
        infoRow.appendChild(ragCell);

        // Priority cell (editable)
        const priorityCell = document.createElement('td');
        priorityCell.classList.add('editable');
        priorityCell.dataset.field = 'priority';
        const priorityValue = task.priority || 'Low';
        priorityCell.textContent = priorityValue;
        if (priorityValue === 'Urgent') {
            priorityCell.classList.add('priority-urgent');
        } else if (priorityValue === 'Important') {
            priorityCell.classList.add('priority-important');
        } else if (priorityValue === 'Medium') {
            priorityCell.classList.add('priority-medium');
        }
        priorityCell.addEventListener('dblclick', () => makePriorityEditable(priorityCell, task, index));
        infoRow.appendChild(priorityCell);

        // Bucket cell (editable with dropdown)
        const bucketCell = document.createElement('td');
        bucketCell.classList.add('editable');
        bucketCell.dataset.field = 'bucket';
        bucketCell.textContent = task.bucket || '-';
        bucketCell.addEventListener('dblclick', () => makeBucketEditable(bucketCell, task, index));
        infoRow.appendChild(bucketCell);

        // Comment cell (editable)
        const commentCell = document.createElement('td');
        commentCell.classList.add('editable');
        commentCell.dataset.field = 'comment';
        commentCell.textContent = task.comment || '-';
        commentCell.addEventListener('dblclick', () => makeEditable(commentCell, task, index));
        infoRow.appendChild(commentCell);

        // Predecessors cell (editable)
        const predCell = document.createElement('td');
        predCell.classList.add('editable');
        predCell.dataset.field = 'predecessors';
        const nameToId = buildTaskNameToIdMap(ganttTasks);
        const predText = formatPredecessors(task, nameToId);
        predCell.textContent = predText || '-';
        predCell.addEventListener('dblclick', () => makeEditable(predCell, task, index));
        infoRow.appendChild(predCell);

        // Right-click context menu on gantt rows
        infoRow.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showTaskContextMenuAtPosition(e, task, index);
        });

        ganttInfoBody.appendChild(infoRow);

        // Gantt bar row
        const barRow = document.createElement('div');
        barRow.className = 'gantt-bar-row';
        barRow.style.minWidth = totalWidth + 'px';
        barRow.dataset.taskIndex = index;
        if (isHidden) {
            barRow.style.display = 'none';
        }

        if (task.start && task.finish) {
            // Parse dates consistently as local dates to avoid timezone issues
            const taskStart = parseLocalDate(task.start);
            const taskFinish = parseLocalDate(task.finish);

            // Reset times to midnight for accurate day counting
            const minDate = new Date(ganttMinDate);
            minDate.setHours(0, 0, 0, 0);
            taskStart.setHours(0, 0, 0, 0);
            taskFinish.setHours(0, 0, 0, 0);

            // Calculate days from start by counting days (same method as header rendering)
            // This ensures pixel-perfect alignment with day headers
            let daysFromStart = 0;
            let tempDate = new Date(minDate);
            while (tempDate < taskStart) {
                tempDate.setDate(tempDate.getDate() + 1);
                daysFromStart++;
            }

            // Milestones: render as diamond shape
            if (task.duration_days === 0 && !task.is_summary) {
                const diamond = document.createElement('div');
                diamond.className = 'gantt-bar gantt-milestone';
                const leftPos = daysFromStart * ganttPixelsPerDay - 9;
                diamond.style.left = leftPos + 'px';
                diamond.title = `${task.name}\nMilestone: ${task.finish}`;
                diamond.dataset.taskIndex = index;

                // Apply conditional formatting to milestone
                if (cfStyle) {
                    diamond.style.backgroundColor = cfStyle.backgroundColor;
                }

                setupBarDragListeners(diamond, task, index);
                setupBarClickToOpenTask(diamond, task);

                barRow.appendChild(diamond);
            } else {
                // Regular task or summary bar
                // Calculate bar width in calendar days (finish date is exclusive from backend)
                let taskCalendarDays = 0;
                tempDate = new Date(taskStart);
                while (tempDate < taskFinish) {
                    tempDate.setDate(tempDate.getDate() + 1);
                    taskCalendarDays++;
                }
                // Ensure at least 1 day width for visibility
                if (taskCalendarDays < 1) taskCalendarDays = 1;

                // Use task.duration_days for display (working days) if available
                const displayDuration = task.duration_days || taskCalendarDays;

                const bar = document.createElement('div');
                bar.className = task.is_summary ? 'gantt-bar gantt-phase-bar' : 'gantt-bar gantt-task-bar';
                // Apply RAG colouring to non-summary task bars
                if (!task.is_summary && task.rag) {
                    const barRagColour = ragStatusToColour(task.rag);
                    if (barRagColour && barRagColour !== 'green') {
                        bar.classList.add('gantt-bar-' + barRagColour);
                    }
                }
                const leftPos = daysFromStart * ganttPixelsPerDay;
                const barWidth = taskCalendarDays * ganttPixelsPerDay;
                bar.style.left = leftPos + 'px';
                bar.style.width = barWidth + 'px';
                bar.title = `${task.name}\n${task.start} to ${task.finish}\nDuration: ${displayDuration} days`;
                bar.dataset.taskIndex = index;

                // Add drag handles
                const leftHandle = document.createElement('div');
                leftHandle.className = 'gantt-bar-handle left';
                leftHandle.dataset.handle = 'left';
                bar.appendChild(leftHandle);

                const rightHandle = document.createElement('div');
                rightHandle.className = 'gantt-bar-handle right';
                rightHandle.dataset.handle = 'right';
                bar.appendChild(rightHandle);

                // Add progress indicator if available
                if (task.percent && !task.is_summary) {
                    const progress = document.createElement('div');
                    progress.className = 'gantt-progress';
                    progress.style.width = task.percent;
                    bar.appendChild(progress);
                }

                // Apply conditional formatting to bar
                if (cfStyle) {
                    bar.style.backgroundColor = cfStyle.backgroundColor;
                }

                // Add drag event listeners
                setupBarDragListeners(bar, task, index);
                setupBarClickToOpenTask(bar, task);

                barRow.appendChild(bar);
            }

            // Render baseline bar if baseline is visible
            renderBaselineBar(barRow, task, minDate);
        }

        ganttInfoBody.appendChild(infoRow);
        ganttBody.appendChild(barRow);
    });

}

/**
 * Render a baseline bar behind the current task bar in the Gantt chart.
 * The baseline bar is semi-transparent and shows the original schedule.
 */
function renderBaselineBar(barRow, task, minDate) {
    const ganttToggle = document.getElementById('ganttShowBaseline');
    if (!ganttToggle || !ganttToggle.checked) return;
    if (baselineItems.length === 0) return;

    const baselineLookup = getBaselineLookup();
    const baselineItem = baselineLookup[task.name];
    if (!baselineItem || !baselineItem.start || !baselineItem.finish) return;

    const blStart = parseLocalDate(baselineItem.start);
    const blFinish = parseLocalDate(baselineItem.finish);
    if (!blStart || !blFinish) return;

    blStart.setHours(0, 0, 0, 0);
    blFinish.setHours(0, 0, 0, 0);

    // Calculate position
    let daysFromStart = 0;
    let tempDate = new Date(minDate);
    tempDate.setHours(0, 0, 0, 0);
    while (tempDate < blStart) {
        tempDate.setDate(tempDate.getDate() + 1);
        daysFromStart++;
    }

    const blDuration = baselineItem.duration ? parseInt(baselineItem.duration) : 0;

    // Milestone baseline (0 duration)
    if (blDuration === 0 && !task.is_summary) {
        const diamond = document.createElement('div');
        diamond.className = 'gantt-bar gantt-milestone gantt-baseline-milestone';
        const leftPos = daysFromStart * ganttPixelsPerDay - 9;
        diamond.style.left = leftPos + 'px';
        diamond.title = `Baseline: ${task.name}\nMilestone: ${baselineItem.finish}`;
        barRow.appendChild(diamond);
    } else {
        // Regular baseline bar
        let blCalendarDays = 0;
        tempDate = new Date(blStart);
        while (tempDate < blFinish) {
            tempDate.setDate(tempDate.getDate() + 1);
            blCalendarDays++;
        }
        if (blCalendarDays < 1) blCalendarDays = 1;

        const blBar = document.createElement('div');
        blBar.className = 'gantt-bar gantt-baseline-bar';
        const leftPos = daysFromStart * ganttPixelsPerDay;
        const barWidth = blCalendarDays * ganttPixelsPerDay;
        blBar.style.left = leftPos + 'px';
        blBar.style.width = barWidth + 'px';
        blBar.title = `Baseline: ${task.name}\n${baselineItem.start} to ${baselineItem.finish}\nDuration: ${baselineItem.duration || blCalendarDays + 'd'}`;
        barRow.appendChild(blBar);
    }
}

function setupBarClickToOpenTask(element, task) {
    let mouseDownPos = null;

    element.addEventListener('mousedown', (e) => {
        mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    element.addEventListener('mouseup', (e) => {
        if (!mouseDownPos) return;
        const dx = Math.abs(e.clientX - mouseDownPos.x);
        const dy = Math.abs(e.clientY - mouseDownPos.y);
        mouseDownPos = null;

        // Only open if this was a click, not a drag
        if (dx < 5 && dy < 5) {
            openMilestoneTaskForm(task.name);
        }
    });
}

function renderWeekendHighlights(container) {
    // Iterate through each day from min to max date
    let currentDate = new Date(ganttMinDate);
    const endDate = new Date(ganttMaxDate);
    const today = new Date();

    // Reset times to midnight
    currentDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    let dayIndex = 0;
    while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();

        if (dayOfWeek === 0 || dayOfWeek === 6) {
            const weekend = document.createElement('div');
            weekend.className = 'gantt-weekend';
            weekend.style.left = (dayIndex * ganttPixelsPerDay) + 'px';
            weekend.style.width = ganttPixelsPerDay + 'px';
            container.appendChild(weekend);
        }

        // Full-column highlight for today
        if (currentDate.getTime() === today.getTime()) {
            const todayHighlight = document.createElement('div');
            todayHighlight.className = 'gantt-today-column';
            todayHighlight.style.left = (dayIndex * ganttPixelsPerDay) + 'px';
            todayHighlight.style.width = ganttPixelsPerDay + 'px';
            container.appendChild(todayHighlight);
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
        dayIndex++;
    }
}

/**
 * Collect unique bucket names from the current gantt tasks.
 */
function collectBucketsFromTasks() {
    const buckets = new Set();
    if (!ganttTasks) return [];
    ganttTasks.forEach(t => {
        if (t.bucket && t.bucket.trim()) {
            buckets.add(t.bucket.trim());
        }
    });
    return Array.from(buckets).sort();
}

/**
 * Make a bucket cell editable with a dropdown of available buckets.
 */
function makeBucketEditable(cell, task, taskIndex) {
    if (cell.classList.contains('editing')) return;

    const originalContent = cell.textContent;
    cell.classList.add('editing');

    const select = document.createElement('select');
    select.style.width = '100%';
    select.style.padding = '2px';
    select.style.fontSize = 'inherit';

    const buckets = collectBucketsFromTasks();

    // Add empty option for no bucket
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '(none)';
    select.appendChild(emptyOpt);

    buckets.forEach(b => {
        const option = document.createElement('option');
        option.value = b;
        option.textContent = b;
        if (b === (task.bucket || '')) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    // If current bucket is not in the list, select it anyway
    if (task.bucket && !buckets.includes(task.bucket)) {
        const option = document.createElement('option');
        option.value = task.bucket;
        option.textContent = task.bucket;
        option.selected = true;
        select.appendChild(option);
    }

    cell.textContent = '';
    cell.appendChild(select);
    select.focus();

    const saveEdit = () => {
        cell.classList.remove('editing');
        const newValue = select.value;
        if (newValue !== (task.bucket || '')) {
            task.bucket = newValue;
            ganttTasks[taskIndex].bucket = newValue;
            syncGanttEditToEditor(task, taskIndex, 'bucket', newValue);
            cell.textContent = newValue || '-';
        } else {
            cell.textContent = originalContent;
        }
    };

    select.addEventListener('blur', saveEdit);
    select.addEventListener('change', saveEdit);
}

/**
 * Draw SVG dependency lines on the gantt chart.
 * Lines run from the end of the dependency bar to the start of the dependent bar.
 */
function renderDependencyLines() {
    // Remove any existing dependency SVG
    const existing = document.getElementById('ganttDependencySvg');
    if (existing) existing.remove();

    const toggle = document.getElementById('ganttShowDependencies');
    if (!toggle || !toggle.checked) return;

    const ganttBody = document.getElementById('ganttBody');
    if (!ganttBody || !ganttTasks || ganttTasks.length === 0) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'ganttDependencySvg';
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '1';

    const nameToIndex = {};
    ganttTasks.forEach((t, i) => {
        if (t.name) nameToIndex[t.name.toLowerCase()] = i;
    });

    const barRows = ganttBody.querySelectorAll('.gantt-bar-row');
    const rowHeight = 40;

    // Build a map of task index to visible row position (accounting for hidden rows)
    const visibleRowY = {};
    let visibleCount = 0;
    for (let i = 0; i < barRows.length; i++) {
        if (barRows[i].style.display !== 'none') {
            visibleRowY[i] = visibleCount * rowHeight + rowHeight / 2;
            visibleCount++;
        }
    }

    ganttTasks.forEach((task, index) => {
        if (!task.depends || task.depends.length === 0) return;
        if (!task.start) return;

        const depBarRow = barRows[index];
        if (!depBarRow || depBarRow.style.display === 'none') return;

        const depBar = depBarRow.querySelector('.gantt-bar');
        if (!depBar) return;

        const depLeft = parseInt(depBar.style.left) || 0;
        const depY = visibleRowY[index];
        if (depY === undefined) return;

        task.depends.forEach(depName => {
            const predIndex = nameToIndex[depName.toLowerCase()];
            if (predIndex === undefined) return;

            const predTask = ganttTasks[predIndex];
            if (!predTask || !predTask.start) return;

            const predBarRow = barRows[predIndex];
            if (!predBarRow || predBarRow.style.display === 'none') return;

            const predBar = predBarRow.querySelector('.gantt-bar');
            if (!predBar) return;

            const predLeft = parseInt(predBar.style.left) || 0;
            const predWidth = parseInt(predBar.style.width) || 18;
            const predY = visibleRowY[predIndex];
            if (predY === undefined) return;

            // Finish-to-Start: line from right edge of predecessor
            // to left edge of dependent, with orthogonal routing
            const startX = predLeft + predWidth;
            const startY = predY;
            const endX = depLeft;
            const endY = depY;

            const offset = 10;
            const arrowSize = 5;
            let d;

            if (endX > startX + offset * 2) {
                // Simple case: dependent is to the right of predecessor
                // Route: right from pred, down/up to midpoint Y, left/right to dep, into dep
                const midX = startX + offset;
                const midY = startY + (endY - startY) / 2;
                d = `M ${startX} ${startY} ` +
                    `L ${midX} ${startY} ` +
                    `L ${midX} ${endY} ` +
                    `L ${endX - offset} ${endY} ` +
                    `L ${endX} ${endY}`;
            } else {
                // Overlap case: dependent starts at or before predecessor ends
                // Route in an S/5 shape going around:
                // 1. Right from pred edge
                // 2. Down/up halfway to dep row
                // 3. Left past dep left edge
                // 4. Down/up to dep row
                // 5. Right into dep left edge
                const exitX = startX + offset;
                const entryX = endX - offset;
                const midY = startY + (endY - startY) / 2;
                d = `M ${startX} ${startY} ` +
                    `L ${exitX} ${startY} ` +
                    `L ${exitX} ${midY} ` +
                    `L ${entryX} ${midY} ` +
                    `L ${entryX} ${endY} ` +
                    `L ${endX} ${endY}`;
            }

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#adb5bd');
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('stroke-dasharray', '4,3');

            // Arrowhead pointing right into the left side of dependent task
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points',
                `${endX},${endY} ${endX - arrowSize},${endY - arrowSize} ${endX - arrowSize},${endY + arrowSize}`
            );
            arrow.setAttribute('fill', '#adb5bd');

            svg.appendChild(path);
            svg.appendChild(arrow);
        });
    });

    ganttBody.appendChild(svg);
}

/**
 * Update the standalone Tasks table (without gantt bars).
 */
function setupBarDragListeners(bar, task, taskIndex) {
    let dragState = null;

    const onMouseDown = (e) => {
        if (task.is_summary) return;  // Don't drag summary tasks

        const target = e.target;
        const isHandle = target.classList.contains('gantt-bar-handle');
        const handleType = isHandle ? target.dataset.handle : 'middle';

        dragState = {
            startX: e.clientX,
            startLeft: parseInt(bar.style.left),
            startWidth: parseInt(bar.style.width),
            handleType: handleType,
            task: task,
            taskIndex: taskIndex
        };

        bar.classList.add('dragging');
        e.preventDefault();
        e.stopPropagation();
    };

    const onMouseMove = (e) => {
        if (!dragState) return;

        const columnWidth = ganttPixelsPerDay;
        const deltaX = e.clientX - dragState.startX;
        const deltaDays = Math.round(deltaX / columnWidth);

        if (dragState.handleType === 'left') {
            // Adjust start date
            const newLeft = dragState.startLeft + (deltaDays * columnWidth);
            const newWidth = dragState.startWidth - (deltaDays * columnWidth);
            if (newWidth > columnWidth) {
                bar.style.left = newLeft + 'px';
                bar.style.width = newWidth + 'px';
            }
        } else if (dragState.handleType === 'right') {
            // Adjust finish date
            const newWidth = dragState.startWidth + (deltaDays * columnWidth);
            if (newWidth > columnWidth) {
                bar.style.width = newWidth + 'px';
            }
        } else {
            // Move entire bar
            bar.style.left = (dragState.startLeft + (deltaDays * columnWidth)) + 'px';
        }
    };

    const onMouseUp = (e) => {
        if (!dragState) return;

        const columnWidth = ganttPixelsPerDay;
        const deltaX = e.clientX - dragState.startX;
        const deltaDays = Math.round(deltaX / columnWidth);

        if (deltaDays !== 0) {
            updateTaskDates(dragState.task, dragState.taskIndex, dragState.handleType, deltaDays);
        }

        bar.classList.remove('dragging');
        dragState = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };

    bar.addEventListener('mousedown', (e) => {
        onMouseDown(e);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function updateTaskDates(task, taskIndex, handleType, deltaDays) {
    // Use parseLocalDate to avoid timezone issues
    const startDate = parseLocalDate(task.start);
    const finishDate = parseLocalDate(task.finish);

    if (handleType === 'left') {
        startDate.setDate(startDate.getDate() + deltaDays);
        task.start = formatLocalDate(startDate);
        ganttTasks[taskIndex].start = task.start;
    } else if (handleType === 'right') {
        finishDate.setDate(finishDate.getDate() + deltaDays);
        task.finish = formatLocalDate(finishDate);
        ganttTasks[taskIndex].finish = task.finish;
    } else {
        // Move both dates
        startDate.setDate(startDate.getDate() + deltaDays);
        finishDate.setDate(finishDate.getDate() + deltaDays);
        task.start = formatLocalDate(startDate);
        task.finish = formatLocalDate(finishDate);
        ganttTasks[taskIndex].start = task.start;
        ganttTasks[taskIndex].finish = task.finish;
    }

    // Recalculate duration by counting working days (matching the backend scheduler)
    const newStartDate = parseLocalDate(task.start);
    const newFinishDate = parseLocalDate(task.finish);

    // Milestones (0-duration) stay as 0 when moved
    if (newStartDate.getTime() === newFinishDate.getTime() && task.duration_days === 0) {
        task.duration_days = 0;
        ganttTasks[taskIndex].duration_days = 0;
    } else {
        // Count working days from start to finish (inclusive), skipping weekends
        // This matches the backend scheduling engine which treats duration as working days
        const taskDuration = countWorkingDays(newStartDate, newFinishDate);

        task.duration_days = taskDuration;
        ganttTasks[taskIndex].duration_days = task.duration_days;
    }

    // Sync changes to editor based on what was dragged:
    // - Left handle: Start date changed (manual scheduling)
    // - Right handle: Duration changed
    // - Middle: Task shifted in time (manual scheduling)
    if (handleType === 'left') {
        syncGanttStartDateToEditor(task, taskIndex);
    } else if (handleType === 'right') {
        syncGanttDurationToEditor(task, taskIndex);
    } else {
        syncGanttStartDateToEditor(task, taskIndex);
    }

    // Trigger a full re-parse to recalculate dependencies
    renderText();
}


