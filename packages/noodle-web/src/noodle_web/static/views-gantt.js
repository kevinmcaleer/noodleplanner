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

function setupGanttEditableCell(cell, edit) {
    let touchStart = null;
    cell.tabIndex = 0;
    cell.addEventListener('dblclick', edit);
    cell.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            edit();
        }
    });
    cell.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' || event.button !== 0) return;
        touchStart = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY
        };
    });
    cell.addEventListener('pointerup', event => {
        if (!touchStart || event.pointerId !== touchStart.pointerId) return;
        const distance = Math.hypot(
            event.clientX - touchStart.x,
            event.clientY - touchStart.y
        );
        touchStart = null;
        if (distance < 8 && !event.target.closest('button, input, select, a')) {
            edit();
        }
    });
    cell.addEventListener('pointercancel', () => {
        touchStart = null;
    });
}

// ----- Dependency / Predecessors helpers -----

/**
 * Build a lookup from lowercase task name to Gantt row ID.
 * Called once per render so every helper can reuse it.
 */
function buildTaskNameToIdMap(tasks) {
    const map = {};
    tasks.forEach(t => {
        // first definition of a duplicated name wins, as it does when scheduling
        if (t.name && !Object.prototype.hasOwnProperty.call(map, t.name.toLowerCase())) {
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


// ----- Zoom, geometry and persistence (#787) -----
//
// `ganttPixelsPerDay` (state.js) is the one number the chart is drawn from.
// The five named scales are detents on it, not modes: gantt-scale.js derives
// the header bands, the drag snap unit and every bar's position from it, so
// there is one rendering rule at every zoom rather than one per scale.

/** Row height of `.gantt-bar-row` (views/gantt.css). The overlays compute
 *  their Y positions from it rather than reading the DOM back. */
const GANTT_ROW_HEIGHT = 40;
/** A pointer must travel this far before a press becomes a drag. */
const GANTT_DRAG_THRESHOLD_PX = 5;
const GANTT_ZOOM_KEY_PREFIX = 'noodle_gantt_zoom_';
/** Below this width a task bar drops its resize handles (see placeGanttElement). */
const GANTT_NARROW_BAR_PX = 24;

/** The chart range as day numbers (inclusive), mirroring ganttMinDate/MaxDate. */
let ganttFromDay = null;
let ganttToDay = null;
/** The project whose zoom is loaded; a change reloads it and re-centres on today. */
let ganttZoomProjectId;
let ganttScrollToTodayPending = true;
/** engine/gantt-drag.js, once loaded -- the live-preview scheduler. */
let ganttDragEngine = null;
/** Per-task bar spans (day numbers) while a drag preview is showing, keyed
 *  by task index; the overlays draw from these instead of the committed dates. */
let ganttPreviewSpans = null;
/** The drag in progress, if any. A re-render arriving mid-drag (the editor's
 *  debounced parse, an autosave) would replace the bars under the pointer,
 *  so it is held until the drag ends. */
let ganttActiveDrag = null;
let ganttDeferredTasks = null;

function ganttZoomStorageKey(projectId) {
    return GANTT_ZOOM_KEY_PREFIX + (projectId || 'default');
}

function currentGanttProjectId() {
    return (typeof getCurrentProjectId === 'function') ? getCurrentProjectId() : null;
}

/** Load this project's saved zoom the first time its chart is drawn. */
function restoreGanttZoomForProject() {
    const projectId = currentGanttProjectId();
    if (projectId === ganttZoomProjectId) return;
    ganttZoomProjectId = projectId;
    ganttScrollToTodayPending = true;
    let saved = null;
    try { saved = localStorage.getItem(ganttZoomStorageKey(projectId)); } catch (_) { /* storage blocked */ }
    const value = saved === null ? NaN : parseFloat(saved);
    ganttPixelsPerDay = GanttScale.clampPixelsPerDay(
        Number.isFinite(value) ? value : GanttScale.DEFAULT_PIXELS_PER_DAY);
    ganttScale = GanttScale.exactDetent(ganttPixelsPerDay) || '';
}

function persistGanttZoom() {
    try {
        localStorage.setItem(ganttZoomStorageKey(currentGanttProjectId()), String(ganttPixelsPerDay));
    } catch (_) { /* storage blocked -- zoom still works, it just isn't remembered */ }
}

/** Fetch the drag-preview engine once; the parse pipeline has usually
 *  loaded its dependencies already, so this is a cache hit. */
function loadGanttDragEngine() {
    if (ganttDragEngine || loadGanttDragEngine.pending) return;
    loadGanttDragEngine.pending = import('/static/engine/gantt-drag.js')
        .then(module => { ganttDragEngine = module; })
        .catch(error => console.warn('[gantt] drag preview engine unavailable:', error))
        .finally(() => { loadGanttDragEngine.pending = null; });
}

function ganttX(day) {
    return (day - ganttFromDay) * ganttPixelsPerDay;
}

function ganttTotalWidth() {
    return (ganttToDay - ganttFromDay + 1) * ganttPixelsPerDay;
}

/** Wire the zoom slider and the hidden scale <select> once. */
function setupGanttZoomControls() {
    const slider = document.getElementById('ganttZoomSlider');
    if (slider && !slider.dataset.initialized) {
        slider.min = '0';
        slider.max = String(GanttScale.SLIDER_MAX);
        slider.step = '1';
        slider.addEventListener('input', () => {
            setGanttZoom(GanttScale.sliderToPixelsPerDay(slider.value), { fromSlider: true });
        });
        slider.addEventListener('change', () => refreshRibbonIfPresent());
        const ticks = document.getElementById('ganttZoomTicks');
        if (ticks) {
            ticks.innerHTML = '';
            GanttScale.DETENTS.forEach(detent => {
                const option = document.createElement('option');
                option.value = String(GanttScale.pixelsPerDayToSlider(detent.pixelsPerDay));
                option.label = detent.label;
                ticks.appendChild(option);
            });
        }
        slider.dataset.initialized = 'true';
    }
    document.querySelectorAll('[data-gantt-zoom-step]').forEach(button => {
        if (button.dataset.initialized) return;
        button.addEventListener('click', () => {
            setGanttZoom(GanttScale.stepZoom(ganttPixelsPerDay, Number(button.dataset.ganttZoomStep)));
        });
        button.dataset.initialized = 'true';
    });

    const chartSide = document.querySelector('.gantt-chart-side');
    if (chartSide && !chartSide.dataset.zoomWheel) {
        // Ctrl/Cmd + wheel (and a trackpad pinch, which browsers report as a
        // ctrl-wheel) zooms about the pointer.
        chartSide.addEventListener('wheel', event => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            setGanttZoom(GanttScale.stepZoom(ganttPixelsPerDay, event.deltaY < 0 ? 1 : -1),
                { anchorClientX: event.clientX });
        }, { passive: false });
        chartSide.dataset.zoomWheel = 'true';
    }
}

/** Reflect the current zoom in the slider and its readout. */
function syncGanttZoomControls() {
    const slider = document.getElementById('ganttZoomSlider');
    if (slider && document.activeElement !== slider) {
        slider.value = String(GanttScale.pixelsPerDayToSlider(ganttPixelsPerDay));
    }
    if (slider) {
        const name = GanttScale.exactDetent(ganttPixelsPerDay);
        const detent = name ? GanttScale.detentByName(name) : null;
        slider.setAttribute('aria-valuetext', detent ? detent.label
            : `${GanttScale.detentByName(GanttScale.nearestDetent(ganttPixelsPerDay)).label} (custom zoom)`);
    }
    const readout = document.getElementById('ganttZoomReadout');
    if (readout) {
        const name = GanttScale.exactDetent(ganttPixelsPerDay);
        readout.textContent = name ? GanttScale.detentByName(name).label
            : `~${GanttScale.detentByName(GanttScale.nearestDetent(ganttPixelsPerDay)).label}`;
    }
}

function refreshRibbonIfPresent() {
    if (typeof refreshRibbon === 'function') refreshRibbon();
}

/**
 * Change the zoom, keeping the date under the anchor where it is: the
 * pointer for Ctrl+wheel, otherwise the centre of the visible chart. Only
 * the chart side is redrawn -- the task table does not change with zoom.
 */
function setGanttZoom(pixelsPerDay, options = {}) {
    const next = GanttScale.clampPixelsPerDay(pixelsPerDay);
    const previous = ganttPixelsPerDay;
    const chartSide = document.querySelector('.gantt-chart-side');
    let anchorPx = null;
    if (chartSide) {
        const rect = chartSide.getBoundingClientRect();
        anchorPx = options.anchorClientX != null
            ? options.anchorClientX - rect.left
            : chartSide.clientWidth / 2;
    }
    const scrollLeft = chartSide ? chartSide.scrollLeft : 0;

    ganttPixelsPerDay = next;
    ganttScale = GanttScale.exactDetent(next) || '';
    persistGanttZoom();

    if (ganttFromDay !== null && ganttTasks && ganttTasks.length) {
        relayoutGanttChart();
        if (chartSide && anchorPx !== null) {
            chartSide.scrollLeft = GanttScale.anchoredScrollLeft(scrollLeft, anchorPx, previous, next);
        }
    }
    syncGanttZoomControls();
    if (!options.fromSlider) refreshRibbonIfPresent();
}

/** Zoom so the whole project fits the visible chart width (ribbon "Fit"). */
function fitGanttToView() {
    const chartSide = document.querySelector('.gantt-chart-side');
    if (!chartSide || ganttFromDay === null) return;
    const days = ganttToDay - ganttFromDay + 1;
    setGanttZoom(Math.max(1, chartSide.clientWidth - 2) / days);
    chartSide.scrollLeft = 0;
}

function updateGantt(tasks) {
    if (ganttActiveDrag) {
        ganttDeferredTasks = tasks;
        return;
    }
    try {
        // Show gantt content, hide placeholder
        const placeholder = document.querySelector('#gantt-view .placeholder-view');
        const content = document.querySelector('#gantt-view .gantt-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'flex';
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
        ganttFromDay = GanttScale.dayOf(ganttMinDate);
        ganttToDay = GanttScale.dayOf(ganttMaxDate);

        restoreGanttZoomForProject();
        setupGanttZoomControls();
        loadGanttDragEngine();

        // The ribbon's Scale buttons (Days ... Years) set this hidden
        // <select> and dispatch `change`; each lands on its detent.
        const scaleSelector = document.getElementById('ganttScale');
        if (scaleSelector && !scaleSelector.dataset.initialized) {
            scaleSelector.addEventListener('change', function() {
                const detent = GanttScale.detentByName(this.value);
                if (detent) setGanttZoom(detent.pixelsPerDay);
            });
            scaleSelector.dataset.initialized = 'true';
        }

        // Set up dependency toggle if not already done
        const depToggle = document.getElementById('ganttShowDependencies');
        if (depToggle && !depToggle.dataset.initialized) {
            depToggle.addEventListener('change', function() {
                renderDependencyLines();
                if (typeof syncToolbarToSettings === 'function') syncToolbarToSettings('gantt_deps', this.checked);
            });
            depToggle.dataset.initialized = 'true';
        }

        // Set up critical path toggle if not already done
        const cpToggle = document.getElementById('ganttShowCriticalPath');
        if (cpToggle && !cpToggle.dataset.initialized) {
            cpToggle.addEventListener('change', function() {
                renderGanttChart();
                if (typeof syncToolbarToSettings === 'function') syncToolbarToSettings('gantt_critical_path', this.checked);
            });
            cpToggle.dataset.initialized = 'true';
        }

        // Initial render
        renderGanttChart();

    } catch (error) {
        console.error('Error updating gantt chart:', error);
    }
}

function renderGanttChart() {
    if (ganttFromDay === null && ganttMinDate && ganttMaxDate) {
        ganttFromDay = GanttScale.dayOf(ganttMinDate);
        ganttToDay = GanttScale.dayOf(ganttMaxDate);
    }
    if (ganttFromDay === null) return;
    ganttPixelsPerDay = GanttScale.clampPixelsPerDay(ganttPixelsPerDay);
    ganttScale = GanttScale.exactDetent(ganttPixelsPerDay) || '';
    ganttPreviewSpans = null;
    syncGanttZoomControls();

    // Restore saved splitter position
    const savedWidth = localStorage.getItem('ganttTableWidth');
    if (savedWidth) {
        const tableSide = document.querySelector('.gantt-table-side');
        if (tableSide) {
            tableSide.style.width = savedWidth + 'px';
        }
    }

    // A re-render (after an edit, a drag, a toggle) keeps the user's place;
    // only a newly opened project scrolls to today.
    const chartSide = document.querySelector('.gantt-chart-side');
    const scrollLeft = chartSide ? chartSide.scrollLeft : 0;

    renderGanttHeaders();
    renderGanttRows();

    // Align task rows with Gantt bars by compensating for header height differences
    alignGanttRows();

    renderDependencyLines();
    renderCriticalPathLines();

    if (ganttScrollToTodayPending) {
        if (chartSide && chartSide.clientWidth > 0) {
            scrollGanttToToday();
            ganttScrollToTodayPending = false;
        }
    } else if (chartSide) {
        chartSide.scrollLeft = scrollLeft;
    }
}

/**
 * Redraw everything on the chart side that depends on the zoom -- header
 * bands, the non-working-day grid, bar positions and the overlays -- without
 * rebuilding the rows. What a slider drag calls on every input event.
 */
function relayoutGanttChart() {
    const ganttBody = document.getElementById('ganttBody');
    if (!ganttBody) return;
    renderGanttHeaders();
    const totalWidth = ganttTotalWidth();
    ganttBody.style.minWidth = totalWidth + 'px';
    ganttBody.querySelectorAll('.gantt-bar-row').forEach(row => { row.style.minWidth = totalWidth + 'px'; });
    renderWeekendHighlights(ganttBody);
    ganttBody.querySelectorAll('[data-gantt-kind]').forEach(placeGanttElement);
    alignGanttRows();
    renderDependencyLines();
    renderCriticalPathLines();
}

/**
 * Position one chart element from its day numbers (`data-start-day`,
 * `data-finish-day`) and the current zoom. Every horizontal coordinate on
 * the chart comes through here.
 */
function placeGanttElement(el) {
    const kind = el.dataset.ganttKind;
    const start = Number(el.dataset.startDay);
    const finish = Number(el.dataset.finishDay);
    if (kind === 'task' || kind === 'baseline') {
        const geometry = GanttScale.barGeometry(start, finish, ganttFromDay, ganttPixelsPerDay);
        el.style.left = geometry.left + 'px';
        el.style.width = geometry.width + 'px';
        // Too narrow to hold two resize handles and still be grabbed in the
        // middle (a 2-day task at the Years zoom is 2px wide): the handles
        // are hidden and the bar gets a wider invisible hit area, so it can
        // still be moved.
        if (kind === 'task') el.classList.toggle('gantt-bar-narrow', geometry.width < GANTT_NARROW_BAR_PX);
    } else if (kind === 'milestone' || kind === 'baseline-milestone') {
        el.style.left = (ganttX(start) - 9) + 'px';
    } else if (kind === 'deadline') {
        el.style.left = ganttX(start) + 'px';
    } else if (kind === 'float') {
        el.style.width = (Number(el.dataset.floatDays) * ganttPixelsPerDay) + 'px';
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
    // Scroll the chart side so today sits one day (or a short margin at a
    // coarse zoom) in from the left edge.
    const chartSide = document.querySelector('.gantt-chart-side');
    if (!chartSide || ganttFromDay === null) return;
    const today = GanttScale.dayOf(new Date());
    if (today < ganttFromDay || today > ganttToDay) return;
    chartSide.scrollLeft = Math.max(0, ganttX(today) - Math.max(ganttPixelsPerDay, 40));
}

/**
 * Two header bands, chosen from the pixel density by GanttScale.headerBands:
 * the finest unit whose cells are wide enough to label, with the next
 * coarser unit above it. The same rule at every zoom -- there are no
 * per-scale header functions any more.
 */
function renderGanttHeaders() {
    const ganttHeader = document.getElementById('ganttHeader');
    if (!ganttHeader || ganttFromDay === null) return;

    ganttHeader.innerHTML = '';
    const totalWidth = ganttTotalWidth();
    // Header min-width matches the body so the two scroll together
    ganttHeader.style.minWidth = totalWidth + 'px';

    const today = GanttScale.dayOf(new Date());
    const bands = GanttScale.headerBands(ganttFromDay, ganttToDay, ganttPixelsPerDay);
    ganttHeader.dataset.fineUnit = bands[1].unit;
    bands.forEach(band => {
        const row = document.createElement('div');
        row.className = `gantt-header-band gantt-header-band--${band.role}`;
        row.dataset.unit = band.unit;
        row.style.width = totalWidth + 'px';
        band.cells.forEach(cell => {
            const div = document.createElement('div');
            div.className = 'gantt-header-cell';
            if (band.unit === 'day') {
                div.classList.add('gantt-day-cell');
                if (cell.start === today) div.classList.add('gantt-today');
            }
            div.style.left = cell.left + 'px';
            div.style.width = cell.width + 'px';
            div.textContent = cell.label;
            div.title = cell.title;
            div.dataset.startDay = cell.start;
            row.appendChild(div);
        });
        ganttHeader.appendChild(row);
    });
}

function renderGanttRows() {
    const ganttInfoBody = document.getElementById('ganttInfoBody');
    const ganttBody = document.getElementById('ganttBody');

    if (!ganttInfoBody || !ganttBody) return;

    ganttInfoBody.innerHTML = '';
    ganttBody.innerHTML = '';

    if (!ganttTasks || ganttTasks.length === 0) return;

    // Set body width to match header
    const totalWidth = ganttTotalWidth();
    ganttBody.style.minWidth = totalWidth + 'px';

    // Weekend / today grid, when days are wide enough to see
    renderWeekendHighlights(ganttBody);

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

    // Check if critical path display is enabled
    const cpToggle = document.getElementById('ganttShowCriticalPath');
    const showCriticalPath = cpToggle && cpToggle.checked;

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
        if (showCriticalPath && task.critical && !task.is_summary) {
            infoRow.classList.add('gantt-critical-row');
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

        setupGanttEditableCell(nameCell, () => makeEditable(nameCell, task, index));
        infoRow.appendChild(nameCell);

        // Duration cell (editable)
        const durationCell = document.createElement('td');
        durationCell.classList.add('editable');
        durationCell.dataset.field = 'duration';
        durationCell.textContent = task.duration_days ? `${task.duration_days}d` : '-';
        setupGanttEditableCell(durationCell, () => makeEditable(durationCell, task, index));
        infoRow.appendChild(durationCell);

        // Start cell (editable)
        const startCell = document.createElement('td');
        startCell.classList.add('editable');
        startCell.dataset.field = 'start';
        startCell.textContent = task.start || '-';
        setupGanttEditableCell(startCell, () => makeEditable(startCell, task, index));
        infoRow.appendChild(startCell);

        // Finish cell (editable)
        const finishCell = document.createElement('td');
        finishCell.classList.add('editable');
        finishCell.dataset.field = 'finish';
        finishCell.textContent = task.finish || '-';
        setupGanttEditableCell(finishCell, () => makeEditable(finishCell, task, index));
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
        setupGanttEditableCell(resourcesCell, () => makeEditable(resourcesCell, task, index));
        infoRow.appendChild(resourcesCell);

        // Percent cell (editable)
        const percentCell = document.createElement('td');
        percentCell.classList.add('editable');
        percentCell.dataset.field = 'percent';
        percentCell.textContent = task.percent ? `${String(task.percent).replace('%', '')}%` : '-';
        setupGanttEditableCell(percentCell, () => makeEditable(percentCell, task, index));
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
        setupGanttEditableCell(priorityCell, () => makePriorityEditable(priorityCell, task, index));
        infoRow.appendChild(priorityCell);

        // Bucket cell (editable with dropdown)
        const bucketCell = document.createElement('td');
        bucketCell.classList.add('editable');
        bucketCell.dataset.field = 'bucket';
        bucketCell.textContent = task.bucket || '-';
        setupGanttEditableCell(bucketCell, () => makeBucketEditable(bucketCell, task, index));
        infoRow.appendChild(bucketCell);

        // Comment cell (editable)
        const commentCell = document.createElement('td');
        commentCell.classList.add('editable');
        commentCell.dataset.field = 'comment';
        commentCell.textContent = task.comment || '-';
        setupGanttEditableCell(commentCell, () => makeEditable(commentCell, task, index));
        infoRow.appendChild(commentCell);

        // Predecessors cell (editable)
        const predCell = document.createElement('td');
        predCell.classList.add('editable');
        predCell.dataset.field = 'predecessors';
        const nameToId = buildTaskNameToIdMap(ganttTasks);
        const predText = formatPredecessors(task, nameToId);
        predCell.textContent = predText || '-';
        setupGanttEditableCell(predCell, () => makeEditable(predCell, task, index));
        infoRow.appendChild(predCell);

        // Right-click context menu on gantt rows
        infoRow.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showTaskContextMenuAtPosition(e, task, index);
        });

        // Hover add-buttons and drag handle
        if (typeof addRowInteractions === 'function') {
            addRowInteractions(infoRow, task, index, 'gantt');
        }

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
            const startDay = GanttScale.dayOf(task.start);
            const finishDay = GanttScale.dayOf(task.finish);

            // Milestones: render as diamond shape
            if (task.duration_days === 0 && !task.is_summary) {
                const diamond = document.createElement('div');
                diamond.className = 'gantt-bar gantt-milestone';
                if (showCriticalPath && task.critical) {
                    diamond.classList.add('gantt-critical-bar');
                }
                diamond.dataset.ganttKind = 'milestone';
                diamond.dataset.startDay = startDay;
                diamond.dataset.finishDay = finishDay;
                placeGanttElement(diamond);
                diamond.title = `${task.name}\nMilestone: ${task.finish}` +
                    (showCriticalPath && task.total_float != null ? `\nFloat: ${task.total_float}d` : '');
                diamond.dataset.taskIndex = index;

                // Apply conditional formatting to milestone
                if (cfStyle && !showCriticalPath) {
                    diamond.style.backgroundColor = cfStyle.backgroundColor;
                }

                setupBarDragListeners(diamond, task, index);
                setupBarClickToOpenTask(diamond, task);

                barRow.appendChild(diamond);
            } else {
                // Regular task or summary bar; finish is exclusive
                const taskCalendarDays = Math.max(1, finishDay - startDay);

                // Use task.duration_days for display (working days) if available
                const displayDuration = task.duration_days || taskCalendarDays;

                const bar = document.createElement('div');
                bar.className = task.is_summary ? 'gantt-bar gantt-phase-bar' : 'gantt-bar gantt-task-bar';
                // Apply critical path styling when enabled
                if (showCriticalPath && task.critical && !task.is_summary) {
                    bar.classList.add('gantt-critical-bar');
                }
                // Apply RAG colouring to non-summary task bars (skip when critical path is shown)
                if (!task.is_summary && task.rag && !(showCriticalPath && task.critical)) {
                    const barRagColour = ragStatusToColour(task.rag);
                    if (barRagColour && barRagColour !== 'green') {
                        bar.classList.add('gantt-bar-' + barRagColour);
                    }
                }
                bar.dataset.ganttKind = 'task';
                bar.dataset.startDay = startDay;
                bar.dataset.finishDay = finishDay;
                placeGanttElement(bar);
                const floatInfo = (showCriticalPath && task.total_float != null && !task.is_summary)
                    ? `\nFloat: ${task.total_float}d` : '';
                bar.title = `${task.name}\n${task.start} to ${task.finish}\nDuration: ${displayDuration} days${floatInfo}`;
                bar.dataset.taskIndex = index;

                // Drag handles -- not on summary bars, which follow their children
                if (!task.is_summary) {
                    const leftHandle = document.createElement('div');
                    leftHandle.className = 'gantt-bar-handle left';
                    leftHandle.dataset.handle = 'left';
                    leftHandle.title = 'Drag to change the start';
                    bar.appendChild(leftHandle);

                    const rightHandle = document.createElement('div');
                    rightHandle.className = 'gantt-bar-handle right';
                    rightHandle.dataset.handle = 'right';
                    rightHandle.title = 'Drag to change the duration';
                    bar.appendChild(rightHandle);
                }

                // Add progress indicator if available
                if (task.percent && !task.is_summary) {
                    const progress = document.createElement('div');
                    progress.className = 'gantt-progress';
                    progress.style.width = task.percent;
                    bar.appendChild(progress);
                }

                // Add float/slack extension bar for non-critical tasks when critical path is shown
                if (showCriticalPath && !task.is_summary && task.total_float > 0) {
                    const floatBar = document.createElement('div');
                    floatBar.className = 'gantt-float-bar';
                    floatBar.dataset.ganttKind = 'float';
                    floatBar.dataset.floatDays = task.total_float;
                    placeGanttElement(floatBar);
                    floatBar.title = `Float: ${task.total_float} working days`;
                    bar.appendChild(floatBar);
                }

                // Apply conditional formatting to bar
                if (cfStyle && !(showCriticalPath && task.critical)) {
                    bar.style.backgroundColor = cfStyle.backgroundColor;
                }

                // Add drag event listeners
                setupBarDragListeners(bar, task, index);
                setupBarClickToOpenTask(bar, task);

                barRow.appendChild(bar);
            }

            // Render baseline bar if baseline is visible
            renderBaselineBar(barRow, task);

            // Render deadline slippage marker if a deadline is set (#877)
            renderDeadlineMarker(barRow, task);
        }

        ganttInfoBody.appendChild(infoRow);
        ganttBody.appendChild(barRow);
    });

}

/**
 * Render a baseline bar behind the current task bar in the Gantt chart.
 * The baseline bar is semi-transparent and shows the original schedule.
 */
function renderBaselineBar(barRow, task) {
    const ganttToggle = document.getElementById('ganttShowBaseline');
    if (!ganttToggle || !ganttToggle.checked) return;
    if (baselineItems.length === 0) return;

    const baselineLookup = getBaselineLookup();
    const baselineItem = baselineLookup[task.name];
    if (!baselineItem || !baselineItem.start || !baselineItem.finish) return;

    const blStart = GanttScale.dayOf(baselineItem.start);
    const blFinish = GanttScale.dayOf(baselineItem.finish);
    if (blStart === null || blFinish === null) return;

    const blDuration = baselineItem.duration ? parseInt(baselineItem.duration) : 0;

    // Milestone baseline (0 duration)
    if (blDuration === 0 && !task.is_summary) {
        const diamond = document.createElement('div');
        diamond.className = 'gantt-bar gantt-milestone gantt-baseline-milestone';
        diamond.dataset.ganttKind = 'baseline-milestone';
        diamond.dataset.startDay = blStart;
        diamond.dataset.finishDay = blFinish;
        placeGanttElement(diamond);
        diamond.title = `Baseline: ${task.name}\nMilestone: ${baselineItem.finish}`;
        barRow.appendChild(diamond);
    } else {
        const blBar = document.createElement('div');
        blBar.className = 'gantt-bar gantt-baseline-bar';
        blBar.dataset.ganttKind = 'baseline';
        blBar.dataset.startDay = blStart;
        blBar.dataset.finishDay = blFinish;
        placeGanttElement(blBar);
        blBar.title = `Baseline: ${task.name}\n${baselineItem.start} to ${baselineItem.finish}\nDuration: ${baselineItem.duration || Math.max(1, blFinish - blStart) + 'd'}`;
        barRow.appendChild(blBar);
    }
}

/**
 * Render a deadline marker: a downward red arrow at the task's deadline
 * date, independent of its bar/diamond position. A deadline never moves
 * the schedule (#877) -- this only marks where it sits on the timeline.
 */
function renderDeadlineMarker(barRow, task) {
    if (!task.deadline) return;

    const deadlineDay = GanttScale.dayOf(task.deadline);
    if (deadlineDay === null) return;

    const marker = document.createElement('div');
    marker.className = 'gantt-deadline-marker';
    marker.dataset.ganttKind = 'deadline';
    marker.dataset.startDay = deadlineDay;
    placeGanttElement(marker);
    marker.title = `Deadline: ${task.deadline}` +
        (task.rag && ragStatusToColour(task.rag) === 'red' ? ' (missed)' : '');
    barRow.appendChild(marker);
}

function setupBarClickToOpenTask(element, task) {
    let pointerDownPos = null;

    element.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        pointerDownPos = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });

    element.addEventListener('pointerup', (e) => {
        if (!pointerDownPos || e.pointerId !== pointerDownPos.id) return;
        const dx = Math.abs(e.clientX - pointerDownPos.x);
        const dy = Math.abs(e.clientY - pointerDownPos.y);
        pointerDownPos = null;

        // Only open if this was a click, not a drag
        if (dx < 5 && dy < 5) {
            openMilestoneTaskForm(task.name);
        }
    });
    element.addEventListener('pointercancel', () => {
        pointerDownPos = null;
    });
}

