/**
 * settings.js — Project settings panel for NoodlePlanner.
 *
 * Provides a slide-out settings panel with tabs for Gantt, Board, Timeline,
 * Theme, and AI settings. Settings are persisted in the plan front matter
 * under a `settings:` block.
 *
 * Must be loaded after state.js, theme.js, and before script.js.
 */

// ---------------------------------------------------------------------------
// Settings debounce timer
// ---------------------------------------------------------------------------
let settingsDebounceTimer = null;

// ---------------------------------------------------------------------------
// Read settings from front matter
// ---------------------------------------------------------------------------

/**
 * Parse the settings block from the plan editor front matter.
 * Returns an object with setting keys and values.
 */
function readSettingsFromFrontMatter() {
    const editor = document.getElementById('planEditor');
    if (!editor) return {};

    const content = editor.value;
    if (!content) return {};

    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return {};

    const fmContent = fmMatch[1];
    const lines = fmContent.split('\n');
    const settings = {};
    let inSettings = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Check for section headers (lines ending with : that are not list items)
        if (trimmed.endsWith(':') && !trimmed.includes('- ') && !trimmed.startsWith('-')) {
            const sectionName = trimmed.replace(':', '').toLowerCase();
            if (sectionName === 'settings') {
                inSettings = true;
                continue;
            } else {
                if (inSettings) break;
            }
        }

        if (inSettings) {
            // Parse key: value pairs within the settings block
            const kvMatch = trimmed.match(/^(\S[\w_-]+)\s*:\s*(.+)$/);
            if (kvMatch) {
                const key = kvMatch[1].trim();
                let value = kvMatch[2].trim();

                // Convert boolean-like strings
                if (value === 'true') value = true;
                else if (value === 'false') value = false;

                settings[key] = value;
            }
        }
    }

    return settings;
}

// ---------------------------------------------------------------------------
// Write settings to front matter
// ---------------------------------------------------------------------------

/**
 * Collect current settings from the panel form and write them to
 * the plan editor front matter under a `settings:` block.
 */
function writeSettingsToFrontMatter() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const content = editor.value;
    if (!content) return;

    // Collect settings from the panel controls
    const settings = collectSettingsFromPanel();

    // Build the settings block
    let settingsBlock = 'settings:\n';
    for (const [key, value] of Object.entries(settings)) {
        settingsBlock += `  ${key}: ${value}\n`;
    }

    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) {
        // No front matter — insert one with settings
        editor.value = '---\n' + settingsBlock + '---\n' + content;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }

    // Remove existing settings section and re-add
    let fmContent = fmMatch[1];
    fmContent = removeSettingsSection(fmContent);

    // Add settings block at end of front matter
    if (fmContent && !fmContent.endsWith('\n')) fmContent += '\n';
    fmContent += settingsBlock;

    // Reconstruct the full content
    const afterFm = content.substring(fmMatch[0].length);
    editor.value = '---\n' + fmContent + '---' + afterFm;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Remove the settings: section from front matter content.
 */
function removeSettingsSection(fmContent) {
    const lines = fmContent.split('\n');
    const result = [];
    let inSettings = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.endsWith(':') && !trimmed.includes('- ') && !trimmed.startsWith('-')) {
            const name = trimmed.replace(':', '').toLowerCase();
            if (name === 'settings') {
                inSettings = true;
                continue;
            } else {
                inSettings = false;
            }
        }

        if (!inSettings) {
            result.push(line);
        } else {
            // Inside settings — skip indented key:value lines
            if (trimmed.match(/^\S[\w_-]+\s*:/) || trimmed === '') {
                continue;
            } else {
                // Not a settings line — end of settings section
                inSettings = false;
                result.push(line);
            }
        }
    }

    return result.join('\n');
}

// ---------------------------------------------------------------------------
// Collect settings from the panel
// ---------------------------------------------------------------------------

/**
 * Read all toggle/select states from the settings panel form.
 */