/** Weekends are shaded once a day is at least this many pixels wide;
 *  below that the stripes are noise rather than information. */
const GANTT_WEEKEND_MIN_PX = 8;

function renderWeekendHighlights(container) {
    container.querySelectorAll(':scope > .gantt-weekend, :scope > .gantt-today-column').forEach(el => el.remove());
    if (ganttFromDay === null) return;
    const today = GanttScale.dayOf(new Date());
    const fragment = document.createDocumentFragment();

    if (ganttPixelsPerDay >= GANTT_WEEKEND_MIN_PX) {
        for (let day = ganttFromDay; day <= ganttToDay; day++) {
            // day 0 (1970-01-01) was a Thursday: (day + 3) % 7 is 5/6 on Sat/Sun
            const weekday = ((day + 3) % 7 + 7) % 7;
            if (weekday < 5) continue;
            const weekend = document.createElement('div');
            weekend.className = 'gantt-weekend';
            weekend.style.left = ganttX(day) + 'px';
            weekend.style.width = ganttPixelsPerDay + 'px';
            fragment.appendChild(weekend);
        }
    }

    // Full-column highlight for today, at any zoom (at least a hairline)
    if (today >= ganttFromDay && today <= ganttToDay) {
        const todayHighlight = document.createElement('div');
        todayHighlight.className = 'gantt-today-column';
        todayHighlight.style.left = ganttX(today) + 'px';
        todayHighlight.style.width = Math.max(2, ganttPixelsPerDay) + 'px';
        fragment.appendChild(todayHighlight);
    }
    container.insertBefore(fragment, container.firstChild);
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

// ----- Overlays -----
//
// Dependency and critical-path lines are drawn from the same geometry as the
// bars -- task dates (or a drag preview's dates), the zoom and the row
// height -- never read back out of element styles, so they cannot drift out
// of alignment with the bars at any zoom or mid-drag.

/** The horizontal span a task's bar occupies, in px, or null if it has none. */
function ganttBarSpan(index) {
    const override = ganttPreviewSpans && ganttPreviewSpans[index];
    const task = ganttTasks[index];
    if (!task) return null;
    const startDay = override ? override.startDay : GanttScale.dayOf(task.start);
    const finishDay = override ? override.finishDay : GanttScale.dayOf(task.finish);
    if (startDay === null || finishDay === null) return null;
    if (task.duration_days === 0 && !task.is_summary) {
        return { left: ganttX(startDay) - 9, width: 18 };
    }
    return GanttScale.barGeometry(startDay, finishDay, ganttFromDay, ganttPixelsPerDay);
}

/** Row centre Y for each visible task index (collapsed rows have none). */
function ganttVisibleRowCentres() {
    const rows = document.querySelectorAll('#ganttBody .gantt-bar-row');
    const centres = {};
    let visible = 0;
    rows.forEach((row, i) => {
        if (row.style.display === 'none') return;
        centres[i] = visible * GANTT_ROW_HEIGHT + GANTT_ROW_HEIGHT / 2;
        visible++;
    });
    return centres;
}

function ganttNameToIndex() {
    const map = {};
    ganttTasks.forEach((t, i) => {
        // first definition of a duplicated name wins, as it does when scheduling
        if (t.name && !Object.prototype.hasOwnProperty.call(map, t.name.toLowerCase())) map[t.name.toLowerCase()] = i;
    });
    return map;
}

/** Orthogonal finish-to-start route from (startX, startY) into (endX, endY). */
function ganttConnectorPath(startX, startY, endX, endY) {
    const offset = 10;
    if (endX > startX + offset * 2) {
        const midX = startX + offset;
        return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} ` +
            `L ${endX - offset} ${endY} L ${endX} ${endY}`;
    }
    // Overlap: the dependant starts at or before the predecessor ends, so
    // route round in an S shape
    const exitX = startX + offset;
    const entryX = endX - offset;
    const midY = startY + (endY - startY) / 2;
    return `M ${startX} ${startY} L ${exitX} ${startY} L ${exitX} ${midY} ` +
        `L ${entryX} ${midY} L ${entryX} ${endY} L ${endX} ${endY}`;
}

function ganttOverlaySvg(id, zIndex) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = id;
    svg.classList.add('gantt-overlay');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = String(zIndex);
    return svg;
}

/**
 * Draw one overlay of connector lines. `include(task, pred)` picks which
 * dependency links to draw; `style` is the stroke and arrow styling.
 */
function drawGanttConnectors(svg, include, style) {
    const nameToIndex = ganttNameToIndex();
    const centres = ganttVisibleRowCentres();
    const arrowSize = 5;
    let count = 0;

    ganttTasks.forEach((task, index) => {
        if (!task.depends || task.depends.length === 0 || !task.start) return;
        const depY = centres[index];
        const depSpan = ganttBarSpan(index);
        if (depY === undefined || !depSpan) return;

        task.depends.forEach(depName => {
            const predIndex = nameToIndex[depName.toLowerCase()];
            if (predIndex === undefined) return;
            const predTask = ganttTasks[predIndex];
            if (!predTask || !predTask.start || !include(task, predTask)) return;
            const predY = centres[predIndex];
            const predSpan = ganttBarSpan(predIndex);
            if (predY === undefined || !predSpan) return;

            const startX = predSpan.left + predSpan.width;
            const endX = depSpan.left;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', ganttConnectorPath(startX, predY, endX, depY));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', style.stroke);
            path.setAttribute('stroke-width', style.width);
            if (style.dash) path.setAttribute('stroke-dasharray', style.dash);

            // Arrowhead pointing right into the left side of the dependant
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points',
                `${endX},${depY} ${endX - arrowSize},${depY - arrowSize} ${endX - arrowSize},${depY + arrowSize}`);
            arrow.setAttribute('fill', style.stroke);

            svg.appendChild(path);
            svg.appendChild(arrow);
            count++;
        });
    });
    return count;
}

/**
 * Draw SVG dependency lines on the gantt chart.
 * Lines run from the end of the dependency bar to the start of the dependent bar.
 */
function renderDependencyLines() {
    const existing = document.getElementById('ganttDependencySvg');
    if (existing) existing.remove();

    const toggle = document.getElementById('ganttShowDependencies');
    if (!toggle || !toggle.checked) return;

    const ganttBody = document.getElementById('ganttBody');
    if (!ganttBody || !ganttTasks || ganttTasks.length === 0) return;

    const svg = ganttOverlaySvg('ganttDependencySvg', 1);
    drawGanttConnectors(svg, () => true, { stroke: '#adb5bd', width: '1.5', dash: '4,3' });
    ganttBody.appendChild(svg);
}

/**
 * Draw red SVG connector lines between critical path tasks.
 * Only shown when the "Critical Path" toggle is checked.
 */
function renderCriticalPathLines() {
    const existing = document.getElementById('ganttCriticalPathSvg');
    if (existing) existing.remove();

    const toggle = document.getElementById('ganttShowCriticalPath');
    if (!toggle || !toggle.checked) return;

    const ganttBody = document.getElementById('ganttBody');
    if (!ganttBody || !ganttTasks || ganttTasks.length === 0) return;

    const svg = ganttOverlaySvg('ganttCriticalPathSvg', 2);
    const drawn = drawGanttConnectors(svg,
        (task, pred) => task.critical && !task.is_summary && pred.critical,
        { stroke: '#e03131', width: '2' });
    if (drawn) ganttBody.appendChild(svg);
}

// ----- Drag to reschedule (#787) -----
//
// Dragging a bar's right handle changes its duration, the left handle its
// start (the finish stays put), and the body moves the whole task. The drag
// moves in whole snap units for the current zoom (days, weeks or months --
// see GanttScale.snapUnit) so it is controllable at every zoom.
//
// While the pointer moves, engine/gantt-drag.js turns the drag into the edit
// the plan would receive and schedules that edited plan with the page's own
// engine. Every bar the edit moves -- dependants, successors down the chain,
// the summary bars above them -- is repositioned live from that schedule, so
// the preview is the result. Release commits the edited text to the editor
// in one step (one undo), and the re-render that follows produces the same
// schedule, so nothing snaps back.

function ganttEditor() {
    return document.getElementById('planEditor');
}

/** The main bar element (task bar or milestone) for a task index. */
function ganttMainBar(index) {
    const row = document.querySelector(`#ganttBody .gantt-bar-row[data-task-index="${index}"]`);
    return row ? row.querySelector('[data-gantt-kind="task"], [data-gantt-kind="milestone"]') : null;
}

function ganttInfoRow(index) {
    return document.querySelector(`#ganttInfoBody tr[data-task-index="${index}"]`);
}

/**
 * Show a drag preview: move every bar whose dates the edited schedule
 * changes, mark them as previews, and update their Start / Finish /
 * Duration cells. `spans` maps task index -> { startDay, finishDay,
 * duration } for tasks that moved; null restores the committed layout.
 */
function applyGanttPreview(spans, draggedIndex) {
    ganttPreviewSpans = spans;
    ganttTasks.forEach((task, index) => {
        const bar = ganttMainBar(index);
        const row = ganttInfoRow(index);
        const span = spans && spans[index];
        const startDay = span ? span.startDay : GanttScale.dayOf(task.start);
        const finishDay = span ? span.finishDay : GanttScale.dayOf(task.finish);
        if (bar && startDay !== null) {
            bar.dataset.startDay = startDay;
            bar.dataset.finishDay = finishDay;
            placeGanttElement(bar);
            bar.classList.toggle('gantt-bar-preview', Boolean(span) && index !== draggedIndex);
        }
        if (row) {
            const cells = {
                start: span ? GanttScale.isoOf(span.startDay) : (task.start || '-'),
                finish: span ? GanttScale.isoOf(span.finishDay) : (task.finish || '-'),
                duration: span ? `${span.duration}d` : (task.duration_days ? `${task.duration_days}d` : '-'),
            };
            for (const [field, text] of Object.entries(cells)) {
                const cell = row.querySelector(`td[data-field="${field}"]`);
                if (!cell || cell.classList.contains('editing')) continue;
                cell.textContent = text;
                cell.classList.toggle('gantt-cell-preview', Boolean(span));
            }
        }
    });
    renderDependencyLines();
    renderCriticalPathLines();
}

/** Spans for the tasks whose dates differ between the committed schedule
 *  and a preview schedule. Tasks are matched by `_uid`, else by position
 *  (a drag never changes the outline, so positions line up). */
function ganttChangedSpans(previewTasks) {
    const byUid = new Map();
    previewTasks.forEach(t => { if (t._uid !== undefined) byUid.set(t._uid, t); });
    const spans = {};
    let any = false;
    ganttTasks.forEach((task, index) => {
        const next = (task._uid !== undefined && byUid.get(task._uid)) || previewTasks[index];
        if (!next || !next.start || !next.finish) return;
        if (next.start === task.start && next.finish === task.finish &&
            next.duration_days === task.duration_days) return;
        spans[index] = {
            startDay: GanttScale.dayOf(next.start),
            finishDay: GanttScale.dayOf(next.finish),
            duration: next.duration_days,
        };
        any = true;
    });
    return any ? spans : null;
}

function showGanttDragLabel(drag, text) {
    let label = document.getElementById('ganttDragLabel');
    if (!text) { if (label) label.remove(); return; }
    const bar = ganttMainBar(drag.index);
    if (!bar) return;
    if (!label) {
        label = document.createElement('div');
        label.id = 'ganttDragLabel';
        label.className = 'gantt-drag-label';
        label.setAttribute('role', 'status');
        label.setAttribute('aria-live', 'polite');
    }
    bar.parentElement.appendChild(label);
    label.style.left = (parseFloat(bar.style.left) || 0) + 'px';
    label.textContent = text;
}

/** Recompute the preview for the drag's current snap step. */
function updateGanttDragPreview(drag) {
    drag.previewSteps = drag.steps;
    const engine = ganttDragEngine;
    if (!engine || !drag.baseText) {
        // No engine: move just this bar, geometrically (the pre-#787 behaviour)
        const shiftedStart = GanttScale.shiftBySteps(drag.startDay, drag.steps, ganttPixelsPerDay);
        const shiftedFinish = GanttScale.shiftBySteps(drag.finishDay, drag.steps, ganttPixelsPerDay);
        const span = drag.handle === 'right' ? { startDay: drag.startDay, finishDay: shiftedFinish }
            : drag.handle === 'left' ? { startDay: shiftedStart, finishDay: drag.finishDay }
            : { startDay: shiftedStart, finishDay: shiftedFinish };
        if (span.finishDay <= span.startDay && !drag.milestone) return;
        span.duration = drag.task.duration_days;
        applyGanttPreview({ [drag.index]: span }, drag.index);
        return;
    }

    if (drag.calendar === undefined) {
        drag.calendar = engine.dragCalendar(drag.baseText, drag.uid);
    }
    const preview = drag.steps ? engine.previewDrag(drag.baseText, drag, drag.steps, ganttPixelsPerDay) : null;
    if (preview && preview.blocked && drag.handle === 'left') {
        // A predecessor holds the start later than the handle asks; keep
        // the last valid preview rather than grow the bar at the far end.
        showGanttDragLabel(drag, 'Held by a predecessor');
        return;
    }
    drag.preview = preview;
    if (!preview) {
        applyGanttPreview(null, drag.index);
        showGanttDragLabel(drag, null);
        return;
    }
    const spans = ganttChangedSpans(preview.result.tasks || []);
    applyGanttPreview(spans, drag.index);
    const moved = spans && spans[drag.index];
    if (moved) {
        const others = Object.keys(spans).filter(i => Number(i) !== drag.index &&
            !ganttTasks[Number(i)].is_summary).length;
        showGanttDragLabel(drag, `${GanttScale.isoOf(moved.startDay)} → ` +
            `${GanttScale.isoOf(moved.finishDay - (drag.milestone ? 0 : 1))} · ${moved.duration}d` +
            (others ? ` · moves ${others} other task${others === 1 ? '' : 's'}` : ''));
    } else {
        showGanttDragLabel(drag, preview.blocked ? 'Held by a predecessor' : null);
    }
}

/** Write a finished drag to the plan: one editor change, one undo step. */
function commitGanttDrag(drag) {
    const editor = ganttEditor();
    if (!ganttDragEngine || !editor) {
        updateTaskDates(drag.task, drag.index, drag.handle, drag.steps);
        return;
    }
    // The plan can change under a drag without the user touching it -- a
    // render writing back the front matter's `rag:`, an autosave merge. The
    // edit is addressed by `_uid`, not by text position, so it is simply
    // re-applied to whatever the editor holds now.
    if (editor.value !== drag.baseText) {
        drag.baseText = editor.value;
        drag.calendar = undefined;
        drag.preview = null;
    }
    // Make sure the preview reflects the final step, even if the last
    // animation frame never ran.
    if (!drag.preview || drag.previewSteps !== drag.steps) updateGanttDragPreview(drag);
    const preview = drag.preview;
    if (!preview) {
        // Nothing to write (no net change, or the task is gone)
        applyGanttPreview(null, drag.index);
        return;
    }

    if (typeof EditorUndoManager !== 'undefined') EditorUndoManager.captureImmediate(editor.value);
    editor.value = preview.text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof EditorUndoManager !== 'undefined') EditorUndoManager.captureImmediate(editor.value);

    // Re-schedule now rather than on the editor's input debounce, so the
    // committed chart replaces the preview immediately
    renderText();
}

function setupBarDragListeners(bar, task, taskIndex) {
    let drag = null;

    const finish = (e, cancelled) => {
        if (!drag || (e && e.pointerId !== drag.pointerId)) return;
        const current = drag;
        drag = null;
        if (current.frame) cancelAnimationFrame(current.frame);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);
        document.removeEventListener('keydown', onKeyDown, true);
        bar.classList.remove('dragging');
        document.body.classList.remove('gantt-dragging');
        if (e && bar.hasPointerCapture && bar.hasPointerCapture(e.pointerId)) {
            bar.releasePointerCapture(e.pointerId);
        }
        showGanttDragLabel(current, null);
        ganttActiveDrag = null;
        const deferred = ganttDeferredTasks;
        ganttDeferredTasks = null;

        if (!cancelled && current.moved && current.steps) {
            commitGanttDrag(current);   // re-renders from the committed text
        } else if (deferred) {
            updateGantt(deferred);
        } else {
            applyGanttPreview(null, current.index);
        }
    };

    const onPointerMove = (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const deltaX = e.clientX - drag.startX;
        if (!drag.moved && Math.abs(deltaX) < GANTT_DRAG_THRESHOLD_PX) return;
        if (!drag.moved) {
            drag.moved = true;
            ganttActiveDrag = drag;
            bar.classList.add('dragging');
            document.body.classList.add('gantt-dragging');
        }
        e.preventDefault();

        const steps = GanttScale.snapSteps(deltaX, ganttPixelsPerDay);
        if (steps === drag.steps) return;
        drag.steps = steps;
        if (!drag.frame) {
            drag.frame = requestAnimationFrame(() => {
                if (!drag) return;
                drag.frame = 0;
                updateGanttDragPreview(drag);
            });
        }
    };

    const onPointerUp = (e) => finish(e, false);
    const onPointerCancel = (e) => finish(e, true);
    const onKeyDown = (e) => {
        if (e.key !== 'Escape' || !drag) return;
        e.preventDefault();
        e.stopPropagation();
        finish({ pointerId: drag.pointerId }, true);
    };

    bar.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (task.is_summary) return;  // Summary bars follow their children
        const handle = e.target.classList.contains('gantt-bar-handle') ? e.target.dataset.handle : 'middle';
        const editor = ganttEditor();
        drag = {
            pointerId: e.pointerId,
            startX: e.clientX,
            handle,
            task,
            index: taskIndex,
            uid: task._uid !== undefined ? task._uid : taskIndex,
            startDay: GanttScale.dayOf(task.start),
            finishDay: GanttScale.dayOf(task.finish),
            milestone: task.duration_days === 0,
            baseText: editor ? editor.value : '',
            calendar: undefined,
            steps: 0,
            moved: false,
            frame: 0,
            preview: null,
        };
        if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
        e.stopPropagation();
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerCancel);
        document.addEventListener('keydown', onKeyDown, true);
    });
}