function collectSettingsFromPanel() {
    const settings = {};

    // Gantt
    const ganttDeps = document.getElementById('settingsGanttDeps');
    const ganttCP = document.getElementById('settingsGanttCriticalPath');
    const ganttBaseline = document.getElementById('settingsGanttBaseline');
    if (ganttDeps) settings.gantt_show_dependencies = ganttDeps.checked;
    if (ganttCP) settings.gantt_critical_path = ganttCP.checked;
    if (ganttBaseline) settings.gantt_show_baseline = ganttBaseline.checked;

    // Board
    const boardHide = document.getElementById('settingsBoardHideCompleted');
    const boardSort = document.getElementById('settingsBoardSortPriority');
    if (boardHide) settings.board_hide_completed = boardHide.checked;
    if (boardSort) settings.board_sort_priority = boardSort.checked;

    // Timeline
    const tlPhases = document.getElementById('settingsTimelinePhases');
    const tlDetailed = document.getElementById('settingsTimelineDetailed');
    const tlMinimal = document.getElementById('settingsTimelineMinimal');
    const tlToday = document.getElementById('settingsTimelineToday');
    if (tlPhases) settings.timeline_show_phases = tlPhases.checked;
    if (tlDetailed) settings.timeline_detailed = tlDetailed.checked;
    if (tlMinimal) settings.timeline_minimal = tlMinimal.checked;
    if (tlToday) settings.timeline_today = tlToday.checked;

    // Theme
    const themeSelect = document.querySelector('input[name="settingsTheme"]:checked');
    if (themeSelect) settings.theme = themeSelect.value;

    return settings;
}

// ---------------------------------------------------------------------------
// Apply settings to the UI
// ---------------------------------------------------------------------------

/**
 * Apply saved settings from front matter to all the relevant UI controls.
 * Called after plan loads / updateAllViews.
 */
function applySettingsFromFrontMatter(frontMatter) {
    if (!frontMatter || !frontMatter.settings) return;

    const s = frontMatter.settings;

    // Gantt
    applyToggle('ganttShowDependencies', s.gantt_show_dependencies);
    applyToggle('ganttShowCriticalPath', s.gantt_critical_path);
    applyToggle('ganttShowBaseline', s.gantt_show_baseline);

    // Settings panel toggles
    applyToggle('settingsGanttDeps', s.gantt_show_dependencies);
    applyToggle('settingsGanttCriticalPath', s.gantt_critical_path);
    applyToggle('settingsGanttBaseline', s.gantt_show_baseline);

    // Board
    if (s.board_hide_completed !== undefined) {
        applyToggle('kanbanHideCompleted', s.board_hide_completed);
        applyToggle('settingsBoardHideCompleted', s.board_hide_completed);
        if (typeof kanbanBoard !== 'undefined' && kanbanBoard) {
            kanbanBoard.hideCompleted = !!s.board_hide_completed;
        }
    }
    if (s.board_sort_priority !== undefined) {
        applyToggle('kanbanSortPriority', s.board_sort_priority);
        applyToggle('settingsBoardSortPriority', s.board_sort_priority);
        if (typeof kanbanBoard !== 'undefined' && kanbanBoard) {
            kanbanBoard.sortByPriority = !!s.board_sort_priority;
        }
    }

    // Timeline
    if (s.timeline_show_phases !== undefined) {
        applyToggle('showPhasesToggle', s.timeline_show_phases);
        applyToggle('settingsTimelinePhases', s.timeline_show_phases);
    }
    if (s.timeline_detailed !== undefined) {
        applyToggle('detailedTimelineToggle', s.timeline_detailed);
        applyToggle('settingsTimelineDetailed', s.timeline_detailed);
        detailedTimelineEnabled = !!s.timeline_detailed;
    }
    if (s.timeline_minimal !== undefined) {
        applyToggle('minimalTimelineToggle', s.timeline_minimal);
        applyToggle('settingsTimelineMinimal', s.timeline_minimal);
        minimalTimelineEnabled = !!s.timeline_minimal;
    }
    if (s.timeline_today !== undefined) {
        applyToggle('todayMarkerToggle', s.timeline_today);
        applyToggle('settingsTimelineToday', s.timeline_today);
    }

    // Theme — update theme radio buttons in settings panel
    if (s.theme) {
        const radio = document.querySelector(`input[name="settingsTheme"][value="${s.theme}"]`);
        if (radio) radio.checked = true;
    }
}

/**
 * Helper to set a checkbox's checked state.
 */
function applyToggle(elementId, value) {
    const el = document.getElementById(elementId);
    if (el && value !== undefined) {
        el.checked = (value === true || value === 'true');
    }
}

// ---------------------------------------------------------------------------
// Settings panel open/close
// ---------------------------------------------------------------------------

function openSettingsPanel() {
    // Populate the settings panel from the current front matter
    populateSettingsPanelFromState();
    openDetailPane('settingsSection');
}

function closeSettingsPanel() {
    closeDetailPane();
}

function toggleSettingsPanel() {
    const pane = document.getElementById('detailPane');
    const section = document.getElementById('settingsSection');
    if (pane && pane.classList.contains('open') && section && section.classList.contains('active')) {
        closeSettingsPanel();
    } else {
        openSettingsPanel();
    }
}

/**
 * Populate the settings panel controls from the current UI state
 * (reads both front matter settings and current toggle states).
 */
function populateSettingsPanelFromState() {
    // Read from front matter first
    const saved = readSettingsFromFrontMatter();

    // Gantt — use saved settings or current toggle state
    const ganttDeps = document.getElementById('ganttShowDependencies');
    const ganttCP = document.getElementById('ganttShowCriticalPath');
    const ganttBL = document.getElementById('ganttShowBaseline');

    setChecked('settingsGanttDeps', saved.gantt_show_dependencies ?? ganttDeps?.checked ?? false);
    setChecked('settingsGanttCriticalPath', saved.gantt_critical_path ?? ganttCP?.checked ?? false);
    setChecked('settingsGanttBaseline', saved.gantt_show_baseline ?? ganttBL?.checked ?? false);

    // Board
    const boardHide = document.getElementById('kanbanHideCompleted');
    const boardSort = document.getElementById('kanbanSortPriority');
    setChecked('settingsBoardHideCompleted', saved.board_hide_completed ?? boardHide?.checked ?? false);
    setChecked('settingsBoardSortPriority', saved.board_sort_priority ?? boardSort?.checked ?? false);

    // Timeline
    const tlPhases = document.getElementById('showPhasesToggle');
    const tlDetailed = document.getElementById('detailedTimelineToggle');
    const tlMinimal = document.getElementById('minimalTimelineToggle');
    const tlToday = document.getElementById('todayMarkerToggle');
    setChecked('settingsTimelinePhases', saved.timeline_show_phases ?? tlPhases?.checked ?? false);
    setChecked('settingsTimelineDetailed', saved.timeline_detailed ?? tlDetailed?.checked ?? false);
    setChecked('settingsTimelineMinimal', saved.timeline_minimal ?? tlMinimal?.checked ?? false);
    setChecked('settingsTimelineToday', saved.timeline_today ?? tlToday?.checked ?? false);

    // Theme
    const theme = saved.theme || currentThemeChoice || 'light';
    const radio = document.querySelector(`input[name="settingsTheme"][value="${theme}"]`);
    if (radio) radio.checked = true;

    // Activate the first tab by default
    switchSettingsTab('gantt');
}

function setChecked(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = (val === true || val === 'true');
}

// ---------------------------------------------------------------------------
// Settings tabs
// ---------------------------------------------------------------------------

function switchSettingsTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === 'settingsTab-' + tabName);
    });
}

// ---------------------------------------------------------------------------
// Handle setting changes
// ---------------------------------------------------------------------------

/**
 * Called when any setting toggle changes in the settings panel.
 * Syncs the change to the corresponding toolbar control and saves to front matter.
 */