/**
 * Fallback commit when the preview engine could not be loaded: shift the
 * task's dates by whole snap steps and write them through the
 * `_uid`-addressed model path in editor-sync.js.
 */
function updateTaskDates(task, taskIndex, handleType, steps) {
    const startDay = GanttScale.dayOf(task.start);
    const finishDay = GanttScale.dayOf(task.finish);
    const newStart = GanttScale.shiftBySteps(startDay, steps, ganttPixelsPerDay);
    const newFinish = GanttScale.shiftBySteps(finishDay, steps, ganttPixelsPerDay);

    if (handleType === 'right') {
        task.finish = GanttScale.isoOf(newFinish);
    } else if (handleType === 'left') {
        task.start = GanttScale.isoOf(newStart);
    } else {
        task.start = GanttScale.isoOf(newStart);
        task.finish = GanttScale.isoOf(newFinish);
    }
    ganttTasks[taskIndex].start = task.start;
    ganttTasks[taskIndex].finish = task.finish;

    if (task.duration_days !== 0) {
        // finish is exclusive; count Mon-Fri between them
        let count = 0;
        for (let d = GanttScale.dayOf(task.start); d < GanttScale.dayOf(task.finish); d++) {
            if (((d + 3) % 7 + 7) % 7 < 5) count++;
        }
        task.duration_days = Math.max(1, count);
        ganttTasks[taskIndex].duration_days = task.duration_days;
    }

    if (handleType === 'right') {
        syncGanttDurationToEditor(task, taskIndex);
    } else if (handleType === 'left') {
        syncGanttStartDateToEditor(task, taskIndex);
        syncGanttDurationToEditor(task, taskIndex);
    } else {
        syncGanttStartDateToEditor(task, taskIndex);
    }

    // Trigger a full re-parse to recalculate dependencies
    renderText();
}