function onSettingChanged(settingType) {
    switch (settingType) {
        case 'gantt_deps': {
            const val = document.getElementById('settingsGanttDeps')?.checked ?? false;
            applyToggle('ganttShowDependencies', val);
            if (typeof renderDependencyLines === 'function') renderDependencyLines();
            break;
        }
        case 'gantt_critical_path': {
            const val = document.getElementById('settingsGanttCriticalPath')?.checked ?? false;
            applyToggle('ganttShowCriticalPath', val);
            if (typeof renderGanttChart === 'function') renderGanttChart();
            break;
        }
        case 'gantt_baseline': {
            const val = document.getElementById('settingsGanttBaseline')?.checked ?? false;
            applyToggle('ganttShowBaseline', val);
            if (typeof toggleBaselineDisplay === 'function') toggleBaselineDisplay();
            break;
        }
        case 'board_hide_completed': {
            const val = document.getElementById('settingsBoardHideCompleted')?.checked ?? false;
            applyToggle('kanbanHideCompleted', val);
            if (typeof toggleKanbanHideCompleted === 'function') toggleKanbanHideCompleted(val);
            break;
        }
        case 'board_sort_priority': {
            const val = document.getElementById('settingsBoardSortPriority')?.checked ?? false;
            applyToggle('kanbanSortPriority', val);
            if (typeof toggleKanbanPrioritySort === 'function') toggleKanbanPrioritySort(val);
            break;
        }
        case 'timeline_phases': {
            const val = document.getElementById('settingsTimelinePhases')?.checked ?? false;
            applyToggle('showPhasesToggle', val);
            if (typeof toggleTimelinePhases === 'function') toggleTimelinePhases();
            break;
        }
        case 'timeline_detailed': {
            const val = document.getElementById('settingsTimelineDetailed')?.checked ?? false;
            applyToggle('detailedTimelineToggle', val);
            if (typeof toggleDetailedTimeline === 'function') toggleDetailedTimeline();
            break;
        }
        case 'timeline_minimal': {
            const val = document.getElementById('settingsTimelineMinimal')?.checked ?? false;
            applyToggle('minimalTimelineToggle', val);
            // When minimal is on, disable phases/detailed in settings panel too
            const phasesEl = document.getElementById('settingsTimelinePhases');
            const detailedEl = document.getElementById('settingsTimelineDetailed');
            if (phasesEl) {
                phasesEl.disabled = val;
                if (val) phasesEl.checked = false;
            }
            if (detailedEl) {
                detailedEl.disabled = val;
                if (val) detailedEl.checked = false;
            }
            if (typeof toggleMinimalTimeline === 'function') toggleMinimalTimeline();
            break;
        }
        case 'timeline_today': {
            const val = document.getElementById('settingsTimelineToday')?.checked ?? false;
            applyToggle('todayMarkerToggle', val);
            if (typeof toggleTodayMarker === 'function') toggleTodayMarker();
            break;
        }
        case 'theme': {
            const radio = document.querySelector('input[name="settingsTheme"]:checked');
            if (radio && typeof setThemeChoice === 'function') {
                setThemeChoice(radio.value);
            }
            break;
        }
    }

    // Debounce save to front matter
    if (settingsDebounceTimer) clearTimeout(settingsDebounceTimer);
    settingsDebounceTimer = setTimeout(() => {
        writeSettingsToFrontMatter();
    }, 1000);
}

// ---------------------------------------------------------------------------
// Sync from toolbar controls to settings panel
// ---------------------------------------------------------------------------

/**
 * When a toolbar control changes, sync its state to the settings panel.
 * Called from existing event handlers.
 */
function syncToolbarToSettings(settingKey, value) {
    switch (settingKey) {
        case 'gantt_deps':
            setChecked('settingsGanttDeps', value);
            break;
        case 'gantt_critical_path':
            setChecked('settingsGanttCriticalPath', value);
            break;
        case 'gantt_baseline':
            setChecked('settingsGanttBaseline', value);
            break;
        case 'board_hide_completed':
            setChecked('settingsBoardHideCompleted', value);
            break;
        case 'board_sort_priority':
            setChecked('settingsBoardSortPriority', value);
            break;
        case 'timeline_phases':
            setChecked('settingsTimelinePhases', value);
            break;
        case 'timeline_detailed':
            setChecked('settingsTimelineDetailed', value);
            break;
        case 'timeline_minimal':
            setChecked('settingsTimelineMinimal', value);
            break;
        case 'timeline_today':
            setChecked('settingsTimelineToday', value);
            break;
    }

    // Also save to front matter when toolbar controls change
    if (settingsDebounceTimer) clearTimeout(settingsDebounceTimer);
    settingsDebounceTimer = setTimeout(() => {
        writeSettingsToFrontMatter();
    }, 1000);
}
